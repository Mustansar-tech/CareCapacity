// Scheduling utility functions for VRPTW optimization

// Maximum travel time in minutes before a route is considered infeasible
export const MAX_TRAVEL_TIME_MINUTES = 45;

// Travel time cache for memoization - improves performance significantly
const travelTimeCache = new Map<string, number>();

// Convert HH:mm to minutes since midnight
// For overnight visits (e.g., 22:00-02:00), end time wraps to next day
export function timeToMinutes(time: string, allowNextDay: boolean = false): number {
  const [hours, minutes] = time.split(':').map(Number);
  const totalMinutes = hours * 60 + minutes;

  // If time is very early (0:00-6:00) and we're allowing next day interpretation,
  // add 24 hours to represent next day
  if (allowNextDay && hours >= 0 && hours < 6) {
    return totalMinutes + (24 * 60);
  }

  return totalMinutes;
}

// Convert minutes since midnight to HH:MM format
export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

// Calculate Haversine distance between two lat/lng points in kilometers
export function haversineDistance(
  point1: { lat: number; lng: number },
  point2: { lat: number; lng: number }
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(point2.lat - point1.lat);
  const dLng = toRadians(point2.lng - point1.lng);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(point1.lat)) *
      Math.cos(toRadians(point2.lat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

// Get time-of-day congestion multiplier based on visit start time
export function getTimeOfDayMultiplier(startTimeMinutes?: number): number {
  if (startTimeMinutes === undefined) return 1.0; // Off-peak default
  
  const hours = startTimeMinutes / 60;
  
  // Morning peak (07:00–09:30): ×1.3
  if (hours >= 7 && hours < 9.5) return 1.3;
  
  // School run / evening (15:30–18:30): ×1.25
  if (hours >= 15.5 && hours < 18.5) return 1.25;
  
  // Off-peak: ×1.0
  return 1.0;
}

// Calculate travel time in minutes based on distance and transport mode
// Uses heuristic approach: Haversine distance × 1.2 road factor, mode-specific speeds
export function calculateTravelTime(
  distanceKm: number,
  mode: 'car' | 'walking' | 'public',
  startTimeMinutes?: number
): number {
  // Apply road distance inflation (straight-line × 1.2 for UK roads)
  const roadDistanceKm = distanceKm * 1.2;
  
  // Mode-specific speeds and minimums
  // Car: 32.5 km/h avg (30-35 range), min 5 min
  // Non-driver (public): 10 km/h effective to account for transfers and wait times, min 25 min overhead
  // Walking: avoid as main mode, but support at 4 km/h
  
  let baseTravelMinutes: number;
  let minTravelMinutes: number;
  
  if (mode === 'car') {
    const speedKmh = 32.5; // Urban/mixed average
    baseTravelMinutes = (roadDistanceKm / speedKmh) * 60;
    minTravelMinutes = 5;
  } else if (mode === 'public' || mode === 'walking') {
    // Treat both non-car modes as public transport proxy
    // Reduce effective speed to 10km/h (very realistic for city transit with stops)
    const speedKmh = 10; 
    // Increase fixed overhead to 25 minutes (walking to stop, waiting for bus/train, walking to client)
    const fixedOverheadMinutes = 25; 
    baseTravelMinutes = (roadDistanceKm / speedKmh) * 60 + fixedOverheadMinutes;
    // Set a higher floor for public transport travel
    minTravelMinutes = 30;
  } else {
    // Default to car
    baseTravelMinutes = (roadDistanceKm / 32.5) * 60;
    minTravelMinutes = 5;
  }
  
  // Apply time-of-day congestion multiplier
  const congestionMultiplier = getTimeOfDayMultiplier(startTimeMinutes);
  const adjustedMinutes = baseTravelMinutes * congestionMultiplier;
  
  // Enforce minimum travel time
  return Math.max(minTravelMinutes, Math.round(adjustedMinutes));
}

// Calculate travel time between two locations (with memoization)
// Uses heuristic: Haversine × 1.2 road factor, mode-specific speeds, time-of-day multipliers
export function getTravelMinutes(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  mode: 'car' | 'walking' | 'public' = 'car',
  startTimeMinutes?: number
): number {
  // Parse coordinates to ensure they are numbers
  const fromLat = Number(from.lat);
  const fromLng = Number(from.lng);
  const toLat = Number(to.lat);
  const toLng = Number(to.lng);

  // Validate coordinates
  if (!Number.isFinite(fromLat) || !Number.isFinite(fromLng) ||
      !Number.isFinite(toLat) || !Number.isFinite(toLng)) {
    console.warn(`Invalid coordinates: from(${from.lat}, ${from.lng}) to(${to.lat}, ${to.lng})`);
    return 0;
  }

  // Check for zero coordinates (indicates missing geocoding)
  if ((fromLat === 0 && fromLng === 0) || (toLat === 0 && toLng === 0)) {
    return 0;
  }

  // Create cache key with rounded coordinates, mode, and time band for better hit rate
  const timeBand = startTimeMinutes !== undefined ? Math.floor(startTimeMinutes / 60) : 'offpeak';
  const cacheKey = `${fromLat.toFixed(4)},${fromLng.toFixed(4)}-${toLat.toFixed(4)},${toLng.toFixed(4)}-${mode}-${timeBand}`;
  
  // Check cache first
  const cached = travelTimeCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  // Calculate Haversine (straight-line) distance
  const straightLineKm = haversineDistance(
    { lat: fromLat, lng: fromLng },
    { lat: toLat, lng: toLng }
  );

  // Use heuristic calculation with road factor, mode speeds, and time-of-day multiplier
  const finalTravelMinutes = calculateTravelTime(straightLineKm, mode, startTimeMinutes);

  // Store in cache
  travelTimeCache.set(cacheKey, finalTravelMinutes);

  return finalTravelMinutes;
}

// Clear travel time cache (call when starting new scheduling run)
export function clearTravelCache(): void {
  travelTimeCache.clear();
}

// Parse time windows from string format "HH:MM-HH:MM" or array of such strings
// Handles formats like "09:15-10:30; 12:30-16:15" or ["09:15-10:30", "12:30-16:15"]
export interface TimeWindow {
  start: number; // minutes since midnight
  end: number;   // minutes since midnight
}

export function parseTimeWindows(windows: string | string[]): TimeWindow[] {
  let windowArray: string[];

  if (Array.isArray(windows)) {
    windowArray = windows;
  } else if (typeof windows === 'string') {
    // Split by semicolon or comma to handle multiple windows in one string
    windowArray = windows.split(/[;,]/).map(w => w.trim()).filter(w => w);
  } else {
    return [];
  }

  const parsed = windowArray
    .filter(w => w && typeof w === 'string')
    .map(w => {
      const match = w.match(/(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/);
      if (!match) return null;
      // Use allowNextDay=true for the end time of the window if it's in the early hours
      // This handles cases where a window might end at 02:00, implying it's on the next day
      const startTime = timeToMinutes(match[1]);
      const endTime = timeToMinutes(match[2], match[2].startsWith('0') || parseInt(match[2].split(':')[0]) < 6);
      return {
        start: startTime,
        end: endTime,
      };
    })
    .filter((w): w is TimeWindow => w !== null);

  console.log(`📋 Parsed "${windows}" into ${parsed.length} time windows:`,
    parsed.map(w => `${minutesToTime(w.start)}-${minutesToTime(w.end)}`).join(', '));

  return parsed;
}

// Check if a time range overlaps with any of the given windows
export function hasTimeOverlap(
  visitStart: number,
  visitEnd: number,
  windows: TimeWindow[]
): boolean {
  return windows.some(w => visitStart < w.end && visitEnd > w.start);
}

// Check if a visit fits entirely within at least one availability window
export function fitsInWindow(
  visitStart: number,
  visitEnd: number,
  windows: TimeWindow[]
): boolean {
  return windows.some(w => visitStart >= w.start && visitEnd <= w.end);
}

// Check if inserting a visit between two existing visits is feasible
// VERY LENIENT - allows large gaps, focuses on physical feasibility
export function isInsertionFeasible(
  visit: { start: number; end: number },
  prevVisit: { end: number; lat: number; lng: number } | null,
  nextVisit: { start: number; lat: number; lng: number } | null,
  visitLocation: { lat: number; lng: number },
  windows: TimeWindow[],
  mode: 'car' | 'walking' | 'public' = 'car'
): boolean {
  // LENIENT window check - allow if visit has ANY overlap with windows
  const hasWindowOverlap = windows.some(w => visit.start < w.end && visit.end > w.start);

  // If no overlap at all, check if within working hours (6am-10pm / 22:00)
  const isWithinWorkingHours = visit.start >= 360 && visit.end <= 1320; // 6am to 10pm

  if (!hasWindowOverlap && !isWithinWorkingHours) {
    return false; // Visit completely outside reasonable time
  }

  // Special allowance for evening visits (5pm-10pm) - critical for GH capacity
  const isEveningVisit = visit.start >= 1020 && visit.end <= 1320; // 5pm to 10pm
  if (isEveningVisit) {
    return true; // Evening visits are always feasible for capacity filling
  }

  // Check time constraint with previous visit (only check if there's enough time to travel)
  // ALLOW LARGE GAPS - employee can have free time
  if (prevVisit) {
    const travelFromPrev = getTravelMinutes(
      { lat: prevVisit.lat, lng: prevVisit.lng },
      visitLocation,
      mode
    );

    if (prevVisit.end + travelFromPrev > visit.start) {
      return false; // Not enough time to travel from previous visit
    }

    // REMOVED: No penalty for large gaps - they're acceptable
  }

  // Check time constraint with next visit (only check if there's enough time to travel)
  // ALLOW LARGE GAPS - employee can have free time
  if (nextVisit) {
    const travelToNext = getTravelMinutes(
      visitLocation,
      { lat: nextVisit.lat, lng: nextVisit.lng },
      mode
    );

    if (visit.end + travelToNext > nextVisit.start) {
      return false; // Not enough time to travel to next visit
    }

    // REMOVED: No penalty for large gaps - they're acceptable
  }

  return true; // Visit is feasible - gaps are OK
}

// Calculate the gap/slack when inserting a visit
export function calculateInsertionGap(
  visit: { start: number; end: number },
  prevVisit: { end: number } | null,
  nextVisit: { start: number } | null,
  travelFromPrev: number,
  travelToNext: number
): number {
  let gap = 0;

  if (prevVisit) {
    gap += visit.start - (prevVisit.end + travelFromPrev);
  }

  if (nextVisit) {
    gap += nextVisit.start - (visit.end + travelToNext);
  }

  return gap;
}