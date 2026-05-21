import { db } from '../infrastructure/db';
import { leavers, joiners } from '@shared/schema';
import type {
  Leaver, InsertLeaver, Joiner, InsertJoiner,
  OutlookWeek, OutlookTotals, OutlookResponse, OutlookDetail, OutlookRag,
} from '@shared/schema';
import { eq, and, lte, gte, or } from 'drizzle-orm';

// ── Confidence weights by stage ───────────────────────────────────────────────

export function getConfidenceWeight(stage: string): number {
  switch (stage) {
    case 'Confirmed start':
    case 'Started': return 0.75;
    case 'Training booked': return 0.70;
    case 'Pre-employment checks':
    case 'Offer': return 0.60;
    case 'Interview':
    case 'Pipeline': return 0.50;
    case 'Dropped': return 0;
    default: return 0.50;
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
  const dow = now.getUTCDay(); // 0=Sun
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
  // Partial week: they work from weekStart up to and including lwd, then gone
  const daysWorked = diffDays(weekStart, lwd) + 1;
  return (leaver.weeklyHours ?? 0) * Math.max(0, 7 - daysWorked) / 7;
}

function calcGainForWeek(joiner: Joiner, weekStart: string, weekEnd: string): number {
  const esd = joiner.expectedStartDate;
  if (esd > weekEnd) return 0;
  const weight = joiner.confidenceWeight ?? 0;
  const hours = joiner.desiredWeeklyHours ?? 0;
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

export async function getJoiners(branchId: string, includeDropped = false): Promise<Joiner[]> {
  const baseWhere = eq(joiners.branchId, branchId);
  if (includeDropped) {
    return db.select().from(joiners).where(baseWhere).orderBy(joiners.expectedStartDate);
  }
  return db
    .select()
    .from(joiners)
    .where(and(baseWhere, eq(joiners.status, 'active')))
    .orderBy(joiners.expectedStartDate);
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

export async function createJoiner(data: InsertJoiner & { confidenceWeight: number }): Promise<Joiner> {
  const [row] = await db
    .insert(joiners)
    .values({ ...data, updatedAt: new Date() })
    .returning();
  return row;
}

export async function updateJoiner(
  id: string,
  branchId: string,
  data: Partial<InsertJoiner & { confidenceWeight: number }>,
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
  const allJoiners = await getJoiners(branchId);

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
  const allJoiners = await getJoiners(branchId);

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
