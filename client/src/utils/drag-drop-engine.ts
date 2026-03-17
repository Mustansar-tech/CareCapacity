/**
 * Drag-drop validation engine for unallocated visit assignment.
 * Validates whether a dragged visit can be assigned to a specific employee-day.
 */
import { timeToMinutes, minutesToTime, parseTimeWindows, getTravelMinutes } from './scheduling-utils';
import type { ClientVisit, EmployeeLocation } from '@shared/schema';

export interface AssignedVisit {
  id: string;
  clientName: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  lat?: number;
  lng?: number;
  travelTimeBefore: number;
  travelTimeAfter?: number;
  score: number;
}

export interface DropValidation {
  valid: boolean;
  reason: string;
}

export interface EmployeeDaySummary {
  employeeName: string;
  gender?: string;
  timeWindows: string;
  transportMode: string;
  contractedDailyHours: number;
  usedMinutes: number;
  visits: AssignedVisit[];
}

type TravelMode = 'car' | 'walking' | 'public';

function toTravelMode(raw: string | undefined): TravelMode {
  if (raw === 'walking' || raw === 'public') return raw;
  return 'car';
}

const MAX_DAILY_CARE_MINUTES = 9 * 60; // 9 hours

/**
 * Determines if a visit can be assigned to an employee on a specific day.
 * Returns { valid: true } if allowed, or { valid: false, reason: "..." } if not.
 */
export function validateVisitDrop(
  visit: ClientVisit & { unallocatedReason?: string },
  empSummary: EmployeeDaySummary,
  empLocation: EmployeeLocation | undefined
): DropValidation {

  // 1. Employee must be available that day (has time windows)
  if (!empSummary.timeWindows || empSummary.timeWindows.trim() === '') {
    return { valid: false, reason: 'Employee not available this day' };
  }

  // Skip ad-hoc employees
  if (empSummary.timeWindows.toLowerCase().includes('ad-hoc')) {
    return { valid: false, reason: 'Ad-hoc employee — not schedulable' };
  }

  // 2. Daily capacity check
  const newTotal = empSummary.usedMinutes + visit.durationMinutes;
  if (newTotal > MAX_DAILY_CARE_MINUTES) {
    const remaining = MAX_DAILY_CARE_MINUTES - empSummary.usedMinutes;
    return {
      valid: false,
      reason: `Daily limit reached (${Math.floor(remaining / 60)}h ${remaining % 60}m remaining)`,
    };
  }

  // 3. Visit must fit within employee's time windows
  const windows = parseTimeWindows(empSummary.timeWindows);
  if (windows.length > 0) {
    const visitStart = timeToMinutes(visit.startTime);
    const visitEnd = timeToMinutes(visit.endTime);
    const fitsInAnyWindow = windows.some(w => {
      // TimeWindow.start/end are already in minutes since midnight
      return visitStart >= w.start && visitEnd <= w.end + 30; // 30 min flex
    });
    if (!fitsInAnyWindow) {
      return {
        valid: false,
        reason: `Outside availability (${windows.map(w => `${minutesToTime(w.start)}–${minutesToTime(w.end)}`).join(', ')})`,
      };
    }
  }

  // 4. Travel time check (if we have location data)
  if (empLocation?.homeLat && visit.lat && visit.lng) {
    const mode = toTravelMode(empLocation.transportMode ?? undefined);
    const maxTravelMinutes = mode === 'car' ? 45 : 60;

    // Check travel to/from existing visits
    for (const existing of empSummary.visits) {
      if (existing.lat == null || existing.lng == null) continue;
      const travelBetween = getTravelMinutes(
        { lat: Number(existing.lat), lng: Number(existing.lng) },
        { lat: Number(visit.lat), lng: Number(visit.lng) },
        mode
      );
      if (travelBetween > maxTravelMinutes) {
        return {
          valid: false,
          reason: `Travel time (${travelBetween}min) exceeds ${maxTravelMinutes}min limit`,
        };
      }
    }
  }

  return { valid: true, reason: 'Can be assigned' };
}

/**
 * Find the chronological insertion index for a new visit among existing visits.
 */
export function findInsertionIndex(visits: AssignedVisit[], newVisitStartTime: string): number {
  const newStart = timeToMinutes(newVisitStartTime);
  for (let i = 0; i < visits.length; i++) {
    if (timeToMinutes(visits[i].startTime) > newStart) {
      return i;
    }
  }
  return visits.length;
}

/**
 * Build a ClientVisit-compatible AssignedVisit from a dragged unallocated visit.
 */
export function buildAssignedVisit(
  visit: ClientVisit & { unallocatedReason?: string },
  existingVisits: AssignedVisit[],
  empLocation: EmployeeLocation | undefined
): AssignedVisit {
  const mode = toTravelMode(empLocation?.transportMode ?? undefined);

  // Compute travel time from nearest preceding visit or employee home
  const insertIdx = findInsertionIndex(existingVisits, visit.startTime);
  let travelTimeBefore = 15; // default fallback

  if (visit.lat && visit.lng) {
    const prevVisit = existingVisits[insertIdx - 1];
    if (prevVisit?.lat != null && prevVisit?.lng != null) {
      travelTimeBefore = getTravelMinutes(
        { lat: Number(prevVisit.lat), lng: Number(prevVisit.lng) },
        { lat: Number(visit.lat), lng: Number(visit.lng) },
        mode
      );
    } else if (empLocation?.homeLat && empLocation?.homeLng) {
      travelTimeBefore = getTravelMinutes(
        { lat: Number(empLocation.homeLat), lng: Number(empLocation.homeLng) },
        { lat: Number(visit.lat), lng: Number(visit.lng) },
        mode
      );
    }
  }

  return {
    id: visit.id,
    clientName: visit.clientName,
    startTime: visit.startTime,
    endTime: visit.endTime,
    durationMinutes: visit.durationMinutes,
    lat: visit.lat ?? undefined,
    lng: visit.lng ?? undefined,
    travelTimeBefore,
    score: 0,
  };
}
