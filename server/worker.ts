/**
 * Care Capacity — background worker process
 *
 * Standalone Node.js entry point managed by PM2 alongside the API server.
 * Does NOT start an Express server.
 *
 * Responsibilities
 * ────────────────
 * 1. Weekly People Planner scheduler — three node-cron jobs every Monday
 *    (Europe/London timezone):
 *      01:00  →  previous week  (replaces external cron-job.org trigger)
 *      03:00  →  current week
 *      05:00  →  next week
 *    All configured branches are fanned out in parallel for each run.
 *    node-cron keeps the event loop alive (no unref), so PM2 never needs to
 *    restart the worker just because no Playwright work is in-flight.
 *
 * 2. Session pre-warm — all account slots log in / restore saved session files
 *    at startup so the first user-triggered sync of the day is instant.
 *
 * Run via: node dist/worker.js
 * PM2:     see ecosystem.config.cjs
 *
 * Development testing:
 *   tsx server/worker.ts
 *   (arms the cron jobs + pre-warms sessions without starting the Express API)
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
  logger.error("Worker: uncaught exception — keeping process alive", err, {
    message: err.message,
    stack: err.stack,
  });
});

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the ISO date (YYYY-MM-DD) of the Monday that is `dayOffset` days
 * from the Monday of the week in which `from` falls.
 *
 * Examples when `from` is any day of the week of Mon 12 May 2026:
 *   dayOffset -7  →  "2026-05-05"  (previous week)
 *   dayOffset  0  →  "2026-05-12"  (current week)
 *   dayOffset +7  →  "2026-05-19"  (next week)
 */
function getMondayWithOffset(from: Date, dayOffset: number): string {
  const d = new Date(from);
  const day = d.getUTCDay(); // 0=Sun…6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday + dayOffset);
  return d.toISOString().split("T")[0];
}

// ─── Sync fan-out ─────────────────────────────────────────────────────────────

async function runSync(label: "previous" | "current" | "next", dayOffset: number): Promise<void> {
  const now = new Date();
  const weekStartDate = getMondayWithOffset(now, dayOffset);
  const branchIds = getConfiguredBranchIds();

  logger.info(`Worker scheduler: firing ${label} week run`, {
    weekStartDate,
    branchCount: branchIds.length,
  });

  if (branchIds.length === 0) {
    logger.warn(`Worker scheduler: no branches configured for ${label} run — nothing to do`);
    return;
  }

  // Fan all branches out simultaneously across the account slot pool.
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

  if (failed > 0) {
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        logger.error(`Worker scheduler: branch queue failed (${label})`, undefined, {
          branchId: branchIds[i],
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    });
  }

  logger.info(`Worker scheduler: ${label} run complete`, {
    weekStartDate,
    succeeded,
    failed,
    total: branchIds.length,
  });
}

// ─── Three Monday cron jobs (Europe/London) ───────────────────────────────────
// node-cron does NOT unref its internal timers, so these keep the process alive
// in a standalone worker without Express holding the event loop open.

if (process.env.ACCESS_EMAIL) {
  // 01:00 — previous week
  cron.schedule("0 1 * * 1", () => {
    logger.info("Worker scheduler: Monday 01:00 cron fired (previous week)");
    runSync("previous", -7).catch((err) => {
      logger.error("Worker scheduler: previous week run threw", err instanceof Error ? err : undefined);
    });
  }, { timezone: "Europe/London" });

  // 03:00 — current week
  cron.schedule("0 3 * * 1", () => {
    logger.info("Worker scheduler: Monday 03:00 cron fired (current week)");
    runSync("current", 0).catch((err) => {
      logger.error("Worker scheduler: current week run threw", err instanceof Error ? err : undefined);
    });
  }, { timezone: "Europe/London" });

  // 05:00 — next week
  cron.schedule("0 5 * * 1", () => {
    logger.info("Worker scheduler: Monday 05:00 cron fired (next week)");
    runSync("next", 7).catch((err) => {
      logger.error("Worker scheduler: next week run threw", err instanceof Error ? err : undefined);
    });
  }, { timezone: "Europe/London" });

  logger.info("Worker: three Monday cron jobs armed", {
    times: ["01:00", "03:00", "05:00"],
    timezone: "Europe/London",
    runs: ["previous week", "current week", "next week"],
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
