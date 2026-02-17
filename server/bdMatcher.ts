import { logger } from './logger';
import type { EmployeeSummaryRecord, EmployeeDailyDetail, CapacityAnalysis } from '@shared/schema';

export interface ClientEnquiryCriteria {
  clientName: string;
  postcode?: string;
  genderPreference?: 'male' | 'female' | 'any';
  requiredDays: string[];
  preferredTimeWindow: { start: string; end: string };
  visitDurationMinutes: number;
  weeklyHoursNeeded?: number;
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

function findExactSlot(
  windows: Array<[number, number]>,
  reqStart: number,
  reqEnd: number,
  visitDuration: number
): string | null {
  for (const [wStart, wEnd] of windows) {
    const slotStart = Math.max(wStart, reqStart);
    const slotEnd = slotStart + visitDuration;
    if (slotEnd <= wEnd && slotEnd <= reqEnd) {
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
  let bestSlot: { window: string; distance: number } | null = null;

  for (const [wStart, wEnd] of windows) {
    const gapLength = wEnd - wStart;
    if (gapLength < visitDuration) continue;

    const fitStart = Math.max(wStart, Math.min(reqStart, wEnd - visitDuration));
    const fitEnd = fitStart + visitDuration;

    if (fitEnd <= wEnd) {
      const distanceFromPreferred = Math.abs(fitStart - reqStart);
      if (!bestSlot || distanceFromPreferred < bestSlot.distance) {
        bestSlot = {
          window: `${minutesToTime(fitStart)}-${minutesToTime(fitEnd)}`,
          distance: distanceFromPreferred,
        };
      }
    }
  }

  return bestSlot;
}

export function matchClientEnquiry(
  criteria: ClientEnquiryCriteria,
  analysis: CapacityAnalysis
): MatchResult {
  const employeeSummaryByDate = analysis.employeeSummaryByDate as Record<string, EmployeeSummaryRecord[]>;
  const employeesByDate = analysis.employeesByDate as Record<string, EmployeeDailyDetail[]>;
  const dates = Object.keys(employeeSummaryByDate).sort();

  if (dates.length === 0) {
    return { criteria, matches: [], totalEmployeesEvaluated: 0 };
  }

  const reqStart = timeToMinutes(criteria.preferredTimeWindow.start);
  const reqEnd = timeToMinutes(criteria.preferredTimeWindow.end);
  const visitDuration = criteria.visitDurationMinutes;

  const datesByDay = new Map<string, string[]>();
  for (const dateStr of dates) {
    const dayAbbrev = getDayAbbrev(dateStr);
    const existing = datesByDay.get(dayAbbrev) || [];
    existing.push(dateStr);
    datesByDay.set(dayAbbrev, existing);
  }

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

  const employeeList = Array.from(allEmployeeNames);
  for (const empName of employeeList) {
    let totalScheduled = 0;
    let totalContractedDaily = 0;
    let daysWithContracted = 0;
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
        daysWithContracted++;
      }
    }

    const contractedWeekly = totalContractedDaily > 0
      ? Math.round(totalContractedDaily * 100) / 100
      : 0;

    employeeWeeklyData.set(empName, {
      totalScheduled: Math.round(totalScheduled * 100) / 100,
      contractedWeekly,
      gender,
      transportMode,
    });
  }

  const candidates: MatchedEmployee[] = [];

  const allEmployeeList = Array.from(allEmployeeNames);

  for (const empName of allEmployeeList) {
    const weeklyData = employeeWeeklyData.get(empName)!;

    if (
      criteria.genderPreference &&
      criteria.genderPreference !== 'any' &&
      weeklyData.gender &&
      weeklyData.gender !== criteria.genderPreference
    ) {
      continue;
    }

    const remainingCapacity = Math.max(0, weeklyData.contractedWeekly - weeklyData.totalScheduled);

    if (criteria.weeklyHoursNeeded && remainingCapacity < criteria.weeklyHoursNeeded) {
      continue;
    }

    const matchedSlots: MatchedSlot[] = [];
    let totalScore = 0;
    let exactDayMatches = 0;
    let adjustedTimeMatches = 0;
    let alternativeDayMatches = 0;

    for (const reqDay of criteria.requiredDays) {
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
        } else if (!exactSlot && bestScoreForDay < 80) {
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
        if (criteria.requiredDays.includes(dayAbbrev)) continue;

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
          totalScore += 40;
          if (matchedSlots.length >= criteria.requiredDays.length) break;
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
            totalScore += Math.max(0, 20 - closestSlot.distance / 10);
            if (matchedSlots.length >= criteria.requiredDays.length) break;
          }
        }
      }
    }

    if (matchedSlots.length === 0) continue;

    const avgScore = totalScore / Math.max(criteria.requiredDays.length, 1);
    const dayMatchRatio = matchedSlots.filter(s => s.matchType === 'exact').length / Math.max(criteria.requiredDays.length, 1);
    const capacityBonus = Math.min(20, remainingCapacity * 2);
    const finalScore = Math.round((avgScore * 0.6 + dayMatchRatio * 100 * 0.25 + capacityBonus * 0.15) * 100) / 100;

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

  const topMatches = candidates.slice(0, 5);

  logger.debug(`BD Matcher: evaluated ${allEmployeeNames.size} employees, found ${candidates.length} candidates, returning top ${topMatches.length}`);

  return {
    criteria,
    matches: topMatches,
    totalEmployeesEvaluated: allEmployeeNames.size,
  };
}
