// Extract real client visit times directly from Guaranteed Hours Excel file
import * as XLSX from 'xlsx';
import { startOfDay, endOfDay, format as fmt, addMinutes, parse as parseDate, format } from 'date-fns';

const START_COLS = [
  'Planned Start Date And Time',  // Primary column as requested
  'Service Requirement Start Date And Time',
  'Actual Start Date And Time',
];

const END_COLS = [
  'Planned End Date And Time',  // Primary column as requested
  'Service Requirement End Date And Time',
  'Actual End Date And Time',
];

const DUR_COLS = [
  'Planned Duration',  // Primary column as requested (in hours)
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

const SERVICE_TYPE_COLS = [
  'Actual Service Type Description',
  'Service Type Description',
  'Service Type',
  'Template Service Type Description',
  'Planned Service Type Description',
];

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
  id?: string;
  clientName: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  date: string;
  address?: string;
  postcode?: string;
  lat?: string;
  lng?: string;
  serviceType?: string;
  priority?: number;
  crossesMidnight?: boolean;
  actualEndDate?: string;
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

// Service types to exclude for SCHEDULING (office hours, night shifts, secondary care, live in care)
// Note: Office hours are EXCLUDED here for scheduling purposes
// but INCLUDED in scheduled hours totals (pipeline.ts)
const EXCLUDED_SERVICE_TYPES = [
  // Office-related (exclude from scheduling, but count in scheduled hours)
  'office hours',
  'office',
  'visit, office',
  'office visit',

  // Night shifts (covering all variations found in Excel)
  'nights - sleep in',
  'sleep in',
  'nights - waking nights',
  'waking nights',
  'nights-sleep in',
  'nights-waking nights',
  'night - sleep in',
  'night - waking nights',
  'night - waking night',  // Singular 'night' at end (from Excel data)
  'sleepover',
  'overnight',
  'waking night',  // Singular variant

  // Secondary care
  'multiple care (secondary)',
  'secondary',
  '(secondary)',
  'multiple care - secondary',

  // Live in care
  'live in care (sc)',
  'live in care',
  'live-in care'
];

// Round time to nearest 15-minute interval
function roundToNearest15Minutes(date: Date): Date {
  const minutes = date.getMinutes();
  const roundedMinutes = Math.round(minutes / 15) * 15;
  const result = new Date(date);
  result.setMinutes(roundedMinutes);
  result.setSeconds(0);
  result.setMilliseconds(0);
  return result;
}

// Helper: case/space-insensitive column picker (matches pipeline.ts)
function pickCol(row: Record<string, any>, names: string[]): any {
  const keys = Object.keys(row);
  for (const want of names) {
    const target = want.trim().toLowerCase();
    const hit = keys.find((k) => k.trim().toLowerCase() === target);
    if (hit) return row[hit];
  }
  return undefined;
}




export async function extractClientVisitsFromGHExcel(
  ghWorkbookBuffer: Buffer,
  specificDate: Date,
  branchId: string, // Added branchId as it's used in the modified logic
  storage: any // Added storage as it's used in the modified logic
): Promise<ExcelClientVisit[]> {
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
  const visitsMap: Map<string, ExcelClientVisit> = new Map(); // Use a map to avoid duplicates

  // Log detected columns for debugging (case-insensitive)
  const firstRow = data[0];
  if (firstRow) {
    console.log(`📋 Detected columns in Excel file:`);
    Object.keys(firstRow).forEach(col => console.log(`   - "${col}"`));
  }

  for (const row of data) {
    // Skip cancelled visits (use pickCol for case-insensitive lookup)
    const cancelRaw = pickCol(row, [CANCEL_COL]);
    const cancelStatus = String(cancelRaw ?? '').toLowerCase();
    if (cancelStatus.includes('cancel')) continue;

    // Get client name (use pickCol for case-insensitive lookup)
    const clientNameRaw = pickCol(row, CLIENT_COLS);
    if (!clientNameRaw) continue;
    const clientName = String(clientNameRaw).trim();

    // Check client name for office keywords (like "Visit, Office")
    // These are EXCLUDED from scheduling but INCLUDED in scheduled hours totals
    const clientNameLower = clientName.toLowerCase();
    if (clientNameLower.includes('office') || clientNameLower.includes('visit, office')) {
      console.log(`🚫 Excluding office visit from scheduling: "${clientName}"`);
      continue;
    }

    // Get service type and skip excluded service types (office hours, night shifts, secondary care)
    const serviceTypeRaw = pickCol(row, SERVICE_TYPE_COLS);
    if (serviceTypeRaw) {
      const serviceTypeLower = String(serviceTypeRaw).trim().toLowerCase();

      // Check if service type matches any excluded types
      const isExcluded = EXCLUDED_SERVICE_TYPES.some(excluded =>
        serviceTypeLower.includes(excluded.toLowerCase())
      );

      if (isExcluded) {
        console.log(`🚫 Excluding by service type: "${serviceTypeRaw}" for ${clientName}`);
        continue;
      }
    }

    // Get start time (use pickCol for case-insensitive lookup)
    const startRaw = pickCol(row, START_COLS);
    let startDate = toDate(startRaw);
    if (!startDate || startDate < dayStart || startDate > dayEnd) continue;

    // Round start time to nearest 15 minutes
    startDate = roundToNearest15Minutes(startDate);

    // Get duration (use pickCol for case-insensitive lookup)
    let durationMinutes = NaN;
    let foundDurationCol: string | undefined;
    for (const c of DUR_COLS) {
      const val = Number(pickCol(row, [c]));
      if (!isFinite(val)) continue;
      foundDurationCol = c;
      // Planned Duration is in hours, Template Duration is in minutes
      if (c === 'Planned Duration' || c === 'Service Requirement Duration' || c === 'Actual Duration') {
        durationMinutes = Math.round(val * 60);
      } else {
        durationMinutes = Math.round(val);
      }
      break;
    }
    if (!isFinite(durationMinutes) || durationMinutes <= 0) continue;

    // Calculate end time (prefer explicit end column, fallback to start + duration)
    const endRaw = pickCol(row, END_COLS);
    let endDate = endRaw ? toDate(endRaw) : addMinutes(startDate, durationMinutes);
    if (!endDate) continue;

    // Round end time to nearest 15 minutes
    endDate = roundToNearest15Minutes(endDate);

    // Get address (use pickCol for case-insensitive lookup)
    const addressRaw = pickCol(row, ADDRESS_COLS);
    const address = addressRaw ? String(addressRaw).trim() : undefined;

    // Get postcode (check dedicated columns first, then extract from address)
    let postcode: string | undefined;
    const postcodeRaw = pickCol(row, POSTCODE_COLS);
    if (postcodeRaw) {
      postcode = String(postcodeRaw).trim().toUpperCase();
    } else if (address) {
      const postcodeMatch = address.match(/([A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})/i);
      postcode = postcodeMatch ? postcodeMatch[1].toUpperCase() : undefined;
    }

    // --- Start of modified section ---
      // NOTE: This extraction now depends on client locations being in the database.
      // For a new branch, you must first upload Guaranteed Hours via Data Management
      // to populate client_locations table, otherwise all visits will be extracted
      // without coordinates (lat/lng will be undefined).
      if (startRaw) { // Ensure startRaw is not null or empty
        try {
          const startDateTime = roundToNearest15Minutes(toDate(startRaw)!); // Use toDate and round
          const endDateTime = endRaw ? roundToNearest15Minutes(toDate(endRaw)!) : addMinutes(startDateTime, durationMinutes);

          if (!endDateTime) continue; // Skip if endDateTime could not be determined

          // CRITICAL: Reject overnight visits completely (crosses midnight)
          const crossesMidnight = format(startDateTime, "yyyy-MM-dd") !== format(endDateTime, "yyyy-MM-dd");
          if (crossesMidnight) {
            console.log(`🚫 REJECTING overnight visit: ${clientName} starts ${format(startDateTime, "yyyy-MM-dd HH:mm")} ends ${format(endDateTime, "yyyy-MM-dd HH:mm")} - crosses midnight boundary`);
            continue; // Skip this visit entirely
          }

          // Use the START date as the visit date (only single-day visits reach here)
          const visitDate = format(startDateTime, "yyyy-MM-dd");

          // Validate visit is within the requested date
          const requestedDate = format(specificDate, "yyyy-MM-dd");
          if (visitDate !== requestedDate) {
            continue; // Skip visits not on the requested date
          }

          // Calculate duration in minutes based on actual start and end times
          const duration = Math.round((endDateTime.getTime() - startDateTime.getTime()) / (1000 * 60));

          const visitKey = `${clientName}-${visitDate}-${format(startDateTime, "HH:mm")}`; // Use formatted start time for key

          // Get client location for this visit using the provided storage and branchId
          const clientLocation = await storage.getClientLocationByName(branchId, clientName);

          if (!visitsMap.has(visitKey)) {
            // Store the actual clock times (HH:mm format)
            const startTimeStr = format(startDateTime, "HH:mm");
            const endTimeStr = format(endDateTime, "HH:mm");

            const visitData: Partial<ExcelClientVisit> = {
              id: visitKey,
              clientName,
              startTime: startTimeStr,
              endTime: endTimeStr,
              durationMinutes: duration,
              date: visitDate,
              lat: clientLocation?.lat || undefined,
              lng: clientLocation?.lng || undefined,
              serviceType: row[SERVICE_TYPE_COLS.find(c => row[c]) ?? ''] || "", // Safely get service type
              priority: 1, // Default priority
              address,
              postcode,
            };

            visitsMap.set(visitKey, visitData as ExcelClientVisit);
            
            if (!clientLocation) {
              console.log(`⚠️ Visit extracted without coordinates: ${clientName} - needs geocoding during data upload`);
            }
          }
        } catch (error) {
          console.error(`Error processing row for client "${clientName}":`, error);
          // Continue to the next row even if one fails
        }
      }
      // --- End of modified section ---
  }

  // Convert Map values back to an array
  const finalVisits = Array.from(visitsMap.values());

  console.log(`📋 Extracted ${finalVisits.length} client visits from Guaranteed Hours Excel for ${dateStr}`);
  return finalVisits;
}