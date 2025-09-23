import { ProcessingResult, EmployeeSummaryRecord } from '@shared/schema';
import { parseISO, format } from 'date-fns';

// Company's 11 standardized time blocks
export const COMPANY_TIME_BLOCKS = [
  { start: '08:00', end: '09:00', label: '08:00-09:00' },
  { start: '09:15', end: '10:15', label: '09:15-10:15' },
  { start: '10:30', end: '11:30', label: '10:30-11:30' },
  { start: '11:45', end: '12:45', label: '11:45-12:45' },
  { start: '13:00', end: '14:00', label: '13:00-14:00' },
  { start: '14:15', end: '15:15', label: '14:15-15:15' },
  { start: '15:30', end: '16:30', label: '15:30-16:30' },
  { start: '16:45', end: '17:45', label: '16:45-17:45' },
  { start: '18:00', end: '19:00', label: '18:00-19:00' },
  { start: '19:15', end: '20:15', label: '19:15-20:15' },
  { start: '20:30', end: '21:30', label: '20:30-21:30' },
];

export interface TimeBlock {
  start: string;
  end: string;
  label: string;
}

export interface EmployeeAvailabilityInfo {
  name: string;
  gender?: string;
  transportMode?: string;
  freeWindows: string;
}

export interface BDMatrixCell {
  count: number;
  employees: EmployeeAvailabilityInfo[];
  colorClass: string;
}

export interface BDMatrixData {
  dates: string[];
  timeBlocks: TimeBlock[];
  matrix: Record<string, Record<string, BDMatrixCell>>; // date -> timeBlock.label -> BDMatrixCell
}

/**
 * Parse time string to minutes since midnight for easy comparison
 */
function timeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Check if employee's free windows fully cover a specific time block
 * Requires full availability within the time block
 */
function isFullyAvailableInTimeBlock(freeWindows: string, timeBlock: TimeBlock): boolean {
  if (!freeWindows || freeWindows === '-' || freeWindows === '') {
    return false;
  }

  const blockStart = timeToMinutes(timeBlock.start);
  const blockEnd = timeToMinutes(timeBlock.end);

  // Parse free windows (format: "HH:mm-HH:mm, HH:mm-HH:mm")
  const windows = freeWindows.split(',').map(w => w.trim()).filter(w => w);
  
  for (const window of windows) {
    if (window.includes('-')) {
      const [startStr, endStr] = window.split('-').map(s => s.trim());
      const windowStart = timeToMinutes(startStr);
      const windowEnd = timeToMinutes(endStr);
      
      // Check if this window fully covers the time block
      if (windowStart <= blockStart && windowEnd >= blockEnd) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Get color class based on employee count
 * Red: 0-1, Yellow: 2-3, Green: 4+
 */
function getColorClass(count: number): string {
  if (count <= 1) return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300';
  if (count <= 3) return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300';
  return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300';
}

/**
 * Process ProcessingResult to create BD Matrix data
 */
export function processBDMatrixData(data: ProcessingResult): BDMatrixData {
  const dates = Object.keys(data.employeeSummaryByDate).sort();
  const matrix: Record<string, Record<string, BDMatrixCell>> = {};

  // Initialize matrix structure
  for (const date of dates) {
    matrix[date] = {};
    for (const timeBlock of COMPANY_TIME_BLOCKS) {
      matrix[date][timeBlock.label] = {
        count: 0,
        employees: [],
        colorClass: getColorClass(0)
      };
    }
  }

  // Process each date's employee data
  for (const date of dates) {
    const employees = data.employeeSummaryByDate[date] || [];
    
    for (const employee of employees) {
      // Check each time block for this employee
      for (const timeBlock of COMPANY_TIME_BLOCKS) {
        if (isFullyAvailableInTimeBlock(employee.freeWindows, timeBlock)) {
          const cell = matrix[date][timeBlock.label];
          cell.count++;
          cell.employees.push({
            name: employee.employeeName,
            gender: employee.gender,
            transportMode: employee.transportMode,
            freeWindows: employee.freeWindows
          });
          // Update color class based on new count
          cell.colorClass = getColorClass(cell.count);
        }
      }
    }
  }

  return {
    dates,
    timeBlocks: COMPANY_TIME_BLOCKS,
    matrix
  };
}

/**
 * Get formatted date display for BD Matrix headers
 */
export function formatDateForDisplay(dateStr: string): string {
  try {
    const date = parseISO(dateStr);
    return format(date, 'EEE dd/MM');
  } catch (error) {
    return dateStr;
  }
}

/**
 * Get day of week from date string
 */
export function getDayOfWeek(dateStr: string): string {
  try {
    const date = parseISO(dateStr);
    return format(date, 'EEEE');
  } catch (error) {
    return 'Unknown';
  }
}