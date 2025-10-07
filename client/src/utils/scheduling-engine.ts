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

// GH (Guaranteed Hours) bonus for prioritization
const GH_SCORE_BONUS = 0.1;

// Check if employee has Guaranteed Hours (GH in name)
function isGHEmployee(employeeName: string): boolean {
  return employeeName.toUpperCase().includes('(GH)');
}

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
      // Add GH bonus to prioritize guaranteed hours employees
      const finalScore = isGHEmployee(schedule.employeeName) 
        ? matchScore.score + GH_SCORE_BONUS 
        : matchScore.score;
      
      candidates.push({
        employeeName: schedule.employeeName,
        score: finalScore,
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
  visits = filteredVisits;
  
  // Count GH employees for tracking
  const ghEmployeeCount = new Set(
    employees.filter(e => isGHEmployee(e.employeeName)).map(e => e.employeeName)
  ).size;
  const totalEmployeeCount = new Set(employees.map(e => e.employeeName)).size;
  console.log(`👥 Employee breakdown: ${ghEmployeeCount} GH employees, ${totalEmployeeCount - ghEmployeeCount} non-GH employees (${totalEmployeeCount} total)`);
  // Initialize employee schedules by date and name
  const schedulesByDate: Record<string, EmployeeDaySchedule[]> = {};
  
  weekDates.forEach(date => {
    const dayEmployees = employees.filter(e => e.date === date);
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

  // Sort visits by priority (if available), then by start time
  const sortedVisits = [...visits].sort((a, b) => {
    if (a.priority !== b.priority) {
      return (b.priority || 1) - (a.priority || 1);
    }
    return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
  });

  // First pass: Assign each visit prioritizing GH employees
  for (const visit of sortedVisits) {
    const employeeSchedules = schedulesByDate[visit.date] || [];
    
    if (employeeSchedules.length === 0) {
      unallocated.push({ ...visit, reason: 'No employees available for this date' });
      continue;
    }

    // Separate GH and non-GH employees for two-phase allocation
    const ghEmployees = employeeSchedules.filter(s => isGHEmployee(s.employeeName));
    
    // Phase 1: Try to assign to GH employees first (if any available)
    let result = ghEmployees.length > 0
      ? assignVisitToBestEmployee(visit, ghEmployees, assignedVisitIds)
      : { success: false, reason: 'No GH employees available' };
    
    // Phase 2: If not assigned to GH employee, try all employees
    if (!result.success) {
      result = assignVisitToBestEmployee(visit, employeeSchedules, assignedVisitIds);
    }
    
    if (!result.success) {
      unallocated.push({ ...visit, reason: result.reason || 'Unknown reason' });
    }
  }

  // Second pass: Try to allocate remaining visits by sorting them differently
  // Sort by visit duration (shorter visits first - easier to fit)
  const remainingUnallocated: Array<ClientVisit & { reason: string }> = [];
  const secondPassVisits = [...unallocated].sort((a, b) => a.durationMinutes - b.durationMinutes);
  
  for (const visit of secondPassVisits) {
    const employeeSchedules = schedulesByDate[visit.date] || [];
    
    if (employeeSchedules.length === 0) {
      remainingUnallocated.push(visit);
      continue;
    }

    const result = assignVisitToBestEmployee(visit, employeeSchedules, assignedVisitIds);
    
    if (!result.success) {
      remainingUnallocated.push(visit);
    }
  }
  
  // Update unallocated with only the visits that couldn't be assigned in either pass
  unallocated.length = 0;
  unallocated.push(...remainingUnallocated);

  // Build final assignments structure
  const assignments: Record<string, Record<string, AssignedVisit[]>> = {};
  
  weekDates.forEach(date => {
    assignments[date] = {};
    const daySchedules = schedulesByDate[date] || [];
    
    daySchedules.forEach(schedule => {
      if (schedule.assignedVisits.length > 0) {
        assignments[date][schedule.employeeName] = schedule.assignedVisits;
      }
    });
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

  // Track GH vs non-GH utilization
  const ghEmployeesUtilized = Array.from(utilizedEmployees).filter(name => isGHEmployee(name));
  const nonGhEmployeesUtilized = Array.from(utilizedEmployees).filter(name => !isGHEmployee(name));
  
  console.log(`✅ GH Prioritization Results: ${ghEmployeesUtilized.length} GH employees utilized, ${nonGhEmployeesUtilized.length} non-GH employees utilized`);

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
