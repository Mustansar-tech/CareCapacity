import * as XLSX from 'xlsx';
import { parse, format } from 'date-fns';
import { 
  AvailabilityRow, 
  GuaranteedHoursRow, 
  ClientDemandRow,
  CleanedEmployeeRecord,
  DailySummaryRecord,
  EmployeeDailyDetail,
  ProcessingResult,
  availabilitySchema,
  guaranteedSchema,
  clientDemandSchema
} from '@shared/schema';

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
  if (!timeValue) return "";
  try {
    // Use pandas-like datetime parsing
    let dateObj: Date;
    
    if (timeValue instanceof Date) {
      dateObj = timeValue;
    } else if (typeof timeValue === 'number') {
      // Excel serial number for time
      const excelEpoch = new Date(1899, 11, 30); // Excel epoch
      dateObj = new Date(excelEpoch.getTime() + timeValue * 24 * 60 * 60 * 1000);
    } else {
      // String or other formats
      dateObj = new Date(timeValue);
    }
    
    if (isNaN(dateObj.getTime())) return "";
    
    const hours = dateObj.getHours().toString().padStart(2, '0');
    const minutes = dateObj.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  } catch {
    return "";
  }
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

// Simple closest match function (replaces get_close_matches)
function getCloseMatches(target: string, choices: string[], cutoff: number = 0.7): string[] {
  if (!target) return [];
  
  const matches: Array<{choice: string, score: number}> = [];
  
  for (const choice of choices) {
    if (!choice) continue;
    
    // Simple similarity based on common tokens
    const targetTokens = new Set(target.split(' '));
    const choiceTokens = new Set(choice.split(' '));
    
    const targetArray = Array.from(targetTokens);
    const choiceArray = Array.from(choiceTokens);
    
    const intersection = new Set(targetArray.filter(x => choiceTokens.has(x)));
    const union = new Set([...targetArray, ...choiceArray]);
    
    const similarity = intersection.size / union.size;
    
    if (similarity >= cutoff) {
      matches.push({choice, score: similarity});
    }
  }
  
  matches.sort((a, b) => b.score - a.score);
  return matches.length > 0 ? [matches[0].choice] : [];
}

// Parse DD/MM/YYYY date format
function parseDate(dateStr: string): Date {
  try {
    // Try DD/MM/YYYY first
    return parse(dateStr, 'dd/MM/yyyy', new Date());
  } catch {
    try {
      // Try DD/MM/YY
      return parse(dateStr, 'dd/MM/yy', new Date());
    } catch {
      throw new Error(`Invalid date format: ${dateStr}. Expected DD/MM/YYYY`);
    }
  }
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

  // Parse client_demand.xlsx
  const demandWorkbook = XLSX.read(demandBuffer);
  const demandSheetNames = demandWorkbook.SheetNames;
  if (demandSheetNames.length === 0) {
    throw new Error('No sheets found in client_demand file');
  }

  const demandSheet = demandWorkbook.Sheets[demandSheetNames[0]];
  const demandData = XLSX.utils.sheet_to_json<ClientDemandRow>(demandSheet);

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
  guaranteedData.forEach((row, index) => {
    try {
      if (!row["Actual Employee Name"] || typeof row["Actual Employee Hours Per Week"] !== 'number') {
        warnings.push(`Guaranteed hours row ${index + 1}: Missing or invalid required fields`);
        return;
      }
      validatedGuaranteed.push(row);
    } catch (error) {
      warnings.push(`Guaranteed hours row ${index + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  // Process demand data
  const validatedDemand: ClientDemandRow[] = [];
  demandData.forEach((row, index) => {
    try {
      if (!row.Date || typeof row["Required Client Hours"] !== 'number') {
        warnings.push(`Client demand row ${index + 1}: Missing or invalid required fields`);
        return;
      }
      // Validate that date can be parsed
      parseDate(row.Date);
      validatedDemand.push(row);
    } catch (error) {
      warnings.push(`Client demand row ${index + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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

  // Step 1: Prepare guaranteed hours with normalized names
  const guaranteedEmployees = guaranteed.map(row => ({
    originalName: row["Actual Employee Name"],
    normalizedName: normalizeName(row["Actual Employee Name"]),
    weeklyHours: row["Actual Employee Hours Per Week"]
  }));

  // Step 2: Match availability names to guaranteed hours
  const guaranteedKeys = guaranteedEmployees.map(emp => emp.normalizedName);
  const matchedAvailability: Array<ParsedAvailabilityRow & {matchedEmployee: EmployeeGuaranteedHours}> = [];
  const unmatchedNames: string[] = [];

  availability.forEach(row => {
    const normalizedName = normalizeName(row["CAREGiver Name"]);
    const matches = getCloseMatches(normalizedName, guaranteedKeys, 0.7);
    
    if (matches.length > 0) {
      const matchedEmployee = guaranteedEmployees.find(emp => emp.normalizedName === matches[0]);
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
      timeWindow: `${timeToString(row["Start Time"])}-${timeToString(row["End Time"])}`,
      hours: hoursEffective,
      notes: row.Notes || "",
      employeeKey: key
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

  // Step 6: Collapse function - exactly like your collapse_one_group function
  const cleanedRecords: CleanedEmployeeRecord[] = [];
  
  groupedData.forEach((group) => {
    if (group.length === 0) return;
    
    const empName = group[0].employeeName;
    const weekly = group[0].contractedWeeklyHours;
    const daily = group[0].contractedDailyHours || 0.0;
    const date = group[0].date;
    
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
      
      if (row.timeWindow && row.timeWindow !== "" && row.timeWindow !== "-") {
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
      
      // Join windows and notes like your Python logic
      const windowsStr = Array.from(new Set(agg.windows)).sort().join("; ");
      const notesStr = Array.from(new Set(agg.notes)).sort().join("; ");
      
      cleanedRecords.push({
        employeeName: empName,
        contractedWeeklyHours: Math.round(weekly * 100) / 100,
        contractedDailyHours: Math.round(daily * 100) / 100,
        date,
        status,
        timeWindows: windowsStr,
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

  // Step 7: Build Daily Summary
  const dailySummaryMap = new Map<string, {
    availableHours: number;
    netCapacity: number;
    sickness: number;
    holidays: number;
  }>();

  cleanedRecords.forEach(record => {
    if (!dailySummaryMap.has(record.date)) {
      dailySummaryMap.set(record.date, {
        availableHours: 0,
        netCapacity: 0,
        sickness: 0,
        holidays: 0
      });
    }

    const summary = dailySummaryMap.get(record.date)!;
    summary.netCapacity += record.netCapacity;

    if (record.status === 'Available') {
      summary.availableHours += record.hours;
    } else if (record.status === 'Sick') {
      summary.sickness += record.hours;
    } else if (record.status === 'Holiday') {
      summary.holidays += record.hours;
    }
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
        sickness: Math.round(summary.sickness * 100) / 100,
        holidays: Math.round(summary.holidays * 100) / 100,
        clientRequired: Math.round(clientRequired * 100) / 100,
        gap,
        status: (gap >= 0 ? 'Sufficient' : 'Shortage') as 'Sufficient' | 'Shortage'
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  // Step 9: Calculate KPIs
  const kpis = {
    netCapacitySum: Math.round(dailySummary.reduce((sum, d) => sum + d.netCapacity, 0) * 100) / 100,
    clientRequiredSum: Math.round(dailySummary.reduce((sum, d) => sum + d.clientRequired, 0) * 100) / 100,
    gapSum: Math.round(dailySummary.reduce((sum, d) => sum + d.gap, 0) * 100) / 100,
    sicknessSum: Math.round(dailySummary.reduce((sum, d) => sum + d.sickness, 0) * 100) / 100,
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
      hours: record.hours,
      netCapacity: record.netCapacity,
      notes: record.notes
    });
  });

  // Sort employees within each date
  Object.values(employeesByDate).forEach(employees => {
    employees.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  });

  return {
    kpis,
    dailySummary,
    employeesByDate,
    cleanedRecords,
    warnings: warnings.length > 0 ? warnings : undefined
  };
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
    ['Date', 'Available Hours', 'Net Capacity', 'Sickness', 'Holidays', 'Client Required', 'Gap', 'Status'],
    ...result.dailySummary.map(day => [
      day.date,
      day.availableHours.toString(),
      day.netCapacity.toString(),
      day.sickness.toString(),
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