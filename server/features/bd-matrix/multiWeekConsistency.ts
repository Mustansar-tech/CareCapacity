import type { MultiVisitMatchResult, MatchedEmployee, MatchedSlot } from './bdMatcher';

/**
 * Multi-week consistency engine for the Client Enquiry Matcher.
 *
 * Given match results for the same enquiry across several consecutive weeks,
 * this picks the best *consistent* CarePro for every visit/CP/day slot and
 * produces a recommended star map per week (same key format the UI already
 * uses: `${visitIndex}-${cpIdx}-${day}`).
 *
 * Ranking: a carer who can cover the slot in MORE weeks always beats one who
 * can cover fewer (continuity of care first), then lower average travel time,
 * then higher average match score.
 */

export interface StarredEntry {
  employeeName: string;
  timeWindow: string;
  gender?: string;
  transportMode?: string;
  /** true when this star was picked automatically by the consistency engine */
  auto?: boolean;
}
export type StarredMap = Record<string, StarredEntry>;

export interface WeeklyMatchResult {
  weekStartDate: string;
  result: MultiVisitMatchResult;
}

const DAY_ABBREVS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function dateToDayAbbrev(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  return DAY_ABBREVS[d.getUTCDay()];
}

function normalizeDay(d: string): string {
  const map: Record<string, string> = {
    thu: 'thu', thur: 'thu', thurs: 'thu', tues: 'tue',
  };
  const low = d.toLowerCase();
  return map[low] || low;
}

function slotOnDay(match: MatchedEmployee, day: string): MatchedSlot | undefined {
  const target = normalizeDay(day);
  return match.matchedSlots.find(s => {
    const byDate = dateToDayAbbrev(s.day) === target;
    const byLabel = normalizeDay((s.dayLabel || '').split(' ')[0]) === target;
    return byDate || byLabel;
  });
}

function genderOk(match: MatchedEmployee, pref: string): boolean {
  return !pref || pref === 'any' || match.gender?.toLowerCase() === pref.toLowerCase();
}

function slotTravel(match: MatchedEmployee, slot: MatchedSlot): number {
  return slot.travelMinutes ?? match.travelMinutes ?? 9999;
}

/**
 * Compute recommended stars for every week.
 * Returns { [weekStartDate]: StarredMap }.
 */
export function computeConsistentStars(
  weeks: WeeklyMatchResult[],
  visitsCriteria: Array<{ requiredDays: string[]; careProsRequired: number; genderPreferences: string[] }>,
): Record<string, StarredMap> {
  const starsByWeek: Record<string, StarredMap> = {};
  for (const w of weeks) starsByWeek[w.weekStartDate] = {};

  visitsCriteria.forEach((visit, visitIndex) => {
    for (const rawDay of visit.requiredDays) {
      const day = normalizeDay(rawDay);
      // usedByWeek: employees already starred on this visit+day in each week (across CP slots)
      const usedByWeek = new Map<string, Set<string>>();
      for (const w of weeks) usedByWeek.set(w.weekStartDate, new Set());
      // Window chosen by CP1 per week — later CPs prefer the same window (double-up)
      const cp0WindowByWeek = new Map<string, string>();

      for (let cpIdx = 0; cpIdx < visit.careProsRequired; cpIdx++) {
        const pref = visit.genderPreferences[cpIdx] || 'any';

        // Gather per-week eligible candidates
        type Cand = { match: MatchedEmployee; slot: MatchedSlot };
        const perWeek = new Map<string, Cand[]>();
        for (const w of weeks) {
          const vr = w.result.visitResults[visitIndex];
          const used = usedByWeek.get(w.weekStartDate)!;
          const cands: Cand[] = [];
          for (const m of vr?.matches ?? []) {
            if (!genderOk(m, pref)) continue;
            if (used.has(m.employeeName)) continue;
            const slot = slotOnDay(m, day);
            if (!slot) continue;
            cands.push({ match: m, slot });
          }
          perWeek.set(w.weekStartDate, cands);
        }

        // Aggregate stats across weeks per employee
        const stats = new Map<string, { weeks: number; travelSum: number; scoreSum: number; windowMatchWeeks: number }>();
        for (const w of weeks) {
          const cp0Window = cp0WindowByWeek.get(w.weekStartDate);
          for (const c of perWeek.get(w.weekStartDate)!) {
            const s = stats.get(c.match.employeeName) ?? { weeks: 0, travelSum: 0, scoreSum: 0, windowMatchWeeks: 0 };
            s.weeks += 1;
            s.travelSum += slotTravel(c.match, c.slot);
            s.scoreSum += c.match.matchScore ?? 0;
            if (cp0Window && c.slot.availableWindow === cp0Window) s.windowMatchWeeks += 1;
            stats.set(c.match.employeeName, s);
          }
        }
        if (stats.size === 0) continue;

        // Pick the overall winner: most weeks covered, (for double-ups) most weeks
        // overlapping CP1's window, then lowest avg travel, then highest avg score
        const ranked = [...stats.entries()].sort((a, b) => {
          if (b[1].weeks !== a[1].weeks) return b[1].weeks - a[1].weeks;
          if (cpIdx > 0 && b[1].windowMatchWeeks !== a[1].windowMatchWeeks) return b[1].windowMatchWeeks - a[1].windowMatchWeeks;
          const aT = a[1].travelSum / a[1].weeks, bT = b[1].travelSum / b[1].weeks;
          if (aT !== bT) return aT - bT;
          return b[1].scoreSum / b[1].weeks - a[1].scoreSum / a[1].weeks;
        });
        const winner = ranked[0][0];

        // Star per week: winner when available, otherwise the best local alternative
        for (const w of weeks) {
          const cands = perWeek.get(w.weekStartDate)!;
          if (cands.length === 0) continue;
          let chosen = cands.find(c => c.match.employeeName === winner);
          if (!chosen) {
            const cp0Window = cp0WindowByWeek.get(w.weekStartDate);
            const pool = cpIdx > 0 && cp0Window && cands.some(c => c.slot.availableWindow === cp0Window)
              ? cands.filter(c => c.slot.availableWindow === cp0Window)
              : cands;
            chosen = [...pool].sort((a, b) => {
              // Prefer candidates that cover more weeks overall, then travel, then score
              const aw = stats.get(a.match.employeeName)?.weeks ?? 0;
              const bw = stats.get(b.match.employeeName)?.weeks ?? 0;
              if (bw !== aw) return bw - aw;
              const at = slotTravel(a.match, a.slot), bt = slotTravel(b.match, b.slot);
              if (at !== bt) return at - bt;
              return (b.match.matchScore ?? 0) - (a.match.matchScore ?? 0);
            })[0];
          }
          if (!chosen) continue;
          const key = `${visitIndex}-${cpIdx}-${day}`;
          starsByWeek[w.weekStartDate][key] = {
            employeeName: chosen.match.employeeName,
            timeWindow: chosen.slot.availableWindow,
            gender: chosen.match.gender,
            transportMode: chosen.match.transportMode,
            auto: true,
          };
          usedByWeek.get(w.weekStartDate)!.add(chosen.match.employeeName);
          if (cpIdx === 0) cp0WindowByWeek.set(w.weekStartDate, chosen.slot.availableWindow);
        }
      }
    }
  });

  return starsByWeek;
}
