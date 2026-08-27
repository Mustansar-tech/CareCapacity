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
  getBranchIdForDayRateOffice,
  programmaticQueueFinancialSummarySync,
  updateDayRateAutomationStatus,
  type FinancialSummaryJobSpec,
} from "./automation-routes";

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

export async function runDayRateAutomation(now: Date = new Date()): Promise<void> {
  const { jobsByBranch, unmapped } = await buildDayRateJobGroups(now);

  if (unmapped.length > 0) {
    logger.warn("Day Rate automation: franchises with no known PP branch mapping — skipped", { unmapped });
  }

  if (jobsByBranch.size === 0) {
    logger.warn("Day Rate automation: no franchises mapped to a People Planner branch — nothing to do");
    updateDayRateAutomationStatus({ lastRunAt: now.toISOString(), lastRunSessionIds: [], lastRunSummary: { total: 0, completed: 0, failed: 0 }, lastErrors: [] });
    return;
  }

  const sessionIds: string[] = [];
  for (const [branchId, jobs] of jobsByBranch) {
    try {
      const result = await programmaticQueueFinancialSummarySync(branchId, jobs, "system-scheduler");
      sessionIds.push(result.sessionId);
      logger.info("Day Rate automation: branch queued", { branchId, jobCount: jobs.length, ...result });
    } catch (err) {
      logger.error("Day Rate automation: failed to queue branch", err instanceof Error ? err : undefined, { branchId, jobCount: jobs.length });
    }
  }

  updateDayRateAutomationStatus({ lastRunAt: now.toISOString(), lastRunSessionIds: sessionIds });
}
