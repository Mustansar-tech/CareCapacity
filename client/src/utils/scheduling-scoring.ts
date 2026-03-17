// Scoring system for ranking best client matches in scheduling

import { TimeWindow, getTravelMinutes, calculateInsertionGap, isInsertionFeasible, MAX_TRAVEL_TIME_MINUTES } from './scheduling-utils';

export interface Visit {
  clientName: string;
  start: number; // minutes since midnight
  end: number;
  lat: number;
  lng: number;
}

export interface AssignedVisit extends Visit {
  travelFromPrev?: number;
  travelToNext?: number;
}

export interface EmployeeRun {
  visits: AssignedVisit[];
  homeLat: number;
  homeLng: number;
  mode: 'car' | 'walking' | 'public';
}

export interface MatchScore {
  visit: Visit;
  score: number;
  breakdown: {
    tightness: number;    // Preference for tight schedules (smaller gaps)
    travelAdded: number;  // Preference for minimal travel time
    windowSlack: number;  // Preference for visits near window boundaries
    homeProximity: number; // Preference for visits close to home
  };
  insertionIndex: number;
  travelFromPrev: number;
  travelToNext: number;
  gap: number;
}

// Scoring weights (optimized for MAXIMUM VISIT COVERAGE)
// Prioritize filling as many visits as possible over travel efficiency
const WEIGHTS = {
  tightness: 0.10,      // Some weight for tight scheduling
  travelAdded: 0.25,    // Reduced - travel distance matters less than coverage
  windowSlack: 0.40,    // High weight - prefer visits that fit well in windows
  homeProximity: 0.25,  // Prefer routes near home but don't reject far ones
};

// Calculate score for a candidate visit insertion
export function scoreVisitMatch(
  visit: Visit,
  employeeRun: EmployeeRun,
  windows: TimeWindow[]
): MatchScore | null {
  const { visits, homeLat, homeLng, mode } = employeeRun;

  // Find best insertion point that maintains CHRONOLOGICAL ORDER
  let bestIndex = 0;
  let bestGap = Infinity;
  let travelFromPrev = 0;
  let travelToNext = 0;

  // Try each position, but ONLY if it maintains chronological order
  for (let i = 0; i <= visits.length; i++) {
    const prevVisit = i > 0 ? visits[i - 1] : null;
    const nextVisit = i < visits.length ? visits[i] : null;

    // CRITICAL: Check chronological order FIRST
    // If previous visit starts after this one, skip this position
    if (prevVisit && prevVisit.start > visit.start) {
      continue; // Cannot insert here - would break chronology
    }
    
    // If next visit starts before this one, skip this position
    if (nextVisit && nextVisit.start < visit.start) {
      continue; // Cannot insert here - would break chronology
    }

    const travelFrom = prevVisit
      ? getTravelMinutes({ lat: prevVisit.lat, lng: prevVisit.lng }, { lat: visit.lat, lng: visit.lng }, mode, visit.start)
      : 0;

    const travelTo = nextVisit
      ? getTravelMinutes({ lat: visit.lat, lng: visit.lng }, { lat: nextVisit.lat, lng: nextVisit.lng }, mode, visit.end)
      : 0;

    if (travelFrom > MAX_TRAVEL_TIME_MINUTES || travelTo > MAX_TRAVEL_TIME_MINUTES) {
      continue;
    }

    const gap = calculateInsertionGap(
      visit,
      prevVisit,
      nextVisit,
      travelFrom,
      travelTo
    );

    if (gap < bestGap && gap >= 0) {
      bestGap = gap;
      bestIndex = i;
      travelFromPrev = travelFrom;
      travelToNext = travelTo;
    }
  }

  // Check feasibility at best insertion point
  const prevVisit = bestIndex > 0 ? visits[bestIndex - 1] : null;
  const nextVisit = bestIndex < visits.length ? visits[bestIndex] : null;

  const isFeasible = isInsertionFeasible(
    { start: visit.start, end: visit.end },
    prevVisit,
    nextVisit,
    { lat: visit.lat, lng: visit.lng },
    windows,
    mode
  );

  if (!isFeasible) {
    return null; // Visit is not feasible for this employee
  }

  // Calculate breakdown scores

  // 1. Tightness score (gaps are acceptable, MINIMAL penalty)
  // Max gap considered is 480 minutes (8 hours) - even very large gaps are fine
  // We want to fill capacity, not create tight schedules
  const tightnessScore = Math.max(0.3, 1 - (bestGap / 480)); // Minimum 0.3 score for any feasible gap

  // 2. Travel added score (prefer minimal travel)
  // Calculate current route travel
  let currentTravel = 0;
  for (let i = 0; i < visits.length - 1; i++) {
    const travel = getTravelMinutes(
      { lat: visits[i].lat, lng: visits[i].lng },
      { lat: visits[i + 1].lat, lng: visits[i + 1].lng },
      mode,
      visits[i].end // Use end time of current visit as travel start
    );
    currentTravel += travel;
  }

  // Calculate new route travel with insertion
  let newTravel = currentTravel + travelFromPrev + travelToNext;
  if (bestIndex > 0 && bestIndex < visits.length) {
    // Subtract the old direct travel that's being replaced
    const oldDirect = getTravelMinutes(
      { lat: visits[bestIndex - 1].lat, lng: visits[bestIndex - 1].lng },
      { lat: visits[bestIndex].lat, lng: visits[bestIndex].lng },
      mode,
      visits[bestIndex - 1].end // Use end time of previous visit
    );
    newTravel -= oldDirect;
  }

  const travelAdded = newTravel - currentTravel;
  // Score based on travel added - use 120 minutes as reference (very lenient to maximize coverage)
  // Longer travel is acceptable if it helps utilize capacity
  const travelAddedScore = Math.max(0, 1 - (travelAdded / 120));

  // 3. Window slack score (prefer visits that use window time efficiently)
  // Find the tightest window that contains this visit
  const containingWindows = windows.filter(
    w => visit.start >= w.start && visit.end <= w.end
  );

  let windowSlackScore = 0.5; // default if no containing window
  if (containingWindows.length > 0) {
    const slacks = containingWindows.map(w => {
      const startSlack = visit.start - w.start;
      const endSlack = w.end - visit.end;
      return startSlack + endSlack;
    });
    const minSlack = Math.min(...slacks);
    // Max slack considered is 480 minutes (8 hours) - very lenient
    // If visit fits in window, give it a high score regardless of slack
    windowSlackScore = Math.max(0.7, 1 - (minSlack / 480)); // Minimum 0.7 for any window fit
  }

  // 4. Home proximity score (prefer visits closer to home for first/last)
  let homeProximityScore = 0.5; // default for middle visits

  if (bestIndex === 0 || (visits.length === 0)) {
    const distFromHome = getTravelMinutes(
      { lat: homeLat, lng: homeLng },
      { lat: visit.lat, lng: visit.lng },
      mode,
      visit.start
    );

    if (distFromHome > MAX_TRAVEL_TIME_MINUTES) {
      return null;
    }

    homeProximityScore = Math.max(0, 1 - (distFromHome / MAX_TRAVEL_TIME_MINUTES));
  } else if (bestIndex === visits.length) {
    const distToHome = getTravelMinutes(
      { lat: visit.lat, lng: visit.lng },
      { lat: homeLat, lng: homeLng },
      mode,
      visit.end
    );

    if (distToHome > MAX_TRAVEL_TIME_MINUTES) {
      return null;
    }

    homeProximityScore = Math.max(0, 1 - (distToHome / MAX_TRAVEL_TIME_MINUTES));
  }

  // Calculate weighted total score
  const totalScore =
    WEIGHTS.tightness * tightnessScore +
    WEIGHTS.travelAdded * travelAddedScore +
    WEIGHTS.windowSlack * windowSlackScore +
    WEIGHTS.homeProximity * homeProximityScore;

  return {
    visit,
    score: totalScore,
    breakdown: {
      tightness: tightnessScore,
      travelAdded: travelAddedScore,
      windowSlack: windowSlackScore,
      homeProximity: homeProximityScore,
    },
    insertionIndex: bestIndex,
    travelFromPrev,
    travelToNext,
    gap: bestGap,
  };
}

// Get top N best matches for an employee
export function getTopMatches(
  unallocatedVisits: Visit[],
  employeeRun: EmployeeRun,
  windows: TimeWindow[],
  topN: number = 5
): MatchScore[] {
  const scores: MatchScore[] = [];

  for (const visit of unallocatedVisits) {
    const score = scoreVisitMatch(visit, employeeRun, windows);
    if (score && score.gap >= 0) {
      scores.push(score);
    }
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  return scores.slice(0, topN);
}