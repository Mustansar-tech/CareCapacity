import { db } from '../db';
import { capacityAnalyses } from '@shared/schema';
import type { CapacityAnalysis, InsertCapacityAnalysis } from '@shared/schema';
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

export async function enforceRetentionLatestWeeks(branchId: string, limit = 4): Promise<number> {
  const analyses = await getLatestWeeksAnalyses(branchId, limit);
  if (analyses.length < limit) return 0;
  const lastKeepDate = analyses[analyses.length - 1].weekStartDate;
  const result = await db
    .delete(capacityAnalyses)
    .where(
      and(
        eq(capacityAnalyses.branchId, branchId),
        sql`${capacityAnalyses.weekStartDate} < ${lastKeepDate}`,
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
