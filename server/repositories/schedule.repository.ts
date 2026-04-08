import { db } from '../db';
import { weeklySchedules, cpScheduledVisits } from '@shared/schema';
import type {
  WeeklySchedule, InsertWeeklySchedule,
  CpScheduledVisit, InsertCpScheduledVisit,
} from '@shared/schema';
import { eq, and, lt, desc, inArray } from 'drizzle-orm';

export async function saveWeeklySchedule(schedule: InsertWeeklySchedule): Promise<WeeklySchedule> {
  const [result] = await db
    .insert(weeklySchedules)
    .values(schedule)
    .onConflictDoUpdate({
      target: [weeklySchedules.branchId, weeklySchedules.weekStartDate, weeklySchedules.weekEndDate],
      set: {
        scheduleData: schedule.scheduleData,
        unallocatedVisits: schedule.unallocatedVisits,
        metrics: schedule.metrics,
        generatedAt: new Date(),
      },
    })
    .returning();
  return result;
}

export async function getLatestWeeklySchedule(branchId: string): Promise<WeeklySchedule | undefined> {
  const [schedule] = await db
    .select()
    .from(weeklySchedules)
    .where(eq(weeklySchedules.branchId, branchId))
    .orderBy(desc(weeklySchedules.generatedAt))
    .limit(1);
  return schedule;
}

export async function getWeeklyScheduleByWeek(branchId: string, weekStartDate: string, weekEndDate: string): Promise<WeeklySchedule | undefined> {
  const [schedule] = await db
    .select()
    .from(weeklySchedules)
    .where(
      and(
        eq(weeklySchedules.branchId, branchId),
        eq(weeklySchedules.weekStartDate, weekStartDate),
        eq(weeklySchedules.weekEndDate, weekEndDate),
      ),
    );
  return schedule;
}

export async function getAllWeeklySchedules(branchId: string): Promise<WeeklySchedule[]> {
  return db
    .select()
    .from(weeklySchedules)
    .where(eq(weeklySchedules.branchId, branchId))
    .orderBy(desc(weeklySchedules.generatedAt));
}

export async function saveCpScheduledVisits(visitRows: InsertCpScheduledVisit[]): Promise<void> {
  if (visitRows.length === 0) return;
  const BATCH = 500;
  for (let i = 0; i < visitRows.length; i += BATCH) {
    await db.insert(cpScheduledVisits).values(visitRows.slice(i, i + BATCH));
  }
}

export async function getCpScheduledVisitsByBranch(branchId: string, dates: string[]): Promise<CpScheduledVisit[]> {
  if (dates.length === 0) return [];
  return db
    .select()
    .from(cpScheduledVisits)
    .where(and(eq(cpScheduledVisits.branchId, branchId), inArray(cpScheduledVisits.date, dates)));
}

export async function deleteCpScheduledVisitsByBranch(branchId: string): Promise<void> {
  await db.delete(cpScheduledVisits).where(eq(cpScheduledVisits.branchId, branchId));
}

export async function replaceCpScheduledVisits(branchId: string, visitRows: InsertCpScheduledVisit[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(cpScheduledVisits).where(eq(cpScheduledVisits.branchId, branchId));
    if (visitRows.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < visitRows.length; i += BATCH) {
        await tx.insert(cpScheduledVisits).values(visitRows.slice(i, i + BATCH));
      }
    }
  });
}

export async function upsertCpScheduledVisitsByDates(branchId: string, dates: string[], visitRows: InsertCpScheduledVisit[]): Promise<void> {
  if (dates.length === 0) return;
  await db.transaction(async (tx) => {
    await tx.delete(cpScheduledVisits).where(
      and(eq(cpScheduledVisits.branchId, branchId), inArray(cpScheduledVisits.date, dates)),
    );
    if (visitRows.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < visitRows.length; i += BATCH) {
        await tx.insert(cpScheduledVisits).values(visitRows.slice(i, i + BATCH));
      }
    }
  });
}

export async function enforceRetentionCpScheduledVisits(branchId: string, keepWeeks = 8): Promise<void> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - keepWeeks * 7);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);
  await db.delete(cpScheduledVisits).where(
    and(eq(cpScheduledVisits.branchId, branchId), lt(cpScheduledVisits.date, cutoffStr)),
  );
}
