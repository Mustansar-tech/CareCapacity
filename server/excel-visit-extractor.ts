// Extract real client visit times directly from Guaranteed Hours Excel file
import * as XLSX from './xlsx-compat.js';
import { startOfDay, endOfDay, format as fmt, addMinutes, parse as parseDate, format } from 'date-fns';
import { logger } from './logger';

/**
 * Normalize employee names to match how they're normalized in pipeline.ts
 * Ensures names match between capacity analysis and GH Excel schedule
 */
function normalizeName(name: string): string {
  if (!name || name === "undefined" || name === "null") return "";
  let s = String(name).toLowerCase();
  s = s.replace(/\(.*?\)/g, ""); // remove parentheses content
  s = s.replace(/[^a-z\s]/g, " "); // keep letters and spaces
  s = s.replace(/\b(mr|mrs|miss|ms|dr)\b/g, " "); // remove titles
  s = s.replace(/\s+/g, " ").trim();
  return s.split(" ").filter(Boolean).sort().join(" ");
}

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

// Service types to exclude for SCHEDULING (office hours, night shifts, secondary care, live in care, shadowing)
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
  'live-in care',

  // Training and shadowing
  'shadowing'
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
  const wb = await XLSX.read(ghWorkbookBuffer, { type: 'buffer' });
  const sheetName = wb.SheetNames.includes('Data') ? 'Data' : wb.SheetNames[0];

  const rows2d = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName], {
    header: 1,
    raw: true,
    blankrows: false
  }) as any[][];

  // CRITICAL FIX: Always use first non-empty row as header
  // This is the most robust approach - avoids fragile pattern matching
  let headerIdx = rows2d.findIndex(r => r.some(cell => String(cell ?? '').trim() !== ''));
  
  if (headerIdx < 0) {
    logger.debug("ERROR: No valid header row found in Excel file");
    headerIdx = 0; // Last resort fallback
  }

  logger.debug(`GH rows2d length: ${rows2d.length}`);
  logger.debug(`Header row detected at index ${headerIdx}`);
  logger.debug(`Detected header cells:`, rows2d[headerIdx]?.slice(0, 10));
  logger.debug(`Next 3 data rows:`, rows2d.slice(headerIdx + 1, headerIdx + 4).map(r => r.slice(0, 5)));

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
    logger.debug(`Detected columns in Excel file:`);
    Object.keys(firstRow).forEach(col => logger.debug(`   - "${col}"`));
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
    // These are kept in the schedule map so getDeparturePoint knows the CP was
    // active until that end time — but they carry no geocoords, so they never
    // become a travel-time departure location themselves.
    const clientNameLower = clientName.toLowerCase();
    const isOfficeVisit = clientNameLower.includes('office') || clientNameLower.includes('visit, office');

    // Get service type and skip excluded service types (office hours, night shifts, secondary care)
    const serviceTypeRaw = pickCol(row, SERVICE_TYPE_COLS);
    if (serviceTypeRaw) {
      const serviceTypeLower = String(serviceTypeRaw).trim().toLowerCase();

      // Check if service type matches any excluded types
      const isExcluded = EXCLUDED_SERVICE_TYPES.some(excluded =>
        serviceTypeLower.includes(excluded.toLowerCase())
      );

      if (isExcluded) {
        logger.debug(`Excluding by service type: "${serviceTypeRaw}" for ${clientName}`);
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
            logger.debug(`REJECTING overnight visit: ${clientName} starts ${format(startDateTime, "yyyy-MM-dd HH:mm")} ends ${format(endDateTime, "yyyy-MM-dd HH:mm")} - crosses midnight boundary`);
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

          // Generate unique key that allows multiple visits at same time (for multiple care)
          // Include row index or use a counter to ensure uniqueness
          const baseKey = `${clientName}-${visitDate}-${format(startDateTime, "HH:mm")}`;
          let visitKey = baseKey;
          let counter = 1;
          
          // If this key already exists, add a suffix (for multiple care visits)
          while (visitsMap.has(visitKey)) {
            visitKey = `${baseKey}-CP${counter}`;
            counter++;
          }

          // Get client location for this visit using the provided storage and branchId
          const clientLocation = await storage.getClientLocationByName(branchId, clientName);

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
          
          if (counter > 1) {
            logger.debug(`Multiple care visit detected: ${clientName} @ ${startTimeStr}-${endTimeStr} (CP ${counter})`);
          }
          
          if (!clientLocation) {
            logger.debug(`Visit extracted without coordinates: ${clientName} - needs geocoding during data upload`);
          }
        } catch (error) {
          logger.error(`Error processing row for client "${clientName}":`, error);
          // Continue to the next row even if one fails
        }
      }
      // --- End of modified section ---
  }

  // Convert Map values back to an array
  const finalVisits = Array.from(visitsMap.values());

  logger.debug(`Extracted ${finalVisits.length} client visits from Guaranteed Hours Excel for ${dateStr}`);
  return finalVisits;
}

// ─── Per-employee schedule extraction ────────────────────────────────────────
// Used by the BD Matcher to determine realistic departure points.

export interface CpVisitEntry {
  clientName: string;
  startTime: string;  // HH:MM
  endTime: string;    // HH:MM
  lat?: number;
  lng?: number;
  postcode?: string;
}

const EMP_NAME_COLS = [
  'Actual Employee Name',
  'Planned Employee Name',
  'Employee Name',
  'CAREGiver Name',
];

/**
 * Reads the GH Excel buffer and builds a per-employee visit schedule.
 * Returns Map<employeeName, Map<date(yyyy-MM-dd), CpVisitEntry[]>>
 * sorted by startTime within each day.
 */
export async function extractEmployeeVisitsFromGHExcel(
  ghWorkbookBuffer: Buffer,
  weekDates: string[],
  branchId: string,
  storage: any
): Promise<Map<string, Map<string, CpVisitEntry[]>>> {
  const result = new Map<string, Map<string, CpVisitEntry[]>>();

  try {
    const wb = await XLSX.read(ghWorkbookBuffer, { type: 'buffer' });
    const sheetName = wb.SheetNames.includes('Data') ? 'Data' : wb.SheetNames[0];

    const rows2d = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName], {
      header: 1,
      raw: true,
      blankrows: false,
    }) as any[][];

    let headerIdx = rows2d.findIndex(r => r.some(cell => String(cell ?? '').trim() !== ''));
    if (headerIdx < 0) headerIdx = 0;

    const headers = rows2d[headerIdx].map(v => String(v ?? '').trim());
    const data = rows2d.slice(headerIdx + 1).map(r => {
      const o: Record<string, any> = {};
      headers.forEach((h, i) => (o[h] = r[i]));
      return o;
    });

    const weekDatesSet = new Set(weekDates);
    const clientLocationCache = new Map<string, { lat?: string; lng?: string; postcode?: string }>();

    for (const row of data) {
      // Skip cancelled visits
      const cancelRaw = pickCol(row, [CANCEL_COL]);
      if (String(cancelRaw ?? '').toLowerCase().includes('cancel')) continue;

      // Get employee name and normalize to match capacity analysis
      const empNameRaw = pickCol(row, EMP_NAME_COLS);
      if (!empNameRaw) continue;
      const empName = normalizeName(String(empNameRaw));
      if (!empName) continue;

      // Get client name
      const clientNameRaw = pickCol(row, CLIENT_COLS);
      if (!clientNameRaw) continue;
      const clientName = String(clientNameRaw).trim();
      if (!clientName) continue;

      // Office/admin visits are included in the schedule map alongside client visits.
      // They go through the same geocoding lookup — if their name matches a stored
      // client location (e.g. the branch office address) they get real coordinates;
      // otherwise they appear without lat/lng and still serve as activity-time markers
      // so getDeparturePoint knows the CP was on-duty until that end time.

      // Get and validate start time
      const startRaw = pickCol(row, START_COLS);
      const startDate = toDate(startRaw);
      if (!startDate) continue;

      const visitDate = fmt(startDate, 'yyyy-MM-dd');
      if (!weekDatesSet.has(visitDate)) continue;

      // Get duration / end time
      let durationMinutes = NaN;
      for (const c of DUR_COLS) {
        const val = Number(pickCol(row, [c]));
        if (!isFinite(val) || val <= 0) continue;
        durationMinutes = (c === 'Template Duration (Minutes)')
          ? Math.round(val)
          : Math.round(val * 60);
        break;
      }
      if (!isFinite(durationMinutes) || durationMinutes <= 0) continue;

      const endRaw = pickCol(row, END_COLS);
      const endDate = endRaw ? toDate(endRaw) : addMinutes(startDate, durationMinutes);
      if (!endDate) continue;

      // Skip overnight visits
      if (fmt(startDate, 'yyyy-MM-dd') !== fmt(endDate, 'yyyy-MM-dd')) continue;

      const startTime = fmt(startDate, 'HH:mm');
      const endTime = fmt(endDate, 'HH:mm');

      // Get postcode from dedicated column or address
      let postcode: string | undefined;
      const postcodeRaw = pickCol(row, POSTCODE_COLS);
      if (postcodeRaw) {
        postcode = String(postcodeRaw).trim().toUpperCase();
      } else {
        const addressRaw = pickCol(row, ADDRESS_COLS);
        if (addressRaw) {
          const m = String(addressRaw).match(/([A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})/i);
          if (m) postcode = m[1].toUpperCase();
        }
      }

      // Lookup client location with in-memory cache
      if (!clientLocationCache.has(clientName)) {
        try {
          const loc = await storage.getClientLocationByName(branchId, clientName);

          let resolvedLat: string | undefined = loc?.lat ?? undefined;
          let resolvedLng: string | undefined = loc?.lng ?? undefined;
          const resolvedPostcode: string | undefined = loc?.postcode ?? postcode;

          // Fallback: if the name lookup returned no coordinates (e.g. office/admin visits
          // where clientName is "., ." or a location name not stored in client_locations),
          // look up the geocode cache directly using the postcode extracted from the row's
          // "Service Location Address" column. This gives office visits real coordinates
          // so travel times can be calculated from the office location.
          if ((!resolvedLat || !resolvedLng) && resolvedPostcode) {
            const normPc = resolvedPostcode.trim().toUpperCase();
            try {
              const cached = await storage.getGeocode(branchId, `postcode:${normPc}`);
              if (cached?.lat && cached?.lng) {
                resolvedLat = cached.lat;
                resolvedLng = cached.lng;
              }
            } catch { /* geocode cache lookup failed — leave coords undefined */ }
          }

          clientLocationCache.set(clientName, {
            lat: resolvedLat,
            lng: resolvedLng,
            postcode: resolvedPostcode,
          });
        } catch {
          clientLocationCache.set(clientName, { postcode });
        }
      }
      const clientLoc = clientLocationCache.get(clientName)!;

      const entry: CpVisitEntry = {
        clientName,
        startTime,
        endTime,
        lat: clientLoc.lat ? Number(clientLoc.lat) : undefined,
        lng: clientLoc.lng ? Number(clientLoc.lng) : undefined,
        postcode: clientLoc.postcode || postcode,
      };

      if (!result.has(empName)) result.set(empName, new Map());
      const dayMap = result.get(empName)!;
      if (!dayMap.has(visitDate)) dayMap.set(visitDate, []);
      dayMap.get(visitDate)!.push(entry);
    }
  } catch (err) {
    logger.warn(`extractEmployeeVisitsFromGHExcel: failed: ${err}`);
  }

  // Sort visits by startTime within each day
  for (const [, dayMap] of result) {
    for (const [, visits] of dayMap) {
      visits.sort((a, b) => a.startTime.localeCompare(b.startTime));
    }
  }

  logger.debug(`extractEmployeeVisitsFromGHExcel: built schedules for ${result.size} employees`, {
    sampleNames: Array.from(result.keys()).slice(0, 5),
  });
  return result;
}