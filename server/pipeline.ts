import * as XLSX from "./xlsx-compat.js";
import { logger } from './logger';
import { parse, format, addDays, differenceInDays } from "date-fns";
import {
  buildTimeWindow,
  parseGuaranteedDate,
  timeToString,
} from "./time-window-utils";
import { computeCapacityWindows } from "./capacity-windows";
// Service delivery rules are now applied inline during demand calculation from GH data
import { extractCancelledWindowsFromGHWorkbook } from "./cancelled-visits-from-gh";
import {
  AvailabilityRow,
  GuaranteedHoursRow,
  ClientDemandRow,
  CleanedEmployeeRecord,
  DailySummaryRecord,
  EmployeeDailyDetail,
  ProcessingResult,
  InsertCapacityAnalysis,
} from "@shared/schema";
import { storage } from "./storage";

// Helper function to extract branch from Excel data
function extractBranchFromRow(row: any): string | null {
  // Check multiple possible branch column names
  const branchColumns = [
    "CAREGiver Franchise",
    "Customer Branch",
    "Branch",
    "Franchise",
    "Office"
  ];

  for (const col of branchColumns) {
    if (row[col]) {
      return String(row[col]).trim();
    }
  }

  return null;
}

// Normalize branch name to match database values
function normalizeBranchName(branchName: string): string {
  const normalized = branchName.toLowerCase().trim();

  // Map variations to canonical names
  const branchMap: Record<string, string> = {
    'north lanarkshire & glasgow east': 'north-lanarkshire',
    'north lanarkshire': 'north-lanarkshire',
    'glasgow east': 'north-lanarkshire',
    'glasgow north': 'glasgow-north',
    'glasgow south': 'glasgow-south',
    'stirling & falkirk': 'stirling-falkirk',
    'stirling': 'stirling-falkirk',
    'falkirk': 'stirling-falkirk',
    'perthshire': 'perthshire',
    'perth': 'perthshire',
    'south ayrshire': 'south-ayrshire',
    'ayrshire': 'south-ayrshire',
    'ayr': 'south-ayrshire',
    'aberdeen': 'aberdeen',
    'east lothian & midlothian': 'east-lothian',
    'east lothian': 'east-lothian',
    'midlothian': 'east-lothian',
    'scottish borders': 'scottish-borders',
    'borders': 'scottish-borders',
    'west fife and kinross': 'west-fife-kinross',
    'west fife & kinross': 'west-fife-kinross',
    'west fife': 'west-fife-kinross',
    'kinross': 'west-fife-kinross',
    'home instead west fife and kinross': 'west-fife-kinross',
  };

  return branchMap[normalized] || normalized.replace(/\s+/g, '-');
}

// Geocoding via postcodes.io API only — no fallbacks, no approximations.
// Returns null if the postcode cannot be resolved exactly.
export async function geocodeWithFallback(postcode: string, storage: any, branchId: string): Promise<any> {
  const normalizedPostcode = postcode.trim().toUpperCase();

  // Step 1: Exact postcode from cache (branch-scoped, previously confirmed via API)
  const cached = await storage.getGeocode(branchId, `postcode:${normalizedPostcode}`);
  if (cached) {
    return {
      query: normalizedPostcode,
      type: 'postcode',
      lat: cached.lat,
      lng: cached.lng,
      source: 'cache',
      approximate: false
    };
  }

  // Step 2: Exact postcode from postcodes.io API
  try {
    const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(normalizedPostcode)}`);
    if (response.ok) {
      const data = await response.json();
      if (data.status === 200 && data.result) {
        const lat = data.result.latitude.toString();
        const lng = data.result.longitude.toString();

        await storage.saveGeocode({
          branchId: branchId!,
          key: `postcode:${normalizedPostcode}`,
          lat,
          lng,
          source: 'postcodes.io'
        });

        return {
          query: normalizedPostcode,
          type: 'postcode',
          lat,
          lng,
          source: 'postcodes.io',
          approximate: false
        };
      }
    }
  } catch (err) {
    logger.warn(`Geocoding API call failed for ${normalizedPostcode}: ${err}`);
  }

  // No fallback — return null so the caller can mark the record as un-geocoded
  // rather than storing an incorrect city-centre approximation.
  logger.warn(`Geocoding failed for postcode "${normalizedPostcode}" — no coordinates stored`);
  return null;
}

// Postcode normalization helper function
function normalisePostcode(pc: string) {
  if (!pc) return "";
  const s = pc.toUpperCase().replace(/\s+/g, "");
  if (s.length < 5 || s.length > 7) return pc.toUpperCase().trim();
  return s.slice(0, s.length - 3) + " " + s.slice(-3);
}

// Transport mode normalization helper - ensures type safety for schema union
function toTransportMode(raw: string | null | undefined): 'car' | 'walking' | 'public' | null {
  if (!raw) return null;
  const normalized = raw.toLowerCase().trim();
  if (normalized.includes('car') || normalized.includes('driver') || normalized.includes('driv')) {
    return 'car';
  }
  if (normalized.includes('walk') || normalized.includes('pedestrian') || normalized.includes('foot')) {
    return 'walking';
  }
  if (normalized.includes('public') || normalized.includes('bus') || normalized.includes('train')) {
    return 'public';
  }
  return 'car'; // Default fallback
}

// Leave types and priority (1=highest, 7=lowest like your Python code)
const LEAVE_TYPES = [
  "AWOL",
  "Educational Commitment",
  "Jury Service",
  "Maternity/Paternity",
  "Sick",
  "Holiday",
  "Compassionate Leave",
  "Dependant Leave",
  "Other Unavailable",
  "Pre-Agreed Appointment",
];
const STATUS_PRIORITY: Record<string, number> = {
  "AWOL": 1,
  "Maternity/Paternity": 2,
  "Educational Commitment": 3,
  "Jury Service": 3,
  "Sick": 4,
  "Holiday": 5,
  "Compassionate Leave": 6,
  "Dependant Leave": 6,
  "Other Unavailable": 7,
  "Partial Availability": 8, // ← NEW (not in LEAVE_TYPES)
  Available: 9,
  "Ad-hoc": 9, // NEW
};

// Day-level vs time-slice leave
const DAY_KILLERS = new Set<string>([
  "Holiday",
  "Sick",
  "Maternity/Paternity",
  "Compassionate Leave",
  "AWOL",
  "Jury Service",
  "Educational Commitment",
  "Dependant Leave",
]);

const TIME_KILLERS = new Set<string>([
  "Other Unavailable",
  "Pre-Agreed Appointment",
]);

interface ParsedAvailabilityRow extends AvailabilityRow {
  parsedDate: Date;
  calculatedHours: number;
}


// ====== SHEET NAMES (EXACT MATCH TO WORKING IMPLEMENTATION) ======
const AVAIL_SHEET = "CAREGiver Availability";
const GUAR_SHEET = "Data";

// Client name column priorities for guaranteed hours data
const CLIENT_COLS = [
  'Service Location Name',
  'Client Name',
  'Service User Name',
  'Customer Name'
];

// Guaranteed hours data column name aliases (case-insensitive lookup)
const CANCEL_COLS = ['Cancellation Description'];
const EMPLOYEE_NAME_COLS = [
  'Actual Employee Name', 
  'Planned Employee Name',
  'Employee Name', 
  'Caregiver Name', 
  'Care giver Name'
];
const START_TIME_COLS = ['Actual Start Date And Time', 'Start Date And Time', 'Planned Start Date And Time', 'Service Requirement Start Date And Time'];
const END_TIME_COLS = ['Actual End Date And Time', 'End Date And Time', 'Planned End Date And Time', 'Service Requirement End Date And Time'];
const SERVICE_TYPE_COLS = ['Actual Service Type Description', 'Service Type Description', 'Service Type'];
const PAY_HOURS_COLS = ['Actual Pay Rate Hours', 'Pay Hours', 'Pay Rate Hours', 'Hours'];
const ADDRESS_COLS_GH = ['Service Location Address', 'Service Requirement Location', 'Service Location', 'Client Address', 'Address Line 1', 'Full Address', 'Address'];

// Helper: case/space-insensitive column picker
function pickCol(row: Record<string, any>, names: string[]): any {
  const keys = Object.keys(row);
  for (const want of names) {
    const target = want.trim().toLowerCase();
    const hit = keys.find((k) => k.trim().toLowerCase() === target);
    if (hit) return row[hit];
  }
  return undefined;
}


// Find the right CG sheet instead of always taking the first one
function getCGSheetName(wb: any): string {
  // Try likely names first
  const preferred = ["Data", "Employees", "CG Data", "Master", "Sheet1"];
  for (const n of preferred) if (wb.SheetNames.includes(n)) return n;

  // Fallback: scan for a sheet that has name + weekly-hours-ish columns
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      range: 0,
      blankrows: false,
    }) as any;
    const header = (rows?.[0] ?? []).map((c: any) =>
      String(c ?? "")
        .trim()
        .toLowerCase(),
    );
    const hasName =
      header.includes("caregiver name") ||
      (header.includes("first name") && header.includes("last name"));
    const hasHours = [
      "weekly hours",
      "hours per week",
      "contracted weekly hours",
      "contracted hours",
      "hours contracted",
    ].some((h) => header.includes(h));
    if (hasName && hasHours) return name;
  }

  // Absolute last resort
  return wb.SheetNames[0];
}

// Normalize name exactly like working implementation
function normalizeName(name: string): string {
  if (!name || name === "undefined" || name === "null") return "";
  let s = String(name).toLowerCase();
  s = s.replace(/\(.*?\)/g, ""); // remove parentheses content
  s = s.replace(/[^a-z\s]/g, " "); // keep letters and spaces
  s = s.replace(/\b(mr|mrs|miss|ms|dr)\b/g, " "); // remove titles
  s = s.replace(/\s+/g, " ").trim();
  return s.split(" ").filter(Boolean).sort().join(" ");
}

function canonicalStatus(raw: any): string {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();

  // available family
  if (s === "avail" || s.startsWith("avail")) return "Available";

  // time-killers
  if (s.startsWith("other unavail") || s.startsWith("othe"))
    return "Other Unavailable";
  if (s.includes("pre-agreed")) return "Pre-Agreed Appointment";

  // day-killers
  if (s.startsWith("holiday")) return "Holiday";
  if (s.startsWith("sick")) return "Sick";
  if (s.includes("maternity") || s.includes("paternity"))
    return "Maternity/Paternity";
  if (s.includes("compassion")) return "Compassionate Leave";
  if (s.includes("awol")) return "AWOL";
  if (s.includes("dependant")) return "Dependant Leave";
  if (s.includes("education") || s.includes("commitment")) return "Educational Commitment";
  if (s.includes("jury")) return "Jury Service";

  if (s.includes("ad-hoc") || s.includes("adhoc")) return "Ad-hoc";
  return raw ?? "";
}

// Helper function to get scheduled hours for a specific date based on service requirements
// Build Scheduled Hours lookup from Guaranteed sheet
// key: normalized employee name + yyyy-MM-dd(Service Requirement Start Date And Time)
// ---- FALLBACK + ROBUST FILTER HELPERS --------------------------------------

// Priority: 1) Planned  2) Actual  3) Service Requirement
// Planned first ensures scheduled hours work even when visits haven't been actualised yet
function resolveServiceTimestamps(row: any): { start?: any; end?: any } {
  const plStart = row["Planned Start Date And Time"];
  const plEnd = row["Planned End Date And Time"];
  const acStart = row["Actual Start Date And Time"];
  const acEnd = row["Actual End Date And Time"];
  const srStart = row["Service Requirement Start Date And Time"];
  const srEnd = row["Service Requirement End Date And Time"];

  // Use || to handle empty strings as falsy - fall back through the chain
  const start = plStart || acStart || srStart;
  const end = plEnd || acEnd || srEnd;
  return { start, end };
}

// Helper for Care Pro Guaranteed Hours with Actual priority (case-insensitive)
function pickStartForBucket(row: any): any {
  return pickCol(row, START_TIME_COLS);
}

// "HH:mm" helpers for time windows
function toMin(dateOrStr: any): number {
  // supports Date | Excel serial | "YYYY-MM-DDTHH:mm" | "HH:mm"
  const toDate = (v: any) => {
    if (v instanceof Date) return v;
    if (typeof v === "number") {
      const excelEpoch = new Date(1899, 11, 30);
      return new Date(excelEpoch.getTime() + v * 86400000);
    }
    if (/^\d{1,2}:\d{2}$/.test(String(v))) {
      const [h, m] = String(v).split(":").map(Number);
      const d = new Date(2000, 0, 1, h || 0, m || 0);
      return d;
    }
    return new Date(v);
  };
  const d = toDate(dateOrStr);
  if (isNaN(d.getTime())) return NaN;
  return d.getHours() * 60 + d.getMinutes();
}

function fromMin(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function mergeIntervals(
  ints: Array<[number, number]>,
  adjacencyMin = 0,
): Array<[number, number]> {
  const arr = ints
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .sort((a, b) => a[0] - b[0]);
  if (!arr.length) return [];
  const out: Array<[number, number]> = [arr[0]];
  for (let i = 1; i < arr.length; i++) {
    const [s, e] = arr[i];
    const last = out[out.length - 1];
    if (s <= last[1] + adjacencyMin) {
      last[1] = Math.max(last[1], e);
    } else {
      out.push([s, e]);
    }
  }
  return out;
}

// ---- Window helpers (HH:mm-HH:mm <-> minute pairs) ------------------
function windowListToPairs(windows: string[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const w of windows || []) {
    const [a, b] = (w || "").split("-").map((s) => (s || "").trim());
    if (a && b) {
      let s = toMin(a);
      let e = toMin(b);
      // Handle overnight windows (e.g., 22:00-07:00)
      if (Number.isFinite(s) && Number.isFinite(e)) {
        if (e <= s) {
          // Overnight window - add 24 hours to end time
          e += 24 * 60;
        }
        out.push([s, e]);
      }
    }
  }
  return out;
}

function pairsToWindowList(pairs: Array<[number, number]>): string[] {
  return (pairs || []).map(([s, e]) => `${fromMin(s)}-${fromMin(e)}`);
}

function subtractIntervals(
  base: Array<[number, number]>,
  blocks: Array<[number, number]>,
): Array<[number, number]> {
  const mergedBase = mergeIntervals(base, 0);
  const mergedBlocks = mergeIntervals(blocks, 0);
  let current = mergedBase;

  const subOne = (
    a: [number, number],
    b: [number, number],
  ): Array<[number, number]> => {
    const [as, ae] = a;
    const [bs, be] = b;
    if (!(bs < ae && as < be)) return [a]; // no overlap
    const left: [number, number] | null =
      as < bs ? [as, Math.min(ae, bs)] : null;
    const right: [number, number] | null =
      be < ae ? [Math.max(as, be), ae] : null;
    const out: Array<[number, number]> = [];
    if (left && left[1] > left[0]) out.push(left);
    if (right && right[1] > right[0]) out.push(right);
    return out;
  };

  for (const bl of mergedBlocks) {
    const next: Array<[number, number]> = [];
    for (const iv of current) next.push(...subOne(iv, bl));
    current = next;
    if (!current.length) break;
  }
  return mergeIntervals(current, 0);
}

function filterMinDuration(
  pairs: Array<[number, number]>,
  minMinutes = 60,
): Array<[number, number]> {
  return (pairs || []).filter(([s, e]) => e - s >= minMinutes);
}

function isAllDayTimeKiller(
  mergedBlockers: Array<[number, number]>,
  availPairs: Array<[number, number]>,
  contractedDailyMin: number,
): boolean {
  if (!mergedBlockers.length || !availPairs.length) return false;

  // Calculate total blocked time
  const totalBlockedMin = mergedBlockers.reduce(
    (sum, [s, e]) => sum + (e - s),
    0,
  );

  // If blocked time is >= contracted daily minutes, consider it all-day
  // Use 90% threshold to account for minor gaps/rounding
  const threshold = Math.max(contractedDailyMin * 0.9, 60); // At least 1 hour minimum

  if (totalBlockedMin >= threshold) return true;

  // CRITICAL FIX: Also check if blockers completely cover all availability windows
  // Even if the blocker is small (e.g., 2.25 hours), if it covers the ENTIRE availability window,
  // treat it as a day-killer (no capacity left)
  const freeTime = subtractIntervals(availPairs, mergedBlockers);
  const totalFreeMin = freeTime.reduce((sum, [s, e]) => sum + (e - s), 0);

  // If there's no meaningful free time left (less than 15 minutes), it's a day-killer
  return totalFreeMin < 15;
}

// Build time windows per employee/day from Guaranteed (ACTUAL start/end)
function buildAdHocWindowsMap(
  guaranteed: any[],
): Map<string, Array<[number, number]>> {
  const map = new Map<string, Array<[number, number]>>();

  for (const r of guaranteed || []) {
    // use same filters as your scheduled lookup (case-insensitive):
    const cancelRaw = pickCol(r, CANCEL_COLS);
    if (!isCancellationBlank(cancelRaw)) continue;
    const serviceTypeRaw = pickCol(r, SERVICE_TYPE_COLS);
    if (isSecondaryMultipleCare(serviceTypeRaw)) continue;

    const empName = pickCol(r, EMPLOYEE_NAME_COLS);
    const nameNorm = normalizeName(empName);
    if (!nameNorm) continue;

    // Use planned times first (contracted schedule) so free windows reflect what was booked,
    // not actual clock-in/clock-out times. Fall back to actual only if planned is absent.
    const startV = pickCol(r, ['Planned Start Date And Time', 'Service Requirement Start Date And Time', 'Actual Start Date And Time', 'Start Date And Time']);
    const endV = pickCol(r, ['Planned End Date And Time', 'Service Requirement End Date And Time', 'Actual End Date And Time', 'End Date And Time']);
    if (!startV || !endV) continue;

    const dateKey = format(parseDate(startV), "yyyy-MM-dd");
    let s = toMin(startV);
    let e = toMin(endV);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    if (e <= s) e += 24 * 60; // overnight

    const key = `${nameNorm}|${dateKey}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push([s, e]);
  }

  // merge adjacent/overlapping within each day
  map.forEach((ints, k) => {
    map.set(k, mergeIntervals(ints, 0));
  });
  return map;
}

// Keep a display name for each normalized employee (prefer Actual name)
function buildDisplayNameMap(guaranteed: any[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of guaranteed || []) {
    const empName = pickCol(r, EMPLOYEE_NAME_COLS);
    const n = normalizeName(empName);
    if (n && empName)
      m.set(n, String(empName));
  }
  return m;
}

// Robust secondary filter (case/spacing tolerant)
function isSecondaryMultipleCare(serviceType: string): boolean {
  if (!serviceType) return false;
  const normalized = String(serviceType)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") // Remove non-alphanumeric
    .replace(/\s/g, ""); // Remove spaces

  const excluded = [
    "multiplecaresecondary",
    "secondary",
    "multiplecare-secondary",
    "(secondary)",
  ].map(s => s.replace(/[^a-z0-9]/g, "").replace(/\s/g, ""));

  return excluded.some(ex => normalized.includes(ex));
}

// Filter for Live In Care (SC) service types (case/spacing tolerant)
function isLiveInCare(serviceType: string): boolean {
  if (!serviceType) return false;
  const normalized = String(serviceType)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") // Remove non-alphanumeric
    .replace(/\s/g, ""); // Remove spaces

  const excluded = [
    "liveincaresc",
    "liveincare",
    "liveincarewithoutscsuffix",
  ].map(s => s.replace(/[^a-z0-9]/g, "").replace(/\s/g, ""));

  return excluded.some(ex => normalized.includes(ex));
}

// Treat common "blank" tokens as blank
function isCancellationBlank(value: any): boolean {
  const s = (value ?? "").toString().trim().toLowerCase();
  return s === "" || s === "(blank)" || s === "na" || s === "n/a";
}

// Helper function to get scheduled hours for a specific date based on service requirements
// Build Scheduled Hours lookup from Guaranteed sheet
// key: normalized employee name + yyyy-MM-dd(resolved start date)
function buildScheduledHoursLookup(guaranteed: any[]): Map<string, number> {
  const ghMap = new Map<string, number>();
  let totalProcessed = 0;
  let filteredCancelled = 0;
  let filteredSecondary = 0;
  let filteredLiveInCare = 0;
  let officeHoursIncluded = 0;

  for (const g of guaranteed || []) {
    totalProcessed++;

    // Apply robust filters - filter cancelled, secondary care, and live in care (case-insensitive)
    // Office hours MUST be included in scheduled totals
    const cancelRaw = pickCol(g, CANCEL_COLS);
    const cancelOk = isCancellationBlank(cancelRaw);
    if (!cancelOk) {
      filteredCancelled++;
      continue;
    }

    const serviceTypeRaw = pickCol(g, SERVICE_TYPE_COLS);
    const secondary = isSecondaryMultipleCare(serviceTypeRaw);
    if (secondary) {
      filteredSecondary++;
      continue;
    }

    const liveInCare = isLiveInCare(serviceTypeRaw);
    if (liveInCare) {
      filteredLiveInCare++;
      continue;
    }

    // CRITICAL: Office hours are INCLUDED here - they count toward scheduled totals
    // This ensures employees show correct scheduled hours including office work
    // Office hours are only filtered in excel-visit-extractor.ts (for scheduling tab)

    // Track office hours/shadowing for debugging
    const serviceType = serviceTypeRaw || "";
    const lowerServiceType = String(serviceType).toLowerCase();
    const isOfficeHours = lowerServiceType && (
      lowerServiceType.includes("office") ||
      lowerServiceType.includes("training") ||
      lowerServiceType.includes("shadowing") ||
      lowerServiceType.includes("shadow") ||
      lowerServiceType.includes("internal") ||
      lowerServiceType.includes("meeting") ||
      lowerServiceType.includes("admin")
    );

    // CRITICAL FIX: Use resolveServiceTimestamps to fall back to Planned when Actual is empty
    // This ensures shadowing/office hours entries with empty Actual fields still get counted
    const { start, end } = resolveServiceTimestamps(g);
    if (!start) {
      const empName = pickCol(g, EMPLOYEE_NAME_COLS);
      if (empName && (
        empName.toLowerCase().includes("chloe") || empName.toLowerCase().includes("mcclymont") ||
        empName.toLowerCase().includes("palmer") || empName.toLowerCase().includes("campbell")
      )) {
        logger.debug(`SKIPPING entry for ${empName} - no start timestamp (Actual, Planned, or SR)`);
      }
      continue;
    }

    // EXCLUDE overnight/multi-day visits from totals
    // User requirement: Night visits should not be included in totals or scheduling
    const date = format(parseDate(start), "yyyy-MM-dd");
    
    if (start && end) {
      const endDate = format(parseDate(end), "yyyy-MM-dd");
      if (date !== endDate) {
        const empName = pickCol(g, EMPLOYEE_NAME_COLS);
        logger.debug(`EXCLUDING overnight visit: ${empName} - starts ${date}, ends ${endDate} (night/multi-day excluded)`);
        continue; // Skip this visit entirely
      }
    }

    const empName = pickCol(g, EMPLOYEE_NAME_COLS);
    const name = normalizeName(empName);

    // Sum only positive/real pay hours
    const payRaw = pickCol(g, PAY_HOURS_COLS);
    let pay = Number(payRaw) || 0;

    // CRITICAL FIX: For office hours/shadowing, calculate duration from timestamps if pay is 0
    if (isOfficeHours && pay === 0 && start && end) {
      try {
        const calculatedDuration = hoursBetween(start, end);
        if (calculatedDuration > 0 && calculatedDuration < 24) {
          pay = calculatedDuration;
          logger.debug(`CALCULATED DURATION for office hours: ${pay}h (from timestamps)`);
        }
      } catch (e) {
        // Could not calculate duration, keep pay as 0
      }
    }

    if (isOfficeHours && pay > 0) {
      officeHoursIncluded++;
    }

    // Debug: Log office hours entries being added to scheduled totals
    if (isOfficeHours && pay > 0) {
      logger.debug(`DEBUG: Including office hours in scheduled total:`);
      logger.debug(`  Employee: ${g["Actual Employee Name"]} (normalized: ${name})`);
      logger.debug(`  Service Type: ${serviceType}`);
      logger.debug(`  Date: ${date}`);
      logger.debug(`  Pay Hours: ${pay}`);
      logger.debug(`  Map Key: ${name}|${date}`);
    }

    // Debug specific employee entries (case-insensitive)
    if (
      empName &&
      (empName.toLowerCase().includes("chloe") ||
        empName.toLowerCase().includes("mcclymont") ||
        empName.toLowerCase().includes("makala") ||
        empName.toLowerCase().includes("palmer") ||
        empName.toLowerCase().includes("campbell"))
    ) {
      logger.debug(`EMPLOYEE DEBUG - Processing entry:`);
      logger.debug(`  Original Name: ${empName}`);
      logger.debug(`  Normalized Name: ${name}`);
      logger.debug(`  Picked Start: ${start}`);
      logger.debug(`  Parsed Date: ${date}`);
      logger.debug(`  Raw Pay Hours: ${payRaw}`);
      logger.debug(`  Parsed Pay Hours: ${pay}`);
      logger.debug(`  Service Type: ${serviceType}`);
      logger.debug(`  Cancellation: "${cancelRaw}"`);
      logger.debug(`  isOfficeHours: ${isOfficeHours}`);
    }

    if (name && date && pay > 0) {
      const key = `${name}|${date}`;
      const existing = ghMap.get(key) || 0;
      const newTotal = existing + pay;
      ghMap.set(key, newTotal);

      if (empName && (
        empName.toLowerCase().includes("makala") || 
        empName.toLowerCase().includes("chloe") || 
        empName.toLowerCase().includes("mcclymont") ||
        empName.toLowerCase().includes("palmer") ||
        empName.toLowerCase().includes("campbell")
      )) {
        logger.debug(
          `  Added to map: ${key} = ${existing} + ${pay} = ${newTotal}`,
        );
      }

      // Also log for office hours to verify they're being added
      if (isOfficeHours) {
        logger.debug(
          `  Office hours added to map: ${key} = ${existing} + ${pay} = ${newTotal}`,
        );
      }
    } else {
      if (empName && (empName.toLowerCase().includes("makala") || empName.toLowerCase().includes("chloe") || empName.toLowerCase().includes("mcclymont"))) {
        logger.debug(`  Skipped: name=${!!name}, date=${!!date}, pay=${pay}`);
      }
    }
  }

  logger.debug(`\nSCHEDULED HOURS FILTERING SUMMARY:`);
  logger.debug(`  Total guaranteed hours entries: ${totalProcessed}`);
  logger.debug(`  Filtered cancelled entries: ${filteredCancelled}`);
  logger.debug(
    `  Filtered "Multiple Care (Secondary)": ${filteredSecondary}`,
  );
  logger.debug(
    `  Filtered "Live In Care (SC)": ${filteredLiveInCare}`,
  );
  logger.debug(
    `  Office hours included in totals: ${officeHoursIncluded}`,
  );
  logger.debug(
    `  Valid entries for scheduling: ${totalProcessed - filteredCancelled - filteredSecondary - filteredLiveInCare}`,
  );

  // Debug: Show final scheduled hours for EVERYONE
  logger.debug(`\nFINAL SCHEDULED HOURS MAP (Full list for verification):`);
  const sortedEntries = Array.from(ghMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  sortedEntries.forEach(([key, hours]) => {
    logger.debug(`  ${key}: ${hours} hours`);
  });
  logger.debug(`=========================================\n`);

  return ghMap;
}

function buildClientScheduledHoursLookup(guaranteed: any[]): Map<string, number> {
  const ghMap = new Map<string, number>();

  const CLIENT_EXCLUDED_TYPES = [
    'multiple care (secondary)',
    'secondary',
    '(secondary)',
    'oncall',
    'on call',
    'office hours',
    'office',
    'training',
    'shadowing',
    'nights - sleep in',
    'sleep in',
    'nights - waking nights',
    'waking nights',
    'night',
    'overnight',
    'sleepover'
  ];

  for (const g of guaranteed || []) {
    const cancelRaw = pickCol(g, CANCEL_COLS);
    if (!isCancellationBlank(cancelRaw)) continue;

    const serviceTypeRaw = pickCol(g, SERVICE_TYPE_COLS);
    if (isSecondaryMultipleCare(serviceTypeRaw)) continue;
    if (isLiveInCare(serviceTypeRaw)) continue;

    const serviceType = serviceTypeRaw || "";
    const normalizedServiceType = String(serviceType)
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const isExcludedType = CLIENT_EXCLUDED_TYPES.some(excluded =>
      normalizedServiceType.includes(excluded.replace(/[^\w\s]/g, '').replace(/\s+/g, ' '))
    );
    if (isExcludedType) continue;

    const { start, end } = resolveServiceTimestamps(g);
    if (!start) continue;

    const date = format(parseDate(start), "yyyy-MM-dd");

    if (start && end) {
      const endDate = format(parseDate(end), "yyyy-MM-dd");
      if (date !== endDate) continue;
    }

    const empName = pickCol(g, EMPLOYEE_NAME_COLS);
    const name = normalizeName(empName);

    const payRaw = pickCol(g, PAY_HOURS_COLS);
    let pay = Number(payRaw) || 0;

    if (name && date && pay > 0) {
      const key = `${name}|${date}`;
      ghMap.set(key, (ghMap.get(key) || 0) + pay);
    }
  }

  return ghMap;
}

function getScheduledHoursForEmployeeAndDate(
  scheduledHoursMap: Map<string, number>,
  employeeName: string,
  dateStr: string,
): number {
  const normalizedName = normalizeName(employeeName);
  const key = `${normalizedName}|${dateStr}`;
  return scheduledHoursMap.get(key) || 0;
}

// Calculate hours between times exactly like your hours_between function
function hoursBetween(startTime: any, endTime: any): number {
  try {
    let startDate: Date, endDate: Date;

    // Handle different input types like pandas.to_datetime
    if (startTime instanceof Date) {
      startDate = startTime;
    } else if (typeof startTime === "number") {
      const excelEpoch = new Date(1899, 11, 30);
      startDate = new Date(
        excelEpoch.getTime() + startTime * 24 * 60 * 60 * 1000,
      );
    } else {
      startDate = new Date(startTime);
    }

    if (endTime instanceof Date) {
      endDate = endTime;
    } else if (typeof endTime === "number") {
      const excelEpoch = new Date(1899, 11, 30);
      endDate = new Date(excelEpoch.getTime() + endTime * 24 * 60 * 60 * 1000);
    } else {
      endDate = new Date(endTime);
    }

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return NaN;

    let diffHours =
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);

    // Handle overnight shifts - if end is earlier than start or on next day
    // We want the total duration (e.g. 22:00 to 07:00 = 9 hours)
    if (diffHours < 0) {
      diffHours += 24.0;
    }

    return Math.round(diffHours * 100) / 100;
  } catch {
    return NaN;
  }
}

// Levenshtein distance for better string matching
function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(null));

  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + 1,
        );
      }
    }
  }
  return matrix[len1][len2];
}

// Simple phonetic algorithm (Soundex-like)
function phonetic(name: string): string {
  if (!name) return "";

  let code = name.toUpperCase().replace(/[^A-Z]/g, "");
  if (!code) return "";

  // Keep first letter, replace consonants with numbers
  let result = code[0];
  const mapping: Record<string, string> = {
    BFPV: "1",
    CGJKQSXZ: "2",
    DT: "3",
    L: "4",
    MN: "5",
    R: "6",
  };

  for (let i = 1; i < code.length; i++) {
    const char = code[i];
    let found = false;
    for (const [chars, num] of Object.entries(mapping)) {
      if (chars.includes(char)) {
        if (result[result.length - 1] !== num) {
          result += num;
        }
        found = true;
        break;
      }
    }
    if (!found && "AEIOUHYW".includes(char)) {
      // Skip vowels except at start
    }
  }

  return result.padEnd(4, "0").substring(0, 4);
}

// Enhanced name matching with multiple algorithms
function getCloseMatches(
  target: string,
  choices: string[],
  cutoff: number = 0.7,
): Array<{ choice: string; score: number; confidence: number }> {
  if (!target) return [];

  const matches: Array<{ choice: string; score: number; confidence: number }> =
    [];
  const targetPhonetic = phonetic(target);

  for (const choice of choices) {
    if (!choice) continue;

    // Method 1: Token-based similarity (existing)
    const targetTokens = new Set(target.split(" "));
    const choiceTokens = new Set(choice.split(" "));
    const intersection = new Set(
      Array.from(targetTokens).filter((x) => choiceTokens.has(x)),
    );
    const union = new Set([
      ...Array.from(targetTokens),
      ...Array.from(choiceTokens),
    ]);
    const tokenSimilarity = intersection.size / union.size;

    // Method 2: Edit distance similarity
    const maxLen = Math.max(target.length, choice.length);
    const editSimilarity =
      maxLen === 0 ? 1 : 1 - levenshteinDistance(target, choice) / maxLen;

    // Method 3: Phonetic similarity
    const choicePhonetic = phonetic(choice);
    const phoneticSimilarity = targetPhonetic === choicePhonetic ? 1 : 0;

    // Combined score with weights
    const combinedScore =
      tokenSimilarity * 0.4 + editSimilarity * 0.4 + phoneticSimilarity * 0.2;

    // Confidence based on agreement between methods
    const methodScores = [tokenSimilarity, editSimilarity, phoneticSimilarity];
    const avgScore =
      methodScores.reduce((a, b) => a + b, 0) / methodScores.length;
    const variance =
      methodScores.reduce(
        (sum, score) => sum + Math.pow(score - avgScore, 2),
        0,
      ) / methodScores.length;
    const confidence = Math.max(0, 1 - Math.sqrt(variance));

    if (combinedScore >= cutoff) {
      matches.push({ choice, score: combinedScore, confidence });
    }
  }

  matches.sort((a, b) => b.score - a.score || b.confidence - a.confidence);
  return matches;
}

// Parse various date formats flexibly
function parseDate(dateStr: any): Date {
  if (!dateStr) {
    throw new Error("Date value is empty");
  }

  // Handle Excel date serial numbers
  if (typeof dateStr === "number") {
    const excelEpoch = new Date(1899, 11, 30); // Excel epoch
    return new Date(excelEpoch.getTime() + dateStr * 24 * 60 * 60 * 1000);
  }

  // Handle Date objects
  if (dateStr instanceof Date) {
    return dateStr;
  }

  // Handle string dates - try multiple formats
  const str = String(dateStr).trim();

  const formats = [
    "dd/MM/yyyy",
    "dd/MM/yy",
    "MM/dd/yyyy",
    "yyyy-MM-dd",
    "dd-MM-yyyy",
    "dd.MM.yyyy",
    "yyyy/MM/dd",
  ];

  for (const format of formats) {
    try {
      const parsed = parse(str, format, new Date());
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    } catch {
      // Continue to next format
    }
  }

  // Try native Date parsing as last resort
  try {
    const nativeDate = new Date(str);
    if (!isNaN(nativeDate.getTime())) {
      return nativeDate;
    }
  } catch {
    // Continue
  }

  throw new Error(`Could not parse date: ${dateStr}. Tried multiple formats.`);
}

// Parse and clean the data starting with CG Data as master employee list
// Define CG Data row interface
interface CGDataRow {
  "CAREGiver Name": string;
  "Weekly Hours": number;
  TransportModeDescription?: string;
  Title?: string;
  Gender?: string;
  PostCode?: string;
  [key: string]: any;
}

export async function parseExcelFiles(
  availabilityBuffer: Buffer,
  guaranteedBuffer: Buffer,
  cgDataBuffer: Buffer,
  ghWorkbookBuffer?: Buffer, // NEW: Add raw GH workbook buffer
  branchId?: string, // NEW: Add branchId for branch-scoped parsing
): Promise<{
  availability: ParsedAvailabilityRow[];
  guaranteed: GuaranteedHoursRow[];
  demand: ClientDemandRow[];
  cgData: CGDataRow[];
  warnings: string[];
  detectedBranch: string | null; // Add detectedBranch to the return type
}> {
  logger.debug(`\n===== PARSING EXCEL FILES FUNCTION STARTED =====`);
  logger.debug(
    `Buffer lengths: availability=${availabilityBuffer?.length}, guaranteed=${guaranteedBuffer?.length}, cgData=${cgDataBuffer?.length}`,
  );
  const warnings: string[] = [];

  // Parse Availability Export.xlsx
  const availabilityWorkbook = await XLSX.read(availabilityBuffer);
  const availabilitySheetName = AVAIL_SHEET;
  if (!availabilityWorkbook.SheetNames.includes(availabilitySheetName)) {
    throw new Error(
      `Sheet "${availabilitySheetName}" not found in Availability Export file`,
    );
  }

  const availabilitySheet = availabilityWorkbook.Sheets[availabilitySheetName];
  const availabilityData =
    XLSX.utils.sheet_to_json<AvailabilityRow>(availabilitySheet);

  // Parse Care Pro Guaranteed Hours.xlsx
  const guaranteedWorkbook = await XLSX.read(guaranteedBuffer);
  logger.debug(`Guaranteed workbook sheets available:`, guaranteedWorkbook.SheetNames);
  
  const guaranteedSheetName = GUAR_SHEET;
  if (!guaranteedWorkbook.SheetNames.includes(guaranteedSheetName)) {
    throw new Error(
      `Sheet "${guaranteedSheetName}" not found in Care Pro Guaranteed Hours file. Available sheets: ${guaranteedWorkbook.SheetNames.join(', ')}`,
    );
  }

  const guaranteedSheet = guaranteedWorkbook.Sheets[guaranteedSheetName];
  
  // Parse Guaranteed Hours SAME WAY as CG Data - with defval for missing cells
  const guaranteedData = XLSX.utils.sheet_to_json<GuaranteedHoursRow>(guaranteedSheet, {
    defval: "", // Same as CG Data parsing - handle missing cells gracefully
  });
  
  logger.debug(`Guaranteed Hours sheet parsed: ${guaranteedData.length} rows found`);
  logger.debug(`Branch context: ${branchId || 'NO BRANCH ID'}`);
  if (guaranteedData.length > 0) {
    logger.debug(`First row columns:`, Object.keys(guaranteedData[0]).slice(0, 15));
    logger.debug(`First row sample:`, JSON.stringify(guaranteedData[0]).substring(0, 400));
  }

  // === Calculate demand from Guaranteed Hours data ===
  logger.debug(`Calculating demand from Guaranteed Hours data...`);

  // Apply SAME filtering rules as service-delivery-rules.ts for consistency
  // Note: Night shifts are now INCLUDED for capacity display
  const EXCLUDED_TYPES = [
    'office hours',
    'office',
    'multiple care (secondary)',
    'secondary',
    '(secondary)',
    'shadowing',
    'oncall',  // normalized version (hyphen removed by norm())
    'on call',  // space-separated version
    'training',  // training sessions
    'live in care (sc)',
    'live in care',
    'live-in care'
  ];

  const demandRows = guaranteedData.filter(row => {
    // Rule 1: Skip cancelled visits (same as service-delivery-rules.ts)
    const cancellation = row["Cancellation Description"];
    const isCancelled = cancellation && String(cancellation).trim().length > 0;
    if (isCancelled) return false;

    // Rule 2: Skip secondary care using robust check
    if (isSecondaryMultipleCare(row["Actual Service Type Description"] || "")) return false;

  // Rule 3: Skip excluded service types (using normalized matching like service-delivery-rules.ts)
  const serviceType = row["Actual Service Type Description"] || "";
  const normalizedServiceType = String(serviceType)
    .toLowerCase()
    .replace(/[^\w\s]/g, '')  // Remove special chars
    .replace(/\s+/g, ' ')      // Normalize spaces
    .trim();

  // EXCLUDE CANCELLED, SECONDARY, OFFICE, TRAINING, SHADOWING, AND NIGHT SHIFTS
  // Night shifts are EXCLUDED from Client Required calculation
  const DEMAND_EXCLUDED_TYPES = [
    'multiple care (secondary)',
    'secondary',
    '(secondary)',
    'oncall',
    'on call',
    'office hours',
    'office',
    'training',
    'shadowing',
    'nights - sleep in',
    'sleep in',
    'nights - waking nights',
    'waking nights',
    'night',
    'overnight',
    'sleepover'
  ];

  const isExcludedType = DEMAND_EXCLUDED_TYPES.some(excluded =>
    normalizedServiceType.includes(excluded.replace(/[^\w\s]/g, '').replace(/\s+/g, ' '))
  );

  if (isExcludedType) return false;

    return true;
  });

  // Log filtering breakdown (same detail as service-delivery-rules.ts)
  const totalFiltered = guaranteedData.length - demandRows.length;
  logger.debug(
    `DEMAND FILTERING (INCLUSIVE): Excluded ${totalFiltered} rows from ${guaranteedData.length} total Guaranteed Hours entries`,
  );

  // Show breakdown by exclusion type WITH HOURS
  const cancelledRows = guaranteedData.filter(row => {
    const cancellation = row["Cancellation Description"];
    return cancellation && String(cancellation).trim().length > 0;
  });
  const cancelledHours = cancelledRows.reduce((sum, r) => sum + (Number(r["Planned Duration"]) || 0), 0);

  const secondaryRows = guaranteedData.filter(row =>
    isSecondaryMultipleCare(row["Actual Service Type Description"] || "")
  );
  const secondaryHours = secondaryRows.reduce((sum, r) => sum + (Number(r["Planned Duration"]) || 0), 0);

  logger.debug(`  Cancelled: ${cancelledRows.length} rows (${Math.round(cancelledHours * 100) / 100}h)`);
  logger.debug(`  Secondary care: ${secondaryRows.length} rows (${Math.round(secondaryHours * 100) / 100}h)`);
  logger.debug(`  Night shifts: EXCLUDED from demand calculation`);
  logger.debug(`  Office hours, Training, Shadowing: EXCLUDED as requested`);

  // Group by weekday and sum duration
  const hoursByWeekday = new Map<string, number>();
  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  demandRows.forEach(row => {
    // Use PLANNED columns as requested by user
    const plannedStart = row["Planned Start Date And Time"];
    if (!plannedStart) return;

    const startDate = parseDate(plannedStart);
    const plannedEnd = row["Planned End Date And Time"];
    
    // EXCLUDE overnight/midnight-crossing visits from demand (Client Required)
    if (plannedEnd) {
      const endDate = parseDate(plannedEnd);
      if (format(startDate, "yyyy-MM-dd") !== format(endDate, "yyyy-MM-dd")) {
        if (demandRows.indexOf(row) < 10) {
          logger.debug(`  EXCLUDING overnight visit from demand: ${row["Actual Employee Name"]} starts ${format(startDate, "yyyy-MM-dd HH:mm")} ends ${format(endDate, "yyyy-MM-dd HH:mm")}`);
        }
        return;
      }
    }

    const weekdayName = weekdayNames[startDate.getDay()];

    // Use PLANNED DURATION column as primary source
    const durationCols = [
      "Planned Duration",  // Primary column as requested
      "Duration (Planned)",
      "Duration",
      "Planned Hrs",
      "Planned Hours",
      "Planned Time",
    ];

    let duration = 0;
    let foundColumn = "";
    for (const col of durationCols) {
      const rawVal = row[col];
      const val = Number(rawVal);
      if (val && isFinite(val) && val > 0) {
        duration = val;
        foundColumn = col;
        break;
      }
    }

    // Debug: Log first 10 entries to verify fractional hours are being captured
    const currentTotal = hoursByWeekday.get(weekdayName) || 0;
    if (demandRows.indexOf(row) < 10) {
      logger.debug(`  Row ${demandRows.indexOf(row) + 1}: ${weekdayName} - ${duration}h from "${foundColumn}" (running total: ${currentTotal + duration}h)`);
    }

    // If no duration found in preferred columns, this visit won't count toward demand
    if (duration > 0) {
      hoursByWeekday.set(weekdayName, currentTotal + duration);
    } else if (demandRows.indexOf(row) < 10) {
      logger.debug(`  Row ${demandRows.indexOf(row) + 1}: NO DURATION FOUND - checked columns: ${durationCols.join(", ")}`);
    }
  });

  const hoursByWeekdayArray = Array.from(hoursByWeekday.entries())
    .map(({0: weekday, 1: hours}) => ({ weekday, hours: Math.round(hours * 100) / 100 }))
    .sort((a, b) => a.weekday.localeCompare(b.weekday));

  logger.debug(`Calculated demand from Guaranteed Hours:`, hoursByWeekdayArray);
  logger.debug(`Total demand rows after filtering: ${demandRows.length}`);

  // Parse CG Data Export.xlsx (Master Employee List) — robust sheet detection
  const cgDataWorkbook = await XLSX.read(cgDataBuffer);
  const cgDataSheetName = getCGSheetName(cgDataWorkbook);
  const cgDataSheet = cgDataWorkbook.Sheets[cgDataSheetName];
  const cgRowsRaw = XLSX.utils.sheet_to_json<Record<string, any>>(cgDataSheet, {
    defval: "",
  });

  logger.debug(`CG Data sheet names available:`, cgDataWorkbook.SheetNames);
  logger.debug(`Using sheet: "${cgDataSheetName}"`);
  logger.debug(`Raw CG Data rows: ${cgRowsRaw.length}`);
  if (cgRowsRaw.length > 0) {
    logger.debug(`First raw CG Data row:`, cgRowsRaw[0]);
    logger.debug(`Available columns:`, Object.keys(cgRowsRaw[0]));
  }

  // Build name from CAREGiver Name OR First+Last; accept multiple weekly-hours aliases
  const cgData = cgRowsRaw
    .map((row) => {
      const name =
        pickCol(row, ["CAREGiver Name"]) ||
        `${pickCol(row, ["First Name"]) || ""} ${pickCol(row, ["Last Name"]) || ""}`.trim();

      const weeklyRaw = pickCol(row, [
        "Weekly Hours",
        "Hours Per Week",
        "Hours per week",
        "Contracted Weekly Hours",
        "Contracted Hours",
        "Hours Contracted",
      ]);

      const transportMode =
        pickCol(row, [
          "TransportModeDescription",
          "Transport Mode Description",
          "Transport Mode",
          "Transport",
        ]) || "";

      const title =
        pickCol(row, ["Title", "Employee Title", "Title Description"]) || "";

      const postCode =
        pickCol(row, ["Post Code", "PostCode", "Postal Code", "ZIP Code", "Zip Code"]) || "";

      // Determine gender from title
      const gender = (() => {
        const titleLower = title.toLowerCase().trim();
        if (titleLower === "mr") return "male";
        if (["miss", "ms", "mrs"].includes(titleLower)) return "female";
        return ""; // Unknown/not specified
      })();

      const weekly = Number(weeklyRaw ?? 0);
      return {
        "CAREGiver Name": name,
        "Weekly Hours": isFinite(weekly) ? weekly : 0,
        TransportModeDescription: transportMode,
        Title: title,
        Gender: gender,
        PostCode: postCode,
      };
    })
    .filter((r) => r["CAREGiver Name"] && r["Weekly Hours"] > 0);

  logger.debug(
    `CG Data: ${cgRowsRaw.length} rows → ${cgData.length} employees with weekly hours (sheet: ${cgDataSheetName})`,
  );
  if (cgData.length > 0) {
    logger.debug(`First processed CG Data row:`, cgData[0]);

    // Show gender extraction stats for debugging
    const genderStats = cgData.reduce((acc, emp) => {
      const g = emp.Gender || "unknown";
      acc[g] = (acc[g] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    logger.debug(`Gender distribution:`, genderStats);

    // Show sample employees with their Title and Gender
    const samplesWithGender = cgData.slice(0, 5).map(emp => ({
      name: emp["CAREGiver Name"],
      title: emp.Title,
      gender: emp.Gender || "unknown"
    }));
    logger.debug(`Sample employees loaded: ${samplesWithGender.length} records`);
  } else {
    logger.debug(`No valid CG Data rows found - check column names and data`);
  }

  // Process availability data
  // Pass 1: scan all Available rows to build two sets keyed by "cpName|yyyy-MM-dd".
  //
  //   sameDayAvailKeys   – CP+dates that have at least one genuine same-calendar-day
  //                        Available entry (start and end on the same date).
  //   midnightAvailDates – CP+dates that have at least one midnight-crossing Available
  //                        entry (start and end on different calendar dates).
  //
  // From these we derive:
  //   rejectedDateKeys   – CP+dates whose Available data is midnight-crossing AND has no
  //                        same-day fallback.  Every entry (any type, including Holiday/Sick)
  //                        for these CP+dates is rejected, because the availability data is in
  //                        an unsupported overnight format — we don't trust any status for
  //                        those dates.
  //
  // IMPORTANT: use calendar-date string comparison (not differenceInDays) because overnight
  // entries like 20:00→08:00 next day are only 12 hours apart so differenceInDays returns 0.
  const sameDayAvailKeys   = new Set<string>();
  const midnightAvailDates = new Set<string>();

  for (const row of availabilityData) {
    try {
      if (!row["CAREGiver Name"] || !row["Start Date"]) continue;
      const canonStatus = canonicalStatus(row.Type ?? row.Status ?? "");
      if (canonStatus !== "Available" && canonStatus !== "Ad-hoc") continue;
      const parsedStartDate = parseDate(row["Start Date"]);
      const startCalDate = format(parsedStartDate, "yyyy-MM-dd");
      const key = `${row["CAREGiver Name"]}|${startCalDate}`;

      if (row["End Date"]) {
        const parsedEndDate = parseDate(row["End Date"]);
        if (format(parsedStartDate, "yyyy-MM-dd") !== format(parsedEndDate, "yyyy-MM-dd")) {
          midnightAvailDates.add(key); // midnight-crossing — not a valid same-day entry
          continue;
        }
      }
      sameDayAvailKeys.add(key); // genuine same-calendar-day Available
    } catch { /* ignore parse errors in pass 1 */ }
  }

  // CP+dates where Available is only midnight-crossing (no same-day fallback):
  // reject EVERYTHING for these dates, regardless of entry type.
  const rejectedDateKeys = new Set<string>();
  for (const key of midnightAvailDates) {
    if (!sameDayAvailKeys.has(key)) rejectedDateKeys.add(key);
  }

  // Pass 2: full validation loop
  const validatedAvailability: ParsedAvailabilityRow[] = [];
  availabilityData.forEach((row, index) => {
    try {
      if (!row["CAREGiver Name"] || !row["Start Date"]) {
        warnings.push(`Availability row ${index + 1}: Missing required fields`);
        return;
      }

      const empName = row["CAREGiver Name"]; // For logging
      const parsedStartDate = parseDate(row["Start Date"]);
      const startCalDate = format(parsedStartDate, "yyyy-MM-dd");

      // Gate: if this CP+date is in rejectedDateKeys (only midnight-crossing Available exists,
      // no same-day Available), reject ALL entries for this date — any type, including Holiday.
      const entryDateKey = `${empName}|${startCalDate}`;
      if (rejectedDateKeys.has(entryDateKey)) {
        logger.debug(`Rejecting all entries for ${empName} on ${startCalDate} — overnight-only availability format (unsupported)`);
        return;
      }

      // Determine canonical status early so we can decide how to handle multi-day entries
      const canonStatus = canonicalStatus(row.Type ?? row.Status ?? "");
      const isDayKiller = DAY_KILLERS.has(canonStatus);

      // HANDLE entries that cross a calendar-date boundary (overnight OR multi-day).
      // IMPORTANT: use calendar-date strings, NOT differenceInDays, because overnight
      // entries like 20:00→08:00 next day have fewer than 24 hrs between them so
      // differenceInDays() returns 0 — they would slip through undetected.
      if (row["End Date"]) {
        try {
          const parsedEndDate = parseDate(row["End Date"]);
          const startCalDate = format(parsedStartDate, "yyyy-MM-dd");
          const endCalDate   = format(parsedEndDate,   "yyyy-MM-dd");
          const crossesMidnight = startCalDate !== endCalDate;

          if (crossesMidnight) {
            if (isDayKiller) {
              // Only expand if the same CP has a genuine same-calendar-day Available entry
              // on the starting day — guards against overnight Holiday+Available artefacts
              // (e.g. overnight care workers whose vacation process created both blocks).
              const diffInDays = Math.max(1, Math.abs(differenceInDays(parsedEndDate, parsedStartDate)));
              const daysToExpand = Math.min(diffInDays, 14); // safety cap
              let expanded = 0;
              for (let d = 0; d < daysToExpand; d++) {
                const dayDate = addDays(parsedStartDate, d);
                const key = `${empName}|${format(dayDate, "yyyy-MM-dd")}`;
                if (!sameDayAvailKeys.has(key)) {
                  logger.debug(`Skipping ${canonStatus} expansion for ${empName} on ${format(dayDate, "yyyy-MM-dd")} — no same-calendar-day Available entry`);
                  continue;
                }
                validatedAvailability.push({
                  ...row,
                  parsedDate: dayDate,
                  calculatedHours: 24,
                  "Time Window(s)": "", // full-day — no time-window constraint
                });
                expanded++;
              }
              if (expanded > 0) {
                logger.debug(`Expanded midnight-crossing ${canonStatus} for ${empName} into ${expanded} daily entries`);
              }
            } else {
              // Non-day-killer entries crossing midnight (overnight Available, etc.) are rejected
              logger.debug(`REJECTING midnight-crossing availability for ${empName}: ${startCalDate}→${endCalDate}`);
              warnings.push(
                `Availability row ${index + 1} (${empName}): Rejected - entry crosses midnight (${startCalDate}→${endCalDate}). Only same-day availability is supported.`,
              );
            }
            return;
          }
        } catch (endDateError) {
          logger.debug(`Could not parse end date for ${empName}, continuing with start date validation`);
        }
      }

      const effectiveHours =
        row.Hours ?? hoursBetween(row["Start Time"], row["End Time"]);

      if (isNaN(effectiveHours)) {
        warnings.push(
          `Availability row ${index + 1}: Cannot calculate hours from time range`,
        );
        return;
      }

      // Parse availability windows using enhanced logic
      const rawWindows = row["Time Window(s)"] || row["Time Window"] || "";
      let timeWindows = "";

      if (typeof rawWindows === "string" && rawWindows.trim()) {
        // Split multiple windows by semicolon or comma
        const windows = rawWindows
          .split(/[;,]/)
          .map((w) => w.trim())
          .filter((w) => w);

        // Process each window
        const processedWindows = windows
          .map((w) => {
            // Handle combined format like "08:00 - 12:00"
            const match = w.match(
              /(\d{1,2}:\d{2})\s*[\-–—]\s*(\d{1,2}:\d{2})/,
            );
            if (match) {
              const startTime = match[1].padStart(5, "0");
              const endTime = match[2].padStart(5, "0");

              // Include night shifts for daily capacity display
              // Overnight windows crossing midnight are still valid for capacity tracking
              return `${startTime}-${endTime}`;
            }
            return null;
          })
          .filter((w): w is string => w !== null);

        timeWindows = processedWindows.join(", ");
      } else {
        // Fallback to buildTimeWindow if raw string parsing fails
        const builtWindow = buildTimeWindow(row);

        // Include night shifts for daily capacity display
        if (builtWindow) {
          timeWindows = builtWindow;
        }
      }


      validatedAvailability.push({
        ...row,
        parsedDate: parsedStartDate,
        calculatedHours: effectiveHours,
        "Time Window(s)": timeWindows, // Update with filtered windows
      });
    } catch (error) {
      warnings.push(
        `Availability row ${index + 1}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  });

  // Process guaranteed hours data
  const validatedGuaranteed: GuaranteedHoursRow[] = [];
  let filteredSecondaryCount = 0;
  guaranteedData.forEach((row, index) => {
    try {
      // Use fallback resolver (SR -> Actual -> Planned)
      const { start, end } = resolveServiceTimestamps(row);

      // Check for service type FIRST - shadowing/office hours have relaxed validation
      const serviceType = row["Actual Service Type Description"] || row["Service Type Description"] || "";
      const lowerType = String(serviceType).toLowerCase();

      const isOfficeHours = lowerType && (
        lowerType.includes('office') ||
        lowerType.includes('training') ||
        lowerType.includes('shadowing') ||
        lowerType.includes('shadow') ||
        lowerType.includes('internal') ||
        lowerType.includes('meeting') ||
        lowerType.includes('admin')
      );

      // For office hours/shadowing: only require employee name and timestamps
      // For regular visits: require all numeric fields
      const empName = row["Actual Employee Name"] || row["Planned Employee Name"];
      
      // Night shifts are EXCLUDED from both capacity AND scheduled hours
      // Check if this is a night shift entry and exclude it
      const isNightShift = lowerType && (
        lowerType.includes('night') ||
        lowerType.includes('sleep in') ||
        lowerType.includes('waking') ||
        lowerType.includes('overnight') ||
        lowerType.includes('sleepover')
      );
      
      if (isNightShift) {
        logger.debug(`EXCLUDING night shift from capacity: ${empName} - ${serviceType}`);
        return; // Skip night shift entries
      }
      const payHours = Number(row["Actual Pay Rate Hours"]) || 0;
      
      // Debug logging for tracked employees
      if (empName && (
        String(empName).toLowerCase().includes("chloe") || String(empName).toLowerCase().includes("mcclymont") ||
        String(empName).toLowerCase().includes("palmer") || String(empName).toLowerCase().includes("campbell")
      )) {
        logger.debug(`TRACKED EMPLOYEE VALIDATION CHECK (row ${index + 1}):`);
        logger.debug(`  Service Type: "${serviceType}"`);
        logger.debug(`  isOfficeHours: ${isOfficeHours}`);
        logger.debug(`  isNightShift: ${isNightShift}`);
        logger.debug(`  Actual Employee Name: "${row["Actual Employee Name"]}"`);
        logger.debug(`  Planned Employee Name: "${row["Planned Employee Name"]}"`);
        logger.debug(`  empName (resolved): "${empName}"`);
        logger.debug(`  Pay Hours Raw: "${row["Actual Pay Rate Hours"]}" -> ${payHours}`);
        logger.debug(`  Hours Per Week: "${row["Actual Employee Hours Per Week"]}"`);
        logger.debug(`  Start: "${start}", End: "${end}"`);
        logger.debug(`  Cancellation: "${row["Cancellation Description"]}"`);
      }

      if (isOfficeHours) {
        // Relaxed validation for office/training/shadowing: just need employee name and timestamps
        if (!empName || !start || !end) {
          warnings.push(
            `Guaranteed hours row ${index + 1}: Office/shadowing row missing employee name or timestamps`,
          );
          return;
        }
      } else {
        // Standard validation for regular visits
        // Use empName (which falls back to Planned Employee Name) instead of only Actual Employee Name
        // Pay hours validation is handled downstream by buildScheduledHoursLookup (only adds pay > 0)
        if (
          !empName ||
          !start ||
          !end
        ) {
          if (!empName) {
            logger.debug(`Guaranteed hours row ${index + 1}: SKIPPED - Missing employee name (Actual: "${row["Actual Employee Name"]}", Planned: "${row["Planned Employee Name"]}")`);
          } else {
            logger.debug(`Guaranteed hours row ${index + 1} (${empName}): SKIPPED - Missing timestamps (Start: ${start}, End: ${end})`);
          }
          
          warnings.push(
            `Guaranteed hours row ${index + 1}: Missing or invalid required fields`,
          );
          return;
        }
      }

      // Robust cancellation/secondary checks (match Hours by Service Type.xlsx)
      const isCancelOk = isCancellationBlank(row["Cancellation Description"]);
      const isSecondary = isSecondaryMultipleCare(
        row["Actual Service Type Description"] || "",
      );

      // Check for dummy/planning-only rows (often have keywords in name)
      const clientName = (pickCol(row, CLIENT_COLS) || "").toLowerCase();

      // Note: Night shifts are EXCLUDED from Daily Capacity Summary and scheduling
      // Cancellation check remains in place
      
      if (isSecondary) {
        filteredSecondaryCount++;
        return;
      }
      
      // Night shifts are filtered out above, secondary care is filtered here
      
      if (!isCancelOk) {
        return;
      }
      
      if (empName && (
        String(empName).toLowerCase().includes("chloe") || String(empName).toLowerCase().includes("mcclymont") ||
        String(empName).toLowerCase().includes("palmer") || String(empName).toLowerCase().includes("campbell")
      )) {
        logger.debug(`  TRACKED EMPLOYEE ROW ${index + 1} (${empName}) PASSED VALIDATION - adding to validatedGuaranteed`);
      }

      validatedGuaranteed.push(row);
    } catch (error) {
      warnings.push(
        `Guaranteed hours row ${index + 1}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  });

  logger.debug(
    `SECONDARY CLIENT FILTERING: Excluded ${filteredSecondaryCount} rows with service descriptions from ${guaranteedData.length} total Care Pro entries`,
  );

  // === Map calculated demand to actual dates ===
  const validatedDemand: ClientDemandRow[] = [];

  // Extract actual dates from availability and guaranteed hours data
  const actualDates = new Set<string>();

  // Get dates from availability data
  validatedAvailability.forEach((row) => {
    const dateStr = format(row.parsedDate, "yyyy-MM-dd");
    actualDates.add(dateStr);
  });

  // Get dates from guaranteed hours data - ONLY use START date
  // This prevents overnight visits from adding spillover dates
  validatedGuaranteed.forEach((row) => {
    try {
      // Use the same robust timestamp resolution as the filtering
      const { start } = resolveServiceTimestamps(row);
      if (!start) return;

      const startDate = parseGuaranteedDate(start);
      // Only add the START date - overnight visits count on their start date
      const dateStr = format(startDate, "yyyy-MM-dd");
      actualDates.add(dateStr);
    } catch (error) {
      // Skip invalid dates
    }
  });

  // Create weekday to actual dates mapping
  let actualDatesArray = Array.from(actualDates).sort();
  
  // Determine the core reporting week (7 consecutive days)
  // If we have more than 7 dates, find the core week and filter out spillover dates
  if (actualDatesArray.length > 7) {
    logger.debug(`\nDETECTING WEEK BOUNDARY (${actualDatesArray.length} dates found):`);
    
    // Find the 7-day window with the most data coverage
    // Strategy: Take the last 7 dates as the "core" week (most recent complete week)
    // This handles cases where overnight visits from previous day spill into the data
    const sortedDates = [...actualDatesArray].sort();
    
    // Check if first date is a spillover from overnight shift
    // A spillover date is typically 1 day before a contiguous 7-day block
    if (sortedDates.length > 7) {
      const firstDate = new Date(sortedDates[0]);
      const secondDate = new Date(sortedDates[1]);
      const lastDate = new Date(sortedDates[sortedDates.length - 1]);
      
      // Calculate if there's exactly 7 days from second to last date
      const daysBetweenSecondAndLast = Math.round(
        (lastDate.getTime() - secondDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      
      // Check if first date is exactly 1 day before second date (spillover candidate)
      const daysBetweenFirstAndSecond = Math.round(
        (secondDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      
      if (daysBetweenFirstAndSecond === 1 && daysBetweenSecondAndLast === 6) {
        // First date is a spillover - remove it
        logger.debug(`  Detected spillover date: ${sortedDates[0]} (removed)`);
        logger.debug(`  Core week: ${sortedDates[1]} to ${sortedDates[sortedDates.length - 1]}`);
        actualDatesArray = sortedDates.slice(1);
        
        // Also remove this date from actualDates set for consistency
        actualDates.delete(sortedDates[0]);
      } else if (sortedDates.length === 8) {
        // If we have exactly 8 dates, check if last date is spillover (overnight ending next day)
        const secondToLastDate = new Date(sortedDates[sortedDates.length - 2]);
        const daysBetweenFirstAndSecondToLast = Math.round(
          (secondToLastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        
        if (daysBetweenFirstAndSecondToLast === 6) {
          // Last date is spillover - remove it
          logger.debug(`  Detected spillover date: ${sortedDates[sortedDates.length - 1]} (removed)`);
          logger.debug(`  Core week: ${sortedDates[0]} to ${sortedDates[sortedDates.length - 2]}`);
          actualDatesArray = sortedDates.slice(0, -1);
          actualDates.delete(sortedDates[sortedDates.length - 1]);
        }
      }
    }
  }
  
  const weekdayToActualDates: Record<string, string[]> = {
    Monday: [],
    Tuesday: [],
    Wednesday: [],
    Thursday: [],
    Friday: [],
    Saturday: [],
    Sunday: [],
  };

  actualDatesArray.forEach((dateStr) => {
    const date = new Date(dateStr);
    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const weekdayName = dayNames[date.getDay()];
    if (weekdayToActualDates[weekdayName]) {
      weekdayToActualDates[weekdayName].push(dateStr);
    }
  });

  logger.debug(`\nACTUAL DATES FOUND IN FILES:`);
  logger.debug(`  Total unique dates: ${actualDatesArray.length}`);
  logger.debug(
    `  Date range: ${actualDatesArray[0]} to ${actualDatesArray[actualDatesArray.length - 1]}`,
  );

  logger.debug(`\nWEEKDAY TO ACTUAL DATES MAPPING:`);
  Object.entries(weekdayToActualDates).forEach(([weekday, dates]) => {
    logger.debug(
      `  ${weekday}: ${dates.length > 0 ? dates.join(", ") : "No dates found"}`,
    );
  });
  logger.debug(`================================\n`);

  // Map weekday hours to actual dates from the files
  hoursByWeekdayArray.forEach(({ weekday, hours }) => {
    const actualDatesForWeekday = weekdayToActualDates[weekday] || [];

    if (actualDatesForWeekday.length === 0) {
      logger.debug(
        ` No actual dates found for ${weekday} (${hours}h) - skipping`,
      );
      return;
    }

    // If there are multiple dates for this weekday, distribute hours evenly
    const hoursPerDate =
      actualDatesForWeekday.length > 1
        ? Math.round((hours / actualDatesForWeekday.length) * 100) /
          100
        : hours;

    actualDatesForWeekday.forEach((dateStr) => {
      logger.debug(`Mapping: ${weekday} (${hoursPerDate}h) -> ${dateStr}`);
      validatedDemand.push({
        Date: dateStr,
        "Required Client Hours": hoursPerDate,
      });
    });
  });

  // Summary logging
  const totalHours = hoursByWeekdayArray.reduce((sum, { hours }) => sum + hours, 0);
  const mondayHours =
    hoursByWeekdayArray.find(({ weekday }) => weekday === "Monday")?.hours || 0;

  logger.debug(`\n===== DEMAND CALCULATION SUMMARY =====`);
  logger.debug(
    `Calculated from ${demandRows.length} Guaranteed Hours entries`,
  );
  logger.debug(`Monday hours: ${mondayHours}`);
  logger.debug(`Total hours: ${totalHours}`);
  logger.debug(`=======================================\n`);

  // === BRANCH EXTRACTION AND VALIDATION ===
  logger.debug(`\n===== BRANCH DETECTION =====`);

  const branchesDetected = new Set<string>();

  // Extract from CG Data Export (most reliable source)
  if (cgRowsRaw.length > 0) {
    const sampleBranches = cgRowsRaw.slice(0, 5).map(row => extractBranchFromRow(row)).filter(Boolean);
    sampleBranches.forEach(b => b && branchesDetected.add(normalizeBranchName(b)));
    logger.debug(`CG Data sample branches: ${sampleBranches.join(", ")}`);
  }

  // Extract from Guaranteed Hours
  if (guaranteedData.length > 0) {
    const sampleBranches = guaranteedData.slice(0, 5).map(row => extractBranchFromRow(row)).filter(Boolean);
    sampleBranches.forEach(b => b && branchesDetected.add(normalizeBranchName(b)));
    logger.debug(`Guaranteed Hours sample branches: ${sampleBranches.join(", ")}`);
  }

  // Extract from Availability
  if (availabilityData.length > 0) {
    const sampleBranches = availabilityData.slice(0, 5).map(row => extractBranchFromRow(row)).filter(Boolean);
    sampleBranches.forEach(b => b && branchesDetected.add(normalizeBranchName(b)));
    logger.debug(`Availability sample branches: ${sampleBranches.join(", ")}`);
  }

  const detectedBranches = Array.from(branchesDetected);
  logger.debug(`Detected branches: ${detectedBranches.join(", ")}`);

  let detectedBranch: string | null = null;
  if (detectedBranches.length === 0) {
    warnings.push("No branch information found in Excel files. Branch column may be missing.");
    logger.debug(`WARNING: No branch detected - files may be missing branch column`);
  } else if (detectedBranches.length > 1) {
    warnings.push(`Multiple branches detected: ${detectedBranches.join(", ")}. Files may be mixed.`);
    logger.debug(`WARNING: Multiple branches detected - potential data mixing!`);
    detectedBranch = detectedBranches[0]; // Use the first detected branch as a fallback
  } else {
    detectedBranch = detectedBranches[0];
  }
  logger.debug(`Final detected branch: ${detectedBranch || "NONE"}`);
  logger.debug(`=======================================\n`);

  return {
    availability: validatedAvailability,
    guaranteed: validatedGuaranteed,
    demand: validatedDemand,
    cgData,
    warnings,
    detectedBranch, // Return the detected branch
  };
}

// Process and clean the data starting with CG Data as master employee list
export async function processCapacityData(
  availability: ParsedAvailabilityRow[],
  guaranteed: GuaranteedHoursRow[],
  demand: ClientDemandRow[],
  cgData: CGDataRow[],
  options?: { ghWorkbookBuffer?: Buffer; branchId?: string }, // ← NEW optional params
): Promise<ProcessingResult & { cleanedRecords: CleanedEmployeeRecord[] }> {
  const warnings: string[] = [];
  const branchId = options?.branchId;

  // REVOLUTIONARY CHANGE: Start with CG Data as master employee list
  logger.debug(`\n🚀 ===== USING CG DATA AS MASTER EMPLOYEE LIST =====`);
  logger.debug(`Total employees in CG Data: ${cgData.length}`);

  // Log sample CG Data entries
  if (cgData.length > 0) {
    logger.debug(`Sample CG Data entries:`);
    cgData.slice(0, 3).forEach((emp, idx) => {
      logger.debug(
        `  ${idx + 1}. ${emp["CAREGiver Name"]} - ${emp["Weekly Hours"]} hours/week`,
      );
    });
  }

  // Debug: Check what demand data we received from filtering
  logger.debug(`\n===== RECEIVED DEMAND DATA =====`);
  let totalDemandHours = 0;
  demand.forEach((row) => {
    logger.debug(`  - ${row.Date}: ${row["Required Client Hours"]} hours`);
    totalDemandHours += row["Required Client Hours"];
  });
  logger.debug(
    `TOTAL DEMAND HOURS FROM FILTERING: ${Math.round(totalDemandHours * 100) / 100} (Expected: 400.33)`,
  );
  logger.debug(`================================\n`);

  // Build scheduled hours lookup from guaranteed hours data (using exact logic from attached file)
  logger.debug(`\nDEBUG: About to call buildScheduledHoursLookup with ${guaranteed.length} guaranteed rows`);

  // Debug: Check if office hours exist in the data
  const officeRows = guaranteed.filter(row => {
    const serviceType = (row["Actual Service Type Description"] || "").toString().toLowerCase();
    return serviceType.includes("office");
  });
  logger.debug(`DEBUG: Found ${officeRows.length} office hours rows in guaranteed data`);
  if (officeRows.length > 0) {
    logger.debug(`DEBUG: Sample office hours rows:`, officeRows.slice(0, 3).map(r => ({
      employee: r["Actual Employee Name"],
      serviceType: r["Actual Service Type Description"],
      hours: r["Actual Pay Rate Hours"]
    })));
  }

  const scheduledHoursMap = buildScheduledHoursLookup(guaranteed);
  const clientScheduledHoursMap = buildClientScheduledHoursLookup(guaranteed);

  // VERIFICATION: Show what's in the scheduled hours map
  logger.debug(`\nSCHEDULED HOURS MAP VERIFICATION:`);
  logger.debug(`  Total entries in map: ${scheduledHoursMap.size}`);
  
  // Show first 10 entries
  let count = 0;
  for (const [key, hours] of Array.from(scheduledHoursMap.entries())) {
    if (count < 10) {
      logger.debug(`  ${key}: ${hours}h`);
      count++;
    }
  }
  logger.debug(`=========================================\n`);

  // Debug: Check what's actually in the guaranteed hours data
  if (guaranteed.length > 0) {
    logger.debug("=== GUARANTEED HOURS DEBUGGING ===");
    logger.debug("First row raw data:", guaranteed[0]);
    logger.debug(
      "Service Start Date raw:",
      guaranteed[0]["Service Requirement Start Date And Time"],
    );
    logger.debug(
      "Service End Date raw:",
      guaranteed[0]["Service Requirement End Date And Time"],
    );
  }

  // Debug CG Data to see what's actually there
  logger.debug(`CG Data debugging:`);
  logger.debug(`  - Total CG Data rows: ${cgData.length}`);
  if (cgData.length > 0) {
    logger.debug(`  - First row keys:`, Object.keys(cgData[0]));
    logger.debug(`  - First row:`, cgData[0]);
  }

  // Step 1: Create master employee list from CG Data (EXACT MATCH TO WORKING IMPLEMENTATION)
  const masterEmployees = cgData
    .map((row) => ({
      name: row["CAREGiver Name"],
      weekly: Number(row["Weekly Hours"] || 0),
      transportMode: row["TransportModeDescription"] || "",
      gender: row["Gender"] || "",
    }))
    .filter((row) => row.name && row.weekly > 0) // Only non-empty names and non-zero hours
    .map((row) => ({
      originalName: row.name,
      normalizedName: normalizeName(row.name),
      weeklyHours: row.weekly,
      transportMode: row.transportMode,
      gender: row.gender,
    }));

  // NEW: Add employees from Guaranteed Hours who are not in CG Data
  const existingNames = new Set(masterEmployees.map(e => e.normalizedName));
  const adhocFromGuaranteed = new Map<string, string>();
  
  guaranteed.forEach(row => {
    const actualName = row["Actual Employee Name"];
    const plannedName = row["Planned Employee Name"];
    const name = actualName || plannedName;
    if (!name) return;
    const nameStr = name.toString();
    const norm = normalizeName(nameStr);
    if (!existingNames.has(norm)) {
      adhocFromGuaranteed.set(norm, nameStr);
    }
  });

  if (adhocFromGuaranteed.size > 0) {
    logger.debug(`Adding ${adhocFromGuaranteed.size} employees found in Guaranteed Hours but missing from CG Data to master list`);
    adhocFromGuaranteed.forEach((originalName, norm) => {
      masterEmployees.push({
        originalName: originalName,
        normalizedName: norm,
        weeklyHours: 0,
        transportMode: "",
        gender: "",
      });
      existingNames.add(norm);
    });
  }

  logger.debug(
    `Master employee list created: ${masterEmployees.length} employees from CG Data (with non-zero weekly hours)`,
  );
  if (masterEmployees.length > 0) {
    logger.debug(`  - Sample employee:`, masterEmployees[0]);
  }

  // Create master employee map for fast lookup
  const masterEmployeeMap = new Map();
  masterEmployees.forEach((emp) => {
    masterEmployeeMap.set(emp.normalizedName, emp);
  });

  // Create postCode lookup map from CG Data
  const postCodeMap = new Map<string, string>();
  cgData.forEach((row) => {
    if (row["CAREGiver Name"] && row.PostCode) {
      const normalizedName = normalizeName(row["CAREGiver Name"]);
      postCodeMap.set(normalizedName, row.PostCode);
    }
  });

  // Determine core week boundary from guaranteed hours data (actual scheduled work)
  // This prevents overnight visits from previous days from adding spillover dates
  const coreWeekDates = new Set<string>();
  guaranteed.forEach((row) => {
    try {
      const { start } = resolveServiceTimestamps(row);
      if (!start) return;
      const startDate = parseGuaranteedDate(start);
      const dateStr = format(startDate, "yyyy-MM-dd");
      coreWeekDates.add(dateStr);
    } catch (error) {
      // Skip invalid dates
    }
  });
  
  // Also add dates from availability (but will filter spillover after)
  availability.forEach((row) => {
    if (row.parsedDate) {
      const dateStr = format(row.parsedDate, "yyyy-MM-dd");
      coreWeekDates.add(dateStr);
    }
  });
  
  // Detect and remove spillover dates (dates outside the 7-day core week)
  let coreWeekArray = Array.from(coreWeekDates).sort();
  const spilloverDatesRemoved: string[] = [];
  
  if (coreWeekArray.length > 7) {
    logger.debug(`\nDETECTING WEEK BOUNDARY in processCapacityData (${coreWeekArray.length} dates found):`);
    
    // Check if first date is a spillover from overnight shift
    if (coreWeekArray.length > 7) {
      const firstDate = new Date(coreWeekArray[0]);
      const secondDate = new Date(coreWeekArray[1]);
      const lastDate = new Date(coreWeekArray[coreWeekArray.length - 1]);
      
      const daysBetweenSecondAndLast = Math.round(
        (lastDate.getTime() - secondDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      
      const daysBetweenFirstAndSecond = Math.round(
        (secondDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      
      if (daysBetweenFirstAndSecond === 1 && daysBetweenSecondAndLast === 6) {
        logger.debug(`  Detected spillover date: ${coreWeekArray[0]} (will be excluded)`);
        logger.debug(`  Core week: ${coreWeekArray[1]} to ${coreWeekArray[coreWeekArray.length - 1]}`);
        spilloverDatesRemoved.push(coreWeekArray[0]);
        coreWeekDates.delete(coreWeekArray[0]);
        coreWeekArray = coreWeekArray.slice(1);
      } else if (coreWeekArray.length === 8) {
        const secondToLastDate = new Date(coreWeekArray[coreWeekArray.length - 2]);
        const daysBetweenFirstAndSecondToLast = Math.round(
          (secondToLastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        
        if (daysBetweenFirstAndSecondToLast === 6) {
          logger.debug(`  Detected spillover date: ${coreWeekArray[coreWeekArray.length - 1]} (will be excluded)`);
          logger.debug(`  Core week: ${coreWeekArray[0]} to ${coreWeekArray[coreWeekArray.length - 2]}`);
          spilloverDatesRemoved.push(coreWeekArray[coreWeekArray.length - 1]);
          coreWeekDates.delete(coreWeekArray[coreWeekArray.length - 1]);
          coreWeekArray = coreWeekArray.slice(0, -1);
        }
      }
    }
  }
  
  // Step 2: Filter availability data to ONLY include master employees (EXACT MATCH TO WORKING IMPLEMENTATION)
  // Also filter to only include dates within the core week (exclude spillover dates)
  const availabilityFiltered: any[] = [];
  let spilloverDatesSkipped = 0;
  availability.forEach((row, i) => {
    try {
      const name = row["CAREGiver Name"];
      const normalizedName = normalizeName(name);

      // Availability matching with improved threshold
      const masterEmployeeKeys = Array.from(masterEmployeeMap.keys());
      const matches = getCloseMatches(normalizedName, masterEmployeeKeys, 0.65);
      if (matches.length === 0) return; // not a CG employee → drop
      const canonicalKey = matches[0].choice;
      const matchedEmployee = masterEmployeeMap.get(canonicalKey);

      if (!row["Start Date"]) {
        warnings.push(`Availability row ${i + 1}: missing Start Date`);
        return;
      }

      const parsedDate = row.parsedDate; // Already parsed
      const dateStr = format(parsedDate, "yyyy-MM-dd");
      
      // Filter out dates that are outside the core week (spillover dates)
      if (!coreWeekDates.has(dateStr)) {
        spilloverDatesSkipped++;
        return;
      }
      
      let hrs =
        row.Hours !== undefined && row.Hours !== null
          ? Number(row.Hours)
          : hoursBetween(row["Start Time"], row["End Time"]);

      // Sick/Holiday/Unavailable rows frequently have no Start/End times in the
      // spreadsheet, so hoursBetween returns NaN. Drop the row only when it is
      // an Available row with no computable hours (genuinely bad data). For any
      // other status we keep the row with hrs = 0 — it still needs to reach
      // allAvailabilityWithMatching so employeeAbsenceDates can record that the
      // date has an absence, which blocks the proportional-daily rule from firing.
      if (isNaN(hrs)) {
        const rowStatus = canonicalStatus(row.Type);
        if (rowStatus === "Available") {
          warnings.push(`Availability row ${i + 1}: cannot compute hours`);
          return;
        }
        hrs = 0; // absence row with no hours — keep it, treat as 0 h
      }

      availabilityFiltered.push({
        ...row,
        _normalizedName: canonicalKey, // Use canonical key from fuzzy match
        _parsedDate: parsedDate,
        _hours: Math.round(hrs * 100) / 100,
        matchedEmployee, // Add matched employee from fuzzy match
      });
    } catch (e: any) {
      warnings.push(`Availability row ${i + 1}: ${e.message || "error"}`);
    }
  });
  
  if (spilloverDatesSkipped > 0) {
    logger.debug(`  🔸 Filtered ${spilloverDatesSkipped} availability records from spillover dates: ${spilloverDatesRemoved.join(', ')}`);
  }

  logger.debug(
    `Availability filtered: ${availabilityFiltered.length} rows (only master employees)`,
  );

  // Step 3: Create allAvailabilityWithMatching for compatibility with existing pipeline
  const allAvailabilityWithMatching = availabilityFiltered;

  // Step 3: Calculate days available for each employee (original logic)
  const employeeDays = new Map<string, Set<string>>();
  allAvailabilityWithMatching.forEach((row) => {
    const key = row.matchedEmployee
      ? row.matchedEmployee.normalizedName
      : normalizeName(row["CAREGiver Name"]);
    if (!employeeDays.has(key)) {
      employeeDays.set(key, new Set());
    }
    const dateStr = format(row.parsedDate, "yyyy-MM-dd");
    employeeDays.get(key)!.add(dateStr);
  });

  // Pre-compute dates that have ANY non-Available status row per employee.
  // The proportional rule must NOT fire on these dates — even when an Available
  // row also exists for the same date (e.g. partial sick day). If a date has
  // BOTH an Available row and a Sick row, the day is considered an absence day
  // and standardDaily is used for all rows on that date.
  const employeeAbsenceDates = new Map<string, Set<string>>();
  allAvailabilityWithMatching.forEach((row) => {
    if (canonicalStatus(row.Type) === "Available") return; // skip pure-available rows
    const key = row.matchedEmployee
      ? row.matchedEmployee.normalizedName
      : normalizeName(row["CAREGiver Name"]);
    if (!employeeAbsenceDates.has(key)) {
      employeeAbsenceDates.set(key, new Set());
    }
    const dateStr = format(row.parsedDate, "yyyy-MM-dd");
    employeeAbsenceDates.get(key)!.add(dateStr);
  });

  // Step 4: Create merged data (original pipeline approach)
  const mergedData = allAvailabilityWithMatching.map((row) => {
    // Handle both matched and unmatched employees
    const key = row.matchedEmployee
      ? row.matchedEmployee.normalizedName
      : normalizeName(row["CAREGiver Name"]);
    
    // Total hours available in the spreadsheet for this employee across the whole week
    const totalWeeklyAvailabilityMinutes = allAvailabilityWithMatching
      .filter(r => (r.matchedEmployee?.normalizedName || normalizeName(r["CAREGiver Name"])) === key)
      .reduce((sum, r) => {
        const start = toMin(r["Start Time"]);
        const end = toMin(r["End Time"]);
        if (isNaN(start) || isNaN(end)) return sum;
        const duration = end <= start ? (end + 24 * 60) - start : end - start;
        return sum + duration;
      }, 0);

    const rowStart = toMin(row["Start Time"]);
    const rowEnd = toMin(row["End Time"]);
    const rowDurationMinutes = rowEnd <= rowStart ? (rowEnd + 24 * 60) - rowStart : rowEnd - rowStart;

    // Use CG Data weekly hours if matched, otherwise default to 0
    const contractedWeeklyHours = row.matchedEmployee
      ? row.matchedEmployee.weeklyHours
      : 0;

    // Daily Hours Logic: 
    // Default: Weekly Hours / Number of Days Available
    // Special Case: If availability hours vary across the week, use proportional spreading.
    // Uses the reliable "Hours" column from the spreadsheet directly.
    let contractedDailyHours = 0;
    if (row.matchedEmployee) {
      const daysAvailable = employeeDays.get(key)!.size;
      const standardDaily = Math.round((row.matchedEmployee.weeklyHours / daysAvailable) * 100) / 100;
      
      // Build a per-day hours map using ONLY "Available" status rows.
      // Sick/Holiday/Unavailable rows are intentionally excluded so they cannot
      // distort variable-shift detection or the proportional spread of contracted hours.
      const perDayHours = new Map<string, number>();
      allAvailabilityWithMatching
        .filter(r => {
          const rKey = r.matchedEmployee?.normalizedName || normalizeName(r["CAREGiver Name"]);
          return rKey === key && canonicalStatus(r.Type) === "Available";
        })
        .forEach(r => {
          const d = format(r.parsedDate, "yyyy-MM-dd");
          // Use the Hours column directly; fall back to computing from time
          const hrs = (r.Hours !== undefined && r.Hours !== null)
            ? Number(r.Hours)
            : hoursBetween(r["Start Time"], r["End Time"]);
          if (isNaN(hrs) || hrs <= 0) return;
          // Sum hours per day (in case of multiple Available rows for the same day)
          perDayHours.set(d, (perDayHours.get(d) || 0) + hrs);
        });

      const currentDate = format(row.parsedDate, "yyyy-MM-dd");
      // todayHours is the Available hours for this specific date.
      // Will be 0 for full-day sick/holiday/unavailable rows (no Available row that day).
      const todayHours = perDayHours.get(currentDate) || 0;
      const allDayHours = Array.from(perDayHours.values());
      const totalWeekHours = allDayHours.reduce((a, b) => a + b, 0);
      const avgDayHours = allDayHours.length > 0 ? totalWeekHours / allDayHours.length : 0;

      // Detect variable shifts: if any Available day's hours differ from the average by >0.25h (15 min).
      // Only triggered when the employee genuinely works different lengths on different available days.
      const hasVariableShifts = allDayHours.length > 1 && allDayHours.some(h => Math.abs(h - avgDayHours) > 0.25);

      // Apply proportional rule ONLY when ALL of the following hold:
      //   a) the employee genuinely has variable shift lengths across their Available days
      //   b) this specific date has Available hours in the availability data (todayHours > 0)
      //   c) this date has NO absence/non-Available rows (sick, holiday, unavailability, etc.)
      //
      // Rule (c) is critical: if a date has BOTH an Available row AND a Sick row (even a
      // partial sick day), the whole date is treated as an absence day and standardDaily
      // is used for every row on that date — including the Available row. This ensures
      // desired hours on absence days are always weeklyHours ÷ contractedDays, never
      // inflated or deflated by the variable-shift proportions of those particular hours.
      const dateHasAbsence = employeeAbsenceDates.get(key)?.has(currentDate) ?? false;
      if (hasVariableShifts && totalWeekHours > 0 && todayHours > 0 && !dateHasAbsence) {
        const proportion = todayHours / totalWeekHours;
        contractedDailyHours = Math.round((row.matchedEmployee.weeklyHours * proportion) * 100) / 100;
      } else {
        contractedDailyHours = standardDaily;
      }
    }

    // Safer hours: prefer 'Hours' if present, else compute from time
    const hoursCalc = hoursBetween(row["Start Time"], row["End Time"]);
    const hoursEffective =
      row.Hours !== undefined && row.Hours !== null ? row.Hours : hoursCalc;

    return {
      employeeName: row.matchedEmployee
        ? row.matchedEmployee.originalName
        : row["CAREGiver Name"],
      contractedWeeklyHours,
      contractedDailyHours,
      date: format(row.parsedDate, "yyyy-MM-dd"),
      status: canonicalStatus(row.Type),
      startTime: timeToString(row["Start Time"]),
      endTime: timeToString(row["End Time"]),
      timeWindow: row["Time Window(s)"], // Use the filtered time windows
      hours: hoursEffective,
      notes: row.Notes || "",
      employeeKey: key,
      matchedEmployee: row.matchedEmployee,
    };
  });

  // Step 5: Group by employee and date, then apply collapse logic
  const groupedData = new Map<string, typeof mergedData>();
  mergedData.forEach((row) => {
    const key = `${row.employeeKey}|${row.date}`;
    if (!groupedData.has(key)) {
      groupedData.set(key, []);
    }
    groupedData.get(key)!.push(row);
  });


  // Step 6: Collapse function - exactly like your collapse_one_group function
  const cleanedRecords: CleanedEmployeeRecord[] = [];

  groupedData.forEach((group) => {
    if (group.length === 0) return;

    const empName = group[0].employeeName;
    const weekly = group[0].contractedWeeklyHours;
    const daily = group[0].contractedDailyHours || 0.0;
    const date = group[0].date;

    // Calculate total scheduled hours for this employee on this date (sum all service assignments)
    const totalScheduledHours = getScheduledHoursForEmployeeAndDate(
      scheduledHoursMap,
      empName,
      date,
    );
    const clientScheduledHrs = getScheduledHoursForEmployeeAndDate(clientScheduledHoursMap, empName, date);

    // Deduplicate identical windows per status (like your Python dd logic)
    const deduplicatedRows = new Map<string, (typeof group)[0]>();
    group.forEach((row) => {
      const key = `${row.status}|${row.startTime}|${row.endTime}`;
      if (!deduplicatedRows.has(key)) {
        deduplicatedRows.set(key, row);
      }
    });

    // Aggregate per status (like your Python agg logic)
    const statusAgg = new Map<
      string,
      {
        hoursRaw: number;
        windows: string[];
        notes: string[];
      }
    >();

    Array.from(deduplicatedRows.values()).forEach((row) => {
      if (!statusAgg.has(row.status)) {
        statusAgg.set(row.status, {
          hoursRaw: 0,
          windows: [],
          notes: [],
        });
      }

      const agg = statusAgg.get(row.status)!;
      agg.hoursRaw += row.hours;

      // Only add non-empty time windows
      if (
        row.timeWindow &&
        row.timeWindow !== "" &&
        row.timeWindow !== "-" &&
        row.timeWindow !== "--" &&
        row.timeWindow !== ":" &&
        !row.timeWindow.includes("undefined")
      ) {
        agg.windows.push(row.timeWindow);
      }

      if (row.notes && row.notes !== "") {
        agg.notes.push(row.notes);
      }
    });

    // Total leave raw + cap at daily (like your Python logic)
    let totalLeaveRaw = 0;
    statusAgg.forEach((agg, status) => {
      if (LEAVE_TYPES.includes(status)) {
        totalLeaveRaw += agg.hoursRaw;
      }
    });
    const totalLeaveCapped = Math.min(totalLeaveRaw, daily);

    // Day-killer short-circuit (with partial holiday detection)
    let hasDayKiller = false;
    let dayKillerStatus = "";
    let dayKillerPriority = 999;
    let hasPartialDayKiller = false;
    let partialDayKillerStatus = "";

    statusAgg.forEach((agg, status) => {
      if (DAY_KILLERS.has(status)) {
        const p = STATUS_PRIORITY[status] || 999;
        // Check if this day-killer has specific time windows (partial holiday)
        const hasTimeWindows = agg.windows && agg.windows.length > 0 && agg.windows.some(w => w.trim() !== "");
        
        if (hasTimeWindows) {
          // This is a PARTIAL day-killer (e.g., partial holiday)
          // Treat it like a time-killer instead
          hasPartialDayKiller = true;
          partialDayKillerStatus = status;
        } else {
          // Full-day killer with no specific windows
          if (p < dayKillerPriority) {
            dayKillerPriority = p;
            dayKillerStatus = status;
          }
        }
      }
    });
    hasDayKiller = dayKillerStatus !== "";

    // Check for time-killers and available status
    let hasTimeKiller = false;
    let hasAvailableStatus = false;
    statusAgg.forEach((_agg, status) => {
      if (TIME_KILLERS.has(status)) {
        hasTimeKiller = true;
      }
      if (status === "Available") {
        hasAvailableStatus = true;
      }
    });

    // Compute avail/blocker pairs once (reused below)
    const availAgg = statusAgg.get("Available");
    const availPairs = mergeIntervals(
      windowListToPairs(availAgg?.windows || []),
      0,
    );

    // Separate blocker pairs by type for accurate hour attribution
    const timeKillerPairs: Array<[number, number]> = [];
    statusAgg.forEach((_agg, status) => {
      if (TIME_KILLERS.has(status))
        timeKillerPairs.push(...windowListToPairs(_agg.windows));
    });
    
    // Partial day-killer windows (e.g., partial holidays) - tracked separately
    let partialDayKillerPairs: Array<[number, number]> = [];
    if (hasPartialDayKiller && partialDayKillerStatus) {
      const partialAgg = statusAgg.get(partialDayKillerStatus);
      if (partialAgg?.windows) {
        partialDayKillerPairs = windowListToPairs(partialAgg.windows);
      }
    }
    
    // Merge all blockers for window subtraction (availability calculation)
    const blockerPairs: Array<[number, number]> = [...timeKillerPairs, ...partialDayKillerPairs];
    const mergedBlockers = mergeIntervals(blockerPairs, 0);
    
    // Calculate hours for each blocker type separately (for accurate attribution)
    const mergedTimeKillers = mergeIntervals(timeKillerPairs, 0);
    const mergedPartialDayKillers = mergeIntervals(partialDayKillerPairs, 0);
    const timeKillerHours = mergedTimeKillers.reduce((sum, [start, end]) => sum + (end - start) / 60, 0);
    const partialDayKillerHours = mergedPartialDayKillers.reduce((sum, [start, end]) => sum + (end - start) / 60, 0);

    // Use contracted daily minutes for the all-day heuristic
    const contractedDailyMin = Math.round(
      (group[0]?.contractedDailyHours || 0) * 60,
    );
    const timeKillerIsAllDay = mergedBlockers.length
      ? isAllDayTimeKiller(mergedBlockers, availPairs, contractedDailyMin)
      : false;

    // Highest priority status selection
    let highestPriorityStatus = "";
    let highestPriority = 999;

    if (hasDayKiller) {
      // Full-day killer (no time windows)
      highestPriorityStatus = dayKillerStatus;
      highestPriority = dayKillerPriority;
    } else if (hasTimeKiller || hasPartialDayKiller) {
      // Time-killer OR partial day-killer (e.g., partial holiday)
      if (timeKillerIsAllDay || !hasAvailableStatus) {
        // Treat like day-level absence if all-day OR no explicit availability
        // For partial day-killers (e.g. Sick with time windows) that cover all day, use their actual status
        if (hasPartialDayKiller && timeKillerIsAllDay) {
          highestPriorityStatus = partialDayKillerStatus;
          highestPriority = STATUS_PRIORITY[partialDayKillerStatus] || 5;
        } else if (hasPartialDayKiller && !hasAvailableStatus) {
          // Sick/Holiday with time windows but NO Available row on this day
          // → treat as a full-day absence with the actual status (not "Other Unavailable")
          highestPriorityStatus = partialDayKillerStatus;
          highestPriority = STATUS_PRIORITY[partialDayKillerStatus] || 5;
        } else {
          highestPriorityStatus = "Other Unavailable";
          highestPriority = STATUS_PRIORITY["Other Unavailable"] || 5;
        }
      } else {
        // Partial blocker AND has availability record
        // Use "Partial Holiday" for partial day-killers, otherwise "Partial Availability"
        if (hasPartialDayKiller) {
          highestPriorityStatus = `Partial ${partialDayKillerStatus}`;
          highestPriority = STATUS_PRIORITY["Partial Availability"] || 6;
        } else {
          highestPriorityStatus = "Partial Availability";
          highestPriority = STATUS_PRIORITY["Partial Availability"] || 6;
        }
      }
    } else {
      // No blockers → pick best remaining (usually Available)
      statusAgg.forEach((_agg, status) => {
        const p = STATUS_PRIORITY[status] || 999;
        if (p < highestPriority) {
          highestPriority = p;
          highestPriority = p; // Ensure highestPriority is updated
          highestPriorityStatus = status;
        }
      });
    }

    // Only create one record using the highest priority status
    if (highestPriorityStatus) {
      const agg = statusAgg.get(highestPriorityStatus) ?? {
        hoursRaw: 0,
        windows: [],
        notes: [],
      };
      let finalHours: number;
      let netCapacity: number;

      // Calculate total blocked hours from all blockers
      const totalBlockedHours = mergedBlockers.reduce((sum, [start, end]) => sum + (end - start) / 60, 0);
      
      if (hasDayKiller || ((hasTimeKiller || hasPartialDayKiller) && timeKillerIsAllDay) || (hasPartialDayKiller && !hasAvailableStatus)) {
        // Full-day absence → zero capacity
        // For full-day absences (Holiday, Sick, etc.), use contracted daily hours
        // This ensures holidays count as full contracted hours, not raw availability hours
        finalHours = daily > 0 ? daily : Math.min(agg.hoursRaw || 0.0, daily);
        netCapacity = 0.0;
      } else if (highestPriorityStatus.startsWith("Partial ")) {
        // Partial blocker (Partial Availability, Partial Holiday, Partial Sick, etc.)
        // Use the specific blocker hours based on the status type
        let statusBlockedHours: number;
        if (highestPriorityStatus === "Partial Availability") {
          // For partial availability, use time-killer hours only
          statusBlockedHours = Math.min(timeKillerHours, daily);
        } else if (highestPriorityStatus.startsWith("Partial ")) {
          // For partial day-killers (Partial Holiday, Partial Sick, etc.)
          // Use only the partial day-killer hours for attribution
          statusBlockedHours = Math.min(partialDayKillerHours, daily);
        } else {
          statusBlockedHours = Math.min(totalBlockedHours, daily);
        }
        finalHours = statusBlockedHours; // Hours attributed to the partial leave
        // Net capacity = contracted hours minus ALL blocked hours (holidays + other blockers)
        netCapacity = Math.max(daily - Math.min(totalBlockedHours, daily), 0.0);
      } else if (highestPriorityStatus === "Available") {
        finalHours = Math.max(daily - totalLeaveCapped, 0.0);
        netCapacity = finalHours;
      } else {
        // Other statuses default to no capacity
        finalHours = agg.hoursRaw || 0.0;
        netCapacity = 0.0;
      }

      // Build notes (still combine from all statuses)
      const allNotes: string[] = [];
      statusAgg.forEach((agg) => allNotes.push(...agg.notes));
      const notesStr = Array.from(new Set(allNotes))
        .filter((n) => n && n !== "")
        .sort()
        .join("; ");

      // Build bookable windows using pre-computed pairs
      let windowsStr = "";
      if (!(hasDayKiller || timeKillerIsAllDay)) {
        const bookablePairs = filterMinDuration(
          subtractIntervals(availPairs, mergedBlockers),
          60,
        );
        const bookableWindows = pairsToWindowList(bookablePairs);
        windowsStr = bookableWindows.join("; ");
      }

      // Look up postCode for this employee
      const normalizedEmpName = normalizeName(empName);
      const postCode = postCodeMap.get(normalizedEmpName) || "";

      cleanedRecords.push({
        employeeName: empName,
        contractedWeeklyHours: Math.round(weekly * 100) / 100,
        contractedDailyHours: Math.round(daily * 100) / 100,
        date,
        status: highestPriorityStatus,
        timeWindows: windowsStr,
        scheduledHours: Math.round(totalScheduledHours * 100) / 100,
        clientScheduledHours: Math.round(clientScheduledHrs * 100) / 100,
        otherScheduledHours: Math.round((totalScheduledHours - clientScheduledHrs) * 100) / 100,
        hours: Math.round(finalHours * 100) / 100,
        netCapacity: Math.round(netCapacity * 100) / 100,
        notes:
          notesStr +
          (hasDayKiller
            ? " [availability ignored due to day-level leave]"
            : ""),
        postCode,
      });
    }
  });

  // Sort by priority
  cleanedRecords.sort((a, b) => {
    const aPriority = STATUS_PRIORITY[a.status] || 999;
    const bPriority = STATUS_PRIORITY[b.status] || 999;
    return aPriority - bPriority;
  });

  // Step 7: Build Daily Summary (with same consolidation logic as Employee Summary)
  const dailySummaryMap = new Map<
    string,
    {
      availableHours: number;
      netCapacity: number;
      unavailability: number;
      holidays: number;
      sickness: number;
      scheduledHours: number;
      clientScheduledHours: number;
      otherScheduledHours: number;
    }
  >();

  // Group records by date and employee to apply consolidation logic
  const recordsByDateAndEmployee = new Map<
    string,
    Map<string, CleanedEmployeeRecord[]>
  >();

  cleanedRecords.forEach((record) => {
    const dateKey = record.date;
    if (!recordsByDateAndEmployee.has(dateKey)) {
      recordsByDateAndEmployee.set(dateKey, new Map());
    }

    const dateMap = recordsByDateAndEmployee.get(dateKey)!;
    if (!dateMap.has(record.employeeName)) {
      dateMap.set(record.employeeName, []);
    }

    dateMap.get(record.employeeName)!.push(record);
  });

  // Apply consolidation logic for each date and employee
  recordsByDateAndEmployee.forEach((employeeMap, date) => {
    if (!dailySummaryMap.has(date)) {
      dailySummaryMap.set(date, {
        availableHours: 0,
        netCapacity: 0,
        unavailability: 0,
        holidays: 0,
        sickness: 0,
        scheduledHours: 0,
        clientScheduledHours: 0,
        otherScheduledHours: 0,
      });
    }

    const summary = dailySummaryMap.get(date)!;

    employeeMap.forEach((records, _employeeName) => {
      // Apply same consolidation logic as Employee Summary
      let hasUnavailableStatus = false;
      let bestRecord = records[0]; // Start with first record
      let totalUnavailableHours = 0;

      // Find the record with highest contracted daily hours and check for unavailable statuses
      records.forEach((record) => {
        if (record.contractedDailyHours > bestRecord.contractedDailyHours) {
          bestRecord = record;
        }

        // Check if this is a partial status (has remaining capacity)
        const isPartialStatus = record.status.startsWith("Partial ");
        
        if (
          record.status !== "Available" &&
          !isPartialStatus
        ) {
          // Full-day unavailable status (Holiday, Sick, etc.)
          hasUnavailableStatus = true;
          totalUnavailableHours += record.hours;
        } else if (isPartialStatus) {
          // Partial statuses (Partial Availability, Partial Holiday, etc.)
          // Add to unavailable hours but don't mark as fully unavailable
          totalUnavailableHours += record.hours;
        }
      });

      // Use the best record's net capacity
      const empNorm = normalizeName(_employeeName);
      const schedKey = `${empNorm}|${date}`;
      const empScheduled = scheduledHoursMap.get(schedKey) || 0;
      const empClientScheduled = clientScheduledHoursMap.get(schedKey) || 0;

      // NET CAPACITY CALCULATION FIX:
      // Net Capacity = Desired Hours - Holidays - Sickness - Unavailability
      // We calculate deductions for this specific employee
      let empHolidays = 0;
      let empSickness = 0;
      let empUnavailability = 0;

      records.forEach((record) => {
        if (record.status === "Holiday" || record.status === "Partial Holiday") {
          empHolidays += record.hours;
        } else if (record.status === "Sick" || record.status === "Partial Sick") {
          empSickness += record.hours;
        } else if (
          [
            "Maternity/Paternity",
            "Compassionate Leave",
            "Other Unavailable",
            "Pre-Agreed Appointment",
            "Partial Maternity/Paternity",
            "Partial Compassionate Leave",
            "Partial Availability",
          ].includes(record.status)
        ) {
          empUnavailability += record.hours;
        }
      });

      // CRITICAL FIX: Cap deductions at desired hours for the employee
      // This prevents unavailability from exceeding the actual contracted time for that day
      const daily = bestRecord.contractedDailyHours;
      const totalDeductions = empHolidays + empSickness + empUnavailability;
      
      if (totalDeductions > daily && daily > 0) {
        const ratio = daily / totalDeductions;
        empHolidays *= ratio;
        empSickness *= ratio;
        empUnavailability *= ratio;
      }

      const empNetCapacity = Math.max(0, daily - empHolidays - empSickness - empUnavailability);
      summary.netCapacity += empNetCapacity;

      // Desired Hours = total contracted daily hours for ALL employees (baseline before deductions)
      summary.availableHours += daily;

      // Categorize absence hours by type for summary display
      summary.holidays += empHolidays;
      summary.sickness += empSickness;
      summary.unavailability += empUnavailability;

      summary.scheduledHours += empScheduled;
      summary.clientScheduledHours += empClientScheduled;
      summary.otherScheduledHours += Math.max(0, empScheduled - empClientScheduled);
    });
  });

  // CRITICAL FIX: Add scheduled hours for ad-hoc employees (those with visits but NO availability record)
  // The loop above only processes employees from the availability export.
  // Employees who appear in the Guaranteed Hours file but NOT in the Availability file
  // are completely missed, causing the scheduled hours total to be undercounted.
  {
    const employeesAlreadyCounted = new Set<string>();
    recordsByDateAndEmployee.forEach((employeeMap, date) => {
      employeeMap.forEach((_records, empName) => {
        employeesAlreadyCounted.add(`${normalizeName(empName)}|${date}`);
      });
    });

    let adhocTotal = 0;
    let adhocCount = 0;
    scheduledHoursMap.forEach((schedHours, key) => {
      if (schedHours <= 0) return;
      
      // Case-insensitive check for Palmer and Campbell
      const upperKey = key.toUpperCase();
      if (upperKey.includes("PALMER") || upperKey.includes("CAMPBELL")) {
        logger.debug(`[PROACTIVE] Found target employee in scheduledHoursMap: ${key} = ${schedHours}h`);
      }

      if (employeesAlreadyCounted.has(key)) return;

      const pipeIdx = key.lastIndexOf("|");
      if (pipeIdx < 0) return;
      const date = key.substring(pipeIdx + 1);
      if (!date) return;

      if (!dailySummaryMap.has(date)) {
        dailySummaryMap.set(date, {
          availableHours: 0,
          netCapacity: 0,
          unavailability: 0,
          holidays: 0,
          sickness: 0,
          scheduledHours: 0,
          clientScheduledHours: 0,
          otherScheduledHours: 0,
        });
      }

      const summary = dailySummaryMap.get(date)!;
      const clientSched = clientScheduledHoursMap.get(key) || 0;
      summary.scheduledHours += schedHours;
      summary.clientScheduledHours += clientSched;
      summary.otherScheduledHours += Math.max(0, schedHours - clientSched);

      adhocTotal += schedHours;
      adhocCount++;
      logger.debug(`  Ad-hoc scheduled hours added to daily summary: ${key} => ${schedHours}h (client: ${clientSched}h)`);
    });
    logger.debug(`  TOTAL AD-HOC HOURS ADDED TO DAILY SUMMARY: ${adhocCount} entries, ${Math.round(adhocTotal * 100) / 100}h`);
  }

  // Step 8: Merge with client demand
  const demandMap = new Map<string, number>();
  demand.forEach((row) => {
    const dateStr = format(parseDate(row.Date), "yyyy-MM-dd");
    demandMap.set(dateStr, row["Required Client Hours"]);
  });

  // User requested to skip Jan 25 (Sunday) as the week originally starts on Jan 26
  const SKIP_DATE = "2026-01-25";

  const dailySummary: DailySummaryRecord[] = Array.from(
    dailySummaryMap.entries(),
  )
    .filter(([date]) => date !== SKIP_DATE) // Skip the first date as requested
    .map(([date, summary]) => {
      const clientRequired = demandMap.get(date) || 0;
      const gap =
        Math.round((summary.netCapacity - clientRequired) * 100) / 100;

      return {
        date,
        availableHours: Math.round(summary.availableHours * 100) / 100,
        netCapacity: Math.round(summary.netCapacity * 100) / 100,
        unavailability: Math.round(summary.unavailability * 100) / 100,
        holidays: Math.round(summary.holidays * 100) / 100,
        sickness: Math.round(summary.sickness * 100) / 100,
        scheduledHours: Math.round(summary.scheduledHours * 100) / 100,
        clientScheduledHours: Math.round(summary.clientScheduledHours * 100) / 100,
        otherScheduledHours: Math.round(summary.otherScheduledHours * 100) / 100,
        clientRequired: Math.round(clientRequired * 100) / 100,
        gap,
        status: (gap >= 0 ? "Sufficient" : "Shortage") as
          | "Sufficient"
          | "Shortage",
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  // Step 9: Calculate KPIs
  logger.debug(`\n===== DAILY SUMMARY CLIENT REQUIRED BREAKDOWN =====`);
  let totalClientRequired = 0;
  dailySummary.forEach((d) => {
    logger.debug(`  - ${d.date}: ${d.clientRequired} hours`);
    totalClientRequired += d.clientRequired;
  });
  logger.debug(
    `TOTAL CLIENT REQUIRED FROM DAILY SUMMARY: ${Math.round(totalClientRequired * 100) / 100}`,
  );
  logger.debug(`==================================================\n`);

  const kpis = {
    netCapacitySum:
      Math.round(
        dailySummary.reduce((sum, d) => sum + d.netCapacity, 0) * 100,
      ) / 100,
    totalDesiredHoursSum:
      Math.round(
        dailySummary.reduce((sum, d) => sum + d.availableHours, 0) * 100,
      ) / 100,
    clientRequiredSum:
      Math.round(
        dailySummary.reduce((sum, d) => sum + d.clientRequired, 0) * 100,
      ) / 100,
    gapSum:
      Math.round(dailySummary.reduce((sum, d) => sum + d.gap, 0) * 100) / 100,
    unavailabilitySum:
      Math.round(
        dailySummary.reduce((sum, d) => sum + d.unavailability, 0) * 100,
      ) / 100,
    holidaysSum:
      Math.round(dailySummary.reduce((sum, d) => sum + d.holidays, 0) * 100) /
      100,
    sicknessSum:
      Math.round(dailySummary.reduce((sum, d) => sum + (d as any).sickness, 0) * 100) /
      100,
    totalScheduledHoursSum:
      Math.round(dailySummary.reduce((sum, d) => sum + (d as any).scheduledHours, 0) * 100) /
      100,
    clientScheduledHoursSum:
      Math.round(dailySummary.reduce((sum, d) => sum + (d as any).clientScheduledHours, 0) * 100) / 100,
    otherScheduledHoursSum:
      Math.round(dailySummary.reduce((sum, d) => sum + (d as any).otherScheduledHours, 0) * 100) / 100,
    capacityAfterSchedulingSum:
      Math.round(dailySummary.reduce((sum, d) => sum + (d.netCapacity - d.clientRequired), 0) * 100) / 100,
  };

  // Step 10: Build employees by date for drilldown
  const employeesByDate: Record<string, EmployeeDailyDetail[]> = {};

  cleanedRecords.forEach((record) => {
    if (!employeesByDate[record.date]) {
      employeesByDate[record.date] = [];
    }

    // Get gender from master employee list for this employee
    const empNormalizedName = normalizeName(record.employeeName);
    const masterEmployee = masterEmployees.find(
      (emp) => emp.normalizedName === empNormalizedName,
    );
    const gender = masterEmployee?.gender || "";

    employeesByDate[record.date].push({
      employeeName: record.employeeName,
      status: record.status,
      timeWindows: record.timeWindows,
      contractedDailyHours: record.contractedDailyHours,
      scheduledHours: record.scheduledHours,
      hours: record.hours,
      netCapacity: record.netCapacity,
      notes: record.notes,
      gender: gender, // Gender from master employee list (derived from Title)
    });
  });

  // === NEW: inject Ad-hoc rows (scheduled but not present in Availability that day) ===
  // Build adhoc windows map once for reuse in employee summary calculation
  const adhocWindowsMap = buildAdHocWindowsMap(guaranteed);
  {
    const displayNameMap = buildDisplayNameMap(guaranteed);

    // who already exists per date (normalized)
    const present: Record<string, Set<string>> = {};
    for (const [date, list] of Object.entries(employeesByDate)) {
      present[date] = new Set(list.map((e) => normalizeName(e.employeeName)));
    }

    // walk through scheduled map (already uses Actual date bucket)
    Array.from(scheduledHoursMap.entries()).forEach(([key, schedHoursRaw]) => {
      if ((schedHoursRaw || 0) <= 0) return;
      const pipeIdx = key.lastIndexOf("|");
      if (pipeIdx < 0) return;
      const normName = key.substring(0, pipeIdx);
      const date = key.substring(pipeIdx + 1);
      if (!date || !normName) return;

      const already = present[date]?.has(normName);
      if (already) return; // they are in Availability for that day — skip

      const display = displayNameMap.get(normName) || normName;
      const windows = (adhocWindowsMap.get(key) || [])
        .map(([s, e]: [number, number]) => `${fromMin(s)}-${fromMin(e)}`)
        .join("; ");

      // Get gender from master employee list for this ad-hoc employee
      const masterEmployee = masterEmployees.find(
        (emp) => emp.normalizedName === normName,
      );
      const gender = masterEmployee?.gender || "";

      logger.debug(`  INJECTING AD-HOC EMPLOYEE: ${display} (norm: ${normName}) on ${date} with ${schedHoursRaw}h scheduled`);

      if (!employeesByDate[date]) employeesByDate[date] = [];
      employeesByDate[date].push({
        employeeName: display,
        status: "Ad-hoc",
        timeWindows: windows,
        contractedDailyHours: 0, // <- as requested
        scheduledHours: Math.round(schedHoursRaw * 100) / 100,
        hours: 0, // not counted toward availability
        netCapacity: 0, // do not inflate capacity
        notes: "Scheduled (no availability record for this day)",
        gender: gender,
      });

      // mark as present to avoid duplicates if multiple keys flow in
      if (!present[date]) present[date] = new Set();
      present[date].add(normName);
    });
  }

  logger.debug(`\n===== AD-HOC INJECTION SUMMARY =====`);
  let totalAdhocInjected = 0;
  Object.entries(employeesByDate).forEach(([date, emps]) => {
    const adhocEmps = emps.filter(e => e.status === "Ad-hoc");
    if (adhocEmps.length > 0) {
      logger.debug(`  ${date}: ${adhocEmps.length} ad-hoc employees`);
      adhocEmps.forEach(e => {
        logger.debug(`    - ${e.employeeName}: ${e.scheduledHours}h`);
        totalAdhocInjected++;
      });
    }
  });
  logger.debug(`  TOTAL AD-HOC INJECTED: ${totalAdhocInjected}`);
  logger.debug(`====================================\n`);

  // Re-sort after injection
  Object.values(employeesByDate).forEach((employees) => {
    employees.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  });


  // Step 8: Cancelled visits will be extracted per date in employee summary generation

  // Step 9: Generate employee summary by date
  const employeeSummaryByDate: Record<string, any[]> = {};

  for (const [dateStr, employees] of Object.entries(employeesByDate)) {
    // Extract cancelled visits for this specific date
    logger.debug(`\nEXTRACTING CANCELLED VISITS FOR ${dateStr}...`);
    const cancelledVisitsForDate = options?.ghWorkbookBuffer
      ? await extractCancelledWindowsFromGHWorkbook(
          options.ghWorkbookBuffer,
          new Date(dateStr),
          0,
        )
      : new Map<string, string>();
    logger.debug(
      `Found ${cancelledVisitsForDate.size} employees with cancelled visits on ${dateStr}`,
    );

    // Group employees by name and consolidate their data
    const employeeMap = new Map<
      string,
      {
        contractedDailyHours: number;
        scheduledHours: number;
        unavailabilityHours: number;
        hasAvailableStatus: boolean;
        hasUnavailableStatus: boolean;
        hasPartialAvailability: boolean;
      }
    >();

    employees.forEach((emp) => {
      const key = emp.employeeName;

      if (!employeeMap.has(key)) {
        // CRITICAL FIX: Get scheduled hours directly from the lookup map
        const empNormalized = normalizeName(emp.employeeName);
        const scheduleKey = `${empNormalized}|${dateStr}`;
        const scheduledHoursFromLookup = scheduledHoursMap.get(scheduleKey) || 0;

        logger.debug(`Employee summary for ${emp.employeeName} on ${dateStr}:`);
        logger.debug(`  - Normalized: ${empNormalized}`);
        logger.debug(`  - Lookup key: ${scheduleKey}`);
        logger.debug(`  - Scheduled hours from lookup: ${scheduledHoursFromLookup}`);
        logger.debug(`  - Scheduled hours from emp object: ${emp.scheduledHours || 0}`);

        employeeMap.set(key, {
          contractedDailyHours: emp.contractedDailyHours,
          scheduledHours: scheduledHoursFromLookup, // Use lookup value directly
          unavailabilityHours: 0,
          hasAvailableStatus: false,
          hasUnavailableStatus: false,
          hasPartialAvailability: false,
        });
      }

      const empData = employeeMap.get(key)!;

      // Always use the highest contracted daily hours value
      empData.contractedDailyHours = Math.max(
        empData.contractedDailyHours,
        emp.contractedDailyHours,
      );
      // Scheduled hours already set from lookup - don't overwrite

      // Track all status types separately, then consolidate at the end
      // Check if this is a partial status (has remaining capacity)
      const isPartialStatus = emp.status.startsWith("Partial ");
      
      if (emp.status === "Available") {
        empData.hasAvailableStatus = true;
      } else if (isPartialStatus) {
        // Partial statuses (Partial Availability, Partial Holiday, etc.)
        empData.hasPartialAvailability = true;
        empData.unavailabilityHours += emp.hours;
      } else {
        // For fully unavailable statuses (Holiday, Sick, etc.)
        empData.hasUnavailableStatus = true;
        empData.unavailabilityHours += emp.hours;
      }
    });

    // Build the final summary using the consolidated employee data with proper status priority
    employeeSummaryByDate[dateStr] = Array.from(employeeMap.entries()).map(
      ([employeeName, empData]) => {
        // Apply consolidation rules:
        // 1. Fully unavailable statuses (Holiday, Sick) override everything
        // 2. Partial Availability + Available = show both (partial availability hours counted as unavailable)
        // 3. Just Available = available

        let finalUnavailabilityHours = empData.unavailabilityHours;

        // If someone has both Available and Partial Availability, keep both
        // If someone has fully unavailable status, that overrides Available but Partial Availability hours are still counted

        // Calculate free windows for this employee/date
        const employeeDetails =
          employeesByDate[dateStr]?.filter(
            (emp) => emp.employeeName === employeeName,
          ) || [];

        // Collect availability, unavailability, and scheduled time windows
        let availabilityWindows = "";
        let unavailabilityWindows = "";
        let scheduledWindows = "";

        employeeDetails.forEach((emp) => {
          if (
            emp.status === "Available" &&
            emp.timeWindows &&
            emp.timeWindows !== "-"
          ) {
            availabilityWindows = availabilityWindows
              ? `${availabilityWindows}, ${emp.timeWindows}`
              : emp.timeWindows;
          } else if (
            LEAVE_TYPES.includes(emp.status) &&
            emp.timeWindows &&
            emp.timeWindows !== "-"
          ) {
            // Only count actual leave types as unavailability (not 'Ad-hoc' which is scheduled work)
            unavailabilityWindows = unavailabilityWindows
              ? `${unavailabilityWindows}, ${emp.timeWindows}`
              : emp.timeWindows;
          } else if (
            emp.status === "Ad-hoc" &&
            emp.timeWindows &&
            emp.timeWindows !== "-"
          ) {
            // Ad-hoc status represents scheduled work, not unavailability
            scheduledWindows = scheduledWindows
              ? `${scheduledWindows}, ${emp.timeWindows}`
              : emp.timeWindows;
          }
        });

        // CRITICAL: Always check for scheduled windows from guaranteed hours data
        // This applies even when employee has availability record - we need actual scheduled windows
        const empNormalized = normalizeName(employeeName);
        const scheduleKey = `${empNormalized}|${dateStr}`;
        const guaranteedWindows = adhocWindowsMap.get(scheduleKey);
        if (guaranteedWindows && guaranteedWindows.length > 0) {
          // Convert time intervals to time window strings
          const guaranteedWindowStrings = guaranteedWindows
            .map(
              ([start, end]: [number, number]) =>
                `${fromMin(start)}-${fromMin(end)}`,
            )
            .join(", ");
          scheduledWindows = scheduledWindows
            ? `${scheduledWindows}, ${guaranteedWindowStrings}`
            : guaranteedWindowStrings;
        }

        // Calculate free windows using our capacity windows utility
        let freeWindows = "";
        try {
          if (availabilityWindows) {
            // EXCLUDE night windows from capacity display
            // Only include day windows (06:00-22:00)
            const allWindows = availabilityWindows
              .split(',')
              .map(w => w.trim())
              .filter(w => w && w.includes('-'));

            // Filter to only day windows (start hour between 06:00 and 22:00)
            const dayWindows = allWindows.filter(w => {
              const [start] = w.split('-').map(t => t.trim());
              const startHour = parseInt(start.split(':')[0]);
              return startHour >= 6 && startHour < 22; // Day = 06:00-22:00
            });
            
            // Check if employee has ONLY night windows (no day availability)
            if (dayWindows.length === 0 && allWindows.length > 0) {
              logger.debug(`EXCLUDING night-only employee from capacity: ${employeeName} on ${dateStr}`);
              // Return null to mark for filtering - they only have night availability
              return null;
            }

            const filteredAvailability = dayWindows.join(', ');

            if (filteredAvailability) {
              const capacityResult = computeCapacityWindows(
                {
                  employeeName,
                  date: dateStr,
                  availabilityWindows: filteredAvailability,
                  unavailabilityWindows,
                  scheduledWindows,
                  desiredMinutes: empData.contractedDailyHours * 60, // Convert hours to minutes
                },
                {
                  roundToMinutes: 15,
                  minWindowMinutes: 60,
                  bufferMinutes: 0,
                },
              );
              freeWindows = capacityResult.freeWindows;
            }
          }
        } catch (error) {
          logger.warn(
            `Error calculating free windows for ${employeeName} on ${dateStr}:`,
            error,
          );
          freeWindows = "";
        }

        // Get cancelled visits for this employee on this specific date
        const empNormalizedName = normalizeName(employeeName);
        const cancelledVisits =
          cancelledVisitsForDate.get(empNormalizedName) ?? "—";

        // Get transport mode and gender from master employee list
        const masterEmployee = masterEmployees.find(
          (emp) => emp.normalizedName === empNormalizedName,
        );
        const transportMode = masterEmployee?.transportMode || "";
        const gender = masterEmployee?.gender || "";

        // CRITICAL: Log gender assignment for debugging
        if (!gender) {
          logger.debug(`SUMMARY: ${employeeName} on ${dateStr} - NO GENDER (normalized: ${empNormalized})`);
        }

        const summaryRecord = {
          employeeName,
          availability: empData.contractedDailyHours, // Direct contracted daily hours from Employee Details
          unavailability: finalUnavailabilityHours,
          scheduledHours: empData.scheduledHours,
          difference:
            empData.contractedDailyHours -
            finalUnavailabilityHours -
            empData.scheduledHours,
          freeWindows, // New field: time slots available for new clients
          cancelledVisits, // New field: cancelled visit time windows
          transportMode, // Transport mode from CG Data (e.g., "Car", "Walker")
          gender, // CRITICAL: Gender derived from title in CG Data (e.g., "male", "female") - MUST be populated for auto-scheduler
        };

        // Debug logging to verify scheduled hours are being set
        if (empData.scheduledHours > 0) {
          logger.debug(`SUMMARY RECORD with scheduled hours: ${employeeName} on ${dateStr} = ${empData.scheduledHours}h`);
        }

        return summaryRecord;
      },
    ).filter((record): record is NonNullable<typeof record> => record !== null);
  }

  // === ALL VISIT DATA EXTRACTION NOW MOVED TO extractAndStoreGeographicalData ===
  // The original loop that created visits from 'guaranteed' data has been removed
  // and replaced with a comment indicating that the new extraction is handled elsewhere.
  const visitsMap = new Map<string, any>(); // Placeholder, actual visits are handled in extractAndStoreGeographicalData
  const visitsByDate = new Map<string, any[]>(); // Placeholder


  // Re-sort after injection
  Object.values(employeesByDate).forEach((employees) => {
    employees.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  });


  const result = {
    kpis,
    dailySummary,
    employeesByDate,
    employeeSummaryByDate,
    cleanedRecords,
    warnings: warnings.length > 0 ? warnings : undefined,
  };

  // Save to database for historical tracking
  try {
    const weekStart = result.dailySummary[0]?.date || "";
    const weekEnd =
      result.dailySummary[result.dailySummary.length - 1]?.date || "";

    if (!branchId) {
      throw new Error("branchId is required to save capacity analysis");
    }

    const analysisData: InsertCapacityAnalysis = {
      branchId, // Required for data isolation
      weekStartDate: weekStart,
      weekEndDate: weekEnd,
      kpis: result.kpis as any,
      dailySummary: result.dailySummary as any,
      employeesByDate: result.employeesByDate as any,
      employeeSummaryByDate: result.employeeSummaryByDate as any,
      warnings: result.warnings as any,
    };

    storage
      .saveCapacityAnalysis(analysisData)
      .then(() => {
        logger.debug("Successfully saved capacity analysis to database");
      })
      .catch((error) => {
        logger.error("Error saving to database:", error);
      });
  } catch (error) {
    logger.error("Error preparing database save:", error);
    // Don't throw - still return the result even if save fails
  }

  // Extract and store geographical data for scheduling optimization
  if (branchId) {
    await extractAndStoreGeographicalData(cgData, guaranteed, branchId, options?.ghWorkbookBuffer); // Pass raw GH workbook buffer
  } else {
    logger.debug(`WARNING: No branchId provided - skipping geographical data extraction`);
  }

  // Retrieve geographical data to include in the result
  try {
    const employeeLocations = branchId ? await storage.getAllEmployeeLocations(branchId) : [];
    const clientLocations = branchId ? await storage.getAllClientLocations(branchId) : [];

    const resultWithLocations = result as ProcessingResult;

    resultWithLocations.employeeLocations = employeeLocations.map(emp => ({
      employeeName: emp.employeeName,
      homePostcode: emp.homePostcode,
      homeLat: emp.homeLat ? Number(emp.homeLat) : undefined,
      homeLng: emp.homeLng ? Number(emp.homeLng) : undefined,
      transportMode: emp.transportMode || undefined,
      gender: emp.gender || undefined, // Include gender for schedule matching
    }));

    resultWithLocations.clientLocations = clientLocations.map(cli => ({
      clientName: cli.clientName,
      addressLine: cli.addressLine,
      postcode: cli.postcode,
      lat: cli.lat ? Number(cli.lat) : undefined,
      lng: cli.lng ? Number(cli.lng) : undefined,
    }));

    logger.debug(`Including ${resultWithLocations.employeeLocations.length} employee locations and ${resultWithLocations.clientLocations.length} client locations in result`);
  } catch (error) {
    logger.error('Error retrieving geographical data:', error);
    // Don't throw - return result without location data
  }

  return result;
}

// Extract and store geographical data for route optimization
async function extractAndStoreGeographicalData(cgData: any[], guaranteed: any[], branchId?: string, ghWorkbookBuffer?: Buffer) { // Added ghWorkbookBuffer parameter
  logger.debug(`EXTRACTING GEOGRAPHICAL DATA FOR SCHEDULING OPTIMIZATION...`);
  logger.debug(`CG Data rows to process: ${cgData.length}`);
  logger.debug(`Branch ID: ${branchId || 'NONE'}`);

  if (!branchId) {
    logger.debug(` WARNING: No branchId provided - geographical data will not be saved to database`);
    return;
  }

  try {
    // FRESH DATA STRATEGY: Clear existing employee/client locations for this branch before
    // repopulating from the uploaded file. This ensures terminated/inactive staff never linger.
    const clearedEmployees = await storage.clearEmployeeLocations(branchId);
    const clearedClients = await storage.clearClientLocations(branchId);
    logger.debug(`Cleared ${clearedEmployees} old employee locations and ${clearedClients} old client locations for branch ${branchId} — repopulating fresh from uploaded files`);

    // Extract employee locations from CG Data Export
    const employeeLocationsMap = new Map<string, any>();

    logger.debug(`Starting to iterate through ${cgData.length} CG Data rows...`);
    for (const row of cgData) {
      const employeeName = row["CAREGiver Name"];
      const postcode = row["PostCode"];
      const transportMode = row["TransportModeDescription"]?.toLowerCase();

      // Extract gender from Title column (Mr = male, Mrs/Miss/Ms = female)
      const title = pickCol(row, ["Title", "Employee Title", "Title Description"]) || "";
      const titleLower = title.toLowerCase().trim();

      let gender: "male" | "female" | undefined = undefined;
      if (titleLower === "mr") {
        gender = "male";
      } else if (["miss", "ms", "mrs"].includes(titleLower)) {
        gender = "female";
      }

      if (employeeName && postcode) {
        const normalizedTransport = toTransportMode(transportMode);

        // Check geocode_cache (not employee_locations — we just cleared that)
        const geocoded = await geocodeWithFallback(postcode, storage, branchId);
        const locationData: any = {
          branchId,
          employeeName,
          homePostcode: postcode,
          transportMode: normalizedTransport,
          gender,
        };

        if (geocoded && geocoded.lat && geocoded.lng) {
          locationData.homeLat = geocoded.lat;
          locationData.homeLng = geocoded.lng;
          logger.debug(`Geocoded ${employeeName} at ${postcode}`);
        } else {
          logger.debug(`Could not geocode ${employeeName} at ${postcode}`);
        }

        employeeLocationsMap.set(employeeName, locationData);
      }
    }

    logger.debug(`Employee locations: ${employeeLocationsMap.size} from current upload file`);

    // Store all fresh employee locations
    for (const locationData of Array.from(employeeLocationsMap.values())) {
      await storage.upsertEmployeeLocation(locationData);
    }

    // Extract client locations from Care Pro Guaranteed Hours
    // CRITICAL FIX: Use the RAW workbook buffer to extract client locations
    // because guaranteedData has already been filtered for scheduling
    logger.debug(`Extracting client locations from raw GH Excel workbook`);

    const clientLocationsMap = new Map<string, {
      branchId: string;
      clientName: string;
      addressLine: string;
      postcode: string;
      lat: string | null;
      lng: string | null;
    }>();
    const clientsToGeocode: Array<{
      branchId: string;
      clientName: string;
      addressLine: string;
      postcode: string;
      lat: string | null;
      lng: string | null;
    }> = [];

    // Parse raw GH workbook to get ALL rows (not just filtered scheduling rows)
    let rawGHRows: any[] = [];
    if (ghWorkbookBuffer) {
      const wb = await XLSX.read(ghWorkbookBuffer, { type: 'buffer' });
      const sheetName = wb.SheetNames.includes('Data') ? 'Data' : wb.SheetNames[0];
      const rows2d = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName], {
        header: 1,
        raw: true,
        blankrows: false
      }) as any[][];

      // Find header row (first non-empty row)
      const headerIdx = rows2d.findIndex(r => r.some(cell => String(cell ?? '').trim() !== ''));
      if (headerIdx >= 0) {
        const headers = rows2d[headerIdx].map(v => String(v ?? '').trim());
        rawGHRows = rows2d.slice(headerIdx + 1).map(r => {
          const o: Record<string, any> = {};
          headers.forEach((h, i) => (o[h] = r[i]));
          return o;
        });
        logger.debug(`Parsed ${rawGHRows.length} raw GH rows for client location extraction`);
      }
    }

    for (const row of rawGHRows) {
      // Skip cancelled or secondary multiple care entries
      if (!isCancellationBlank(row["Cancellation Description"])) {
        continue;
      }
      if (isSecondaryMultipleCare(row["Actual Service Type Description"])) {
        continue;
      }

      // Prioritize 'Service Location Name' as the client identifier
      const clientName = pickCol(row, CLIENT_COLS);

      // Try multiple column names for address (different branches may use different names)
      const ADDRESS_COLS = [
        'Service Location Address',
        'Client Address',
        'Address',
        'Service Address',
        'Location Address'
      ];
      const serviceLocationAddress = pickCol(row, ADDRESS_COLS);

      // Try to extract postcode from the address if possible
      let postcode = "";
      let addressLine = serviceLocationAddress || "";

      if (serviceLocationAddress && typeof serviceLocationAddress === 'string') {
        const addressStr = serviceLocationAddress.trim();
        logger.debug(`DEBUG: Processing address for ${clientName}: "${addressStr}"`);

        // Enhanced UK postcode pattern matching - more comprehensive patterns
        const postcodePatterns = [
          /\b([A-Z]{1,2}[0-9R][0-9A-Z]?\s*[0-9][A-Z]{2})\b/i,  // Standard UK postcode
          /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/i,        // Alternative pattern
          /([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})$/i,                 // End of string pattern
          /\b([A-Z]{2}\d\s*\d[A-Z]{2})\b/i,                     // ML6 6LE style
          /\b([A-Z]\d{1,2}\s*\d[A-Z]{2})\b/i,                   // G65 0JN style
          /\b([A-Z]{2}\d{1,2}\s*\d[A-Z]{2})\b/i,                // FK6 5NA style
        ];

        let postcodeMatch = null;
        for (const pattern of postcodePatterns) {
          postcodeMatch = addressStr.match(pattern);
          if (postcodeMatch) {
            logger.debug(`DEBUG: Postcode pattern matched: ${pattern} -> "${postcodeMatch[1]}"`);
            break;
          }
        }

        if (postcodeMatch) {
          postcode = normalisePostcode(postcodeMatch[1]);
          // Remove postcode from address line and clean up
          addressLine = addressStr.replace(postcodeMatch[0], "").trim().replace(/,\s*$/, "").replace(/\s+/g, " ");
          logger.debug(`DEBUG: Extracted postcode "${postcode}" from address, remaining: "${addressLine}"`);
        } else {
          // Try manual parsing for common patterns like "Street, City, Region POSTCODE"
          const parts = addressStr.split(',').map(p => p.trim());
          if (parts.length >= 2) {
            const lastPart = parts[parts.length - 1];
            const secondLastPart = parts[parts.length - 2];

            // Check if last part looks like a postcode
            const simplePostcodeCheck = /^[A-Z]{1,2}\d{1,2}\s*\d[A-Z]{2}$/i;
            if (simplePostcodeCheck.test(lastPart)) {
              postcode = normalisePostcode(lastPart);
              addressLine = parts.slice(0, -1).join(', ');
              logger.debug(`DEBUG: Manual postcode extraction: "${postcode}" from "${lastPart}", address: "${addressLine}"`);
            } else if (simplePostcodeCheck.test(secondLastPart)) {
              postcode = normalisePostcode(secondLastPart);
              addressLine = parts.slice(0, -2).join(', ') + (parts.length > 2 ? ', ' + parts[parts.length - 1] : '');
              logger.debug(`DEBUG: Manual postcode extraction from second-last: "${postcode}", address: "${addressLine}"`);
            } else {
              addressLine = addressStr;
              logger.debug(`DEBUG: Manual parsing failed, no postcode pattern found in parts: ${JSON.stringify(parts)}`);
            }
          } else {
            addressLine = addressStr;
            logger.debug(`DEBUG: No postcode found in address: "${addressStr}" for client: ${clientName}`);
          }
        }
      }

      // Also check if there's a separate postcode column
      if (!postcode && row["Postcode"]) {
        postcode = String(row["Postcode"]).trim().toUpperCase();
      }
      if (!postcode && row["Post Code"]) {
        postcode = String(row["Post Code"]).trim().toUpperCase();
      }
      if (!postcode && row["Postal Code"]) {
        postcode = String(row["Postal Code"]).trim().toUpperCase();
      }

      if (clientName) {
        const clientKey = clientName.trim();

        // Log if we have a client but no address data (helps debug missing client locations)
        if (!addressLine && !postcode) {
          logger.debug(`Client "${clientKey}" has no address or postcode - will save without geocoding`);
        }

        // Check if client already has geocoded coordinates
        const existingClient = await storage.getClientLocationByName(branchId, clientKey);

        if (!clientLocationsMap.has(clientKey)) {
          const clientData = {
            branchId, // Required for data isolation
            clientName: clientKey,
            addressLine: addressLine || "",
            postcode: postcode || "",
            lat: existingClient?.lat || null,
            lng: existingClient?.lng || null,
          };

          clientLocationsMap.set(clientKey, clientData);

          // Only add to geocoding queue if we have address data AND not already geocoded
          if (addressLine || postcode) {
            if (!existingClient?.lat || !existingClient?.lng) {
              logger.debug(`Cache miss for client "${clientKey}" - needs geocoding`);
              clientsToGeocode.push(clientData);
            } else {
              logger.debug(`Cache hit for client "${clientKey}" - using existing coordinates`);
            }
          }
        } else {
          // Update existing entry if we have better data
          const existing = clientLocationsMap.get(clientKey)!;
          if (!existing.postcode && postcode) {
            existing.postcode = postcode;
          }
          if (!existing.addressLine && addressLine) {
            existing.addressLine = addressLine;
          }
        }
      }
    }

    logger.debug(`Client locations: ${clientLocationsMap.size} total (${clientsToGeocode.length} need geocoding, ${clientLocationsMap.size - clientsToGeocode.length} cached)`);

    // Store client locations
    for (const locationData of Array.from(clientLocationsMap.values())) {
      await storage.upsertClientLocation(locationData);
    }

    logger.debug(`Starting enhanced batch geocoding for locations...`);

    // Build reverse lookup for employees by postcode (so we can map geocoder results back)
    const employeeByPostcode = new Map<string, string[]>();
    for (const [name, data] of Array.from(employeeLocationsMap.entries())) {
      const pc = normalisePostcode(data.homePostcode || "");
      if (!pc) continue;
      if (!employeeByPostcode.has(pc)) employeeByPostcode.set(pc, []);
      employeeByPostcode.get(pc)!.push(name);
    }

    // Build multiple lookup maps for clients to handle different matching scenarios
    const clientByPostcode = new Map<string, string[]>();
    const clientByAddress = new Map<string, string>();
    const clientKeyMap = new Map<string, string>();

    for (const v of Array.from(clientLocationsMap.values())) {
      const pc = normalisePostcode(v.postcode || "");
      const addr = (v.addressLine || "").trim().toUpperCase();

      // Build postcode-based lookup
      if (pc) {
        if (!clientByPostcode.has(pc)) clientByPostcode.set(pc, []);
        clientByPostcode.get(pc)!.push(v.clientName);
      }

      // Build address-based lookup
      if (addr) {
        clientByAddress.set(addr, v.clientName);
      }

      // Original key-based lookup
      clientKeyMap.set(`${addr}|${pc}`, v.clientName);
    }

    // ----------------- EMPLOYEE GEOCODING (SAVE RESULTS) -----------------
    const employeePostcodes = Array.from(employeeLocationsMap.values())
      .map(v => v.homePostcode)
      .filter(Boolean)
      .map(normalisePostcode);

    if (employeePostcodes.length > 0) {
      try {
        const res = await fetch("http://localhost:5000/api/geo/geocode-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postcodes: employeePostcodes, addresses: [], branchId: branchId }), // Pass branchId here
        });
        if (!res.ok) {
          logger.debug("Employee geocoding failed:", await res.text());
        } else {
          const payload = await res.json(); // expect { results: [{ input, lat, lng, success, ...}] }
          const results = payload?.results ?? [];
          let saved = 0;
          for (const r of results) {
            if (!r?.success || !Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;
            const pc = normalisePostcode(r.input || r.postcode || "");
            const names = employeeByPostcode.get(pc) ?? [];
            for (const employeeName of names) {
              const base = employeeLocationsMap.get(employeeName) || {};
              await storage.upsertEmployeeLocation({
                branchId: branchId!, // Required for data isolation
                employeeName,
                homePostcode: pc,
                homeLat: r.lat.toString(),
                homeLng: r.lng.toString(),
                transportMode: base.transportMode || "car",
                gender: base.gender, // Include gender from base data
              });
              saved++;
            }
          }
          if (saved > 0) {
            logger.debug(`Employee geocoding saved for ${saved} new records`);
          } else {
            logger.debug(`Employee geocoding: All ${employeeLocationsMap.size} employees already geocoded (using cached coordinates)`);
          }
        }
      } catch (err) {
        logger.debug("Employee geocoding error:", err);
      }
    }

    // ----------------- CLIENT GEOCODING (SAVE RESULTS) -----------------
    // Only geocode clients that don't have coordinates (from clientsToGeocode list)
    const clientAddresses = clientsToGeocode
      .map(v => ({ address: (v.addressLine || "").trim(), postcode: normalisePostcode(v.postcode || "") }))
      .filter(v => v.address || v.postcode);

    if (clientAddresses.length > 0) {
      logger.debug(`Starting batch geocoding for ${clientAddresses.length} NEW client addresses (${clientLocationsMap.size - clientAddresses.length} already cached):`);
      clientAddresses.slice(0, 10).forEach((addr, i) => {
        logger.debug(`  ${i + 1}. Address: "${addr.address}", Postcode: "${addr.postcode}"`);
      });

      try {
        const requestBody = {
          postcodes: clientAddresses.map(a => a.postcode).filter(Boolean),
          addresses: clientAddresses.map(a => a.address).filter(Boolean),
          branchId: branchId, // Pass branchId here
        };

        logger.debug(`Sending geocoding request with ${requestBody.postcodes.length} postcodes and ${requestBody.addresses.length} addresses`);

        const res = await fetch("http://localhost:5000/api/geo/geocode-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        if (!res.ok) {
          logger.debug("Client geocoding failed:", await res.text());
        } else {
          const payload = await res.json(); // expect { results: [{ address, postcode, lat, lng, success }] }
          const results = payload?.results ?? [];
          let saved = 0;
          let failed = 0;

          for (const r of results) {
            logger.debug(`GEOCODING RESULT: ${JSON.stringify(r)}`);

            if (!r?.lat || !r?.lng || !Number.isFinite(Number(r.lat)) || !Number.isFinite(Number(r.lng))) {
              logger.debug(`Invalid coordinates for query: ${r?.query || 'unknown'}`);
              failed++;
              continue;
            }

            const pc = normalisePostcode(r.query || r.postcode || r.input || "");
            const addr = (r.address || "").trim().toUpperCase();

            // Find ALL clients at this postcode and save coordinates for each one.
            // Previously only candidates[0] was saved — all others were left with null lat/lng.
            if (pc) {
              const candidates = clientByPostcode.get(pc) ?? [];
              if (candidates.length > 0) {
                if (candidates.length > 1) {
                  logger.debug(`Multiple clients share postcode ${pc} — saving coords for all ${candidates.length}: ${candidates.join(', ')}`);
                }
                for (const cName of candidates) {
                  logger.debug(`SAVING client geocode - Name: ${cName}, Postcode: "${pc}", Coordinates: ${r.lat}, ${r.lng}`);
                  await storage.upsertClientLocation({
                    branchId: branchId!,
                    clientName: cName,
                    addressLine: clientLocationsMap.get(cName)?.addressLine || "",
                    postcode: pc,
                    lat: String(r.lat),
                    lng: String(r.lng),
                  });
                  saved++;
                }
                continue; // handled via postcode — skip address fallback
              }
            }

            // Postcode-based lookup found nothing — fallback to address matching
            let clientName = null;
            if (addr) {
              clientName = clientByAddress.get(addr);
              if (clientName) {
                logger.debug(`Found client via address match: ${clientName}`);
              } else {
                for (const [mapAddr, mapClientName] of Array.from(clientByAddress.entries())) {
                  if (addr.includes(mapAddr) || mapAddr.includes(addr)) {
                    clientName = mapClientName;
                    logger.debug(`Found client via partial address match: ${clientName}`);
                    break;
                  }
                }
              }
            }

            if (!clientName) {
              logger.debug(`No client found for geocoding result - Query: "${r.query}", Postcode: "${pc}"`);
              failed++;
              continue;
            }

            logger.debug(`SAVING client geocode - Name: ${clientName}, Postcode: "${pc}", Coordinates: ${r.lat}, ${r.lng}`);
            await storage.upsertClientLocation({
              branchId: branchId!,
              clientName,
              addressLine: clientLocationsMap.get(clientName)?.addressLine || "",
              postcode: pc,
              lat: String(r.lat),
              lng: String(r.lng),
            });
            saved++;
          }

          logger.debug(`Geocoding summary: ${saved} saved, ${failed} failed out of ${results.length} results`);
          if (saved > 0) {
            logger.debug(`Client geocoding saved for ${saved} new records`);
          } else {
            logger.debug(`No client locations were successfully geocoded this time`);
          }
        }
      } catch (err) {
        logger.debug("Client geocoding error:", err);
      }
    } else {
      logger.debug(`All client locations already cached - skipping geocoding API calls`);
    }

    // Extract visit data for route optimization using Planned Start/End Date And Time
    const visitsMap = new Map<string, any>();
    const visitsByDate = new Map<string, any[]>(); // Group visits by date for optimization

    logger.debug(`DEBUG: Processing visit data from ${rawGHRows.length} raw GH rows`); // Use rawGHRows here

    for (const row of rawGHRows) { // Iterate over rawGHRows
      // Skip cancelled entries
      if (!isCancellationBlank(row["Cancellation Description"])) continue;

  // EXCLUDE night visits (sleep in, waking night, etc.) from scheduling
  const serviceType = row["Actual Service Type Description"] || row["Service Type Description"] || "";
  if (serviceType) {
    const lowerType = String(serviceType).toLowerCase();
    // Night shifts EXCLUDED from scheduling
    const excludedTypes = ['office hours', 'multiple care (secondary)', 'secondary', 'training', 'shadowing',
      'nights - sleep in', 'sleep in', 'nights - waking nights', 'waking nights', 'night', 'overnight', 'sleepover'];
    if (excludedTypes.some(excluded => lowerType.includes(excluded))) {
      continue;
    }
  }

      // Use the prioritized client name column
      const clientName = pickCol(row, CLIENT_COLS);
      const serviceLocationAddress = pickCol(row, ADDRESS_COLS_GH); // Use helper for address too

      // Use Planned Start/End Date And Time as requested, falling back to Actual or Service Requirement
      const plannedStartTime = row["Planned Start Date And Time"];
      const plannedEndTime = row["Planned End Date And Time"];
      const actualStartTime = row["Actual Start Date And Time"];
      const actualEndTime = row["Actual End Date And Time"];
      const startTime = row["Service Requirement Start Date And Time"];
      const endTime = row["Service Requirement End Date And Time"];

      if (clientName && (plannedStartTime || actualStartTime || startTime)) {
        // Use planned times first as requested, then fall back to others
        const visitStart = plannedStartTime || actualStartTime || startTime;
        const visitEnd = plannedEndTime || actualEndTime || endTime;

        if (visitStart) {
          try {
            const startDate = parseDate(visitStart);
            const visitDate = format(startDate, "yyyy-MM-dd");
            
            // Calculate end date and duration
            const endDate = visitEnd ? parseDate(visitEnd) : null;
            const duration = endDate ?
              Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60)) :
              60;

            // CRITICAL: Reject overnight/multi-day visits completely (crosses midnight)
            if (endDate) {
              const endDateStr = format(endDate, "yyyy-MM-dd");
              if (visitDate !== endDateStr) {
                logger.debug(`REJECTING overnight visit in extractAndStoreGeographicalData: ${clientName} starts ${visitDate} ends ${endDateStr} - crosses midnight boundary`);
                continue; // Skip this visit entirely
              }
            }

            const visitKey = `${clientName}-${visitDate}-${visitStart}`;

            // Get client location for this visit
            const clientLocation = await storage.getClientLocationByName(branchId, clientName);

            if (clientLocation && !visitsMap.has(visitKey)) {
              // Convert to minutes since midnight for optimizer
              const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
              let endMinutes = endDate ? endDate.getHours() * 60 + endDate.getMinutes() : startMinutes + duration;

              // Calculate fallback end date for formatting if original was missing
              const effectiveEndDate = endDate || new Date(startDate.getTime() + duration * 60000);
              
              const visitData = {
                branchId: branchId, // <<< ADDED: Pass branchId to saveVisit
                clientId: clientLocation.id,
                date: visitDate,
                durationMinutes: Math.max(duration, 15), // Minimum 15 minutes duration
                preferredStartTime: visitStart,
                preferredEndTime: visitEnd || format(effectiveEndDate, "yyyy-MM-dd HH:mm:ss"), // Use formatted end date if original was missing
                serviceType: serviceType,
                priority: 1, // Default priority
                // Additional fields for VRPTW optimizer
                startMinutes: startMinutes,
                endMinutes: endMinutes,
                clientName: clientName,
                location: clientLocation.lat && clientLocation.lng ? {
                  lat: parseFloat(clientLocation.lat),
                  lng: parseFloat(clientLocation.lng)
                } : null
              };

              visitsMap.set(visitKey, visitData);

              // Group by date for optimization
              if (!visitsByDate.has(visitDate)) {
                visitsByDate.set(visitDate, []);
              }
              visitsByDate.get(visitDate)!.push(visitData);

              logger.debug(`DEBUG: Added visit ${clientName} on ${visitDate} at ${startMinutes}-${endMinutes} minutes`);
            } else if (!clientLocation) {
              logger.debug(`DEBUG: Client location not found for ${clientName}, skipping visit.`);
            }
          } catch (dateError) {
            // Skip visits with invalid dates
            logger.warn(`Skipping visit with invalid date: ${visitStart}`);
          }
        }
      }
    }

    // Generate service type summary with total hours
    const serviceTypeSummary = new Map<string, number>();
    for (const visitData of Array.from(visitsMap.values())) {
      const serviceType = visitData.serviceType || 'Unknown';
      const durationHours = (visitData.durationMinutes || 0) / 60;
      serviceTypeSummary.set(serviceType, (serviceTypeSummary.get(serviceType) || 0) + durationHours);
    }

    logger.debug(`\n===== VISIT EXTRACTION SERVICE TYPE SUMMARY =====`);
    logger.debug(`Found ${visitsMap.size} visits across ${visitsByDate.size} dates for route optimization`);
    logger.debug(`\nTotal Hours by Service Type:`);

    // Sort by hours (descending) for easier reading
    const sortedServiceTypes = Array.from(serviceTypeSummary.entries())
      .sort((a, b) => b[1] - a[1]);

    sortedServiceTypes.forEach(([serviceType, hours]) => {
      logger.debug(`  ${serviceType}: ${Math.round(hours * 100) / 100} hours`);
    });
    logger.debug(`====================================================\n`);

    // Store visit data
    for (const visitData of Array.from(visitsMap.values())) {
      await storage.saveVisit(visitData);
    }

    // Log final geocoding statistics
    const empLocs = branchId && storage.getAllEmployeeLocations ? await storage.getAllEmployeeLocations(branchId) : [];
    const cliLocs = branchId && storage.getAllClientLocations ? await storage.getAllClientLocations(branchId) : [];
    logger.debug(`After geocode: employees with coords = ${empLocs.filter(e=>Number.isFinite(Number(e.homeLat))&&Number.isFinite(Number(e.homeLng))).length}/${empLocs.length}`);
    logger.debug(`After geocode: clients with coords = ${cliLocs.filter(c=>Number.isFinite(Number(c.lat))&&Number.isFinite(Number(c.lng))).length}/${cliLocs.length}`);

    logger.debug(`Geographical data extraction complete!`);
    logger.debug(`\nSUMMARY FOR BRANCH ${branchId}:`);
    logger.debug(`   Employee locations stored: ${empLocs.length}`);
    logger.debug(`   Client locations stored: ${cliLocs.length}`);
    logger.debug(`   Employees with coordinates: ${empLocs.filter(e=>Number.isFinite(Number(e.homeLat))&&Number.isFinite(Number(e.homeLng))).length}/${empLocs.length}`);
    logger.debug(`   Clients with coordinates: ${cliLocs.filter(c=>Number.isFinite(Number(c.lat))&&Number.isFinite(Number(c.lng))).length}/${cliLocs.length}`);
    logger.debug(`\nYou can now use the Scheduling tab - client visits will have coordinates\n`);

  } catch (error) {
    logger.error('Error extracting geographical data:', error);
  }
}

// Generate Excel export with enhanced analysis tabs
export async function generateExcelExport(
  result: ProcessingResult,
  cleanedRecords: CleanedEmployeeRecord[],
  cgData: CGDataRow[],
): Promise<Buffer> {
  const workbook = XLSX.utils.book_new();

  // Cleaned sheet
  const cleanedData = [
    [
      "Employee Name",
      "Contracted Weekly Hours",
      "Contracted Daily Hours",
      "Date",
      "Status",
      "Time Windows",
      "Hours",
      "Net Capacity",
      "Notes",
      "Post Code",
    ],
    ...cleanedRecords.map((record) => [
      record.employeeName,
      record.contractedWeeklyHours.toString(),
      record.contractedDailyHours.toString(),
      record.date,
      record.status,
      record.timeWindows,
      record.hours.toString(),
      record.netCapacity.toString(),
      record.notes,
      record.postCode,
    ]),
  ];

  const cleanedSheet = XLSX.utils.aoa_to_sheet(cleanedData);
  XLSX.utils.book_append_sheet(workbook, cleanedSheet, "Cleaned");

  // Daily Summary sheet
  const summaryData = [
    [
      "Date",
      "Available Hours",
      "Net Capacity",
      "Unavailability",
      "Holidays",
      "Client Required",
      "Gap",
      "Status",
    ],
    ...result.dailySummary.map((day) => [
      day.date,
      day.availableHours.toString(),
      day.netCapacity.toString(),
      day.unavailability.toString(),
      day.holidays.toString(),
      day.clientRequired.toString(),
      day.gap.toString(),
      day.status,
    ]),
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, "DailySummary");

  // Employee Daily Detail sheet
  const detailData = [
    [
      "Date",
      "Employee Name",
      "Status",
      "Time Windows",
      "Contracted Daily Hours",
      "Hours",
      "Net Capacity",
      "Notes",
    ],
  ];

  Object.entries(result.employeesByDate).forEach(([date, employees]) => {
    employees.forEach((emp) => {
      detailData.push([
        date,
        emp.employeeName,
        emp.status,
        emp.timeWindows,
        emp.contractedDailyHours.toString(),
        emp.hours.toString(),
        emp.netCapacity.toString(),
        emp.notes,
      ]);
    });
  });

  const detailSheet = XLSX.utils.aoa_to_sheet(detailData);
  XLSX.utils.book_append_sheet(workbook, detailSheet, "EmployeeDailyDetail");

  // Employee Master List sheet (CG Data with PostCode)
  const masterListData = [
    [
      "Employee Name",
      "Weekly Hours",
      "Transport Mode",
      "Title",
      "Gender",
      "Post Code",
    ],
    ...cgData.map((emp) => [
      emp["CAREGiver Name"],
      emp["Weekly Hours"].toString(),
      emp.TransportModeDescription || "",
      emp.Title || "",
      emp.Gender || "",
      emp.PostCode || "",
    ]),
  ];

  const masterListSheet = XLSX.utils.aoa_to_sheet(masterListData);
  XLSX.utils.book_append_sheet(workbook, masterListSheet, "EmployeeMasterList");

  // === EmployeeFit tab ===
  try {
    const { buildEmployeeFitRows } = await import("./employee-fit");
    const fitRows = await buildEmployeeFitRows(
      result.employeesByDate,
      result.employeeSummaryByDate,
      5
    );

    const header = [
      "Date","Employee","Status","Windows","Contracted Daily (h)","Scheduled (h)",
      "Client 1","Travel 1 (min)","Duration 1 (min)",
      "Client 2","Travel 2 (min)","Duration 2 (min)",
      "Client 3","Travel 3 (min)","Duration 3 (min)",
      "Client 4","Travel 4 (min)","Duration 4 (min)",
      "Client 5","Travel 5 (min)","Duration 5 (min)",
    ];
    const aoa = [ header, ...fitRows.map(r => [
      r.Date, r.Employee, r.Status, r.Windows, r.ContractedDaily, r.ScheduledHours,
      r.Client1, r.Travel1, r.Duration1,
      r.Client2, r.Travel2, r.Duration2,
      r.Client3, r.Travel3, r.Duration3,
      r.Client4, r.Travel4, r.Duration4,
      r.Client5, r.Travel5, r.Duration5,
    ])];

    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(workbook, sheet, "EmployeeFit");
  } catch (e) {
    logger.debug("EmployeeFit generation skipped:", e);
  }

  // Heatmap tabs excluded from export as per user request
  logger.debug("Heatmap sheets excluded from Excel export");

  return await XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}