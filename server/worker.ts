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
import { runDayRateAutomation } from "./features/people-planner/day-rate-scheduler";

logger.info("Care Capacity worker starting");

// ─── Date helper (exported for unit tests) ────────────────────────────────────

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

  // ─── Day Rate Tracker — Financial Summary cron — 02:00 Europe/London, every day ──
  // Runs after the capacity sync above so the two automations rarely contend for the
  // same Playwright account slots; if they do, the slot-reservation system queues one
  // behind the other automatically. Runs every day (not just weekdays) because revenue
  // keeps accruing daily.
  cron.schedule("0 2 * * *", () => {
    const now = new Date();
    logger.info("Worker: day-rate cron fired", { localTime: now.toISOString() });
    runDayRateAutomation(now).catch((err) => {
      logger.error("Worker: day-rate automation threw", err instanceof Error ? err : undefined);
      Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
        tags: { cronJob: "day-rate-automation" },
      });
    });
  }, { timezone: "Europe/London" });

  logger.info("Worker: day-rate cron armed", {
    schedule: "0 2 * * *",
    timezone: "Europe/London",
    description: "Every day 02:00 BST/GMT — Financial Summary export → Day Rate Tracker",
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
