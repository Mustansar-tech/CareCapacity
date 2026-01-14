import * as XLSX from "xlsx";
import { parse, format, addDays } from "date-fns";
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

// Enhanced geocoding with fallback hierarchy
export async function geocodeWithFallback(postcode: string, storage: any, branchId: string): Promise<any> {
  const normalizedPostcode = postcode.trim().toUpperCase();
  const prefix = normalizedPostcode.substring(0, 2);

  // Step 1: Try exact postcode from cache (branch-scoped)
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

  // Step 1.5: Try fallback cache for this prefix (OPTIMIZATION: avoid repeated API calls for same area)
  const fallbackCached = await storage.getGeocode(branchId, `fallback:${prefix}`);
  if (fallbackCached) {
    return {
      query: normalizedPostcode,
      type: 'postcode',
      lat: fallbackCached.lat,
      lng: fallbackCached.lng,
      source: 'cache-fallback',
      approximate: true
    };
  }

  // Step 2: Try exact postcode from API
  try {
    const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(normalizedPostcode)}`);
    if (response.ok) {
      const data = await response.json();
      if (data.status === 200 && data.result) {
        const lat = data.result.latitude.toString();
        const lng = data.result.longitude.toString();

        // Cache the exact result
        await storage.saveGeocode({
          branchId: branchId!, // Required for cache isolation
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
    console.log(`🔄 Exact postcode geocoding failed for ${normalizedPostcode}, trying fallback...`);
  }

  // Step 3: Try postcode district (first part)
  const parts = normalizedPostcode.split(' ');
  if (parts.length >= 2) {
    const district = parts[0];

    // Check cache for district (branch-scoped)
    const districtCached = await storage.getGeocode(branchId, `district:${district}`);
    if (districtCached) {
      return {
        query: normalizedPostcode,
        type: 'postcode',
        lat: districtCached.lat,
        lng: districtCached.lng,
        source: 'cache-district',
        approximate: true
      };
    }

    // Try district from API
    try {
      const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(district)}`);
      if (response.ok) {
        const data = await response.json();
        if (data.status === 200 && data.result) {
          const lat = data.result.latitude.toString();
          const lng = data.result.longitude.toString();

          // Cache the district result
          await storage.saveGeocode({
            branchId: branchId!, // Required for cache isolation
            key: `district:${district}`,
            lat,
            lng,
            source: 'postcodes.io'
          });

          return {
            query: normalizedPostcode,
            type: 'postcode',
            lat,
            lng,
            source: 'postcodes.io-district',
            approximate: true
          };
        }
      }
    } catch (err) {
      console.log(`🔄 District geocoding failed for ${district}, trying area fallback...`);
    }
  }

  // Step 4: Default to approximate city center based on postcode prefix
  const fallbackLocations: Record<string, {lat: string, lng: string, name: string}> = {
    'EH': { lat: '55.9533', lng: '-3.1883', name: 'Edinburgh' },  // Edinburgh
    'G': { lat: '55.8642', lng: '-4.2518', name: 'Glasgow' },      // Glasgow
    'AB': { lat: '57.1497', lng: '-2.0943', name: 'Aberdeen' },    // Aberdeen
    'DD': { lat: '56.4620', lng: '-2.9707', name: 'Dundee' },      // Dundee
    'IV': { lat: '57.4778', lng: '-4.2247', name: 'Inverness' },   // Inverness
    'KY': { lat: '56.1165', lng: '-3.1359', name: 'Fife' },        // Fife
    'PH': { lat: '56.3959', lng: '-3.4370', name: 'Perth' },       // Perth
    'FK': { lat: '56.1165', lng: '-3.7836', name: 'Falkirk' },     // Falkirk
  };

  const fallback = fallbackLocations[prefix];
  if (fallback) {
    console.log(`📍 Using fallback location for ${normalizedPostcode}: ${fallback.name} (very approximate)`);

    // Cache the fallback to avoid repeated lookups
    await storage.saveGeocode({
      branchId: branchId!, // Required for cache isolation
      key: `fallback:${prefix}`,
      lat: fallback.lat,
      lng: fallback.lng,
      source: 'fallback'
    });

    return {
      query: normalizedPostcode,
      type: 'postcode',
      lat: fallback.lat,
      lng: fallback.lng,
      source: 'fallback-' + fallback.name.toLowerCase(),
      approximate: true
    };
  }

  // Step 5: Ultimate fallback to Edinburgh city center
  console.log(`📍 Using ultimate fallback (Edinburgh) for unknown postcode: ${normalizedPostcode}`);
  return {
    query: normalizedPostcode,
    type: 'postcode',
    lat: '55.9533',
    lng: '-3.1883',
    source: 'fallback-edinburgh',
    approximate: true
  };
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
  "Maternity/Paternity",
  "Sick",
  "Holiday",
  "Compassionate Leave",
  "Other Unavailable",
  "Pre-Agreed Appointment",
];
const STATUS_PRIORITY: Record<string, number> = {
  "Maternity/Paternity": 1,
  Sick: 2,
  Holiday: 3,
  "Compassionate Leave": 4,
  "Other Unavailable": 5,
  "Partial Availability": 6, // ← NEW (not in LEAVE_TYPES)
  Available: 7,
  "Ad-hoc": 7, // NEW
};

// Day-level vs time-slice leave
const DAY_KILLERS = new Set<string>([
  "Holiday",
  "Sick",
  "Maternity/Paternity",
  "Compassionate Leave",
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
const EMPLOYEE_NAME_COLS = ['Actual Employee Name', 'Employee Name', 'Caregiver Name', 'Care giver Name'];
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

  if (s.includes("ad-hoc") || s.includes("adhoc")) return "Ad-hoc";
  return raw ?? "";
}

// Helper function to get scheduled hours for a specific date based on service requirements
// Build Scheduled Hours lookup from Guaranteed sheet
// key: normalized employee name + yyyy-MM-dd(Service Requirement Start Date And Time)
// ---- FALLBACK + ROBUST FILTER HELPERS --------------------------------------

// Same priority used in Hours by Service Type.xlsx:
// 1) Service Requirement  2) Actual  3) Planned
function resolveServiceTimestamps(row: any): { start?: any; end?: any } {
  const srStart = row["Service Requirement Start Date And Time"];
  const srEnd = row["Service Requirement End Date And Time"];
  const acStart = row["Actual Start Date And Time"];
  const acEnd = row["Actual End Date And Time"];
  const plStart = row["Planned Start Date And Time"];
  const plEnd = row["Planned End Date And Time"];

  const start = srStart ?? acStart ?? plStart;
  const end = srEnd ?? acEnd ?? plEnd;
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
      const s = toMin(a);
      const e = toMin(b);
      if (Number.isFinite(s) && Number.isFinite(e) && e > s) out.push([s, e]);
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

    const startV = pickStartForBucket(r);
    const endV = pickCol(r, END_TIME_COLS); // window is Actual start → Actual end
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

    // Track office hours for debugging
    const serviceType = serviceTypeRaw || "";
    const isOfficeHours = serviceType && serviceType.toLowerCase().includes("office");

    if (isOfficeHours) {
      officeHoursIncluded++;
    }

    // Use PLANNED DURATION as requested by user
    const durationCols = [
      "Planned Duration",
      "Duration (Planned)",
      "Duration",
      "Planned Hrs",
      "Planned Hours",
      "Planned Time",
    ];

    let duration = 0;
    for (const col of durationCols) {
      const rawVal = g[col];
      const val = Number(rawVal);
      if (val && isFinite(val) && val > 0) {
        duration = val;
        break;
      }
    }

    if (duration > 0) {
      const current = scheduledHoursMap.get(name) || new Map();
      const dayTotal = current.get(date) || 0;
      current.set(date, dayTotal + duration);
      scheduledHoursMap.set(name, current);
    }

  console.log(`\n🔍 SCHEDULED HOURS FILTERING SUMMARY:`);
  console.log(`  📊 Total guaranteed hours entries: ${totalProcessed}`);
  console.log(`  ❌ Filtered cancelled entries: ${filteredCancelled}`);
  console.log(
    `  ❌ Filtered "Multiple Care (Secondary)": ${filteredSecondary}`,
  );
  console.log(
    `  ❌ Filtered "Live In Care (SC)": ${filteredLiveInCare}`,
  );
  console.log(
    `  ✅ Office hours included in totals: ${officeHoursIncluded}`,
  );
  console.log(
    `  ✅ Valid entries for scheduling: ${totalProcessed - filteredCancelled - filteredSecondary - filteredLiveInCare}`,
  );



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

    // Handle overnight shifts
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
  console.log(`\n🚨 ===== PARSING EXCEL FILES FUNCTION STARTED =====`);
  console.log(
    `🔧 Buffer lengths: availability=${availabilityBuffer?.length}, guaranteed=${guaranteedBuffer?.length}, cgData=${cgDataBuffer?.length}`,
  );
  const warnings: string[] = [];

  // Parse Availability Export.xlsx
  const availabilityWorkbook = XLSX.read(availabilityBuffer);
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
  const guaranteedWorkbook = XLSX.read(guaranteedBuffer);
  console.log(`📊 Guaranteed workbook sheets available:`, guaranteedWorkbook.SheetNames);
  
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
  
  console.log(`📊 Guaranteed Hours sheet parsed: ${guaranteedData.length} rows found`);
  console.log(`🏢 Branch context: ${branchId || 'NO BRANCH ID'}`);
  if (guaranteedData.length > 0) {
    console.log(`📊 First row columns:`, Object.keys(guaranteedData[0]).slice(0, 15));
    console.log(`📊 First row sample:`, JSON.stringify(guaranteedData[0]).substring(0, 400));
  }

  // === Calculate demand from Guaranteed Hours data ===
  console.log(`🔧 Calculating demand from Guaranteed Hours data...`);

  // Apply SAME filtering rules as service-delivery-rules.ts for consistency
  // This ensures demand calculation matches the Hours by Service Type logic
  const EXCLUDED_TYPES = [
    'office hours',
    'office',
    'nights - sleep in',
    'sleep in',
    'nights - waking nights',
    'waking nights',
    'night',
    'overnight',
    'sleepover',
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

  // EXCLUDE CANCELLED, SECONDARY, OFFICE, TRAINING, AND SHADOWING
  // Keep night shifts in Client Required calculation as requested
  const DEMAND_EXCLUDED_TYPES = [
    'multiple care (secondary)',
    'secondary',
    '(secondary)',
    'oncall',
    'on call',
    'office hours',
    'office',
    'training',
    'shadowing'
  ];

  const isExcludedType = DEMAND_EXCLUDED_TYPES.some(excluded =>
    normalizedServiceType.includes(excluded.replace(/[^\w\s]/g, '').replace(/\s+/g, ' '))
  );

  if (isExcludedType) return false;

    return true;
  });

  // Log filtering breakdown (same detail as service-delivery-rules.ts)
  const totalFiltered = guaranteedData.length - demandRows.length;
  console.log(
    `🔍 DEMAND FILTERING (INCLUSIVE): Excluded ${totalFiltered} rows from ${guaranteedData.length} total Guaranteed Hours entries`,
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

  console.log(`  ❌ Cancelled: ${cancelledRows.length} rows (${Math.round(cancelledHours * 100) / 100}h)`);
  console.log(`  ❌ Secondary care: ${secondaryRows.length} rows (${Math.round(secondaryHours * 100) / 100}h)`);
  console.log(`  ✅ Night shifts: NOW INCLUDED in demand calculation`);
  console.log(`  ❌ Office hours, Training, Shadowing: EXCLUDED as requested`);

  // Group by weekday and sum duration
  const hoursByWeekday = new Map<string, number>();
  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  demandRows.forEach(row => {
    // Use PLANNED columns as requested by user
    const plannedStart = row["Planned Start Date And Time"];
    if (!plannedStart) return;

    const startDate = parseDate(plannedStart);
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
      console.log(`  📊 Row ${demandRows.indexOf(row) + 1}: ${weekdayName} - ${duration}h from "${foundColumn}" (running total: ${currentTotal + duration}h)`);
    }

    // If no duration found in preferred columns, this visit won't count toward demand
    if (duration > 0) {
      hoursByWeekday.set(weekdayName, currentTotal + duration);
    } else if (demandRows.indexOf(row) < 10) {
      console.log(`  ⚠️ Row ${demandRows.indexOf(row) + 1}: NO DURATION FOUND - checked columns: ${durationCols.join(", ")}`);
    }
  });

  const hoursByWeekdayArray = Array.from(hoursByWeekday.entries())
    .map(({0: weekday, 1: hours}) => ({ weekday, hours: Math.round(hours * 100) / 100 }))
    .sort((a, b) => a.weekday.localeCompare(b.weekday));

  console.log(`📊 Calculated demand from Guaranteed Hours:`, hoursByWeekdayArray);
  console.log(`📊 Total demand rows after filtering: ${demandRows.length}`);

  // Parse CG Data Export.xlsx (Master Employee List) — robust sheet detection
  const cgDataWorkbook = XLSX.read(cgDataBuffer);
  const cgDataSheetName = getCGSheetName(cgDataWorkbook);
  const cgDataSheet = cgDataWorkbook.Sheets[cgDataSheetName];
  const cgRowsRaw = XLSX.utils.sheet_to_json<Record<string, any>>(cgDataSheet, {
    defval: "",
  });

  console.log(`🔍 CG Data sheet names available:`, cgDataWorkbook.SheetNames);
  console.log(`🔍 Using sheet: "${cgDataSheetName}"`);
  console.log(`🔍 Raw CG Data rows: ${cgRowsRaw.length}`);
  if (cgRowsRaw.length > 0) {
    console.log(`🔍 First raw CG Data row:`, cgRowsRaw[0]);
    console.log(`🔍 Available columns:`, Object.keys(cgRowsRaw[0]));
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

  console.log(
    `📊 CG Data: ${cgRowsRaw.length} rows → ${cgData.length} employees with weekly hours (sheet: ${cgDataSheetName})`,
  );
  if (cgData.length > 0) {
    console.log(`🔍 First processed CG Data row:`, cgData[0]);

    // Show gender extraction stats for debugging
    const genderStats = cgData.reduce((acc, emp) => {
      const g = emp.Gender || "unknown";
      acc[g] = (acc[g] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log(`👥 Gender distribution:`, genderStats);

    // Show sample employees with their Title and Gender
    const samplesWithGender = cgData.slice(0, 5).map(emp => ({
      name: emp["CAREGiver Name"],
      title: emp.Title,
      gender: emp.Gender || "unknown"
    }));
    console.log(`👤 Sample employees (Title → Gender):`, samplesWithGender);
  } else {
    console.log(`❌ No valid CG Data rows found - check column names and data`);
  }

  // Process availability data
  const validatedAvailability: ParsedAvailabilityRow[] = [];
  availabilityData.forEach((row, index) => {
    try {
      if (!row["CAREGiver Name"] || !row["Start Date"]) {
        warnings.push(`Availability row ${index + 1}: Missing required fields`);
        return;
      }

      const empName = row["CAREGiver Name"]; // For logging
      const parsedStartDate = parseDate(row["Start Date"]);

      // CRITICAL FIX: Reject entries where start and end dates differ
      // This prevents incorrectly including dates when availability spans multiple days
      if (row["End Date"]) {
        try {
          const parsedEndDate = parseDate(row["End Date"]);
          const startDateStr = format(parsedStartDate, "yyyy-MM-dd");
          const endDateStr = format(parsedEndDate, "yyyy-MM-dd");

          if (startDateStr !== endDateStr) {
            console.log(`🚫 REJECTING availability for ${empName}: Start date ${startDateStr} differs from end date ${endDateStr} - multi-day entries not supported`);
            warnings.push(
              `Availability row ${index + 1} (${empName}): Rejected - start date (${startDateStr}) differs from end date (${endDateStr}). Multi-day availability entries are not supported.`,
            );
            return;
          }
        } catch (endDateError) {
          console.log(`⚠️ Could not parse end date for ${empName}, continuing with start date validation`);
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

              // Skip overnight windows (end time earlier than start time means crosses midnight)
              const startMinutes = parseInt(startTime.split(':')[0]) * 60 + parseInt(startTime.split(':')[1]);
              const endMinutes = parseInt(endTime.split(':')[0]) * 60 + parseInt(endTime.split(':')[1]);

              if (endMinutes < startMinutes) {
                console.log(`🚫 Skipping overnight availability window for ${empName}: ${startTime}-${endTime} (crosses midnight)`);
                return null;
              }

              return `${startTime}-${endTime}`;
            }
            return null;
          })
          .filter((w): w is string => w !== null);

        timeWindows = processedWindows.join(", ");
      } else {
        // Fallback to buildTimeWindow if raw string parsing fails
        const builtWindow = buildTimeWindow(row);

        // Check if built window is overnight
        if (builtWindow) {
          const [start, end] = builtWindow.split('-');
          const startMinutes = parseInt(start.split(':')[0]) * 60 + parseInt(start.split(':')[1]);
          const endMinutes = parseInt(end.split(':')[0]) * 60 + parseInt(end.split(':')[1]);

          if (endMinutes < startMinutes) {
            console.log(`🚫 Skipping overnight availability window for ${empName}: ${builtWindow} (crosses midnight)`);
            timeWindows = "";
          } else {
            timeWindows = builtWindow;
          }
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

      // Required fields with fallback timestamps
      if (
        !row["Actual Employee Name"] ||
        typeof row["Actual Employee Hours Per Week"] !== "number" ||
        typeof row["Actual Pay Rate Hours"] !== "number" ||
        !start ||
        !end
      ) {
        warnings.push(
          `Guaranteed hours row ${index + 1}: Missing or invalid required fields`,
        );
        return;
      }

      // Robust cancellation/secondary checks (match Hours by Service Type.xlsx)
      const isCancelOk = isCancellationBlank(row["Cancellation Description"]);
      const isSecondary = isSecondaryMultipleCare(
        row["Actual Service Type Description"] || "",
      );

      // Check for excluded service types (nights only - office hours MUST be included in scheduled totals)
      const serviceType = row["Actual Service Type Description"] || row["Service Type Description"] || "";
      const isExcludedType = serviceType && (() => {
        const lowerType = String(serviceType).toLowerCase();
        const excludedTypes = [
          // Office hours are INCLUDED in scheduled totals for accurate capacity analysis
          // Only exclude night shifts which don't count toward regular scheduled hours
          'nights - sleep in',
          'sleep in',
          'nights - waking nights',
          'waking nights'
        ];
        return excludedTypes.some(excluded => lowerType.includes(excluded));
      })();

      if (!isCancelOk || isSecondary || isExcludedType) {
        filteredSecondaryCount++;
        return;
      }

      validatedGuaranteed.push(row);
    } catch (error) {
      warnings.push(
        `Guaranteed hours row ${index + 1}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  });

  console.log(
    `🔍 SECONDARY CLIENT FILTERING: Excluded ${filteredSecondaryCount} rows with service descriptions from ${guaranteedData.length} total Care Pro entries`,
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

  // Get dates from guaranteed hours data
  validatedGuaranteed.forEach((row) => {
    try {
      // Use the same robust timestamp resolution as the filtering
      const { start, end } = resolveServiceTimestamps(row);
      if (!start || !end) return;

      const startDate = parseGuaranteedDate(start);
      const endDate = parseGuaranteedDate(end);

      // Add all dates in the service period
      const current = new Date(startDate);
      while (current <= endDate) {
        const dateStr = format(current, "yyyy-MM-dd");
        actualDates.add(dateStr);
        current.setDate(current.getDate() + 1);
      }
    } catch (error) {
      // Skip invalid dates
    }
  });

  // Create weekday to actual dates mapping
  const actualDatesArray = Array.from(actualDates).sort();
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

  console.log(`\n📅 ACTUAL DATES FOUND IN FILES:`);
  console.log(`  Total unique dates: ${actualDatesArray.length}`);
  console.log(
    `  Date range: ${actualDatesArray[0]} to ${actualDatesArray[actualDatesArray.length - 1]}`,
  );

  console.log(`\n📅 WEEKDAY TO ACTUAL DATES MAPPING:`);
  Object.entries(weekdayToActualDates).forEach(([weekday, dates]) => {
    console.log(
      `  ${weekday}: ${dates.length > 0 ? dates.join(", ") : "No dates found"}`,
    );
  });
  console.log(`================================\n`);

  // Map weekday hours to actual dates from the files
  hoursByWeekdayArray.forEach(({ weekday, hours }) => {
    const actualDatesForWeekday = weekdayToActualDates[weekday] || [];

    if (actualDatesForWeekday.length === 0) {
      console.log(
        `⚠️  No actual dates found for ${weekday} (${hours}h) - skipping`,
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
      console.log(`🔄 Mapping: ${weekday} (${hoursPerDate}h) -> ${dateStr}`);
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

  console.log(`\n📊 ===== DEMAND CALCULATION SUMMARY =====`);
  console.log(
    `✅ Calculated from ${demandRows.length} Guaranteed Hours entries`,
  );
  console.log(`📈 Monday hours: ${mondayHours}`);
  console.log(`📈 Total hours: ${totalHours}`);
  console.log(`=======================================\n`);

  // === BRANCH EXTRACTION AND VALIDATION ===
  console.log(`\n🏢 ===== BRANCH DETECTION =====`);

  const branchesDetected = new Set<string>();

  // Extract from CG Data Export (most reliable source)
  if (cgRowsRaw.length > 0) {
    const sampleBranches = cgRowsRaw.slice(0, 5).map(row => extractBranchFromRow(row)).filter(Boolean);
    sampleBranches.forEach(b => b && branchesDetected.add(normalizeBranchName(b)));
    console.log(`📄 CG Data sample branches: ${sampleBranches.join(", ")}`);
  }

  // Extract from Guaranteed Hours
  if (guaranteedData.length > 0) {
    const sampleBranches = guaranteedData.slice(0, 5).map(row => extractBranchFromRow(row)).filter(Boolean);
    sampleBranches.forEach(b => b && branchesDetected.add(normalizeBranchName(b)));
    console.log(`📄 Guaranteed Hours sample branches: ${sampleBranches.join(", ")}`);
  }

  // Extract from Availability
  if (availabilityData.length > 0) {
    const sampleBranches = availabilityData.slice(0, 5).map(row => extractBranchFromRow(row)).filter(Boolean);
    sampleBranches.forEach(b => b && branchesDetected.add(normalizeBranchName(b)));
    console.log(`📄 Availability sample branches: ${sampleBranches.join(", ")}`);
  }

  const detectedBranches = Array.from(branchesDetected);
  console.log(`✅ Detected branches: ${detectedBranches.join(", ")}`);

  let detectedBranch: string | null = null;
  if (detectedBranches.length === 0) {
    warnings.push("⚠️ No branch information found in Excel files. Branch column may be missing.");
    console.log(`⚠️ WARNING: No branch detected - files may be missing branch column`);
  } else if (detectedBranches.length > 1) {
    warnings.push(`⚠️ Multiple branches detected: ${detectedBranches.join(", ")}. Files may be mixed.`);
    console.log(`⚠️ WARNING: Multiple branches detected - potential data mixing!`);
    detectedBranch = detectedBranches[0]; // Use the first detected branch as a fallback
  } else {
    detectedBranch = detectedBranches[0];
  }
  console.log(`🏢 Final detected branch: ${detectedBranch || "NONE"}`);
  console.log(`=======================================\n`);

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
  console.log(`\n🚀 ===== USING CG DATA AS MASTER EMPLOYEE LIST =====`);
  console.log(`📊 Total employees in CG Data: ${cgData.length}`);

  // Log sample CG Data entries
  if (cgData.length > 0) {
    console.log(`📋 Sample CG Data entries:`);
    cgData.slice(0, 3).forEach((emp, idx) => {
      console.log(
        `  ${idx + 1}. ${emp["CAREGiver Name"]} - ${emp["Weekly Hours"]} hours/week`,
      );
    });
  }

  // Debug: Check what demand data we received from filtering
  console.log(`\n===== RECEIVED DEMAND DATA =====`);
  let totalDemandHours = 0;
  demand.forEach((row) => {
    console.log(`  - ${row.Date}: ${row["Required Client Hours"]} hours`);
    totalDemandHours += row["Required Client Hours"];
  });
  console.log(
    `📊 TOTAL DEMAND HOURS FROM FILTERING: ${Math.round(totalDemandHours * 100) / 100} (Expected: 400.33)`,
  );
  console.log(`================================\n`);

  // Build scheduled hours lookup from guaranteed hours data (using exact logic from attached file)
  console.log(`\n🔍 DEBUG: About to call buildScheduledHoursLookup with ${guaranteed.length} guaranteed rows`);

  // Debug: Check if office hours exist in the data
  const officeRows = guaranteed.filter(row => {
    const serviceType = (row["Actual Service Type Description"] || "").toString().toLowerCase();
    return serviceType.includes("office");
  });
  console.log(`🏢 DEBUG: Found ${officeRows.length} office hours rows in guaranteed data`);
  if (officeRows.length > 0) {
    console.log(`🏢 DEBUG: Sample office hours rows:`, officeRows.slice(0, 3).map(r => ({
      employee: r["Actual Employee Name"],
      serviceType: r["Actual Service Type Description"],
      hours: r["Actual Pay Rate Hours"]
    })));
  }

  const scheduledHoursMap = buildScheduledHoursLookup(guaranteed);

  // VERIFICATION: Show what's in the scheduled hours map
  console.log(`\n📊 SCHEDULED HOURS MAP VERIFICATION:`);
  console.log(`  Total entries in map: ${scheduledHoursMap.size}`);
  
  // Show first 10 entries
  let count = 0;
  for (const [key, hours] of Array.from(scheduledHoursMap.entries())) {
    if (count < 10) {
      console.log(`  ${key}: ${hours}h`);
      count++;
    }
  }
  console.log(`=========================================\n`);

  // Debug: Check what's actually in the guaranteed hours data
  if (guaranteed.length > 0) {
    console.log("=== GUARANTEED HOURS DEBUGGING ===");
    console.log("First row raw data:", guaranteed[0]);
    console.log(
      "Service Start Date raw:",
      guaranteed[0]["Service Requirement Start Date And Time"],
    );
    console.log(
      "Service End Date raw:",
      guaranteed[0]["Service Requirement End Date And Time"],
    );
  }

  // Debug CG Data to see what's actually there
  console.log(`🔍 CG Data debugging:`);
  console.log(`  - Total CG Data rows: ${cgData.length}`);
  if (cgData.length > 0) {
    console.log(`  - First row keys:`, Object.keys(cgData[0]));
    console.log(`  - First row:`, cgData[0]);
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

  console.log(
    `📋 Master employee list created: ${masterEmployees.length} employees from CG Data (with non-zero weekly hours)`,
  );
  if (masterEmployees.length > 0) {
    console.log(`  - Sample employee:`, masterEmployees[0]);
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

  // Step 2: Filter availability data to ONLY include master employees (EXACT MATCH TO WORKING IMPLEMENTATION)
  const availabilityFiltered: any[] = [];
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
      const hrs =
        row.Hours !== undefined && row.Hours !== null
          ? Number(row.Hours)
          : hoursBetween(row["Start Time"], row["End Time"]);

      if (isNaN(hrs)) {
        warnings.push(`Availability row ${i + 1}: cannot compute hours`);
        return;
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

  console.log(
    `📊 Availability filtered: ${availabilityFiltered.length} rows (only master employees)`,
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

  // Step 4: Create merged data (original pipeline approach)
  const mergedData = allAvailabilityWithMatching.map((row) => {
    // Handle both matched and unmatched employees
    const key = row.matchedEmployee
      ? row.matchedEmployee.normalizedName
      : normalizeName(row["CAREGiver Name"]);
    const daysAvailable = employeeDays.get(key)!.size;

    // Use CG Data weekly hours if matched, otherwise default to 0
    const contractedWeeklyHours = row.matchedEmployee
      ? row.matchedEmployee.weeklyHours
      : 0;
    const contractedDailyHours = row.matchedEmployee
      ? Math.round((row.matchedEmployee.weeklyHours / daysAvailable) * 100) /
        100
      : 0;

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

    // Day-killer short-circuit
    let hasDayKiller = false;
    let dayKillerStatus = "";
    let dayKillerPriority = 999;

    statusAgg.forEach((_agg, status) => {
      if (DAY_KILLERS.has(status)) {
        const p = STATUS_PRIORITY[status] || 999;
        if (p < dayKillerPriority) {
          dayKillerPriority = p;
          dayKillerStatus = status;
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

    const blockerPairs: Array<[number, number]> = [];
    statusAgg.forEach((_agg, status) => {
      if (TIME_KILLERS.has(status))
        blockerPairs.push(...windowListToPairs(_agg.windows));
    });
    const mergedBlockers = mergeIntervals(blockerPairs, 0);

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
      highestPriorityStatus = dayKillerStatus;
      highestPriority = dayKillerPriority;
    } else if (hasTimeKiller) {
      if (timeKillerIsAllDay || !hasAvailableStatus) {
        // Treat like day-level absence if all-day OR no explicit availability
        highestPriorityStatus = "Other Unavailable";
        highestPriority = STATUS_PRIORITY["Other Unavailable"] || 5;
      } else {
        // Partial blocker AND has availability record
        highestPriorityStatus = "Partial Availability";
        highestPriority = STATUS_PRIORITY["Partial Availability"] || 6;
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

      if (hasDayKiller || (hasTimeKiller && timeKillerIsAllDay)) {
        // Full-day absence → zero capacity
        finalHours = Math.min(agg.hoursRaw || 0.0, daily);
        netCapacity = 0.0;
      } else if (highestPriorityStatus === "Partial Availability") {
        // Keep capacity on partial blocker days
        finalHours = Math.max(daily - totalLeaveCapped, 0.0);
        netCapacity = finalHours;
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
        scheduledHours: Math.round(totalScheduledHours * 100) / 100, // Total scheduled hours for this employee on this date
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

        if (
          record.status !== "Available" &&
          record.status !== "Partial Availability"
        ) {
          hasUnavailableStatus = true;
          totalUnavailableHours += record.hours;
        } else if (record.status === "Partial Availability") {
          // Partial availability adds to unavailable hours but doesn't mark as fully unavailable
          totalUnavailableHours += record.hours;
        }
      });

      // Use the best record's net capacity
      summary.netCapacity += bestRecord.netCapacity;

      // Apply status priority logic with proper handling of partial availability
      if (hasUnavailableStatus) {
        // Count unavailable hours by status type
        records.forEach((record) => {
          if (record.status === "Holiday") {
            summary.holidays += record.hours;
          } else if (
            [
              "Sick",
              "Maternity/Paternity",
              "Compassionate Leave",
              "Other Unavailable",
              "Pre-Agreed Appointment",
            ].includes(record.status)
          ) {
            summary.unavailability += record.hours;
          }
        });
      } else {
        // Count available hours and partial availability hours
        records.forEach((record) => {
          if (record.status === "Available") {
            summary.availableHours += record.hours;
          } else if (record.status === "Partial Availability") {
            // Partial availability contributes to unavailability hours
            summary.unavailability += record.hours;
          }
        });
      }
    });
  });

  // Step 8: Merge with client demand
  const demandMap = new Map<string, number>();
  demand.forEach((row) => {
    const dateStr = format(parseDate(row.Date), "yyyy-MM-dd");
    demandMap.set(dateStr, row["Required Client Hours"]);
  });

  const dailySummary: DailySummaryRecord[] = Array.from(
    dailySummaryMap.entries(),
  )
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
        clientRequired: Math.round(clientRequired * 100) / 100,
        gap,
        status: (gap >= 0 ? "Sufficient" : "Shortage") as
          | "Sufficient"
          | "Shortage",
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  // Step 9: Calculate KPIs
  console.log(`\n===== DAILY SUMMARY CLIENT REQUIRED BREAKDOWN =====`);
  let totalClientRequired = 0;
  dailySummary.forEach((d) => {
    console.log(`  - ${d.date}: ${d.clientRequired} hours`);
    totalClientRequired += d.clientRequired;
  });
  console.log(
    `📊 TOTAL CLIENT REQUIRED FROM DAILY SUMMARY: ${Math.round(totalClientRequired * 100) / 100}`,
  );
  console.log(`==================================================\n`);

  const kpis = {
    netCapacitySum:
      Math.round(
        dailySummary.reduce((sum, d) => sum + d.netCapacity, 0) * 100,
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

    // Debug: Always log for debugging
    console.log(`📝 Adding to employeesByDate[${record.date}]: ${record.employeeName}`);
    console.log(`  - Normalized name: "${empNormalizedName}"`);
    console.log(`  - Master employee found: ${masterEmployee ? 'YES' : 'NO'}`);
    if (masterEmployee) {
      console.log(`  - Master employee gender: "${masterEmployee.gender}"`);
    }
    console.log(`  - Final gender value: "${gender || 'EMPTY'}"`);

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

  // Debug: Verify gender is stored in employeesByDate (CRITICAL for auto-scheduler)
  console.log(`\n🔍 VERIFYING GENDER IN employeesByDate (for auto-scheduler):`);
  const sampleDate = Object.keys(employeesByDate)[0];
  if (sampleDate && employeesByDate[sampleDate]) {
    const sampleEmployees = employeesByDate[sampleDate].slice(0, 10);
    console.log(`  Checking ${sampleEmployees.length} employees on ${sampleDate}:`);
    sampleEmployees.forEach((emp: any) => {
      console.log(`    - ${emp.employeeName}: gender="${emp.gender || 'MISSING'}" (status: ${emp.status})`);
    });

    // Count how many have gender data
    const withGender = sampleEmployees.filter((e: any) => e.gender).length;
    console.log(`  ✅ ${withGender}/${sampleEmployees.length} employees have gender data in employeesByDate`);

    // Show the actual object structure that will be saved
    if (sampleEmployees.length > 0) {
      console.log(`  📦 Sample object structure:`, JSON.stringify(sampleEmployees[0], null, 2));
    }
  }

  // CRITICAL VERIFICATION: Check all dates for gender data completeness
  let totalEmployees = 0;
  let employeesWithGender = 0;
  Object.entries(employeesByDate).forEach(([date, employees]) => {
    (employees as any[]).forEach(emp => {
      totalEmployees++;
      if (emp.gender) employeesWithGender++;
    });
  });
  console.log(`  📊 TOTAL GENDER COVERAGE: ${employeesWithGender}/${totalEmployees} employees (${Math.round(employeesWithGender/totalEmployees*100)}%)`);
  console.log(`=========================================\n`);

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
      const [normName, date] = key.split("|");
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

  // Re-sort after injection
  Object.values(employeesByDate).forEach((employees) => {
    employees.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  });


  // Step 8: Cancelled visits will be extracted per date in employee summary generation

  // Step 9: Generate employee summary by date
  const employeeSummaryByDate: Record<string, any[]> = {};

  Object.entries(employeesByDate).forEach(([dateStr, employees]) => {
    // Extract cancelled visits for this specific date
    console.log(`\n🚫 EXTRACTING CANCELLED VISITS FOR ${dateStr}...`);
    const cancelledVisitsForDate = options?.ghWorkbookBuffer
      ? extractCancelledWindowsFromGHWorkbook(
          options.ghWorkbookBuffer,
          new Date(dateStr),
          60,
        )
      : new Map<string, string>();
    console.log(
      `📊 Found ${cancelledVisitsForDate.size} employees with cancelled visits on ${dateStr}`,
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

        console.log(`📊 Employee summary for ${emp.employeeName} on ${dateStr}:`);
        console.log(`  - Normalized: ${empNormalized}`);
        console.log(`  - Lookup key: ${scheduleKey}`);
        console.log(`  - Scheduled hours from lookup: ${scheduledHoursFromLookup}`);
        console.log(`  - Scheduled hours from emp object: ${emp.scheduledHours || 0}`);

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
      if (emp.status === "Available") {
        empData.hasAvailableStatus = true;
      } else if (emp.status === "Partial Availability") {
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
            // CRITICAL: Filter out any overnight windows before processing
            const filteredAvailability = availabilityWindows
              .split(',')
              .map(w => w.trim())
              .filter(w => {
                if (!w || !w.includes('-')) return false;
                const [start, end] = w.split('-').map(t => t.trim());
                const startMinutes = parseInt(start.split(':')[0]) * 60 + parseInt(start.split(':')[1]);
                const endMinutes = parseInt(end.split(':')[0]) * 60 + parseInt(end.split(':')[1]);

                // Reject if end time is before start time (overnight)
                if (endMinutes < startMinutes) {
                  console.log(`🚫 REJECTING overnight availability window for ${employeeName} on ${dateStr}: ${w}`);
                  return false;
                }
                return true;
              })
              .join(', ');

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
          console.warn(
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
          console.log(`⚠️ SUMMARY: ${employeeName} on ${dateStr} - NO GENDER (normalized: ${empNormalized})`);
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
          console.log(`✅ SUMMARY RECORD with scheduled hours: ${employeeName} on ${dateStr} = ${empData.scheduledHours}h`);
        }

        return summaryRecord;
      },
    );
  });

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
        console.log("Successfully saved capacity analysis to database");
      })
      .catch((error) => {
        console.error("Error saving to database:", error);
      });
  } catch (error) {
    console.error("Error preparing database save:", error);
    // Don't throw - still return the result even if save fails
  }

  // Extract and store geographical data for scheduling optimization
  if (branchId) {
    await extractAndStoreGeographicalData(cgData, guaranteed, branchId, options?.ghWorkbookBuffer); // Pass raw GH workbook buffer
  } else {
    console.log(`⚠️ WARNING: No branchId provided - skipping geographical data extraction`);
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

    console.log(`📍 Including ${resultWithLocations.employeeLocations.length} employee locations and ${resultWithLocations.clientLocations.length} client locations in result`);
  } catch (error) {
    console.error('❌ Error retrieving geographical data:', error);
    // Don't throw - return result without location data
  }

  return result;
}

// Extract and store geographical data for route optimization
async function extractAndStoreGeographicalData(cgData: any[], guaranteed: any[], branchId?: string, ghWorkbookBuffer?: Buffer) { // Added ghWorkbookBuffer parameter
  console.log(`🗺️ EXTRACTING GEOGRAPHICAL DATA FOR SCHEDULING OPTIMIZATION...`);
  console.log(`📊 CG Data rows to process: ${cgData.length}`);
  console.log(`🏢 Branch ID: ${branchId || 'NONE'}`);

  if (!branchId) {
    console.log(`⚠️  WARNING: No branchId provided - geographical data will not be saved to database`);
    return;
  }

  try {
    // Extract employee locations from CG Data Export
    const employeeLocationsMap = new Map<string, any>();
    const employeesToGeocode: any[] = [];

    console.log(`🔄 Starting to iterate through ${cgData.length} CG Data rows...`);
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

      console.log(`  👤 ${employeeName}: Title="${title}" -> Gender="${gender || "unknown"}"`);

      if (employeeName && postcode) {
        const normalizedTransport = toTransportMode(transportMode);

        // Check if already geocoded in database
        const existing = await storage.getEmployeeLocationByName(branchId, employeeName);

        if (existing && existing.homeLat && existing.homeLng) {
          // Already geocoded - update with gender if missing
          console.log(`✅ Cache hit for ${employeeName} - using existing coordinates`);
          const locationData = {
            branchId, // Required for data isolation
            employeeName,
            homePostcode: postcode,
            transportMode: normalizedTransport,
            gender: gender, // Include gender from Title
            homeLat: existing.homeLat,
            homeLng: existing.homeLng,
          };
          employeeLocationsMap.set(employeeName, locationData);

          // Update database if gender is missing
          if (gender && !existing.gender) {
            console.log(`  🔄 Updating gender for ${employeeName}: ${gender}`);
            await storage.upsertEmployeeLocation(locationData);
          }
        } else {
          // Need to geocode
          console.log(`📍 Cache miss for ${employeeName} - needs geocoding`);
          const locationData = {
            branchId, // Required for data isolation
            employeeName,
            homePostcode: postcode,
            transportMode: normalizedTransport,
            gender: gender, // Include gender from Title
          };
          employeeLocationsMap.set(employeeName, locationData);
          employeesToGeocode.push(locationData);
        }
      }
    }

    console.log(`👥 Employee locations: ${employeeLocationsMap.size} total (${employeesToGeocode.length} need geocoding, ${employeeLocationsMap.size - employeesToGeocode.length} cached)`);

    // Geocode only new employee locations
    if (employeesToGeocode.length > 0) {
      console.log(`🔍 Geocoding ${employeesToGeocode.length} new employee postcodes...`);
      for (const locationData of employeesToGeocode) {
        try {
          const geocoded = await geocodeWithFallback(locationData.homePostcode, storage, branchId);

          if (geocoded && geocoded.lat && geocoded.lng) {
            locationData.homeLat = geocoded.lat;
            locationData.homeLng = geocoded.lng;
            console.log(`✅ Successfully geocoded ${locationData.employeeName}`);
          } else {
            console.log(`❌ Failed to geocode ${locationData.employeeName} at ${locationData.homePostcode}`);
          }
        } catch (err) {
          console.log(`❌ Error geocoding ${locationData.employeeName}: ${err}`);
        }
      }
    } else {
      console.log(`⚡ All employee locations already cached - skipping geocoding API calls`);
    }

    // Store all employee locations (cached + newly geocoded)
    for (const locationData of Array.from(employeeLocationsMap.values())) {
      await storage.upsertEmployeeLocation(locationData);
    }

    // Extract client locations from Care Pro Guaranteed Hours
    // CRITICAL FIX: Use the RAW workbook buffer to extract client locations
    // because guaranteedData has already been filtered for scheduling
    console.log(`🔍 Extracting client locations from raw GH Excel workbook`);

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
      const wb = XLSX.read(ghWorkbookBuffer, { type: 'buffer' });
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
        console.log(`📋 Parsed ${rawGHRows.length} raw GH rows for client location extraction`);
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
        console.log(`🔍 DEBUG: Processing address for ${clientName}: "${addressStr}"`);

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
            console.log(`🔍 DEBUG: Postcode pattern matched: ${pattern} -> "${postcodeMatch[1]}"`);
            break;
          }
        }

        if (postcodeMatch) {
          postcode = normalisePostcode(postcodeMatch[1]);
          // Remove postcode from address line and clean up
          addressLine = addressStr.replace(postcodeMatch[0], "").trim().replace(/,\s*$/, "").replace(/\s+/g, " ");
          console.log(`✅ DEBUG: Extracted postcode "${postcode}" from address, remaining: "${addressLine}"`);
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
              console.log(`✅ DEBUG: Manual postcode extraction: "${postcode}" from "${lastPart}", address: "${addressLine}"`);
            } else if (simplePostcodeCheck.test(secondLastPart)) {
              postcode = normalisePostcode(secondLastPart);
              addressLine = parts.slice(0, -2).join(', ') + (parts.length > 2 ? ', ' + parts[parts.length - 1] : '');
              console.log(`✅ DEBUG: Manual postcode extraction from second-last: "${postcode}", address: "${addressLine}"`);
            } else {
              addressLine = addressStr;
              console.log(`❌ DEBUG: Manual parsing failed, no postcode pattern found in parts: ${JSON.stringify(parts)}`);
            }
          } else {
            addressLine = addressStr;
            console.log(`❌ DEBUG: No postcode found in address: "${addressStr}" for client: ${clientName}`);
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
          console.log(`⚠️ Client "${clientKey}" has no address or postcode - will save without geocoding`);
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
              console.log(`📍 Cache miss for client "${clientKey}" - needs geocoding`);
              clientsToGeocode.push(clientData);
            } else {
              console.log(`✅ Cache hit for client "${clientKey}" - using existing coordinates`);
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

    console.log(`🏠 Client locations: ${clientLocationsMap.size} total (${clientsToGeocode.length} need geocoding, ${clientLocationsMap.size - clientsToGeocode.length} cached)`);

    // Store client locations
    for (const locationData of Array.from(clientLocationsMap.values())) {
      await storage.upsertClientLocation(locationData);
    }

    console.log(`🗺️ Starting enhanced batch geocoding for locations...`);

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
          console.log("⚠️ Employee geocoding failed:", await res.text());
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
            console.log(`✅ Employee geocoding saved for ${saved} new records`);
          } else {
            console.log(`✅ Employee geocoding: All ${employeeLocationsMap.size} employees already geocoded (using cached coordinates)`);
          }
        }
      } catch (err) {
        console.log("⚠️ Employee geocoding error:", err);
      }
    }

    // ----------------- CLIENT GEOCODING (SAVE RESULTS) -----------------
    // Only geocode clients that don't have coordinates (from clientsToGeocode list)
    const clientAddresses = clientsToGeocode
      .map(v => ({ address: (v.addressLine || "").trim(), postcode: normalisePostcode(v.postcode || "") }))
      .filter(v => v.address || v.postcode);

    if (clientAddresses.length > 0) {
      console.log(`🌍 Starting batch geocoding for ${clientAddresses.length} NEW client addresses (${clientLocationsMap.size - clientAddresses.length} already cached):`);
      clientAddresses.slice(0, 10).forEach((addr, i) => {
        console.log(`  ${i + 1}. Address: "${addr.address}", Postcode: "${addr.postcode}"`);
      });

      try {
        const requestBody = {
          postcodes: clientAddresses.map(a => a.postcode).filter(Boolean),
          addresses: clientAddresses.map(a => a.address).filter(Boolean),
          branchId: branchId, // Pass branchId here
        };

        console.log(`Sending geocoding request with ${requestBody.postcodes.length} postcodes and ${requestBody.addresses.length} addresses`);

        const res = await fetch("http://localhost:5000/api/geo/geocode-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        if (!res.ok) {
          console.log("⚠️ Client geocoding failed:", await res.text());
        } else {
          const payload = await res.json(); // expect { results: [{ address, postcode, lat, lng, success }] }
          const results = payload?.results ?? [];
          let saved = 0;
          let failed = 0;

          for (const r of results) {
            console.log(`🔍 GEOCODING RESULT: ${JSON.stringify(r)}`);

            if (!r?.lat || !r?.lng || !Number.isFinite(Number(r.lat)) || !Number.isFinite(Number(r.lng))) {
              console.log(`❌ Invalid coordinates for query: ${r?.query || 'unknown'}`);
              failed++;
              continue;
            }

            const pc = normalisePostcode(r.query || r.postcode || r.input || "");
            const addr = (r.address || "").trim().toUpperCase();

            // Find client by postcode first (most reliable)
            let clientName = null;
            if (pc) {
              const candidates = clientByPostcode.get(pc);
              if (candidates && candidates.length > 0) {
                clientName = candidates[0]; // Take first match
                console.log(`🔄 Found client via postcode match: ${clientName} (postcode: ${pc})`);
                if (candidates.length > 1) {
                  console.log(`⚠️ Multiple clients found for postcode ${pc}:`, candidates);
                }
              }
            }

            // Fallback to address-based matching
            if (!clientName && addr) {
              // Try exact address match
              clientName = clientByAddress.get(addr);
              if (clientName) {
                console.log(`🔄 Found client via address match: ${clientName}`);
              } else {
                // Try partial address matching
                for (const [mapAddr, mapClientName] of Array.from(clientByAddress.entries())) {
                  if (addr.includes(mapAddr) || mapAddr.includes(addr)) {
                    clientName = mapClientName;
                    console.log(`🔄 Found client via partial address match: ${clientName}`);
                    break;
                  }
                }
              }
            }

            if (!clientName) {
              console.log(`❌ No client found for geocoding result - Query: "${r.query}", Postcode: "${pc}"`);
              failed++;
              continue;
            }

            console.log(`✅ SAVING client geocode - Name: ${clientName}, Postcode: "${pc}", Coordinates: ${r.lat}, ${r.lng}`);

            await storage.upsertClientLocation({
              branchId: branchId!, // Required branch ID for data isolation
              clientName,
              addressLine: clientLocationsMap.get(clientName)?.addressLine || "",
              postcode: pc,
              lat: String(r.lat),
              lng: String(r.lng),
            });
            saved++;
          }

          console.log(`📊 Geocoding summary: ${saved} saved, ${failed} failed out of ${results.length} results`);
          if (saved > 0) {
            console.log(`✅ Client geocoding saved for ${saved} new records`);
          } else {
            console.log(`⚠️ No client locations were successfully geocoded this time`);
          }
        }
      } catch (err) {
        console.log("⚠️ Client geocoding error:", err);
      }
    } else {
      console.log(`⚡ All client locations already cached - skipping geocoding API calls`);
    }

    // Extract visit data for route optimization using Planned Start/End Date And Time
    const visitsMap = new Map<string, any>();
    const visitsByDate = new Map<string, any[]>(); // Group visits by date for optimization

    console.log(`🔍 DEBUG: Processing visit data from ${rawGHRows.length} raw GH rows`); // Use rawGHRows here

    for (const row of rawGHRows) { // Iterate over rawGHRows
      // Skip cancelled entries
      if (!isCancellationBlank(row["Cancellation Description"])) continue;

      // Skip excluded service types (office hours, night shifts, secondary care)
      const serviceType = row["Actual Service Type Description"] || row["Service Type Description"] || "";
      if (serviceType) {
        const lowerType = String(serviceType).toLowerCase();
        const excludedTypes = ['office hours', 'nights - sleep in', 'sleep in', 'nights - waking nights', 'waking nights', 'multiple care (secondary)', 'secondary'];
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
            const visitDate = format(parseDate(visitStart), "yyyy-MM-dd");
            // Calculate duration, default to 60 minutes if end time is missing
            const duration = visitEnd ?
              Math.round((parseDate(visitEnd).getTime() - parseDate(visitStart).getTime()) / (1000 * 60)) :
              60;

            const visitKey = `${clientName}-${visitDate}-${visitStart}`;

            // Get client location for this visit
            const clientLocation = await storage.getClientLocationByName(branchId, clientName);

            if (clientLocation && !visitsMap.has(visitKey)) {
              // Extract time windows for VRPTW optimizer
              const startDate = parseDate(visitStart);
              // Ensure end date is valid, default to start date + duration if missing
              const endDate = visitEnd ? parseDate(visitEnd) : new Date(startDate.getTime() +
                duration * 60000);

              // Convert to minutes since midnight for optimizer
              const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
              const endMinutes = endDate.getHours() * 60 + endDate.getMinutes();

              const visitData = {
                branchId: branchId, // <<< ADDED: Pass branchId to saveVisit
                clientId: clientLocation.id,
                date: visitDate,
                durationMinutes: Math.max(duration, 15), // Minimum 15 minutes duration
                preferredStartTime: visitStart,
                preferredEndTime: visitEnd || format(endDate, "yyyy-MM-dd HH:mm:ss"), // Use formatted end date if original was missing
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

              console.log(`🔍 DEBUG: Added visit ${clientName} on ${visitDate} at ${startMinutes}-${endMinutes} minutes`);
            } else if (!clientLocation) {
              console.log(`🔍 DEBUG: Client location not found for ${clientName}, skipping visit.`);
            }
          } catch (dateError) {
            // Skip visits with invalid dates
            console.warn(`Skipping visit with invalid date: ${visitStart}`);
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

    console.log(`\n📊 ===== VISIT EXTRACTION SERVICE TYPE SUMMARY =====`);
    console.log(`📅 Found ${visitsMap.size} visits across ${visitsByDate.size} dates for route optimization`);
    console.log(`\n📋 Total Hours by Service Type:`);

    // Sort by hours (descending) for easier reading
    const sortedServiceTypes = Array.from(serviceTypeSummary.entries())
      .sort((a, b) => b[1] - a[1]);

    sortedServiceTypes.forEach(([serviceType, hours]) => {
      console.log(`  • ${serviceType}: ${Math.round(hours * 100) / 100} hours`);
    });
    console.log(`====================================================\n`);

    // Store visit data
    for (const visitData of Array.from(visitsMap.values())) {
      await storage.saveVisit(visitData);
    }

    // Log final geocoding statistics
    const empLocs = branchId && storage.getAllEmployeeLocations ? await storage.getAllEmployeeLocations(branchId) : [];
    const cliLocs = branchId && storage.getAllClientLocations ? await storage.getAllClientLocations(branchId) : [];
    console.log(`📍 After geocode: employees with coords = ${empLocs.filter(e=>Number.isFinite(Number(e.homeLat))&&Number.isFinite(Number(e.homeLng))).length}/${empLocs.length}`);
    console.log(`📍 After geocode: clients with coords = ${cliLocs.filter(c=>Number.isFinite(Number(c.lat))&&Number.isFinite(Number(c.lng))).length}/${cliLocs.length}`);

    console.log(`✅ Geographical data extraction complete!`);
    console.log(`\n🎯 SUMMARY FOR BRANCH ${branchId}:`);
    console.log(`   📍 Employee locations stored: ${empLocs.length}`);
    console.log(`   📍 Client locations stored: ${cliLocs.length}`);
    console.log(`   📍 Employees with coordinates: ${empLocs.filter(e=>Number.isFinite(Number(e.homeLat))&&Number.isFinite(Number(e.homeLng))).length}/${empLocs.length}`);
    console.log(`   📍 Clients with coordinates: ${cliLocs.filter(c=>Number.isFinite(Number(c.lat))&&Number.isFinite(Number(c.lng))).length}/${cliLocs.length}`);
    console.log(`\n✅ You can now use the Scheduling tab - client visits will have coordinates\n`);

  } catch (error) {
    console.error('❌ Error extracting geographical data:', error);
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
    console.log("EmployeeFit generation skipped:", e);
  }

  // Heatmap tabs excluded from export as per user request
  console.log("Heatmap sheets excluded from Excel export");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}