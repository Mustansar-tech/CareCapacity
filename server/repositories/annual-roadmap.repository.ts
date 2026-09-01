import { db } from '../infrastructure/db';
import { annualRoadmapEntries, annualRoadmapAssumptions } from '@shared/schema';
import type {
  AnnualRoadmapEntry,
  InsertAnnualRoadmapEntry,
  AnnualRoadmapAssumption,
  InsertAnnualRoadmapAssumption,
} from '@shared/schema';
import { and, asc, eq } from 'drizzle-orm';
import { KPI_STORE_ORDER } from './kpi.repository';

// Same 10 offices as the KPI Tracker, plus the group total row — this is the
// canonical office list/order for the Annual Roadmap tab.
export const ROADMAP_OFFICE_ORDER = [...KPI_STORE_ORDER, 'SUR Group Total'];

/** Every year that has at least one stored entry, most recent first. */
export async function getRoadmapYears(): Promise<number[]> {
  const rows = await db
    .select({ year: annualRoadmapEntries.year })
    .from(annualRoadmapEntries);
  const years = Array.from(new Set(rows.map(r => r.year))).sort((a, b) => b - a);
  return years;
}

/** All entries for one year, in canonical office order then month order. */
export async function getRoadmapEntriesForYear(year: number): Promise<AnnualRoadmapEntry[]> {
  const rows = await db
    .select()
    .from(annualRoadmapEntries)
    .where(eq(annualRoadmapEntries.year, year));

  return rows.sort((a, b) => {
    const ai = ROADMAP_OFFICE_ORDER.indexOf(a.office);
    const bi = ROADMAP_OFFICE_ORDER.indexOf(b.office);
    if (ai !== bi) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return a.month - b.month;
  });
}

export async function upsertRoadmapEntry(entry: InsertAnnualRoadmapEntry): Promise<AnnualRoadmapEntry> {
  const [result] = await db
    .insert(annualRoadmapEntries)
    .values(entry)
    .onConflictDoUpdate({
      target: [annualRoadmapEntries.year, annualRoadmapEntries.office, annualRoadmapEntries.month],
      set: {
        projectedRevenue: entry.projectedRevenue,
        actualRevenue: entry.actualRevenue,
        dayRateTarget: entry.dayRateTarget,
        clientHoursTarget: entry.clientHoursTarget,
        careProHoursTarget: entry.careProHoursTarget,
        monthlyGrowthTarget: entry.monthlyGrowthTarget,
        enquiriesRequired: entry.enquiriesRequired,
        clientsRequired: entry.clientsRequired,
        careProApplicationsRequired: entry.careProApplicationsRequired,
        careProsRequiredHeads: entry.careProsRequiredHeads,
        newCareProHoursRequired: entry.newCareProHoursRequired,
        netCareProHoursRequired: entry.netCareProHoursRequired,
        updatedAt: new Date(),
      },
    })
    .returning();
  return result;
}

/** One office/month's entry for a given year, if any — used to prefill KPI Tracker targets. */
export async function getRoadmapEntry(year: number, office: string, month: number): Promise<AnnualRoadmapEntry | null> {
  const [row] = await db
    .select()
    .from(annualRoadmapEntries)
    .where(and(
      eq(annualRoadmapEntries.year, year),
      eq(annualRoadmapEntries.office, office),
      eq(annualRoadmapEntries.month, month),
    ));
  return row ?? null;
}

export async function getRoadmapAssumptions(year: number): Promise<AnnualRoadmapAssumption[]> {
  const rows = await db
    .select()
    .from(annualRoadmapAssumptions)
    .where(eq(annualRoadmapAssumptions.year, year))
    .orderBy(asc(annualRoadmapAssumptions.displayOrder));
  return rows;
}

export async function replaceRoadmapAssumptions(year: number, assumptions: InsertAnnualRoadmapAssumption[]): Promise<AnnualRoadmapAssumption[]> {
  return db.transaction(async (tx) => {
    await tx.delete(annualRoadmapAssumptions).where(eq(annualRoadmapAssumptions.year, year));
    if (assumptions.length === 0) return [];
    return tx.insert(annualRoadmapAssumptions).values(assumptions).returning();
  });
}
