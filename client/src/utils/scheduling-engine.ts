// VRPTW Weekly Scheduling Engine with proper constraints
import { clientLogger } from '@/lib/logger';
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
import {
  isWithinWalkingProximity,
  scoreWalkerMatch,
  getWalkableVisits,
  haversineDistance,
  WALKING_TRAVEL_DISPLAY_MINUTES,
  type WalkerCandidate,
  type VisitWithLocation
} from './walker-proximity';

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
const TIME_FLEXIBILITY_MINUTES = 10; // Increased to allow more flexibility

// Relaxed pass tolerances
const RELAXED_TIME_TOLERANCE = 20; // Increased for maximum coverage

// GH (Guaranteed Hours) bonus for prioritization
const GH_SCORE_BONUS = 0.45;

// Maximum daily care hours per CP (excluding travel/waiting)
const MAX_DAILY_CARE_HOURS = 9;
const MAX_DAILY_CARE_MINUTES = MAX_DAILY_CARE_HOURS * 60;

// Evening bonus for GH staff
const GH_EVENING_BONUS = 0.35; 

// Scoring weights (optimized for MAXIMUM VISIT COVERAGE)
// Prioritize filling as many visits as possible over travel efficiency
const WEIGHTS = {
  tightness: 0.10,      // Some weight for tight scheduling
  travelAdded: 0.25,    // Reduced - travel distance matters less than coverage
  windowSlack: 0.40,    // High weight - prefer visits that fit well in windows
  homeProximity: 0.25,  // Prefer routes near home but don't reject far ones
};

// Check if employee has Guaranteed Hours (GH in name)
// Matches patterns like: (GH), (30GH), (37.5GH), (16GH), (GH 30), etc.
function isGHEmployee(employeeName: string): boolean {
  const upper = employeeName.toUpperCase();
  // Match any pattern with GH and optionally numbers: (30GH), (GH), (37.5GH), (GH 30), etc.
  return /\(\d*\.?\d*\s*GH\s*\d*\.?\d*\)/.test(upper) || upper.includes('(GH)');
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

// Statutory rest breaks configuration
const BREAK_THRESHOLD_MINUTES = 5 * 60; // 5 hours
const BREAK_DURATION_MINUTES = 30; // 30 minutes

// Check if adding a visit would exceed capacity, daily limit, weekly hours, or requires a break
function wouldExceedCapacity(
  schedule: EmployeeDaySchedule,
  visitDurationMinutes: number
): boolean {
  const newTotalCareTime = schedule.usedCapacityMinutes + visitDurationMinutes;
  const newWeeklyTotal = schedule.weeklyUsedMinutes + visitDurationMinutes;

  // Check against weekly contracted hours first (with 30-minute tolerance to reduce wastage)
  const WEEKLY_TOLERANCE_MINUTES = 30; // Allow 0.5h over contracted hours
  if (newWeeklyTotal > schedule.weeklyContractedMinutes + WEEKLY_TOLERANCE_MINUTES) {
    clientLogger.log(`⚠️ ${schedule.employeeName}: Would exceed weekly hours (${(newWeeklyTotal/60).toFixed(1)}h > ${(schedule.weeklyContractedMinutes/60).toFixed(1)}h + 0.5h buffer)`);
    return true;
  }

  // Check against 9-hour daily limit
  if (newTotalCareTime > MAX_DAILY_CARE_MINUTES) {
    clientLogger.log(`⚠️ ${schedule.employeeName}: Would exceed 9-hour daily limit (${newTotalCareTime}min > ${MAX_DAILY_CARE_MINUTES}min)`);
    return true;
  }

  // Check against available daily capacity
  // We subtract the potential break duration from total capacity if threshold is reached
  const effectiveCapacity = newTotalCareTime >= BREAK_THRESHOLD_MINUTES 
    ? schedule.totalCapacityMinutes - BREAK_DURATION_MINUTES
    : schedule.totalCapacityMinutes;

  if (newTotalCareTime > effectiveCapacity) {
    clientLogger.log(`⚠️ ${schedule.employeeName}: Would exceed capacity with break considerations (${newTotalCareTime}min > ${effectiveCapacity}min)`);
    return true;
  }

  return false;
}

// Inject statutory breaks into a completed daily schedule
function injectStatutoryBreaks(schedule: EmployeeDaySchedule): void {
  if (schedule.assignedVisits.length < 2) return;
  if (schedule.usedCapacityMinutes < BREAK_THRESHOLD_MINUTES) return;

  // Find the best gap for a 30-minute break after ~5 hours of work
  let runningWorkMinutes = 0;
  let breakInjected = false;

  for (let i = 0; i < schedule.assignedVisits.length - 1; i++) {
    const currentVisit = schedule.assignedVisits[i];
    const nextVisit = schedule.assignedVisits[i + 1];
    
    runningWorkMinutes += currentVisit.durationMinutes;

    // If we've worked enough, look for a gap
    if (runningWorkMinutes >= BREAK_THRESHOLD_MINUTES && !breakInjected) {
      const currentEnd = timeToMinutes(currentVisit.endTime);
      const nextStart = timeToMinutes(nextVisit.startTime);
      const travelTime = nextVisit.travelTimeBefore || 0;
      
      // Calculate pure rest gap (Total gap between visits - travel time)
      const pureRestGap = nextStart - currentEnd - travelTime;

      if (pureRestGap >= BREAK_DURATION_MINUTES) {
        // We found a natural gap! Mark it as a break
        clientLogger.log(`✅ ${schedule.employeeName}: Statutory break accommodated in ${pureRestGap}min pure rest gap after ${runningWorkMinutes}min work`);
        breakInjected = true;
        break;
      }
    }
  }

  // If no natural gap was found but threshold was reached, the scheduler 
  // should have theoretically prevented this via wouldExceedCapacity
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

    clientLogger.log(`🌙 Checking overnight visit fit: ${visit.clientName} ${visitStart}min to ${visitEnd}min`);

    // Check if employee has availability that can accommodate the overnight visit
    const hasLateWindow = windows.some(w => w.end >= visitStart && w.end >= 1380); // Works late (after 11pm)
    const hasEarlyWindow = windows.some(w => w.start <= (visitEnd - 1440) && w.start <= 180); // Starts early (before 3am)

    if (hasLateWindow && hasEarlyWindow) {
      return visit; // Can accommodate overnight visit
    }

    clientLogger.log(`⚠️ ${visit.clientName}: Overnight visit doesn't fit (needs late + early availability)`);
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
    clientLogger.log(`🌙 Overnight visit: ${visit.clientName} ${visit.startTime}-${visit.endTime} → ${startMin}min to ${endMin}min (crosses midnight)`);
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
    clientLogger.log(`⚠️ STRICT: Employee has no gender data - cannot serve ${clientName} (requires ${preference})`);
    return false; // STRICT: Reject when employee gender is unknown but client has preference
  }

  const empGenderLower = employeeGender.toLowerCase();
  // Ensure we match 'female' or 'male' accurately
  const isFemale = empGenderLower === 'female' || empGenderLower === 'f';
  const isMale = empGenderLower === 'male' || empGenderLower === 'm';

  if (preference === 'female') {
    if (!isFemale) clientLogger.log(`⚠️ Gender mismatch: Employee (${empGenderLower}) cannot serve ${clientName} (requires female)`);
    return isFemale;
  }

  if (preference === 'male') {
    if (!isMale) clientLogger.log(`⚠️ Gender mismatch: Employee (${empGenderLower}) cannot serve ${clientName} (requires male)`);
    return isMale;
  }

  return true;
}

// ============================================================================
// WALKER-FIRST PROXIMITY-BASED ASSIGNMENT
// ============================================================================
// Walking employees use PROXIMITY RULES instead of travel time calculations.
// This is a deliberate design choice for reliability:
// - Walk times are highly variable (terrain, weather, fitness)
// - Public transport APIs are unreliable without live data
// - Walkers realistically serve only their local area
//
// PROXIMITY RULES:
// - Same postcode sector = definitely walkable
// - Within 1.5km = likely walkable (~15 min walk)
// - Outside these bounds = not suitable for walkers
// ============================================================================

function tryAssignVisitToWalker(
  visit: ClientVisit,
  walkerSchedules: EmployeeDaySchedule[],
  assignedVisitIds: Set<string>,
  weeklyUsedMap: Map<string, number>,
  visitEmployeeAssignments: Map<string, Set<string>>
): { success: boolean; employeeName?: string; reason?: string } {
  // Skip if already assigned
  if (assignedVisitIds.has(visit.id)) {
    return { success: false, reason: 'Already assigned' };
  }

  // Skip if no location data
  if (!visit.lat || !visit.lng) {
    return { success: false, reason: 'No location data' };
  }

  // Check multiple care constraints
  const visitKey = `${visit.clientName}-${visit.date}-${visit.startTime}-${visit.endTime}`;
  const alreadyAssignedEmployees = visitEmployeeAssignments.get(visitKey) || new Set<string>();

  // Convert visit to walker-compatible format
  const walkerVisit: VisitWithLocation = {
    id: visit.id,
    clientName: visit.clientName,
    lat: Number(visit.lat),
    lng: Number(visit.lng),
    postcode: (visit as any).postcode,
    startTime: visit.startTime,
    endTime: visit.endTime,
    durationMinutes: visit.durationMinutes,
    date: visit.date,
  };

  // Score each walker for this visit
  const candidates: Array<{
    schedule: EmployeeDaySchedule;
    score: number;
    distanceKm: number;
  }> = [];

  for (const schedule of walkerSchedules) {
    // Skip if already assigned to this time slot
    if (alreadyAssignedEmployees.has(schedule.employeeName)) continue;

    // Check gender preference match
    if (!isGenderMatch(schedule.gender, visit.clientName)) continue;

    // Check capacity constraints
    const newDailyCare = schedule.usedCapacityMinutes + visit.durationMinutes;
    if (newDailyCare > MAX_DAILY_CARE_MINUTES) continue;
    if (wouldExceedCapacity(schedule, visit.durationMinutes)) continue;

    // Check if visit fits in any window
    const visitStartMin = timeToMinutes(visit.startTime);
    const visitEndMin = timeToMinutes(visit.endTime);
    const fitsWindow = schedule.windows.some(w =>
      visitStartMin >= w.start - 5 && visitEndMin <= w.end + 5
    );
    if (!fitsWindow) continue;

    // Create walker candidate
    const walkerCandidate: WalkerCandidate = {
      employeeName: schedule.employeeName,
      homeLat: schedule.homeLat,
      homeLng: schedule.homeLng,
      homePostcode: (schedule as any).homePostcode,
      date: schedule.date,
      capacityMinutes: schedule.totalCapacityMinutes,
      usedMinutes: schedule.usedCapacityMinutes,
      weeklyContractedMinutes: schedule.weeklyContractedMinutes,
      weeklyUsedMinutes: schedule.weeklyUsedMinutes,
    };

    // Check proximity using walker rules (NOT travel time)
    if (!isWithinWalkingProximity(walkerCandidate, walkerVisit)) continue;

    // Score the match
    const score = scoreWalkerMatch(walkerCandidate, walkerVisit);
    if (score <= 0) continue;

    const distanceKm = haversineDistance(
      schedule.homeLat,
      schedule.homeLng,
      walkerVisit.lat,
      walkerVisit.lng
    );

    candidates.push({ schedule, score, distanceKm });
  }

  if (candidates.length === 0) {
    return { success: false, reason: 'No walkers within proximity' };
  }

  // Sort by score descending (closest/best matches first)
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  // Check chronological order if walker already has visits
  const visitStartMin = timeToMinutes(visit.startTime);
  if (best.schedule.assignedVisits.length > 0) {
    // Find correct insertion index
    let insertionIndex = 0;
    for (let i = 0; i < best.schedule.assignedVisits.length; i++) {
      const existingStart = timeToMinutes(best.schedule.assignedVisits[i].startTime);
      if (visitStartMin > existingStart) {
        insertionIndex = i + 1;
      }
    }

    // Check if insertion would break chronological order
    if (insertionIndex > 0) {
      const prevVisit = best.schedule.assignedVisits[insertionIndex - 1];
      const prevEndMin = timeToMinutes(prevVisit.endTime);
      if (visitStartMin < prevEndMin) {
        return { success: false, reason: 'Would overlap with existing visit' };
      }
    }
    if (insertionIndex < best.schedule.assignedVisits.length) {
      const nextVisit = best.schedule.assignedVisits[insertionIndex];
      const visitEndMin = timeToMinutes(visit.endTime);
      const nextStartMin = timeToMinutes(nextVisit.startTime);
      if (visitEndMin > nextStartMin) {
        return { success: false, reason: 'Would overlap with next visit' };
      }
    }

    // Check if consecutive visits are walkable AND if there's enough gap time
    if (insertionIndex > 0) {
      const prevVisit = best.schedule.assignedVisits[insertionIndex - 1];
      const distFromPrev = haversineDistance(
        prevVisit.lat || best.schedule.homeLat,
        prevVisit.lng || best.schedule.homeLng,
        walkerVisit.lat,
        walkerVisit.lng
      );
      
      // Check distance is within walking range (4km max)
      if (distFromPrev > 4) {
        return { success: false, reason: 'Too far from previous visit for walker (>4km)' };
      }
      
      // Walker travel time: public transport estimate (15 km/h + 12 min overhead, min 15 min)
      const walkTimeFromPrev = Math.max(15, Math.ceil((distFromPrev * 1.2 / 15) * 60 + 12));
      const prevEndMin = timeToMinutes(prevVisit.endTime);
      const gapMinutes = visitStartMin - prevEndMin;
      
      // Need at least walk time + 5 min buffer
      if (gapMinutes < walkTimeFromPrev + 5) {
        return { success: false, reason: `Gap too short for walk: ${gapMinutes}min gap, need ${walkTimeFromPrev + 5}min` };
      }
    }
  }

  // Calculate actual walking time from home or previous visit
  let actualWalkTime = 0;
  if (best.schedule.assignedVisits.length > 0) {
    // Find where this visit would be inserted
    let insertionIndex = 0;
    for (let i = 0; i < best.schedule.assignedVisits.length; i++) {
      if (visitStartMin > timeToMinutes(best.schedule.assignedVisits[i].startTime)) {
        insertionIndex = i + 1;
      }
    }
    
    if (insertionIndex > 0) {
      const prevVisit = best.schedule.assignedVisits[insertionIndex - 1];
      const distFromPrev = haversineDistance(
        prevVisit.lat || best.schedule.homeLat,
        prevVisit.lng || best.schedule.homeLng,
        walkerVisit.lat,
        walkerVisit.lng
      );
      // Walker travel time: public transport estimate (15 km/h + 12 min overhead, min 15 min)
      actualWalkTime = Math.max(15, Math.ceil((distFromPrev * 1.2 / 15) * 60 + 12));
    } else {
      // First visit - walk from home (public transport estimate)
      actualWalkTime = Math.max(15, Math.ceil((best.distanceKm * 1.2 / 15) * 60 + 12));
    }
  } else {
    // First visit - walk from home (public transport estimate)
    actualWalkTime = Math.max(15, Math.ceil((best.distanceKm * 1.2 / 15) * 60 + 12));
  }

  // Create assigned visit with actual calculated walk time
  const assignedVisit: AssignedVisit = {
    id: visit.id,
    clientName: visit.clientName,
    startTime: visit.startTime,
    endTime: visit.endTime,
    durationMinutes: visit.durationMinutes,
    lat: visit.lat,
    lng: visit.lng,
    travelTimeBefore: actualWalkTime,
    score: best.score,
  };

  // Insert in chronological order
  let insertIdx = 0;
  for (let i = 0; i < best.schedule.assignedVisits.length; i++) {
    if (timeToMinutes(best.schedule.assignedVisits[i].startTime) < visitStartMin) {
      insertIdx = i + 1;
    }
  }
  best.schedule.assignedVisits.splice(insertIdx, 0, assignedVisit);

  // Update tracking
  best.schedule.usedCapacityMinutes += visit.durationMinutes;
  best.schedule.weeklyUsedMinutes += visit.durationMinutes;
  weeklyUsedMap.set(best.schedule.employeeName, best.schedule.weeklyUsedMinutes);
  assignedVisitIds.add(visit.id);

  // Track for multiple care
  if (!visitEmployeeAssignments.has(visitKey)) {
    visitEmployeeAssignments.set(visitKey, new Set());
  }
  visitEmployeeAssignments.get(visitKey)!.add(best.schedule.employeeName);

  clientLogger.log(`🚶 WALKER ASSIGNED: ${best.schedule.employeeName} → ${visit.clientName} (${best.distanceKm.toFixed(2)}km, score: ${best.score.toFixed(2)})`);

  return { success: true, employeeName: best.schedule.employeeName };
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
      clientLogger.log(`⚠️ Gender mismatch: ${schedule.employeeName} (${schedule.gender || 'unknown'}) cannot serve ${originalVisit.clientName}`);
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

    // Travel limit removed - no hard cap on travel time to maximize visit coverage
    // Travel time is still factored into scoring (closer = higher score) but won't reject

    const visitStartMinInternal = timeToMinutes(adjustedVisit.startTime);

    // Verify this insertion doesn't overlap with neighbors
    // ALSO check if travel time is feasible within the gap
    let insertionIndex = 0;
    while (insertionIndex < schedule.assignedVisits.length && 
           timeToMinutes(schedule.assignedVisits[insertionIndex].startTime) <= visitStartMinInternal) {
      insertionIndex++;
    }

    // Travel feasibility checks with 15-minute compression allowance
    // Allow visits even if travel slightly exceeds the gap (employee can leave a bit early or arrive a bit late)
    const TRAVEL_COMPRESSION_ALLOWANCE = 15; // minutes of flexibility

    if (insertionIndex > 0) {
      const prev = schedule.assignedVisits[insertionIndex - 1];
      const travelFromPrev = getTravelMinutes(
        { lat: prev.lat || 0, lng: prev.lng || 0 },
        { lat: adjustedVisit.lat || 0, lng: adjustedVisit.lng || 0 },
        schedule.transportMode,
        timeToMinutes(prev.endTime)
      );

      if (travelFromPrev > 45) {
        continue;
      }

      const gap = visitStartMinInternal - timeToMinutes(prev.endTime);
      if (travelFromPrev > gap + TRAVEL_COMPRESSION_ALLOWANCE) {
        continue;
      }
    }

    if (insertionIndex < schedule.assignedVisits.length) {
      const next = schedule.assignedVisits[insertionIndex];
      const travelToNext = getTravelMinutes(
        { lat: adjustedVisit.lat || 0, lng: adjustedVisit.lng || 0 },
        { lat: next.lat || 0, lng: next.lng || 0 },
        schedule.transportMode,
        visitStartMinInternal + adjustedVisit.durationMinutes
      );

      if (travelToNext > 45) {
        continue;
      }

      const gap = timeToMinutes(next.startTime) - (visitStartMinInternal + adjustedVisit.durationMinutes);
      if (travelToNext > gap + TRAVEL_COMPRESSION_ALLOWANCE) {
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
      clientLogger.log(`⚠️ STRICT TIME CONFLICT: ${schedule.employeeName} already has visit at ${adjustedVisit.startTime}-${adjustedVisit.endTime}`);
      continue; // Strictly skip this employee
    }

    if (schedule.assignedVisits.length === 0) {
      const distFromHome = getTravelMinutes(
        { lat: schedule.homeLat, lng: schedule.homeLng },
        { lat: adjustedVisit.lat || 0, lng: adjustedVisit.lng || 0 },
        schedule.transportMode,
        visitStartMinInternal
      );
      if (distFromHome > 45) {
        continue;
      }
      if (visitStartMinInternal < 600) {
        finalScore += 0.3;
      }
      if (distFromHome < 15) {
        finalScore += 0.2;
      }
    }

    // Add evening visit bonus for GH employees (helps fill their hours)
    const isEveningVisit = visitStartMinInternal >= 1020; // After 5pm
    if (isGHEmployee(schedule.employeeName) && isEveningVisit) {
      finalScore += GH_EVENING_BONUS; // Increased bonus
      clientLogger.log(`🌙 EVENING GH BONUS: ${schedule.employeeName} gets +${GH_EVENING_BONUS} for evening visit ${adjustedVisit.clientName}`);
    }

    // Care continuity bonus: prefer same employee-client pairings across days
    const continuityMap = (originalVisit as any)._continuityMap as Map<string, Set<string>> | undefined;
    if (continuityMap) {
      const clientSet = continuityMap.get(schedule.employeeName);
      if (clientSet) {
        const normalizedClient = adjustedVisit.clientName.toLowerCase().trim();
        if (clientSet.has(normalizedClient)) {
          finalScore += 0.15;
          clientLogger.log(`🔄 CONTINUITY BONUS: ${schedule.employeeName} +15% for returning client ${adjustedVisit.clientName}`);
        } else {
          const clientArray = Array.from(clientSet);
          const fuzzyMatch = clientArray.find(c => normalizedClient.includes(c) || c.includes(normalizedClient));
          if (fuzzyMatch) {
            finalScore += 0.10;
          }
        }
      }
    }

    // Shift stability bonus: prefer compact back-to-back schedules
    if (schedule.assignedVisits.length > 0) {
      const sorted = [...schedule.assignedVisits].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
      const firstStart = timeToMinutes(sorted[0].startTime);
      const lastEnd = timeToMinutes(sorted[sorted.length - 1].endTime);
      const withinBlock = visitStartMinInternal >= firstStart && (visitStartMinInternal + adjustedVisit.durationMinutes) <= lastEnd;
      if (withinBlock) {
        finalScore += 0.10;
      } else {
        const existingSpan = lastEnd - firstStart;
        const newStart = Math.min(firstStart, visitStartMinInternal);
        const newEnd = Math.max(lastEnd, visitStartMinInternal + adjustedVisit.durationMinutes);
        const newSpan = newEnd - newStart;
        if (existingSpan > 0 && newSpan > 0) {
          finalScore += (existingSpan / newSpan) * 0.10;
        }
      }
    }

    // Rest break enforcement: 30-minute break after 5 hours of scheduled care work
    // Travel time does NOT count as rest - it must be subtracted from the gap
    let blockedByRestBreak = false;
    if (schedule.assignedVisits.length > 0) {
      const sorted = [...schedule.assignedVisits].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
      let cumulativeCareMinutes = 0;
      let breakTaken = false;

      for (let vi = 0; vi < sorted.length; vi++) {
        const v = sorted[vi];
        cumulativeCareMinutes += v.durationMinutes;

        // Check if a sufficient break gap existed between consecutive visits
        if (vi < sorted.length - 1) {
          const vEnd = timeToMinutes(v.endTime);
          const nextV = sorted[vi + 1];
          const nextStart = timeToMinutes(nextV.startTime);
          const rawGap = nextStart - vEnd;
          const travelInGap = nextV.travelTimeBefore || 0;
          const pureRest = rawGap - travelInGap;

          // If there was a genuine 30-min rest break, reset the counter
          if (pureRest >= BREAK_DURATION_MINUTES) {
            if (cumulativeCareMinutes >= BREAK_THRESHOLD_MINUTES) {
              breakTaken = true;
            }
            cumulativeCareMinutes = 0;
          }
        }
      }

      // After all existing visits, check if this new visit would violate the break rule
      if (cumulativeCareMinutes >= BREAK_THRESHOLD_MINUTES && !breakTaken) {
        // Employee has worked 5+ hours without a 30-min break
        // Check if the gap between last visit and this new visit provides enough rest
        const lastVisit = sorted[sorted.length - 1];
        const lastEnd = timeToMinutes(lastVisit.endTime);
        const rawGapToNew = visitStartMinInternal - lastEnd;

        // Calculate travel time from last visit to this new visit
        const travelToNew = getTravelMinutes(
          { lat: lastVisit.lat || 0, lng: lastVisit.lng || 0 },
          { lat: adjustedVisit.lat || 0, lng: adjustedVisit.lng || 0 },
          schedule.transportMode,
          lastEnd
        );
        const pureRestToNew = rawGapToNew - travelToNew;

        if (pureRestToNew < BREAK_DURATION_MINUTES) {
          const neededStart = lastEnd + travelToNew + BREAK_DURATION_MINUTES;
          clientLogger.log(`🛑 REST BREAK: ${schedule.employeeName} has worked ${(cumulativeCareMinutes/60).toFixed(1)}h - needs ${BREAK_DURATION_MINUTES}min break. Gap=${rawGapToNew}min, travel=${travelToNew}min, rest=${pureRestToNew}min. Visit ${adjustedVisit.clientName}@${adjustedVisit.startTime} blocked (earliest start: ${minutesToTime(neededStart)})`);
          blockedByRestBreak = true;
        }
      }

      // Also check: if adding this visit would push cumulative over threshold
      // and there's no break opportunity after it
      if (!blockedByRestBreak && (cumulativeCareMinutes + adjustedVisit.durationMinutes) >= BREAK_THRESHOLD_MINUTES) {
        // The visit itself would push over threshold - that's OK as long as
        // there will be a break after. We just log a warning.
        clientLogger.log(`⚠️ REST WATCH: ${schedule.employeeName} will reach ${((cumulativeCareMinutes + adjustedVisit.durationMinutes)/60).toFixed(1)}h after ${adjustedVisit.clientName} - break needed after this visit`);
      }
    }
    if (blockedByRestBreak) continue;

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
    clientLogger.log(`🏠 First visit travel calc: home(${schedule.homeLat}, ${schedule.homeLng}) → ${best.adjustedVisit.clientName}(${best.adjustedVisit.lat}, ${best.adjustedVisit.lng}) = ${actualTravelTimeBefore}min (${schedule.transportMode})`);
    
    if (actualTravelTimeBefore > 45) {
      clientLogger.log(`❌ REJECTED: Home-to-visit travel ${actualTravelTimeBefore}min exceeds 45-min cap for ${best.adjustedVisit.clientName}`);
      return { success: false, reason: `Home-to-visit travel ${actualTravelTimeBefore}min exceeds 45-min cap` };
    }
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
      clientLogger.log(`🏠 Home break detected: ${prevVisit.clientName} → home (${travelToHome}min) + break (${gapMinutes - travelToHome - travelFromHome}min) + home → ${best.adjustedVisit.clientName} (${travelFromHome}min)`);

      if (travelFromHome > 45) {
        clientLogger.log(`❌ REJECTED: Home-return travel ${travelFromHome}min exceeds 45-min cap for ${best.adjustedVisit.clientName}`);
        return { success: false, reason: `Home-return travel ${travelFromHome}min exceeds 45-min cap` };
      }
      if (travelToHome > 45) {
        clientLogger.log(`❌ REJECTED: Visit-to-home travel ${travelToHome}min exceeds 45-min cap`);
        return { success: false, reason: `Visit-to-home travel ${travelToHome}min exceeds 45-min cap` };
      }
    }
  }

  if (actualTravelTimeBefore > 45) {
    clientLogger.log(`❌ REJECTED: Between-visit travel ${actualTravelTimeBefore}min exceeds 45-min cap for ${best.adjustedVisit.clientName}`);
    return { success: false, reason: `Between-visit travel ${actualTravelTimeBefore}min exceeds 45-min cap` };
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
      clientLogger.error(`❌ CHRONOLOGICAL ERROR: Cannot insert ${assignedVisit.clientName} (${assignedVisit.startTime}) after ${prevVisit.clientName} (${prevVisit.startTime})`);
      return { success: false, reason: 'Would break chronological order (previous visit starts later)' };
    }
  }

  // Check next visit doesn't start before this one
  if (best.insertionIndex < schedule.assignedVisits.length) {
    const nextVisit = schedule.assignedVisits[best.insertionIndex];
    const nextStartMin = timeToMinutes(nextVisit.startTime);
    if (nextStartMin < visitStartMin) {
      clientLogger.error(`❌ CHRONOLOGICAL ERROR: Cannot insert ${assignedVisit.clientName} (${assignedVisit.startTime}) before ${nextVisit.clientName} (${nextVisit.startTime})`);
      return { success: false, reason: 'Would break chronological order (next visit starts earlier)' };
    }
  }

  // Debug logging for travel time
  if (best.insertionIndex === 0) {
    clientLogger.log(`✅ FIRST visit ${best.employeeName} → ${assignedVisit.clientName} @ ${assignedVisit.startTime}: ${assignedVisit.travelTimeBefore}min from home`);
  } else {
    const prevVisit = schedule.assignedVisits[best.insertionIndex - 1];
    clientLogger.log(`✅ Visit ${best.employeeName} → ${assignedVisit.clientName} @ ${assignedVisit.startTime}: ${assignedVisit.travelTimeBefore}min from ${prevVisit.clientName}`);
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
  clientLogger.log(`📊 ${best.employeeName}: ${careHoursUsed}h/${MAX_DAILY_CARE_HOURS}h daily | ${weeklyHoursUsed}h/${weeklyContracted}h weekly`);

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
    clientLogger.error('❌ Invalid visits input - expected array');
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
    clientLogger.error('❌ Invalid employees input - expected array');
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
    clientLogger.error('❌ Invalid weekDates input - expected non-empty array');
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
      clientLogger.log(`🚫 Excluding office visit: ${visit.clientName}`);
      return false;
    }

    // Skip secondary multiple care visits
    if (isSecondaryMultipleCare(visit.serviceType || '')) {
      clientLogger.log(`🚫 Excluding secondary multiple care visit: ${visit.clientName} (${visit.serviceType})`);
      return false;
    }

    // Skip excluded service types
    if (isExcludedServiceType(visit.serviceType || '')) {
      clientLogger.log(`🚫 Excluding visit with excluded service type: ${visit.clientName} (${visit.serviceType})`);
      return false;
    }

    // Skip overnight visits (start date ≠ end date)
    if ((visit as any).crossesMidnight) {
      clientLogger.log(`🚫 Excluding overnight visit: ${visit.clientName} ${visit.startTime}-${visit.endTime} (crosses midnight)`);
      return false;
    }

    // Skip if no location data
    if (!visit.lat || !visit.lng) {
      clientLogger.log(`🚫 Excluding visit without location: ${visit.clientName}`);
      return false;
    }

    return true;
  });

  clientLogger.log(`📊 Filtered visits: ${visits.length} → ${filteredVisits.length} (excluded ${visits.length - filteredVisits.length} visits)`);

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
    clientLogger.log(`👥 Found ${multipleCareKeys.length} multiple care visits (need 2 CPs):`);
    multipleCareKeys.forEach(([key, visits]) => {
      clientLogger.log(`   ${visits[0].clientName} @ ${visits[0].startTime}-${visits[0].endTime} (${visits.length} CPs needed)`);
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
      // IMPORTANT: 'walking' is kept as separate mode for proximity-based scheduling
      // Walkers use proximity rules (same postcode or ≤1.5km), NOT travel time calculations
      let mode: 'car' | 'walking' | 'public' = 'car';
      if (emp.transportMode) {
        const modeLower = emp.transportMode.toLowerCase();
        if (modeLower.includes('walk')) {
          mode = 'walking'; // Keep walkers separate - they use proximity logic
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
        clientLogger.log(`⚠️ CLIENT SCHEDULER: No gender data for ${emp.employeeName}`);
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

  // Build care continuity map: employee -> Set of client names they served on previous days
  // This enables continuity scoring (same employee serves same client across days)
  const continuityMap = new Map<string, Set<string>>();

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

  clientLogger.log(`📅 Sorted ${sortedVisits.length} visits chronologically by start time`);

  // Log first 5 visits to verify chronological order
  if (sortedVisits.length > 0) {
    clientLogger.log('📋 First 5 visits in chronological order:');
    sortedVisits.slice(0, 5).forEach((v, i) => {
      clientLogger.log(`  ${i + 1}. ${v.clientName} @ ${v.startTime}-${v.endTime}`);
    });
  }

  // ============================================================================
  // PHASE 0: WALKER-FIRST ASSIGNMENT (Proximity-based)
  // ============================================================================
  // Walking employees are assigned FIRST using proximity rules, NOT travel times.
  // This ensures walkers get local visits they can realistically serve.
  // Visits not assigned to walkers will fall through to car/public transport employees.
  // ============================================================================
  
  // Count walkers across all dates
  let totalWalkers = 0;
  let walkerAssignments = 0;
  
  for (const date of weekDates) {
    const allSchedules = schedulesByDate[date] || [];
    const walkerSchedules = allSchedules.filter(s => s.transportMode === 'walking');
    totalWalkers += walkerSchedules.length;
  }
  
  if (totalWalkers > 0) {
    clientLogger.log(`\n🚶 WALKER-FIRST PHASE: ${totalWalkers} walking employees across ${weekDates.length} days`);
    clientLogger.log('   Walkers use PROXIMITY rules (same postcode or ≤1.5km), NOT travel time calculations.');
    
    for (const visit of sortedVisits) {
      const allSchedules = schedulesByDate[visit.date] || [];
      const walkerSchedules = allSchedules.filter(s => s.transportMode === 'walking');
      
      if (walkerSchedules.length === 0) continue;
      
      const result = tryAssignVisitToWalker(
        visit,
        walkerSchedules,
        assignedVisitIds,
        weeklyUsedMap,
        visitEmployeeAssignments
      );
      
      if (result.success) {
        walkerAssignments++;
      }
    }
    
    clientLogger.log(`🚶 Walker phase complete: ${walkerAssignments} visits assigned to walkers`);
    clientLogger.log(`   Remaining ${sortedVisits.length - walkerAssignments} visits will be assigned to car/public transport employees.\n`);
  }

  // ============================================================================
  // PHASE 1-2: CAR/PUBLIC TRANSPORT ASSIGNMENT (Travel-time based)
  // ============================================================================
  // Non-walker employees handle remaining visits using travel time calculations.
  // GH employees are prioritized to fill their contracted hours.
  // ============================================================================

  // Process day-by-day for care continuity: earlier days build the continuity map for later days
  for (const date of weekDates) {
    const dayVisits = sortedVisits.filter(v => v.date === date);
    
    // Tag visits with the current continuity map (built from previous days)
    for (const visit of dayVisits) {
      (visit as any)._continuityMap = continuityMap;
    }

    // First pass: Assign each visit prioritizing GH employees
    for (const visit of dayVisits) {
      // Skip if already assigned by walker phase
      if (assignedVisitIds.has(visit.id)) continue;
      
      const employeeSchedules = schedulesByDate[visit.date] || [];

      if (employeeSchedules.length === 0) {
        unallocated.push({ ...visit, reason: 'No employees available for this date' });
        continue;
      }

      // Check if this is a multiple care visit (needs to avoid already assigned employee)
      const visitKey = `${visit.clientName}-${visit.date}-${visit.startTime}-${visit.endTime}`;
      const alreadyAssignedEmployees = visitEmployeeAssignments.get(visitKey) || new Set<string>();

      // Filter out employees already assigned to this exact time slot
      // Also filter out walkers (they only get proximity-based assignments)
      const availableSchedules = employeeSchedules.filter(s => 
        !alreadyAssignedEmployees.has(s.employeeName) && s.transportMode !== 'walking'
      );

      if (availableSchedules.length === 0) {
        unallocated.push({ ...visit, reason: 'All employees already assigned to this time slot (multiple care) or only walkers available' });
        continue;
      }

      // Separate GH and non-GH employees for two-phase allocation
      const ghEmployees = availableSchedules.filter(s => isGHEmployee(s.employeeName));
      
      // Calculate GH employees who still have unfilled contracted hours
      const ghWithCapacity = ghEmployees.filter(s => {
        const remaining = s.weeklyContractedMinutes - s.weeklyUsedMinutes;
        return remaining > 0;
      });

      // Phase 1: STRICT GH-FIRST - Try to assign to GH employees who need hours
      let result = ghWithCapacity.length > 0
        ? assignVisitToBestEmployee(visit, ghWithCapacity, assignedVisitIds, weeklyUsedMap, schedulesByDate)
        : { success: false, reason: 'No GH employees with remaining capacity' };

      // Phase 1b: If no GH with capacity, try all GH employees (they may still want visits)
      if (!result.success && ghEmployees.length > 0) {
        result = assignVisitToBestEmployee(visit, ghEmployees, assignedVisitIds, weeklyUsedMap, schedulesByDate);
      }

      // Phase 2: If not assigned to GH employee, try all (non-walker) employees
      if (!result.success) {
        result = assignVisitToBestEmployee(visit, availableSchedules, assignedVisitIds, weeklyUsedMap, schedulesByDate);
      }
      
      // Log GH assignment for tracking
      if (result.success && result.employeeName && isGHEmployee(result.employeeName)) {
        const schedule = availableSchedules.find(s => s.employeeName === result.employeeName);
        if (schedule) {
          const usedPct = schedule.weeklyContractedMinutes > 0 
            ? ((schedule.weeklyUsedMinutes / schedule.weeklyContractedMinutes) * 100).toFixed(0)
            : '0';
          clientLogger.log(`✅ GH ASSIGNED: ${result.employeeName} → ${visit.clientName} (${usedPct}% of contracted hours used)`);
        }
      }

      if (result.success && result.employeeName) {
        // Track this employee assignment for multiple care visits
        if (!visitEmployeeAssignments.has(visitKey)) {
          visitEmployeeAssignments.set(visitKey, new Set());
        }
        visitEmployeeAssignments.get(visitKey)!.add(result.employeeName);

        // Log multiple care assignments
        if (alreadyAssignedEmployees.size > 0) {
          clientLogger.log(`👥 Multiple care: ${visit.clientName} @ ${visit.startTime} - CP ${alreadyAssignedEmployees.size + 1}: ${result.employeeName}`);
        }
      } else {
        unallocated.push({ ...visit, reason: result.reason || 'Unknown reason' });
      }
    }

    // After each day's first pass, update continuity map with today's assignments
    const daySchedules = schedulesByDate[date] || [];
    for (const schedule of daySchedules) {
      // Finalize day schedule and inject breaks
      if (schedule.assignedVisits.length > 0) {
        schedule.assignedVisits.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
        injectStatutoryBreaks(schedule);
      }

      for (const av of schedule.assignedVisits) {
        const empName = schedule.employeeName;
        if (!continuityMap.has(empName)) {
          continuityMap.set(empName, new Set());
        }
        continuityMap.get(empName)!.add(av.clientName.toLowerCase().trim());
      }
    }
  }

  // Second pass: Try to allocate remaining visits by sorting them differently
  // Sort by visit duration (shorter visits first - easier to fit)
  clientLogger.log(`🔄 Care continuity map: ${continuityMap.size} employees with client pairings across ${weekDates.length} days`);

  clientLogger.log(`\n🔄 SECOND PASS: Attempting to allocate ${unallocated.length} unallocated visits (sorted by duration)`);
  
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

    // Also prioritize GH in second pass
    const ghSchedules = availableSchedules.filter(s => isGHEmployee(s.employeeName));
    const ghWithCapacity2 = ghSchedules.filter(s => s.weeklyContractedMinutes - s.weeklyUsedMinutes > 0);
    
    let result = ghWithCapacity2.length > 0
      ? assignVisitToBestEmployee(visit, ghWithCapacity2, assignedVisitIds, weeklyUsedMap, schedulesByDate)
      : { success: false };
    
    if (!result.success && ghSchedules.length > 0) {
      result = assignVisitToBestEmployee(visit, ghSchedules, assignedVisitIds, weeklyUsedMap, schedulesByDate);
    }
    
    if (!result.success) {
      result = assignVisitToBestEmployee(visit, availableSchedules, assignedVisitIds, weeklyUsedMap, schedulesByDate);
    }

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

  clientLogger.log(`📊 Second pass results: ${unallocated.length - remainingUnallocated.length} assigned, ${remainingUnallocated.length} still unallocated`);

  // Third pass: RELAXED rules with geographic clustering
  // Group unallocated visits by location clusters and try to fit them with relaxed constraints
  if (remainingUnallocated.length > 0) {
    clientLogger.log(`\n🔄 THIRD PASS (RELAXED): Attempting ${remainingUnallocated.length} visits with relaxed time windows (+15min tolerance)`);
    
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
      
      // GH-first in third pass too
      const ghSchedules3 = availableSchedules.filter(s => isGHEmployee(s.employeeName));
      const ghWithCapacity3 = ghSchedules3.filter(s => s.weeklyContractedMinutes - s.weeklyUsedMinutes > 0);
      
      let result = ghWithCapacity3.length > 0
        ? assignVisitToBestEmployee(relaxedVisit, ghWithCapacity3, assignedVisitIds, weeklyUsedMap, schedulesByDate)
        : { success: false };
      
      if (!result.success && ghSchedules3.length > 0) {
        result = assignVisitToBestEmployee(relaxedVisit, ghSchedules3, assignedVisitIds, weeklyUsedMap, schedulesByDate);
      }
      
      if (!result.success) {
        result = assignVisitToBestEmployee(relaxedVisit, availableSchedules, assignedVisitIds, weeklyUsedMap, schedulesByDate);
      }
      
      if (result.success && result.employeeName) {
        if (!visitEmployeeAssignments.has(visitKey)) {
          visitEmployeeAssignments.set(visitKey, new Set());
        }
        visitEmployeeAssignments.get(visitKey)!.add(result.employeeName);
        clientLogger.log(`✅ [Relaxed] Assigned ${visit.clientName} to ${result.employeeName}`);
      } else {
        thirdPassUnallocated.push(visit);
      }
    }
    
    remainingUnallocated = thirdPassUnallocated;
    clientLogger.log(`📊 Third pass results: ${clusteredVisits.length - remainingUnallocated.length} assigned, ${remainingUnallocated.length} still unallocated`);
  }

  // Fourth pass: Try employees with ANY remaining capacity (very relaxed)
  if (remainingUnallocated.length > 0) {
    clientLogger.log(`\n🔄 FOURTH PASS (MAXIMUM EFFORT): Attempting ${remainingUnallocated.length} visits`);
    
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
      
      // GH-first in fourth pass too
      const ghSchedules4 = employeesWithCapacity.filter(s => isGHEmployee(s.employeeName));
      const ghWithCapacity4 = ghSchedules4.filter(s => s.weeklyContractedMinutes - s.weeklyUsedMinutes > 0);
      
      let result = ghWithCapacity4.length > 0
        ? assignVisitToBestEmployee(relaxedVisit, ghWithCapacity4, assignedVisitIds, weeklyUsedMap, schedulesByDate)
        : { success: false };
      
      if (!result.success && ghSchedules4.length > 0) {
        result = assignVisitToBestEmployee(relaxedVisit, ghSchedules4, assignedVisitIds, weeklyUsedMap, schedulesByDate);
      }
      
      if (!result.success) {
        result = assignVisitToBestEmployee(relaxedVisit, employeesWithCapacity, assignedVisitIds, weeklyUsedMap, schedulesByDate);
      }
      
      if (result.success && result.employeeName) {
        const visitKey = `${visit.clientName}-${visit.date}-${visit.startTime}-${visit.endTime}`;
        if (!visitEmployeeAssignments.has(visitKey)) {
          visitEmployeeAssignments.set(visitKey, new Set());
        }
        visitEmployeeAssignments.get(visitKey)!.add(result.employeeName);
        clientLogger.log(`✅ [Maximum effort] Assigned ${visit.clientName} to ${result.employeeName}`);
      } else {
        fourthPassUnallocated.push({ ...visit, reason: result.reason || 'Could not fit in any schedule' });
      }
    }
    
    remainingUnallocated = fourthPassUnallocated;
    clientLogger.log(`📊 Fourth pass results: ${remainingUnallocated.length} still unallocated`);
  }

  // Final Pass: Chronological retry for anything remaining
  if (remainingUnallocated.length > 0) {
    clientLogger.log(`\n🔄 FINAL CHRONOLOGICAL PASS: Attempting ${remainingUnallocated.length} visits`);
    const finalUnallocated: Array<ClientVisit & { reason: string }> = [];
    const sortedFinal = [...remainingUnallocated].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
    
    for (const visit of sortedFinal) {
      const employeeSchedules = (schedulesByDate[visit.date] || []).filter(s => {
         const visitKey = `${visit.clientName}-${visit.date}-${visit.startTime}-${visit.endTime}`;
         const alreadyAssigned = visitEmployeeAssignments.get(visitKey) || new Set<string>();
         return !alreadyAssigned.has(s.employeeName) && isGenderMatch(s.gender, visit.clientName);
      });
      
      const relaxedVisit = { ...visit, _relaxedPass: true } as any;
      
      // GH-first in final pass too
      const ghSchedulesFinal = employeeSchedules.filter(s => isGHEmployee(s.employeeName));
      const ghWithCapacityFinal = ghSchedulesFinal.filter(s => s.weeklyContractedMinutes - s.weeklyUsedMinutes > 0);
      
      let result = ghWithCapacityFinal.length > 0
        ? assignVisitToBestEmployee(relaxedVisit, ghWithCapacityFinal, assignedVisitIds, weeklyUsedMap, schedulesByDate)
        : { success: false };
      
      if (!result.success && ghSchedulesFinal.length > 0) {
        result = assignVisitToBestEmployee(relaxedVisit, ghSchedulesFinal, assignedVisitIds, weeklyUsedMap, schedulesByDate);
      }
      
      if (!result.success) {
        result = assignVisitToBestEmployee(relaxedVisit, employeeSchedules, assignedVisitIds, weeklyUsedMap, schedulesByDate);
      }
      
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

  // Fifth pass: DESPERATION - allow unknown-gender employees to serve gendered clients
  // and use maximum time flexibility (30 min tolerance)
  if (remainingUnallocated.length > 0) {
    clientLogger.log(`\n🔄 FIFTH PASS (DESPERATION): Attempting ${remainingUnallocated.length} visits with gender relaxation`);
    const fifthPassUnallocated: Array<ClientVisit & { reason: string }> = [];
    
    for (const visit of remainingUnallocated) {
      const employeeSchedules = schedulesByDate[visit.date] || [];
      
      const visitKey = `${visit.clientName}-${visit.date}-${visit.startTime}-${visit.endTime}`;
      const alreadyAssigned = visitEmployeeAssignments.get(visitKey) || new Set<string>();
      
      // Allow ANY employee except those with explicit gender mismatch
      // Unknown gender employees CAN now serve gendered clients in desperation
      const availableEmployees = employeeSchedules.filter(s => {
        if (alreadyAssigned.has(s.employeeName)) return false;
        
        // Only reject explicit mismatches (male serving female-only client or vice versa)
        const preference = getClientGenderPreference(visit.clientName);
        if (preference && s.gender) {
          const empGender = s.gender.toLowerCase();
          if (preference === 'female' && (empGender === 'male' || empGender === 'm')) return false;
          if (preference === 'male' && (empGender === 'female' || empGender === 'f')) return false;
        }
        // Allow unknown gender employees through
        
        // Check daily limit
        const newCare = s.usedCapacityMinutes + visit.durationMinutes;
        if (newCare > MAX_DAILY_CARE_MINUTES + 60) return false; // Allow 1 hour over daily limit
        
        return true;
      });
      
      if (availableEmployees.length === 0) {
        fifthPassUnallocated.push({ ...visit, reason: 'No compatible employee available (all passes exhausted)' });
        continue;
      }
      
      const relaxedVisit = { ...visit, _relaxedPass: true } as any;
      
      // GH-first even in desperation
      const ghSchedules5 = availableEmployees.filter(s => isGHEmployee(s.employeeName));
      
      let result = ghSchedules5.length > 0
        ? assignVisitToBestEmployee(relaxedVisit, ghSchedules5, assignedVisitIds, weeklyUsedMap, schedulesByDate)
        : { success: false };
      
      if (!result.success) {
        result = assignVisitToBestEmployee(relaxedVisit, availableEmployees, assignedVisitIds, weeklyUsedMap, schedulesByDate);
      }
      
      if (result.success && result.employeeName) {
        if (!visitEmployeeAssignments.has(visitKey)) visitEmployeeAssignments.set(visitKey, new Set());
        visitEmployeeAssignments.get(visitKey)!.add(result.employeeName);
        clientLogger.log(`✅ [Desperation] Assigned ${visit.clientName} to ${result.employeeName}`);
      } else {
        fifthPassUnallocated.push({ ...visit, reason: 'Could not fit in any schedule after all passes' });
      }
    }
    
    remainingUnallocated = fifthPassUnallocated;
    clientLogger.log(`📊 Fifth pass results: ${remainingUnallocated.length} still unallocated`);
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
      // Inject statutory breaks after 5 hours of work
      injectStatutoryBreaks(schedule);
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

  // GH UTILIZATION SUMMARY
  clientLogger.log(`\n📊 === GH UTILIZATION SUMMARY ===`);
  let totalGHContracted = 0;
  let totalGHUsed = 0;
  const ghEmployeeStats: Array<{name: string; contracted: number; used: number; pct: number}> = [];
  
  weekDates.forEach(date => {
    const daySchedules = schedulesByDate[date] || [];
    daySchedules.forEach(schedule => {
      if (isGHEmployee(schedule.employeeName)) {
        // Only count each employee once per week (use first occurrence)
        const existing = ghEmployeeStats.find(s => s.name === schedule.employeeName);
        if (!existing) {
          const contracted = schedule.weeklyContractedMinutes;
          const used = weeklyUsedMap.get(schedule.employeeName) || 0;
          const pct = contracted > 0 ? (used / contracted) * 100 : 0;
          ghEmployeeStats.push({ name: schedule.employeeName, contracted, used, pct });
          totalGHContracted += contracted;
          totalGHUsed += used;
        }
      }
    });
  });
  
  ghEmployeeStats.sort((a, b) => b.pct - a.pct);
  ghEmployeeStats.forEach(stat => {
    const status = stat.pct >= 90 ? '✅' : stat.pct >= 70 ? '⚠️' : '❌';
    clientLogger.log(`  ${status} ${stat.name}: ${(stat.used/60).toFixed(1)}h / ${(stat.contracted/60).toFixed(1)}h (${stat.pct.toFixed(0)}%)`);
  });
  
  const overallGHPct = totalGHContracted > 0 ? (totalGHUsed / totalGHContracted) * 100 : 0;
  clientLogger.log(`\n  TOTAL GH: ${(totalGHUsed/60).toFixed(1)}h / ${(totalGHContracted/60).toFixed(1)}h (${overallGHPct.toFixed(0)}% utilization)`);
  clientLogger.log(`  GH LOSS: ${((totalGHContracted - totalGHUsed)/60).toFixed(1)}h unfilled`);
  clientLogger.log(`============================\n`);

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
    clientLogger.error('❌ Fatal error in generateWeeklySchedule:', error);
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