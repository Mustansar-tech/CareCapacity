/**
 * Weekly People Planner scheduler.
 * Fires every Monday at 06:00 UTC (07:00 BST in summer, 06:00 GMT in winter)
 * and queues a full sync for every configured branch, one at a time via the
 * existing session queue.
 */

import { logger } from "../../infrastructure/logger";
import {
  getConfiguredBranchIds,
  programmaticQueueSync,
  updateSchedulerStatus,
} from "./automation-routes";

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;

/** Returns the number of milliseconds until the next Monday at 06:00 UTC. */
function msUntilNextMondayAt6amUTC(): number {
  const now = new Date();
  const next = new Date(now);

  // Day of week: 0=Sun, 1=Mon … 6=Sat
  const day = now.getUTCDay();
  // Days until next Monday (0 if today is Monday but we haven't reached 06:00 yet)
  const daysUntilMonday = day === 1 ? 0 : (8 - day) % 7 || 7;

  next.setUTCDate(now.getUTCDate() + daysUntilMonday);
  next.setUTCHours(6, 0, 0, 0);

  // If we are on Monday but already past 06:00, advance to next Monday
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + 7);
  }

  return next.getTime() - now.getTime();
}

/** Returns an ISO string for the next Monday at 06:00 UTC. */
function nextMondayAt6amUTCIso(): string {
  const now = new Date();
  const next = new Date(now);
  const day = now.getUTCDay();
  const daysUntilMonday = day === 1 ? 0 : (8 - day) % 7 || 7;
  next.setUTCDate(now.getUTCDate() + daysUntilMonday);
  next.setUTCHours(6, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 7);
  return next.toISOString();
}

/** Returns the Monday of the week containing `date` as YYYY-MM-DD (UTC). */
function getMondayOfWeek(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday = 1
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().split("T")[0];
}

/** Queue syncs for all configured branches (they serialise via the session queue). */
async function runWeeklySync(): Promise<void> {
  const branchIds = getConfiguredBranchIds();
  const weekStartDate = getMondayOfWeek(new Date());

  logger.info("Weekly PP scheduler firing", { branchIds, weekStartDate });
  updateSchedulerStatus({ lastRunAt: new Date().toISOString(), lastRunBranchIds: branchIds });

  for (const branchId of branchIds) {
    try {
      const result = await programmaticQueueSync(branchId, weekStartDate, "system-scheduler");
      logger.info("Weekly sync queued for branch", { branchId, ...result });
    } catch (err) {
      logger.error(
        "Failed to queue weekly sync for branch",
        err instanceof Error ? err : undefined,
        { branchId }
      );
    }
  }
}

/** Schedule the next tick and update the scheduler status. */
function scheduleNext(): void {
  if (schedulerTimer) clearTimeout(schedulerTimer);

  const delay = msUntilNextMondayAt6amUTC();
  const nextRunAt = nextMondayAt6amUTCIso();

  updateSchedulerStatus({ enabled: true, nextRunAt });

  logger.info("Weekly PP scheduler armed", {
    nextRunAt,
    delayHours: Math.round(delay / 1000 / 60 / 60),
  });

  schedulerTimer = setTimeout(async () => {
    try {
      await runWeeklySync();
    } finally {
      scheduleNext(); // always re-arm for next Monday
    }
  }, delay);

  // Prevent the timer from keeping the process alive if it shuts down normally
  if (schedulerTimer.unref) schedulerTimer.unref();
}

/** Call once at server startup. */
export function initScheduler(): void {
  scheduleNext();
  logger.info("People Planner weekly scheduler initialised (Monday 06:00 UTC)");
}

/** Tear down the scheduler (useful for tests / clean shutdown). */
export function destroyScheduler(): void {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
  updateSchedulerStatus({ enabled: false, nextRunAt: null });
}
