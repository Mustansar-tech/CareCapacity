import { db } from '../infrastructure/db';
import { capacityAnalyses } from '@shared/schema';
import type { CapacityAnalysis, InsertCapacityAnalysis } from '@shared/schema';
import { eq, and, gte, lte, lt, gt, desc, sql } from 'drizzle-orm';

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

export async function getLatestWeeksAnalyses(branchId: string, limit = 15): Promise<CapacityAnalysis[]> {
  return db
    .select()
    .from(capacityAnalyses)
    .where(eq(capacityAnalyses.branchId, branchId))
    .orderBy(desc(capacityAnalyses.weekStartDate))
    .limit(limit);
}

/**
 * Return all capacity analyses within the 15-week rolling window:
 * 2 past weeks + current week + 13 future weeks.
 * Ordered most-recent-first (highest weekStartDate first).
 */
export async function getWindowedAnalyses(branchId: string): Promise<CapacityAnalysis[]> {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const currentMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff));

  const lowerCutoff = new Date(currentMonday);
  lowerCutoff.setUTCDate(lowerCutoff.getUTCDate() - 14);
  const lowerStr = lowerCutoff.toISOString().slice(0, 10);

  const upperCutoff = new Date(currentMonday);
  upperCutoff.setUTCDate(upperCutoff.getUTCDate() + 13 * 7);
  const upperStr = upperCutoff.toISOString().slice(0, 10);

  return db
    .select()
    .from(capacityAnalyses)
    .where(
      and(
        eq(capacityAnalyses.branchId, branchId),
        gte(capacityAnalyses.weekStartDate, lowerStr),
        lte(capacityAnalyses.weekStartDate, upperStr),
      ),
    )
    .orderBy(desc(capacityAnalyses.weekStartDate));
}

/**
 * 15-week rolling window: keep 2 past weeks + current week + 13 future weeks.
 * Anything outside that window (too old OR too far ahead) is deleted.
 */
export async function enforceRetentionLatestWeeks(branchId: string, _limit?: number): Promise<number> {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const currentMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff));

  // Lower bound: 2 weeks before current Monday
  const lowerCutoff = new Date(currentMonday);
  lowerCutoff.setUTCDate(lowerCutoff.getUTCDate() - 14);
  const lowerStr = lowerCutoff.toISOString().slice(0, 10);

  // Upper bound: 13 weeks after current Monday
  const upperCutoff = new Date(currentMonday);
  upperCutoff.setUTCDate(upperCutoff.getUTCDate() + 13 * 7);
  const upperStr = upperCutoff.toISOString().slice(0, 10);

  const result = await db
    .delete(capacityAnalyses)
    .where(
      and(
        eq(capacityAnalyses.branchId, branchId),
        sql`(${capacityAnalyses.weekStartDate} < ${lowerStr} OR ${capacityAnalyses.weekStartDate} > ${upperStr})`,
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
