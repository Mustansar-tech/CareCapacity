/**
 * Care Capacity — background worker process
 *
 * Standalone Node.js entry point managed by PM2 alongside the API server.
 * Does NOT start an Express server.
 *
 * Responsibilities
 * ────────────────
 * 1. Daily People Planner scheduler — fires once per weekday (Mon–Fri) at
 *    01:00 Europe/London via node-cron.
 *
 *    Each run computes the full forward-week window with getWeeksToSync():
 *      Monday  : previous week + current week + all forward weeks (~10–14 weeks)
 *      Tue–Fri : current week + all forward weeks (~5–13 weeks)
 *
 *    Every branch is synced in a single multi-week session (login once,
 *    iterate weeks, logout) using programmaticQueueMultiWeekSync.
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

// Sentry must be the very first import so it instruments all downstream modules.
import "./infrastructure/sentry";
import { Sentry } from "./infrastructure/sentry";

import cron from "node-cron";
import { logger } from "./infrastructure/logger";
import { prewarmAllSlots } from "./features/people-planner/automation-engine";
import {
  programmaticQueueMultiWeekSync,
  getConfiguredBranchIds,
} from "./features/people-planner/automation-routes";
import { getWeeksToSync } from "./features/people-planner/week-helpers";

logger.info("Care Capacity worker starting");

// ─── Crash protection ─────────────────────────────────────────────────────────
process.on("unhandledRejection", (reason) => {
  logger.error("Worker: unhandled promise rejection — keeping process alive", undefined, {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
});

process.on("uncaughtException", async (err) => {
  // Fatal errors exit so PM2 can restart into a clean state.
  // unhandledRejection is kept alive because Playwright throws these on
  // network failures and they are non-fatal.
  logger.error("Worker: uncaught exception — exiting for clean PM2 restart", err, {
    message: err.message,
    stack: err.stack,
  });
  Sentry.captureException(err);
  // Flush Sentry before exiting so the event is not lost
  await Sentry.flush(2000).catch(() => undefined);
  process.exit(1);
});

// ─── Daily sync runner ────────────────────────────────────────────────────────

export async function runDailySync(): Promise<void> {
  const now = new Date();
  const isMonday = now.getUTCDay() === 1;
  const weeksToDo = getWeeksToSync(now, isMonday);
  const branchIds = getConfiguredBranchIds();

  logger.info("Worker: daily sync firing", {
    isMonday,
    weekCount: weeksToDo.length,
    weeks: weeksToDo,
    branchCount: branchIds.length,
  });

  if (branchIds.length === 0) {
    logger.warn("Worker: no branches configured — nothing to do");
    return;
  }

  for (const branchId of branchIds) {
    try {
      const result = await programmaticQueueMultiWeekSync(
        branchId,
        weeksToDo,
        "worker-scheduler",
      );
      logger.info("Worker: branch queued", {
        branchId,
        weekCount: weeksToDo.length,
        sessionId: result.sessionId,
        queued: result.queued,
        queuePosition: result.queuePosition,
      });
    } catch (err) {
      logger.error(
        "Worker: failed to queue branch",
        err instanceof Error ? err : undefined,
        { branchId, weekCount: weeksToDo.length },
      );
      Sentry.captureException(
        err instanceof Error ? err : new Error(String(err)),
        { tags: { branchId } },
      );
    }
  }
}

// ─── Weekday cron — 01:00 Europe/London, Mon–Fri ─────────────────────────────
// "0 1 * * 1-5" = minute 0, hour 1, any date, any month, Mon–Fri.
// Europe/London handles BST/GMT automatically:
//   Summer (BST = UTC+1): fires at 00:00 UTC
//   Winter (GMT = UTC)  : fires at 01:00 UTC

if (process.env.ACCESS_EMAIL) {
  cron.schedule("0 1 * * 1-5", () => {
    const now = new Date();
    logger.info("Worker: daily cron fired", {
      localTime: now.toISOString(),
      dayOfWeek: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][now.getUTCDay()],
    });
    runDailySync().catch((err) => {
      logger.error("Worker: daily sync threw", err instanceof Error ? err : undefined);
      Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
        tags: { cronJob: "daily-sync" },
      });
    });
  }, { timezone: "Europe/London" });

  logger.info("Worker: daily cron armed", {
    schedule: "0 1 * * 1-5",
    timezone: "Europe/London",
    description: "Mon–Fri 01:00 BST/GMT — full forward-week multi-week sync",
  });
} else {
  logger.warn("Worker: ACCESS_EMAIL not configured — daily scheduler not armed");
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
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), { tags: { phase: "session-prewarm" } });
  }
}, 5000);

logger.info("Care Capacity worker ready");
