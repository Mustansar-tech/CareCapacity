import type { MultiVisitMatchResult, MatchedEmployee, MatchedSlot } from './bdMatcher';
import { isFullyAvailableInTimeBlock, timeToMinutes } from './bdMatcher';

/**
 * Multi-week consistency engine for the Client Enquiry Matcher.
 *
 * Priorities (mirrors real care practice):
 *  1. TIME FIRST — the client's visit should happen at the SAME time every
 *     day and every week, as close as possible to the time they asked for.
 *     A consistent time is chosen for the whole visit before carers are picked.
 *  2. BEST TRAVEL TIME + CONTINUITY PER DAY — holding that time fixed, carers
 *     are assigned one day-of-week at a time (e.g. every Monday across all
 *     weeks together). For each day, the carer with the best (lowest) average
 *     travel time wins; ties are broken by who can cover that same day across
 *     the most weeks (continuity per day — the same carer every Monday).
 *  3. CONTINUITY PER WEEK (secondary) — only when travel time and per-day
 *     continuity are still tied does the engine prefer a carer who is already
 *     covering other days within the same week, to minimise the number of
 *     distinct carers a client sees in one week.
 *  4. Only when nobody can serve the chosen time on a given day/week does it
 *     fall back to the nearest time — preferring the closest travel time,
 *     then carers already on the rota.
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
 * True when a candidate's raw free-time windows for the day can cover the given
 * "HH:MM-HH:MM" window in full — even if their own precomputed slot (nearest to
 * the ORIGINAL requested time) points at a different window. This is what lets a
 * second/third CP on a joint visit line up with the first CP's actual chosen
 * time instead of only their own independently-guessed nearest slot.
 */
function canCoverWindow(rawFreeWindows: string | undefined, window: string): boolean {
  if (!rawFreeWindows) return false;
  const [startStr, endStr] = window.split(/[-–]/).map(s => s.trim());
  if (!startStr || !endStr) return false;
  return isFullyAvailableInTimeBlock(rawFreeWindows, timeToMinutes(startStr), timeToMinutes(endStr));
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

      // For double-ups, restrict each cell's pool to CP1's window when possible.
      // A candidate counts as available at CP1's window either because their own
      // precomputed slot already lands there, or because their raw free-time
      // windows for the day can genuinely cover it (even though their own
      // independently-guessed nearest slot points elsewhere) — otherwise a
      // perfectly free CP gets excluded just because two people's fallback
      // slots were computed relative to the original request, not each other.
      const poolFor = (key: CellKey): Cand[] => {
        const cands = cellCands.get(key) ?? [];
        if (cpIdx === 0) return cands;
        const cp0Window = cp0WindowByCell.get(key);
        if (!cp0Window) return cands;
        const overlapping = cands
          .map(c => {
            const exact = c.slots.find(s => s.availableWindow === cp0Window);
            if (exact) return { ...c, slots: [exact] };
            const covering = c.slots.find(s => canCoverWindow(s.rawFreeWindows, cp0Window));
            if (covering) return { ...c, slots: [{ ...covering, availableWindow: cp0Window, matchType: 'adjusted-time' as const }] };
            return null;
          })
          .filter((c): c is Cand => c !== null);
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

      // ── STEP 2: cover cells at the target window ──
      // Assign carers one day-of-week at a time (e.g. every Monday across all
      // weeks together), so a single greedy pick settles both the day's best
      // travel time AND that day's continuity across weeks in one go. Ranking
      // per day-of-week group: (1) best average travel time, (2) continuity
      // per day — covers this same day across the most weeks, (3) continuity
      // per week — already covering other days within the same week(s),
      // (4) match score.
      type Assigned = { match: MatchedEmployee; slot: MatchedSlot };
      const assignment = new Map<CellKey, Assigned>();
      // week -> carerName -> number of days already assigned to them this week
      const weekRosterCount = new Map<string, Map<string, number>>();
      for (const w of weeks) weekRosterCount.set(w.weekStartDate, new Map());
      const weekRosterFor = (name: string, weeksList: string[]): number =>
        weeksList.reduce((sum, wk) => sum + (weekRosterCount.get(wk)?.get(name) ?? 0), 0);

      for (const day of days) {
        const dayCells = allCells.filter(c => c.day === day);
        const uncovered = new Set<CellKey>(
          dayCells.filter(c => poolFor(c.key).some(x => x.slots.some(s => s.availableWindow === targetWindow))).map(c => c.key)
        );
        while (uncovered.size > 0) {
          // carer -> cells (with their week) they can take at the target window
          const carerCells = new Map<string, Array<{ key: CellKey; week: string; cand: Assigned }>>();
          for (const key of uncovered) {
            const cell = dayCells.find(x => x.key === key)!;
            for (const cand of poolFor(key)) {
              const slot = cand.slots.find(s => s.availableWindow === targetWindow);
              if (!slot) continue;
              const arr = carerCells.get(cand.match.employeeName) ?? [];
              arr.push({ key, week: cell.week, cand: { match: cand.match, slot } });
              carerCells.set(cand.match.employeeName, arr);
            }
          }
          if (carerCells.size === 0) break;
          const [bestName, bestCells] = [...carerCells.entries()].sort((a, b) => {
            const avgTravel = (arr: typeof a[1]) =>
              arr.reduce((s, x) => s + slotTravel(x.cand.match, x.cand.slot), 0) / arr.length;
            const at = avgTravel(a[1]), bt = avgTravel(b[1]);
            if (at !== bt) return at - bt; // 1) best travel time
            if (b[1].length !== a[1].length) return b[1].length - a[1].length; // 2) continuity per day (weeks of this day covered)
            const aRoster = weekRosterFor(a[0], a[1].map(x => x.week));
            const bRoster = weekRosterFor(b[0], b[1].map(x => x.week));
            if (bRoster !== aRoster) return bRoster - aRoster; // 3) continuity per week
            const score = (arr: typeof a[1]) =>
              arr.reduce((s, x) => s + (x.cand.match.matchScore ?? 0), 0) / arr.length;
            return score(b[1]) - score(a[1]); // 4) match score
          })[0];
          for (const { key, week, cand } of bestCells) {
            assignment.set(key, cand);
            uncovered.delete(key);
            const m = weekRosterCount.get(week)!;
            m.set(bestName, (m.get(bestName) ?? 0) + 1);
          }
        }
      }

      // ── STEP 3: cells nobody can serve at the target time ──
      // Fall back to the nearest time to the target, then the best travel
      // time, then a carer already on this visit's rota (fewest new faces).
      const rosterCounts = new Map<string, number>();
      for (const cand of assignment.values()) {
        rosterCounts.set(cand.match.employeeName, (rosterCounts.get(cand.match.employeeName) ?? 0) + 1);
      }
      for (const c of allCells) {
        if (assignment.has(c.key)) continue;
        const pool = poolFor(c.key);
        if (pool.length === 0) continue;
        // For CP2+, line up with CP1's actual chosen time for THIS cell (which may
        // itself be a fallback, not the visit-wide target) — not the global target —
        // so the two CPs on a joint visit end up at the same time on the same day.
        const cellTarget = (cpIdx > 0 && cp0WindowByCell.get(c.key)) || targetWindow;
        // For each candidate use their slot nearest the target time
        const flattened = pool.map(cand => {
          const slot = [...cand.slots].sort((x, y) =>
            windowGap(x.availableWindow, cellTarget) - windowGap(y.availableWindow, cellTarget))[0];
          return { match: cand.match, slot };
        });
        const chosen = flattened.sort((a, b) => {
          // Time closeness first (this is a fallback for an unmet target time)
          const ag = windowGap(a.slot.availableWindow, cellTarget);
          const bg = windowGap(b.slot.availableWindow, cellTarget);
          if (ag !== bg) return ag - bg;
          const at = slotTravel(a.match, a.slot), bt = slotTravel(b.match, b.slot);
          if (at !== bt) return at - bt; // best travel time
          const aKnown = rosterCounts.get(a.match.employeeName) ?? 0;
          const bKnown = rosterCounts.get(b.match.employeeName) ?? 0;
          if (bKnown !== aKnown) return bKnown - aKnown; // continuity (already on rota)
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
