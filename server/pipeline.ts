import * as XLSX from 'xlsx';
import { parse, format } from 'date-fns';
import { buildTimeWindow, parseGuaranteedDate } from './time-window-utils';
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
  InsertCapacityAnalysis
} from '@shared/schema';
import { storage } from './storage';

// Leave types and priority (1=highest, 7=lowest like your Python code)
const LEAVE_TYPES = ["Maternity/Paternity", "Sick", "Holiday", "Compassionate Leave", "Other Unavailable", "Pre-Agreed Appointment"];
const STATUS_PRIORITY: Record<string, number> = {
  'Maternity/Paternity': 1,
  'Sick': 2,
  'Holiday': 3,
  'Compassionate Leave': 4,
  'Other Unavailable': 5,
  'Pre-Agreed Appointment': 6,
  'Available': 7
};

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

// Normalize name exactly like your Python code
function normalizeName(name: string): string {
  if (!name || name === 'undefined' || name === 'null') return "";
  
  let s = String(name).toLowerCase();
  
  // Remove parentheses content like (NL), (GH)
  s = s.replace(/\(.*?\)/g, "");
  
  // Remove non-alpha characters except spaces
  s = s.replace(/[^a-z\s]/g, " ");
  
  // Remove titles
  s = s.replace(/\b(mr|mrs|miss|ms|dr)\b/g, " ");
  
  // Normalize whitespace
  s = s.replace(/\s+/g, " ").trim();
  
  // Sort tokens alphabetically
  return s.split(" ").filter(token => token.length > 0).sort().join(" ");
}

// Time string conversion exactly like your tstr function
function timeToString(timeValue: any): string {
  if (!timeValue || timeValue === "" || timeValue === null || timeValue === undefined) return "";
  
  try {
    let dateObj: Date;
    
    if (timeValue instanceof Date) {
      dateObj = timeValue;
    } else if (typeof timeValue === 'number') {
      // Excel serial number for time (fractional day)
      if (timeValue < 1) {
        // Pure time value (0.5 = 12:00 PM)
        const totalMinutes = timeValue * 24 * 60;
        const hours = Math.floor(totalMinutes / 60);
        const minutes = Math.floor(totalMinutes % 60);
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      } else {
        // Date + time serial number
        const excelEpoch = new Date(1899, 11, 30);
        dateObj = new Date(excelEpoch.getTime() + timeValue * 24 * 60 * 60 * 1000);
      }
    } else if (typeof timeValue === 'string') {
      // Handle string time formats like "08:00", "14:30", etc.
      if (/^\d{1,2}:\d{2}$/.test(timeValue)) {
        return timeValue;
      }
      dateObj = new Date(timeValue);
    } else {
      dateObj = new Date(timeValue);
    }
    
    if (dateObj && !isNaN(dateObj.getTime())) {
      const hours = dateObj.getHours().toString().padStart(2, '0');
      const minutes = dateObj.getMinutes().toString().padStart(2, '0');
      return `${hours}:${minutes}`;
    }
    
    return "";
  } catch {
    return "";
  }
}

// Helper function to get scheduled hours for a specific date based on service requirements
// Build Scheduled Hours lookup from Guaranteed sheet
// key: normalized employee name + yyyy-MM-dd(Service Requirement Start Date And Time)
function buildScheduledHoursLookup(guaranteed: any[]): Map<string, number> {
  const ghMap = new Map<string, number>();
  
  for (const g of guaranteed || []) {
    const name = normalizeName((g as any)["Actual Employee Name"]);
    const date = format(parseDate((g as any)["Service Requirement Start Date And Time"]), 'yyyy-MM-dd');
    const pay = Number((g as any)["Actual Pay Rate Hours"]) || 0;
    if (name && date) {
      const key = `${name}|${date}`;
      // Sum multiple assignments for the same employee on the same date
      const existing = ghMap.get(key) || 0;
      ghMap.set(key, existing + pay);
    }
  }
  
  return ghMap;
}

function getScheduledHoursForEmployeeAndDate(scheduledHoursMap: Map<string, number>, employeeName: string, dateStr: string): number {
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
    } else if (typeof startTime === 'number') {
      const excelEpoch = new Date(1899, 11, 30);
      startDate = new Date(excelEpoch.getTime() + startTime * 24 * 60 * 60 * 1000);
    } else {
      startDate = new Date(startTime);
    }
    
    if (endTime instanceof Date) {
      endDate = endTime;
    } else if (typeof endTime === 'number') {
      const excelEpoch = new Date(1899, 11, 30);
      endDate = new Date(excelEpoch.getTime() + endTime * 24 * 60 * 60 * 1000);
    } else {
      endDate = new Date(endTime);
    }
    
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return NaN;
    
    let diffHours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);
    
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
  const matrix = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(null));

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
          matrix[i - 1][j - 1] + 1
        );
      }
    }
  }
  return matrix[len1][len2];
}

// Simple phonetic algorithm (Soundex-like)
function phonetic(name: string): string {
  if (!name) return "";
  
  let code = name.toUpperCase().replace(/[^A-Z]/g, '');
  if (!code) return "";
  
  // Keep first letter, replace consonants with numbers
  let result = code[0];
  const mapping: Record<string, string> = {
    'BFPV': '1', 'CGJKQSXZ': '2', 'DT': '3', 'L': '4', 'MN': '5', 'R': '6'
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
    if (!found && 'AEIOUHYW'.includes(char)) {
      // Skip vowels except at start
    }
  }
  
  return result.padEnd(4, '0').substring(0, 4);
}

// Enhanced name matching with multiple algorithms
function getCloseMatches(target: string, choices: string[], cutoff: number = 0.7): Array<{choice: string, score: number, confidence: number}> {
  if (!target) return [];
  
  const matches: Array<{choice: string, score: number, confidence: number}> = [];
  const targetPhonetic = phonetic(target);
  
  for (const choice of choices) {
    if (!choice) continue;
    
    // Method 1: Token-based similarity (existing)
    const targetTokens = new Set(target.split(' '));
    const choiceTokens = new Set(choice.split(' '));
    const intersection = new Set(Array.from(targetTokens).filter(x => choiceTokens.has(x)));
    const union = new Set([...Array.from(targetTokens), ...Array.from(choiceTokens)]);
    const tokenSimilarity = intersection.size / union.size;
    
    // Method 2: Edit distance similarity
    const maxLen = Math.max(target.length, choice.length);
    const editSimilarity = maxLen === 0 ? 1 : 1 - (levenshteinDistance(target, choice) / maxLen);
    
    // Method 3: Phonetic similarity
    const choicePhonetic = phonetic(choice);
    const phoneticSimilarity = targetPhonetic === choicePhonetic ? 1 : 0;
    
    // Combined score with weights
    const combinedScore = (
      tokenSimilarity * 0.4 + 
      editSimilarity * 0.4 + 
      phoneticSimilarity * 0.2
    );
    
    // Confidence based on agreement between methods
    const methodScores = [tokenSimilarity, editSimilarity, phoneticSimilarity];
    const avgScore = methodScores.reduce((a, b) => a + b, 0) / methodScores.length;
    const variance = methodScores.reduce((sum, score) => sum + Math.pow(score - avgScore, 2), 0) / methodScores.length;
    const confidence = Math.max(0, 1 - Math.sqrt(variance));
    
    if (combinedScore >= cutoff) {
      matches.push({choice, score: combinedScore, confidence});
    }
  }
  
  matches.sort((a, b) => b.score - a.score || b.confidence - a.confidence);
  return matches;
}

// Parse various date formats flexibly
function parseDate(dateStr: any): Date {
  if (!dateStr) {
    throw new Error('Date value is empty');
  }

  // Handle Excel date serial numbers
  if (typeof dateStr === 'number') {
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
    'dd/MM/yyyy',
    'dd/MM/yy', 
    'MM/dd/yyyy',
    'yyyy-MM-dd',
    'dd-MM-yyyy',
    'dd.MM.yyyy',
    'yyyy/MM/dd'
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
export function parseExcelFiles(
  availabilityBuffer: Buffer,
  guaranteedBuffer: Buffer,
  demandBuffer: Buffer
): {
  availability: ParsedAvailabilityRow[];
  guaranteed: GuaranteedHoursRow[];
  demand: ClientDemandRow[];
  warnings: string[];
} {
  const warnings: string[] = [];

  // Parse Availability Export.xlsx
  const availabilityWorkbook = XLSX.read(availabilityBuffer);
  const availabilitySheetName = 'CAREGiver Availability';
  if (!availabilityWorkbook.SheetNames.includes(availabilitySheetName)) {
    throw new Error(`Sheet "${availabilitySheetName}" not found in Availability Export file`);
  }

  const availabilitySheet = availabilityWorkbook.Sheets[availabilitySheetName];
  const availabilityData = XLSX.utils.sheet_to_json<AvailabilityRow>(availabilitySheet);

  // Parse Care Pro Guaranteed Hours.xlsx
  const guaranteedWorkbook = XLSX.read(guaranteedBuffer);
  const guaranteedSheetName = 'Data';
  if (!guaranteedWorkbook.SheetNames.includes(guaranteedSheetName)) {
    throw new Error(`Sheet "${guaranteedSheetName}" not found in Care Pro Guaranteed Hours file`);
  }

  const guaranteedSheet = guaranteedWorkbook.Sheets[guaranteedSheetName];
  const guaranteedData = XLSX.utils.sheet_to_json<GuaranteedHoursRow>(guaranteedSheet);

  // Parse Hours by Service Type.xlsx (service delivery data)
  const demandWorkbook = XLSX.read(demandBuffer);
  const demandSheetName = 'Data'; // Use the specific "Data" sheet
  if (!demandWorkbook.SheetNames.includes(demandSheetName)) {
    throw new Error(`Sheet "${demandSheetName}" not found in Hours by Service Type file`);
  }

  const demandSheet = demandWorkbook.Sheets[demandSheetName];
  const serviceDeliveryData = XLSX.utils.sheet_to_json<ServiceDeliveryRow>(demandSheet);

  // Process availability data
  const validatedAvailability: ParsedAvailabilityRow[] = [];
  availabilityData.forEach((row, index) => {
    try {
      if (!row["CAREGiver Name"] || !row["Start Date"]) {
        warnings.push(`Availability row ${index + 1}: Missing required fields`);
        return;
      }
      
      const parsedDate = parseDate(row["Start Date"]);
      const effectiveHours = row.Hours ?? hoursBetween(row["Start Time"], row["End Time"]);
      
      if (isNaN(effectiveHours)) {
        warnings.push(`Availability row ${index + 1}: Cannot calculate hours from time range`);
        return;
      }
      
      validatedAvailability.push({
        ...row,
        parsedDate,
        calculatedHours: effectiveHours
      });
    } catch (error) {
      warnings.push(`Availability row ${index + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  // Process guaranteed hours data
  const validatedGuaranteed: GuaranteedHoursRow[] = [];
  let filteredSecondaryCount = 0;
  guaranteedData.forEach((row, index) => {
    try {
      if (!row["Actual Employee Name"] || 
          typeof row["Actual Employee Hours Per Week"] !== 'number' ||
          typeof row["Actual Pay Rate Hours"] !== 'number' ||
          !row["Service Requirement Start Date And Time"] ||
          !row["Service Requirement End Date And Time"]) {
        warnings.push(`Guaranteed hours row ${index + 1}: Missing or invalid required fields`);
        return;
      }
      
      // Filter out secondary client hours with individual logic for each column
      const actualServiceType = row["Actual Service Type Description"];
      const cancellationDesc = row["Cancellation Description"];
      
      
      // Cancellation Description: Include ONLY blank entries (not cancelled entries)
      const cancellationValue = cancellationDesc ? cancellationDesc.toString().trim() : '';
      const isCancellationValid = cancellationValue === '' || cancellationValue === '(blank)';
      
      // Service Type Description: Only exclude "Multiple Care (Secondary)" specifically
      // Allow "Multiple Care (Primary)" and all other service types
      const serviceTypeValue = actualServiceType ? actualServiceType.toString() : '';
      const isSecondaryClient = serviceTypeValue === 'Multiple Care (Secondary)';
      
      if (!isCancellationValid || isSecondaryClient) {
        // Skip this row - either has cancellation info or is a secondary client
        filteredSecondaryCount++;
        return;
      }
      
      validatedGuaranteed.push(row);
    } catch (error) {
      warnings.push(`Guaranteed hours row ${index + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  console.log(`🔍 SECONDARY CLIENT FILTERING: Excluded ${filteredSecondaryCount} rows with service descriptions from ${guaranteedData.length} total Care Pro entries`);
  
  // Log service delivery processing for debugging
  console.log(`\n🔍 ===== PROCESSING ${serviceDeliveryData.length} SERVICE DELIVERY RECORDS =====`);
  
  // Track filtering stats
  let totalProcessed = 0;
  let filteredForCancellation = 0;
  let filteredForSecondaryClient = 0;
  let keptRecords = 0;

  // Process service delivery data and aggregate by weekday (like Excel pivot)
  const validatedDemand: ClientDemandRow[] = [];
  const serviceHoursByWeekday = new Map<string, number>();
  
  serviceDeliveryData.forEach((row, index) => {
    try {
      totalProcessed++;
      
      if (!row["Actual Start Date And Time"] || typeof row["Actual Duration"] !== 'number') {
        warnings.push(`Service delivery row ${index + 1}: Missing start date or duration`);
        return;
      }
      
      // Use Planned Start Date Weekday for accurate weekday grouping (like your Excel pivot)
      const rowData = row as any; // Cast to access dynamic columns
      const plannedWeekday = rowData["Planned Start Date Weekday"];
      if (!plannedWeekday) {
        warnings.push(`Service delivery row ${index + 1}: Missing Planned Start Date Weekday`);
        return;
      }
      
      // Apply same filtering as Care Pro data for consistency
      const actualServiceType = row["Actual Service Type Description"];
      const cancellationDesc = row["Cancellation Description"];
      
      // Cancellation Description: Include ONLY truly blank entries (exactly like Excel filter)
      // Excel's "(blank)" filter is very strict - only truly empty cells
      let isCancellationValid = false;
      if (cancellationDesc === null || cancellationDesc === undefined || cancellationDesc === '') {
        isCancellationValid = true; // Truly empty
      } else {
        const cancellationValue = cancellationDesc.toString().trim();
        // Be more restrictive - only accept completely empty values
        isCancellationValid = cancellationValue === '';
      }
      
      // Service Type Description: Only exclude "Multiple Care (Secondary)" specifically
      // Allow "Multiple Care (Primary)" and all other service types
      const serviceTypeValue = actualServiceType ? actualServiceType.toString() : '';
      const isSecondaryClient = serviceTypeValue === 'Multiple Care (Secondary)';
      
      // Track what gets filtered
      if (!isCancellationValid) {
        filteredForCancellation++;
        return;
      }
      
      if (isSecondaryClient) {
        filteredForSecondaryClient++;
        return;
      }
      
      // If we get here, record was kept
      keptRecords++;
      
      // Aggregate hours by weekday (like your Excel pivot)
      const weekdayKey = plannedWeekday.toString();
      const currentHours = serviceHoursByWeekday.get(weekdayKey) || 0;
      serviceHoursByWeekday.set(weekdayKey, currentHours + row["Actual Duration"]);
      
      // Debug log for Monday specifically
      if (weekdayKey === 'Monday') {
        console.log(`✅ KEPT Monday record: ${row["Actual Duration"]} hours, Service: ${serviceTypeValue}, Cancellation: "${cancellationDesc}"`);
      }
      
    } catch (error) {
      warnings.push(`Service delivery row ${index + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });
  
  // Display comprehensive filtering results
  console.log(`\n🔍 ===== SERVICE DELIVERY FILTERING RESULTS =====`);
  console.log(`📝 Total processed: ${totalProcessed}`);
  console.log(`❌ Filtered for cancellation: ${filteredForCancellation}`);
  console.log(`❌ Filtered for secondary client: ${filteredForSecondaryClient}`);
  console.log(`✅ Records kept: ${keptRecords}`);
  console.log(`📊 Hours by weekday after filtering:`);
  
  // Calculate and display total hours for verification
  let totalFilteredHours = 0;
  serviceHoursByWeekday.forEach((hours) => {
    totalFilteredHours += hours;
  });
  
  console.log(`🔍 FINAL WEEKDAY TOTALS:`);
  serviceHoursByWeekday.forEach((hours, weekday) => {
    console.log(`  - ${weekday}: ${Math.round(hours * 100) / 100} hours`);
  });
  console.log(``);
  console.log(`===== SERVICE DELIVERY FILTERING RESULTS =====`);
  console.log(`📊 TOTAL FILTERED SERVICE HOURS: ${Math.round(totalFilteredHours * 100) / 100} (Expected: 400.33)`);
  console.log(`📊 FILTERING STATS: Processed=${totalProcessed}, Kept=${keptRecords}, Filtered for Cancellation=${filteredForCancellation}, Filtered for Secondary=${filteredForSecondaryClient}`);
  console.log(`===============================================`);
  
  // Add temporary debug logging for weekday totals
  console.log(`\n===== FINAL WEEKDAY BREAKDOWN FROM SERVICE DELIVERY =====`);
  serviceHoursByWeekday.forEach((hours, weekday) => {
    console.log(`  - ${weekday}: ${Math.round(hours * 100) / 100} hours`);
  });
  console.log(`📊 TOTAL SERVICE HOURS: ${Math.round(totalFilteredHours * 100) / 100} (Expected: 400.33)`);
  console.log(`=======================================================\n`);

  // Convert weekday hours to date-based format for compatibility
  // Map weekdays to specific dates in our target week
  const weekdayToDate = {
    'Monday': '2025-09-01',
    'Tuesday': '2025-09-02', 
    'Wednesday': '2025-09-03',
    'Thursday': '2025-09-04',
    'Friday': '2025-09-05',
    'Saturday': '2025-09-06',
    'Sunday': '2025-09-07'
  };
  
  serviceHoursByWeekday.forEach((hours, weekday) => {
    const dateKey = (weekdayToDate as any)[weekday] || weekday;
    validatedDemand.push({
      "Date": dateKey,
      "Required Client Hours": Math.round(hours * 100) / 100
    });
  });

  return {
    availability: validatedAvailability,
    guaranteed: validatedGuaranteed,
    demand: validatedDemand,
    warnings
  };
}

// Process and clean the data according to your exact Python logic
export function processCapacityData(
  availability: ParsedAvailabilityRow[],
  guaranteed: GuaranteedHoursRow[],
  demand: ClientDemandRow[]
): ProcessingResult & { cleanedRecords: CleanedEmployeeRecord[] } {
  const warnings: string[] = [];

  // Debug: Check what demand data we received from filtering
  console.log(`\n===== RECEIVED DEMAND DATA =====`);
  let totalDemandHours = 0;
  demand.forEach(row => {
    console.log(`  - ${row.Date}: ${row["Required Client Hours"]} hours`);
    totalDemandHours += row["Required Client Hours"];
  });
  console.log(`📊 TOTAL DEMAND HOURS FROM FILTERING: ${Math.round(totalDemandHours * 100) / 100} (Expected: 400.33)`);
  console.log(`================================\n`);

  // Build scheduled hours lookup from guaranteed hours data (using exact logic from attached file)
  const scheduledHoursMap = buildScheduledHoursLookup(guaranteed);
  

  // Debug: Check what's actually in the guaranteed hours data
  if (guaranteed.length > 0) {
    console.log('=== GUARANTEED HOURS DEBUGGING ===');
    console.log('First row raw data:', guaranteed[0]);
    console.log('Service Start Date raw:', guaranteed[0]["Service Requirement Start Date And Time"]);
    console.log('Service End Date raw:', guaranteed[0]["Service Requirement End Date And Time"]);
  }

  // Step 1: Prepare guaranteed hours with normalized names
  const guaranteedEmployees = guaranteed.map(row => ({
    originalName: row["Actual Employee Name"],
    normalizedName: normalizeName(row["Actual Employee Name"]),
    weeklyHours: row["Actual Employee Hours Per Week"],
    payRateHours: row["Actual Pay Rate Hours"],
    serviceStartDate: parseGuaranteedDate(row["Service Requirement Start Date And Time"]),
    serviceEndDate: parseGuaranteedDate(row["Service Requirement End Date And Time"])
  }));

  // Debug: Check what dates we get after parsing
  if (guaranteedEmployees.length > 0) {
    console.log('=== PARSED DATES ===');
    console.log('Parsed start date:', guaranteedEmployees[0].serviceStartDate);
    console.log('Parsed end date:', guaranteedEmployees[0].serviceEndDate);
  }


  // Step 2: Match availability names to guaranteed hours
  const guaranteedKeys = guaranteedEmployees.map(emp => emp.normalizedName);
  const matchedAvailability: Array<ParsedAvailabilityRow & {matchedEmployee: EmployeeGuaranteedHours}> = [];
  const unmatchedNames: string[] = [];

  availability.forEach(row => {
    const normalizedName = normalizeName(row["CAREGiver Name"]);
    const matches = getCloseMatches(normalizedName, guaranteedKeys, 0.7);
    
    if (matches.length > 0) {
      const matchedEmployee = guaranteedEmployees.find(emp => emp.normalizedName === matches[0].choice);
      if (matchedEmployee) {
        matchedAvailability.push({
          ...row,
          matchedEmployee
        });
      }
    } else {
      if (!unmatchedNames.includes(row["CAREGiver Name"])) {
        unmatchedNames.push(row["CAREGiver Name"]);
      }
    }
  });

  if (unmatchedNames.length > 0) {
    warnings.push(`Unmatched employees: ${unmatchedNames.join(', ')}`);
  }

  // Step 3: Calculate days available for each employee
  const employeeDays = new Map<string, Set<string>>();
  matchedAvailability.forEach(row => {
    const key = row.matchedEmployee.normalizedName;
    const dateStr = format(row.parsedDate, 'yyyy-MM-dd');
    
    if (!employeeDays.has(key)) {
      employeeDays.set(key, new Set());
    }
    employeeDays.get(key)!.add(dateStr);
  });

  // Step 4: Create merged data exactly like your prepare function
  const mergedData = matchedAvailability.map(row => {
    const key = row.matchedEmployee.normalizedName;
    const daysAvailable = employeeDays.get(key)!.size;
    const contractedDailyHours = Math.round((row.matchedEmployee.weeklyHours / daysAvailable) * 100) / 100;
    
    // Safer hours: prefer 'Hours' if present, else compute from time (like your Python)
    const hoursCalc = hoursBetween(row["Start Time"], row["End Time"]);
    const hoursEffective = (row.Hours !== undefined && row.Hours !== null) ? row.Hours : hoursCalc;
    
    return {
      employeeName: row.matchedEmployee.originalName,
      contractedWeeklyHours: row.matchedEmployee.weeklyHours,
      contractedDailyHours,
      date: format(row.parsedDate, 'yyyy-MM-dd'),
      status: row.Type,
      startTime: timeToString(row["Start Time"]),
      endTime: timeToString(row["End Time"]),
      timeWindow: buildTimeWindow(row),
      hours: hoursEffective,
      notes: row.Notes || "",
      employeeKey: key,
      matchedEmployee: row.matchedEmployee
    };
  });

  // Step 5: Group by employee and date, then apply collapse logic
  const groupedData = new Map<string, typeof mergedData>();
  mergedData.forEach(row => {
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
      .filter(w => w && w !== "" && w !== "-" && !w.includes("undefined"))
      .map(window => {
        const parts = window.split('-');
        if (parts.length === 2) {
          return { start: parts[0].trim(), end: parts[1].trim(), original: window };
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
      
      // If windows overlap or are adjacent (within 30 minutes), merge them
      if (currentStart.getTime() <= lastEnd.getTime() + (30 * 60 * 1000)) {
        const currentEnd = new Date(`2000-01-01 ${current.end}`);
        if (currentEnd.getTime() > lastEnd.getTime()) {
          last.end = current.end;
          last.original = `${last.start}-${last.end}`;
        }
      } else {
        merged.push(current);
      }
    }
    
    return merged.map(range => range.original);
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
    const totalScheduledHours = getScheduledHoursForEmployeeAndDate(scheduledHoursMap, empName, date);
    
    
    // Deduplicate identical windows per status (like your Python dd logic)
    const deduplicatedRows = new Map<string, typeof group[0]>();
    group.forEach(row => {
      const key = `${row.status}|${row.startTime}|${row.endTime}`;
      if (!deduplicatedRows.has(key)) {
        deduplicatedRows.set(key, row);
      }
    });
    
    // Aggregate per status (like your Python agg logic)
    const statusAgg = new Map<string, {
      hoursRaw: number;
      windows: string[];
      notes: string[];
    }>();
    
    Array.from(deduplicatedRows.values()).forEach(row => {
      if (!statusAgg.has(row.status)) {
        statusAgg.set(row.status, {
          hoursRaw: 0,
          windows: [],
          notes: []
        });
      }
      
      const agg = statusAgg.get(row.status)!;
      agg.hoursRaw += row.hours;
      
      // Only add non-empty time windows
      if (row.timeWindow && 
          row.timeWindow !== "" && 
          row.timeWindow !== "-" && 
          row.timeWindow !== "--" &&
          row.timeWindow !== ":" &&
          !row.timeWindow.includes("undefined")) {
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
    
    // Create rows for each status (like your Python rows logic)
    statusAgg.forEach((agg, status) => {
      let finalHours: number;
      let netCapacity: number;
      
      if (status === "Available") {
        finalHours = Math.max(daily - totalLeaveCapped, 0.0); // adjusted available
        netCapacity = finalHours;
      } else if (LEAVE_TYPES.includes(status)) {
        finalHours = Math.min(agg.hoursRaw || 0.0, daily);
        netCapacity = 0.0;
      } else {
        finalHours = agg.hoursRaw || 0.0;
        netCapacity = 0.0;
      }
      
      // Join windows and notes like your Python logic, but merge overlapping windows first
      const uniqueWindows = Array.from(new Set(agg.windows)).filter(w => w && w !== "");
      const mergedWindows = mergeTimeWindows(uniqueWindows);
      const windowsStr = mergedWindows.length > 0 ? mergedWindows.sort().join("; ") : "";
      const notesStr = Array.from(new Set(agg.notes)).sort().join("; ");
      
      cleanedRecords.push({
        employeeName: empName,
        contractedWeeklyHours: Math.round(weekly * 100) / 100,
        contractedDailyHours: Math.round(daily * 100) / 100,
        date,
        status,
        timeWindows: windowsStr,
        scheduledHours: Math.round(totalScheduledHours * 100) / 100, // Total scheduled hours for this employee on this date
        hours: Math.round(finalHours * 100) / 100,
        netCapacity: Math.round(netCapacity * 100) / 100,
        notes: notesStr
      });
    });
  });

  // Sort by priority
  cleanedRecords.sort((a, b) => {
    const aPriority = STATUS_PRIORITY[a.status] || 999;
    const bPriority = STATUS_PRIORITY[b.status] || 999;
    return aPriority - bPriority;
  });

  // Step 7: Build Daily Summary (with same consolidation logic as Employee Summary)
  const dailySummaryMap = new Map<string, {
    availableHours: number;
    netCapacity: number;
    unavailability: number;
    holidays: number;
  }>();

  // Group records by date and employee to apply consolidation logic
  const recordsByDateAndEmployee = new Map<string, Map<string, CleanedEmployeeRecord[]>>();
  
  cleanedRecords.forEach(record => {
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
        holidays: 0
      });
    }

    const summary = dailySummaryMap.get(date)!;

    employeeMap.forEach((records, employeeName) => {
      // Apply same consolidation logic as Employee Summary
      let hasUnavailableStatus = false;
      let bestRecord = records[0]; // Start with first record
      let totalUnavailableHours = 0;
      
      // Find the record with highest contracted daily hours and check for unavailable statuses
      records.forEach(record => {
        if (record.contractedDailyHours > bestRecord.contractedDailyHours) {
          bestRecord = record;
        }
        
        if (record.status !== 'Available' && record.status !== 'Partial Availability') {
          hasUnavailableStatus = true;
          totalUnavailableHours += record.hours;
        } else if (record.status === 'Partial Availability') {
          // Partial availability adds to unavailable hours but doesn't mark as fully unavailable
          totalUnavailableHours += record.hours;
        }
      });

      // Use the best record's net capacity
      summary.netCapacity += bestRecord.netCapacity;

      // Apply status priority logic with proper handling of partial availability
      if (hasUnavailableStatus) {
        // Count unavailable hours by status type
        records.forEach(record => {
          if (record.status === 'Holiday') {
            summary.holidays += record.hours;
          } else if (['Sick', 'Maternity/Paternity', 'Compassionate Leave', 'Other Unavailable', 'Pre-Agreed Appointment'].includes(record.status)) {
            summary.unavailability += record.hours;
          }
        });
      } else {
        // Count available hours and partial availability hours
        records.forEach(record => {
          if (record.status === 'Available') {
            summary.availableHours += record.hours;
          } else if (record.status === 'Partial Availability') {
            // Partial availability contributes to unavailability hours
            summary.unavailability += record.hours;
          }
        });
      }
    });
  });

  // Step 8: Merge with client demand
  const demandMap = new Map<string, number>();
  demand.forEach(row => {
    const dateStr = format(parseDate(row.Date), 'yyyy-MM-dd');
    demandMap.set(dateStr, row["Required Client Hours"]);
  });

  const dailySummary: DailySummaryRecord[] = Array.from(dailySummaryMap.entries())
    .map(([date, summary]) => {
      const clientRequired = demandMap.get(date) || 0;
      const gap = Math.round((summary.netCapacity - clientRequired) * 100) / 100;
      
      return {
        date,
        availableHours: Math.round(summary.availableHours * 100) / 100,
        netCapacity: Math.round(summary.netCapacity * 100) / 100,
        unavailability: Math.round(summary.unavailability * 100) / 100,
        holidays: Math.round(summary.holidays * 100) / 100,
        clientRequired: Math.round(clientRequired * 100) / 100,
        gap,
        status: (gap >= 0 ? 'Sufficient' : 'Shortage') as 'Sufficient' | 'Shortage'
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  // Step 9: Calculate KPIs
  console.log(`\n===== DAILY SUMMARY CLIENT REQUIRED BREAKDOWN =====`);
  let totalClientRequired = 0;
  dailySummary.forEach(d => {
    console.log(`  - ${d.date}: ${d.clientRequired} hours`);
    totalClientRequired += d.clientRequired;
  });
  console.log(`📊 TOTAL CLIENT REQUIRED FROM DAILY SUMMARY: ${Math.round(totalClientRequired * 100) / 100}`);
  console.log(`==================================================\n`);

  const kpis = {
    netCapacitySum: Math.round(dailySummary.reduce((sum, d) => sum + d.netCapacity, 0) * 100) / 100,
    clientRequiredSum: Math.round(dailySummary.reduce((sum, d) => sum + d.clientRequired, 0) * 100) / 100,
    gapSum: Math.round(dailySummary.reduce((sum, d) => sum + d.gap, 0) * 100) / 100,
    unavailabilitySum: Math.round(dailySummary.reduce((sum, d) => sum + d.unavailability, 0) * 100) / 100,
    holidaysSum: Math.round(dailySummary.reduce((sum, d) => sum + d.holidays, 0) * 100) / 100
  };

  // Step 10: Build employees by date for drilldown
  const employeesByDate: Record<string, EmployeeDailyDetail[]> = {};
  
  cleanedRecords.forEach(record => {
    if (!employeesByDate[record.date]) {
      employeesByDate[record.date] = [];
    }
    
    
    employeesByDate[record.date].push({
      employeeName: record.employeeName,
      status: record.status,
      timeWindows: record.timeWindows,
      contractedDailyHours: record.contractedDailyHours,
      scheduledHours: record.scheduledHours,
      hours: record.hours,
      netCapacity: record.netCapacity,
      notes: record.notes
    });
  });

  // Sort employees within each date
  Object.values(employeesByDate).forEach(employees => {
    employees.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  });
  

  // Step 8: Generate employee summary by date
  const employeeSummaryByDate: Record<string, any[]> = {};
  
  Object.entries(employeesByDate).forEach(([dateStr, employees]) => {
    // Group employees by name and consolidate their data
    const employeeMap = new Map<string, { 
      contractedDailyHours: number; 
      scheduledHours: number; 
      unavailabilityHours: number; 
      hasAvailableStatus: boolean;
      hasUnavailableStatus: boolean;
      hasPartialAvailability: boolean;
    }>();
    
    employees.forEach(emp => {
      const key = emp.employeeName;
      
      if (!employeeMap.has(key)) {
        employeeMap.set(key, {
          contractedDailyHours: emp.contractedDailyHours,
          scheduledHours: emp.scheduledHours || 0,
          unavailabilityHours: 0,
          hasAvailableStatus: false,
          hasUnavailableStatus: false,
          hasPartialAvailability: false
        });
      }
      
      const empData = employeeMap.get(key)!;
      
      // Always use the highest contracted daily hours value
      empData.contractedDailyHours = Math.max(empData.contractedDailyHours, emp.contractedDailyHours);
      // Take the first scheduledHours value we see (they should all be the same since they come from the lookup)
      if (empData.scheduledHours === 0) {
        empData.scheduledHours = emp.scheduledHours || 0;
      }
      
      // Track all status types separately, then consolidate at the end
      if (emp.status === 'Available') {
        empData.hasAvailableStatus = true;
      } else if (emp.status === 'Partial Availability') {
        empData.hasPartialAvailability = true;
        empData.unavailabilityHours += emp.hours;
      } else {
        // For fully unavailable statuses (Holiday, Sick, etc.)
        empData.hasUnavailableStatus = true;
        empData.unavailabilityHours += emp.hours;
      }
    });
    
    // Build the final summary using the consolidated employee data with proper status priority
    employeeSummaryByDate[dateStr] = Array.from(employeeMap.entries()).map(([employeeName, empData]) => {
      // Apply consolidation rules:
      // 1. Fully unavailable statuses (Holiday, Sick) override everything
      // 2. Partial Availability + Available = show both (partial availability hours counted as unavailable)
      // 3. Just Available = available
      
      let finalUnavailabilityHours = empData.unavailabilityHours;
      
      // If someone has both Available and Partial Availability, keep both
      // If someone has fully unavailable status, that overrides Available but Partial Availability hours are still counted
      
      return {
        employeeName,
        availability: empData.contractedDailyHours, // Direct contracted daily hours from Employee Details
        unavailability: finalUnavailabilityHours,
        scheduledHours: empData.scheduledHours, // Already correctly calculated from cleanedRecords
        difference: empData.contractedDailyHours - finalUnavailabilityHours - empData.scheduledHours
      };
    });
  });

  const result = {
    kpis,
    dailySummary,
    employeesByDate,
    employeeSummaryByDate,
    cleanedRecords,
    warnings: warnings.length > 0 ? warnings : undefined
  };

  // Save to database for historical tracking
  try {
    const weekStart = result.dailySummary[0]?.date || '';
    const weekEnd = result.dailySummary[result.dailySummary.length - 1]?.date || '';
    
    const analysisData: InsertCapacityAnalysis = {
      weekStartDate: weekStart,
      weekEndDate: weekEnd,
      kpis: result.kpis as any,
      dailySummary: result.dailySummary as any,
      employeesByDate: result.employeesByDate as any,
      employeeSummaryByDate: result.employeeSummaryByDate as any,
      warnings: result.warnings as any,
    };
    
    storage.saveCapacityAnalysis(analysisData).then(() => {
      console.log('Successfully saved capacity analysis to database');
    }).catch(error => {
      console.error('Error saving to database:', error);
    });
  } catch (error) {
    console.error('Error preparing database save:', error);
    // Don't throw - still return the result even if save fails
  }

  return result;
}

// Generate Excel export
export function generateExcelExport(result: ProcessingResult, cleanedRecords: CleanedEmployeeRecord[]): Buffer {
  const workbook = XLSX.utils.book_new();

  // Cleaned sheet
  const cleanedData = [
    [
      'Employee Name', 'Contracted Weekly Hours', 'Contracted Daily Hours', 
      'Date', 'Status', 'Time Windows', 'Hours', 'Net Capacity', 'Notes'
    ],
    ...cleanedRecords.map(record => [
      record.employeeName,
      record.contractedWeeklyHours.toString(),
      record.contractedDailyHours.toString(),
      record.date,
      record.status,
      record.timeWindows,
      record.hours.toString(),
      record.netCapacity.toString(),
      record.notes
    ])
  ];

  const cleanedSheet = XLSX.utils.aoa_to_sheet(cleanedData);
  XLSX.utils.book_append_sheet(workbook, cleanedSheet, 'Cleaned');

  // Daily Summary sheet
  const summaryData = [
    ['Date', 'Available Hours', 'Net Capacity', 'Unavailability', 'Holidays', 'Client Required', 'Gap', 'Status'],
    ...result.dailySummary.map(day => [
      day.date,
      day.availableHours.toString(),
      day.netCapacity.toString(),
      day.unavailability.toString(),
      day.holidays.toString(),
      day.clientRequired.toString(),
      day.gap.toString(),
      day.status
    ])
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'DailySummary');

  // Employee Daily Detail sheet
  const detailData = [
    ['Date', 'Employee Name', 'Status', 'Time Windows', 'Contracted Daily Hours', 'Hours', 'Net Capacity', 'Notes']
  ];

  Object.entries(result.employeesByDate).forEach(([date, employees]) => {
    employees.forEach(emp => {
      detailData.push([
        date,
        emp.employeeName,
        emp.status,
        emp.timeWindows,
        emp.contractedDailyHours.toString(),
        emp.hours.toString(),
        emp.netCapacity.toString(),
        emp.notes
      ]);
    });
  });

  const detailSheet = XLSX.utils.aoa_to_sheet(detailData);
  XLSX.utils.book_append_sheet(workbook, detailSheet, 'EmployeeDailyDetail');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}