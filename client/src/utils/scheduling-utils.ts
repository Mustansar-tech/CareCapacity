// Scheduling utility functions for VRPTW optimization
import { clientLogger } from '@/lib/logger';

export const MAX_TRAVEL_TIME_MINUTES = 45;        // Car employees
export const MAX_TRAVEL_TIME_MINUTES_WALKER = 60; // Walker / public transport

// Travel time cache for memoization - improves performance significantly
const travelTimeCache = new Map<string, number>();
// Secondary time-keyed cache for walker/public departure-time pairs.
// Key: `${fromLat},${fromLng}-${toLat},${toLng}-${mode}-${timeMinutes}`
// Seeded with TravelTime results that carry a specific departure/arrival time.
const travelTimeCacheByTime = new Map<string, number>();

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

// No peak-time adjustments — travel times are flat for all times of day
export function getTimeOfDayMultiplier(_startTimeMinutes?: number): number {
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
  
  let baseTravelMinutes: number;
  let minTravelMinutes: number;
  
  if (mode === 'car') {
    const speedKmh = 35; // avg for care delivery including residential areas, parking, walking to door
    baseTravelMinutes = (roadDistanceKm / speedKmh) * 60;
    minTravelMinutes = 5;
  } else if (mode === 'public') {
    // Public transport: 15 km/h with 15 min overhead for bus wait/walk to stop
    const speedKmh = 15;
    const fixedOverheadMinutes = 15;
    baseTravelMinutes = (roadDistanceKm / speedKmh) * 60 + fixedOverheadMinutes;
    minTravelMinutes = 15;
  } else if (mode === 'walking') {
    // Actual pedestrian walking: 5 km/h, no fixed overhead, minimum 2 min
    const speedKmh = 5;
    baseTravelMinutes = (roadDistanceKm / speedKmh) * 60;
    minTravelMinutes = 2;
  } else {
    baseTravelMinutes = (roadDistanceKm / 35) * 60;
    minTravelMinutes = 5;
  }
  
  // Apply time-of-day congestion multiplier
  const congestionMultiplier = getTimeOfDayMultiplier(startTimeMinutes);
  const adjustedMinutes = baseTravelMinutes * congestionMultiplier;
  
  const finalMinutes = Math.max(minTravelMinutes, Math.round(adjustedMinutes));
  return finalMinutes;
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
    clientLogger.warn(`Invalid coordinates: from(${from.lat}, ${from.lng}) to(${to.lat}, ${to.lng})`);
    return 0;
  }

  // Check for zero coordinates (indicates missing geocoding)
  if ((fromLat === 0 && fromLng === 0) || (toLat === 0 && toLng === 0)) {
    return 0;
  }

  // For walker/public: check time-specific cache first when a time is given.
  // This ensures departure-time pairs (e.g., same route at 11:30 vs 17:45) return
  // the correct TravelTime value for that exact departure slot.
  if (mode !== 'car' && startTimeMinutes !== undefined) {
    const timeKey = `${fromLat.toFixed(4)},${fromLng.toFixed(4)}-${toLat.toFixed(4)},${toLng.toFixed(4)}-${mode}-${startTimeMinutes}`;
    const timeCached = travelTimeCacheByTime.get(timeKey);
    if (timeCached !== undefined) return timeCached;
  }

  // Cache key: route + mode only (no time band — travel times are flat all day)
  const cacheKey = `${fromLat.toFixed(4)},${fromLng.toFixed(4)}-${toLat.toFixed(4)},${toLng.toFixed(4)}-${mode}`;
  
  // Check general cache
  const cached = travelTimeCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  // Not in API-seeded cache:
  // - Car: ORS Matrix covers 100% of car routes. A cache miss means the pair was
  //   never requested or ORS failed — treat as unreachable so the scheduler skips it.
  // - Walker/public: TravelTime may have rate-limited or returned unreachable; fall
  //   back to Haversine estimate so the visit can still be assigned.
  if (mode === 'car') {
    travelTimeCache.set(cacheKey, 9999);
    return 9999;
  }

  // Walker / public fallback — Haversine heuristic
  const distKm = haversineDistance({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng });
  const heuristic = calculateTravelTime(distKm, mode, startTimeMinutes);
  travelTimeCache.set(cacheKey, heuristic);
  return heuristic;
}

// Clear travel time cache (call when starting new scheduling run)
export function clearTravelCache(): void {
  travelTimeCache.clear();
  travelTimeCacheByTime.clear();
}

// Seed the travel time cache with real road distances fetched from the backend.
// Travel times are flat (no peak-time adjustments), so one entry per route+mode.
export function seedTravelCache(
  entries: Array<{ fromLat: number; fromLng: number; toLat: number; toLng: number; mode: string; durationMinutes: number; timeMinutes?: number }>
): void {
  let seeded = 0;
  for (const entry of entries) {
    const fLat = Number(entry.fromLat).toFixed(4);
    const fLng = Number(entry.fromLng).toFixed(4);
    const tLat = Number(entry.toLat).toFixed(4);
    const tLng = Number(entry.toLng).toFixed(4);
    const mode = entry.mode as 'car' | 'walking' | 'public';
    const key = `${fLat},${fLng}-${tLat},${tLng}-${mode}`;
    travelTimeCache.set(key, entry.durationMinutes);
    // Also seed the time-keyed cache so same-route/different-departure-time pairs
    // can each return the correct value when looked up with their specific time.
    if (entry.timeMinutes !== undefined) {
      const timeKey = `${fLat},${fLng}-${tLat},${tLng}-${mode}-${entry.timeMinutes}`;
      travelTimeCacheByTime.set(timeKey, entry.durationMinutes);
    }
    seeded++;
  }
  console.log(`[Travel Cache] Seeded ${seeded} real-road entries (${travelTimeCache.size} total, ${travelTimeCacheByTime.size} time-keyed)`);
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

  clientLogger.log(`📋 Parsed "${windows}" into ${parsed.length} time windows:`,
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

const MAX_TRAVEL_CAP_MINUTES = 45;

export function isInsertionFeasible(
  visit: { start: number; end: number },
  prevVisit: { end: number; lat: number; lng: number } | null,
  nextVisit: { start: number; lat: number; lng: number } | null,
  visitLocation: { lat: number; lng: number },
  windows: TimeWindow[],
  mode: 'car' | 'walking' | 'public' = 'car'
): boolean {
  const hasWindowOverlap = windows.some(w => visit.start < w.end && visit.end > w.start);

  const isWithinWorkingHours = visit.start >= 360 && visit.end <= 1320;

  if (!hasWindowOverlap && !isWithinWorkingHours) {
    return false;
  }

  const COMPRESSION_ALLOWANCE = 15;
  
  if (prevVisit) {
    const travelFromPrev = getTravelMinutes(
      { lat: prevVisit.lat, lng: prevVisit.lng },
      visitLocation,
      mode
    );

    // If travel is unreachable (9999), the insertion is NOT feasible
    if (travelFromPrev >= 9999) {
      return false;
    }

    if (travelFromPrev > MAX_TRAVEL_CAP_MINUTES) {
      return false;
    }

    if (prevVisit.end + travelFromPrev > visit.start + COMPRESSION_ALLOWANCE) {
      return false;
    }
  }

  if (nextVisit) {
    const travelToNext = getTravelMinutes(
      visitLocation,
      { lat: nextVisit.lat, lng: nextVisit.lng },
      mode
    );

    // If travel is unreachable (9999), the insertion is NOT feasible
    if (travelToNext >= 9999) {
      return false;
    }

    if (travelToNext > MAX_TRAVEL_CAP_MINUTES) {
      return false;
    }

    if (visit.end + travelToNext > nextVisit.start + COMPRESSION_ALLOWANCE) {
      return false;
    }
  }

  return true;
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