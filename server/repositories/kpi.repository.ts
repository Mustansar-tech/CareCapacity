import { db } from '../infrastructure/db';
import { kpiWeeklyEntries } from '@shared/schema';
import type { KpiWeeklyEntry, InsertKpiWeeklyEntry } from '@shared/schema';
import { and, asc, desc, eq } from 'drizzle-orm';

/**
 * Canonical store order for the KPI Tracker tab — mirrors the row order in the
 * original "Weekly Data" sheet. Kept independent of day_rate_franchises'
 * displayOrder since this is a distinct, simpler per-office breakdown (no
 * Live-In Care split).
 */
export const KPI_STORE_ORDER = [
  'Glasgow North',
  'Glasgow South',
  'Stirling',
  'South Ayrshire',
  'Perthshire',
  'North Lanarkshire',
  'Aberdeen',
  'East Lothian',
  'Scottish Borders',
  'West Fife',
];

export interface KpiWeekSummary {
  weekBeginning: string;
  weekNumber: number;
  qtrNumber: number;
  daysInMonth: number;
}

/** Every week that has at least one stored row, most recent first. */
export async function getKpiWeeks(): Promise<KpiWeekSummary[]> {
  const rows = await db
    .select({
      weekBeginning: kpiWeeklyEntries.weekBeginning,
      weekNumber: kpiWeeklyEntries.weekNumber,
      qtrNumber: kpiWeeklyEntries.qtrNumber,
      daysInMonth: kpiWeeklyEntries.daysInMonth,
    })
    .from(kpiWeeklyEntries)
    .orderBy(desc(kpiWeeklyEntries.weekBeginning));

  const seen = new Set<string>();
  const weeks: KpiWeekSummary[] = [];
  for (const r of rows) {
    if (seen.has(r.weekBeginning)) continue;
    seen.add(r.weekBeginning);
    weeks.push(r);
  }
  return weeks;
}

/** All store rows for one week, in canonical store order. */
export async function getKpiWeekEntries(weekBeginning: string): Promise<KpiWeeklyEntry[]> {
  const rows = await db
    .select()
    .from(kpiWeeklyEntries)
    .where(eq(kpiWeeklyEntries.weekBeginning, weekBeginning));

  return rows.sort((a, b) => {
    const ai = KPI_STORE_ORDER.indexOf(a.store);
    const bi = KPI_STORE_ORDER.indexOf(b.store);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

export async function upsertKpiWeeklyEntry(entry: InsertKpiWeeklyEntry): Promise<KpiWeeklyEntry> {
  const [result] = await db
    .insert(kpiWeeklyEntries)
    .values(entry)
    .onConflictDoUpdate({
      target: [kpiWeeklyEntries.weekBeginning, kpiWeeklyEntries.store],
      set: {
        weekNumber: entry.weekNumber,
        qtrNumber: entry.qtrNumber,
        groupName: entry.groupName,
        daysInMonth: entry.daysInMonth,
        monthlyRevenue: entry.monthlyRevenue,
        monthlyRevenueTarget: entry.monthlyRevenueTarget,
        enquiries: entry.enquiries,
        enquiriesTarget: entry.enquiriesTarget,
        newClients: entry.newClients,
        applications: entry.applications,
        newHiresHeads: entry.newHiresHeads,
        newHiresHours: entry.newHiresHours,
        guaranteedHourWastageLastWeek: entry.guaranteedHourWastageLastWeek,
        guaranteedHourWastageWeekAhead: entry.guaranteedHourWastageWeekAhead,
        absenceHoursLastWeek: entry.absenceHoursLastWeek,
        hospitalisationsHeads: entry.hospitalisationsHeads,
        hospitalisationsHours: entry.hospitalisationsHours,
        clientHoursAtRisk: entry.clientHoursAtRisk,
        updatedAt: new Date(),
      },
    })
    .returning();
  return result;
}

export async function deleteKpiWeek(weekBeginning: string): Promise<number> {
  const result = await db.delete(kpiWeeklyEntries).where(eq(kpiWeeklyEntries.weekBeginning, weekBeginning));
  return result.rowCount ?? 0;
}
