import { db } from '../infrastructure/db';
import { weeklySchedules, cpScheduledVisits, ghClientVisits, branches, carerHomeBranches } from '@shared/schema';
import type { InsertCarerHomeBranch } from '@shared/schema';
import type {
  WeeklySchedule, InsertWeeklySchedule,
  CpScheduledVisit, InsertCpScheduledVisit,
  GhClientVisit, InsertGhClientVisit,
} from '@shared/schema';
import { eq, ne, and, lt, gte, lte, desc, inArray, sql } from 'drizzle-orm';

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

/**
 * Build and persist carer → home branch mappings from a parsed CG Data array.
 * Shared by every upload path (manual upload, People Planner automation) so
 * they all stay in sync. Resolves each row's "Branch" text against the known
 * branch list; falls back to the uploading branch if no match is found.
 */
export async function persistCarerHomeBranchesFromCgData(
  cgData: Array<Record<string, any>>,
  fallbackBranchId: string,
): Promise<void> {
  const { normalizeName } = await import('../features/imports/pipeline-utils');
  const allBranches = await db.select().from(branches);
  const canon = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const branchLookup = new Map<string, string>();
  for (const b of allBranches) {
    branchLookup.set(canon(b.displayName ?? ''), b.id);
    branchLookup.set(canon(b.name ?? ''), b.id);
  }
  const mappingRows: InsertCarerHomeBranch[] = [];
  const seen = new Set<string>();
  for (const row of cgData) {
    const name = row['CAREGiver Name'];
    if (!name) continue;
    const norm = normalizeName(String(name));
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    const label = String(row['Branch'] ?? '').trim();
    const resolvedBranchId = (label && branchLookup.get(canon(label))) || fallbackBranchId;
    mappingRows.push({
      normalizedName: norm,
      displayName: String(name),
      branchId: resolvedBranchId,
      sourceBranchLabel: label || null,
    });
  }
  await upsertCarerHomeBranches(mappingRows);
}

/** Upsert carer → home branch mappings (from CG Data uploads). */
export async function upsertCarerHomeBranches(rows: InsertCarerHomeBranch[]): Promise<void> {
  if (rows.length === 0) return;
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    await db.insert(carerHomeBranches)
      .values(rows.slice(i, i + BATCH))
      .onConflictDoUpdate({
        target: carerHomeBranches.normalizedName,
        set: {
          displayName: sql`excluded.display_name`,
          branchId: sql`excluded.branch_id`,
          sourceBranchLabel: sql`excluded.source_branch_label`,
          updatedAt: sql`now()`,
        },
      });
  }
}

/** Normalized names of carers whose recorded home branch is NOT the given branch. */
export async function getForeignCarerNames(branchId: string): Promise<string[]> {
  const rows = await db
    .select({ normalizedName: carerHomeBranches.normalizedName })
    .from(carerHomeBranches)
    .where(ne(carerHomeBranches.branchId, branchId));
  return rows.map(r => r.normalizedName);
}

/** Home-branch id per normalized carer name, for the given names. */
export async function getCarerHomeBranchMap(names: string[]): Promise<Record<string, string>> {
  if (names.length === 0) return {};
  const rows = await db
    .select({ normalizedName: carerHomeBranches.normalizedName, branchId: carerHomeBranches.branchId })
    .from(carerHomeBranches)
    .where(inArray(carerHomeBranches.normalizedName, names));
  return Object.fromEntries(rows.map(r => [r.normalizedName, r.branchId]));
}

/**
 * Cross-branch GH hours: for the given dates, sum visit hours per carer in every
 * branch EXCEPT the given one. Used to credit hours a GH carer works while
 * covering visits in another branch back to her home branch's GH loss calc.
 * Returns: { [cpName]: { hours, branches: { [branchDisplayName]: hours } } }
 */
export async function getCrossBranchCpHours(
  excludeBranchId: string,
  dates: string[],
  allowedBranchIds?: string[],
): Promise<Record<string, { hours: number; branches: Record<string, number> }>> {
  if (dates.length === 0) return {};
  if (allowedBranchIds && allowedBranchIds.length === 0) return {};
  const conditions = [
    ne(cpScheduledVisits.branchId, excludeBranchId),
    inArray(cpScheduledVisits.date, dates),
  ];
  if (allowedBranchIds) {
    conditions.push(inArray(cpScheduledVisits.branchId, allowedBranchIds));
  }
  const rows = await db
    .select({
      cpName: cpScheduledVisits.cpName,
      startTime: cpScheduledVisits.startTime,
      endTime: cpScheduledVisits.endTime,
      branchName: branches.displayName,
    })
    .from(cpScheduledVisits)
    .innerJoin(branches, eq(branches.id, cpScheduledVisits.branchId))
    .where(and(...conditions));

  const toMinutes = (t: string): number => {
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  const result: Record<string, { hours: number; branches: Record<string, number> }> = {};
  for (const row of rows) {
    let mins = toMinutes(row.endTime) - toMinutes(row.startTime);
    if (mins < 0) mins += 24 * 60; // overnight visit
    if (mins <= 0) continue;
    const hours = mins / 60;
    const entry = result[row.cpName] ?? (result[row.cpName] = { hours: 0, branches: {} });
    entry.hours += hours;
    const bn = row.branchName ?? 'Other branch';
    entry.branches[bn] = (entry.branches[bn] ?? 0) + hours;
  }
  // Round for clean display
  for (const entry of Object.values(result)) {
    entry.hours = Math.round(entry.hours * 100) / 100;
    for (const k of Object.keys(entry.branches)) {
      entry.branches[k] = Math.round(entry.branches[k] * 100) / 100;
    }
  }
  return result;
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
