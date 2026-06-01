/**
 * Daily People Planner scheduler.
 *
 * Fires once per weekday (Mon–Fri) at 01:00 UTC.
 *
 * Monday run:  previous week + current week + all generated forward weeks
 * Tue–Fri run: current week  + all generated forward weeks
 *
 * "Generated forward weeks" = Mondays from current week up to:
 *   - Normal weeks  : last Monday of next month  (~5–8 weeks)
 *   - Last week of month: last Monday of month-after-next (~9–13 weeks)
 *
 * Each branch is processed in one multi-week session (login once, iterate weeks, logout).
 */

import { logger } from "../../infrastructure/logger";
import {
  getConfiguredBranchIds,
  programmaticQueueMultiWeekSync,
  updateSchedulerStatus,
} from "./automation-routes";
import { getWeeksToSync } from "./week-helpers";

export { getWeeksToSync };

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Returns ms until the next Mon–Fri at 01:00 UTC.
 * If today is a weekday but we've already passed 01:00, advances to tomorrow
 * (skipping weekend).
 */
function msUntilNextWeekdayAtHourUTC(): number {
  return nextWeekdayAtHourUTC().getTime() - Date.now();
}

function nextWeekdayAtHourUTC(targetHour = 1): Date {
  const now = new Date();
  const candidate = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    targetHour, 0, 0, 0,
  ));

  // Advance until we land on a weekday that is still in the future.
  while (true) {
    const day = candidate.getUTCDay(); // 0=Sun, 6=Sat
    if (day !== 0 && day !== 6 && candidate > now) break;
    candidate.setUTCDate(candidate.getUTCDate() + 1);
    candidate.setUTCHours(targetHour, 0, 0, 0);
  }
  return candidate;
}

// ─── Timer handle ─────────────────────────────────────────────────────────────

let timer: ReturnType<typeof setTimeout> | null = null;

// ─── Single daily run ─────────────────────────────────────────────────────────

async function runSync(): Promise<void> {
  const now = new Date();
  const isMonday = now.getUTCDay() === 1;
  const weeksToDo = getWeeksToSync(now, isMonday);
  const branchIds = getConfiguredBranchIds();

  logger.info("PP daily sync firing", {
    isMonday,
    weekCount: weeksToDo.length,
    weeks: weeksToDo,
    branchCount: branchIds.length,
  });

  updateSchedulerStatus({
    lastRunAt: now.toISOString(),
    lastRunBranchIds: branchIds,
  });

  for (const branchId of branchIds) {
    try {
      const result = await programmaticQueueMultiWeekSync(
        branchId,
        weeksToDo,
        "system-scheduler",
      );
      logger.info("Daily sync queued", { branchId, weekCount: weeksToDo.length, ...result });
    } catch (err) {
      logger.error(
        "Failed to queue daily sync",
        err instanceof Error ? err : undefined,
        { branchId, weekCount: weeksToDo.length }
      );
    }
  }
}

// ─── Scheduler arm / disarm ───────────────────────────────────────────────────

function armTimer(): void {
  if (timer) clearTimeout(timer);

  const delay = msUntilNextWeekdayAtHourUTC();
  const nextRunAt = nextWeekdayAtHourUTC().toISOString();

  logger.info("PP daily scheduler armed", {
    nextRunAt,
    delayHours: +(delay / 1000 / 60 / 60).toFixed(2),
  });

  updateSchedulerStatus({ nextRunAt });

  timer = setTimeout(async () => {
    try {
      await runSync();
    } finally {
      armTimer(); // re-arm for the next weekday
    }
  }, delay);

  timer!.unref?.();
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function initScheduler(): void {
  armTimer();

  updateSchedulerStatus({
    enabled: true,
    nextRunAt: nextWeekdayAtHourUTC().toISOString(),
  });

  logger.info("People Planner daily scheduler initialised", {
    nextRun: nextWeekdayAtHourUTC().toISOString(),
  });
}

export function destroyScheduler(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  updateSchedulerStatus({ enabled: false, nextRunAt: null });
}
