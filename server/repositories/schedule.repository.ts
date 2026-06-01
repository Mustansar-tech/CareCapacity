import { db } from '../infrastructure/db';
import { weeklySchedules, cpScheduledVisits, ghClientVisits } from '@shared/schema';
import type {
  WeeklySchedule, InsertWeeklySchedule,
  CpScheduledVisit, InsertCpScheduledVisit,
  GhClientVisit, InsertGhClientVisit,
} from '@shared/schema';
import { eq, and, lt, gte, lte, desc, inArray, sql } from 'drizzle-orm';

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

export async function enforceRetentionCpScheduledVisits(branchId: string): Promise<void> {
  // 15-week window: 2 past weeks + current + 13 future weeks.
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const currentMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff));

  const lowerCutoff = new Date(currentMonday);
  lowerCutoff.setUTCDate(lowerCutoff.getUTCDate() - 14);
  const lowerStr = lowerCutoff.toISOString().slice(0, 10);

  const upperCutoff = new Date(currentMonday);
  upperCutoff.setUTCDate(upperCutoff.getUTCDate() + 13 * 7 + 6); // +6 to include the last day of the 13th future week
  const upperStr = upperCutoff.toISOString().slice(0, 10);

  await db.delete(cpScheduledVisits).where(
    and(
      eq(cpScheduledVisits.branchId, branchId),
      sql`(${cpScheduledVisits.date} < ${lowerStr} OR ${cpScheduledVisits.date} > ${upperStr})`,
    ),
  );
}

// ─── GH Client Visits ─────────────────────────────────────────────────────────

export async function upsertGhClientVisitsByDates(branchId: string, dates: string[], visitRows: InsertGhClientVisit[]): Promise<void> {
  if (dates.length === 0) return;
  await db.transaction(async (tx) => {
    await tx.delete(ghClientVisits).where(
      and(eq(ghClientVisits.branchId, branchId), inArray(ghClientVisits.date, dates)),
    );
    if (visitRows.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < visitRows.length; i += BATCH) {
        await tx.insert(ghClientVisits).values(visitRows.slice(i, i + BATCH));
      }
    }
  });
}

export async function enforceRetentionGhClientVisits(branchId: string): Promise<void> {
  // 15-week window: 2 past weeks + current + 13 future weeks.
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const currentMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff));

  const lowerCutoff = new Date(currentMonday);
  lowerCutoff.setUTCDate(lowerCutoff.getUTCDate() - 14);
  const lowerStr = lowerCutoff.toISOString().slice(0, 10);

  const upperCutoff = new Date(currentMonday);
  upperCutoff.setUTCDate(upperCutoff.getUTCDate() + 13 * 7 + 6); // +6 to include the last day of the 13th future week
  const upperStr = upperCutoff.toISOString().slice(0, 10);

  await db.delete(ghClientVisits).where(
    and(
      eq(ghClientVisits.branchId, branchId),
      sql`(${ghClientVisits.date} < ${lowerStr} OR ${ghClientVisits.date} > ${upperStr})`,
    ),
  );
}

export async function getGhClientVisitsByDate(branchId: string, date: string): Promise<GhClientVisit[]> {
  return db.select().from(ghClientVisits).where(
    and(eq(ghClientVisits.branchId, branchId), eq(ghClientVisits.date, date)),
  );
}

export async function getGhClientVisitsByWeek(branchId: string, weekStart: string, weekEnd: string): Promise<GhClientVisit[]> {
  return db.select().from(ghClientVisits).where(
    and(
      eq(ghClientVisits.branchId, branchId),
      gte(ghClientVisits.date, weekStart),
      lte(ghClientVisits.date, weekEnd),
    ),
  );
}
