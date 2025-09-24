import * as XLSX from "xlsx";
import { parse, format } from "date-fns";
import {
  buildTimeWindow,
  parseGuaranteedDate,
  timeToString,
} from "./time-window-utils";
import { computeCapacityWindows, toHours1dp } from "./capacity-windows";
import { applyServiceRules } from "./service-delivery-rules";
import { extractCancelledWindowsFromGHWorkbook } from "./cancelled-visits-from-gh";
import {
  AvailabilityRow,
  GuaranteedHoursRow,
  ClientDemandRow,
  ServiceDeliveryRow,
  CleanedEmployeeRecord,
  DailySummaryRecord,
  EmployeeDailyDetail,
  ProcessingResult,
  availabilitySchema,
  guaranteedSchema,
  clientDemandSchema,
  InsertCapacityAnalysis,
} from "@shared/schema";
import { storage } from "./storage";

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
  "Pre-Agreed Appointment": 6,
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

interface EmployeeGuaranteedHours {
  originalName: string;
  normalizedName: string;
  weeklyHours: number;
  payRateHours: number;
  serviceStartDate: Date;
  serviceEndDate: Date;
}

// ====== SHEET NAMES (EXACT MATCH TO WORKING IMPLEMENTATION) ======
const AVAIL_SHEET = "CAREGiver Availability";
const GUAR_SHEET = "Data";

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

// Legacy pick function for backward compatibility
function pick(row: Record<string, any>, candidates: string[]): any {
  return pickCol(row, candidates);
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

// Helper for Care Pro Guaranteed Hours with Actual priority
function pickStartForBucket(row: any): any {
  return row["Actual Start Date And Time"];
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

  return totalBlockedMin >= threshold;
}

// Build time windows per employee/day from Guaranteed (ACTUAL start/end)
function buildAdHocWindowsMap(
  guaranteed: any[],
): Map<string, Array<[number, number]>> {
  const map = new Map<string, Array<[number, number]>>();

  for (const r of guaranteed || []) {
    // use same filters as your scheduled lookup:
    if (!isCancellationBlank(r["Cancellation Description"])) continue;
    if (isSecondaryMultipleCare(r["Actual Service Type Description"])) continue;

    const nameNorm = normalizeName(r["Actual Employee Name"]);
    if (!nameNorm) continue;

    const startV = pickStartForBucket(r);
    const endV = r["Actual End Date And Time"]; // window is Actual start → Actual end
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
    const n = normalizeName(r["Actual Employee Name"]);
    if (n && r["Actual Employee Name"])
      m.set(n, String(r["Actual Employee Name"]));
  }
  return m;
}

// Robust secondary filter (case/spacing tolerant)
function isSecondaryMultipleCare(value: any): boolean {
  const s = (value ?? "").toString().trim().toLowerCase();
  return s.includes("multiple care") && s.includes("secondary");
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

  for (const g of guaranteed || []) {
    totalProcessed++;

    // Apply robust filters (exactly as in Hours by Service Type.xlsx)
    const cancelOk = isCancellationBlank(g["Cancellation Description"]);
    if (!cancelOk) {
      filteredCancelled++;
      continue;
    }

    const secondary = isSecondaryMultipleCare(
      g["Actual Service Type Description"],
    );
    if (secondary) {
      filteredSecondary++;
      continue;
    }

    // Use Actual priority for Care Pro Guaranteed Hours
    const start = pickStartForBucket(g);
    if (!start) continue;
    const date = format(parseDate(start), "yyyy-MM-dd");

    const name = normalizeName(g["Actual Employee Name"]);

    // Sum only positive/real pay hours
    const pay = Number(g["Actual Pay Rate Hours"]) || 0;

    // Debug specific employee entries
    const originalName = g["Actual Employee Name"];
    if (
      originalName &&
      (originalName.toLowerCase().includes("makala") ||
        originalName.toLowerCase().includes("brooke") ||
        originalName.toLowerCase().includes("brien"))
    ) {
      console.log(`🔍 EMPLOYEE DEBUG - Processing entry:`);
      console.log(`  Original Name: ${originalName}`);
      console.log(`  Normalized Name: ${name}`);
      console.log(`  Actual Start: ${g["Actual Start Date And Time"]}`);
      console.log(`  Planned Start: ${g["Planned Start Date And Time"]}`);
      console.log(
        `  SR Start: ${g["Service Requirement Start Date And Time"]}`,
      );
      console.log(`  Picked Start: ${start}`);
      console.log(`  Parsed Date: ${date}`);
      console.log(`  Raw Pay Hours: ${g["Actual Pay Rate Hours"]}`);
      console.log(`  Parsed Pay Hours: ${pay}`);
      console.log(`  Service Type: ${g["Actual Service Type Description"]}`);
      console.log(`  Cancellation: "${g["Cancellation Description"]}"`);
    }

    if (name && date && pay > 0) {
      const key = `${name}|${date}`;
      const existing = ghMap.get(key) || 0;
      const newTotal = existing + pay;
      ghMap.set(key, newTotal);

      if (originalName && originalName.toLowerCase().includes("makala")) {
        console.log(
          `  ✅ Added to map: ${key} = ${existing} + ${pay} = ${newTotal}`,
        );
      }
    } else {
      if (originalName && originalName.toLowerCase().includes("makala")) {
        console.log(`  ❌ Skipped: name=${!!name}, date=${!!date}, pay=${pay}`);
      }
    }
  }

  console.log(`\n🔍 SCHEDULED HOURS FILTERING SUMMARY:`);
  console.log(`  📊 Total guaranteed hours entries: ${totalProcessed}`);
  console.log(`  ❌ Filtered cancelled entries: ${filteredCancelled}`);
  console.log(
    `  ❌ Filtered "Multiple Care (Secondary)": ${filteredSecondary}`,
  );
  console.log(
    `  ✅ Valid entries for scheduling: ${totalProcessed - filteredCancelled - filteredSecondary}`,
  );

  // Debug: Show final scheduled hours for Makala (especially 2025-09-10)
  console.log(`\n🔍 FINAL SCHEDULED HOURS MAP (Makala entries):`);
  Array.from(ghMap.entries()).forEach(([key, hours]) => {
    if (
      key.toLowerCase().includes("makala") ||
      key.toLowerCase().includes("mcewan")
    ) {
      console.log(`  ${key}: ${hours} hours`);
    }
  });
  console.log(`=========================================\n`);

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

// Parse and validate Excel data
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

export function parseExcelFiles(
  availabilityBuffer: Buffer,
  guaranteedBuffer: Buffer,
  demandBuffer: Buffer,
  cgDataBuffer: Buffer,
): {
  availability: ParsedAvailabilityRow[];
  guaranteed: GuaranteedHoursRow[];
  demand: ClientDemandRow[];
  cgData: CGDataRow[];
  warnings: string[];
} {
  console.log(`\n🚨 ===== PARSING EXCEL FILES FUNCTION STARTED =====`);
  console.log(
    `🔧 Buffer lengths: availability=${availabilityBuffer?.length}, guaranteed=${guaranteedBuffer?.length}, demand=${demandBuffer?.length}, cgData=${cgDataBuffer?.length}`,
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
  const guaranteedSheetName = GUAR_SHEET;
  if (!guaranteedWorkbook.SheetNames.includes(guaranteedSheetName)) {
    throw new Error(
      `Sheet "${guaranteedSheetName}" not found in Care Pro Guaranteed Hours file`,
    );
  }

  const guaranteedSheet = guaranteedWorkbook.Sheets[guaranteedSheetName];
  const guaranteedData =
    XLSX.utils.sheet_to_json<GuaranteedHoursRow>(guaranteedSheet);

  // === Use modular service delivery rules processing ===
  console.log(
    `🔧 Calling applyServiceRules with buffer of length: ${demandBuffer.length}`,
  );
  let serviceRulesResult;
  try {
    serviceRulesResult = applyServiceRules(demandBuffer);
    console.log(`✅ applyServiceRules completed successfully`);
  } catch (error) {
    console.error(`❌ applyServiceRules failed:`, error);
    throw error;
  }

  const { meta, filteredRows, hoursByWeekday, serviceTypeByWeekday } =
    serviceRulesResult;

  console.log(
    `📁 Sheet: ${meta.sheetName}, Header row: ${meta.headerRow}, Rows: ${meta.rowsIn} → ${meta.rowsAfterNormalize} → ${meta.rowsAfterFilter}`,
  );
  console.log(`🔍 Column mapping:`, meta.columnMap);
  console.log(`📊 Weekday totals:`, hoursByWeekday);

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

      const parsedDate = parseDate(row["Start Date"]);
      const effectiveHours =
        row.Hours ?? hoursBetween(row["Start Time"], row["End Time"]);

      if (isNaN(effectiveHours)) {
        warnings.push(
          `Availability row ${index + 1}: Cannot calculate hours from time range`,
        );
        return;
      }

      validatedAvailability.push({
        ...row,
        parsedDate,
        calculatedHours: effectiveHours,
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
        row["Actual Service Type Description"],
      );

      if (!isCancelOk || isSecondary) {
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

  // === Clean demand row conversion using the modular service rules ===
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
  hoursByWeekday.forEach(({ weekday, hours }) => {
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
        ? Math.round((hours / actualDatesForWeekday.length) * 100) / 100
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
  const totalHours = hoursByWeekday.reduce((sum, { hours }) => sum + hours, 0);
  const mondayHours =
    hoursByWeekday.find(({ weekday }) => weekday === "Monday")?.hours || 0;

  console.log(`\n📊 ===== SERVICE DELIVERY SUMMARY =====`);
  console.log(
    `✅ Filtered records: ${meta.rowsAfterFilter} (from ${meta.rowsAfterNormalize} normalized)`,
  );
  console.log(`📈 Monday hours: ${mondayHours} (expected: ~64.5)`);
  console.log(`📈 Total hours: ${totalHours} (expected: 400.33)`);
  console.log(`=======================================\n`);

  return {
    availability: validatedAvailability,
    guaranteed: validatedGuaranteed,
    demand: validatedDemand,
    cgData,
    warnings,
  };
}

// Process and clean the data starting with CG Data as master employee list
export function processCapacityData(
  availability: ParsedAvailabilityRow[],
  guaranteed: GuaranteedHoursRow[],
  demand: ClientDemandRow[],
  cgData: CGDataRow[],
  options?: { ghWorkbookBuffer?: Buffer }, // ← NEW optional param
): ProcessingResult & { cleanedRecords: CleanedEmployeeRecord[] } {
  const warnings: string[] = [];

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
  const scheduledHoursMap = buildScheduledHoursLookup(guaranteed);

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
        row.Hours != null
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
      timeWindow: buildTimeWindow(row),
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

  // Helper function to merge overlapping time windows
  function mergeTimeWindows(windows: string[]): string[] {
    if (windows.length <= 1) return windows;

    const timeRanges = windows
      .filter((w) => w && w !== "" && w !== "-" && !w.includes("undefined"))
      .map((window) => {
        const parts = window.split("-");
        if (parts.length === 2) {
          return {
            start: parts[0].trim(),
            end: parts[1].trim(),
            original: window,
          };
        }
        return null;
      })
      .filter(Boolean) as { start: string; end: string; original: string }[];

    if (timeRanges.length === 0) return [];

    // Sort by start time
    timeRanges.sort((a, b) => {
      const aTime = new Date(`2000-01-01 ${a.start}`);
      const bTime = new Date(`2000-01-01 ${b.start}`);
      return aTime.getTime() - bTime.getTime();
    });

    const merged = [timeRanges[0]];

    for (let i = 1; i < timeRanges.length; i++) {
      const current = timeRanges[i];
      const last = merged[merged.length - 1];

      const currentStart = new Date(`2000-01-01 ${current.start}`);
      const lastEnd = new Date(`2000-01-01 ${last.end}`);

      // If windows overlap or touch, merge them
      if (currentStart.getTime() <= lastEnd.getTime()) {
        const currentEnd = new Date(`2000-01-01 ${current.end}`);
        if (currentEnd.getTime() > lastEnd.getTime()) {
          last.end = current.end;
          last.original = `${last.start}-${last.end}`;
        }
      } else {
        merged.push(current);
      }
    }

    return merged.map((range) => range.original);
  }

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

    statusAgg.forEach((agg, status) => {
      if (DAY_KILLERS.has(status)) {
        const p = STATUS_PRIORITY[status] || 999;
        if (p < dayKillerPriority) {
          dayKillerPriority = p;
          dayKillerStatus = status;
        }
      }
    });
    hasDayKiller = dayKillerStatus !== "";

    // Check for time-killers
    let hasTimeKiller = false;
    statusAgg.forEach((agg, status) => {
      if (TIME_KILLERS.has(status)) {
        hasTimeKiller = true;
      }
    });

    // Compute avail/blocker pairs once (reused below)
    const availAgg = statusAgg.get("Available");
    const availPairs = mergeIntervals(
      windowListToPairs(availAgg?.windows || []),
      0,
    );

    const blockerPairs: Array<[number, number]> = [];
    statusAgg.forEach((agg, status) => {
      if (TIME_KILLERS.has(status))
        blockerPairs.push(...windowListToPairs(agg.windows));
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
      if (timeKillerIsAllDay) {
        // Treat like day-level absence
        highestPriorityStatus = "Other Unavailable";
        highestPriority = STATUS_PRIORITY["Other Unavailable"] || 5;
      } else {
        // Partial blocker but still some availability
        highestPriorityStatus = "Partial Availability";
        highestPriority = STATUS_PRIORITY["Partial Availability"] || 6;
      }
    } else {
      // No blockers → pick best remaining (usually Available)
      statusAgg.forEach((_agg, status) => {
        const p = STATUS_PRIORITY[status] || 999;
        if (p < highestPriority) {
          highestPriority = p;
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

    employeeMap.forEach((records, employeeName) => {
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

    employeesByDate[record.date].push({
      employeeName: record.employeeName,
      status: record.status,
      timeWindows: record.timeWindows,
      contractedDailyHours: record.contractedDailyHours,
      scheduledHours: record.scheduledHours,
      hours: record.hours,
      netCapacity: record.netCapacity,
      notes: record.notes,
      gender: gender,
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
      const [normName, date] = key.split("|");
      if (!date || !normName) return;

      const already = present[date]?.has(normName);
      if (already) return; // they are in Availability for that day — skip

      const display = displayNameMap.get(normName) || normName;
      const windows = (adhocWindowsMap.get(key) || [])
        .map(([s, e]) => `${fromMin(s)}-${fromMin(e)}`)
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
        employeeMap.set(key, {
          contractedDailyHours: emp.contractedDailyHours,
          scheduledHours: emp.scheduledHours || 0,
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
      // Take the first scheduledHours value we see (they should all be the same since they come from the lookup)
      if (empData.scheduledHours === 0) {
        empData.scheduledHours = emp.scheduledHours || 0;
      }

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
          // DEBUG: Log the input data for free windows calculation
          console.log(
            `\n🔍 FREE WINDOWS DEBUG for ${employeeName} on ${dateStr}:`,
          );
          console.log(`  - availabilityWindows: "${availabilityWindows}"`);
          console.log(`  - unavailabilityWindows: "${unavailabilityWindows}"`);
          console.log(`  - scheduledWindows: "${scheduledWindows}"`);
          console.log(
            `  - contractedDailyHours: ${empData.contractedDailyHours}`,
          );

          if (availabilityWindows) {
            const capacityResult = computeCapacityWindows(
              {
                employeeName,
                date: dateStr,
                availabilityWindows,
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

            console.log(
              `  - 🎯 RESULT: freeWindows = "${capacityResult.freeWindows}"`,
            );
            console.log(
              `  - workableMinutes: ${capacityResult.workableMinutes}`,
            );
            console.log(
              `  - scheduledMinutes: ${capacityResult.scheduledMinutes}`,
            );
            console.log(
              `  - freeWindowsMinutes: ${capacityResult.freeWindowsMinutes}`,
            );

            freeWindows = capacityResult.freeWindows;
          } else {
            console.log(`  - ❌ SKIPPED: No availability windows found`);
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

        return {
          employeeName,
          availability: empData.contractedDailyHours, // Direct contracted daily hours from Employee Details
          unavailability: finalUnavailabilityHours,
          scheduledHours: empData.scheduledHours, // Already correctly calculated from cleanedRecords
          difference:
            empData.contractedDailyHours -
            finalUnavailabilityHours -
            empData.scheduledHours,
          freeWindows, // New field: time slots available for new clients
          cancelledVisits, // New field: cancelled visit time windows
          transportMode, // Transport mode from CG Data (e.g., "Car", "Walker")
          gender, // Gender derived from title (e.g., "male", "female")
        };
      },
    );
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

    const analysisData: InsertCapacityAnalysis = {
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

  return result;
}

// Generate Excel export
export function generateExcelExport(
  result: ProcessingResult,
  cleanedRecords: CleanedEmployeeRecord[],
  cgData: CGDataRow[],
): Buffer {
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

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}
