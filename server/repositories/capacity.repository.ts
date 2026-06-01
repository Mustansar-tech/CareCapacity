import { db } from '../infrastructure/db';
import { capacityAnalyses } from '@shared/schema';
import type { CapacityAnalysis, CapacityAnalysisHeader, InsertCapacityAnalysis } from '@shared/schema';
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';

export async function saveCapacityAnalysis(analysis: InsertCapacityAnalysis): Promise<CapacityAnalysis> {
  const [result] = await db
    .insert(capacityAnalyses)
    .values(analysis)
    .onConflictDoUpdate({
      target: [capacityAnalyses.branchId, capacityAnalyses.weekStartDate, capacityAnalyses.weekEndDate],
      set: {
        kpis: analysis.kpis,
        dailySummary: analysis.dailySummary,
        employeesByDate: analysis.employeesByDate,
        employeeSummaryByDate: analysis.employeeSummaryByDate,
        warnings: analysis.warnings,
        ghLossRawSummary: analysis.ghLossRawSummary,
        uploadedAt: new Date(),
      },
    })
    .returning();
  return result;
}

export async function getCapacityAnalysesByDateRange(branchId: string, startDate: string, endDate: string): Promise<CapacityAnalysis[]> {
  return db
    .select()
    .from(capacityAnalyses)
    .where(
      and(
        eq(capacityAnalyses.branchId, branchId),
        gte(capacityAnalyses.weekStartDate, startDate),
        lte(capacityAnalyses.weekEndDate, endDate),
      ),
    );
}

export async function getAllCapacityAnalyses(branchId: string): Promise<CapacityAnalysis[]> {
  return db
    .select()
    .from(capacityAnalyses)
    .where(eq(capacityAnalyses.branchId, branchId))
    .orderBy(desc(capacityAnalyses.uploadedAt));
}

export async function getLatestCapacityAnalysis(branchId: string): Promise<CapacityAnalysis | undefined> {
  const [analysis] = await db
    .select()
    .from(capacityAnalyses)
    .where(eq(capacityAnalyses.branchId, branchId))
    .orderBy(desc(capacityAnalyses.uploadedAt))
    .limit(1);
  return analysis;
}

export async function getCapacityAnalysisByWeekStart(branchId: string, weekStartDate: string): Promise<CapacityAnalysis | undefined> {
  const [analysis] = await db
    .select()
    .from(capacityAnalyses)
    .where(and(eq(capacityAnalyses.branchId, branchId), eq(capacityAnalyses.weekStartDate, weekStartDate)))
    .limit(1);
  return analysis;
}

export async function getLatestWeeksAnalyses(branchId: string, limit = 4): Promise<CapacityAnalysis[]> {
  return db
    .select()
    .from(capacityAnalyses)
    .where(eq(capacityAnalyses.branchId, branchId))
    .orderBy(desc(capacityAnalyses.weekStartDate))
    .limit(limit);
}

/** Lightweight list — header fields only, no JSON blobs. Used by GET /api/history. */
export async function getCapacityAnalysisHeaders(branchId: string, limit = 17): Promise<CapacityAnalysisHeader[]> {
  return db
    .select({
      id: capacityAnalyses.id,
      branchId: capacityAnalyses.branchId,
      weekStartDate: capacityAnalyses.weekStartDate,
      weekEndDate: capacityAnalyses.weekEndDate,
      uploadedAt: capacityAnalyses.uploadedAt,
    })
    .from(capacityAnalyses)
    .where(eq(capacityAnalyses.branchId, branchId))
    .orderBy(desc(capacityAnalyses.weekStartDate))
    .limit(limit);
}

/** Full analysis by ID. Used by GET /api/history/:id when a week is selected. */
export async function getCapacityAnalysisById(id: string, branchId: string): Promise<CapacityAnalysis | undefined> {
  const [analysis] = await db
    .select()
    .from(capacityAnalyses)
    .where(and(eq(capacityAnalyses.id, id), eq(capacityAnalyses.branchId, branchId)))
    .limit(1);
  return analysis;
}

export async function enforceRetentionLatestWeeks(branchId: string): Promise<number> {
  // Keep 2 past weeks (14 days before the current UTC Monday) + all future weeks.
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const currentMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff));
  const cutoffDate = new Date(currentMonday);
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - 14);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);
  const result = await db
    .delete(capacityAnalyses)
    .where(
      and(
        eq(capacityAnalyses.branchId, branchId),
        sql`${capacityAnalyses.weekStartDate} < ${cutoffStr}`,
      ),
    );
  return result.rowCount ?? 0;
}

export async function cleanupOldAnalyses(branchId: string, monthsOld: number): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - monthsOld);
  const result = await db
    .delete(capacityAnalyses)
    .where(
      and(
        eq(capacityAnalyses.branchId, branchId),
        lte(capacityAnalyses.uploadedAt, cutoffDate),
      ),
    );
  return result.rowCount ?? 0;
}
