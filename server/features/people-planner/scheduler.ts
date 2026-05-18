/**
 * Weekly People Planner scheduler.
 *
 * Three runs every Monday (UTC):
 *   01:00  →  previous week  (Mon -7  … Sun -1)
 *   03:00  →  current week   (Mon  0  … Sun +6)
 *   05:00  →  next week      (Mon +7  … Sun +13)
 *
 * Each run queues all configured branches one-at-a-time via the existing
 * session queue.
 */

import { logger } from "../../infrastructure/logger";
import {
  getConfiguredBranchIds,
  programmaticQueueSync,
  updateSchedulerStatus,
} from "./automation-routes";

// ─── Run definitions ──────────────────────────────────────────────────────────

interface RunDef {
  /** UTC hour at which this run fires (0-23) */
  hour: number;
  /** Days to offset from the firing Monday (negative = past, positive = future) */
  weekDayOffset: number;
  label: "previous" | "current" | "next";
}

const RUN_DEFS: RunDef[] = [
  { hour: 1, weekDayOffset: -7, label: "previous" },
  { hour: 3, weekDayOffset:  0, label: "current"  },
  { hour: 5, weekDayOffset: +7, label: "next"      },
];

// ─── Timer handles ────────────────────────────────────────────────────────────

const timers: (ReturnType<typeof setTimeout> | null)[] = RUN_DEFS.map(() => null);

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Returns ms until the next Monday at `targetHour:00:00 UTC`.
 * If today is Monday but we've already passed `targetHour`, advances to the
 * following Monday.
 */
function msUntilNextMondayAtHourUTC(targetHour: number): number {
  return nextMondayAtHourUTC(targetHour).getTime() - Date.now();
}

function nextMondayAtHourUTC(targetHour: number): Date {
  const now = new Date();
  const next = new Date(now);
  const day = now.getUTCDay(); // 0=Sun … 6=Sat
  const daysUntilMonday = day === 1 ? 0 : (8 - day) % 7 || 7;
  next.setUTCDate(now.getUTCDate() + daysUntilMonday);
  next.setUTCHours(targetHour, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 7);
  return next;
}

/**
 * Returns the Monday of the *current* firing week offset by `dayOffset` days,
 * as YYYY-MM-DD (UTC).
 *
 * Example — firing on Monday 4 May:
 *   dayOffset  -7 → 2026-04-27  (previous week)
 *   dayOffset   0 → 2026-05-04  (current week)
 *   dayOffset  +7 → 2026-05-11  (next week)
 */
function getMondayWithOffset(firingDate: Date, dayOffset: number): string {
  const d = new Date(firingDate);
  // Snap to the Monday of the firing week
  const day = d.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday + dayOffset);
  return d.toISOString().split("T")[0];
}

// ─── Single run ───────────────────────────────────────────────────────────────

async function runSync(def: RunDef): Promise<void> {
  const branchIds = getConfiguredBranchIds();
  const weekStartDate = getMondayWithOffset(new Date(), def.weekDayOffset);

  logger.info("PP scheduled sync firing", { label: def.label, weekStartDate, branchIds });
  updateSchedulerStatus({
    lastRunAt: new Date().toISOString(),
    lastRunBranchIds: branchIds,
  });

  for (const branchId of branchIds) {
    try {
      const result = await programmaticQueueSync(branchId, weekStartDate, `system-scheduler-${def.label}`);
      logger.info("Scheduled sync queued", { label: def.label, branchId, weekStartDate, ...result });
    } catch (err) {
      logger.error(
        "Failed to queue scheduled sync",
        err instanceof Error ? err : undefined,
        { label: def.label, branchId, weekStartDate }
      );
    }
  }
}

// ─── Scheduler arm / disarm ───────────────────────────────────────────────────

function armRun(index: number): void {
  const def = RUN_DEFS[index];
  if (timers[index]) clearTimeout(timers[index]!);

  const delay = msUntilNextMondayAtHourUTC(def.hour);
  const nextRunAt = nextMondayAtHourUTC(def.hour).toISOString();

  logger.info("PP scheduler armed", {
    label: def.label,
    nextRunAt,
    delayHours: Math.round(delay / 1000 / 60 / 60),
  });

  timers[index] = setTimeout(async () => {
    try {
      await runSync(def);
    } finally {
      armRun(index); // re-arm for the following Monday
    }
  }, delay);

  timers[index]!.unref?.();
}

function buildNextRunsSummary(): Record<string, string> {
  return Object.fromEntries(
    RUN_DEFS.map(def => [def.label, nextMondayAtHourUTC(def.hour).toISOString()])
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function initScheduler(): void {
  RUN_DEFS.forEach((_, i) => armRun(i));

  updateSchedulerStatus({
    enabled: true,
    nextRunAt: nextMondayAtHourUTC(RUN_DEFS[0].hour).toISOString(),
  });

  logger.info("People Planner weekly scheduler initialised", buildNextRunsSummary());
}

export function destroyScheduler(): void {
  timers.forEach((t, i) => {
    if (t) { clearTimeout(t); timers[i] = null; }
  });
  updateSchedulerStatus({ enabled: false, nextRunAt: null });
}
