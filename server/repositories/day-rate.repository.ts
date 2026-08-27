import { db } from '../infrastructure/db';
import { dayRateFranchises, dayRateEntries } from '@shared/schema';
import type { DayRateFranchise } from '@shared/schema';
import { asc, eq, inArray, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

export interface DayRateGridEntry {
  revenue: number;
  dayRate: number;
}

export interface DayRateGridFranchise {
  id: string;
  franchiseName: string;
  office: string;
  area: string | null;
  groupName: string;
  isLiveInCare: boolean;
  displayOrder: number;
  entries: Record<string, DayRateGridEntry>; // keyed by date (YYYY-MM-DD)
}

export interface DayRateGrid {
  reportingMonth: string;
  daysInMonth: number;
  dates: string[];
  franchises: DayRateGridFranchise[];
  totals: Record<string, DayRateGridEntry>;
}

/**
 * Upsert one automated Financial Summary reading for a franchise/date/reportingMonth,
 * replacing any prior value for that exact key rather than duplicating —
 * matches the unique_day_rate_entry constraint (franchiseId, date, reportingMonth).
 */
export async function upsertAutomatedEntry(params: {
  franchiseId: string;
  date: string;
  reportingMonth: string;
  daysInMonth: number;
  revenue: number;
}): Promise<void> {
  const dayRate = params.daysInMonth > 0 ? params.revenue / params.daysInMonth : 0;

  await db
    .insert(dayRateEntries)
    .values({
      franchiseId: params.franchiseId,
      date: params.date,
      reportingMonth: params.reportingMonth,
      daysInMonth: params.daysInMonth,
      revenue: params.revenue,
      dayRate,
      source: 'automation',
    })
    .onConflictDoUpdate({
      target: [dayRateEntries.franchiseId, dayRateEntries.date, dayRateEntries.reportingMonth],
      set: {
        daysInMonth: params.daysInMonth,
        revenue: params.revenue,
        dayRate,
        source: 'automation',
        updatedAt: sql`now()`,
      },
    });
}

export async function getFranchiseByName(franchiseName: string): Promise<DayRateFranchise | undefined> {
  const rows = await db
    .select()
    .from(dayRateFranchises)
    .where(eq(dayRateFranchises.franchiseName, franchiseName))
    .limit(1);
  return rows[0];
}

export async function getReportingMonths(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ reportingMonth: dayRateEntries.reportingMonth })
    .from(dayRateEntries)
    .orderBy(asc(dayRateEntries.reportingMonth));
  return rows.map(r => r.reportingMonth);
}

export async function getAllFranchises(): Promise<DayRateFranchise[]> {
  return db.select().from(dayRateFranchises).orderBy(asc(dayRateFranchises.displayOrder));
}

export async function getDayRateGrid(reportingMonth: string): Promise<DayRateGrid> {
  const franchises = await db
    .select()
    .from(dayRateFranchises)
    .orderBy(asc(dayRateFranchises.displayOrder));

  const entries = await db
    .select()
    .from(dayRateEntries)
    .where(eq(dayRateEntries.reportingMonth, reportingMonth));

  const dateSet = new Set<string>();
  const entriesByFranchise = new Map<string, Record<string, DayRateGridEntry>>();
  const totals: Record<string, { revenue: number; count: number }> = {};
  let daysInMonth = 0;

  for (const entry of entries) {
    dateSet.add(entry.date);
    if (!entriesByFranchise.has(entry.franchiseId)) entriesByFranchise.set(entry.franchiseId, {});
    entriesByFranchise.get(entry.franchiseId)![entry.date] = {
      revenue: entry.revenue,
      dayRate: entry.dayRate,
    };
    if (!totals[entry.date]) totals[entry.date] = { revenue: 0, count: 0 };
    totals[entry.date].revenue += entry.revenue;
    totals[entry.date].count += 1;
    if (entry.daysInMonth > daysInMonth) daysInMonth = entry.daysInMonth;
  }

  const dates = Array.from(dateSet).sort();

  const franchiseIdsWithData = new Set(entriesByFranchise.keys());
  const gridFranchises: DayRateGridFranchise[] = franchises
    .filter(f => franchiseIdsWithData.has(f.id))
    .map(f => ({
      id: f.id,
      franchiseName: f.franchiseName,
      office: f.office,
      area: f.area,
      groupName: f.groupName,
      isLiveInCare: f.isLiveInCare,
      displayOrder: f.displayOrder,
      entries: entriesByFranchise.get(f.id) ?? {},
    }));

  const totalsOut: Record<string, DayRateGridEntry> = {};
  for (const date of dates) {
    const t = totals[date];
    const revenue = t?.revenue ?? 0;
    totalsOut[date] = {
      revenue,
      dayRate: daysInMonth > 0 ? revenue / daysInMonth : 0,
    };
  }

  return {
    reportingMonth,
    daysInMonth,
    dates,
    franchises: gridFranchises,
    totals: totalsOut,
  };
}
