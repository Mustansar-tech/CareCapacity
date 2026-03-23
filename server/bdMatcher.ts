import { logger } from './logger';
import type { EmployeeSummaryRecord, EmployeeDailyDetail, CapacityAnalysis } from '@shared/schema';
import type { CpVisitEntry } from './excel-visit-extractor';
import { travelTimeService } from './travel-time-service';
import { normalizeName } from './shared-utils';

export interface ClientEnquiryCriteria {
  clientName: string;
  postcode?: string;
  genderPreference?: 'male' | 'female' | 'any';
  requiredDays: string[];
  preferredTimeWindow: { start: string; end: string };
}

export interface VisitCriteria {
  visitLabel: string;
  careProsRequired: number;
  genderPreferences: ('male' | 'female' | 'any')[];
  requiredDays: string[];
  preferredTimeWindow: { start: string; end: string };
}

export interface MultiVisitCriteria {
  clientName: string;
  postcode?: string;
  visits: VisitCriteria[];
}

export interface MatchedEmployee {
  employeeName: string;
  matchType: 'exact' | 'adjusted-time' | 'alternative-day';
  matchScore: number;
  gender?: string;
  transportMode?: string;
  homePostcode?: string;
  travelMinutes?: number;
  departureSource?: 'home' | 'last-client';
  departureSummary?: string;
  contractedWeeklyHours: number;
  totalScheduledHours: number;
  remainingCapacity: number;
  matchedSlots: MatchedSlot[];
}

export interface MatchedSlot {
  day: string;
  dayLabel: string;
  availableWindow: string;
  matchType: 'exact' | 'adjusted-time' | 'alternative-day';
  cancelledVisits?: string;
  // Departure info specific to this day (for schedule-aware CPs)
  departureSummary?: string;
  departureSource?: 'home' | 'last-client';
  // Actual travel minutes for THIS day's departure point
  travelMinutes?: number;
  // First scheduled visit on this day that starts after the proposed visit ends
  nextVisit?: { startTime: string; endTime: string; lat?: number; lng?: number; postcode?: string } | null;
}

export interface MatchResult {
  criteria: ClientEnquiryCriteria;
  matches: MatchedEmployee[];
  totalEmployeesEvaluated: number;
}

export interface VisitMatchResult {
  visitLabel: string;
  visitIndex: number;
  careProsRequired: number;
  genderPreferences: ('male' | 'female' | 'any')[];
  matches: MatchedEmployee[];
  totalEmployeesEvaluated: number;
}

export interface MultiVisitMatchResult {
  clientName: string;
  postcode?: string;
  visitResults: VisitMatchResult[];
  totalVisits: number;
}

interface TravelResult {
  travelMinutes: number;
  departureSource: 'home' | 'last-client';
  departureSummary: string;
  // Per-day departure info for schedule-aware CPs (used when displaying results for specific days)
  departureSummaryByDay?: Map<string, { source: 'home' | 'last-client'; summary: string }>;
  // Per-day travel minutes — key is day abbrev (mon, tue, etc.), value is actual travel for that day's departure
  travelMinutesByDay?: Map<string, number>;
}

function timeToMinutes(timeStr: string): number {
  const parts = timeStr.split(':').map(Number);
  return parts[0] * 60 + (parts[1] || 0);
}

/**
 * For a given employee+day, finds which departure point to use for travel time calculation.
 * Mirrors the 90-minute gap rule used in weekly-plan-tab.tsx (lines 399-402).
 */
function getDeparturePoint(
  empName: string,
  dateStr: string,
  enquiryStartMinutes: number,
  homeCoords: { lat: number; lng: number },
  employeeScheduleMap: Map<string, Map<string, CpVisitEntry[]>>
): { lat: number; lng: number; source: 'home' | 'last-client'; postcode?: string } {
  // Normalize employee name to match DB keys
  const normalizedName = normalizeName(empName);
  const dayVisits = employeeScheduleMap.get(normalizedName)?.get(dateStr);
  
  if (!dayVisits || dayVisits.length === 0) {
    logger.debug(`getDeparturePoint: no visits for ${empName} on ${dateStr}`, {
      normalized: normalizedName,
      hasSchedule: employeeScheduleMap.has(normalizedName),
      availableDates: employeeScheduleMap.get(normalizedName) ? Array.from(employeeScheduleMap.get(normalizedName)!.keys()) : [],
      scheduleMapKeys: Array.from(employeeScheduleMap.keys()).slice(0, 5),
    });
    return { ...homeCoords, source: 'home' };
  }

  // Find the last visit that ends at or before the enquiry start
  let lastVisit: CpVisitEntry | null = null;
  for (const visit of dayVisits) {
    const visitEndMin = timeToMinutes(visit.endTime);
    if (visitEndMin <= enquiryStartMinutes) {
      lastVisit = visit;
    }
  }

  if (!lastVisit || !lastVisit.lat || !lastVisit.lng) {
    logger.debug(`getDeparturePoint: no valid last visit for ${empName} on ${dateStr}`, {
      lastVisit: lastVisit ? { endTime: lastVisit.endTime, lat: lastVisit.lat, lng: lastVisit.lng } : null,
      enquiryStartMin: enquiryStartMinutes,
      visitsCount: dayVisits.length,
    });
    return { ...homeCoords, source: 'home' };
  }

  const gapMin = enquiryStartMinutes - timeToMinutes(lastVisit.endTime);
  logger.debug(`getDeparturePoint: gap analysis for ${empName} on ${dateStr}`, {
    gapMin,
    enquiryStartMin: enquiryStartMinutes,
    lastVisitEndTime: lastVisit.endTime,
    lastVisitClient: lastVisit.clientName,
  });
  
  if (gapMin >= 90) {
    logger.debug(`getDeparturePoint: gap >= 90 min, using home for ${empName}`);
    return { ...homeCoords, source: 'home' };
  }

  logger.debug(`getDeparturePoint: gap < 90 min, using last client for ${empName}`, {
    gapMin,
    lastVisitClient: lastVisit.clientName,
    postcode: lastVisit.postcode,
  });

  return {
    lat: lastVisit.lat,
    lng: lastVisit.lng,
    source: 'last-client',
    postcode: lastVisit.postcode,
  };
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function haversineEstimateMinutes(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  transportMode?: string
): number {
  const R = 6371;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  const distKm = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * R * 1.2;
  const mode = transportMode?.toLowerCase();
  const speedKmh = (mode === 'car' || mode === 'driver') ? 35 : mode === 'walking' ? 5 : 15;
  return Math.max(2, Math.round(distKm / speedKmh * 60));
}

function getEarliestStartAfterBreak(
  empName: string,
  dateStr: string,
  enquiryStartMins: number,
  scheduleMap: Map<string, Map<string, CpVisitEntry[]>>
): number | null {
  const CONTINUOUS_LIMIT = 300;
  const BREAK_DURATION = 30;
  const MAX_GAP_IN_BLOCK = 30;

  const normalizedName = normalizeName(empName);
  const dayVisits = scheduleMap.get(normalizedName)?.get(dateStr);
  if (!dayVisits || dayVisits.length === 0) return null;

  const priorVisits = dayVisits
    .filter(v => timeToMinutes(v.endTime) <= enquiryStartMins)
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

  if (priorVisits.length === 0) return null;

  let blockStart = timeToMinutes(priorVisits[0].startTime);
  let blockEnd = timeToMinutes(priorVisits[0].endTime);
  let maxBlockMins = blockEnd - blockStart;
  let maxBlockEnd = blockEnd;

  for (let i = 1; i < priorVisits.length; i++) {
    const vStart = timeToMinutes(priorVisits[i].startTime);
    const vEnd = timeToMinutes(priorVisits[i].endTime);
    if (vStart - blockEnd <= MAX_GAP_IN_BLOCK) {
      blockEnd = vEnd;
      const dur = blockEnd - blockStart;
      if (dur > maxBlockMins) {
        maxBlockMins = dur;
        maxBlockEnd = blockEnd;
      }
    } else {
      blockStart = vStart;
      blockEnd = vEnd;
    }
  }

  if (maxBlockMins >= CONTINUOUS_LIMIT) {
    return maxBlockEnd + BREAK_DURATION;
  }
  return null;
}

function parseFreeWindows(freeWindows: string): Array<[number, number]> {
  if (!freeWindows || freeWindows === '-' || freeWindows === '') return [];

    const normalized = freeWindows.replace(/\u2013|\u2014/g, '-');

    return normalized
      .split(',')
      .map(w => w.trim())
      .filter(w => w && (w.includes('-') || w.toLowerCase() === 'any'))
      .map(w => {
        if (w.toLowerCase() === 'any') {
          return [0, 1439] as [number, number]; // 00:00 to 23:59
        }
        const parts = w.split('-').map(s => s.trim());
        if (parts.length < 2) return null;
        const start = timeToMinutes(parts[0]);
        const end = timeToMinutes(parts[parts.length - 1]);
        return [start, end] as [number, number];
      })
      .filter((pair): pair is [number, number] => pair !== null && pair[1] > pair[0]);
}

function getDayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

function getDayAbbrev(dateStr: string): string {
  // Matrix grid in bd-matrix.tsx uses toLocaleDateString('en-GB') or standard 3-letter abbrevs
  // but the search filter uses ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
  const d = new Date(dateStr + 'T12:00:00');
  const dayName = d.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
  
  // Normalize to the 3-letter keys used in the search logic
  if (dayName === 'thu') return 'thu'; 
  if (dayName === 'sat') return 'sat';
  if (dayName === 'sun') return 'sun';
  return dayName;
}

// Company's 11 standardized time blocks
const COMPANY_TIME_BLOCKS = [
  { start: '08:00', end: '09:00' },
  { start: '09:15', end: '10:15' },
  { start: '10:30', end: '11:30' },
  { start: '11:45', end: '12:45' },
  { start: '13:00', end: '14:00' },
  { start: '14:15', end: '15:15' },
  { start: '15:30', end: '16:30' },
  { start: '16:45', end: '17:45' },
  { start: '18:00', end: '19:00' },
  { start: '19:15', end: '20:15' },
  { start: '20:30', end: '21:30' },
];

function getBlockStartMinutes(timeMins: number): number | null {
  for (const block of COMPANY_TIME_BLOCKS) {
    const blockStart = timeToMinutes(block.start);
    const blockEnd = timeToMinutes(block.end);
    if (timeMins >= blockStart && timeMins < blockEnd) {
      return blockStart;
    }
  }
  return null;
}

function findExactSlot(
  windows: Array<[number, number]>,
  reqStart: number,
  reqEnd: number,
  visitDuration: number
): string | null {
  for (const [wStart, wEnd] of windows) {
    if (wStart <= reqStart && wEnd >= (reqStart + visitDuration)) {
      return `${minutesToTime(reqStart)}-${minutesToTime(reqStart + visitDuration)}`;
    }
  }
  return null;
}

function findContainedSlot(
  windows: Array<[number, number]>,
  reqStart: number,
  reqEnd: number,
  visitDuration: number
): { window: string; distance: number } | null {
  for (const [wStart, wEnd] of windows) {
    // If the requested block (reqStart to reqStart + visitDuration) 
    // is entirely within an available window (wStart to wEnd), 
    // then it's a valid match at the requested time.
    // MODIFICATION: Use a small buffer (1 min) to handle precision issues
    if (reqStart >= wStart - 1 && (reqStart + visitDuration) <= wEnd + 1) {
      return {
        window: `${minutesToTime(reqStart)}-${minutesToTime(reqStart + visitDuration)}`,
        distance: 0
      };
    }
  }
  return null;
}

function findClosestSlot(
  windows: Array<[number, number]>,
  reqStart: number,
  reqEnd: number,
  visitDuration: number
): { window: string; distance: number } | null {
  let bestSlot: { window: string; distance: number } | null = null;
  const MAX_DIFF = 150; // 2h30mins = 150 minutes

  for (const [wStart, wEnd] of windows) {
    // Window must be large enough to fit the visit
    if (wEnd - wStart < visitDuration) continue;

    // Step 1: Check if requested slot fits exactly (window contains requested start→end)
    // AND it must align with a company time block to be considered "exact"
    if (reqStart >= wStart && (reqStart + visitDuration) <= wEnd) {
      const isBlockAligned = COMPANY_TIME_BLOCKS.some(block => 
        timeToMinutes(block.start) === reqStart
      );
      
      if (isBlockAligned) {
        return {
          window: `${minutesToTime(reqStart)}-${minutesToTime(reqStart + visitDuration)}`,
          distance: 0,
        };
      }
    }

    // Step 2: Find the best start time within this window that is closest to reqStart.
    // Clamp reqStart to [wStart, wEnd - visitDuration], then snap to nearest 15-min boundary.
    const clampedIdeal = Math.max(wStart, Math.min(reqStart, wEnd - visitDuration));

    // Try snapping to nearest company time block first (preferred display)
    let bestBlockStart: number | null = null;
    let bestBlockDiff = Infinity;
    for (const block of COMPANY_TIME_BLOCKS) {
      const blockStart = timeToMinutes(block.start);
      const blockEnd = blockStart + visitDuration;
      if (blockStart >= wStart && blockEnd <= wEnd) {
        const diff = Math.abs(blockStart - reqStart);
        if (diff < bestBlockDiff) {
          bestBlockDiff = diff;
          bestBlockStart = blockStart;
        }
      }
    }

    // If a company block fits inside this window, use it if within MAX_DIFF
    if (bestBlockStart !== null && bestBlockDiff <= MAX_DIFF) {
      if (!bestSlot || bestBlockDiff < bestSlot.distance) {
        bestSlot = {
          window: `${minutesToTime(bestBlockStart)}-${minutesToTime(bestBlockStart + visitDuration)}`,
          distance: bestBlockDiff,
        };
      }
      continue; // Company block found — no need for generic fallback for this window
    }

    // Step 3: No company block fits this window — use the clamped nearest start,
    // snapped to 15-min boundary, still within the window.
    const snapped15 = Math.round(clampedIdeal / 15) * 15;
    const candidateStart = Math.max(wStart, Math.min(snapped15, wEnd - visitDuration));
    if (candidateStart + visitDuration <= wEnd) {
      const diff = Math.abs(candidateStart - reqStart);
      if (diff <= MAX_DIFF && (!bestSlot || diff < bestSlot.distance)) {
        bestSlot = {
          window: `${minutesToTime(candidateStart)}-${minutesToTime(candidateStart + visitDuration)}`,
          distance: diff,
        };
      }
    }
  }

  return bestSlot;
}

async function buildEmployeeWeeklyData(
  dates: string[],
  employeeSummaryByDate: Record<string, EmployeeSummaryRecord[]>,
  employeesByDate: Record<string, EmployeeDailyDetail[]>,
  branchId?: string,
  storage?: any
) {
  const allEmployeeNames = new Set<string>();
  for (const dateStr of dates) {
    const summaries = employeeSummaryByDate[dateStr] || [];
    for (const s of summaries) {
      allEmployeeNames.add(s.employeeName);
    }
  }

  const employeeWeeklyData = new Map<string, {
    totalScheduled: number;
    contractedWeekly: number;
    gender?: string;
    transportMode?: string;
    homePostcode?: string;
    homeLat?: number;
    homeLng?: number;
  }>();

  for (const empName of Array.from(allEmployeeNames)) {
    let totalScheduled = 0;
    let totalContractedDaily = 0;
    let gender: string | undefined;
    let transportMode: string | undefined;
    let homePostcode: string | undefined;

    for (const dateStr of dates) {
      const summaries = employeeSummaryByDate[dateStr] || [];
      const empSummary = summaries.find(s => s.employeeName === empName);
      if (empSummary) {
        totalScheduled += empSummary.scheduledHours;
        if (empSummary.gender) gender = empSummary.gender;
        if (empSummary.transportMode) transportMode = empSummary.transportMode;
      }

      const details = (employeesByDate[dateStr] || []) as EmployeeDailyDetail[];
      const empDetail = details.find(d => d.employeeName === empName);
      if (empDetail && empDetail.contractedDailyHours > 0) {
        totalContractedDaily += empDetail.contractedDailyHours;
      }
    }

    employeeWeeklyData.set(empName, {
      totalScheduled: Math.round(totalScheduled * 100) / 100,
      contractedWeekly: Math.round(totalContractedDaily * 100) / 100,
      gender,
      transportMode,
      homePostcode,
    });
  }

  if (branchId && storage) {
    for (const [empName, data] of Array.from(employeeWeeklyData.entries())) {
      const loc = await storage.getEmployeeLocationByName(branchId, empName);
      if (loc) {
        if (loc.homeLat && loc.homeLng) {
          data.homeLat = parseFloat(loc.homeLat.toString());
          data.homeLng = parseFloat(loc.homeLng.toString());
        }
        if (loc.homePostcode) {
          data.homePostcode = loc.homePostcode;
        }
      }
    }
  }

  return { allEmployeeNames, employeeWeeklyData };
}

function isFullyAvailableInTimeBlock(freeWindows: string, reqStart: number, reqEnd: number): boolean {
  if (!freeWindows || freeWindows === '-' || freeWindows === '') return false;
  
  // Use the exact same logic as client/src/pages/bd-matrix.tsx (isFullyAvailableInTimeBlock)
  // The matrix grid uses normalized windows (trim, remove empty, check for dash)
  const windows = freeWindows.split(',').map(w => w.trim()).filter(w => w);
  
  for (const window of windows) {
    if (window.includes('-')) {
      const parts = window.split('-').map(s => s.trim());
      if (parts.length < 2) continue;
      
      // Ensure we use the first and last part if there are multiple dashes (e.g. "08:00 - 09:00")
      const windowStart = timeToMinutes(parts[0]);
      const windowEnd = timeToMinutes(parts[parts.length - 1]);
      
      // Matrix grid check: windowStart <= blockStart && windowEnd >= blockEnd
      if (windowStart <= reqStart && windowEnd >= reqEnd) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Helper to get departure info for a specific date
 */
function getSlotDepartureInfo(empName: string, dateStr: string, travelTimeMap?: Map<string, TravelResult>): { departureSummary?: string; departureSource?: 'home' | 'last-client'; travelMinutes?: number } {
  if (!travelTimeMap || !travelTimeMap.has(empName)) {
    return {};
  }
  const travelResult = travelTimeMap.get(empName)!;
  const dayAbbrev = getDayAbbrev(dateStr).toLowerCase();

  // Per-day travel minutes (schedule-aware individual CPs)
  const dayTravelMinutes = travelResult.travelMinutesByDay?.get(dayAbbrev);

  if (!travelResult.departureSummaryByDay) {
    return { 
      departureSummary: travelResult.departureSummary, 
      departureSource: travelResult.departureSource,
      travelMinutes: dayTravelMinutes ?? travelResult.travelMinutes,
    };
  }
  const dayInfo = travelResult.departureSummaryByDay.get(dayAbbrev);
  if (dayInfo) {
    return { 
      departureSummary: dayInfo.summary, 
      departureSource: dayInfo.source,
      travelMinutes: dayTravelMinutes ?? travelResult.travelMinutes,
    };
  }
  return {};
}

function getNextVisitAfter(
  empName: string,
  dateStr: string,
  afterMinutes: number,
  employeeScheduleMap: Map<string, Map<string, CpVisitEntry[]>>
): { startTime: string; endTime: string; lat?: number; lng?: number; postcode?: string } | null {
  const normalizedName = normalizeName(empName);
  const dayVisits = employeeScheduleMap.get(normalizedName)?.get(dateStr);
  if (!dayVisits || dayVisits.length === 0) return null;
  const sorted = [...dayVisits].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  const next = sorted.find(v => timeToMinutes(v.startTime) > afterMinutes);
  return next
    ? { startTime: next.startTime, endTime: next.endTime, lat: next.lat, lng: next.lng, postcode: next.postcode }
    : null;
}

function matchEmployeesForVisit(
  genderPreference: 'male' | 'female' | 'any',
  requiredDays: string[],
  preferredTimeWindow: { start: string; end: string },
  dates: string[],
  employeeSummaryByDate: Record<string, EmployeeSummaryRecord[]>,
  allEmployeeNames: Set<string>,
  employeeWeeklyData: Map<string, { totalScheduled: number; contractedWeekly: number; gender?: string; transportMode?: string; homePostcode?: string; homeLat?: number; homeLng?: number }>,
  topN: number = 50,
  clientLocation?: { lat: number; lng: number },
  travelTimeMap?: Map<string, TravelResult>,
  employeeScheduleMap?: Map<string, Map<string, CpVisitEntry[]>>
): MatchedEmployee[] {
  const reqStart = timeToMinutes(preferredTimeWindow.start);
  const reqEnd = timeToMinutes(preferredTimeWindow.end);
  const visitDuration = reqEnd - reqStart;

  const datesByDay = new Map<string, string[]>();
  for (const dateStr of dates) {
    const dayAbbrev = getDayAbbrev(dateStr);
    const existing = datesByDay.get(dayAbbrev) || [];
    existing.push(dateStr);
    datesByDay.set(dayAbbrev, existing);
  }

  const candidates: MatchedEmployee[] = [];

  const employeeNamesArray = Array.from(allEmployeeNames);
  for (const empName of employeeNamesArray) {
    const weeklyData = employeeWeeklyData.get(empName)!;
    
    if (
      genderPreference &&
      genderPreference !== 'any' &&
      weeklyData.gender &&
      (weeklyData.gender.trim().toLowerCase() === 'female' || weeklyData.gender.trim().toLowerCase() === 'f') &&
      genderPreference.trim().toLowerCase() === 'female'
    ) {
      // Female matching female - perfect
    } else if (
      genderPreference &&
      genderPreference !== 'any' &&
      weeklyData.gender &&
      weeklyData.gender.trim().toLowerCase() !== genderPreference.trim().toLowerCase()
    ) {
      // Special check for 'F' vs 'Female' or 'M' vs 'Male'
      const normalizedEmpGender = weeklyData.gender.trim().toLowerCase().startsWith('f') ? 'female' : (weeklyData.gender.trim().toLowerCase().startsWith('m') ? 'male' : weeklyData.gender.trim().toLowerCase());
      const normalizedPref = genderPreference.trim().toLowerCase();
      
      if (normalizedEmpGender !== normalizedPref) {
        continue;
      }
    }

    const remainingCapacity = Math.max(0, weeklyData.contractedWeekly - weeklyData.totalScheduled);

    const matchedSlots: MatchedSlot[] = [];
    let totalScore = 0;
    let exactDayMatches = 0;
    let adjustedTimeMatches = 0;
    let alternativeDayMatches = 0;

    for (const reqDay of requiredDays) {
      const matchingDates = datesByDay.get(reqDay) || [];
      let bestSlotForDay: MatchedSlot | null = null;
      let bestScoreForDay = -1;

      for (const dateStr of matchingDates) {
        const summaries = employeeSummaryByDate[dateStr] || [];
        const empSummary = summaries.find(s => s.employeeName === empName);
        if (!empSummary) continue;

        // Rule 1: Exclude if any unavailability (annual leave, sick, etc.)
        if (empSummary.unavailability > 0) continue;

        // Rule 2: Exclude if daily scheduled hours already at or above 9 hours
        if (empSummary.scheduledHours >= 9) continue;

        // Rule 3: Break rule — if CP has 5+ continuous hours before the enquiry slot,
        // they need a 30-min break first; shift to the next available company time block.
        let effectiveReqStart = reqStart;
        if (employeeScheduleMap) {
          const earliestAfterBreak = getEarliestStartAfterBreak(empName, dateStr, reqStart, employeeScheduleMap);
          if (earliestAfterBreak !== null && reqStart < earliestAfterBreak) {
            const nextBlock = COMPANY_TIME_BLOCKS.find(b => timeToMinutes(b.start) >= earliestAfterBreak);
            if (!nextBlock) continue;
            effectiveReqStart = timeToMinutes(nextBlock.start);
          }
        }
        const effectiveReqEnd = effectiveReqStart + visitDuration;

        const cancelledVisitsStr = empSummary.cancelledVisits && empSummary.cancelledVisits !== '—' ? empSummary.cancelledVisits : undefined;

        const isAvailable = isFullyAvailableInTimeBlock(empSummary.freeWindows, effectiveReqStart, effectiveReqEnd);

        if (isAvailable) {
          const mType = effectiveReqStart === reqStart ? 'exact' : 'adjusted-time';
          const score = mType === 'exact' ? 100 : 85;
          if (score > bestScoreForDay) {
            const depInfo = getSlotDepartureInfo(empName, dateStr, travelTimeMap);
            bestSlotForDay = {
              day: dateStr,
              dayLabel: getDayLabel(dateStr),
              availableWindow: `${minutesToTime(effectiveReqStart)}-${minutesToTime(effectiveReqEnd)}`,
              matchType: mType,
              cancelledVisits: cancelledVisitsStr,
              ...depInfo,
            };
            bestScoreForDay = score;
          }
        } else {
          const freeWindows = parseFreeWindows(empSummary.freeWindows);
          const closestSlot = findClosestSlot(freeWindows, effectiveReqStart, effectiveReqEnd, visitDuration);
          if (closestSlot) {
            const isBlockAligned = COMPANY_TIME_BLOCKS.some(block =>
              timeToMinutes(block.start) === timeToMinutes(closestSlot.window.split('-')[0])
            );
            if (isBlockAligned) {
              const score = Math.max(0, 80 - closestSlot.distance / 5);
              if (score > bestScoreForDay) {
                const depInfo = getSlotDepartureInfo(empName, dateStr, travelTimeMap);
                bestSlotForDay = {
                  day: dateStr,
                  dayLabel: getDayLabel(dateStr),
                  availableWindow: closestSlot.window,
                  matchType: 'adjusted-time',
                  cancelledVisits: cancelledVisitsStr,
                  ...depInfo,
                };
                bestScoreForDay = score;
              }
            }
          }
        }
      }

      if (bestSlotForDay) {
        if (employeeScheduleMap) {
          const slotEndStr = bestSlotForDay.availableWindow.split('-')[1];
          const slotEndMins = slotEndStr ? timeToMinutes(slotEndStr) : reqEnd;
          bestSlotForDay.nextVisit = getNextVisitAfter(empName, bestSlotForDay.day, slotEndMins, employeeScheduleMap);

          // Rule 4: Forward travel check — if gap to next visit < 90 min, verify the CP
          // can travel from the enquiry postcode to the next visit in time.
          // Allow up to 5 min over; reject if > 20 min over.
          const nv = bestSlotForDay.nextVisit;
          if (nv && nv.lat && nv.lng && clientLocation) {
            const nextStartMins = timeToMinutes(nv.startTime);
            const gapMins = nextStartMins - slotEndMins;
            if (gapMins < 90) {
              const forwardMins = haversineEstimateMinutes(
                clientLocation,
                { lat: nv.lat, lng: nv.lng },
                weeklyData.transportMode
              );
              if (forwardMins > gapMins + 20) {
                bestSlotForDay = null;
              }
            }
          }
        }

        if (bestSlotForDay) {
          matchedSlots.push(bestSlotForDay);
          totalScore += bestScoreForDay;
          if (bestSlotForDay.matchType === 'exact') exactDayMatches++;
          else adjustedTimeMatches++;
        }
      }
    }

    if (matchedSlots.length === 0) {
      for (const dateStr of dates) {
        const dayAbbrev = getDayAbbrev(dateStr);
        if (requiredDays.includes(dayAbbrev)) continue;

        const summaries = employeeSummaryByDate[dateStr] || [];
        const empSummary = summaries.find(s => s.employeeName === empName);
        if (!empSummary) continue;

        // Rule 1: Exclude if any unavailability on this alternative day
        if (empSummary.unavailability > 0) continue;
        // Rule 2: Exclude if daily scheduled hours >= 9 on this alternative day
        if (empSummary.scheduledHours >= 9) continue;

        // Rule 3: Break rule for alternative days
        let altEffectiveStart = reqStart;
        if (employeeScheduleMap) {
          const earliestAfterBreak = getEarliestStartAfterBreak(empName, dateStr, reqStart, employeeScheduleMap);
          if (earliestAfterBreak !== null && reqStart < earliestAfterBreak) {
            const nextBlock = COMPANY_TIME_BLOCKS.find(b => timeToMinutes(b.start) >= earliestAfterBreak);
            if (!nextBlock) continue;
            altEffectiveStart = timeToMinutes(nextBlock.start);
          }
        }
        const altEffectiveEnd = altEffectiveStart + visitDuration;

        const altCancelledStr = empSummary.cancelledVisits && empSummary.cancelledVisits !== '—' ? empSummary.cancelledVisits : undefined;
        const isAvailable = isFullyAvailableInTimeBlock(empSummary.freeWindows, altEffectiveStart, altEffectiveEnd);

        if (isAvailable) {
          const depInfo = getSlotDepartureInfo(empName, dateStr, travelTimeMap);
          const nextVisit = employeeScheduleMap ? getNextVisitAfter(empName, dateStr, altEffectiveEnd, employeeScheduleMap) : undefined;

          // Rule 4: Forward travel check for alternative days
          if (nextVisit?.lat && nextVisit?.lng && clientLocation) {
            const gapMins = timeToMinutes(nextVisit.startTime) - altEffectiveEnd;
            if (gapMins < 90) {
              const fwdMins = haversineEstimateMinutes(clientLocation, { lat: nextVisit.lat, lng: nextVisit.lng }, weeklyData.transportMode);
              if (fwdMins > gapMins + 20) continue;
            }
          }

          matchedSlots.push({
            day: dateStr,
            dayLabel: getDayLabel(dateStr),
            availableWindow: `${minutesToTime(altEffectiveStart)}-${minutesToTime(altEffectiveEnd)}`,
            matchType: 'alternative-day',
            cancelledVisits: altCancelledStr,
            nextVisit,
            ...depInfo,
          });
          alternativeDayMatches++;
          totalScore += 40;
          if (matchedSlots.length >= requiredDays.length) break;
        } else {
          const freeWindows = parseFreeWindows(empSummary.freeWindows);
          const closestSlot = findClosestSlot(freeWindows, altEffectiveStart, altEffectiveEnd, visitDuration);
          if (closestSlot) {
            const depInfo = getSlotDepartureInfo(empName, dateStr, travelTimeMap);
            const altSlotEndStr = closestSlot.window.split('-')[1];
            const altSlotEndMins = altSlotEndStr ? timeToMinutes(altSlotEndStr) : altEffectiveEnd;
            const nextVisit = employeeScheduleMap ? getNextVisitAfter(empName, dateStr, altSlotEndMins, employeeScheduleMap) : undefined;

            // Rule 4: Forward travel check for alternative days (adjusted slot)
            if (nextVisit?.lat && nextVisit?.lng && clientLocation) {
              const gapMins = timeToMinutes(nextVisit.startTime) - altSlotEndMins;
              if (gapMins < 90) {
                const fwdMins = haversineEstimateMinutes(clientLocation, { lat: nextVisit.lat, lng: nextVisit.lng }, weeklyData.transportMode);
                if (fwdMins > gapMins + 20) continue;
              }
            }

            matchedSlots.push({
              day: dateStr,
              dayLabel: getDayLabel(dateStr),
              availableWindow: closestSlot.window,
              matchType: 'alternative-day',
              cancelledVisits: altCancelledStr,
              nextVisit,
              ...depInfo,
            });
            alternativeDayMatches++;
            totalScore += Math.max(0, 20 - closestSlot.distance / 10);
            if (matchedSlots.length >= requiredDays.length) break;
          }
        }
      }
    }

    if (matchedSlots.length === 0) continue;

    const avgScore = totalScore / Math.max(matchedSlots.length, 1);
    const dayMatchRatio = matchedSlots.filter(s => s.matchType === 'exact').length / Math.max(requiredDays.length, 1);
    const capacityBonus = Math.min(20, remainingCapacity * 2);

    let transportBonus = 0;
    const isCar = weeklyData.transportMode?.toLowerCase() === 'car' || weeklyData.transportMode?.toLowerCase() === 'driver';
    if (isCar) {
      transportBonus = 15;
    }

    // Use real travel time from API map when available, otherwise fall back to straight-line estimate
    let travelBonus = 0;
    let travelMinutes: number | undefined;
    let departureSource: 'home' | 'last-client' | undefined;
    let departureSummary: string | undefined;

    if (travelTimeMap && travelTimeMap.has(empName)) {
      const travelResult = travelTimeMap.get(empName)!;
      travelMinutes = travelResult.travelMinutes;
      departureSource = travelResult.departureSource;
      departureSummary = travelResult.departureSummary;
      
      // Hard filter: car CPs >45 min, walker/public CPs >60 min
      const maxAllowed = isCar ? 45 : 60;
      if (travelMinutes > maxAllowed) continue;
      // Score based on real travel time bands
      if (travelMinutes <= 20) travelBonus = 15;
      else if (travelMinutes <= 30) travelBonus = 10;
      else if (travelMinutes <= 45) travelBonus = 5;
      else travelBonus = 0;
    } else if (clientLocation && weeklyData.homeLat && weeklyData.homeLng) {
      // Fallback to straight-line estimate when API result not available
      const latDiff = clientLocation.lat - weeklyData.homeLat;
      const lngDiff = clientLocation.lng - weeklyData.homeLng;
      const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
      travelBonus = Math.max(0, 15 - (distance * 100));
    }

    const finalScore = Math.round((avgScore * 0.35 + dayMatchRatio * 100 * 0.35 + capacityBonus * 0.1 + transportBonus * 0.1 + travelBonus * 0.1) * 100) / 100;

    let overallMatchType: 'exact' | 'adjusted-time' | 'alternative-day' = 'exact';
    if (alternativeDayMatches > 0) overallMatchType = 'alternative-day';
    else if (adjustedTimeMatches > 0) overallMatchType = 'adjusted-time';

    // For schedule-aware CPs, use the departure info from the first matched day
    let finalDepartureSummary = departureSummary;
    let finalDepartureSource = departureSource;
    if (travelTimeMap && travelTimeMap.has(empName) && matchedSlots.length > 0) {
      const travelResult = travelTimeMap.get(empName)!;
      if (travelResult.departureSummaryByDay) {
        const firstSlot = matchedSlots[0];
        const slotDayAbbrev = getDayAbbrev(firstSlot.day).toLowerCase();
        const dayInfo = travelResult.departureSummaryByDay.get(slotDayAbbrev);
        if (dayInfo) {
          finalDepartureSummary = dayInfo.summary;
          finalDepartureSource = dayInfo.source;
        }
      }
    }

    candidates.push({
      employeeName: empName,
      matchType: overallMatchType,
      matchScore: finalScore,
      gender: weeklyData.gender,
      transportMode: weeklyData.transportMode,
      homePostcode: weeklyData.homePostcode,
      travelMinutes,
      departureSource: finalDepartureSource,
      departureSummary: finalDepartureSummary,
      contractedWeeklyHours: weeklyData.contractedWeekly,
      totalScheduledHours: weeklyData.totalScheduled,
      remainingCapacity,
      matchedSlots,
    });
  }

  candidates.sort((a, b) => {
    const typeOrder = { exact: 0, 'adjusted-time': 1, 'alternative-day': 2 };
    const typeDiff = typeOrder[a.matchType] - typeOrder[b.matchType];
    if (typeDiff !== 0) return typeDiff;
    return b.matchScore - a.matchScore;
  });

  return candidates.slice(0, topN);
}

async function buildTravelTimeMap(
  employeeWeeklyData: Map<string, { totalScheduled: number; contractedWeekly: number; gender?: string; transportMode?: string; homePostcode?: string; homeLat?: number; homeLng?: number }>,
  clientCoords: { lat: number; lng: number },
  branchId: string,
  employeeScheduleMap?: Map<string, Map<string, CpVisitEntry[]>>,
  requiredDays?: string[],
  datesByDay?: Map<string, string[]>,
  enquiryStartMinutes?: number
): Promise<Map<string, TravelResult>> {
  const travelTimeMap = new Map<string, TravelResult>();

  const useScheduleAware = !!(employeeScheduleMap && requiredDays && datesByDay && enquiryStartMinutes !== undefined);

  // Groups for batch processing
  type BatchCp = { empName: string; isCar: boolean; mode: string; homeCoords: { lat: number; lng: number } };
  type IndividualCp = { empName: string; isCar: boolean; mode: string; departures: Array<{ coords: { lat: number; lng: number }; source: 'home' | 'last-client'; postcode?: string; dayLabel: string }>; departureSummary: string; overallSource: 'home' | 'last-client' };

  const homeBatchCps: BatchCp[] = [];
  const individualCps: IndividualCp[] = [];

  for (const [empName, data] of Array.from(employeeWeeklyData.entries())) {
    if (!data.homeLat || !data.homeLng) continue;
    const isCar = data.transportMode?.toLowerCase() === 'car' || data.transportMode?.toLowerCase() === 'driver';
    const mode = isCar ? 'car' : (data.transportMode?.toLowerCase() === 'walking' ? 'walking' : 'public_transport');
    const homeCoords = { lat: data.homeLat, lng: data.homeLng };

    if (useScheduleAware && employeeScheduleMap) {
      // Collect per-day departure points
      const dayDepartures: Array<{ coords: { lat: number; lng: number }; source: 'home' | 'last-client'; postcode?: string; dayLabel: string }> = [];

      for (const reqDay of requiredDays!) {
        for (const dateStr of (datesByDay!.get(reqDay) || [])) {
          const dep = getDeparturePoint(empName, dateStr, enquiryStartMinutes!, homeCoords, employeeScheduleMap);
          dayDepartures.push({
            coords: { lat: dep.lat, lng: dep.lng },
            source: dep.source,
            postcode: dep.postcode,
            dayLabel: reqDay.charAt(0).toUpperCase() + reqDay.slice(1),
          });
        }
      }

      if (dayDepartures.length === 0) {
        // No relevant days — fall through to home batch
        homeBatchCps.push({ empName, isCar, mode, homeCoords });
        continue;
      }

      const lastClientDays = dayDepartures.filter(d => d.source === 'last-client');
      const overallSource: 'home' | 'last-client' = lastClientDays.length > 0 ? 'last-client' : 'home';

      if (overallSource === 'home') {
        // All days depart from home — can batch with ORS Matrix
        homeBatchCps.push({ empName, isCar, mode, homeCoords });
      } else {
        // At least one day departs from last client — calculate individually per day
        const postcodes = [...new Set(lastClientDays.map(d => d.postcode).filter(Boolean))];
        const dayLabels = [...new Set(lastClientDays.map(d => d.dayLabel))];
        const postcodeStr = postcodes.length > 0 ? postcodes.join('/') : 'last client';
        const departureSummary = `${postcodeStr} (${dayLabels.join('/')})`;
        individualCps.push({ empName, isCar, mode, departures: dayDepartures, departureSummary, overallSource });
      }
    } else {
      homeBatchCps.push({ empName, isCar, mode, homeCoords });
    }
  }

  // ── SINGLE ORS Matrix batch pre-warm: ALL car sources (home + last-client) → enquiry ──
  const batchCarCPs = homeBatchCps.filter(c => c.isCar);
  const batchNonCarCPs = homeBatchCps.filter(c => !c.isCar);
  const carIndividualCps = individualCps.filter(c => c.isCar);

  // Collect all unique car departure coords (home + last-client)
  const allCarSources: Array<{ lat: number; lng: number }> = [];
  const seenSources = new Set<string>();

  // 1. Add home departure coords
  for (const cp of batchCarCPs) {
    const key = `${cp.homeCoords.lat.toFixed(5)},${cp.homeCoords.lng.toFixed(5)}`;
    if (!seenSources.has(key)) {
      allCarSources.push(cp.homeCoords);
      seenSources.add(key);
    }
  }

  // 2. Add ALL departure coords from carIndividualCps (both home days + last-client days)
  // These CPs have mixed days — some depart from home, some from last client.
  // We must pre-warm ALL their departure coords or cache misses happen on home-departure days.
  for (const cp of carIndividualCps) {
    for (const dep of cp.departures) {
      const key = `${dep.coords.lat.toFixed(5)},${dep.coords.lng.toFixed(5)}`;
      if (!seenSources.has(key)) {
        allCarSources.push(dep.coords);
        seenSources.add(key);
      }
    }
  }

  // 3. ONE ORS Matrix batch: all car sources → enquiry postcode
  if (allCarSources.length > 0) {
    try {
      logger.info(`BD Matcher: ORS Matrix pre-warm — ${allCarSources.length} car sources → enquiry (1 batch call)`);
      await travelTimeService.orsMatrixBatch(allCarSources, [clientCoords]);
      logger.info(`BD Matcher: ORS Matrix pre-warm complete — cache ready for ${allCarSources.length} routes`);
    } catch (err) {
      logger.warn(`BD Matcher: ORS Matrix batch failed, cars will use OSRM fallback: ${err}`);
    }
  }

  // ── Home departure cars: read from cache ──
  for (const cp of batchCarCPs) {
    try {
      const cacheData = travelTimeService.getCachedTravelTime(cp.homeCoords, clientCoords, 'car');
      if (cacheData && cacheData.durationMinutes < 9999) {
        travelTimeMap.set(cp.empName, {
          travelMinutes: cacheData.durationMinutes,
          departureSource: 'home',
          departureSummary: 'home',
        });
      }
    } catch (err) {
      logger.debug(`BD Matcher: car batch read failed for ${cp.empName}: ${err}`);
    }
  }
  logger.debug(`BD Matcher: ${batchCarCPs.length} home-departure cars → ${Array.from(travelTimeMap.entries()).filter(([, v]) => v.departureSource === 'home').length} cached results`);

  // ── Non-car home departures: use TravelTime API / heuristic ──
  for (const cp of batchNonCarCPs) {
    try {
      const result = await travelTimeService.calculateTravelTime(branchId, cp.homeCoords, clientCoords, cp.mode as any);
      if (result && result.travelTimeMinutes < 9999) {
        travelTimeMap.set(cp.empName, {
          travelMinutes: Math.round(result.travelTimeMinutes),
          departureSource: 'home',
          departureSummary: 'home',
        });
      }
    } catch (err) {
      logger.debug(`BD Matcher: walker travel time failed for ${cp.empName}: ${err}`);
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  // ── Individual path: last-client departure CPs (calculate per day, take max) ──
  for (const cp of individualCps) {
    let maxTravelMinutes: number | undefined;
    let maxTravelSource: 'home' | 'last-client' | undefined;
    let maxTravelPostcode: string | undefined;
    let maxTravelDayLabel: string | undefined;

    // Build per-day departure info (for showing correct postcode on each day)
    const departureSummaryByDay = new Map<string, { source: 'home' | 'last-client'; summary: string }>();
    for (const dep of cp.departures) {
      const dayLabel = dep.dayLabel.toLowerCase(); // Mon, Tue, etc.
      let summary = 'home';
      if (dep.source === 'last-client' && dep.postcode) {
        summary = `${dep.postcode} (${dep.dayLabel})`;
      }
      departureSummaryByDay.set(dayLabel, { source: dep.source, summary });
    }

    // Deduplicate departure coords to avoid redundant API calls, but track original departure info
    const uniqueCoords = new Map<string, { coords: { lat: number; lng: number }; deps: typeof cp.departures }>();
    for (const dep of cp.departures) {
      const key = `${dep.coords.lat.toFixed(5)},${dep.coords.lng.toFixed(5)}`;
      if (!uniqueCoords.has(key)) {
        uniqueCoords.set(key, { coords: dep.coords, deps: [] });
      }
      uniqueCoords.get(key)!.deps.push(dep);
    }

    // Build a per-unique-coord travel time map (cache reads only — no API calls for cars)
    const coordTravelMap = new Map<string, number>(); // coordKey → durationMinutes

    for (const [coordKey, { coords, deps }] of uniqueCoords) {
      try {
        let mins: number | undefined;

        if (cp.isCar) {
          // Cars: read directly from pre-warmed ORS Matrix cache (no individual API calls)
          const cacheData = travelTimeService.getCachedTravelTime(coords, clientCoords, 'car');
          if (cacheData) {
            mins = cacheData.durationMinutes;
            logger.info(`BD Matcher [${cp.empName}]: ${deps[0].source} (${coords.lat.toFixed(4)},${coords.lng.toFixed(4)}) → enquiry = ${mins}min [${cacheData.source}]`);
          } else {
            // Cache miss — OSRM fallback (free, no quota)
            logger.warn(`BD Matcher: ORS Matrix cache miss for car ${cp.empName} departure ${coordKey} — using OSRM fallback`);
            const osrmData = await travelTimeService.fetchOSRMRouteFallback(coords, clientCoords);
            if (osrmData) {
              mins = osrmData.durationMinutes;
              logger.info(`BD Matcher [${cp.empName}]: ${deps[0].source} OSRM fallback = ${mins}min`);
            }
          }
        } else {
          // Walkers/public: use TravelTime API with heuristic fallback
          const result = await travelTimeService.calculateTravelTime(branchId, coords, clientCoords, cp.mode as any);
          await new Promise(resolve => setTimeout(resolve, 100));
          if (result && result.travelTimeMinutes < 9999) {
            mins = Math.round(result.travelTimeMinutes);
          }
        }

        if (mins !== undefined && mins < 9999) {
          coordTravelMap.set(coordKey, mins);
        }
      } catch (err) {
        logger.debug(`BD Matcher: schedule-aware travel failed for ${cp.empName}: ${err}`);
      }
    }

    // Compute per-day travel time using the actual departure coord for that day.
    // Show the travel for the SPECIFIC day's departure point, not a global max.
    // Use max only as the final single number shown in the card (worst-case across required days).
    for (const dep of cp.departures) {
      const coordKey = `${dep.coords.lat.toFixed(5)},${dep.coords.lng.toFixed(5)}`;
      const mins = coordTravelMap.get(coordKey);
      if (mins !== undefined) {
        if (maxTravelMinutes === undefined || mins > maxTravelMinutes) {
          maxTravelMinutes = mins;
          maxTravelSource = dep.source;
          maxTravelPostcode = dep.postcode;
          maxTravelDayLabel = dep.dayLabel;
        }
      }
    }

    if (maxTravelMinutes !== undefined) {
      // Build accurate summary based on which departure actually produced the max travel time
      let departureSummary = 'home';
      if (maxTravelSource === 'last-client' && maxTravelPostcode) {
        departureSummary = `${maxTravelPostcode} (${maxTravelDayLabel})`;
      }

      // Build per-day travel minutes map so the UI can show the correct travel time per badge
      const travelMinutesByDay = new Map<string, number>();
      for (const dep of cp.departures) {
        const coordKey = `${dep.coords.lat.toFixed(5)},${dep.coords.lng.toFixed(5)}`;
        const mins = coordTravelMap.get(coordKey);
        if (mins !== undefined) {
          // Map each day abbrev (from dayLabel) to the travel time for that day's departure
          const dayAbbrev = dep.dayLabel?.toLowerCase().slice(0, 3) ?? '';
          if (dayAbbrev) travelMinutesByDay.set(dayAbbrev, mins);
        }
      }

      travelTimeMap.set(cp.empName, {
        travelMinutes: maxTravelMinutes,
        departureSource: maxTravelSource || 'home',
        departureSummary,
        departureSummaryByDay,
        travelMinutesByDay: travelMinutesByDay.size > 0 ? travelMinutesByDay : undefined,
      });
    }
  }

  logger.debug(`BD Matcher: travel time complete — ${travelTimeMap.size} total (${batchCarCPs.length} car batch, ${batchNonCarCPs.length} walker batch, ${individualCps.length} schedule-aware individual)`);
  return travelTimeMap;
}

export async function matchClientEnquiry(
  criteria: ClientEnquiryCriteria,
  analysis: CapacityAnalysis,
  branchId?: string,
  storage?: any,
  employeeScheduleMap?: Map<string, Map<string, CpVisitEntry[]>>
): Promise<MatchResult> {
  const employeeSummaryByDate = analysis.employeeSummaryByDate as Record<string, EmployeeSummaryRecord[]>;
  const employeesByDate = analysis.employeesByDate as Record<string, EmployeeDailyDetail[]>;
  
  // CRITICAL: Only use dates from the provided analysis object to ensure we stay within the selected week
  const dates = Object.keys(employeeSummaryByDate).sort();

  if (dates.length === 0) {
    return { criteria, matches: [], totalEmployeesEvaluated: 0 };
  }

  // Pre-filter analysis data to ensure only relevant dates are evaluated
  const filteredSummaryByDate: Record<string, EmployeeSummaryRecord[]> = {};
  const filteredEmployeesByDate: Record<string, EmployeeDailyDetail[]> = {};
  
  const selectedDatesSet = new Set(dates);
  for (const date of Object.keys(employeeSummaryByDate)) {
    if (selectedDatesSet.has(date)) {
      filteredSummaryByDate[date] = employeeSummaryByDate[date];
      filteredEmployeesByDate[date] = employeesByDate[date];
    }
  }

  const { allEmployeeNames, employeeWeeklyData } = await buildEmployeeWeeklyData(
    dates, filteredSummaryByDate, filteredEmployeesByDate, branchId, storage
  );

  let clientCoords: { lat: number; lng: number } | undefined;
  if (branchId && storage && criteria.postcode) {
    const { geocodeWithFallback } = await import('./pipeline');
    const geocoded = await geocodeWithFallback(criteria.postcode, storage, branchId);
    if (geocoded && geocoded.lat && geocoded.lng) {
      clientCoords = { lat: parseFloat(geocoded.lat), lng: parseFloat(geocoded.lng) };
    }
  }

  // Build datesByDay map (day abbrev → actual dates) for schedule-aware departure
  const datesByDay = new Map<string, string[]>();
  for (const dateStr of dates) {
    const dayAbbrev = getDayAbbrev(dateStr);
    const existing = datesByDay.get(dayAbbrev) || [];
    existing.push(dateStr);
    datesByDay.set(dayAbbrev, existing);
  }

  const enquiryStartMinutes = timeToMinutes(criteria.preferredTimeWindow.start);

  let travelTimeMap: Map<string, TravelResult> | undefined;
  if (branchId && clientCoords) {
    try {
      // Build travel times with integrated pre-warming:
      // - Stage 1a: home → enquiry (ORS Matrix batch for cars)
      // - Stage 1b: last-client → enquiry (ORS Matrix batch for cars)
      // - Walkers/public use heuristic fallback (no ORS pre-warm)
      travelTimeMap = await buildTravelTimeMap(
        employeeWeeklyData,
        clientCoords,
        branchId,
        employeeScheduleMap,
        criteria.requiredDays,
        datesByDay,
        enquiryStartMinutes
      );
    } catch (err) {
      logger.warn(`BD Matcher: travel time pre-computation failed, falling back to straight-line: ${err}`);
    }
  }

  const matches = matchEmployeesForVisit(
    criteria.genderPreference || 'any',
    criteria.requiredDays,
    criteria.preferredTimeWindow,
    dates,
    employeeSummaryByDate,
    allEmployeeNames,
    employeeWeeklyData,
    200,
    clientCoords,
    travelTimeMap,
    employeeScheduleMap
  );

  logger.debug(`BD Matcher: evaluated ${allEmployeeNames.size} employees, returning ${matches.length} matches`);

  return {
    criteria,
    matches,
    totalEmployeesEvaluated: allEmployeeNames.size,
  };
}

export async function matchMultiVisitEnquiry(
  criteria: MultiVisitCriteria,
  analysis: CapacityAnalysis,
  branchId?: string,
  storage?: any,
  employeeScheduleMap?: Map<string, Map<string, CpVisitEntry[]>>
): Promise<MultiVisitMatchResult> {
  const employeeSummaryByDate = analysis.employeeSummaryByDate as Record<string, EmployeeSummaryRecord[]>;
  const employeesByDate = analysis.employeesByDate as Record<string, EmployeeDailyDetail[]>;

  // CRITICAL: Only use dates from the provided analysis object to ensure we stay within the selected week
  const dates = Object.keys(employeeSummaryByDate).sort();

  if (dates.length === 0) {
    return {
      clientName: criteria.clientName,
      postcode: criteria.postcode,
      visitResults: criteria.visits.map((v, i) => ({
        visitLabel: v.visitLabel,
        visitIndex: i,
        careProsRequired: v.careProsRequired,
        genderPreferences: v.genderPreferences,
        matches: [],
        totalEmployeesEvaluated: 0,
      })),
      totalVisits: criteria.visits.length,
    };
  }

  // Pre-filter analysis data to ensure only relevant dates are evaluated
  const filteredSummaryByDate: Record<string, EmployeeSummaryRecord[]> = {};
  const filteredEmployeesByDate: Record<string, EmployeeDailyDetail[]> = {};
  
  const selectedDatesSet = new Set(dates);
  for (const date of Object.keys(employeeSummaryByDate)) {
    if (selectedDatesSet.has(date)) {
      filteredSummaryByDate[date] = employeeSummaryByDate[date];
      filteredEmployeesByDate[date] = employeesByDate[date];
    }
  }

  const { allEmployeeNames, employeeWeeklyData } = await buildEmployeeWeeklyData(
    dates, filteredSummaryByDate, filteredEmployeesByDate, branchId, storage
  );

  let clientCoords: { lat: number; lng: number } | undefined;
  if (branchId && storage && criteria.postcode) {
    const { geocodeWithFallback } = await import('./pipeline');
    const geocoded = await geocodeWithFallback(criteria.postcode, storage, branchId);
    if (geocoded && geocoded.lat && geocoded.lng) {
      clientCoords = { lat: parseFloat(geocoded.lat), lng: parseFloat(geocoded.lng) };
    }
  }

  // Build datesByDay for schedule-aware departure point calculation
  const datesByDay = new Map<string, string[]>();
  for (const dateStr of dates) {
    const dayAbbrev = getDayAbbrev(dateStr);
    const existing = datesByDay.get(dayAbbrev) || [];
    existing.push(dateStr);
    datesByDay.set(dayAbbrev, existing);
  }

  const visitResults: VisitMatchResult[] = [];

  for (let i = 0; i < criteria.visits.length; i++) {
    const visit = criteria.visits[i];

    // Build per-visit schedule-aware travel time map (each visit may have different time/days)
    let travelTimeMap: Map<string, TravelResult> | undefined;
    if (branchId && clientCoords) {
      try {
        const enquiryStartMinutes = timeToMinutes(visit.preferredTimeWindow.start);
        travelTimeMap = await buildTravelTimeMap(
          employeeWeeklyData,
          clientCoords,
          branchId,
          employeeScheduleMap,
          visit.requiredDays,
          datesByDay,
          enquiryStartMinutes
        );
      } catch (err) {
        logger.warn(`BD Multi-Visit Matcher: travel time pre-computation failed for visit ${i}: ${err}`);
      }
    }

    const cpMatches: MatchedEmployee[] = [];

    for (let cpIdx = 0; cpIdx < visit.careProsRequired; cpIdx++) {
      const genderPref = visit.genderPreferences[cpIdx] || 'any';
      const alreadyAssigned = new Set(cpMatches.map(m => m.employeeName));

      const filteredNames = new Set(
        Array.from(allEmployeeNames).filter(n => !alreadyAssigned.has(n))
      );

      const matches = matchEmployeesForVisit(
        genderPref,
        visit.requiredDays,
        visit.preferredTimeWindow,
        dates,
        employeeSummaryByDate,
        filteredNames,
        employeeWeeklyData,
        50,
        clientCoords,
        travelTimeMap,
        employeeScheduleMap
      );

      if (matches.length > 0) {
        cpMatches.push(matches[0]);
      }
    }

    const allMatchesForVisit = matchEmployeesForVisit(
      'any',
      visit.requiredDays,
      visit.preferredTimeWindow,
      dates,
      employeeSummaryByDate,
      allEmployeeNames,
      employeeWeeklyData,
      200,
      clientCoords,
      travelTimeMap,
      employeeScheduleMap
    );

    const dedupedMatches: MatchedEmployee[] = [];
    const seenNames = new Set<string>();
    for (const m of cpMatches) {
      if (!seenNames.has(m.employeeName)) {
        seenNames.add(m.employeeName);
        dedupedMatches.push(m);
      }
    }
    for (const m of allMatchesForVisit) {
      if (!seenNames.has(m.employeeName)) {
        seenNames.add(m.employeeName);
        dedupedMatches.push(m);
      }
    }

    visitResults.push({
      visitLabel: visit.visitLabel,
      visitIndex: i,
      careProsRequired: visit.careProsRequired,
      genderPreferences: visit.genderPreferences,
      matches: dedupedMatches,
      totalEmployeesEvaluated: allEmployeeNames.size,
    });
  }

  logger.debug(`BD Multi-Visit Matcher: ${criteria.visits.length} visits, evaluated ${allEmployeeNames.size} employees`);

  return {
    clientName: criteria.clientName,
    postcode: criteria.postcode,
    visitResults,
    totalVisits: criteria.visits.length,
  };
}
