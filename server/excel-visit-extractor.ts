// Extract real client visit times directly from Guaranteed Hours Excel file
import * as XLSX from 'xlsx';
import { startOfDay, endOfDay, format as fmt, addMinutes } from 'date-fns';

const START_COLS = [
  'Service Requirement Start Date And Time',
  'Planned Start Date And Time',
  'Actual Start Date And Time',
];

const END_COLS = [
  'Service Requirement End Date And Time',
  'Planned End Date And Time',
  'Actual End Date And Time',
];

const DUR_COLS = [
  'Service Requirement Duration',
  'Actual Duration',
  'Template Duration (Minutes)',
];

const CLIENT_COLS = [
  'Service Location Name',
  'Client Name',
  'Service User Name',
  'Customer Name',
];

const TEMPLATE_EMPLOYEE_COLS = [
  'Template Employee Name',
  'Planned Employee Name',
  'Preferred Employee Name',
];

const ADDRESS_COLS = [
  'Service Location Address',
  'Service Requirement Location',
  'Service Location',
  'Client Address',
  'Address Line 1',
  'Full Address',
  'Address',
];

const POSTCODE_COLS = [
  'Postcode',
  'Post Code',
  'Postal Code',
  'Client Postcode',
];

const CANCEL_COL = 'Cancellation Description';

function toDate(v: any): Date | undefined {
  if (v instanceof Date && !isNaN(+v)) return v;
  if (typeof v === 'number') {
    const baseDate = new Date(1900, 0, 1);
    const days = v - 2;
    return new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
  }
  const t = new Date(String(v));
  return isNaN(+t) ? undefined : t;
}

export interface ExcelClientVisit {
  clientName: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  date: string;
  address?: string;
  postcode?: string;
  templateEmployee?: string; // Pre-assigned employee from Excel
}

// Office visit keywords to exclude
const OFFICE_VISIT_KEYWORDS = [
  'east nl', 
  'glasgow', 
  'training seawared',
  'training (nl)',
  'seaward place',
  'office',
  'training',
  'admin',
  'meeting'
];

export function extractClientVisitsFromGHExcel(
  ghWorkbookBuffer: Buffer,
  specificDate: Date
): ExcelClientVisit[] {
  const wb = XLSX.read(ghWorkbookBuffer, { type: 'buffer' });
  const sheetName = wb.SheetNames.includes('Data') ? 'Data' : wb.SheetNames[0];

  const rows2d = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName], { 
    header: 1, 
    raw: true, 
    blankrows: false 
  }) as any[][];
  
  let headerIdx = rows2d.findIndex(r => {
    const low = r.map(v => String(v ?? '').toLowerCase());
    return low.some(s => s.includes('start date')) || low.some(s => s.includes('client'));
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
  const dateStr = fmt(specificDate, 'yyyy-MM-dd');

  const visits: ExcelClientVisit[] = [];

  for (const row of data) {
    // Skip cancelled visits
    const cancelStatus = String(row[CANCEL_COL] ?? '').toLowerCase();
    if (cancelStatus.includes('cancel')) continue;

    // Get client name
    const clientNameRaw = CLIENT_COLS.map(c => row[c]).find(v => v && String(v).trim() !== '');
    if (!clientNameRaw) continue;
    const clientName = String(clientNameRaw).trim();
    
    // Skip office visits
    const clientNameLower = clientName.toLowerCase();
    if (OFFICE_VISIT_KEYWORDS.some(keyword => clientNameLower.includes(keyword))) {
      continue;
    }

    // Get start time
    const startRaw = START_COLS.map(c => row[c]).find(v => v != null && v !== '');
    const startDate = toDate(startRaw);
    if (!startDate || startDate < dayStart || startDate > dayEnd) continue;

    // Get duration
    let durationMinutes = NaN;
    for (const c of DUR_COLS) {
      const val = Number(row[c]);
      if (!isFinite(val)) continue;
      durationMinutes = c.toLowerCase().includes('minute') ? Math.round(val) : Math.round(val * 60);
      break;
    }
    if (!isFinite(durationMinutes) || durationMinutes <= 0) continue;

    // Calculate end time (prefer explicit end column, fallback to start + duration)
    const endRaw = END_COLS.map(c => row[c]).find(v => v != null && v !== '');
    const endDate = endRaw ? toDate(endRaw) : addMinutes(startDate, durationMinutes);
    if (!endDate) continue;

    // Get address
    const addressRaw = ADDRESS_COLS.map(c => row[c]).find(v => v && String(v).trim() !== '');
    const address = addressRaw ? String(addressRaw).trim() : undefined;
    
    // Get postcode (check dedicated columns first, then extract from address)
    let postcode: string | undefined;
    const postcodeRaw = POSTCODE_COLS.map(c => row[c]).find(v => v && String(v).trim() !== '');
    if (postcodeRaw) {
      postcode = String(postcodeRaw).trim().toUpperCase();
    } else if (address) {
      const postcodeMatch = address.match(/([A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})/i);
      postcode = postcodeMatch ? postcodeMatch[1].toUpperCase() : undefined;
    }

    // Get template employee name (pre-assigned employee)
    const templateEmployeeRaw = TEMPLATE_EMPLOYEE_COLS.map(c => row[c]).find(v => v && String(v).trim() !== '');
    const templateEmployee = templateEmployeeRaw ? String(templateEmployeeRaw).trim() : undefined;

    visits.push({
      clientName,
      startTime: fmt(startDate, 'HH:mm'),
      endTime: fmt(endDate, 'HH:mm'),
      durationMinutes,
      date: dateStr,
      address,
      postcode,
      templateEmployee,
    });
  }

  console.log(`📋 Extracted ${visits.length} client visits from Guaranteed Hours Excel for ${dateStr}`);
  return visits;
}
