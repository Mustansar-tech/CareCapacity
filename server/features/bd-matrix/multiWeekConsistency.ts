import type { MultiVisitMatchResult, MatchedEmployee, MatchedSlot } from './bdMatcher';

/**
 * Multi-week consistency engine for the Client Enquiry Matcher.
 *
 * Priorities (mirrors real care practice):
 *  1. TIME FIRST — the client's visit should happen at the SAME time every
 *     day and every week, as close as possible to the time they asked for.
 *     A consistent time is chosen for the whole visit before carers are picked.
 *  2. FEWEST CARERS — holding that time fixed, cover the schedule with as few
 *     carers as possible. One primary carer for everything is ideal; if that's
 *     impossible at a consistent time, a stable split (e.g. one carer Mon–Wed,
 *     another Thu–Fri) beats one carer at scattered times.
 *  3. Only when nobody can serve the chosen time on a given day/week does it
 *     fall back to the nearest time — preferring carers already on the rota.
 *
 * Double-ups: CP2+ must overlap CP1's chosen window in each cell and be a
 * different person from CP1 in that cell.
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

function slotsOnDay(match: MatchedEmployee, day: string): MatchedSlot[] {
  const target = normalizeDay(day);
  return match.matchedSlots.filter(s => {
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

function windowStart(window: string): number | null {
  return toMinutes(window.split(/[-–]/)[0]);
}

/** Distance (minutes) between two windows' start times */
function windowGap(a: string, b: string): number {
  const sa = windowStart(a), sb = windowStart(b);
  if (sa == null || sb == null) return a === b ? 0 : 9999;
  return Math.abs(sa - sb);
}

/** Distance (minutes) between a window's start and the requested start */
function distToRequested(window: string, requestedStartMins: number | null): number {
  if (requestedStartMins == null) return 0;
  const start = windowStart(window);
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
    const allCells: Array<{ key: CellKey; week: string; day: string }> = [];
    for (const w of weeks) for (const d of days) allCells.push({ key: cellKey(w.weekStartDate, d), week: w.weekStartDate, day: d });

    // Employees already starred per cell (across CP slots), for double-ups
    const usedByCell = new Map<CellKey, Set<string>>();
    // Window chosen by CP1 per cell — later CPs must overlap the same window
    const cp0WindowByCell = new Map<CellKey, string>();
    for (const c of allCells) usedByCell.set(c.key, new Set());

    for (let cpIdx = 0; cpIdx < visit.careProsRequired; cpIdx++) {
      const pref = visit.genderPreferences[cpIdx] || 'any';

      // Eligible candidates per cell (ALL of a carer's slots on that day)
      type Cand = { match: MatchedEmployee; slots: MatchedSlot[] };
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
            const slots = slotsOnDay(m, d);
            if (slots.length === 0) continue;
            cands.push({ match: m, slots });
          }
          cellCands.set(key, cands);
        }
      }

      // For double-ups, restrict each cell's pool to CP1's window when possible
      const poolFor = (key: CellKey): Cand[] => {
        const cands = cellCands.get(key) ?? [];
        if (cpIdx === 0) return cands;
        const cp0Window = cp0WindowByCell.get(key);
        if (!cp0Window) return cands;
        const overlapping = cands
          .filter(c => c.slots.some(s => s.availableWindow === cp0Window))
          .map(c => ({ ...c, slots: c.slots.filter(s => s.availableWindow === cp0Window) }));
        return overlapping.length > 0 ? overlapping : cands;
      };

      // ── STEP 1: choose ONE target time window for the whole visit ──
      // Rank windows by: how many cells can be served at that exact window,
      // then closeness to the client's requested time.
      const windowCoverage = new Map<string, number>();
      for (const c of allCells) {
        const seen = new Set<string>();
        for (const cand of poolFor(c.key)) for (const s of cand.slots) seen.add(s.availableWindow);
        for (const wdw of seen) windowCoverage.set(wdw, (windowCoverage.get(wdw) ?? 0) + 1);
      }
      if (windowCoverage.size === 0) continue;
      const targetWindow = [...windowCoverage.entries()].sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return distToRequested(a[0], requestedStart) - distToRequested(b[0], requestedStart);
      })[0][0];

      // ── STEP 2: cover cells at the target window with the FEWEST carers ──
      // Greedy set-cover: repeatedly pick the carer who can serve the most
      // still-uncovered cells at the target window.
      type Assigned = { match: MatchedEmployee; slot: MatchedSlot };
      const assignment = new Map<CellKey, Assigned>();
      const uncoveredAtTarget = new Set<CellKey>(
        allCells.filter(c => poolFor(c.key).some(x => x.slots.some(s => s.availableWindow === targetWindow))).map(c => c.key)
      );
      while (uncoveredAtTarget.size > 0) {
        // carer -> cells they can take at the target window
        const carerCells = new Map<string, Array<{ key: CellKey; cand: Assigned }>>();
        for (const key of uncoveredAtTarget) {
          for (const cand of poolFor(key)) {
            const slot = cand.slots.find(s => s.availableWindow === targetWindow);
            if (!slot) continue;
            const arr = carerCells.get(cand.match.employeeName) ?? [];
            arr.push({ key, cand: { match: cand.match, slot } });
            carerCells.set(cand.match.employeeName, arr);
          }
        }
        if (carerCells.size === 0) break;
        const best = [...carerCells.entries()].sort((a, b) => {
          if (b[1].length !== a[1].length) return b[1].length - a[1].length;
          const avg = (arr: Array<{ cand: Assigned }>) =>
            arr.reduce((s, x) => s + slotTravel(x.cand.match, x.cand.slot), 0) / arr.length;
          const at = avg(a[1]), bt = avg(b[1]);
          if (at !== bt) return at - bt;
          const score = (arr: Array<{ cand: Assigned }>) =>
            arr.reduce((s, x) => s + (x.cand.match.matchScore ?? 0), 0) / arr.length;
          return score(b[1]) - score(a[1]);
        })[0][1];
        for (const { key, cand } of best) {
          assignment.set(key, cand);
          uncoveredAtTarget.delete(key);
        }
      }

      // ── STEP 3: cells nobody can serve at the target time ──
      // Fall back to the nearest time to the target, preferring carers who are
      // already on this visit's rota (fewest new faces).
      const rosterCounts = new Map<string, number>();
      for (const cand of assignment.values()) {
        rosterCounts.set(cand.match.employeeName, (rosterCounts.get(cand.match.employeeName) ?? 0) + 1);
      }
      for (const c of allCells) {
        if (assignment.has(c.key)) continue;
        const pool = poolFor(c.key);
        if (pool.length === 0) continue;
        // For each candidate use their slot nearest the target time
        const flattened = pool.map(cand => {
          const slot = [...cand.slots].sort((x, y) =>
            windowGap(x.availableWindow, targetWindow) - windowGap(y.availableWindow, targetWindow))[0];
          return { match: cand.match, slot };
        });
        const chosen = flattened.sort((a, b) => {
          const aKnown = rosterCounts.get(a.match.employeeName) ?? 0;
          const bKnown = rosterCounts.get(b.match.employeeName) ?? 0;
          // Time closeness first, then prefer a carer already on the rota
          const ag = windowGap(a.slot.availableWindow, targetWindow);
          const bg = windowGap(b.slot.availableWindow, targetWindow);
          if (ag !== bg) return ag - bg;
          if (bKnown !== aKnown) return bKnown - aKnown;
          const at = slotTravel(a.match, a.slot), bt = slotTravel(b.match, b.slot);
          if (at !== bt) return at - bt;
          return (b.match.matchScore ?? 0) - (a.match.matchScore ?? 0);
        })[0];
        assignment.set(c.key, chosen);
        rosterCounts.set(chosen.match.employeeName, (rosterCounts.get(chosen.match.employeeName) ?? 0) + 1);
      }

      // ── Write stars ──
      for (const c of allCells) {
        const chosen = assignment.get(c.key);
        if (!chosen) continue;
        const starKey = `${visitIndex}-${cpIdx}-${c.day}`;
        starsByWeek[c.week][starKey] = {
          employeeName: chosen.match.employeeName,
          timeWindow: chosen.slot.availableWindow,
          gender: chosen.match.gender,
          transportMode: chosen.match.transportMode,
          auto: true,
        };
        usedByCell.get(c.key)!.add(chosen.match.employeeName);
        if (cpIdx === 0) cp0WindowByCell.set(c.key, chosen.slot.availableWindow);
      }
    }
  });

  return starsByWeek;
}
