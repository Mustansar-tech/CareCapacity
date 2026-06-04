import { db } from '../infrastructure/db';
import { employeeHrCalendar } from '@shared/schema';
import type { HrCalendar, InsertHrCalendar } from '@shared/schema';
import { and, eq, gte, lte, desc, sql } from 'drizzle-orm';

function monthBounds(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

function dayOffset(dateStr: string, offset: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().split('T')[0];
}

export async function upsertProcessedRecords(records: InsertHrCalendar[]): Promise<void> {
  if (records.length === 0) return;

  const chunks: InsertHrCalendar[][] = [];
  for (let i = 0; i < records.length; i += 100) {
    chunks.push(records.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    await db
      .insert(employeeHrCalendar)
      .values(chunk)
      .onConflictDoUpdate({
        target: [employeeHrCalendar.branchId, employeeHrCalendar.employeeKey, employeeHrCalendar.date],
        set: {
          status: sql`CASE WHEN ${employeeHrCalendar.source} = 'manual' THEN ${employeeHrCalendar.status} ELSE excluded.status END`,
          employeeName: sql`CASE WHEN ${employeeHrCalendar.source} = 'manual' THEN ${employeeHrCalendar.employeeName} ELSE excluded.employee_name END`,
          contractedHours: sql`CASE WHEN ${employeeHrCalendar.source} = 'manual' THEN ${employeeHrCalendar.contractedHours} ELSE excluded.contracted_hours END`,
          transportMode: sql`CASE WHEN ${employeeHrCalendar.source} = 'manual' THEN ${employeeHrCalendar.transportMode} ELSE excluded.transport_mode END`,
          notes: sql`CASE WHEN ${employeeHrCalendar.source} = 'manual' THEN ${employeeHrCalendar.notes} ELSE excluded.notes END`,
          updatedAt: new Date(),
        },
      });
  }
}

export async function getCalendarMonth(branchId: string, year: number, month: number): Promise<HrCalendar[]> {
  const { start, end } = monthBounds(year, month);
  // Include one day before and after for boundary display (leave continuations)
  const queryStart = dayOffset(start, -1);
  const queryEnd = dayOffset(end, 1);
  return db
    .select()
    .from(employeeHrCalendar)
    .where(
      and(
        eq(employeeHrCalendar.branchId, branchId),
        gte(employeeHrCalendar.date, queryStart),
        lte(employeeHrCalendar.date, queryEnd),
      ),
    )
    .orderBy(employeeHrCalendar.employeeName, employeeHrCalendar.date);
}

export async function createManualEntry(data: InsertHrCalendar): Promise<HrCalendar> {
  const [row] = await db
    .insert(employeeHrCalendar)
    .values({ ...data, source: 'manual' })
    .onConflictDoUpdate({
      target: [employeeHrCalendar.branchId, employeeHrCalendar.employeeKey, employeeHrCalendar.date],
      set: {
        status: data.status,
        source: 'manual',
        notes: data.notes ?? null,
        contractedHours: data.contractedHours ?? null,
        transportMode: data.transportMode ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function updateManualEntry(
  id: string,
  branchId: string,
  data: Partial<Pick<InsertHrCalendar, 'status' | 'notes' | 'employeeName'>>,
): Promise<HrCalendar | null> {
  const [row] = await db
    .update(employeeHrCalendar)
    .set({ ...data, updatedAt: new Date() })
    .where(
      and(
        eq(employeeHrCalendar.id, id),
        eq(employeeHrCalendar.branchId, branchId),
        eq(employeeHrCalendar.source, 'manual'),
      ),
    )
    .returning();
  return row ?? null;
}

export async function deleteManualEntry(id: string, branchId: string): Promise<boolean> {
  const result = await db
    .delete(employeeHrCalendar)
    .where(
      and(
        eq(employeeHrCalendar.id, id),
        eq(employeeHrCalendar.branchId, branchId),
        eq(employeeHrCalendar.source, 'manual'),
      ),
    );
  return (result.rowCount ?? 0) > 0;
}

export async function createBulkManualEntries(records: InsertHrCalendar[]): Promise<number> {
  if (records.length === 0) return 0;
  const toInsert = records.map(r => ({ ...r, source: 'manual' as const }));
  const chunks: InsertHrCalendar[][] = [];
  for (let i = 0; i < toInsert.length; i += 100) {
    chunks.push(toInsert.slice(i, i + 100));
  }
  let total = 0;
  for (const chunk of chunks) {
    const result = await db
      .insert(employeeHrCalendar)
      .values(chunk)
      .onConflictDoUpdate({
        target: [employeeHrCalendar.branchId, employeeHrCalendar.employeeKey, employeeHrCalendar.date],
        set: {
          status: sql`excluded.status`,
          source: 'manual',
          notes: sql`excluded.notes`,
          updatedAt: new Date(),
        },
      });
    total += result.rowCount ?? 0;
  }
  return total;
}

// ─── Shared helper ─────────────────────────────────────────────────────────────
// Called from both process.controller.ts and automation-routes.ts so every
// pipeline path (manual upload + PP automation single/multi-week) writes HR data.
export async function syncHrCalendarFromResult(
  branchId: string,
  result: {
    dailySummary?: Array<{ date: string }>;
    employeesByDate?: Record<string, Array<{
      employeeName: string;
      status: string;
      notes?: string | null;
      contractedDailyHours?: number | null;
    }>>;
    employeeSummaryByDate?: Record<string, Array<{ employeeName: string; transportMode?: string }>>;
    employeeLocations?: Array<{ employeeName: string; transportMode?: string }>;
  },
): Promise<void> {
  const weekDates = result.dailySummary?.map(d => d.date) ?? [];
  if (weekDates.length === 0 || !result.employeesByDate) return;

  const transportModeByName = new Map<string, string>();
  for (const loc of result.employeeLocations ?? []) {
    if (loc.transportMode) transportModeByName.set(loc.employeeName.toLowerCase(), loc.transportMode);
  }
  for (const summaries of Object.values(result.employeeSummaryByDate ?? {})) {
    for (const s of summaries) {
      if (s.transportMode) transportModeByName.set(s.employeeName.toLowerCase(), s.transportMode);
    }
  }

  const hrRows: InsertHrCalendar[] = [];
  for (const [date, employees] of Object.entries(result.employeesByDate)) {
    if (!weekDates.includes(date)) continue;
    for (const emp of employees) {
      const key = emp.employeeName
        .toLowerCase()
        .replace(/\b(mr|mrs|ms|miss|dr|prof)\b\.?\s*/gi, '')
        .trim()
        .split(/\s+/)
        .sort()
        .join(' ');
      hrRows.push({
        branchId,
        employeeKey: key,
        employeeName: emp.employeeName,
        date,
        status: emp.status,
        source: 'processed',
        notes: emp.notes || null,
        contractedHours: emp.contractedDailyHours ?? null,
        transportMode: transportModeByName.get(emp.employeeName.toLowerCase()) ?? null,
      });
    }
  }
  if (hrRows.length > 0) await upsertProcessedRecords(hrRows);
}

const SICK_STATUSES = ['Sick', 'Long-term Sick', 'Partial Sick', 'AWOL'];

export async function getEmployeeSummary(
  branchId: string,
  employeeKey: string,
  year: number,
  month: number,
): Promise<{
  ytdManualDays: number;
  sickByMonth: Array<{ year: number; month: number; days: number }>;
  contractedHours: number | null;
  transportMode: string | null;
}> {
  // Compute 6-month window: the 6 months ending with the viewed month
  const windowStart = (() => {
    const d = new Date(Date.UTC(year, month - 6, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  })();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const [windowRows, ytdCount, processedRows] = await Promise.all([
    // Rows in the 6-month sick window
    db.select({ date: employeeHrCalendar.date, status: employeeHrCalendar.status })
      .from(employeeHrCalendar)
      .where(and(
        eq(employeeHrCalendar.branchId, branchId),
        eq(employeeHrCalendar.employeeKey, employeeKey),
        gte(employeeHrCalendar.date, windowStart),
      )),
    // Count of manual entries this year
    db.select({ count: sql<number>`cast(count(*) as int)` })
      .from(employeeHrCalendar)
      .where(and(
        eq(employeeHrCalendar.branchId, branchId),
        eq(employeeHrCalendar.employeeKey, employeeKey),
        eq(employeeHrCalendar.source, 'manual'),
        gte(employeeHrCalendar.date, yearStart),
        lte(employeeHrCalendar.date, yearEnd),
      )),
    // Latest processed records for contractedHours / transportMode
    db.select({ date: employeeHrCalendar.date, contractedHours: employeeHrCalendar.contractedHours, transportMode: employeeHrCalendar.transportMode })
      .from(employeeHrCalendar)
      .where(and(
        eq(employeeHrCalendar.branchId, branchId),
        eq(employeeHrCalendar.employeeKey, employeeKey),
        eq(employeeHrCalendar.source, 'processed'),
      ))
      .orderBy(desc(employeeHrCalendar.date))
      .limit(30),
  ]);

  // Build 6-month sick-by-month array
  const sickByMonth: Array<{ year: number; month: number; days: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const prefix = `${y}-${String(m).padStart(2, '0')}-`;
    const days = windowRows.filter(r => r.date.startsWith(prefix) && SICK_STATUSES.includes(r.status)).length;
    sickByMonth.push({ year: y, month: m, days });
  }

  const contractedHours = processedRows.find(r => r.contractedHours != null)?.contractedHours ?? null;
  const transportMode = processedRows.find(r => r.transportMode != null)?.transportMode ?? null;

  return {
    ytdManualDays: ytdCount[0]?.count ?? 0,
    sickByMonth,
    contractedHours,
    transportMode,
  };
}

export async function getEmployeeHistory(
  branchId: string,
  employeeKey: string,
  offset = 0,
  limit = 50,
): Promise<{ records: HrCalendar[]; total: number }> {
  const [records, countResult] = await Promise.all([
    db
      .select()
      .from(employeeHrCalendar)
      .where(
        and(
          eq(employeeHrCalendar.branchId, branchId),
          eq(employeeHrCalendar.employeeKey, employeeKey),
        ),
      )
      .orderBy(desc(employeeHrCalendar.date))
      .offset(offset)
      .limit(limit),
    db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(employeeHrCalendar)
      .where(
        and(
          eq(employeeHrCalendar.branchId, branchId),
          eq(employeeHrCalendar.employeeKey, employeeKey),
        ),
      ),
  ]);
  return { records, total: countResult[0]?.count ?? 0 };
}
