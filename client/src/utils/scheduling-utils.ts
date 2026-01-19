// Scheduling utility functions for VRPTW optimization

// Maximum travel time in minutes before a route is considered infeasible
// Set to 60 minutes for car mode to ensure fair scheduling and reduce mileage
export const MAX_TRAVEL_TIME_MINUTES = 60;

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

// Calculate travel time in minutes based on distance and transport mode
export function calculateTravelTime(
  distanceKm: number,
  mode: 'car' | 'walking' | 'public'
): number {
  // Speed assumptions (km/h)
  const speeds = {
    car: 40,      // Average urban driving speed
    walking: 4.5, // Average walking speed
    public: 25,   // Public transport average
  };

  const speed = speeds[mode] || speeds.car;
  const hours = distanceKm / speed;
  return Math.ceil(hours * 60); // Return minutes, rounded up
}

// Calculate travel time between two locations (with memoization)
export function getTravelMinutes(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  mode: 'car' | 'walking' | 'public' = 'car'
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

  // Create cache key with rounded coordinates for better hit rate
  const cacheKey = `${fromLat.toFixed(4)},${fromLng.toFixed(4)}-${toLat.toFixed(4)},${toLng.toFixed(4)}-${mode}`;
  
  // Check cache first
  const cached = travelTimeCache.get(cacheKey);
  if (cached !== undefined) {
    // Log ORS hits if they are in the cache
    if (cached > 0) {
      // We don't want to log every single hit, but this helps debug
      // console.log(`✅ Cache hit: ${cached} min`);
    }
    return cached;
  }

  const distanceKm = haversineDistance(
    { lat: fromLat, lng: fromLng },
    { lat: toLat, lng: toLng }
  );

  let finalTravelMinutes: number;

  if (mode === 'public') {
    // Realistic UK public transport calculation (matches backend logic)
    if (distanceKm < 1.0) {
      // Short distance (<1km) - just walk, no point taking a bus
      finalTravelMinutes = Math.max(2, Math.round((distanceKm / 4.0) * 60)); // 4 km/h walking
    } else {
      // Calculate realistic public transport journey:
      // 1. Walk to bus stop: ~4 min
      // 2. Wait for bus: ~7 min (UK average)
      // 3. Bus travel: 22 km/h average (includes stops)
      // 4. Walk from bus stop: ~4 min
      const walkToStop = 4;
      const waitTime = 7;
      const walkFromStop = 4;
      const busSpeedKmh = 22;
      
      // Bus covers most of the distance, minus ~400m walking each end
      const busDistanceKm = Math.max(0, distanceKm - 0.8);
      const busTimeMinutes = Math.round((busDistanceKm / busSpeedKmh) * 60);
      
      finalTravelMinutes = walkToStop + waitTime + busTimeMinutes + walkFromStop;
      
      // For very short journeys, check if walking is actually faster
      const walkingTime = Math.round((distanceKm / 4.0) * 60);
      if (walkingTime <= finalTravelMinutes && distanceKm < 2.0) {
        finalTravelMinutes = walkingTime;
      }
    }
  } else if (mode === 'walking') {
    finalTravelMinutes = Math.max(2, Math.round((distanceKm / 4.0) * 60)); // 4 km/h walking
  } else {
    // Car: 35 km/h average urban speed
    finalTravelMinutes = Math.max(2, Math.round((distanceKm / 35) * 60));
  }

  // Store in cache
  travelTimeCache.set(cacheKey, finalTravelMinutes);

  return finalTravelMinutes;
}

// Clear travel time cache (call when starting new scheduling run)
export function clearTravelCache(): void {
  travelTimeCache.clear();
}

// Seed travel time cache with ORS results from backend
export function seedTravelCache(results: Array<{
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  travelTimeMinutes: number;
}>, mode: 'car' | 'walking' | 'public' = 'car'): void {
  let seeded = 0;
  for (const result of results) {
    if (result.travelTimeMinutes > 0) {
      // Round to 4 decimal places to match getTravelMinutes precision
      const fromLat = Number(result.fromLat).toFixed(4);
      const fromLng = Number(result.fromLng).toFixed(4);
      const toLat = Number(result.toLat).toFixed(4);
      const toLng = Number(result.toLng).toFixed(4);
      
      const cacheKey = `${fromLat},${fromLng}-${toLat},${toLng}-${mode}`;
      travelTimeCache.set(cacheKey, result.travelTimeMinutes);
      seeded++;
    }
  }
  console.log(`🌐 Seeded travel cache with ${seeded} ORS results`);
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
// Enforces MAX_TRAVEL_TIME_MINUTES constraint for fair scheduling
export function isInsertionFeasible(
  visit: { start: number; end: number },
  prevVisit: { end: number; lat: number; lng: number } | null,
  nextVisit: { start: number; lat: number; lng: number } | null,
  visitLocation: { lat: number; lng: number },
  windows: TimeWindow[],
  mode: 'car' | 'walking' | 'public' = 'car'
): boolean {
  // Get max travel limit based on transport mode
  // Car: 23 minutes (strict), Public: 40 minutes (more overhead)
  const maxTravelForMode = mode === 'car' ? MAX_TRAVEL_TIME_MINUTES : 40;

  // LENIENT window check - allow if visit has ANY overlap with windows
  const hasWindowOverlap = windows.some(w => visit.start < w.end && visit.end > w.start);

  // If no overlap at all, check if within working hours (6am-10pm / 22:00)
  const isWithinWorkingHours = visit.start >= 360 && visit.end <= 1320; // 6am to 10pm

  if (!hasWindowOverlap && !isWithinWorkingHours) {
    return false; // Visit completely outside reasonable time
  }

  // Check time constraint with previous visit
  if (prevVisit) {
    const travelFromPrev = getTravelMinutes(
      { lat: prevVisit.lat, lng: prevVisit.lng },
      visitLocation,
      mode
    );

    // STRICT: Reject if travel time exceeds maximum limit for fair scheduling
    if (travelFromPrev > maxTravelForMode) {
      return false; // Travel time too long - reduces mileage and ensures fairness
    }

    if (prevVisit.end + travelFromPrev > visit.start) {
      return false; // Not enough time to travel from previous visit
    }
  }

  // Check time constraint with next visit
  if (nextVisit) {
    const travelToNext = getTravelMinutes(
      visitLocation,
      { lat: nextVisit.lat, lng: nextVisit.lng },
      mode
    );

    // STRICT: Reject if travel time exceeds maximum limit for fair scheduling
    if (travelToNext > maxTravelForMode) {
      return false; // Travel time too long - reduces mileage and ensures fairness
    }

    if (visit.end + travelToNext > nextVisit.start) {
      return false; // Not enough time to travel to next visit
    }
  }

  return true; // Visit is feasible
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