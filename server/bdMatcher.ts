import { logger } from './logger';
import type { EmployeeSummaryRecord, EmployeeDailyDetail, CapacityAnalysis } from '@shared/schema';
import { geocodeWithFallback } from './pipeline';
import { storage } from './storage';

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  const d = R * c; // Distance in km
  return d;
}

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
    // Must align with a company block start
    const blockStart = getBlockStartMinutes(reqStart);
    if (blockStart === null) continue;

    const slotStart = Math.max(wStart, blockStart);
    const slotEnd = slotStart + visitDuration;
    
    // Exact match must start exactly at the block start and fit in window
    if (slotStart === blockStart && slotEnd <= wEnd) {
      return `${minutesToTime(slotStart)}-${minutesToTime(slotEnd)}`;
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
  const preferredBlockStart = getBlockStartMinutes(reqStart);
  if (preferredBlockStart === null) return null;

  let bestSlot: { window: string; distance: number } | null = null;
  const MAX_DIFF = 150; // 2h 30mins in minutes

  for (const block of COMPANY_TIME_BLOCKS) {
    const blockStart = timeToMinutes(block.start);
    const diff = Math.abs(blockStart - preferredBlockStart);
    
    if (diff > MAX_DIFF) continue;

    for (const [wStart, wEnd] of windows) {
      const slotEnd = blockStart + visitDuration;
      if (blockStart >= wStart && slotEnd <= wEnd) {
        if (!bestSlot || diff < bestSlot.distance) {
          bestSlot = {
            window: `${minutesToTime(blockStart)}-${minutesToTime(slotEnd)}`,
            distance: diff,
          };
        }
      }
    }
  }

  return bestSlot;
}

function buildEmployeeWeeklyData(
  dates: string[],
  employeeSummaryByDate: Record<string, EmployeeSummaryRecord[]>,
  employeesByDate: Record<string, EmployeeDailyDetail[]>
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

  return { allEmployeeNames, employeeWeeklyData };
}

async function matchEmployeesForVisit(
  genderPreference: 'male' | 'female' | 'any',
  requiredDays: string[],
  preferredTimeWindow: { start: string; end: string },
  dates: string[],
  employeeSummaryByDate: Record<string, EmployeeSummaryRecord[]>,
  allEmployeeNames: Set<string>,
  employeeWeeklyData: Map<string, { totalScheduled: number; contractedWeekly: number; gender?: string; transportMode?: string }>,
  topN: number = 50,
  clientCoords?: { lat: number; lng: number },
  clientPostcode?: string
): Promise<MatchedEmployee[]> {
  const reqStart = timeToMinutes(preferredTimeWindow.start);
  const reqEnd = timeToMinutes(preferredTimeWindow.end);
  const visitDuration = 60;

  const datesByDay = new Map<string, string[]>();
  for (const dateStr of dates) {
    const dayAbbrev = getDayAbbrev(dateStr);
    const existing = datesByDay.get(dayAbbrev) || [];
    existing.push(dateStr);
    datesByDay.set(dayAbbrev, existing);
  }

  const candidates: MatchedEmployee[] = [];

  for (const empName of Array.from(allEmployeeNames)) {
    const weeklyData = employeeWeeklyData.get(empName)!;
    
    let distanceBonus = 0;
    const empLoc = await storage.getEmployeeLocationByName(process.env.DEFAULT_BRANCH_ID || '', empName);
    
    // 1. Try Geocode Distance (Most Accurate)
    if (clientCoords && empLoc && empLoc.homeLat && empLoc.homeLng) {
      const dist = calculateDistance(
        clientCoords.lat, clientCoords.lng,
        parseFloat(empLoc.homeLat), parseFloat(empLoc.homeLng)
      );
      distanceBonus = Math.max(0, 20 - (dist * 2)); // 20 points for 0km, 0 points for 10km+
    } 
    // 2. Fallback to Postcode Prefix Matching (Fast & Reliable)
    else if (clientPostcode && empLoc && empLoc.postcode) {
      const cPC = clientPostcode.trim().toUpperCase().replace(/\s+/g, '');
      const ePC = empLoc.postcode.trim().toUpperCase().replace(/\s+/g, '');
      
      if (cPC === ePC) {
        distanceBonus = 20; // Exact postcode match
      } else if (cPC.substring(0, 4) === ePC.substring(0, 4)) {
        distanceBonus = 15; // Sector match (e.g., G22 5)
      } else if (cPC.substring(0, 3) === ePC.substring(0, 3)) {
        distanceBonus = 10; // District match (e.g., G22)
      } else if (cPC.substring(0, 2) === ePC.substring(0, 2)) {
        distanceBonus = 5; // Area match (e.g., G2)
      }
    }

    if (
      genderPreference &&
      genderPreference !== 'any' &&
      weeklyData.gender &&
      weeklyData.gender !== genderPreference
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

        const freeWindows = parseFreeWindows(empSummary.freeWindows);
        const exactSlot = findExactSlot(freeWindows, reqStart, reqEnd, visitDuration);

      if (exactSlot && bestScoreForDay < 100) {
        bestSlotForDay = {
          day: dateStr,
          dayLabel: getDayLabel(dateStr),
          availableWindow: exactSlot,
          matchType: 'exact',
        };
        bestScoreForDay = 100;
      } else if (!exactSlot && bestScoreForDay < 90) { // Increased threshold
        const closestSlot = findClosestSlot(freeWindows, reqStart, reqEnd, visitDuration);
        if (closestSlot) {
          const score = Math.max(0, 90 - closestSlot.distance / 5); // Base 90 for adjusted time
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

        const freeWindows = parseFreeWindows(empSummary.freeWindows);
        const exactSlot = findExactSlot(freeWindows, reqStart, reqEnd, visitDuration);

        if (exactSlot) {
          matchedSlots.push({
            day: dateStr,
            dayLabel: getDayLabel(dateStr),
            availableWindow: exactSlot,
            matchType: 'alternative-day',
          });
          alternativeDayMatches++;
          totalScore += 70; // Increased from 40
          if (matchedSlots.length >= Math.max(1, requiredDays.length)) break;
        } else {
          const closestSlot = findClosestSlot(freeWindows, reqStart, reqEnd, visitDuration);
          if (closestSlot) {
            matchedSlots.push({
              day: dateStr,
              dayLabel: getDayLabel(dateStr),
              availableWindow: closestSlot.window,
              matchType: 'alternative-day',
            });
            alternativeDayMatches++;
            totalScore += Math.max(0, 60 - closestSlot.distance / 10); // Increased from 20
            if (matchedSlots.length >= Math.max(1, requiredDays.length)) break;
          }
        }
      }
    }

    if (matchedSlots.length === 0) continue;

    const avgScore = totalScore / Math.max(requiredDays.length, 1);
    const dayMatchRatio = matchedSlots.filter(s => s.matchType === 'exact').length / Math.max(requiredDays.length, 1);
    const capacityBonus = Math.min(20, remainingCapacity * 2);
    const finalScore = Math.round((avgScore * 0.4 + dayMatchRatio * 100 * 0.2 + capacityBonus * 0.15 + distanceBonus * 0.25) * 100) / 100;

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

  // Debug: Log evaluation result
  logger.debug(`BD Matcher: evaluated ${allEmployeeNames.size} employees, found ${candidates.length} candidates before filtering`);

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
  storage?: any,
  branchId?: string
): Promise<MatchResult> {
  const employeeSummaryByDate = analysis.employeeSummaryByDate as Record<string, EmployeeSummaryRecord[]>;
  const employeesByDate = analysis.employeesByDate as Record<string, EmployeeDailyDetail[]>;
  const dates = Object.keys(employeeSummaryByDate).sort();

  if (dates.length === 0) {
    return { criteria, matches: [], totalEmployeesEvaluated: 0 };
  }

  const { allEmployeeNames, employeeWeeklyData } = buildEmployeeWeeklyData(
    dates, employeeSummaryByDate, employeesByDate
  );

  let clientCoords: { lat: number; lng: number } | undefined;
  if (criteria.postcode) {
    try {
      const geo = await geocodeWithFallback(criteria.postcode, storage, branchId || 'default');
      if (geo) {
        clientCoords = { lat: Number(geo.lat), lng: Number(geo.lng) };
      }
    } catch (error) {
      logger.error(`Geocoding failed for postcode ${criteria.postcode}:`, error);
    }
  }
  
  // Debug: Log coordinates and postcode
  logger.debug(`BD Matcher Search: Postcode=${criteria.postcode}, Coords=${JSON.stringify(clientCoords)}`);

  const matches = await matchEmployeesForVisit(
    criteria.genderPreference || 'any',
    criteria.requiredDays,
    criteria.preferredTimeWindow,
    dates,
    employeeSummaryByDate,
    allEmployeeNames,
    employeeWeeklyData,
    50,
    clientCoords,
    criteria.postcode
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
  storage?: any,
  branchId?: string
): Promise<MultiVisitMatchResult> {
  const employeeSummaryByDate = analysis.employeeSummaryByDate as Record<string, EmployeeSummaryRecord[]>;
  const employeesByDate = analysis.employeesByDate as Record<string, EmployeeDailyDetail[]>;
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

  let clientCoords: { lat: number; lng: number } | undefined;
  if (criteria.postcode) {
    try {
      const geo = await geocodeWithFallback(criteria.postcode, storage, branchId || 'default');
      if (geo) {
        clientCoords = { lat: Number(geo.lat), lng: Number(geo.lng) };
      }
    } catch (error) {
      logger.error(`Geocoding failed for postcode ${criteria.postcode}:`, error);
    }
  }
  
  // Debug: Log coordinates and postcode
  logger.debug(`BD Matcher Search: Postcode=${criteria.postcode}, Coords=${JSON.stringify(clientCoords)}`);

  const { allEmployeeNames, employeeWeeklyData } = buildEmployeeWeeklyData(
    dates, employeeSummaryByDate, employeesByDate
  );

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

      const matches = await matchEmployeesForVisit(
        genderPref,
        visit.requiredDays,
        visit.preferredTimeWindow,
        dates,
        employeeSummaryByDate,
        filteredNames,
        employeeWeeklyData,
        5,
        clientCoords,
        criteria.postcode
      );

      if (matches.length > 0) {
        cpMatches.push(matches[0]);
      }
    }

    const allMatchesForVisit = await matchEmployeesForVisit(
      'any',
      visit.requiredDays,
      visit.preferredTimeWindow,
      dates,
      employeeSummaryByDate,
      allEmployeeNames,
      employeeWeeklyData,
      visit.careProsRequired * 3,
      clientCoords,
      criteria.postcode
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
