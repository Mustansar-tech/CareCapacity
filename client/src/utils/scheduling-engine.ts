// VRPTW Weekly Scheduling Engine with proper constraints
import type { ClientVisit, EmployeeLocation } from "@shared/schema";
import { 
  timeToMinutes, 
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

// Minimum bookable window duration (minutes)
const MIN_WINDOW_DURATION = 60;

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
  visit: ClientVisit,
  employeeSchedules: EmployeeDaySchedule[],
  assignedVisitIds: Set<string>
): { success: boolean; employeeName?: string; reason?: string } {
  // Skip if already assigned
  if (assignedVisitIds.has(visit.id)) {
    return { success: false, reason: 'Already assigned' };
  }

  // Skip office visits
  if (isOfficeVisit(visit.clientName)) {
    return { success: false, reason: 'Office visit excluded' };
  }

  // Skip if no location data
  if (!visit.lat || !visit.lng) {
    return { success: false, reason: 'Missing location data' };
  }

  const scoringVisit = toScoringVisit(visit);
  const candidates: Array<{
    employeeName: string;
    score: number;
    insertionIndex: number;
    travelFromPrev: number;
    travelToNext: number;
  }> = [];

  // Score visit for each employee
  for (const schedule of employeeSchedules) {
    // Check capacity constraint
    if (wouldExceedCapacity(schedule, visit.durationMinutes)) {
      continue; // Skip - would exceed capacity
    }

    // Filter windows to only include those >= 60 minutes for feasibility
    const validWindows = schedule.windows.filter(w => (w.end - w.start) >= MIN_WINDOW_DURATION);
    
    if (validWindows.length === 0) {
      continue; // No valid windows available
    }

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

  // Create assigned visit
  const assignedVisit: AssignedVisit = {
    id: visit.id,
    clientName: visit.clientName,
    startTime: visit.startTime,
    endTime: visit.endTime,
    durationMinutes: visit.durationMinutes,
    lat: visit.lat,
    lng: visit.lng,
    travelTimeBefore: best.travelFromPrev,
    score: best.score,
  };

  // Insert at the correct position
  schedule.assignedVisits.splice(best.insertionIndex, 0, assignedVisit);
  
  // Update capacity usage
  schedule.usedCapacityMinutes += visit.durationMinutes;
  
  // Mark as assigned
  assignedVisitIds.add(visit.id);

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

  // Assign each visit
  for (const visit of sortedVisits) {
    const employeeSchedules = schedulesByDate[visit.date] || [];
    
    if (employeeSchedules.length === 0) {
      unallocated.push({ ...visit, reason: 'No employees available for this date' });
      continue;
    }

    const result = assignVisitToBestEmployee(visit, employeeSchedules, assignedVisitIds);
    
    if (!result.success) {
      unallocated.push({ ...visit, reason: result.reason || 'Unknown reason' });
    }
  }

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
