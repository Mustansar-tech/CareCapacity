/**
 * Cancelled Visits Extraction Utility
 * 
 * Extracts cancelled visit time windows from Care Pro Guaranteed Hours data
 * Based on the provided specification for processing cancelled visits.
 */

import { addMinutes, startOfWeek, endOfWeek } from 'date-fns';
import { GuaranteedHoursRow } from '@shared/schema';

const HEADERS = {
  cancel: 'Cancellation Description',
  start: 'Service Requirement Start Date And Time',
  end: 'Service Requirement End Date And Time',
  staff: ['Planned Employee Name', 'Template Employee Name', 'Actual Employee Name'],
};

function toDate(v: any): Date | undefined {
  if (v instanceof Date && !isNaN(+v)) return v;
  if (typeof v === 'number') {
    // Handle Excel serial date numbers
    const baseDate = new Date(1900, 0, 1); // Excel epoch (Jan 1, 1900)
    const days = v - 2; // Excel date serial number adjustment (-2 for 1900 leap year bug)
    return new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
  }
  const t = new Date(String(v));
  return isNaN(+t) ? undefined : t;
}

// Use the same normalization logic as the pipeline to ensure consistency
function normalizeName(name: string): string {
  if (!name || name === 'undefined' || name === 'null') return '';
  let s = String(name).toLowerCase();
  s = s.replace(/\(.*?\)/g, ''); // remove parentheses content
  s = s.replace(/[^a-z\s]/g, ' '); // keep letters and spaces
  s = s.replace(/\b(mr|mrs|miss|ms|dr)\b/g, ' '); // remove titles
  s = s.replace(/\s+/g, ' ').trim();
  return s
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ');
}

export function extractCancelledWindows(
  guaranteed: GuaranteedHoursRow[],
  selectedDate: Date,
  minMinutes = 60
): Map<string, string> {
  const wkStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const wkEnd = endOfWeek(selectedDate, { weekStartsOn: 1 });

  const tmp = new Map<string, string[]>();

  for (const r of guaranteed) {
    const status = String(r[HEADERS.cancel as keyof GuaranteedHoursRow] ?? '').toLowerCase();
    if (!status.includes('cancel')) continue;

    const startTime = toDate(r[HEADERS.start as keyof GuaranteedHoursRow]);
    const endTime = toDate(r[HEADERS.end as keyof GuaranteedHoursRow]);
    
    if (!startTime || !endTime || endTime <= startTime) continue;

    // Compute duration from start and end times
    const minutes = Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60));
    if (minutes < minMinutes || startTime < wkStart || startTime > wkEnd) continue;

    // Find staff name from available fields
    const staff = HEADERS.staff
      .map(k => r[k as keyof GuaranteedHoursRow])
      .find(v => v && String(v).trim() !== '');
    
    if (!staff) continue;
    const label = `${fmt(startTime, 'EEE dd MMM')} • ${fmt(startTime, 'HH:mm')}–${fmt(endTime, 'HH:mm')}`;
    const key = normalizeName(String(staff));
    
    if (!tmp.has(key)) tmp.set(key, []);
    tmp.get(key)!.push(label);
  }

  const out = new Map<string, string>();
  for (const [k, arr] of Array.from(tmp.entries())) {
    out.set(k, arr.sort().join('; '));
  }
  
  return out;
}

// Attach cancelled visits to employee summary rows
export function attachCancelledVisits(
  summaryRows: Array<{ employeeName: string; [k: string]: any }>,
  windowsByStaff: Map<string, string>,
  colKey = 'cancelledVisits'
): void {
  for (const row of summaryRows) {
    const normalizedName = normalizeName(row.employeeName);
    row[colKey] = windowsByStaff.get(normalizedName) ?? '—';
  }
}