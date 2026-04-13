// cancelled-visits-from-gh.ts
import * as XLSX from '../../shared/xlsx-compat.js';
import { addMinutes, startOfDay, endOfDay, format as fmt } from 'date-fns';

// Columns seen in your GH export
const CANCEL_COL = 'Cancellation Description';
const START_COLS = [
  'Service Requirement Start Date And Time',
  'Planned Start Date And Time',
  'Actual Start Date And Time',
];
const DUR_COLS = [
  'Service Requirement Duration',     // hours
  'Actual Duration',                   // hours
  'Template Duration (Minutes)',      // minutes
];
const STAFF_COLS = [
  'Planned Employee Name',
  'Template Employee Name',
  'Actual Employee Name',
];

// same normalization you use elsewhere (safe local copy)
function normalizeName(name: string): string {
  if (!name) return '';
  let s = String(name).toLowerCase();
  s = s.replace(/\(.*?\)/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.split(' ').filter(Boolean).sort().join(' ');
}
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

/**
 * Read the GH workbook BUFFER and output Map<normalizedStaff, "10:30–11:30; ..."> for the specific date
 * This does NOT rely on (or modify) your filtered rows.
 */
export async function extractCancelledWindowsFromGHWorkbook(
  ghWorkbookBuffer: Buffer,
  specificDate: Date,
  minMinutes = 60
): Promise<Map<string, string>> {
  const wb = await XLSX.read(ghWorkbookBuffer, { type: 'buffer' });
  const sheetName = wb.SheetNames.includes('Data') ? 'Data' : wb.SheetNames[0];

  const rows2d = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName], { header: 1, raw: true, blankrows: false }) as any[][];
  let headerIdx = rows2d.findIndex(r => {
    const low = r.map(v => String(v ?? '').toLowerCase());
    return low.some(s => s.includes('cancellation description')) && low.some(s => s.includes('start date'));
  });
  if (headerIdx < 0) headerIdx = 0;

  const headers = rows2d[headerIdx].map(v => String(v ?? '').trim());
  const data = rows2d.slice(headerIdx + 1).map(r => {
    const o: Record<string, any> = {};
    headers.forEach((h, i) => (o[h] = r[i]));
    return o;
  });

  const dayStart = startOfDay(specificDate);
  const dayEnd = endOfDay(specificDate);

  const tmp = new Map<string, string[]>();

  for (const row of data) {
    const status = String(row[CANCEL_COL] ?? '').toLowerCase();
    if (!status.includes('cancel')) continue;

    const startRaw = START_COLS.map(c => row[c]).find(v => v != null && v !== '');
    const start = toDate(startRaw);
    if (!start || start < dayStart || start > dayEnd) continue;

    // duration (hours -> minutes) or (already minutes)
    let minutes = NaN;
    for (const c of DUR_COLS) {
      const val = Number(row[c]);
      if (!isFinite(val)) continue;
      minutes = c.toLowerCase().includes('minute') ? Math.round(val) : Math.round(val * 60);
      break;
    }
    if (!isFinite(minutes) || minutes < minMinutes) continue;

    const staffRaw = STAFF_COLS.map(c => row[c]).find(v => v && String(v).trim() !== '');
    if (!staffRaw) continue;

    const end = addMinutes(start, minutes);
    const label = `${fmt(start, 'HH:mm')}–${fmt(end, 'HH:mm')}`;

    const key = normalizeName(String(staffRaw));
    (tmp.get(key) ?? tmp.set(key, []).get(key)!).push(label);
  }

  const out = new Map<string, string>();
  tmp.forEach((arr, k) => out.set(k, arr.sort().join('; ')));
  return out;
}