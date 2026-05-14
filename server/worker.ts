/**
 * Care Capacity — background worker process
 *
 * Standalone Node.js entry point managed by PM2 alongside the API server.
 * Does NOT start an Express server.
 *
 * Responsibilities
 * ────────────────
 * 1. Weekly People Planner scheduler — Monday 01:00 Europe/London.
 *    Queues all configured branches for the previous week in parallel across
 *    the available account slots. Replaces any external cron-job.org trigger —
 *    PM2 keeps this process alive so no external service is needed.
 *
 * 2. Session pre-warm — all account slots log in / restore saved session files
 *    at startup so the first user-triggered sync of the day is instant.
 *
 * Run via: node dist/worker.js
 * PM2:     see ecosystem.config.cjs
 *
 * Development testing:
 *   tsx server/worker.ts
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

// ─── Date helper ──────────────────────────────────────────────────────────────

/**
 * Returns the ISO date (YYYY-MM-DD) of the Monday that is `dayOffset` days
 * from the Monday of the week in which `from` falls.
 *
 * dayOffset -7  →  previous week's Monday
 * dayOffset  0  →  current week's Monday
 */
function getMondayWithOffset(from: Date, dayOffset: number): string {
  const d = new Date(from);
  const day = d.getUTCDay(); // 0=Sun … 6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday + dayOffset);
  return d.toISOString().split("T")[0];
}

// ─── Sync fan-out ─────────────────────────────────────────────────────────────

async function runMondaySync(): Promise<void> {
  const weekStartDate = getMondayWithOffset(new Date(), -7); // previous week
  const branchIds = getConfiguredBranchIds();

  logger.info("Worker scheduler: Monday 01:00 firing — previous week sync", {
    weekStartDate,
    branchCount: branchIds.length,
  });

  if (branchIds.length === 0) {
    logger.warn("Worker scheduler: no branches configured — nothing to do");
    return;
  }

  // Fan all branches out simultaneously across the account slot pool.
  const results = await Promise.allSettled(
    branchIds.map(async (branchId) => {
      const result = await programmaticQueueSync(
        branchId,
        weekStartDate,
        "worker-scheduler-monday",
      );
      logger.info("Worker scheduler: branch queued", {
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
      logger.error("Worker scheduler: branch queue failed", undefined, {
        branchId: branchIds[i],
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  });

  logger.info("Worker scheduler: Monday sync complete", {
    weekStartDate,
    succeeded,
    failed,
    total: branchIds.length,
  });
}

// ─── Monday 01:00 cron (Europe/London) ───────────────────────────────────────
// node-cron does NOT unref its internal timers, so this keeps the process alive
// in a standalone worker without Express holding the event loop open.

if (process.env.ACCESS_EMAIL) {
  cron.schedule("0 1 * * 1", () => {
    logger.info("Worker scheduler: Monday 01:00 cron fired (Europe/London)");
    runMondaySync().catch((err) => {
      logger.error("Worker scheduler: sync threw unexpectedly", err instanceof Error ? err : undefined);
    });
  }, { timezone: "Europe/London" });

  logger.info("Worker: Monday 01:00 cron armed", {
    schedule: "0 1 * * 1",
    timezone: "Europe/London",
    syncs: "previous week — all configured branches in parallel",
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
