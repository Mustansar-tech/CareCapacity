import { db } from '../infrastructure/db';
import { leavers, joiners, monthlyCapacitySnapshots, branches } from '@shared/schema';
import type {
  Leaver, InsertLeaver, Joiner, InsertJoiner,
  OutlookWeek, OutlookTotals, OutlookResponse, OutlookDetail, OutlookRag,
  MonthlySnapshot,
} from '@shared/schema';
import { eq, and, inArray, desc } from 'drizzle-orm';

// ── Confidence weights by stage ───────────────────────────────────────────────

export function getConfidenceWeight(stage: string): number {
  switch (stage) {
    case 'Hired': return 1.0;
    case 'Onboarding':
    case 'Training Attended': return 0.33;
    case 'PVG':
    case 'REF1':
    case 'REF2': return 0.11;
    case 'Dropped': return 0;
    default: return 0.33;
  }
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

function diffDays(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z').getTime();
  const b = new Date(to + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

function currentIsoWeekMonday(): string {
  const now = new Date();
  const dow = now.getUTCDay();
  const daysBack = dow === 0 ? 6 : dow - 1;
  const mon = new Date(now);
  mon.setUTCDate(now.getUTCDate() - daysBack);
  mon.setUTCHours(0, 0, 0, 0);
  return isoDate(mon);
}

function weekBoundaries(weekOffset = 0): { weekStart: string; weekEnd: string } {
  const mon = currentIsoWeekMonday();
  const weekStart = addDays(mon, weekOffset * 7);
  const weekEnd = addDays(weekStart, 6);
  return { weekStart, weekEnd };
}

function weekLabel(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// ── Per-week contribution calculations ───────────────────────────────────────

function calcLossForWeek(leaver: Leaver, weekStart: string, weekEnd: string): number {
  const lwd = leaver.lastWorkingDay;
  if (lwd < weekStart) {
    return leaver.weeklyHours ?? 0;
  }
  if (lwd >= weekEnd) {
    return 0;
  }
  const daysWorked = diffDays(weekStart, lwd) + 1;
  return (leaver.weeklyHours ?? 0) * Math.max(0, 7 - daysWorked) / 7;
}

function calcGainForWeek(joiner: Joiner, weekStart: string, weekEnd: string): number {
  const weight = joiner.confidenceWeight ?? 0;
  const hours = joiner.desiredWeeklyHours ?? 0;
  const esd = joiner.expectedStartDate;
  if (!esd) return hours * weight;
  if (esd > weekEnd) return 0;
  if (esd <= weekStart) return hours * weight;
  const daysWorked = diffDays(esd, weekEnd) + 1;
  return hours * weight * Math.max(0, daysWorked) / 7;
}

function computeRag(hoursLost: number, hoursGained: number): OutlookRag {
  if (hoursLost === 0) return 'green';
  const coverage = hoursGained / hoursLost;
  if (coverage < 0.5) return 'red';
  if (coverage < 1.0) return 'amber';
  return 'green';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Public repository functions ───────────────────────────────────────────────

export async function getLeavers(branchId: string, includeProcessed = false): Promise<Leaver[]> {
  const baseWhere = eq(leavers.branchId, branchId);
  if (includeProcessed) {
    return db.select().from(leavers).where(baseWhere).orderBy(leavers.lastWorkingDay);
  }
  return db
    .select()
    .from(leavers)
    .where(and(baseWhere, eq(leavers.status, 'active')))
    .orderBy(leavers.lastWorkingDay);
}

export async function getJoiners(branchId: string, includeDropped = false, includeAll = false): Promise<Joiner[]> {
  const baseWhere = eq(joiners.branchId, branchId);
  if (includeDropped) {
    return db.select().from(joiners).where(baseWhere).orderBy(joiners.createdAt);
  }
  if (includeAll) {
    // active + hired + hired_archived (everything except dropped)
    return db
      .select()
      .from(joiners)
      .where(and(baseWhere, inArray(joiners.status, ['active', 'hired', 'hired_archived'])))
      .orderBy(joiners.createdAt);
  }
  // Default: active + hired (current pipeline view)
  return db
    .select()
    .from(joiners)
    .where(and(baseWhere, inArray(joiners.status, ['active', 'hired'])))
    .orderBy(joiners.createdAt);
}

export async function createLeaver(data: InsertLeaver): Promise<Leaver> {
  const [row] = await db
    .insert(leavers)
    .values({ ...data, updatedAt: new Date() })
    .returning();
  return row;
}

export async function updateLeaver(id: string, branchId: string, data: Partial<InsertLeaver>): Promise<Leaver | null> {
  const [row] = await db
    .update(leavers)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(leavers.id, id), eq(leavers.branchId, branchId)))
    .returning();
  return row ?? null;
}

export async function deleteLeaver(id: string, branchId: string): Promise<boolean> {
  const result = await db
    .update(leavers)
    .set({ status: 'processed', updatedAt: new Date() })
    .where(and(eq(leavers.id, id), eq(leavers.branchId, branchId)));
  return (result.rowCount ?? 0) > 0;
}

export async function createJoiner(data: Omit<InsertJoiner, 'stage'> & { stage: string; confidenceWeight: number }): Promise<Joiner> {
  const [row] = await db
    .insert(joiners)
    .values({ ...data, updatedAt: new Date() } as any)
    .returning();
  return row;
}

export async function updateJoiner(
  id: string,
  branchId: string,
  data: Partial<Omit<InsertJoiner, 'stage'> & { stage: string; confidenceWeight: number }>,
): Promise<Joiner | null> {
  const [row] = await db
    .update(joiners)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(joiners.id, id), eq(joiners.branchId, branchId)))
    .returning();
  return row ?? null;
}

export async function deleteJoiner(id: string, branchId: string): Promise<boolean> {
  const result = await db
    .update(joiners)
    .set({ status: 'dropped', updatedAt: new Date() })
    .where(and(eq(joiners.id, id), eq(joiners.branchId, branchId)));
  return (result.rowCount ?? 0) > 0;
}

// Filter by employment type
function filterBySegment<T extends { employmentType: string | null }>(
  items: T[],
  segment: string,
): T[] {
  if (segment === 'all') return items;
  return items.filter(i => i.employmentType === segment);
}

export async function computeOutlook(
  branchId: string,
  horizonWeeks = 4,
  segment = 'all',
): Promise<OutlookResponse> {
  const allLeavers = await getLeavers(branchId);
  const allJoinersRaw = await getJoiners(branchId);
  // Only active (not-yet-hired) pipeline joiners in the outlook forecast
  const allJoiners = allJoinersRaw.filter(j => j.status === 'active');

  const segLeavers = filterBySegment(allLeavers, segment);
  const segJoiners = filterBySegment(allJoiners, segment);

  const weeks: OutlookWeek[] = [];

  for (let i = 0; i < horizonWeeks; i++) {
    const { weekStart, weekEnd } = weekBoundaries(i);

    let hoursLost = 0;
    let hoursGained = 0;

    for (const l of segLeavers) {
      hoursLost += calcLossForWeek(l, weekStart, weekEnd);
    }
    for (const j of segJoiners) {
      hoursGained += calcGainForWeek(j, weekStart, weekEnd);
    }

    hoursLost = round2(hoursLost);
    hoursGained = round2(hoursGained);
    const netChange = round2(hoursGained - hoursLost);
    const coverage = hoursLost === 0 ? (hoursGained > 0 ? 1 : 1) : round2(hoursGained / hoursLost);

    weeks.push({
      weekStart,
      weekEnd,
      label: weekLabel(weekStart),
      hoursLost,
      hoursGained,
      netChange,
      coverage,
      rag: computeRag(hoursLost, hoursGained),
    });
  }

  const totalsLost = round2(weeks.reduce((s, w) => s + w.hoursLost, 0));
  const totalsGained = round2(weeks.reduce((s, w) => s + w.hoursGained, 0));
  const totalsNet = round2(totalsGained - totalsLost);
  const totalsCoverage = totalsLost === 0 ? 1 : round2(totalsGained / totalsLost);

  const totals: OutlookTotals = {
    hoursLost: totalsLost,
    hoursGained: totalsGained,
    netChange: totalsNet,
    coverage: totalsCoverage,
    rag: computeRag(totalsLost, totalsGained),
  };

  return { weeks, totals, computedAt: new Date().toISOString() };
}

export async function getOutlookDetail(branchId: string, weekStart: string): Promise<OutlookDetail> {
  const weekEnd = addDays(weekStart, 6);

  const allLeavers = await getLeavers(branchId);
  const allJoinersRaw = await getJoiners(branchId);
  const allJoiners = allJoinersRaw.filter(j => j.status === 'active');

  const affectedLeavers = allLeavers.filter(l => {
    const loss = calcLossForWeek(l, weekStart, weekEnd);
    return loss > 0;
  });

  const affectedJoiners = allJoiners.filter(j => {
    const gain = calcGainForWeek(j, weekStart, weekEnd);
    return gain > 0;
  });

  return { leavers: affectedLeavers, joiners: affectedJoiners };
}

// ── Monthly snapshot helpers ──────────────────────────────────────────────────

function monthBounds(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  return { start, end };
}

export async function getMonthlySnapshots(branchId: string): Promise<MonthlySnapshot[]> {
  return db
    .select()
    .from(monthlyCapacitySnapshots)
    .where(eq(monthlyCapacitySnapshots.branchId, branchId))
    .orderBy(desc(monthlyCapacitySnapshots.year), desc(monthlyCapacitySnapshots.month))
    .limit(12);
}

export async function getCurrentMonthLive(branchId: string): Promise<{
  hoursIn: number; headsIn: number; hoursOut: number; headsOut: number;
}> {
  const now = new Date();
  const todayStr = isoDate(now);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const { start, end } = monthBounds(year, month);

  const hiredJoiners = await db
    .select()
    .from(joiners)
    .where(and(
      eq(joiners.branchId, branchId),
      eq(joiners.status, 'hired'),
    ));

  const hiredThisMonth = hiredJoiners.filter(j =>
    j.hiredAt && j.hiredAt >= start && j.hiredAt < end,
  );
  const hoursIn = round2(hiredThisMonth.reduce((s, j) => s + (j.desiredWeeklyHours ?? 0), 0));
  const headsIn = hiredThisMonth.length;

  const allLeavers = await getLeavers(branchId, false);
  // Running total: only count active leavers whose last working day has actually passed (≤ today)
  const leaversThisMonth = allLeavers.filter(l =>
    l.lastWorkingDay >= start && l.lastWorkingDay < end && l.lastWorkingDay <= todayStr,
  );
  const hoursOut = round2(leaversThisMonth.reduce((s, l) => s + (l.weeklyHours ?? 0), 0));
  const headsOut = leaversThisMonth.length;

  return { hoursIn, headsIn, hoursOut, headsOut };
}

export interface CumulativeKpiResult {
  cumulativeHoursLost: number;
  cumulativeHoursHired: number;
  pipelineWeightedHours: number;
  pipelineRawHours: number;
  coverage: number;
  net: number;
  rag: OutlookRag;
  computedAt: string;
  terminatedYtd: number;
  hiredYtd: number;
}

export async function computeCumulativeKpi(branchId: string): Promise<CumulativeKpiResult> {
  // Closed months: query ALL snapshots (no row cap) — authoritative source that
  // reflects any manual edits made via Monthly View.
  const allSnapshots = await db
    .select()
    .from(monthlyCapacitySnapshots)
    .where(eq(monthlyCapacitySnapshots.branchId, branchId))
    .orderBy(desc(monthlyCapacitySnapshots.year), desc(monthlyCapacitySnapshots.month));
  const closedHoursOut = round2(allSnapshots.reduce((s, sn) => s + sn.hoursOut, 0));
  const closedHoursIn = round2(allSnapshots.reduce((s, sn) => s + sn.hoursIn, 0));

  // Current live month (active leavers already gone + confirmed hires this month)
  const live = await getCurrentMonthLive(branchId);

  // Active pipeline (not yet hired) — weighted by confidence probability
  const allJoiners = await getJoiners(branchId, false, true);
  const activePipeline = allJoiners.filter(j => j.status === 'active');
  const pipelineWeightedHours = round2(activePipeline.reduce((s, j) => s + (j.desiredWeeklyHours ?? 0) * (j.confidenceWeight ?? 0), 0));
  const pipelineRawHours = round2(activePipeline.reduce((s, j) => s + (j.desiredWeeklyHours ?? 0), 0));

  const cumulativeHoursLost = round2(closedHoursOut + live.hoursOut);
  const cumulativeHoursHired = round2(closedHoursIn + live.hoursIn);
  const net = round2(cumulativeHoursHired + pipelineWeightedHours - cumulativeHoursLost);
  const coverage = cumulativeHoursLost === 0 ? 1 : round2((cumulativeHoursHired + pipelineWeightedHours) / cumulativeHoursLost);
  const rag = computeRag(cumulativeHoursLost, cumulativeHoursHired + pipelineWeightedHours);

  // Year-to-date counts
  const currentYear = new Date().getUTCFullYear();
  const ytdStart = `${currentYear}-01-01`;
  const ytdEnd = `${currentYear + 1}-01-01`;

  const allLeaversRaw = await getLeavers(branchId, true);
  const terminatedYtd = allLeaversRaw.filter(l =>
    l.lastWorkingDay >= ytdStart && l.lastWorkingDay < ytdEnd,
  ).length;

  const hiredYtd = allJoiners.filter(j =>
    (j.status === 'hired' || j.status === 'hired_archived') &&
    j.hiredAt && j.hiredAt >= ytdStart && j.hiredAt < ytdEnd,
  ).length;

  return {
    cumulativeHoursLost,
    cumulativeHoursHired,
    pipelineWeightedHours,
    pipelineRawHours,
    coverage,
    net,
    rag,
    computedAt: new Date().toISOString(),
    terminatedYtd,
    hiredYtd,
  };
}

export async function closeMonth(
  branchId: string,
  year: number,
  month: number,
): Promise<MonthlySnapshot> {
  const { start, end } = monthBounds(year, month);

  // Include hired_archived so re-closing the same month stays idempotent:
  // records already archived on first close are still counted for In totals.
  const hiredJoiners = await db
    .select()
    .from(joiners)
    .where(and(
      eq(joiners.branchId, branchId),
      inArray(joiners.status, ['hired', 'hired_archived']),
    ));
  const hiredThisMonth = hiredJoiners.filter(j =>
    j.hiredAt && j.hiredAt >= start && j.hiredAt < end,
  );
  const hoursIn = round2(hiredThisMonth.reduce((s, j) => s + (j.desiredWeeklyHours ?? 0), 0));
  const headsIn = hiredThisMonth.length;

  const allLeavers = await getLeavers(branchId, true);
  const leaversThisMonth = allLeavers.filter(l =>
    l.lastWorkingDay >= start && l.lastWorkingDay < end,
  );
  const hoursOut = round2(leaversThisMonth.reduce((s, l) => s + (l.weeklyHours ?? 0), 0));
  const headsOut = leaversThisMonth.length;

  const existing = await db
    .select()
    .from(monthlyCapacitySnapshots)
    .where(and(
      eq(monthlyCapacitySnapshots.branchId, branchId),
      eq(monthlyCapacitySnapshots.year, year),
      eq(monthlyCapacitySnapshots.month, month),
    ));

  let snapshot: MonthlySnapshot;
  if (existing.length > 0) {
    const [row] = await db
      .update(monthlyCapacitySnapshots)
      .set({ hoursIn, headsIn, hoursOut, headsOut, snapshotCreatedAt: new Date() })
      .where(and(
        eq(monthlyCapacitySnapshots.branchId, branchId),
        eq(monthlyCapacitySnapshots.year, year),
        eq(monthlyCapacitySnapshots.month, month),
      ))
      .returning();
    snapshot = row;
  } else {
    const [row] = await db
      .insert(monthlyCapacitySnapshots)
      .values({ branchId, year, month, hoursIn, headsIn, hoursOut, headsOut })
      .returning();
    snapshot = row;
  }

  // Archive hired joiners from this month
  const idsToArchive = hiredThisMonth.map(j => j.id);
  if (idsToArchive.length > 0) {
    await db
      .update(joiners)
      .set({ status: 'hired_archived', updatedAt: new Date() })
      .where(inArray(joiners.id, idsToArchive));
  }

  // Archive leavers whose last working day falls within the closed month.
  // For the current (not-yet-ended) month, only archive leavers whose
  // termination day has actually passed (≤ today) — never pre-archive
  // staff who are still on notice.
  const nowStr = isoDate(new Date());
  const isCurrentMonth = year === new Date().getUTCFullYear() && month === (new Date().getUTCMonth() + 1);
  const activeLeaversForBranch = await db
    .select()
    .from(leavers)
    .where(and(eq(leavers.branchId, branchId), eq(leavers.status, 'active')));
  const leaverIdsToProcess = activeLeaversForBranch
    .filter(l => {
      const lwd = l.lastWorkingDay;
      if (!(lwd >= start && lwd < end)) return false;
      if (isCurrentMonth && lwd > nowStr) return false; // still on notice
      return true;
    })
    .map(l => l.id);
  if (leaverIdsToProcess.length > 0) {
    await db
      .update(leavers)
      .set({ status: 'processed', updatedAt: new Date() })
      .where(inArray(leavers.id, leaverIdsToProcess));
  }

  return snapshot;
}

export async function updateMonthlySnapshot(
  branchId: string,
  year: number,
  month: number,
  data: { hoursIn: number; headsIn: number; hoursOut: number; headsOut: number },
): Promise<MonthlySnapshot> {
  const [row] = await db
    .insert(monthlyCapacitySnapshots)
    .values({ branchId, year, month, ...data, snapshotCreatedAt: new Date() })
    .onConflictDoUpdate({
      target: [
        monthlyCapacitySnapshots.branchId,
        monthlyCapacitySnapshots.year,
        monthlyCapacitySnapshots.month,
      ],
      set: { ...data, snapshotCreatedAt: new Date() },
    })
    .returning();
  return row;
}

export async function deleteMonthlySnapshot(
  branchId: string,
  year: number,
  month: number,
): Promise<boolean> {
  const result = await db
    .delete(monthlyCapacitySnapshots)
    .where(and(
      eq(monthlyCapacitySnapshots.branchId, branchId),
      eq(monthlyCapacitySnapshots.year, year),
      eq(monthlyCapacitySnapshots.month, month),
    ));
  return (result.rowCount ?? 0) > 0;
}

export async function autoCloseForAllBranches(): Promise<void> {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;

  const allBranches = await db.select({ id: branches.id }).from(branches);

  for (const branch of allBranches) {
    const existing = await db
      .select()
      .from(monthlyCapacitySnapshots)
      .where(and(
        eq(monthlyCapacitySnapshots.branchId, branch.id),
        eq(monthlyCapacitySnapshots.year, prevYear),
        eq(monthlyCapacitySnapshots.month, prevMonth),
      ));
    if (existing.length === 0) {
      try {
        await closeMonth(branch.id, prevYear, prevMonth);
      } catch {
        // non-fatal per-branch
      }
    }
  }
}
