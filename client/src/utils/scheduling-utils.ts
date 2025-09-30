// Scheduling utility functions for VRPTW optimization

// Convert HH:MM time string to minutes since midnight
export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

// Convert minutes since midnight to HH:MM format
export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

// Calculate Haversine distance between two lat/lng points in kilometers
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
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

// Calculate travel time between two locations
export function getTravelMinutes(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  mode: 'car' | 'walking' | 'public' = 'car'
): number {
  const distance = haversineDistance(from.lat, from.lng, to.lat, to.lng);
  const travelTime = calculateTravelTime(distance, mode);
  
  console.log(`🔍 Utils travel calc: distance=${distance.toFixed(2)}km, mode=${mode}, time=${travelTime}min`);
  
  return travelTime;
}

// Parse time windows from string format "HH:MM-HH:MM" or array of such strings
export interface TimeWindow {
  start: number; // minutes since midnight
  end: number;   // minutes since midnight
}

export function parseTimeWindows(windows: string | string[]): TimeWindow[] {
  const windowArray = Array.isArray(windows) ? windows : [windows];
  
  return windowArray
    .filter(w => w && typeof w === 'string')
    .map(w => {
      const match = w.match(/(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/);
      if (!match) return null;
      return {
        start: timeToMinutes(match[1]),
        end: timeToMinutes(match[2]),
      };
    })
    .filter((w): w is TimeWindow => w !== null);
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
export function isInsertionFeasible(
  visit: { start: number; end: number },
  prevVisit: { end: number; lat: number; lng: number } | null,
  nextVisit: { start: number; lat: number; lng: number } | null,
  visitLocation: { lat: number; lng: number },
  windows: TimeWindow[],
  mode: 'car' | 'walking' | 'public' = 'car'
): boolean {
  // Check if visit fits in at least one availability window
  if (!fitsInWindow(visit.start, visit.end, windows)) {
    return false;
  }
  
  // Check travel constraint with previous visit
  if (prevVisit) {
    const travelFromPrev = getTravelMinutes(
      { lat: prevVisit.lat, lng: prevVisit.lng },
      visitLocation,
      mode
    );
    if (prevVisit.end + travelFromPrev > visit.start) {
      return false; // Not enough time to travel from previous visit
    }
  }
  
  // Check travel constraint with next visit
  if (nextVisit) {
    const travelToNext = getTravelMinutes(
      visitLocation,
      { lat: nextVisit.lat, lng: nextVisit.lng },
      mode
    );
    if (visit.end + travelToNext > nextVisit.start) {
      return false; // Not enough time to travel to next visit
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
