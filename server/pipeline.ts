import * as XLSX from 'xlsx';
import * as fuzzball from 'fuzzball';
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

// Status priority (highest to lowest)
const STATUS_PRIORITY: Record<string, number> = {
  'Maternity/Paternity': 7,
  'Sick': 6,
  'Holiday': 5,
  'Compassionate Leave': 4,
  'Other Unavailable': 3,
  'Pre-Agreed Appointment': 2,
  'Available': 1
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

interface EmployeeDateEntry {
  employeeName: string;
  date: string;
  entries: Array<{
    status: string;
    startTime: string;
    endTime: string;
    hours: number;
    notes: string;
  }>;
  contractedWeeklyHours: number;
  contractedDailyHours: number;
}

// Normalize name for fuzzy matching
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    // Remove titles
    .replace(/\b(mr|mrs|miss|ms|dr)\.?\b/gi, '')
    // Remove parentheses blocks like (NL) (GH)
    .replace(/\([^)]*\)/g, '')
    // Remove punctuation
    .replace(/[^\w\s]/g, ' ')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim()
    // Sort tokens alphabetically
    .split(' ')
    .filter(token => token.length > 0)
    .sort()
    .join(' ');
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

// Calculate hours from time strings
function calculateHours(startTime: string, endTime: string): number {
  const parseTime = (timeStr: string): number => {
    const [time, period] = timeStr.trim().split(/\s*(AM|PM|am|pm)\s*/);
    let [hours, minutes] = time.split(':').map(Number);
    
    if (period && period.toLowerCase() === 'pm' && hours !== 12) {
      hours += 12;
    } else if (period && period.toLowerCase() === 'am' && hours === 12) {
      hours = 0;
    }
    
    return hours + (minutes || 0) / 60;
  };

  try {
    const start = parseTime(startTime);
    let end = parseTime(endTime);
    
    // Handle overnight shifts
    if (end <= start) {
      end += 24;
    }
    
    return Math.round((end - start) * 100) / 100; // Round to 2 decimals
  } catch {
    throw new Error(`Invalid time format: ${startTime} - ${endTime}`);
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

  // Validate availability data
  const validatedAvailability: ParsedAvailabilityRow[] = [];
  availabilityData.forEach((row, index) => {
    try {
      const validatedRow = availabilitySchema.parse(row);
      const parsedDate = parseDate(validatedRow["Start Date"]);
      const calculatedHours = validatedRow.Hours ?? calculateHours(
        validatedRow["Start Time"], 
        validatedRow["End Time"]
      );
      
      validatedAvailability.push({
        ...validatedRow,
        parsedDate,
        calculatedHours
      });
    } catch (error) {
      warnings.push(`Availability row ${index + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  // Validate guaranteed hours data
  const validatedGuaranteed: GuaranteedHoursRow[] = [];
  guaranteedData.forEach((row, index) => {
    try {
      const validatedRow = guaranteedSchema.parse(row);
      validatedGuaranteed.push(validatedRow);
    } catch (error) {
      warnings.push(`Guaranteed hours row ${index + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  // Validate demand data
  const validatedDemand: ClientDemandRow[] = [];
  demandData.forEach((row, index) => {
    try {
      const validatedRow = clientDemandSchema.parse(row);
      // Validate that date can be parsed
      parseDate(validatedRow.Date);
      validatedDemand.push(validatedRow);
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

// Perform fuzzy name matching
export function matchEmployeeNames(
  availability: ParsedAvailabilityRow[],
  guaranteed: GuaranteedHoursRow[]
): {
  matched: Map<string, EmployeeGuaranteedHours>;
  unmatched: string[];
} {
  const guaranteedEmployees: EmployeeGuaranteedHours[] = guaranteed.map(row => ({
    originalName: row["Actual Employee Name"],
    normalizedName: normalizeName(row["Actual Employee Name"]),
    weeklyHours: row["Actual Employee Hours Per Week"]
  }));

  const availabilityNames = Array.from(new Set(availability.map(row => row["CAREGiver Name"])));
  const matched = new Map<string, EmployeeGuaranteedHours>();
  const unmatched: string[] = [];

  availabilityNames.forEach(availName => {
    const normalizedAvailName = normalizeName(availName);
    
    // Find best match using fuzzy matching
    let bestMatch: EmployeeGuaranteedHours | null = null;
    let bestRatio = 0;

    guaranteedEmployees.forEach(guaranteed => {
      const ratio = fuzzball.ratio(normalizedAvailName, guaranteed.normalizedName) / 100;
      if (ratio >= 0.7 && ratio > bestRatio) {
        bestMatch = guaranteed;
        bestRatio = ratio;
      }
    });

    if (bestMatch) {
      matched.set(availName, bestMatch);
    } else {
      unmatched.push(availName);
    }
  });

  return { matched, unmatched };
}

// Process and clean the data according to the exact rules
export function processCapacityData(
  availability: ParsedAvailabilityRow[],
  guaranteed: GuaranteedHoursRow[],
  demand: ClientDemandRow[]
): ProcessingResult & { cleanedRecords: CleanedEmployeeRecord[] } {
  const warnings: string[] = [];

  // Step 1: Match employee names
  const { matched: nameMatches, unmatched } = matchEmployeeNames(availability, guaranteed);
  
  if (unmatched.length > 0) {
    warnings.push(`Unmatched employees: ${unmatched.join(', ')}`);
  }

  // Step 2: Filter out unmatched employees
  const matchedAvailability = availability.filter(row => nameMatches.has(row["CAREGiver Name"]));

  // Step 3: Calculate contracted daily hours
  // Group by employee to get unique dates they appear in
  const employeeDateCounts = new Map<string, Set<string>>();
  matchedAvailability.forEach(row => {
    const dateStr = format(row.parsedDate, 'yyyy-MM-dd');
    const employeeName = row["CAREGiver Name"];
    
    if (!employeeDateCounts.has(employeeName)) {
      employeeDateCounts.set(employeeName, new Set());
    }
    employeeDateCounts.get(employeeName)!.add(dateStr);
  });

  // Step 4: Group by Employee + Date and apply status priority
  const employeeDateEntries = new Map<string, EmployeeDateEntry>();

  matchedAvailability.forEach(row => {
    const dateStr = format(row.parsedDate, 'yyyy-MM-dd');
    const employeeName = row["CAREGiver Name"];
    const key = `${employeeName}|${dateStr}`;
    const matchedEmployee = nameMatches.get(employeeName)!;
    const dateSet = employeeDateCounts.get(employeeName)!;
    const daysAvailable = Array.from(dateSet).length;
    const contractedDailyHours = Math.round((matchedEmployee.weeklyHours / daysAvailable) * 100) / 100;

    if (!employeeDateEntries.has(key)) {
      employeeDateEntries.set(key, {
        employeeName: matchedEmployee.originalName,
        date: dateStr,
        entries: [],
        contractedWeeklyHours: matchedEmployee.weeklyHours,
        contractedDailyHours
      });
    }

    const entry = employeeDateEntries.get(key)!;
    entry.entries.push({
      status: row.Type,
      startTime: row["Start Time"],
      endTime: row["End Time"],
      hours: row.calculatedHours,
      notes: row.Notes || ''
    });
  });

  // Step 5: Apply status priority and consolidate
  const cleanedRecords: CleanedEmployeeRecord[] = [];

  employeeDateEntries.forEach(entry => {
    // Group entries by status and sort by priority
    const statusGroups = new Map<string, typeof entry.entries>();
    entry.entries.forEach(e => {
      if (!statusGroups.has(e.status)) {
        statusGroups.set(e.status, []);
      }
      statusGroups.get(e.status)!.push(e);
    });

    // Apply priority (keep highest priority status that has entries)
    const sortedStatuses = Array.from(statusGroups.keys())
      .sort((a, b) => (STATUS_PRIORITY[b] || 0) - (STATUS_PRIORITY[a] || 0));

    sortedStatuses.forEach(status => {
      const statusEntries = statusGroups.get(status)!;
      const totalHours = statusEntries.reduce((sum, e) => sum + e.hours, 0);
      
      // Concatenate time windows
      const timeWindows = statusEntries
        .map(e => `${e.startTime}-${e.endTime}`)
        .join('; ');
      
      // Notes
      const notes = statusEntries
        .map(e => e.notes)
        .filter(n => n.length > 0)
        .join('; ');

      // Calculate net capacity based on status
      let netCapacity = 0;
      if (status.toLowerCase().includes('available')) {
        // For available status, calculate leave hours from other statuses
        const leaveHours = Array.from(statusGroups.entries())
          .filter(([s]) => s !== status && !s.toLowerCase().includes('available'))
          .reduce((sum, [, entries]) => sum + entries.reduce((s, e) => s + e.hours, 0), 0);
        
        // Cap leave at contracted daily hours
        const cappedLeave = Math.min(leaveHours, entry.contractedDailyHours);
        netCapacity = Math.max(0, totalHours - cappedLeave);
      } else {
        // Leave rows always have Net Capacity = 0
        netCapacity = 0;
      }

      cleanedRecords.push({
        employeeName: entry.employeeName,
        contractedWeeklyHours: entry.contractedWeeklyHours,
        contractedDailyHours: entry.contractedDailyHours,
        date: entry.date,
        status,
        timeWindows,
        hours: Math.round(totalHours * 100) / 100,
        netCapacity: Math.round(netCapacity * 100) / 100,
        notes
      });
    });
  });

  // Step 6: Build Daily Summary
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

    if (record.status.toLowerCase().includes('available')) {
      summary.availableHours += record.hours;
    } else if (record.status.toLowerCase().includes('sick')) {
      summary.sickness += record.hours;
    } else if (record.status.toLowerCase().includes('holiday')) {
      summary.holidays += record.hours;
    }
  });

  // Step 7: Merge with client demand and create final daily summary
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

  // Step 8: Calculate KPIs
  const kpis = {
    netCapacitySum: Math.round(dailySummary.reduce((sum, d) => sum + d.netCapacity, 0) * 100) / 100,
    clientRequiredSum: Math.round(dailySummary.reduce((sum, d) => sum + d.clientRequired, 0) * 100) / 100,
    gapSum: Math.round(dailySummary.reduce((sum, d) => sum + d.gap, 0) * 100) / 100,
    sicknessSum: Math.round(dailySummary.reduce((sum, d) => sum + d.sickness, 0) * 100) / 100,
    holidaysSum: Math.round(dailySummary.reduce((sum, d) => sum + d.holidays, 0) * 100) / 100
  };

  // Step 9: Build employees by date for drilldown
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