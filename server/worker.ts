/**
 * Care Capacity — background worker process
 *
 * This is a standalone Node.js entry point managed by PM2 alongside the API
 * server. It does NOT start an Express server.
 *
 * Responsibilities
 * ────────────────
 * 1. Run the weekly People Planner scheduler — three runs every Monday:
 *      01:00 UTC  →  previous week  (replaces external cron-job.org trigger)
 *      03:00 UTC  →  current week
 *      05:00 UTC  →  next week
 *    Each run queues all configured branches through the existing session pool,
 *    fanning them out across available account slots automatically.
 *
 * 2. Pre-warm all People Planner account slot sessions at startup.
 *    Each slot logs in to Access Cloud (or restores a saved session file) so
 *    the first user-triggered sync of the day is instant rather than hitting
 *    a cold login delay of 30–60 seconds.
 *
 * Run via: node dist/worker.js
 * PM2:     see ecosystem.config.cjs
 *
 * Development:
 *   tsx server/worker.ts
 *   (runs the scheduler + pre-warm without starting the Express API)
 */

import { logger } from "./infrastructure/logger";
import { initScheduler } from "./features/people-planner/scheduler";
import { prewarmAllSlots } from "./features/people-planner/automation-engine";

logger.info("Care Capacity worker starting");

// ─── Crash protection ─────────────────────────────────────────────────────────
// Playwright automation throws unhandled rejections on network/TLS failures.
// Without these handlers the process exits and PM2 restarts it, losing the
// scheduler state.
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

// ─── Weekly People Planner scheduler ─────────────────────────────────────────
// Arms three Monday timers (previous / current / next week) and keeps them
// re-arming automatically each week. This is the replacement for the external
// cron-job.org trigger — PM2 keeps the worker process alive so no external
// service is needed.

if (process.env.ACCESS_EMAIL) {
  initScheduler();
  logger.info("Worker: People Planner weekly scheduler armed (Mon 01:00 / 03:00 / 05:00 UTC)");
} else {
  logger.warn("Worker: ACCESS_EMAIL not configured — scheduler not armed");
}

// ─── Startup: pre-warm all sessions ──────────────────────────────────────────
// Delay 5 s so the process is fully initialised before hitting the network.
// Pre-warming is fire-and-forget — failures are logged inside prewarmAllSlots
// and do not crash the worker.

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
