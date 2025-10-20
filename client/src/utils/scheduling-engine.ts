// VRPTW Weekly Scheduling Engine with proper constraints
import type { ClientVisit, EmployeeLocation } from "@shared/schema";
import {
  timeToMinutes,
  minutesToTime,
  parseTimeWindows,
  type TimeWindow,
  isInsertionFeasible,
  getTravelMinutes // Import getTravelMinutes
} from './scheduling-utils';
import {
  scoreVisitMatch,
  type EmployeeRun,
  type Visit as ScoringVisit
} from './scheduling-scoring';

// Office visit keywords to exclude
const OFFICE_VISIT_KEYWORDS = [
  'east nl',
  'glasgow',
  'training seawared',
  'training (nl)',
  'seaward place',
  'office',
  'training',
  'admin',
  'meeting'
];

// Secondary multiple care keywords to exclude
const SECONDARY_CARE_KEYWORDS = ['multiple care (secondary)', 'secondary', '(secondary)'];

// Minimum bookable window duration (minutes)
// Set to 0 to allow scheduling in ANY available time slot
const MIN_WINDOW_DURATION = 0;

// Time flexibility tolerance (minutes) - allows visits to be slightly outside windows
const TIME_FLEXIBILITY_MINUTES = 5;

// GH (Guaranteed Hours) bonus for prioritization
const GH_SCORE_BONUS = 0.1;

// Check if employee has Guaranteed Hours (GH in name)
function isGHEmployee(employeeName: string): boolean {
  return employeeName.toUpperCase().includes('(GH)');
}

// Maximum daily care hours per CP (excluding travel/waiting)
const MAX_DAILY_CARE_HOURS = 9;
const MAX_DAILY_CARE_MINUTES = MAX_DAILY_CARE_HOURS * 60;

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
  weeklyContractedMinutes: number; // Total weekly contracted minutes
  weeklyUsedMinutes: number; // Total weekly care minutes assigned so far
  gender?: string; // Gender for matching client preferences
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

// Calculate total capacity from ALL time windows
function calculateTotalCapacity(windows: TimeWindow[]): number {
  return windows.reduce((sum, w) => sum + (w.end - w.start), 0);
}

// Check if adding a visit would exceed capacity, daily limit, or weekly hours
function wouldExceedCapacity(
  schedule: EmployeeDaySchedule,
  visitDurationMinutes: number
): boolean {
  const newTotalCareTime = schedule.usedCapacityMinutes + visitDurationMinutes;
  const newWeeklyTotal = schedule.weeklyUsedMinutes + visitDurationMinutes;

  // Check against weekly contracted hours first
  if (newWeeklyTotal > schedule.weeklyContractedMinutes) {
    console.log(`⚠️ ${schedule.employeeName}: Would exceed weekly hours (${(newWeeklyTotal/60).toFixed(1)}h > ${(schedule.weeklyContractedMinutes/60).toFixed(1)}h)`);
    return true;
  }

  // Check against 9-hour daily limit
  if (newTotalCareTime > MAX_DAILY_CARE_MINUTES) {
    console.log(`⚠️ ${schedule.employeeName}: Would exceed 9-hour daily limit (${newTotalCareTime}min > ${MAX_DAILY_CARE_MINUTES}min)`);
    return true;
  }

  // Check against available daily capacity
  if (newTotalCareTime > schedule.totalCapacityMinutes) {
    console.log(`⚠️ ${schedule.employeeName}: Would exceed capacity (${newTotalCareTime}min > ${schedule.totalCapacityMinutes}min)`);
    return true;
  }

  return false;
}

// Check if visit fits in available windows WITHOUT adjusting times
// Client visit times are FIXED and cannot be shifted
// ALLOWS GAPS - employee can have free time between visits
function adjustVisitToFitWindows(visit: ClientVisit, windows: TimeWindow[]): ClientVisit | null {
  const visitStart = timeToMinutes(visit.startTime);
  const visitEnd = timeToMinutes(visit.endTime);
  const visitDuration = visitEnd - visitStart;

  // Check if visit fits EXACTLY within any availability window
  // NO TIME SHIFTING ALLOWED - visit times are fixed from Excel
  // GAPS ARE ALLOWED - visits don't need to be back-to-back
  for (const window of windows) {
    if (visitStart >= window.start && visitEnd <= window.end) {
      return visit; // Return original visit with unchanged times
    }
  }

  return null; // Cannot assign - visit time is fixed and doesn't match any window
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

// Calculate travel time from previous location (or home if first visit)
function calculateTravelFromPrevious(
  visit: ClientVisit,
  schedule: EmployeeDaySchedule,
  insertionIndex: number
): number {
  if (insertionIndex === 0) {
    // First visit - calculate from home
    const travelService = new (require('./scheduling-utils').TravelTimeService)();
    return travelService.calculateTravelTime(
      { lat: schedule.homeLat, lng: schedule.homeLng },
      { lat: visit.lat || 0, lng: visit.lng || 0 },
      schedule.transportMode
    ).travelTimeMinutes;
  } else {
    // Calculate from previous visit
    const prevVisit = schedule.assignedVisits[insertionIndex - 1];
    const travelService = new (require('./scheduling-utils').TravelTimeService)();
    return travelService.calculateTravelTime(
      { lat: prevVisit.lat || 0, lng: prevVisit.lng || 0 },
      { lat: visit.lat || 0, lng: visit.lng || 0 },
      schedule.transportMode
    ).travelTimeMinutes;
  }
}

// Check if client requires specific gender (e.g., "Mullen, Eileen (F)" requires female)
function getClientGenderPreference(clientName: string): string | null {
  const upperName = clientName.toUpperCase();
  if (upperName.includes('(F)') || upperName.endsWith(' F')) {
    return 'female';
  }
  if (upperName.includes('(M)') || upperName.endsWith(' M')) {
    return 'male';
  }
  return null; // No preference
}

// Check if employee gender matches client preference
function isGenderMatch(employeeGender: string | undefined, clientName: string): boolean {
  const preference = getClientGenderPreference(clientName);
  if (!preference) return true; // No preference, any gender is OK
  
  if (!employeeGender) {
    console.warn(`⚠️ Employee has no gender data, cannot match client preference: ${clientName}`);
    return false; // If client has preference but employee gender unknown, skip
  }
  
  const empGenderLower = employeeGender.toLowerCase();
  return empGenderLower.includes(preference);
}

// Try to assign a visit to the best employee
function assignVisitToBestEmployee(
  originalVisit: ClientVisit,
  employeeSchedules: EmployeeDaySchedule[],
  assignedVisitIds: Set<string>,
  weeklyUsedMap: Map<string, number>,
  allSchedulesByDate: Record<string, EmployeeDaySchedule[]>
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
    // Check gender preference match
    if (!isGenderMatch(schedule.gender, originalVisit.clientName)) {
      console.log(`⚠️ Gender mismatch: ${schedule.employeeName} (${schedule.gender || 'unknown'}) cannot serve ${originalVisit.clientName}`);
      continue; // Skip this employee - gender doesn't match client preference
    }
    // Check capacity constraint
    if (wouldExceedCapacity(schedule, originalVisit.durationMinutes)) {
      continue; // Skip - would exceed capacity
    }

    // ALL windows are valid - don't filter by minimum duration
    // This allows scheduling in smaller gaps and utilizing all available time
    const validWindows = schedule.windows;

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

  // For first visit, ensure we calculate travel from home
  let actualTravelTimeBefore = best.travelFromPrev;
  if (best.insertionIndex === 0) {
    // First visit - calculate from home location
    actualTravelTimeBefore = getTravelMinutes(
      { lat: schedule.homeLat, lng: schedule.homeLng },
      { lat: best.adjustedVisit.lat || 0, lng: best.adjustedVisit.lng || 0 },
      schedule.transportMode
    );
    console.log(`🏠 First visit travel calc: home(${schedule.homeLat}, ${schedule.homeLng}) → ${best.adjustedVisit.clientName}(${best.adjustedVisit.lat}, ${best.adjustedVisit.lng}) = ${actualTravelTimeBefore}min (${schedule.transportMode})`);
  }

  // Create assigned visit using adjusted times
  const assignedVisit: AssignedVisit = {
    id: best.adjustedVisit.id,
    clientName: best.adjustedVisit.clientName,
    startTime: best.adjustedVisit.startTime,
    endTime: best.adjustedVisit.endTime,
    durationMinutes: best.adjustedVisit.durationMinutes,
    lat: best.adjustedVisit.lat,
    lng: best.adjustedVisit.lng,
    travelTimeBefore: actualTravelTimeBefore,
    score: best.score,
  };

  // Debug logging for travel time
  if (best.insertionIndex === 0) {
    console.log(`✅ FIRST visit ${best.employeeName} → ${assignedVisit.clientName}: ${assignedVisit.travelTimeBefore}min from home (${schedule.homeLat}, ${schedule.homeLng})`);
  } else {
    const prevVisit = schedule.assignedVisits[best.insertionIndex - 1];
    console.log(`✅ Visit ${best.employeeName} → ${assignedVisit.clientName}: ${assignedVisit.travelTimeBefore}min from ${prevVisit.clientName}`);
  }

  // Insert at the correct position
  schedule.assignedVisits.splice(best.insertionIndex, 0, assignedVisit);

  // Update capacity usage
  schedule.usedCapacityMinutes += best.adjustedVisit.durationMinutes;
  schedule.weeklyUsedMinutes += best.adjustedVisit.durationMinutes;

  // Update the shared weekly tracking map for all schedules of this employee
  weeklyUsedMap.set(best.employeeName, schedule.weeklyUsedMinutes);

  // Update weekly used minutes for all other schedules of this employee across all dates
  Object.values(allSchedulesByDate).forEach(daySchedules => {
    daySchedules.forEach(s => {
      if (s.employeeName === best.employeeName) {
        s.weeklyUsedMinutes = schedule.weeklyUsedMinutes;
      }
    });
  });

  const careHoursUsed = (schedule.usedCapacityMinutes / 60).toFixed(1);
  const weeklyHoursUsed = (schedule.weeklyUsedMinutes / 60).toFixed(1);
  const weeklyContracted = (schedule.weeklyContractedMinutes / 60).toFixed(1);
  console.log(`📊 ${best.employeeName}: ${careHoursUsed}h/${MAX_DAILY_CARE_HOURS}h daily | ${weeklyHoursUsed}h/${weeklyContracted}h weekly`);

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
    weeklyContractedHours?: number;
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

  // Identify multiple care visits (same client, date, time = needs 2 CPs)
  const multipleCareGroups = new Map<string, ClientVisit[]>();
  filteredVisits.forEach(visit => {
    const key = `${visit.clientName}-${visit.date}-${visit.startTime}-${visit.endTime}`;
    if (!multipleCareGroups.has(key)) {
      multipleCareGroups.set(key, []);
    }
    multipleCareGroups.get(key)!.push(visit);
  });

  // Log multiple care visits
  const multipleCareKeys = Array.from(multipleCareGroups.entries()).filter(([_, visits]) => visits.length > 1);
  if (multipleCareKeys.length > 0) {
    console.log(`👥 Found ${multipleCareKeys.length} multiple care visits (need 2 CPs):`);
    multipleCareKeys.forEach(([key, visits]) => {
      console.log(`   ${visits[0].clientName} @ ${visits[0].startTime}-${visits[0].endTime} (${visits.length} CPs needed)`);
    });
  }

  // Use filtered visits for the rest of the function
  visits = filteredVisits;

  // Calculate weekly contracted minutes per employee
  const weeklyContractedMap = new Map<string, number>();
  employees.forEach(emp => {
    const current = weeklyContractedMap.get(emp.employeeName) || 0;
    const dailyHours = emp.weeklyContractedHours || 0;
    weeklyContractedMap.set(emp.employeeName, Math.max(current, dailyHours * 60));
  });

  // Track weekly used minutes per employee (shared across all days)
  const weeklyUsedMap = new Map<string, number>();

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

      // Initialize weekly used minutes for this employee if not exists
      if (!weeklyUsedMap.has(emp.employeeName)) {
        weeklyUsedMap.set(emp.employeeName, 0);
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
        weeklyContractedMinutes: weeklyContractedMap.get(emp.employeeName) || 0,
        weeklyUsedMinutes: weeklyUsedMap.get(emp.employeeName) || 0,
        gender: (emp as any).gender, // Add gender from employee data
      };
    });
  });

  // Track assigned visit IDs globally to ensure uniqueness
  const assignedVisitIds = new Set<string>();
  const unallocated: Array<ClientVisit & { reason: string }> = [];

  // Track which employees are assigned to each time slot (for multiple care)
  const visitEmployeeAssignments = new Map<string, Set<string>>(); // key -> Set of employee names

  // Sort visits by priority (if available), then by start time
  const sortedVisits = [...filteredVisits].sort((a, b) => {
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

    // Check if this is a multiple care visit (needs to avoid already assigned employee)
    const visitKey = `${visit.clientName}-${visit.date}-${visit.startTime}-${visit.endTime}`;
    const alreadyAssignedEmployees = visitEmployeeAssignments.get(visitKey) || new Set<string>();

    // Filter out employees already assigned to this exact time slot
    const availableSchedules = employeeSchedules.filter(s => !alreadyAssignedEmployees.has(s.employeeName));

    if (availableSchedules.length === 0) {
      unallocated.push({ ...visit, reason: 'All employees already assigned to this time slot (multiple care)' });
      continue;
    }

    // Separate GH and non-GH employees for two-phase allocation
    const ghEmployees = availableSchedules.filter(s => isGHEmployee(s.employeeName));

    // Phase 1: Try to assign to GH employees first (if any available)
    let result = ghEmployees.length > 0
      ? assignVisitToBestEmployee(visit, ghEmployees, assignedVisitIds, weeklyUsedMap, schedulesByDate)
      : { success: false, reason: 'No GH employees available' };

    // Phase 2: If not assigned to GH employee, try all employees
    if (!result.success) {
      result = assignVisitToBestEmployee(visit, availableSchedules, assignedVisitIds, weeklyUsedMap, schedulesByDate);
    }

    if (result.success && result.employeeName) {
      // Track this employee assignment for multiple care visits
      if (!visitEmployeeAssignments.has(visitKey)) {
        visitEmployeeAssignments.set(visitKey, new Set());
      }
      visitEmployeeAssignments.get(visitKey)!.add(result.employeeName);

      // Log multiple care assignments
      if (alreadyAssignedEmployees.size > 0) {
        console.log(`👥 Multiple care: ${visit.clientName} @ ${visit.startTime} - CP ${alreadyAssignedEmployees.size + 1}: ${result.employeeName}`);
      }
    } else {
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

    // Check multiple care constraints again
    const visitKey = `${visit.clientName}-${visit.date}-${visit.startTime}-${visit.endTime}`;
    const alreadyAssignedEmployees = visitEmployeeAssignments.get(visitKey) || new Set<string>();

    // Filter out employees already assigned to this exact time slot
    const availableSchedules = employeeSchedules.filter(s => !alreadyAssignedEmployees.has(s.employeeName));

    if (availableSchedules.length === 0) {
      remainingUnallocated.push(visit);
      continue;
    }

    const result = assignVisitToBestEmployee(visit, availableSchedules, assignedVisitIds, weeklyUsedMap, schedulesByDate);

    if (result.success && result.employeeName) {
      // Track this employee assignment for multiple care visits
      if (!visitEmployeeAssignments.has(visitKey)) {
        visitEmployeeAssignments.set(visitKey, new Set());
      }
      visitEmployeeAssignments.get(visitKey)!.add(result.employeeName);
    } else {
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