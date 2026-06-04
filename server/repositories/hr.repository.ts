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

export async function getEmployeeHistory(branchId: string, employeeKey: string): Promise<HrCalendar[]> {
  return db
    .select()
    .from(employeeHrCalendar)
    .where(
      and(
        eq(employeeHrCalendar.branchId, branchId),
        eq(employeeHrCalendar.employeeKey, employeeKey),
      ),
    )
    .orderBy(desc(employeeHrCalendar.date))
    .limit(50);
}
