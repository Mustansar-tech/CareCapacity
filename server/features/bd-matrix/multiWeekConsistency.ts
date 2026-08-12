import type { MultiVisitMatchResult, MatchedEmployee, MatchedSlot } from './bdMatcher';

/**
 * Multi-week consistency engine for the Client Enquiry Matcher.
 *
 * "Consistency" here mirrors real care practice — a PRIMARY CarePro:
 *  1. One carer should cover the visit on EVERY required day, EVERY week
 *     (not a different carer per day of the week).
 *  2. The visit TIME should be consistent and as close as possible to the
 *     time the client asked for, across all days and weeks.
 *
 * Ranking for the primary carer (per visit/CP):
 *  1. Most (week × day) cells covered — the carer who can do the most of the
 *     whole schedule wins.
 *  2. Time consistency — how many of their cells can be served at their most
 *     common time window.
 *  3. Closeness of their windows to the client's requested start time.
 *  4. Lowest average travel, then highest average match score.
 *
 * When the primary can't cover a specific day/week, the fallback cascades
 * down the same ranked list (so the same backup carer is reused wherever
 * possible) instead of picking an ad-hoc local best each time.
 *
 * Double-ups: CP2+ must overlap CP1's chosen window for the same cell, and be
 * a different person from CP1 in that cell.
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

export interface VisitCriteria {
  requiredDays: string[];
  careProsRequired: number;
  genderPreferences: string[];
  /** Client's requested time window, e.g. { start: "15:30", end: "16:30" } */
  preferredTimeWindow?: { start?: string; end?: string };
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

function toMinutes(hhmm: string | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) return null;
  return parseInt(m[1]) * 60 + parseInt(m[2]);
}

/** Distance (minutes) between a window's start and the client's requested start */
function windowDistance(window: string, requestedStartMins: number | null): number {
  if (requestedStartMins == null) return 0;
  const start = toMinutes(window.split(/[-–]/)[0]);
  if (start == null) return 0;
  return Math.abs(start - requestedStartMins);
}

/**
 * Compute recommended stars for every week.
 * Returns { [weekStartDate]: StarredMap }.
 */
export function computeConsistentStars(
  weeks: WeeklyMatchResult[],
  visitsCriteria: VisitCriteria[],
): Record<string, StarredMap> {
  const starsByWeek: Record<string, StarredMap> = {};
  for (const w of weeks) starsByWeek[w.weekStartDate] = {};

  visitsCriteria.forEach((visit, visitIndex) => {
    const days = visit.requiredDays.map(normalizeDay);
    const requestedStart = toMinutes(visit.preferredTimeWindow?.start);

    // A "cell" is one (week, day) the visit must be covered on
    type CellKey = string; // `${weekStartDate}|${day}`
    const cellKey = (week: string, day: string): CellKey => `${week}|${day}`;

    // Employees already starred per cell (across CP slots), for double-ups
    const usedByCell = new Map<CellKey, Set<string>>();
    // Window chosen by CP1 per cell — later CPs must overlap the same window
    const cp0WindowByCell = new Map<CellKey, string>();
    for (const w of weeks) for (const d of days) usedByCell.set(cellKey(w.weekStartDate, d), new Set());

    for (let cpIdx = 0; cpIdx < visit.careProsRequired; cpIdx++) {
      const pref = visit.genderPreferences[cpIdx] || 'any';

      // Eligible candidate per cell: employee -> { match, slot }
      type Cand = { match: MatchedEmployee; slot: MatchedSlot };
      const cellCands = new Map<CellKey, Cand[]>();
      for (const w of weeks) {
        const vr = w.result.visitResults[visitIndex];
        for (const d of days) {
          const key = cellKey(w.weekStartDate, d);
          const used = usedByCell.get(key)!;
          const cands: Cand[] = [];
          for (const m of vr?.matches ?? []) {
            if (!genderOk(m, pref)) continue;
            if (used.has(m.employeeName)) continue;
            const slot = slotOnDay(m, d);
            if (!slot) continue;
            cands.push({ match: m, slot });
          }
          cellCands.set(key, cands);
        }
      }

      // Aggregate stats across ALL cells (every day of every week) per employee
      const stats = new Map<string, {
        cells: number;
        windowCounts: Map<string, number>;
        distSum: number;
        travelSum: number;
        scoreSum: number;
        cp0OverlapCells: number;
      }>();
      for (const [key, cands] of cellCands) {
        const cp0Window = cp0WindowByCell.get(key);
        for (const c of cands) {
          const s = stats.get(c.match.employeeName) ?? {
            cells: 0, windowCounts: new Map(), distSum: 0, travelSum: 0, scoreSum: 0, cp0OverlapCells: 0,
          };
          s.cells += 1;
          s.windowCounts.set(c.slot.availableWindow, (s.windowCounts.get(c.slot.availableWindow) ?? 0) + 1);
          s.distSum += windowDistance(c.slot.availableWindow, requestedStart);
          s.travelSum += slotTravel(c.match, c.slot);
          s.scoreSum += c.match.matchScore ?? 0;
          if (cp0Window && c.slot.availableWindow === cp0Window) s.cp0OverlapCells += 1;
          stats.set(c.match.employeeName, s);
        }
      }
      if (stats.size === 0) continue;

      // Rank candidates for PRIMARY carer across the whole schedule:
      // coverage → (double-up) CP1 overlap → time consistency → closeness to
      // requested time → travel → score
      const modal = (s: { windowCounts: Map<string, number> }) => Math.max(...s.windowCounts.values());
      const ranked = [...stats.entries()].sort((a, b) => {
        if (b[1].cells !== a[1].cells) return b[1].cells - a[1].cells;
        if (cpIdx > 0 && b[1].cp0OverlapCells !== a[1].cp0OverlapCells) return b[1].cp0OverlapCells - a[1].cp0OverlapCells;
        const am = modal(a[1]) / a[1].cells, bm = modal(b[1]) / b[1].cells;
        if (am !== bm) return bm - am;
        const ad = a[1].distSum / a[1].cells, bd = b[1].distSum / b[1].cells;
        if (ad !== bd) return ad - bd;
        const at = a[1].travelSum / a[1].cells, bt = b[1].travelSum / b[1].cells;
        if (at !== bt) return at - bt;
        return b[1].scoreSum / b[1].cells - a[1].scoreSum / a[1].cells;
      }).map(([name]) => name);

      // Star every cell: cascade down the ranked list so the primary carer is
      // used wherever available and the SAME backup is reused when not.
      for (const w of weeks) {
        for (const d of days) {
          const key = cellKey(w.weekStartDate, d);
          const cands = cellCands.get(key)!;
          if (cands.length === 0) continue;

          const cp0Window = cp0WindowByCell.get(key);
          const pool = cpIdx > 0 && cp0Window && cands.some(c => c.slot.availableWindow === cp0Window)
            ? cands.filter(c => c.slot.availableWindow === cp0Window)
            : cands;

          let chosen: Cand | undefined;
          for (const name of ranked) {
            chosen = pool.find(c => c.match.employeeName === name);
            if (chosen) break;
          }
          if (!chosen) chosen = pool[0];
          if (!chosen) continue;

          const starKey = `${visitIndex}-${cpIdx}-${d}`;
          starsByWeek[w.weekStartDate][starKey] = {
            employeeName: chosen.match.employeeName,
            timeWindow: chosen.slot.availableWindow,
            gender: chosen.match.gender,
            transportMode: chosen.match.transportMode,
            auto: true,
          };
          usedByCell.get(key)!.add(chosen.match.employeeName);
          if (cpIdx === 0) cp0WindowByCell.set(key, chosen.slot.availableWindow);
        }
      }
    }
  });

  return starsByWeek;
}
