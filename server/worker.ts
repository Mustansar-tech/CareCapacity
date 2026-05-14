/**
 * Care Capacity — background worker process
 *
 * This is a standalone Node.js entry point managed by PM2 alongside the API
 * server. It does NOT start an Express server.
 *
 * Responsibilities
 * ────────────────
 * 1. Pre-warm all People Planner account slot sessions at startup.
 *    Each slot logs in to Access Cloud (or restores a saved session file) so
 *    the first user-triggered sync of the day is instant rather than hitting
 *    a cold login delay of 30–60 seconds.
 *
 * Monday scheduled syncs
 * ──────────────────────
 * The Monday scheduler (previous / current / next week at 01:00 / 03:00 /
 * 05:00 UTC) already runs inside the API process via server/features/
 * people-planner/scheduler.ts, which is initialised in server/app.ts.
 * The worker does NOT duplicate that schedule — doing so would cause every
 * branch to be synced twice each week.
 *
 * Run via: node dist/worker.js
 * PM2:     see ecosystem.config.cjs
 */

import { logger } from "./infrastructure/logger";
import { prewarmAllSlots } from "./features/people-planner/automation-engine";

logger.info("Care Capacity worker starting");

// ─── Crash protection ─────────────────────────────────────────────────────────
// Playwright automation throws unhandled rejections on network/TLS failures.
// Without these handlers the process exits and PM2 restarts it, losing any
// in-progress warm-up state.
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

// ─── Startup: pre-warm all sessions ──────────────────────────────────────────
// Delay 3 s so the process is fully initialised before hitting the network.
// Pre-warming is fire-and-forget — failures are logged inside prewarmAllSlots
// and do not crash the worker.

setTimeout(async () => {
  logger.info("Session pre-warm: beginning startup warm-up");
  try {
    await prewarmAllSlots();
  } catch (err) {
    logger.error("Session pre-warm: unexpected top-level error", err instanceof Error ? err : undefined, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}, 3000);

logger.info("Care Capacity worker ready — session pre-warm scheduled in 3s");
