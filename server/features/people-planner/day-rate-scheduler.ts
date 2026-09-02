/**
 * Daily Financial Summary automation for the Day Rate Tracker.
 *
 * Fires once per day (every day, not just weekdays — revenue keeps accruing
 * every day of the week) shortly after the capacity-sync scheduler in worker.ts.
 * For every tracked franchise/office (including its Live-In Care sub-entity),
 * downloads the People Planner "Financial Summary" export for the current
 * calendar month and the forward calendar month, and upserts today's
 * cumulative revenue + day rate into the Day Rate Tracker tables.
 *
 * Franchises are grouped by the underlying People Planner branch/tenant so each
 * branch's franchises run in a single Playwright session (login once, iterate).
 */

import { logger } from "../../infrastructure/logger";
import { getAllFranchises } from "../../repositories/day-rate.repository";
import {
  createAutomationRun,
  completeAutomationRun,
  pruneOldAutomationRuns,
} from "../../repositories/day-rate-automation.repository";
import {
  getBranchIdForDayRateOffice,
  programmaticQueueFinancialSummarySync,
  updateDayRateAutomationStatus,
  listFinancialSummarySessions,
  type FinancialSummaryJobSpec,
} from "./automation-routes";

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Minimum gap between kicking off successive branches' Playwright sessions.
 * All ~10 branches firing their initial AccessCloud login navigation in the
 * same instant (up to MAX_ACCOUNT_SLOTS concurrently) is what causes the
 * recurring "page.goto timeout" / "People Planner tile not found" failures
 * seen only on the 2am cron run — staggering the kickoff spreads that login
 * load out so the very first job of the day is no more likely to hit a slow
 * launcher page than a mid-run one.
 */
const BRANCH_KICKOFF_STAGGER_MS = 15000;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function fmt(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Builds the full-month [start, end] date range + reportingMonth + daysInMonth for a given month offset from today (0 = current month, 1 = forward month). */
function monthRange(today: Date, monthOffset: number): { startDate: string; endDate: string; reportingMonth: string; daysInMonth: number } {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + monthOffset;
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0)); // last day of month
  return {
    startDate: fmt(start),
    endDate: fmt(end),
    reportingMonth: `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}`,
    daysInMonth: end.getUTCDate(),
  };
}

/**
 * Groups every day_rate_franchises row by its People Planner branch, and builds
 * one FinancialSummaryJobSpec per franchise per month (current + forward) for today's date.
 * Franchises whose office has no known branch mapping are skipped and logged.
 */
export async function buildDayRateJobGroups(now: Date = new Date()): Promise<{
  jobsByBranch: Map<string, FinancialSummaryJobSpec[]>;
  unmapped: string[];
}> {
  const franchises = await getAllFranchises();
  const today = fmt(now);
  const currentMonth = monthRange(now, 0);
  const forwardMonth = monthRange(now, 1);

  const jobsByBranch = new Map<string, FinancialSummaryJobSpec[]>();
  const unmapped: string[] = [];

  for (const franchise of franchises) {
    const branchId = getBranchIdForDayRateOffice(franchise.office);
    if (!branchId) {
      unmapped.push(franchise.franchiseName);
      continue;
    }

    for (const range of [currentMonth, forwardMonth]) {
      const job: FinancialSummaryJobSpec = {
        franchiseId: franchise.id,
        financeFranchiseName: franchise.franchiseName,
        date: today,
        reportingMonth: range.reportingMonth,
        daysInMonth: range.daysInMonth,
        startDate: range.startDate,
        endDate: range.endDate,
      };
      const existing = jobsByBranch.get(branchId) ?? [];
      existing.push(job);
      jobsByBranch.set(branchId, existing);
    }
  }

  return { jobsByBranch, unmapped };
}

export async function runDayRateAutomation(now: Date = new Date(), triggeredBy: string = "system-scheduler"): Promise<void> {
  const { jobsByBranch, unmapped } = await buildDayRateJobGroups(now);
  const totalJobs = Array.from(jobsByBranch.values()).reduce((sum, jobs) => sum + jobs.length, 0);

  // Persisted immediately so the status endpoint (served by a different PM2
  // process than this cron worker) can see "a run started" right away, rather
  // than only finding out once every branch session has finished.
  const runId = await createAutomationRun(triggeredBy);

  if (unmapped.length > 0) {
    logger.warn("Day Rate automation: franchises with no known PP branch mapping — skipped", { unmapped });
  }

  if (jobsByBranch.size === 0) {
    logger.warn("Day Rate automation: no franchises mapped to a People Planner branch — nothing to do");
    updateDayRateAutomationStatus({ lastRunAt: now.toISOString(), lastRunSessionIds: [], lastRunSummary: { total: 0, completed: 0, failed: 0 }, lastErrors: [] });
    await completeAutomationRun(runId, { totalJobs: 0, completedJobs: 0, failedJobs: 0, unmappedFranchises: unmapped });
    return;
  }

  const sessionIds: string[] = [];
  const branchEntries = Array.from(jobsByBranch.entries());
  for (let i = 0; i < branchEntries.length; i++) {
    const [branchId, jobs] = branchEntries[i];
    try {
      const result = await programmaticQueueFinancialSummarySync(branchId, jobs, triggeredBy, runId);
      sessionIds.push(result.sessionId);
      logger.info("Day Rate automation: branch queued", { branchId, jobCount: jobs.length, ...result });
    } catch (err) {
      logger.error("Day Rate automation: failed to queue branch", err instanceof Error ? err : undefined, { branchId, jobCount: jobs.length });
    }
    // Stagger session kickoffs so every branch doesn't hit the AccessCloud login
    // page in the same instant — see BRANCH_KICKOFF_STAGGER_MS doc comment above.
    if (i < branchEntries.length - 1) {
      await sleep(BRANCH_KICKOFF_STAGGER_MS);
    }
  }

  updateDayRateAutomationStatus({ lastRunAt: now.toISOString(), lastRunSessionIds: sessionIds });

  // Poll until every queued session has finished (or a generous ceiling elapses),
  // then write the final tally + prune old history. Sessions self-report their
  // job results into day_rate_automation_job_results as they complete; this just
  // needs to know when they're ALL done so lastRunSummary/completedAt are accurate.
  const deadline = Date.now() + 45 * 60 * 1000; // 45 min ceiling — well beyond a normal ~10 min run
  while (Date.now() < deadline) {
    const sessions = listFinancialSummarySessions().filter(s => sessionIds.includes(s.sessionId));
    const allDone = sessions.length === sessionIds.length && sessions.every(s => s.status === "completed" || s.status === "failed");
    if (allDone) break;
    await sleep(15000);
  }

  const finishedSessions = listFinancialSummarySessions().filter(s => sessionIds.includes(s.sessionId));
  const allJobResults = finishedSessions.flatMap(s => s.jobResults);
  const completedJobs = allJobResults.filter(j => j.status === "completed").length;
  const failedJobs = allJobResults.filter(j => j.status === "failed").length;

  await completeAutomationRun(runId, { totalJobs, completedJobs, failedJobs, unmappedFranchises: unmapped });
  await pruneOldAutomationRuns().catch(err => logger.error("Failed to prune old automation runs", err instanceof Error ? err : undefined));
}
