import { db } from '../infrastructure/db';
import { dayRateAutomationRuns, dayRateAutomationJobResults } from '@shared/schema';
import { desc, eq, sql } from 'drizzle-orm';

/**
 * Persisted history of the Financial Summary automation, written directly by
 * whichever PM2 process actually executes the run (the cron worker OR the API
 * server, for a manual "Run automation now" click). Reading the status this
 * way — instead of from an in-process in-memory map — means the banner is
 * correct no matter which process ran the automation.
 */

export async function createAutomationRun(triggeredBy: string): Promise<string> {
  const [row] = await db
    .insert(dayRateAutomationRuns)
    .values({ triggeredBy, totalJobs: 0, completedJobs: 0, failedJobs: 0, unmappedFranchises: [] })
    .returning({ id: dayRateAutomationRuns.id });
  return row.id;
}

export async function recordAutomationJobResult(params: {
  runId: string;
  branchId: string;
  franchiseName: string;
  reportingMonth: string;
  status: 'completed' | 'failed';
  revenue?: number;
  error?: string;
  attempts: number;
}): Promise<void> {
  await db.insert(dayRateAutomationJobResults).values({
    runId: params.runId,
    branchId: params.branchId,
    franchiseName: params.franchiseName,
    reportingMonth: params.reportingMonth,
    status: params.status,
    revenue: params.revenue ?? null,
    error: params.error ?? null,
    attempts: params.attempts,
  });
}

export async function completeAutomationRun(
  runId: string,
  summary: { totalJobs: number; completedJobs: number; failedJobs: number; unmappedFranchises?: string[] },
): Promise<void> {
  await db
    .update(dayRateAutomationRuns)
    .set({
      completedAt: sql`now()`,
      totalJobs: summary.totalJobs,
      completedJobs: summary.completedJobs,
      failedJobs: summary.failedJobs,
      unmappedFranchises: summary.unmappedFranchises ?? [],
    })
    .where(eq(dayRateAutomationRuns.id, runId));
}

export interface LatestAutomationRunStatus {
  runId: string;
  triggeredBy: string;
  startedAt: string;
  completedAt: string | null;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  unmappedFranchises: string[];
  errors: { branchId: string; franchiseName: string; reportingMonth: string; error: string }[];
}

/** Returns the most recently *started* run (whether or not it has finished), with its job results. */
export async function getLatestAutomationRun(): Promise<LatestAutomationRunStatus | null> {
  const [run] = await db
    .select()
    .from(dayRateAutomationRuns)
    .orderBy(desc(dayRateAutomationRuns.startedAt))
    .limit(1);
  if (!run) return null;

  const jobResults = await db
    .select()
    .from(dayRateAutomationJobResults)
    .where(eq(dayRateAutomationJobResults.runId, run.id));

  const errors = jobResults
    .filter(j => j.status === 'failed')
    .map(j => ({ branchId: j.branchId, franchiseName: j.franchiseName, reportingMonth: j.reportingMonth, error: j.error ?? 'Unknown error' }))
    .slice(0, 20);

  return {
    runId: run.id,
    triggeredBy: run.triggeredBy,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    totalJobs: run.totalJobs,
    completedJobs: run.completedJobs,
    failedJobs: run.failedJobs,
    unmappedFranchises: (run.unmappedFranchises as string[]) ?? [],
    errors,
  };
}

/** Keeps the run-history table from growing unbounded — retains the most recent N runs. */
export async function pruneOldAutomationRuns(keep = 60): Promise<void> {
  await db.execute(sql`
    DELETE FROM day_rate_automation_runs
    WHERE id NOT IN (
      SELECT id FROM day_rate_automation_runs ORDER BY started_at DESC LIMIT ${keep}
    )
  `);
}
