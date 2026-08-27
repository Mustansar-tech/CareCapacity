// One-off historical seed for the Day Rate Tracker (Business Intelligence Hub).
//
// Reads the user's "SUR Group Day Rate Tracker" workbook and loads every real
// per-franchise, per-date Revenue/Day Rate row into day_rate_franchises /
// day_rate_entries. Deliberately skips the leftover "difference from previous
// day" / area-rollup rows that sit below the real data in each sheet — those
// are broken formulas left over in the source workbook, not real data.
//
// The workbook uses two header conventions across its history:
//   Convention A (older sheets, e.g. "March 2025 Data"): row 1 has headers
//     like "Revenue 03/03/2025" / "Day Rate 03/03/2025"; data starts row 2.
//     Each sheet tracks exactly one reporting month (its own).
//   Convention B (newer sheets, e.g. "August 2026 Data" / "September 2026
//     Data"): row 1 holds real Date values (duplicated across a Revenue/Day
//     Rate column pair), row 2 has "Revenue"/"Day Rate" sub-headers, data
//     starts row 3. A footer cell labelled "Reporting Month" (with a
//     "Current Month" or "Start of month" neighbour) states which reporting
//     month this sheet's dates are filed under — this is how the same
//     calendar dates get tracked twice, once per reporting month.
//
// Run with: npx tsx scripts/seed-day-rate-tracker.ts <path-to-workbook.xlsx>

import ExcelJS from 'exceljs';
import pkg from 'pg';
const { Client } = pkg;

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

// Sheets processed first establish the canonical franchise display order.
const CANONICAL_ORDER_SHEETS = ['September 2026 Data', 'August 2026 Data'];

interface FranchiseRow {
  groupName: string;
  area: string | null;
  office: string;
  franchiseName: string;
  daysInMonth: number;
}

interface DayRateEntryRow {
  franchiseName: string;
  date: string; // YYYY-MM-DD
  reportingMonth: string; // YYYY-MM
  daysInMonth: number;
  revenue: number;
  dayRate: number;
}

function cellToValue(cell: ExcelJS.Cell): any {
  const val = cell.value;
  if (val === null || val === undefined) return null;
  if (typeof val === 'object') {
    if (val instanceof Date) return val;
    if ('result' in (val as any)) return (val as any).result;
    if ('richText' in (val as any)) return (val as any).richText.map((rt: any) => rt.text).join('');
    if ('text' in (val as any)) return (val as any).text;
  }
  return val;
}

function sheetToRows(ws: ExcelJS.Worksheet): any[][] {
  const rows: any[][] = [];
  const maxCol = ws.columnCount || ws.actualColumnCount || 0;
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const arr: any[] = [];
    for (let c = 1; c <= maxCol; c++) {
      arr[c - 1] = cellToValue(row.getCell(c));
    }
    rows[rowNumber - 1] = arr;
  });
  // Fill any completely-skipped leading rows with [] so indices line up.
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toIsoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function toReportingMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

// Parses "Revenue 28/07/2025" / "Day Rate  28/07/2025" (note: sometimes double space).
function parseEmbeddedDate(header: string): Date | null {
  const m = header.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
}

function reportingMonthFromSheetTitle(title: string): string {
  const m = title.match(/^([A-Za-z]+)\s+(\d{4})\s+Data$/);
  if (!m) throw new Error(`Cannot parse reporting month from sheet title "${title}"`);
  const monthIdx = MONTH_NAMES.indexOf(m[1].toLowerCase());
  if (monthIdx < 0) throw new Error(`Unknown month name in sheet title "${title}"`);
  return `${m[2]}-${pad2(monthIdx + 1)}`;
}

// The source workbook is inconsistent about "Live-in Care" vs "Live-In Care"
// casing for the same franchise across sheets; normalize so they merge.
function normalizeFranchiseName(name: string): string {
  return name.replace(/live-in care/i, 'Live-In Care');
}

function isBlankDataRow(row: any[]): boolean {
  return [0, 1, 2, 3].every(i => row[i] === null || row[i] === undefined || row[i] === '');
}

function findReportingMonthFooter(rows: any[][]): string | null {
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < (rows[r]?.length ?? 0); c++) {
      const v = rows[r][c];
      if (typeof v === 'string' && v.trim().toLowerCase() === 'reporting month') {
        const valueRow = rows[r + 1];
        const dateVal = valueRow?.[c];
        if (dateVal instanceof Date) return toReportingMonth(dateVal);
      }
    }
  }
  return null;
}

function parseSheet(ws: ExcelJS.Worksheet): { franchiseRows: FranchiseRow[]; entries: DayRateEntryRow[] } {
  const rows = sheetToRows(ws);
  const header0 = rows[0] ?? [];
  const row1 = rows[1] ?? [];

  // Detect convention: Convention B has a numeric sub-header row (row index 1)
  // with "Revenue"/"Day Rate" text and real data starts at row index 2.
  const isConventionB = row1[5] === 'Revenue' || row1[6] === 'Day Rate';
  const dataStartRow = isConventionB ? 2 : 1;
  const dateHeaderRow = header0;

  // Reporting month: Convention B sheets carry an explicit footer; older
  // sheets track exactly one reporting month, named after the sheet itself.
  const footerReportingMonth = isConventionB ? findReportingMonthFooter(rows) : null;
  const reportingMonth = footerReportingMonth ?? reportingMonthFromSheetTitle(ws.name);

  // Collect franchise rows until a blank row (or end of sheet).
  const franchiseRows: FranchiseRow[] = [];
  let dataEndRow = rows.length;
  for (let r = dataStartRow; r < rows.length; r++) {
    if (isBlankDataRow(rows[r] ?? [])) { dataEndRow = r; break; }
  }
  for (let r = dataStartRow; r < dataEndRow; r++) {
    const row = rows[r];
    if (!row || row[3] === null || row[3] === undefined) continue;
    franchiseRows.push({
      groupName: String(row[0] ?? 'SUR Group'),
      area: row[1] != null ? String(row[1]) : null,
      office: String(row[2] ?? ''),
      franchiseName: normalizeFranchiseName(String(row[3])),
      daysInMonth: Number(row[4] ?? 0),
    });
  }

  // Collect date-pair columns (Revenue, Day Rate) starting at column index 5.
  const entries: DayRateEntryRow[] = [];
  for (let c = 5; c < dateHeaderRow.length; c += 2) {
    const headerVal = dateHeaderRow[c];
    let date: Date | null = null;
    if (headerVal instanceof Date) date = headerVal;
    else if (typeof headerVal === 'string') date = parseEmbeddedDate(headerVal);
    if (!date) continue;

    const isoDate = toIsoDate(date);
    for (let r = dataStartRow; r < dataEndRow; r++) {
      const row = rows[r];
      if (!row || row[3] === null || row[3] === undefined) continue;
      const revenue = row[c];
      const dayRate = row[c + 1];
      if (revenue === null || revenue === undefined) continue; // not yet reported
      entries.push({
        franchiseName: normalizeFranchiseName(String(row[3])),
        date: isoDate,
        reportingMonth,
        daysInMonth: Number(row[4] ?? 0),
        revenue: Number(revenue) || 0,
        dayRate: typeof dayRate === 'number' ? dayRate : (Number(row[4]) ? (Number(revenue) || 0) / Number(row[4]) : 0),
      });
    }
  }

  return { franchiseRows, entries };
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npx tsx scripts/seed-day-rate-tracker.ts <path-to-workbook.xlsx>');
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const dataSheets = workbook.worksheets.filter(ws => /Data$/.test(ws.name));

  // Establish canonical franchise order: newest structural sheets first, then
  // chronological order of the rest as encountered.
  const orderedSheets = [
    ...CANONICAL_ORDER_SHEETS.map(name => dataSheets.find(ws => ws.name === name)).filter(Boolean) as ExcelJS.Worksheet[],
    ...dataSheets.filter(ws => !CANONICAL_ORDER_SHEETS.includes(ws.name)),
  ];

  const franchiseOrder = new Map<string, FranchiseRow & { displayOrder: number }>();
  const allEntries: DayRateEntryRow[] = [];

  for (const ws of orderedSheets) {
    const { franchiseRows, entries } = parseSheet(ws);
    for (const fr of franchiseRows) {
      if (!franchiseOrder.has(fr.franchiseName)) {
        franchiseOrder.set(fr.franchiseName, { ...fr, displayOrder: franchiseOrder.size });
      }
    }
    allEntries.push(...entries);
    console.log(`Parsed "${ws.name}": ${franchiseRows.length} franchise rows, ${entries.length} entries`);
  }

  console.log(`\nTotal distinct franchises: ${franchiseOrder.size}`);
  console.log(`Total entries to upsert: ${allEntries.length}`);

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await client.query('BEGIN');

    const franchiseIdByName = new Map<string, string>();
    for (const fr of franchiseOrder.values()) {
      const isLiveInCare = /live[\s-]?in care/i.test(fr.franchiseName);
      const res = await client.query(
        `INSERT INTO day_rate_franchises (group_name, area, office, franchise_name, is_live_in_care, display_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (franchise_name) DO UPDATE SET
           group_name = EXCLUDED.group_name,
           area = EXCLUDED.area,
           office = EXCLUDED.office,
           is_live_in_care = EXCLUDED.is_live_in_care,
           display_order = EXCLUDED.display_order
         RETURNING id`,
        [fr.groupName, fr.area, fr.office, fr.franchiseName, isLiveInCare, fr.displayOrder],
      );
      franchiseIdByName.set(fr.franchiseName, res.rows[0].id);
    }
    console.log(`Upserted ${franchiseIdByName.size} franchise rows.`);

    const rowsToInsert = allEntries
      .map(entry => ({ franchiseId: franchiseIdByName.get(entry.franchiseName), entry }))
      .filter((x): x is { franchiseId: string; entry: DayRateEntryRow } => !!x.franchiseId);

    const CHUNK = 400;
    let inserted = 0;
    for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
      const chunk = rowsToInsert.slice(i, i + CHUNK);
      const values: any[] = [];
      const placeholders: string[] = [];
      chunk.forEach((row, idx) => {
        const base = idx * 6;
        placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, 'import')`);
        values.push(row.franchiseId, row.entry.date, row.entry.reportingMonth, row.entry.daysInMonth, row.entry.revenue, row.entry.dayRate);
      });
      await client.query(
        `INSERT INTO day_rate_entries (franchise_id, date, reporting_month, days_in_month, revenue, day_rate, source)
         VALUES ${placeholders.join(',')}
         ON CONFLICT (franchise_id, date, reporting_month) DO UPDATE SET
           days_in_month = EXCLUDED.days_in_month,
           revenue = EXCLUDED.revenue,
           day_rate = EXCLUDED.day_rate,
           source = 'import',
           updated_at = NOW()`,
        values,
      );
      inserted += chunk.length;
    }
    console.log(`Upserted ${inserted} day-rate entries.`);

    await client.query('COMMIT');
    console.log('Seed complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
