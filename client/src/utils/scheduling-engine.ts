// VRPTW Weekly Scheduling Engine with proper constraints
import type { ClientVisit, EmployeeLocation } from "@shared/schema";
import {
  timeToMinutes,
  minutesToTime,
  parseTimeWindows,
  type TimeWindow,
  isInsertionFeasible,
  getTravelMinutes, // Import getTravelMinutes
  fitsInWindow // Import fitsInWindow
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

// Service types to exclude (including secondary care, office hours, night shifts, and shadowing)
const EXCLUDED_SERVICE_TYPES = [
  'office hours',
  'office',
  'nights - sleep in',
  'sleep in',
  'nights - waking nights',
  'waking nights',
  'night',
  'overnight',
  'sleepover',
  'multiple care (secondary)',
  'secondary',
  '(secondary)',
  'live in care (sc)',
  'live in care',
  'live-in care',
  'shadowing'
];

// Minimum bookable window duration (minutes)
// Set to 0 to allow scheduling in ANY available time slot
const MIN_WINDOW_DURATION = 0;

// Time flexibility tolerance (minutes) - allows visits to be slightly outside windows
const TIME_FLEXIBILITY_MINUTES = 5; // Reduced from 10 to 5

// Relaxed pass tolerances
const RELAXED_TIME_TOLERANCE = 10; // Reduced from 15 to 10

// GH (Guaranteed Hours) bonus for prioritization
const GH_SCORE_BONUS = 0.45;

// Maximum daily care hours per CP (excluding travel/waiting)
const MAX_DAILY_CARE_HOURS = 9;
const MAX_DAILY_CARE_MINUTES = MAX_DAILY_CARE_HOURS * 60;

// Evening bonus for GH staff
const GH_EVENING_BONUS = 0.35; 

// Scoring weights (optimized for MAXIMUM CAPACITY UTILIZATION)
// GAPS ARE ACCEPTABLE - prioritize filling employee hours over tight scheduling
const WEIGHTS = {
  tightness: 0.05,      // MINIMAL weight - gaps are perfectly fine, focus on capacity
  travelAdded: 0.30,    // Moderate weight - travel matters but not critical
  windowSlack: 0.50,    // HIGHEST weight - if it fits in window, assign it
  homeProximity: 0.15,  // Prefer routes near home
};

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

// Check if service type is excluded
function isExcludedServiceType(serviceType: string): boolean {
  if (!serviceType) return false;
  const lowerType = serviceType.toLowerCase();
  return EXCLUDED_SERVICE_TYPES.some(keyword => lowerType.includes(keyword));
}

// Calculate total capacity from ALL time windows
function calculateTotalCapacity(windows: TimeWindow[]): number {
  return windows.reduce((sum, w) => sum + (w.end - w.start), 0);
}

// Cluster visits by geographic location for better route optimization
// Groups nearby visits together so they can be assigned to the same employee
function clusterVisitsByLocation<T extends { lat?: number; lng?: number; date: string }>(visits: T[]): T[] {
  if (visits.length <= 1) return visits;
  
  // Group by date first
  const byDate = new Map<string, T[]>();
  visits.forEach(v => {
    if (!byDate.has(v.date)) byDate.set(v.date, []);
    byDate.get(v.date)!.push(v);
  });
  
  const clustered: T[] = [];
  
  byDate.forEach((dateVisits) => {
    // Sort visits within each date by location (simple grid-based clustering)
    // Divide area into grid cells and sort by cell, then by lat/lng within cell
    const gridSize = 0.02; // ~2km grid cells
    
    const withGrid = dateVisits.map(v => ({
      visit: v,
      gridX: Math.floor((v.lat || 0) / gridSize),
      gridY: Math.floor((v.lng || 0) / gridSize),
    }));
    
    // Sort by grid cell (clusters nearby visits)
    withGrid.sort((a, b) => {
      if (a.gridX !== b.gridX) return a.gridX - b.gridX;
      if (a.gridY !== b.gridY) return a.gridY - b.gridY;
      // Within same cell, sort by exact coordinates
      const latDiff = (a.visit.lat || 0) - (b.visit.lat || 0);
      if (latDiff !== 0) return latDiff;
      return (a.visit.lng || 0) - (b.visit.lng || 0);
    });
    
    clustered.push(...withGrid.map(w => w.visit));
  });
  
  return clustered;
}

// Check if adding a visit would exceed capacity, daily limit, or weekly hours
function wouldExceedCapacity(
  schedule: EmployeeDaySchedule,
  visitDurationMinutes: number
): boolean {
  const newTotalCareTime = schedule.usedCapacityMinutes + visitDurationMinutes;
  const newWeeklyTotal = schedule.weeklyUsedMinutes + visitDurationMinutes;

  // Check against weekly contracted hours first (with 30-minute tolerance to reduce wastage)
  const WEEKLY_TOLERANCE_MINUTES = 30; // Allow 0.5h over contracted hours
  if (newWeeklyTotal > schedule.weeklyContractedMinutes + WEEKLY_TOLERANCE_MINUTES) {
    console.log(`⚠️ ${schedule.employeeName}: Would exceed weekly hours (${(newWeeklyTotal/60).toFixed(1)}h > ${(schedule.weeklyContractedMinutes/60).toFixed(1)}h + 0.5h buffer)`);
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

// Merge adjacent or overlapping time windows for better scheduling
function mergeAdjacentWindows(windows: TimeWindow[]): TimeWindow[] {
  if (windows.length <= 1) return windows;
  
  // Sort by start time
  const sorted = [...windows].sort((a, b) => a.start - b.start);
  const merged: TimeWindow[] = [];
  
  let current = { ...sorted[0] };
  
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    // Merge if windows overlap or are adjacent (within 30 min gap)
    if (next.start <= current.end + 30) {
      current.end = Math.max(current.end, next.end);
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);
  
  return merged;
}

// Check if visit fits in available windows with tolerance
// toleranceMinutes: how many minutes the visit can extend outside windows
function adjustVisitToFitWindows(visit: ClientVisit, windows: TimeWindow[], toleranceMinutes: number = TIME_FLEXIBILITY_MINUTES): ClientVisit | null {
  const visitStart = timeToMinutes(visit.startTime);
  let visitEnd = timeToMinutes(visit.endTime);

  // Detect overnight visit
  const crossesMidnight = (visit as any).crossesMidnight || visitEnd < visitStart;

  if (crossesMidnight) {
    // For overnight visits, check if the visit fits across the day boundary
    visitEnd = timeToMinutes(visit.endTime, true); // Add 24 hours

    console.log(`🌙 Checking overnight visit fit: ${visit.clientName} ${visitStart}min to ${visitEnd}min`);

    // Check if employee has availability that can accommodate the overnight visit
    const hasLateWindow = windows.some(w => w.end >= visitStart && w.end >= 1380); // Works late (after 11pm)
    const hasEarlyWindow = windows.some(w => w.start <= (visitEnd - 1440) && w.start <= 180); // Starts early (before 3am)

    if (hasLateWindow && hasEarlyWindow) {
      return visit; // Can accommodate overnight visit
    }

    console.log(`⚠️ ${visit.clientName}: Overnight visit doesn't fit (needs late + early availability)`);
    return null;
  }

  // Merge adjacent windows for better coverage
  const mergedWindows = mergeAdjacentWindows(windows);

  // Regular same-day visit: Check if visit fits within any availability window (with tolerance)
  for (const window of mergedWindows) {
    // Exact fit
    if (visitStart >= window.start && visitEnd <= window.end) {
      return visit;
    }
    
    // Fit with tolerance - allow visit to slightly extend beyond window boundaries
    const extendedStart = window.start - toleranceMinutes;
    const extendedEnd = window.end + toleranceMinutes;
    
    if (visitStart >= extendedStart && visitEnd <= extendedEnd) {
      return visit; // Fits with tolerance
    }
  }

  // Check if visit mostly overlaps with any window (but still respects tolerance limits)
  for (const window of mergedWindows) {
    const overlapStart = Math.max(visitStart, window.start);
    const overlapEnd = Math.min(visitEnd, window.end);
    const overlapMinutes = Math.max(0, overlapEnd - overlapStart);
    const visitDuration = visitEnd - visitStart;
    
    // Only accept if overhang on each side is within tolerance
    const startOverhang = Math.max(0, window.start - visitStart);
    const endOverhang = Math.max(0, visitEnd - window.end);
    
    if (visitDuration > 0 && 
        overlapMinutes / visitDuration >= 0.7 &&
        startOverhang <= toleranceMinutes && 
        endOverhang <= toleranceMinutes) {
      return visit; // Acceptable overlap within tolerance bounds
    }
  }

  // No fit found - visit is outside all availability windows
  return null;
}

// Convert ClientVisit to ScoringVisit format
function toScoringVisit(visit: ClientVisit): ScoringVisit {
  const startMin = timeToMinutes(visit.startTime);
  let endMin = timeToMinutes(visit.endTime);

  // Detect overnight visit: if end time is earlier than start time, it crosses midnight
  // OR if visit has crossesMidnight flag set
  const crossesMidnight = (visit as any).crossesMidnight || endMin < startMin;

  if (crossesMidnight) {
    // Add 24 hours to end time to represent next day
    endMin = timeToMinutes(visit.endTime, true);
    console.log(`🌙 Overnight visit: ${visit.clientName} ${visit.startTime}-${visit.endTime} → ${startMin}min to ${endMin}min (crosses midnight)`);
  }

  return {
    clientName: visit.clientName,
    start: startMin,
    end: endMin,
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
  // Support both (M)/(F), (M )/(F ), and M/F at the end after a space or comma
  if (upperName.includes('(F)') || upperName.includes(' F)') || upperName.includes(', F)') || upperName.endsWith(' F') || upperName.endsWith(', F')) {
    return 'female';
  }
  if (upperName.includes('(M)') || upperName.includes(' M)') || upperName.includes(', M)') || upperName.endsWith(' M') || upperName.endsWith(', M')) {
    return 'male';
  }
  return null; // No preference
}

// Check if employee gender matches client preference
function isGenderMatch(employeeGender: string | undefined, clientName: string): boolean {
  const preference = getClientGenderPreference(clientName);
  if (!preference) return true; // No preference, any gender is OK

  if (!employeeGender) {
    console.log(`⚠️ STRICT: Employee has no gender data - cannot serve ${clientName} (requires ${preference})`);
    return false; // STRICT: Reject when employee gender is unknown but client has preference
  }

  const empGenderLower = employeeGender.toLowerCase();
  // Ensure we match 'female' or 'male' accurately
  const isFemale = empGenderLower === 'female' || empGenderLower === 'f';
  const isMale = empGenderLower === 'male' || empGenderLower === 'm';

  if (preference === 'female') {
    if (!isFemale) console.log(`⚠️ Gender mismatch: Employee (${empGenderLower}) cannot serve ${clientName} (requires female)`);
    return isFemale;
  }

  if (preference === 'male') {
    if (!isMale) console.log(`⚠️ Gender mismatch: Employee (${empGenderLower}) cannot serve ${clientName} (requires male)`);
    return isMale;
  }

  return true;
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

  // Note: Office visits, secondary multiple care, visits without location data,
  // and excluded service types are already filtered out in generateWeeklySchedule, so no need to check again here

  const candidates: Array<{
    employeeName: string;
    score: number;
    insertionIndex: number;
    travelFromPrev: number;
    travelToNext: number;
    adjustedVisit: ClientVisit;
  }> = [];

  // Score visit for each employee
  // Use relaxed tolerance if passed as option (for later passes)
  const tolerance = (originalVisit as any)._relaxedPass ? RELAXED_TIME_TOLERANCE : TIME_FLEXIBILITY_MINUTES;
  const relaxedCapacity = (originalVisit as any)._relaxedPass;
  
  for (const schedule of employeeSchedules) {
    // Check gender preference match
    if (!isGenderMatch(schedule.gender, originalVisit.clientName)) {
      console.log(`⚠️ Gender mismatch: ${schedule.employeeName} (${schedule.gender || 'unknown'}) cannot serve ${originalVisit.clientName}`);
      continue; // Skip this employee - gender doesn't match client preference
    }
    
    // ALWAYS check 9-hour daily limit regardless of pass
    const newTotalCareTime = schedule.usedCapacityMinutes + originalVisit.durationMinutes;
    if (newTotalCareTime > MAX_DAILY_CARE_MINUTES) {
      continue; // Skip - would exceed 9-hour daily limit
    }
    
    // Check capacity constraint
    if (!relaxedCapacity && wouldExceedCapacity(schedule, originalVisit.durationMinutes)) {
      continue; // Skip - would exceed capacity (strict mode)
    }
    
    // In relaxed mode, still check but with 2 hours extra weekly tolerance
    if (relaxedCapacity) {
      const newWeeklyTotal = schedule.weeklyUsedMinutes + originalVisit.durationMinutes;
      // Still enforce daily capacity even in relaxed mode
      if (newTotalCareTime > schedule.totalCapacityMinutes + 120) { // Increased daily tolerance
        continue; // Skip - would exceed daily availability
      }
      if (newWeeklyTotal > schedule.weeklyContractedMinutes + 180) { // Increased tolerance to 3 hours
        continue;
      }
    }

    // Use all availability windows without filtering
    const validWindows = schedule.windows;

    if (validWindows.length === 0) {
      continue; // No valid windows available
    }

    // Try to adjust visit to fit in employee's windows (with tolerance)
    const adjustedVisit = adjustVisitToFitWindows(originalVisit, validWindows, tolerance);
    if (!adjustedVisit) {
      continue; // Could not adjust visit to fit any window
    }

    // Score visit Match (with home break logic)
    const scoringVisit = toScoringVisit(adjustedVisit);
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
    if (!matchScore || matchScore.score <= 0) continue;

    const visitStartMinInternal = timeToMinutes(adjustedVisit.startTime);

    // Verify this insertion doesn't overlap with neighbors
    let insertionIndex = 0;
    while (insertionIndex < schedule.assignedVisits.length && 
           timeToMinutes(schedule.assignedVisits[insertionIndex].startTime) <= visitStartMinInternal) {
      insertionIndex++;
    }

    if (insertionIndex > 0) {
      const prev = schedule.assignedVisits[insertionIndex - 1];
      if (timeToMinutes(prev.endTime) > visitStartMinInternal) {
        console.log(`⚠️ CHRONOLOGICAL OVERLAP (PREV): ${schedule.employeeName} at ${prev.endTime} overlaps new visit at ${adjustedVisit.startTime}`);
        continue;
      }
    }
    if (insertionIndex < schedule.assignedVisits.length) {
      const next = schedule.assignedVisits[insertionIndex];
      if (visitStartMinInternal + adjustedVisit.durationMinutes > timeToMinutes(next.startTime)) {
        console.log(`⚠️ CHRONOLOGICAL OVERLAP (NEXT): ${schedule.employeeName} at ${adjustedVisit.endTime} overlaps next visit at ${next.startTime}`);
        continue;
      }
    }

    // Update matchScore with the correctly calculated insertion index
    (matchScore as any).insertionIndex = insertionIndex;

    // Add GH bonus to prioritize guaranteed hours employees
    let finalScore = isGHEmployee(schedule.employeeName)
      ? matchScore.score + GH_SCORE_BONUS
      : matchScore.score;

    // CRITICAL: Penalize if employee already has a visit at this exact time
    // OR if they already have a visit for the SAME client on this day
    const existingVisitConflict = schedule.assignedVisits.find(v => {
      const vStart = timeToMinutes(v.startTime);
      const vEnd = timeToMinutes(v.endTime);
      const visitStart = timeToMinutes(adjustedVisit.startTime);
      const visitEnd = timeToMinutes(adjustedVisit.endTime);

      // Strict overlap check: No overlapping visits allowed
      return (visitStart < vEnd && visitEnd > vStart);
    });

    if (existingVisitConflict) {
      console.log(`⚠️ STRICT TIME CONFLICT: ${schedule.employeeName} already has visit at ${adjustedVisit.startTime}-${adjustedVisit.endTime}`);
      continue; // Strictly skip this employee
    }

    // Add early visit bonus for first visits (prioritize starting early and near home)
    if (schedule.assignedVisits.length === 0) {
      // First visit - bonus for early morning (before 10am)
      if (visitStartMinInternal < 600) { // Before 10am
        finalScore += 0.3; // Strong bonus for early starts
      }
      // Also bonus for proximity to home (already in matchScore but emphasize it)
      const distFromHome = getTravelMinutes(
        { lat: schedule.homeLat, lng: schedule.homeLng },
        { lat: adjustedVisit.lat || 0, lng: adjustedVisit.lng || 0 },
        schedule.transportMode,
        visitStartMinInternal // Pass start time for congestion multiplier
      );
      if (distFromHome < 15) { // Within 15 minutes of home
        finalScore += 0.2; // Bonus for starting near home
      }
    }

    // Add evening visit bonus for GH employees (helps fill their hours)
    const isEveningVisit = visitStartMinInternal >= 1020; // After 5pm
    if (isGHEmployee(schedule.employeeName) && isEveningVisit) {
      finalScore += GH_EVENING_BONUS; // Increased bonus
      console.log(`🌙 EVENING GH BONUS: ${schedule.employeeName} gets +${GH_EVENING_BONUS} for evening visit ${adjustedVisit.clientName}`);
    }
    candidates.push({
      employeeName: schedule.employeeName,
      score: finalScore,
      insertionIndex: (matchScore as any).insertionIndex,
      travelFromPrev: matchScore.travelFromPrev,
      travelToNext: matchScore.travelToNext,
      adjustedVisit,
    });
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
  const visitStartMinForTravel = timeToMinutes(best.adjustedVisit.startTime);
  if (best.insertionIndex === 0) {
    // First visit - calculate from home location
    actualTravelTimeBefore = getTravelMinutes(
      { lat: schedule.homeLat, lng: schedule.homeLng },
      { lat: best.adjustedVisit.lat || 0, lng: best.adjustedVisit.lng || 0 },
      schedule.transportMode,
      visitStartMinForTravel // Pass start time for congestion multiplier
    );
    console.log(`🏠 First visit travel calc: home(${schedule.homeLat}, ${schedule.homeLng}) → ${best.adjustedVisit.clientName}(${best.adjustedVisit.lat}, ${best.adjustedVisit.lng}) = ${actualTravelTimeBefore}min (${schedule.transportMode})`);
  } else {
    // Check if there's a large gap (90+ minutes) suggesting a home break
    const prevVisit = schedule.assignedVisits[best.insertionIndex - 1];
    const prevEndMin = timeToMinutes(prevVisit.endTime);
    const currentStartMin = timeToMinutes(best.adjustedVisit.startTime);
    const gapMinutes = currentStartMin - prevEndMin;

    if (gapMinutes >= 90) {
      // Large gap - employee goes home and returns
      const travelToHome = getTravelMinutes(
        { lat: prevVisit.lat || 0, lng: prevVisit.lng || 0 },
        { lat: schedule.homeLat, lng: schedule.homeLng },
        schedule.transportMode,
        prevEndMin // Use previous visit end time for travel home
      );
      const travelFromHome = getTravelMinutes(
        { lat: schedule.homeLat, lng: schedule.homeLng },
        { lat: best.adjustedVisit.lat || 0, lng: best.adjustedVisit.lng || 0 },
        schedule.transportMode,
        visitStartMinForTravel // Use visit start time for travel from home
      );

      actualTravelTimeBefore = travelFromHome;
      console.log(`🏠 Home break detected: ${prevVisit.clientName} → home (${travelToHome}min) + break (${gapMinutes - travelToHome - travelFromHome}min) + home → ${best.adjustedVisit.clientName} (${travelFromHome}min)`);
    }
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

  // CRITICAL: Verify chronological order before insertion
  const visitStartMin = timeToMinutes(assignedVisit.startTime);

  // Check previous visit doesn't start after this one
  if (best.insertionIndex > 0) {
    const prevVisit = schedule.assignedVisits[best.insertionIndex - 1];
    const prevStartMin = timeToMinutes(prevVisit.startTime);
    if (prevStartMin > visitStartMin) {
      console.error(`❌ CHRONOLOGICAL ERROR: Cannot insert ${assignedVisit.clientName} (${assignedVisit.startTime}) after ${prevVisit.clientName} (${prevVisit.startTime})`);
      return { success: false, reason: 'Would break chronological order (previous visit starts later)' };
    }
  }

  // Check next visit doesn't start before this one
  if (best.insertionIndex < schedule.assignedVisits.length) {
    const nextVisit = schedule.assignedVisits[best.insertionIndex];
    const nextStartMin = timeToMinutes(nextVisit.startTime);
    if (nextStartMin < visitStartMin) {
      console.error(`❌ CHRONOLOGICAL ERROR: Cannot insert ${assignedVisit.clientName} (${assignedVisit.startTime}) before ${nextVisit.clientName} (${nextVisit.startTime})`);
      return { success: false, reason: 'Would break chronological order (next visit starts earlier)' };
    }
  }

  // Debug logging for travel time
  if (best.insertionIndex === 0) {
    console.log(`✅ FIRST visit ${best.employeeName} → ${assignedVisit.clientName} @ ${assignedVisit.startTime}: ${assignedVisit.travelTimeBefore}min from home`);
  } else {
    const prevVisit = schedule.assignedVisits[best.insertionIndex - 1];
    console.log(`✅ Visit ${best.employeeName} → ${assignedVisit.clientName} @ ${assignedVisit.startTime}: ${assignedVisit.travelTimeBefore}min from ${prevVisit.clientName}`);
  }

    // Insert at the correct position
    schedule.assignedVisits.splice(best.insertionIndex, 0, assignedVisit);

    // CRITICAL: Ensure travelTimeBefore is not lost after sorting
    // Re-sort visits by start time to ensure chronological order is maintained
    schedule.assignedVisits.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

    // After sorting, we need to ensure the travel times reflect the new order
    // especially for the visit we just inserted and its neighbors
    schedule.assignedVisits.forEach((v, idx) => {
      const vStartMin = timeToMinutes(v.startTime);
      if (idx === 0) {
        v.travelTimeBefore = getTravelMinutes(
          { lat: schedule.homeLat, lng: schedule.homeLng },
          { lat: v.lat || 0, lng: v.lng || 0 },
          schedule.transportMode,
          vStartMin // Pass start time for congestion multiplier
        );
      } else {
        const prev = schedule.assignedVisits[idx - 1];
        const gap = vStartMin - timeToMinutes(prev.endTime);
        if (gap >= 90) {
          v.travelTimeBefore = getTravelMinutes(
            { lat: schedule.homeLat, lng: schedule.homeLng },
            { lat: v.lat || 0, lng: v.lng || 0 },
            schedule.transportMode,
            vStartMin // Pass start time for congestion multiplier
          );
        } else {
          v.travelTimeBefore = getTravelMinutes(
            { lat: prev.lat || 0, lng: prev.lng || 0 },
            { lat: v.lat || 0, lng: v.lng || 0 },
            schedule.transportMode,
            vStartMin // Pass start time for congestion multiplier
          );
        }
      }
    });

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
  // Input validation
  if (!visits || !Array.isArray(visits)) {
    console.error('❌ Invalid visits input - expected array');
    return {
      assignments: {},
      unallocated: [],
      metrics: {
        totalVisitsAssigned: 0,
        totalVisitsUnallocated: 0,
        averageTravelTimePerVisit: 0,
        employeesUtilized: 0,
      }
    };
  }

  if (!employees || !Array.isArray(employees)) {
    console.error('❌ Invalid employees input - expected array');
    return {
      assignments: {},
      unallocated: visits.map(v => ({ ...v, reason: 'No employees available' })),
      metrics: {
        totalVisitsAssigned: 0,
        totalVisitsUnallocated: visits.length,
        averageTravelTimePerVisit: 0,
        employeesUtilized: 0,
      }
    };
  }

  if (!weekDates || !Array.isArray(weekDates) || weekDates.length === 0) {
    console.error('❌ Invalid weekDates input - expected non-empty array');
    return {
      assignments: {},
      unallocated: visits.map(v => ({ ...v, reason: 'No valid dates provided' })),
      metrics: {
        totalVisitsAssigned: 0,
        totalVisitsUnallocated: visits.length,
        averageTravelTimePerVisit: 0,
        employeesUtilized: 0,
      }
    };
  }

  try {
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

    // Skip excluded service types
    if (isExcludedServiceType(visit.serviceType || '')) {
      console.log(`🚫 Excluding visit with excluded service type: ${visit.clientName} (${visit.serviceType})`);
      return false;
    }

    // Skip overnight visits (start date ≠ end date)
    if ((visit as any).crossesMidnight) {
      console.log(`🚫 Excluding overnight visit: ${visit.clientName} ${visit.startTime}-${visit.endTime} (crosses midnight)`);
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
          mode = 'public';
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

      // Extract gender from employee data (processed in pipeline.ts from CG Data)
      // Check multiple sources for gender data
      const gender = (emp as any).gender || undefined;

      // Log gender data for debugging
      if (!gender) {
        console.log(`⚠️ CLIENT SCHEDULER: No gender data for ${emp.employeeName}`);
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
        gender: gender, // Gender already processed from CG Data in pipeline.ts
      };
    });
  });

  // Track assigned visit IDs globally to ensure uniqueness
  const assignedVisitIds = new Set<string>();
  const unallocated: Array<ClientVisit & { reason: string }> = [];

  // Track which employees are assigned to each time slot (for multiple care)
  const visitEmployeeAssignments = new Map<string, Set<string>>(); // key -> Set of employee names

  // CRITICAL: Sort visits STRICTLY by start time (chronological order)
  // This ensures we assign visits in the order they occur during the day
  const sortedVisits = [...filteredVisits].sort((a, b) => {
    const aStart = timeToMinutes(a.startTime);
    const bStart = timeToMinutes(b.startTime);

    // Primary sort: by start time (earlier visits first)
    if (aStart !== bStart) {
      return aStart - bStart;
    }

    // Secondary sort: by priority if start times are equal
    return (b.priority || 1) - (a.priority || 1);
  });

  console.log(`📅 Sorted ${sortedVisits.length} visits chronologically by start time`);

  // Log first 5 visits to verify chronological order
  if (sortedVisits.length > 0) {
    console.log('📋 First 5 visits in chronological order:');
    sortedVisits.slice(0, 5).forEach((v, i) => {
      console.log(`  ${i + 1}. ${v.clientName} @ ${v.startTime}-${v.endTime}`);
    });
  }

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
  console.log(`\n🔄 SECOND PASS: Attempting to allocate ${unallocated.length} unallocated visits (sorted by duration)`);
  
  // CRITICAL: Sort second pass visits chronologically first, then by duration
  // This maintains chronological insertion order to prevent CHRONOLOGICAL ERRORs
  const secondPassVisits = [...unallocated].sort((a, b) => {
    const timeA = timeToMinutes(a.startTime);
    const timeB = timeToMinutes(b.startTime);
    if (timeA !== timeB) return timeA - timeB;
    return a.durationMinutes - b.durationMinutes;
  });

  let remainingUnallocated: Array<ClientVisit & { reason: string }> = [];

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

  console.log(`📊 Second pass results: ${unallocated.length - remainingUnallocated.length} assigned, ${remainingUnallocated.length} still unallocated`);

  // Third pass: RELAXED rules with geographic clustering
  // Group unallocated visits by location clusters and try to fit them with relaxed constraints
  if (remainingUnallocated.length > 0) {
    console.log(`\n🔄 THIRD PASS (RELAXED): Attempting ${remainingUnallocated.length} visits with relaxed time windows (+15min tolerance)`);
    
    const thirdPassUnallocated: Array<ClientVisit & { reason: string }> = [];
    
    // Sort by geographic clusters - group nearby visits together
    const clusteredVisits = clusterVisitsByLocation(remainingUnallocated);
    
    for (const visit of clusteredVisits) {
      const employeeSchedules = schedulesByDate[visit.date] || [];
      
      if (employeeSchedules.length === 0) {
        thirdPassUnallocated.push(visit);
        continue;
      }
      
      const visitKey = `${visit.clientName}-${visit.date}-${visit.startTime}-${visit.endTime}`;
      const alreadyAssignedEmployees = visitEmployeeAssignments.get(visitKey) || new Set<string>();
      const availableSchedules = employeeSchedules.filter(s => !alreadyAssignedEmployees.has(s.employeeName));
      
      if (availableSchedules.length === 0) {
        thirdPassUnallocated.push(visit);
        continue;
      }
      
      // Mark as relaxed pass for higher tolerance
      const relaxedVisit = { ...visit, _relaxedPass: true } as ClientVisit & { reason: string };
      const result = assignVisitToBestEmployee(relaxedVisit, availableSchedules, assignedVisitIds, weeklyUsedMap, schedulesByDate);
      
      if (result.success && result.employeeName) {
        if (!visitEmployeeAssignments.has(visitKey)) {
          visitEmployeeAssignments.set(visitKey, new Set());
        }
        visitEmployeeAssignments.get(visitKey)!.add(result.employeeName);
        console.log(`✅ [Relaxed] Assigned ${visit.clientName} to ${result.employeeName}`);
      } else {
        thirdPassUnallocated.push(visit);
      }
    }
    
    remainingUnallocated = thirdPassUnallocated;
    console.log(`📊 Third pass results: ${clusteredVisits.length - remainingUnallocated.length} assigned, ${remainingUnallocated.length} still unallocated`);
  }

  // Fourth pass: Try employees with ANY remaining capacity (very relaxed)
  if (remainingUnallocated.length > 0) {
    console.log(`\n🔄 FOURTH PASS (MAXIMUM EFFORT): Attempting ${remainingUnallocated.length} visits`);
    
    const fourthPassUnallocated: Array<ClientVisit & { reason: string }> = [];
    
    for (const visit of remainingUnallocated) {
      const employeeSchedules = schedulesByDate[visit.date] || [];
      
      // Find employees with ANY remaining capacity (even if contracted hours exceeded)
      const employeesWithCapacity = employeeSchedules.filter(s => {
        // Must not be already assigned to this exact time slot
        const visitKey = `${visit.clientName}-${visit.date}-${visit.startTime}-${visit.endTime}`;
        const alreadyAssignedEmployees = visitEmployeeAssignments.get(visitKey) || new Set<string>();
        if (alreadyAssignedEmployees.has(s.employeeName)) return false;
        
        // Check gender match
        if (!isGenderMatch(s.gender, visit.clientName)) return false;
        
        // Check if has time window that even partially overlaps
        const visitStart = timeToMinutes(visit.startTime);
        const visitEnd = timeToMinutes(visit.endTime);
        const hasPartialOverlap = s.windows.some(w => {
          const overlapStart = Math.max(visitStart, w.start - 20);
          const overlapEnd = Math.min(visitEnd, w.end + 20);
          return overlapEnd > overlapStart;
        });
        
        return hasPartialOverlap;
      });
      
      if (employeesWithCapacity.length === 0) {
        fourthPassUnallocated.push({ ...visit, reason: 'No employee with compatible availability' });
        continue;
      }
      
      const relaxedVisit = { ...visit, _relaxedPass: true } as ClientVisit & { reason: string };
      const result = assignVisitToBestEmployee(relaxedVisit, employeesWithCapacity, assignedVisitIds, weeklyUsedMap, schedulesByDate);
      
      if (result.success && result.employeeName) {
        const visitKey = `${visit.clientName}-${visit.date}-${visit.startTime}-${visit.endTime}`;
        if (!visitEmployeeAssignments.has(visitKey)) {
          visitEmployeeAssignments.set(visitKey, new Set());
        }
        visitEmployeeAssignments.get(visitKey)!.add(result.employeeName);
        console.log(`✅ [Maximum effort] Assigned ${visit.clientName} to ${result.employeeName}`);
      } else {
        fourthPassUnallocated.push({ ...visit, reason: result.reason || 'Could not fit in any schedule' });
      }
    }
    
    remainingUnallocated = fourthPassUnallocated;
    console.log(`📊 Fourth pass results: ${remainingUnallocated.length} still unallocated`);
  }

  // Final Pass: Chronological retry for anything remaining
  if (remainingUnallocated.length > 0) {
    console.log(`\n🔄 FINAL CHRONOLOGICAL PASS: Attempting ${remainingUnallocated.length} visits`);
    const finalUnallocated: Array<ClientVisit & { reason: string }> = [];
    const sortedFinal = [...remainingUnallocated].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
    
    for (const visit of sortedFinal) {
      const employeeSchedules = (schedulesByDate[visit.date] || []).filter(s => {
         const visitKey = `${visit.clientName}-${visit.date}-${visit.startTime}-${visit.endTime}`;
         const alreadyAssigned = visitEmployeeAssignments.get(visitKey) || new Set<string>();
         return !alreadyAssigned.has(s.employeeName) && isGenderMatch(s.gender, visit.clientName);
      });
      
      const relaxedVisit = { ...visit, _relaxedPass: true } as any;
      const result = assignVisitToBestEmployee(relaxedVisit, employeeSchedules, assignedVisitIds, weeklyUsedMap, schedulesByDate);
      
      if (result.success && result.employeeName) {
        const visitKey = `${visit.clientName}-${visit.date}-${visit.startTime}-${visit.endTime}`;
        if (!visitEmployeeAssignments.has(visitKey)) visitEmployeeAssignments.set(visitKey, new Set());
        visitEmployeeAssignments.get(visitKey)!.add(result.employeeName);
      } else {
        finalUnallocated.push(visit);
      }
    }
    remainingUnallocated = finalUnallocated;
  }

  // Update unallocated with only the visits that couldn't be assigned in any pass
  unallocated.length = 0;
  unallocated.push(...remainingUnallocated);

  // CRITICAL: Sort assigned visits chronologically one last time to prevent rendering errors
  Object.keys(schedulesByDate).forEach(date => {
    schedulesByDate[date].forEach(schedule => {
      schedule.assignedVisits.sort((a, b) => {
        const timeA = timeToMinutes(a.startTime);
        const timeB = timeToMinutes(b.startTime);
        return timeA - timeB;
      });
    });
  });

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
  } catch (error) {
    console.error('❌ Fatal error in generateWeeklySchedule:', error);
    return {
      assignments: {},
      unallocated: visits.map(v => ({ 
        ...v, 
        reason: `Scheduling error: ${error instanceof Error ? error.message : 'Unknown error'}` 
      })),
      metrics: {
        totalVisitsAssigned: 0,
        totalVisitsUnallocated: visits.length,
        averageTravelTimePerVisit: 0,
        employeesUtilized: 0,
      }
    };
  }
}