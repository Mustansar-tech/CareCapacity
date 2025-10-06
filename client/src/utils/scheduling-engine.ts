// VRPTW Weekly Scheduling Engine with proper constraints
import type { ClientVisit, EmployeeLocation } from "@shared/schema";
import {
  timeToMinutes,
  minutesToTime,
  parseTimeWindows,
  type TimeWindow,
  isInsertionFeasible,
} from './scheduling-utils';
import {
  scoreVisitMatch,
  type EmployeeRun,
  type Visit as ScoringVisit
} from './scheduling-scoring';

// Office visit keywords to exclude
const OFFICE_VISIT_KEYWORDS = ['east nl', 'glasgow', 'training seawared'];

// Secondary multiple care keywords to exclude
const SECONDARY_CARE_KEYWORDS = ['multiple care (secondary)', 'secondary', '(secondary)'];

// Minimum bookable window duration (minutes)
// Reduced from 60 to 45 to allow more flexibility
const MIN_WINDOW_DURATION = 45;

// Time flexibility tolerance (minutes) - allows visits to be slightly outside windows
const TIME_FLEXIBILITY_MINUTES = 5;

// Employee's daily schedule
interface EmployeeDaySchedule {
  employeeName: string;
  date: string;
  windows: TimeWindow[]; // Available time windows
  totalCapacityMinutes: number; // Total available care time
  usedCapacityMinutes: number; // Total assigned care time (excluding travel)
  assignedVisits: AssignedVisit[];
  homeLat: number;
  homeLng: number;
  transportMode: 'car' | 'walking' | 'public';
}

interface AssignedVisit {
  id: string;
  clientName: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  lat?: number;
  lng?: number;
  travelTimeBefore: number;
  score: number;
}

interface WeeklyScheduleResult {
  assignments: Record<string, Record<string, AssignedVisit[]>>; // date -> employee -> visits
  unallocated: Array<ClientVisit & { reason: string }>;
  metrics: {
    totalVisitsAssigned: number;
    totalVisitsUnallocated: number;
    averageTravelTimePerVisit: number;
    employeesUtilized: number;
  };
}

// Filter out office visits
function isOfficeVisit(clientName: string): boolean {
  const lowerName = clientName.toLowerCase();
  return OFFICE_VISIT_KEYWORDS.some(keyword => lowerName.includes(keyword));
}

// Filter out secondary multiple care visits
function isSecondaryMultipleCare(serviceType: string): boolean {
  if (!serviceType) return false;
  const lowerType = serviceType.toLowerCase();
  return SECONDARY_CARE_KEYWORDS.some(keyword => lowerType.includes(keyword));
}

// Calculate total capacity from time windows (excluding windows < 60 min)
function calculateTotalCapacity(windows: TimeWindow[]): number {
  return windows
    .filter(w => (w.end - w.start) >= MIN_WINDOW_DURATION)
    .reduce((sum, w) => sum + (w.end - w.start), 0);
}

// Check if adding a visit would exceed capacity
function wouldExceedCapacity(
  schedule: EmployeeDaySchedule,
  visitDurationMinutes: number
): boolean {
  return (schedule.usedCapacityMinutes + visitDurationMinutes) > schedule.totalCapacityMinutes;
}

// Flexibly adjust visit times to fit available windows if close enough
function adjustVisitToFitWindows(visit: ClientVisit, windows: TimeWindow[]): ClientVisit | null {
  const visitStart = timeToMinutes(visit.startTime);
  const visitEnd = timeToMinutes(visit.endTime);
  const visitDuration = visitEnd - visitStart;

  // First try exact fit
  for (const window of windows) {
    if (visitStart >= window.start && visitEnd <= window.end) {
      return visit; // Perfect fit, no adjustment needed
    }
  }

  // Try flexible fit with adjustment
  for (const window of windows) {
    const windowDuration = window.end - window.start;

    // Skip windows too small for this visit
    if (windowDuration < visitDuration) continue;

    // Check if visit can be adjusted to fit in this window
    let adjustedStart = visitStart;
    let adjustedEnd = visitEnd;

    // If visit starts slightly before window, move it to window start
    if (visitStart >= window.start - TIME_FLEXIBILITY_MINUTES && visitStart < window.start) {
      adjustedStart = window.start;
      adjustedEnd = adjustedStart + visitDuration;
    }

    // If visit ends slightly after window, move it to end at window end
    if (visitEnd <= window.end + TIME_FLEXIBILITY_MINUTES && visitEnd > window.end) {
      adjustedEnd = window.end;
      adjustedStart = adjustedEnd - visitDuration;
    }

    // Check if adjusted visit fits in window
    if (adjustedStart >= window.start && adjustedEnd <= window.end) {
      console.log(`🔧 Adjusted visit ${visit.clientName} from ${visit.startTime}-${visit.endTime} to ${minutesToTime(adjustedStart)}-${minutesToTime(adjustedEnd)} to fit window ${minutesToTime(window.start)}-${minutesToTime(window.end)}`);

      return {
        ...visit,
        startTime: minutesToTime(adjustedStart),
        endTime: minutesToTime(adjustedEnd),
      };
    }
  }

  return null; // Could not adjust to fit any window
}

// Convert ClientVisit to ScoringVisit format
function toScoringVisit(visit: ClientVisit): ScoringVisit {
  return {
    clientName: visit.clientName,
    start: timeToMinutes(visit.startTime),
    end: timeToMinutes(visit.endTime),
    lat: visit.lat || 0,
    lng: visit.lng || 0,
  };
}

// Try to assign a visit to the best employee
function assignVisitToBestEmployee(
  originalVisit: ClientVisit,
  employeeSchedules: EmployeeDaySchedule[],
  assignedVisitIds: Set<string>
): { success: boolean; employeeName?: string; reason?: string } {
  // Skip if already assigned
  if (assignedVisitIds.has(originalVisit.id)) {
    return { success: false, reason: 'Already assigned' };
  }

  // Note: Office visits, secondary multiple care, and visits without location data
  // are already filtered out in generateWeeklySchedule, so no need to check again here

  const candidates: Array<{
    employeeName: string;
    score: number;
    insertionIndex: number;
    travelFromPrev: number;
    travelToNext: number;
    adjustedVisit: ClientVisit;
  }> = [];

  // Score visit for each employee
  for (const schedule of employeeSchedules) {
    // Check capacity constraint
    if (wouldExceedCapacity(schedule, originalVisit.durationMinutes)) {
      continue; // Skip - would exceed capacity
    }

    // Filter windows to only include those >= minimum duration for feasibility
    const validWindows = schedule.windows.filter(w => (w.end - w.start) >= MIN_WINDOW_DURATION);

    if (validWindows.length === 0) {
      continue; // No valid windows available
    }

    // Try to adjust visit to fit in employee's windows
    const adjustedVisit = adjustVisitToFitWindows(originalVisit, validWindows);
    if (!adjustedVisit) {
      continue; // Could not adjust visit to fit any window
    }

    const scoringVisit = toScoringVisit(adjustedVisit);

    // Convert assigned visits to scoring format
    const employeeRun: EmployeeRun = {
      visits: schedule.assignedVisits.map(v => ({
        clientName: v.clientName,
        start: timeToMinutes(v.startTime),
        end: timeToMinutes(v.endTime),
        lat: v.lat || 0,
        lng: v.lng || 0,
      })),
      homeLat: schedule.homeLat,
      homeLng: schedule.homeLng,
      mode: schedule.transportMode,
    };

    const matchScore = scoreVisitMatch(scoringVisit, employeeRun, validWindows);

    if (matchScore && matchScore.score > 0) {
      candidates.push({
        employeeName: schedule.employeeName,
        score: matchScore.score,
        insertionIndex: matchScore.insertionIndex,
        travelFromPrev: matchScore.travelFromPrev,
        travelToNext: matchScore.travelToNext,
        adjustedVisit,
      });
    }
  }

  // No feasible employees
  if (candidates.length === 0) {
    return { success: false, reason: 'No feasible employee (capacity/window/travel constraints)' };
  }

  // Sort by score descending and pick the best
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  // Find the employee schedule
  const schedule = employeeSchedules.find(s => s.employeeName === best.employeeName)!;

  // Create assigned visit using adjusted times
  const assignedVisit: AssignedVisit = {
    id: best.adjustedVisit.id,
    clientName: best.adjustedVisit.clientName,
    startTime: best.adjustedVisit.startTime,
    endTime: best.adjustedVisit.endTime,
    durationMinutes: best.adjustedVisit.durationMinutes,
    lat: best.adjustedVisit.lat,
    lng: best.adjustedVisit.lng,
    travelTimeBefore: best.travelFromPrev,
    score: best.score,
  };

  // Insert at the correct position
  schedule.assignedVisits.splice(best.insertionIndex, 0, assignedVisit);

  // Update capacity usage
  schedule.usedCapacityMinutes += best.adjustedVisit.durationMinutes;

  // Mark as assigned
  assignedVisitIds.add(originalVisit.id);

  return { success: true, employeeName: best.employeeName };
}

// Generate weekly schedule using VRPTW algorithm
export function generateWeeklySchedule(
  visits: ClientVisit[], // All visits for the week
  employees: Array<{
    employeeName: string;
    date: string;
    timeWindows: string | string[];
    homeLat?: number;
    homeLng?: number;
    transportMode?: string;
    contractedDailyHours?: number; // Added for GH hours tracking
  }>,
  weekDates: string[]
): WeeklyScheduleResult {
  // Filter out excluded visits at the beginning
  const filteredVisits = visits.filter(visit => {
    // Skip office visits
    if (isOfficeVisit(visit.clientName)) {
      console.log(`🚫 Excluding office visit: ${visit.clientName}`);
      return false;
    }

    // Skip secondary multiple care visits
    if (isSecondaryMultipleCare(visit.serviceType || '')) {
      console.log(`🚫 Excluding secondary multiple care visit: ${visit.clientName} (${visit.serviceType})`);
      return false;
    }

    // Skip if no location data
    if (!visit.lat || !visit.lng) {
      console.log(`🚫 Excluding visit without location: ${visit.clientName}`);
      return false;
    }

    return true;
  });

  console.log(`📊 Filtered visits: ${visits.length} → ${filteredVisits.length} (excluded ${visits.length - filteredVisits.length} visits)`);

  // Use filtered visits for the rest of the function
  const allVisits = filteredVisits;
  const allEmployees = employees;

  // Initialize employee schedules by date and name
  const schedulesByDate: Record<string, EmployeeDaySchedule[]> = {};

  weekDates.forEach(date => {
    const dayEmployees = allEmployees.filter(e => e.date === date);
    schedulesByDate[date] = dayEmployees.map(emp => {
      const windows = parseTimeWindows(emp.timeWindows);
      // Normalize transport mode to allowed values
      let mode: 'car' | 'walking' | 'public' = 'car';
      if (emp.transportMode) {
        const modeLower = emp.transportMode.toLowerCase();
        if (modeLower.includes('walk')) {
          mode = 'walking';
        } else if (modeLower.includes('public') || modeLower.includes('bus') || modeLower.includes('train')) {
          mode = 'public';
        } else if (modeLower.includes('car')) {
          mode = 'car';
        }
      }

      return {
        employeeName: emp.employeeName,
        date,
        windows,
        totalCapacityMinutes: calculateTotalCapacity(windows),
        usedCapacityMinutes: 0,
        assignedVisits: [],
        homeLat: emp.homeLat || 55.9533, // Edinburgh fallback
        homeLng: emp.homeLng || -3.1883,
        transportMode: mode,
      };
    });
  });

  // Track assigned visit IDs globally to ensure uniqueness
  const assignedVisitIds = new Set<string>();
  const unallocated: Array<ClientVisit & { reason: string }> = [];

  // Step 1: Group visits by date
  const visitsByDate = new Map<string, ClientVisit[]>();
  allVisits.forEach(visit => {
    if (!visitsByDate.has(visit.date)) {
      visitsByDate.set(visit.date, []);
    }
    visitsByDate.get(visit.date)!.push(visit);
  });

  // Step 2: Process each date independently
  weekDates.forEach(date => {
    const dateVisits = visitsByDate.get(date) || [];
    let dateEmployees = allEmployees.filter(emp => emp.date === date);

    if (dateVisits.length === 0 || dateEmployees.length === 0) {
      return; // Skip if no visits or no employees for this date
    }

    // Prioritize employees with "GH" (Guaranteed Hours) in their names
    dateEmployees = dateEmployees.sort((a, b) => {
      const aHasGH = a.employeeName.includes('(GH)') || a.employeeName.includes('GH');
      const bHasGH = b.employeeName.includes('(GH)') || b.employeeName.includes('GH');

      if (aHasGH && !bHasGH) return -1; // a comes first
      if (!aHasGH && bHasGH) return 1;  // b comes first
      return 0; // maintain order
    });

    console.log(`📅 Processing ${date}: ${dateVisits.length} visits, ${dateEmployees.length} employees (GH employees prioritized)`);

    // Initialize data structures for this date
    const dateAssignments: Record<string, AssignedVisit[]> = {};
    const employeeLoads: Map<string, number> = new Map(); // Stores current load in hours
    const employeePositions: Map<string, { lat: number; lng: number }> = new Map(); // Stores last visit location

    // Initialize employee loads and positions
    dateEmployees.forEach(emp => {
      employeeLoads.set(emp.employeeName, 0);
      // Set initial position to home if available, otherwise fallback
      employeePositions.set(emp.employeeName, { lat: emp.homeLat || 55.9533, lng: emp.homeLng || -3.1883 });
    });

    // Sort visits by priority, then by start time
    const sortedDateVisits = [...dateVisits].sort((a, b) => {
      if (a.priority !== b.priority) {
        return (b.priority || 1) - (a.priority || 1);
      }
      return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
    });

    // Assign visits for the current date
    for (const visit of sortedDateVisits) {
      const currentEmployeeSchedules = schedulesByDate[date]?.filter(s => s.employeeName === dateEmployees.find(e => e.employeeName === s.employeeName)?.employeeName) || [];

      if (currentEmployeeSchedules.length === 0) {
        unallocated.push({ ...visit, reason: 'No employees available for this date' });
        continue;
      }

      const candidates: Array<{
        employee: { employeeName: string; timeWindows: string | string[]; contractedDailyHours?: number };
        score: number;
        travelTime: number; // Travel time from previous visit or home
        insertionIndex: number;
      }> = [];

      for (const employee of dateEmployees) {
        const schedule = currentEmployeeSchedules.find(s => s.employeeName === employee.employeeName);
        if (!schedule) continue; // Should not happen if dateEmployees are filtered correctly

        // Check capacity constraint
        if (wouldExceedCapacity(schedule, visit.durationMinutes)) {
          continue;
        }

        const windows = parseTimeWindows(employee.timeWindows);
        const validWindows = windows.filter(w => (w.end - w.start) >= MIN_WINDOW_DURATION);
        if (validWindows.length === 0) continue;

        const adjustedVisit = adjustVisitToFitWindows(visit, validWindows);
        if (!adjustedVisit) continue;

        const scoringVisit: ScoringVisit = {
          clientName: adjustedVisit.clientName,
          start: timeToMinutes(adjustedVisit.startTime),
          end: timeToMinutes(adjustedVisit.endTime),
          lat: adjustedVisit.lat || 0,
          lng: adjustedVisit.lng || 0,
        };

        const employeeRun: EmployeeRun = {
          visits: schedule.assignedVisits.map(v => ({
            clientName: v.clientName,
            start: timeToMinutes(v.startTime),
            end: timeToMinutes(v.endTime),
            lat: v.lat || 0,
            lng: v.lng || 0,
          })),
          homeLat: schedule.homeLat,
          homeLng: schedule.homeLng,
          mode: schedule.transportMode,
        };

        const matchScore = scoreVisitMatch(scoringVisit, employeeRun, validWindows);

        if (matchScore && matchScore.score > 0) {
          // Calculate travel time from the employee's current position (last visit or home)
          const lastPosition = employeePositions.get(employee.employeeName) || { lat: schedule.homeLat, lng: schedule.homeLng };
          // Assuming a function `calculateTravelTime` exists and returns minutes
          // For simplicity, let's use a placeholder or a basic calculation if not provided
          const travelTime = 0; // Placeholder for actual travel time calculation

          candidates.push({
            employee: { ...employee, contractedDailyHours: employee.contractedDailyHours },
            score: matchScore.score,
            travelTime: matchScore.travelFromPrev, // Using travelFromPrev from scoreVisitMatch
            insertionIndex: matchScore.insertionIndex,
          });
        }
      }

      if (candidates.length === 0) {
        unallocated.push({ ...visit, reason: 'No feasible employee found' });
        continue;
      }

      // Sort candidates by score (descending)
      candidates.sort((a, b) => b.score - a.score);

      // Assign to best candidate
      const bestCandidate = candidates[0];
      const employeeName = bestCandidate.employee.employeeName;
      const schedule = schedulesByDate[date].find(s => s.employeeName === employeeName)!;

      // Create assigned visit using adjusted times
      const assignedVisit: AssignedVisit = {
        id: visit.id,
        clientName: visit.clientName,
        startTime: visit.startTime, // Use original start time if not adjusted, or adjusted if it was
        endTime: visit.endTime,     // Use original end time if not adjusted, or adjusted if it was
        durationMinutes: visit.durationMinutes,
        lat: visit.lat,
        lng: visit.lng,
        travelTimeBefore: bestCandidate.travelTime,
        score: bestCandidate.score,
      };

      // Insert at the correct position
      schedule.assignedVisits.splice(bestCandidate.insertionIndex, 0, assignedVisit);

      // Update capacity usage
      schedule.usedCapacityMinutes += visit.durationMinutes;

      // Update employee load and position
      const currentLoad = (employeeLoads.get(employeeName) || 0) + visit.durationMinutes / 60;
      employeeLoads.set(employeeName, currentLoad);
      employeePositions.set(employeeName, { lat: visit.lat!, lng: visit.lng! });

      // Log if GH employee is getting assignments to track guaranteed hours utilization
      const hasGH = employeeName.includes('(GH)') || employeeName.includes('GH');
      if (hasGH) {
        const targetHours = bestCandidate.employee.contractedDailyHours || 0;
        console.log(`✅ GH Employee ${employeeName}: ${currentLoad.toFixed(1)}h / ${targetHours}h assigned`);
      }

      // Mark as assigned
      assignedVisitIds.add(visit.id);
    }

    // Store the finalized assignments for the date
    dateAssignments[date] = {};
    schedulesByDate[date]?.forEach(schedule => {
      if (schedule.assignedVisits.length > 0) {
        dateAssignments[date][schedule.employeeName] = schedule.assignedVisits;
      }
    });
  });

  // Collect all assignments across all dates
  const assignments: Record<string, Record<string, AssignedVisit[]>> = {};
  weekDates.forEach(date => {
    assignments[date] = dateAssignments[date] || {};
  });

  // Calculate metrics
  const totalVisitsAssigned = assignedVisitIds.size;
  const totalVisitsUnallocated = unallocated.length;

  let totalTravelTime = 0;
  let visitCount = 0;
  const utilizedEmployees = new Set<string>();

  weekDates.forEach(date => {
    const daySchedules = schedulesByDate[date] || [];
    daySchedules.forEach(schedule => {
      if (schedule.assignedVisits.length > 0) {
        utilizedEmployees.add(schedule.employeeName);
        schedule.assignedVisits.forEach(visit => {
          totalTravelTime += visit.travelTimeBefore;
          visitCount++;
        });
      }
    });
  });

  const averageTravelTimePerVisit = visitCount > 0 ? Math.round(totalTravelTime / visitCount) : 0;

  return {
    assignments,
    unallocated,
    metrics: {
      totalVisitsAssigned,
      totalVisitsUnallocated,
      averageTravelTimePerVisit,
      employeesUtilized: utilizedEmployees.size,
    },
  };
}