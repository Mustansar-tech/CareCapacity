/**
 * Care Capacity — background worker process
 *
 * Standalone Node.js entry point managed by PM2 alongside the API server.
 * Does NOT start an Express server.
 *
 * Responsibilities
 * ────────────────
 * 1. Weekly People Planner scheduler — three node-cron jobs each Monday
 *    (Europe/London timezone), replacing the old app.ts initScheduler():
 *
 *      01:00  →  previous week  (Mon −7 … Sun −1)
 *      03:00  →  current week   (Mon  0 … Sun +6)
 *      05:00  →  next week      (Mon +7 … Sun +13)
 *
 *    All configured branches are fanned out in parallel for every run.
 *    node-cron keeps the event loop alive so PM2 never needs to force-restart
 *    the worker just because no Playwright work is in-flight.
 *
 * 2. Session pre-warm — all account slots log in / restore saved session files
 *    at startup so the first user-triggered sync of the day is instant.
 *
 * Run via: node dist/worker.js
 * PM2:     see ecosystem.config.cjs
 *
 * Development / manual testing:
 *   tsx server/worker.ts
 *   POST /api/pp/trigger-weekly-sync  (admin-only — fires all three runs now)
 */

import cron from "node-cron";
import { logger } from "./infrastructure/logger";
import { prewarmAllSlots } from "./features/people-planner/automation-engine";
import {
  programmaticQueueSync,
  getConfiguredBranchIds,
} from "./features/people-planner/automation-routes";

logger.info("Care Capacity worker starting");

// ─── Crash protection ─────────────────────────────────────────────────────────
process.on("unhandledRejection", (reason) => {
  logger.error("Worker: unhandled promise rejection — keeping process alive", undefined, {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

process.on("uncaughtException", (err) => {
  // Fatal errors exit so PM2 can restart into a clean state.
  // unhandledRejection is kept alive because Playwright throws these on
  // network failures and they are non-fatal.
  logger.error("Worker: uncaught exception — exiting for clean PM2 restart", err, {
    message: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

// ─── Date helper ──────────────────────────────────────────────────────────────

/**
 * Returns the ISO date (YYYY-MM-DD) of the Monday that is `dayOffset` days
 * from the Monday of the week in which `from` falls.
 *
 *   dayOffset -7  →  previous week's Monday
 *   dayOffset  0  →  current week's Monday
 *   dayOffset +7  →  next week's Monday
 */
export function getMondayWithOffset(from: Date, dayOffset: number): string {
  const d = new Date(from);
  const day = d.getUTCDay(); // 0=Sun … 6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday + dayOffset);
  return d.toISOString().split("T")[0];
}

// ─── Sync fan-out ─────────────────────────────────────────────────────────────

export async function runSync(
  label: "previous" | "current" | "next",
  dayOffset: number,
): Promise<{ succeeded: number; failed: number; total: number; weekStartDate: string }> {
  const weekStartDate = getMondayWithOffset(new Date(), dayOffset);
  const branchIds = getConfiguredBranchIds();

  logger.info(`Worker scheduler: ${label} week sync starting`, {
    weekStartDate,
    branchCount: branchIds.length,
  });

  if (branchIds.length === 0) {
    logger.warn(`Worker scheduler: no branches configured for ${label} run — nothing to do`);
    return { succeeded: 0, failed: 0, total: 0, weekStartDate };
  }

  const results = await Promise.allSettled(
    branchIds.map(async (branchId) => {
      const result = await programmaticQueueSync(
        branchId,
        weekStartDate,
        `worker-scheduler-${label}`,
      );
      logger.info(`Worker scheduler: branch queued (${label})`, {
        branchId,
        weekStartDate,
        sessionId: result.sessionId,
        queued: result.queued,
        queuePosition: result.queuePosition,
      });
      return result;
    }),
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  results.forEach((r, i) => {
    if (r.status === "rejected") {
      logger.error(`Worker scheduler: branch queue failed (${label})`, undefined, {
        branchId: branchIds[i],
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  });

  logger.info(`Worker scheduler: ${label} week sync complete`, {
    weekStartDate,
    succeeded,
    failed,
    total: branchIds.length,
  });

  return { succeeded, failed, total: branchIds.length, weekStartDate };
}

// ─── Three Monday cron jobs (Europe/London) ───────────────────────────────────

if (process.env.ACCESS_EMAIL) {
  // 01:00 — previous week
  cron.schedule("0 1 * * 1", () => {
    logger.info("Worker scheduler: Monday 01:00 cron fired (previous week)");
    runSync("previous", -7).catch((err) => {
      logger.error("Worker scheduler: previous week sync threw", err instanceof Error ? err : undefined);
    });
  }, { timezone: "Europe/London" });

  // 03:00 — current week
  cron.schedule("0 3 * * 1", () => {
    logger.info("Worker scheduler: Monday 03:00 cron fired (current week)");
    runSync("current", 0).catch((err) => {
      logger.error("Worker scheduler: current week sync threw", err instanceof Error ? err : undefined);
    });
  }, { timezone: "Europe/London" });

  // 05:00 — next week
  cron.schedule("0 5 * * 1", () => {
    logger.info("Worker scheduler: Monday 05:00 cron fired (next week)");
    runSync("next", 7).catch((err) => {
      logger.error("Worker scheduler: next week sync threw", err instanceof Error ? err : undefined);
    });
  }, { timezone: "Europe/London" });

  logger.info("Worker: three Monday cron jobs armed", {
    runs: [
      { time: "01:00", label: "previous week", dayOffset: -7 },
      { time: "03:00", label: "current week",  dayOffset:  0 },
      { time: "05:00", label: "next week",     dayOffset: +7 },
    ],
    timezone: "Europe/London",
  });
} else {
  logger.warn("Worker: ACCESS_EMAIL not configured — Monday scheduler not armed");
}

// ─── Startup: pre-warm all sessions ──────────────────────────────────────────

setTimeout(async () => {
  if (!process.env.ACCESS_EMAIL) {
    logger.info("Session pre-warm: ACCESS_EMAIL not configured — skipping");
    return;
  }
  logger.info("Session pre-warm: beginning startup warm-up");
  try {
    await prewarmAllSlots();
  } catch (err) {
    logger.error("Session pre-warm: unexpected top-level error", err instanceof Error ? err : undefined, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}, 5000);

logger.info("Care Capacity worker ready");
