import { logger } from '../../infrastructure/logger';
import { parse, format } from "date-fns";
import {
  AvailabilityRow,
  GuaranteedHoursRow,
} from "@shared/schema";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface ParsedAvailabilityRow extends AvailabilityRow {
  parsedDate: Date;
  calculatedHours: number;
}

export interface CGDataRow {
  "CAREGiver Name": string;
  "Weekly Hours": number;
  TransportModeDescription?: string;
  Title?: string;
  Gender?: string;
  PostCode?: string;
  [key: string]: any;
}

// ─── Column name constants ────────────────────────────────────────────────────

export const AVAIL_SHEET = "CAREGiver Availability";
export const GUAR_SHEET = "Data";

export const CLIENT_COLS = [
  'Service Location Name',
  'Client Name',
  'Service User Name',
  'Customer Name'
];

export const CANCEL_COLS = ['Cancellation Description'];
export const EMPLOYEE_NAME_COLS = [
  'Actual Employee Name',
  'Planned Employee Name',
  'Employee Name',
  'Caregiver Name',
  'Care giver Name'
];
export const START_TIME_COLS = ['Actual Start Date And Time', 'Start Date And Time', 'Planned Start Date And Time', 'Service Requirement Start Date And Time'];
export const END_TIME_COLS = ['Actual End Date And Time', 'End Date And Time', 'Planned End Date And Time', 'Service Requirement End Date And Time'];
export const SERVICE_TYPE_COLS = ['Actual Service Type Description', 'Service Type Description', 'Service Type'];
export const PAY_HOURS_COLS = ['Actual Pay Rate Hours', 'Pay Hours', 'Pay Rate Hours', 'Hours'];
export const ADDRESS_COLS_GH = ['Service Location Address', 'Service Requirement Location', 'Service Location', 'Client Address', 'Address Line 1', 'Full Address', 'Address'];

// ─── Leave types and priority ──────────────────────────────────────────────────

export const LEAVE_TYPES = [
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

export const STATUS_PRIORITY: Record<string, number> = {
  "AWOL": 1,
  "Maternity/Paternity": 2,
  "Educational Commitment": 3,
  "Jury Service": 3,
  "Sick": 4,
  "Holiday": 5,
  "Compassionate Leave": 6,
  "Dependant Leave": 6,
  "Other Unavailable": 7,
  "Partial Availability": 8,
  Available: 9,
  "Ad-hoc": 9,
};

export const DAY_KILLERS = new Set<string>([
  "Holiday",
  "Sick",
  "Maternity/Paternity",
  "Compassionate Leave",
  "AWOL",
  "Jury Service",
  "Educational Commitment",
  "Dependant Leave",
]);

export const TIME_KILLERS = new Set<string>([
  "Other Unavailable",
  "Pre-Agreed Appointment",
]);

// ─── Column picker ────────────────────────────────────────────────────────────

export function pickCol(row: Record<string, any>, names: string[]): any {
  const keys = Object.keys(row);
  for (const want of names) {
    const target = want.trim().toLowerCase();
    const hit = keys.find((k) => k.trim().toLowerCase() === target);
    if (hit) return row[hit];
  }
  return undefined;
}

// ─── Name normalization ───────────────────────────────────────────────────────

export function normalizeName(name: string): string {
  if (!name || name === "undefined" || name === "null") return "";
  let s = String(name).toLowerCase();
  s = s.replace(/\(.*?\)/g, "");
  s = s.replace(/[^a-z\s]/g, " ");
  s = s.replace(/\b(mr|mrs|miss|ms|dr)\b/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s.split(" ").filter(Boolean).sort().join(" ");
}

// ─── Status canonicalization ──────────────────────────────────────────────────

export function canonicalStatus(raw: any): string {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();

  if (s === "avail" || s.startsWith("avail")) return "Available";
  if (s.startsWith("other unavail") || s.startsWith("othe"))
    return "Other Unavailable";
  if (s.includes("pre-agreed")) return "Pre-Agreed Appointment";
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

// ─── Timestamp resolution ─────────────────────────────────────────────────────

export function resolveServiceTimestamps(row: any): { start?: any; end?: any } {
  const plStart = row["Planned Start Date And Time"];
  const plEnd = row["Planned End Date And Time"];
  const acStart = row["Actual Start Date And Time"];
  const acEnd = row["Actual End Date And Time"];
  const srStart = row["Service Requirement Start Date And Time"];
  const srEnd = row["Service Requirement End Date And Time"];

  const start = plStart || acStart || srStart;
  const end = plEnd || acEnd || srEnd;
  return { start, end };
}

export function pickStartForBucket(row: any): any {
  return pickCol(row, START_TIME_COLS);
}

// ─── Date parsing ─────────────────────────────────────────────────────────────

export function parseDate(dateStr: any): Date {
  if (!dateStr) {
    throw new Error("Date value is empty");
  }

  if (typeof dateStr === "number") {
    const excelEpoch = new Date(1899, 11, 30);
    return new Date(excelEpoch.getTime() + dateStr * 24 * 60 * 60 * 1000);
  }

  if (dateStr instanceof Date) {
    return dateStr;
  }

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

  for (const fmt of formats) {
    try {
      const parsed = parse(str, fmt, new Date());
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    } catch {
      // Continue to next format
    }
  }

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

// ─── Hours calculation ────────────────────────────────────────────────────────

export function hoursBetween(startTime: any, endTime: any): number {
  try {
    let startDate: Date, endDate: Date;

    if (startTime instanceof Date) {
      startDate = startTime;
    } else if (typeof startTime === "number") {
      const excelEpoch = new Date(1899, 11, 30);
      startDate = new Date(excelEpoch.getTime() + startTime * 24 * 60 * 60 * 1000);
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

    let diffHours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);
    if (diffHours < 0) {
      diffHours += 24.0;
    }

    return Math.round(diffHours * 100) / 100;
  } catch {
    return NaN;
  }
}

// ─── Service type filters ─────────────────────────────────────────────────────

export function isSecondaryMultipleCare(serviceType: string): boolean {
  if (!serviceType) return false;
  const normalized = String(serviceType)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/\s/g, "");

  const excluded = [
    "multiplecaresecondary",
    "secondary",
    "multiplecare-secondary",
    "(secondary)",
  ].map(s => s.replace(/[^a-z0-9]/g, "").replace(/\s/g, ""));

  return excluded.some(ex => normalized.includes(ex));
}

export function isLiveInCare(serviceType: string): boolean {
  if (!serviceType) return false;
  const normalized = String(serviceType)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/\s/g, "");

  const excluded = [
    "liveincaresc",
    "liveincare",
    "liveincarewithoutscsuffix",
  ].map(s => s.replace(/[^a-z0-9]/g, "").replace(/\s/g, ""));

  return excluded.some(ex => normalized.includes(ex));
}

export function isCancellationBlank(value: any): boolean {
  const s = (value ?? "").toString().trim().toLowerCase();
  return s === "" || s === "(blank)" || s === "na" || s === "n/a";
}

// ─── Time-window interval math ────────────────────────────────────────────────

export function toMin(dateOrStr: any): number {
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

export function fromMin(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function mergeIntervals(
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

export function windowListToPairs(windows: string[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const w of windows || []) {
    const [a, b] = (w || "").split("-").map((s) => (s || "").trim());
    if (a && b) {
      let s = toMin(a);
      let e = toMin(b);
      if (Number.isFinite(s) && Number.isFinite(e)) {
        if (e <= s) {
          e += 24 * 60;
        }
        out.push([s, e]);
      }
    }
  }
  return out;
}

export function pairsToWindowList(pairs: Array<[number, number]>): string[] {
  return (pairs || []).map(([s, e]) => `${fromMin(s)}-${fromMin(e)}`);
}

export function subtractIntervals(
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
    if (!(bs < ae && as < be)) return [a];
    const left: [number, number] | null = as < bs ? [as, Math.min(ae, bs)] : null;
    const right: [number, number] | null = be < ae ? [Math.max(as, be), ae] : null;
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

export function filterMinDuration(
  pairs: Array<[number, number]>,
  minMinutes = 60,
): Array<[number, number]> {
  return (pairs || []).filter(([s, e]) => e - s >= minMinutes);
}

export function isAllDayTimeKiller(
  mergedBlockers: Array<[number, number]>,
  availPairs: Array<[number, number]>,
  contractedDailyMin: number,
): boolean {
  if (!mergedBlockers.length || !availPairs.length) return false;

  const totalBlockedMin = mergedBlockers.reduce((sum, [s, e]) => sum + (e - s), 0);
  const threshold = Math.max(contractedDailyMin * 0.9, 60);

  if (totalBlockedMin >= threshold) return true;

  const freeTime = subtractIntervals(availPairs, mergedBlockers);
  const totalFreeMin = freeTime.reduce((sum, [s, e]) => sum + (e - s), 0);

  return totalFreeMin < 15;
}

// ─── Ad-hoc windows & display name maps ──────────────────────────────────────

export function buildAdHocWindowsMap(
  guaranteed: any[],
): Map<string, Array<[number, number]>> {
  const map = new Map<string, Array<[number, number]>>();

  for (const r of guaranteed || []) {
    const cancelRaw = pickCol(r, CANCEL_COLS);
    if (!isCancellationBlank(cancelRaw)) continue;
    const serviceTypeRaw = pickCol(r, SERVICE_TYPE_COLS);
    if (isSecondaryMultipleCare(serviceTypeRaw)) continue;

    const empName = pickCol(r, EMPLOYEE_NAME_COLS);
    const nameNorm = normalizeName(empName);
    if (!nameNorm) continue;

    const startV = pickCol(r, ['Planned Start Date And Time', 'Service Requirement Start Date And Time', 'Actual Start Date And Time', 'Start Date And Time']);
    const endV = pickCol(r, ['Planned End Date And Time', 'Service Requirement End Date And Time', 'Actual End Date And Time', 'End Date And Time']);
    if (!startV || !endV) continue;

    const dateKey = format(parseDate(startV), "yyyy-MM-dd");
    let s = toMin(startV);
    let e = toMin(endV);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    if (e <= s) e += 24 * 60;

    const key = `${nameNorm}|${dateKey}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push([s, e]);
  }

  map.forEach((ints, k) => {
    map.set(k, mergeIntervals(ints, 0));
  });
  return map;
}

export function buildDisplayNameMap(guaranteed: any[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of guaranteed || []) {
    const empName = pickCol(r, EMPLOYEE_NAME_COLS);
    const n = normalizeName(empName);
    if (n && empName) m.set(n, String(empName));
  }
  return m;
}

// ─── Scheduled hours lookup builders ─────────────────────────────────────────

export function buildScheduledHoursLookup(guaranteed: any[]): Map<string, number> {
  const ghMap = new Map<string, number>();
  let totalProcessed = 0;
  let filteredCancelled = 0;
  let filteredSecondary = 0;
  let filteredLiveInCare = 0;
  let officeHoursIncluded = 0;

  for (const g of guaranteed || []) {
    totalProcessed++;

    const cancelRaw = pickCol(g, CANCEL_COLS);
    const cancelOk = isCancellationBlank(cancelRaw);
    if (!cancelOk) { filteredCancelled++; continue; }

    const serviceTypeRaw = pickCol(g, SERVICE_TYPE_COLS);
    const secondary = isSecondaryMultipleCare(serviceTypeRaw);
    if (secondary) { filteredSecondary++; continue; }

    const liveInCare = isLiveInCare(serviceTypeRaw);
    if (liveInCare) { filteredLiveInCare++; continue; }

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

    const date = format(parseDate(start), "yyyy-MM-dd");

    if (start && end) {
      const endDate = format(parseDate(end), "yyyy-MM-dd");
      if (date !== endDate) {
        const empName = pickCol(g, EMPLOYEE_NAME_COLS);
        logger.debug(`EXCLUDING overnight visit: ${empName} - starts ${date}, ends ${endDate} (night/multi-day excluded)`);
        continue;
      }
    }

    const empName = pickCol(g, EMPLOYEE_NAME_COLS);
    const name = normalizeName(empName);

    const payRaw = pickCol(g, PAY_HOURS_COLS);
    let pay = Number(payRaw) || 0;

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

    if (isOfficeHours && pay > 0) {
      logger.debug(`DEBUG: Including office hours in scheduled total:`);
      logger.debug(`  Employee: ${g["Actual Employee Name"]} (normalized: ${name})`);
      logger.debug(`  Service Type: ${serviceType}`);
      logger.debug(`  Date: ${date}`);
      logger.debug(`  Pay Hours: ${pay}`);
      logger.debug(`  Map Key: ${name}|${date}`);
    }

    if (empName && (
      empName.toLowerCase().includes("chloe") ||
      empName.toLowerCase().includes("mcclymont") ||
      empName.toLowerCase().includes("makala") ||
      empName.toLowerCase().includes("palmer") ||
      empName.toLowerCase().includes("campbell")
    )) {
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
        logger.debug(`  Added to map: ${key} = ${existing} + ${pay} = ${newTotal}`);
      }

      if (isOfficeHours) {
        logger.debug(`  Office hours added to map: ${key} = ${existing} + ${pay} = ${newTotal}`);
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
  logger.debug(`  Filtered "Multiple Care (Secondary)": ${filteredSecondary}`);
  logger.debug(`  Filtered "Live In Care (SC)": ${filteredLiveInCare}`);
  logger.debug(`  Office hours included in totals: ${officeHoursIncluded}`);
  logger.debug(`  Valid entries for scheduling: ${totalProcessed - filteredCancelled - filteredSecondary - filteredLiveInCare}`);

  logger.debug(`\nFINAL SCHEDULED HOURS MAP (Full list for verification):`);
  const sortedEntries = Array.from(ghMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  sortedEntries.forEach(([key, hours]) => {
    logger.debug(`  ${key}: ${hours} hours`);
  });
  logger.debug(`=========================================\n`);

  return ghMap;
}

export function buildClientScheduledHoursLookup(guaranteed: any[]): Map<string, number> {
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

export function getScheduledHoursForEmployeeAndDate(
  scheduledHoursMap: Map<string, number>,
  employeeName: string,
  dateStr: string,
): number {
  const normalizedName = normalizeName(employeeName);
  const key = `${normalizedName}|${dateStr}`;
  return scheduledHoursMap.get(key) || 0;
}
