/**
 * Weekly People Planner scheduler.
 * Fires every Monday at 06:00 UTC (07:00 BST in summer, 06:00 GMT in winter)
 * and queues a full sync for every configured branch, one at a time via the
 * existing session queue.
 */

import type { Express } from "express";
import { requireAuth, requireRoleAtLeast } from "../../features/auth/auth";
import { logger } from "../../infrastructure/logger";
import {
  getConfiguredBranchIds,
  programmaticQueueSync,
  updateSchedulerStatus,
  getSchedulerStatus,
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

/**
 * Returns the Monday of the *previous* full week as YYYY-MM-DD (UTC).
 * When called on Monday 4 May it returns 2026-04-27 (last Mon),
 * so the sync covers the completed Mon–Sun week.
 */
function getPreviousWeekMonday(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun … 6=Sat
  // Step 1: rewind to the current Monday (or stay if already Monday)
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  // Step 2: go back one full week to the *previous* Monday
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().split("T")[0];
}

/** Queue syncs for all configured branches (they serialise via the session queue). */
export async function runWeeklySync(): Promise<void> {
  const branchIds = getConfiguredBranchIds();
  // Always process the previous full Mon–Sun week
  const weekStartDate = getPreviousWeekMonday(new Date());

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

/**
 * Register scheduler-specific API routes.
 *
 * POST /api/pp/scheduler/trigger  (admin only)
 *   Immediately runs the weekly sync — useful for testing without waiting until Monday.
 *   Queues all configured branches for the previous full Mon–Sun week.
 */
export function registerSchedulerRoutes(app: Express): void {
  app.post(
    "/api/pp/scheduler/trigger",
    requireAuth,
    requireRoleAtLeast("admin"),
    async (_req, res) => {
      try {
        logger.info("Manual scheduler trigger requested by admin");
        // Run in background — respond immediately so the client isn't blocked
        runWeeklySync().catch(err =>
          logger.error("Manual trigger runWeeklySync failed", err instanceof Error ? err : undefined)
        );
        const status = getSchedulerStatus();
        res.json({
          triggered: true,
          weekStartDate: getPreviousWeekMonday(new Date()),
          branchIds: getConfiguredBranchIds(),
          nextScheduledRun: status.nextRunAt,
        });
      } catch (err) {
        logger.error("Failed to trigger scheduler", err instanceof Error ? err : undefined);
        res.status(500).json({ error: "Failed to trigger scheduler" });
      }
    }
  );
}
