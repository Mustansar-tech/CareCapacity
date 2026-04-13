/**
 * Capacity Windows Calculation Utility
 * 
 * Implements the algorithm for calculating free time windows that can be assigned to new clients.
 * Based on the provided specification for normalizing, merging, and computing available capacity.
 */

interface TimeInterval {
  start: number; // minutes from 00:00
  end: number;   // minutes from 00:00
}

interface EmployeeCapacityInput {
  employeeName: string;
  date: string;
  availabilityWindows: string; // e.g., "08:00-12:00, 14:00-18:00"
  unavailabilityWindows: string; // e.g., "10:00-11:00"
  scheduledWindows: string; // e.g., "09:00-10:00, 15:00-16:00"
  desiredMinutes: number; // contracted daily hours in minutes
}

interface CapacityResult {
  employeeName: string;
  date: string;
  freeWindows: string; // e.g., "08:00-09:00, 16:00-18:00"
  freeWindowsMinutes: number;
  differenceMinutes: number;
  workableMinutes: number;
  unavailabilityMinutes: number;
  scheduledMinutes: number;
}

/**
 * Convert "HH:mm" time string to minutes from midnight
 */
function timeToMinutes(timeStr: string): number {
  if (!timeStr || timeStr.trim() === '') return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes)) return 0;
  return hours * 60 + minutes;
}

/**
 * Convert minutes from midnight to "HH:mm" format
 */
function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

/**
 * Parse time windows string into intervals
 * Input: "08:00-12:00, 14:00-18:00" or "08:00-12:00"
 */
function parseTimeWindows(windowsStr: string): TimeInterval[] {
  if (!windowsStr || windowsStr.trim() === '' || windowsStr === '-') {
    return [];
  }

  const windows = windowsStr.split(/[,;]/).map(w => w.trim()).filter(w => w);
  const intervals: TimeInterval[] = [];

  for (const window of windows) {
    const parts = window.split('-');
    if (parts.length === 2) {
      const start = timeToMinutes(parts[0].trim());
      let end = timeToMinutes(parts[1].trim());
      
      // Handle overnight windows (e.g., 22:00-07:00)
      if (end < start) {
        end += 24 * 60;
      }
      
      // Ignore invalid intervals
      if (start >= 0 && end > start) {
        intervals.push({ start, end });
      }
    }
  }

  return intervals;
}

/**
 * Merge overlapping or back-to-back intervals
 * Normalize and merge before any math operations
 */
function mergeIntervals(intervals: TimeInterval[], bufferMinutes: number = 0): TimeInterval[] {
  if (intervals.length === 0) return [];

  // Sort by start time
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: TimeInterval[] = [];
  let current = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    
    // Check if intervals overlap or are back-to-back (with buffer)
    if (next.start <= current.end + bufferMinutes) {
      // Merge intervals
      current = {
        start: current.start,
        end: Math.max(current.end, next.end)
      };
    } else {
      merged.push(current);
      current = next;
    }
  }
  
  merged.push(current);
  return merged;
}

/**
 * Subtract one set of intervals from another
 * Returns the portions of availableIntervals that don't overlap with unavailableIntervals
 */
function subtractIntervals(availableIntervals: TimeInterval[], unavailableIntervals: TimeInterval[]): TimeInterval[] {
  if (availableIntervals.length === 0) return [];
  if (unavailableIntervals.length === 0) return availableIntervals;

  let result = [...availableIntervals];

  for (const unavailable of unavailableIntervals) {
    const newResult: TimeInterval[] = [];

    for (const available of result) {
      if (unavailable.end <= available.start || unavailable.start >= available.end) {
        // No overlap, keep the available interval
        newResult.push(available);
      } else {
        // There is overlap, split the available interval
        if (unavailable.start > available.start) {
          // Keep the part before the unavailable interval
          newResult.push({
            start: available.start,
            end: Math.min(unavailable.start, available.end)
          });
        }
        if (unavailable.end < available.end) {
          // Keep the part after the unavailable interval
          newResult.push({
            start: Math.max(unavailable.end, available.start),
            end: available.end
          });
        }
      }
    }

    result = newResult;
  }

  return result;
}

/**
 * Round intervals: round start times UP and end times DOWN to the nearest roundToMinutes
 * Drop windows shorter than minWindowMinutes
 */
function roundAndFilterWindows(
  intervals: TimeInterval[], 
  roundToMinutes: number = 15, 
  minWindowMinutes: number = 60
): TimeInterval[] {
  const result: TimeInterval[] = [];

  for (const interval of intervals) {
    // Round start UP to next boundary
    const roundedStart = Math.ceil(interval.start / roundToMinutes) * roundToMinutes;
    
    // Round end DOWN to previous boundary
    const roundedEnd = Math.floor(interval.end / roundToMinutes) * roundToMinutes;

    // Only keep if the window is long enough after rounding
    if (roundedEnd - roundedStart >= minWindowMinutes) {
      result.push({
        start: roundedStart,
        end: roundedEnd
      });
    }
  }

  return result;
}

/**
 * Calculate total minutes from intervals
 */
function calculateTotalMinutes(intervals: TimeInterval[]): number {
  return intervals.reduce((total, interval) => total + (interval.end - interval.start), 0);
}

/**
 * Format intervals back to time windows string
 */
function formatTimeWindows(intervals: TimeInterval[]): string {
  if (intervals.length === 0) return '';
  
  return intervals
    .map(interval => `${minutesToTime(interval.start)}-${minutesToTime(interval.end)}`)
    .join(', ');
}

/**
 * Convert minutes to hours with 1 decimal place format
 */
export function toHours1dp(minutes: number): string {
  const hours = minutes / 60;
  return `${hours.toFixed(1)}h`;
}

/**
 * Main function to compute capacity windows for an employee on a specific date
 */
export function computeCapacityWindows(
  input: EmployeeCapacityInput,
  options: {
    roundToMinutes?: number;
    minWindowMinutes?: number;
    bufferMinutes?: number;
  } = {}
): CapacityResult {
  const {
    roundToMinutes = 15,
    minWindowMinutes = 60,
    bufferMinutes = 0
  } = options;

  // Step 1: Parse all time windows
  const availabilityIntervals = mergeIntervals(parseTimeWindows(input.availabilityWindows), bufferMinutes);
  const unavailabilityIntervals = mergeIntervals(parseTimeWindows(input.unavailabilityWindows), bufferMinutes);
  const scheduledIntervals = mergeIntervals(parseTimeWindows(input.scheduledWindows), bufferMinutes);

  // Step 2: Calculate workable time = Availability - Unavailability
  const workableIntervals = subtractIntervals(availabilityIntervals, unavailabilityIntervals);
  const workableMinutes = calculateTotalMinutes(workableIntervals);

  // Step 3: Calculate unavailability minutes (only the portion that overlaps availability)
  const unavailabilityMinutes = calculateTotalMinutes(availabilityIntervals) - workableMinutes;

  // Step 4: Calculate scheduled minutes (intersection with workable time)
  const effectiveScheduledIntervals = subtractIntervals(workableIntervals, scheduledIntervals);
  const scheduledMinutes = workableMinutes - calculateTotalMinutes(effectiveScheduledIntervals);

  // Step 5: Calculate free windows = Workable - Scheduled
  const freeIntervals = subtractIntervals(workableIntervals, scheduledIntervals);

  // Step 6: Round and filter free windows
  const finalFreeWindows = roundAndFilterWindows(freeIntervals, roundToMinutes, minWindowMinutes);
  const freeWindowsMinutes = calculateTotalMinutes(finalFreeWindows);

  // Step 7: Calculate difference
  const differenceMinutes = input.desiredMinutes - unavailabilityMinutes - scheduledMinutes;

  return {
    employeeName: input.employeeName,
    date: input.date,
    freeWindows: formatTimeWindows(finalFreeWindows),
    freeWindowsMinutes,
    differenceMinutes,
    workableMinutes,
    unavailabilityMinutes,
    scheduledMinutes
  };
}

/**
 * Helper function to suggest start/end pairs for visits within given windows
 */
export function suggestStarts(
  freeWindows: string,
  visitDurationMinutes: number,
  options: {
    gridStepMinutes?: number;
    bufferBeforeMinutes?: number;
    bufferAfterMinutes?: number;
  } = {}
): { start: string; end: string }[] {
  const {
    gridStepMinutes = 15,
    bufferBeforeMinutes = 0,
    bufferAfterMinutes = 0
  } = options;

  const intervals = parseTimeWindows(freeWindows);
  const suggestions: { start: string; end: string }[] = [];

  for (const interval of intervals) {
    const availableStart = interval.start + bufferBeforeMinutes;
    const availableEnd = interval.end - bufferAfterMinutes;
    const neededDuration = visitDurationMinutes;

    if (availableEnd - availableStart >= neededDuration) {
      // Generate suggestions on grid
      for (let start = availableStart; start + neededDuration <= availableEnd; start += gridStepMinutes) {
        const alignedStart = Math.ceil(start / gridStepMinutes) * gridStepMinutes;
        if (alignedStart + neededDuration <= availableEnd) {
          suggestions.push({
            start: minutesToTime(alignedStart),
            end: minutesToTime(alignedStart + neededDuration)
          });
        }
      }
    }
  }

  return suggestions;
}

/**
 * Calculate how many 1-hour visits can fit in the given free windows
 */
export function capacityInOneHourVisits(
  freeWindows: string,
  options: {
    bufferBeforeMinutes?: number;
    bufferAfterMinutes?: number;
  } = {}
): number {
  const {
    bufferBeforeMinutes = 0,
    bufferAfterMinutes = 0
  } = options;

  const intervals = parseTimeWindows(freeWindows);
  let totalVisits = 0;

  for (const interval of intervals) {
    const availableMinutes = interval.end - interval.start - bufferBeforeMinutes - bufferAfterMinutes;
    const visits = Math.floor(availableMinutes / 60); // 60 minutes per visit
    totalVisits += Math.max(0, visits);
  }

  return totalVisits;
}