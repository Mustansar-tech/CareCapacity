import { logger } from './logger';
import type { EmployeeSummaryRecord, EmployeeDailyDetail, CapacityAnalysis } from '@shared/schema';

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

function timeToMinutes(timeStr: string): number {
  const parts = timeStr.split(':').map(Number);
  return parts[0] * 60 + (parts[1] || 0);
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function parseFreeWindows(freeWindows: string): Array<[number, number]> {
  if (!freeWindows || freeWindows === '-' || freeWindows === '') return [];

  const normalized = freeWindows.replace(/\u2013|\u2014/g, '-');

  return normalized
    .split(',')
    .map(w => w.trim())
    .filter(w => w && w.includes('-'))
    .map(w => {
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
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
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

  // First, check if the requested block is contained ANYWHERE in the free windows.
  // This handles the "generic" match case where an employee has a broad window
  // that covers the requested block, regardless of company block alignment.
  for (const [wStart, wEnd] of windows) {
    if (reqStart >= wStart && (reqStart + visitDuration) <= wEnd) {
      return {
        window: `${minutesToTime(reqStart)}-${minutesToTime(reqStart + visitDuration)}`,
        distance: 0
      };
    }
  }

  // Fallback to searching around the requested time within the windows
  for (const [wStart, wEnd] of windows) {
    if (wEnd - wStart >= visitDuration) {
      // Try each company block start time that fits in this window
      for (const block of COMPANY_TIME_BLOCKS) {
        const blockStart = timeToMinutes(block.start);
        const blockEnd = blockStart + visitDuration;
        
        // Block must fit within the free window
        if (blockStart >= wStart && blockEnd <= wEnd) {
          const diff = Math.abs(blockStart - reqStart);
          if (diff <= MAX_DIFF) {
            // Priority: Smallest distance to requested time among standard blocks
            if (!bestSlot || diff < bestSlot.distance) {
              bestSlot = {
                window: `${minutesToTime(blockStart)}-${minutesToTime(blockEnd)}`,
                distance: diff,
              };
            }
          }
        }
      }
    }
  }

  // Final fallback: If NO standard block fits the window, only then use a non-standard time
  if (!bestSlot) {
    for (const [wStart, wEnd] of windows) {
      if (wEnd - wStart >= visitDuration) {
        let closestStart: number;
        if (reqStart < wStart) {
          closestStart = wStart;
        } else if (reqStart > (wEnd - visitDuration)) {
          closestStart = wEnd - visitDuration;
        } else {
          closestStart = reqStart;
        }

        const diffFallback = Math.abs(closestStart - reqStart);
        if (diffFallback <= MAX_DIFF) {
          if (!bestSlot || diffFallback < (bestSlot as any).distance) {
            bestSlot = {
              window: `${minutesToTime(closestStart)}-${minutesToTime(closestStart + visitDuration)}`,
              distance: diffFallback,
            };
          }
        }
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
    homeLat?: number;
    homeLng?: number;
  }>();

  for (const empName of Array.from(allEmployeeNames)) {
    let totalScheduled = 0;
    let totalContractedDaily = 0;
    let gender: string | undefined;
    let transportMode: string | undefined;

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
    });
  }

  if (branchId && storage) {
    for (const [empName, data] of Array.from(employeeWeeklyData.entries())) {
      const loc = await storage.getEmployeeLocationByName(branchId, empName);
      if (loc && loc.homeLat && loc.homeLng) {
        data.homeLat = parseFloat(loc.homeLat.toString());
        data.homeLng = parseFloat(loc.homeLng.toString());
      }
    }
  }

  return { allEmployeeNames, employeeWeeklyData };
}

function isFullyAvailableInTimeBlock(freeWindows: string, reqStart: number, reqEnd: number): boolean {
  if (!freeWindows || freeWindows === '-' || freeWindows === '') return false;
  const windows = parseFreeWindows(freeWindows);
  for (const [wStart, wEnd] of windows) {
    if (wStart <= reqStart && wEnd >= reqEnd) return true;
  }
  return false;
}

function matchEmployeesForVisit(
  genderPreference: 'male' | 'female' | 'any',
  requiredDays: string[],
  preferredTimeWindow: { start: string; end: string },
  dates: string[],
  employeeSummaryByDate: Record<string, EmployeeSummaryRecord[]>,
  allEmployeeNames: Set<string>,
  employeeWeeklyData: Map<string, { totalScheduled: number; contractedWeekly: number; gender?: string; transportMode?: string; homeLat?: number; homeLng?: number }>,
  topN: number = 50,
  clientLocation?: { lat: number; lng: number }
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
      weeklyData.gender.trim().toLowerCase() !== genderPreference.trim().toLowerCase()
    ) {
      continue;
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

        // NEW LOGIC: Use the exact same availability check as the BD Matrix grid
        const isAvailable = isFullyAvailableInTimeBlock(empSummary.freeWindows, reqStart, reqEnd);

        if (isAvailable) {
          bestSlotForDay = {
            day: dateStr,
            dayLabel: getDayLabel(dateStr),
            availableWindow: `${preferredTimeWindow.start}-${preferredTimeWindow.end}`,
            matchType: 'exact',
          };
          bestScoreForDay = 100;
        } else {
          // Fallback to adjusted time if not fully available in the requested block
          const freeWindows = parseFreeWindows(empSummary.freeWindows);
          const closestSlot = findClosestSlot(freeWindows, reqStart, reqEnd, visitDuration);
          if (closestSlot) {
            const score = Math.max(0, 80 - closestSlot.distance / 5);
            if (score > bestScoreForDay) {
              bestSlotForDay = {
                day: dateStr,
                dayLabel: getDayLabel(dateStr),
                availableWindow: closestSlot.window,
                matchType: 'adjusted-time',
              };
              bestScoreForDay = score;
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

    if (matchedSlots.length === 0) {
      for (const dateStr of dates) {
        const dayAbbrev = getDayAbbrev(dateStr);
        if (requiredDays.includes(dayAbbrev)) continue;

        const summaries = employeeSummaryByDate[dateStr] || [];
        const empSummary = summaries.find(s => s.employeeName === empName);
        if (!empSummary) continue;

        const isAvailable = isFullyAvailableInTimeBlock(empSummary.freeWindows, reqStart, reqEnd);

        if (isAvailable) {
          matchedSlots.push({
            day: dateStr,
            dayLabel: getDayLabel(dateStr),
            availableWindow: `${preferredTimeWindow.start}-${preferredTimeWindow.end}`,
            matchType: 'alternative-day',
          });
          alternativeDayMatches++;
          totalScore += 40;
          if (matchedSlots.length >= requiredDays.length) break;
        } else {
          const freeWindows = parseFreeWindows(empSummary.freeWindows);
          const closestSlot = findClosestSlot(freeWindows, reqStart, reqEnd, visitDuration);
          if (closestSlot) {
            matchedSlots.push({
              day: dateStr,
              dayLabel: getDayLabel(dateStr),
              availableWindow: closestSlot.window,
              matchType: 'alternative-day',
            });
            alternativeDayMatches++;
            totalScore += Math.max(0, 20 - closestSlot.distance / 10);
            if (matchedSlots.length >= requiredDays.length) break;
          }
        }
      }
    }

    if (matchedSlots.length === 0) continue;

    const avgScore = totalScore / Math.max(requiredDays.length, 1);
    const dayMatchRatio = matchedSlots.filter(s => s.matchType === 'exact').length / Math.max(requiredDays.length, 1);
    const capacityBonus = Math.min(20, remainingCapacity * 2);

    let travelBonus = 0;
    if (clientLocation && weeklyData.homeLat && weeklyData.homeLng) {
      const latDiff = clientLocation.lat - weeklyData.homeLat;
      const lngDiff = clientLocation.lng - weeklyData.homeLng;
      const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
      travelBonus = Math.max(0, 15 - (distance * 100)); 
    }

    const finalScore = Math.round((avgScore * 0.5 + dayMatchRatio * 100 * 0.2 + capacityBonus * 0.15 + travelBonus) * 100) / 100;

    let overallMatchType: 'exact' | 'adjusted-time' | 'alternative-day' = 'exact';
    if (alternativeDayMatches > 0) overallMatchType = 'alternative-day';
    else if (adjustedTimeMatches > 0) overallMatchType = 'adjusted-time';

    candidates.push({
      employeeName: empName,
      matchType: overallMatchType,
      matchScore: finalScore,
      gender: weeklyData.gender,
      transportMode: weeklyData.transportMode,
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

export async function matchClientEnquiry(
  criteria: ClientEnquiryCriteria,
  analysis: CapacityAnalysis,
  branchId?: string,
  storage?: any
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

  const matches = matchEmployeesForVisit(
    criteria.genderPreference || 'any',
    criteria.requiredDays,
    criteria.preferredTimeWindow,
    dates,
    employeeSummaryByDate,
    allEmployeeNames,
    employeeWeeklyData,
    50,
    clientCoords
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
  storage?: any
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

  const visitResults: VisitMatchResult[] = [];

  for (let i = 0; i < criteria.visits.length; i++) {
    const visit = criteria.visits[i];
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
        50, // Increase topN for multi-visit matches
        clientCoords
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
      100, // Further increase to ensure no one is missed
      clientCoords
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
      if (!seenNames.has(m.employeeName) && dedupedMatches.length < visit.careProsRequired * 3) {
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
