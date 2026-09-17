/**
 * One-off manual trigger of the Day Rate Tracker (Financial Summary)
 * automation for the Glasgow North franchise only — does not touch any
 * other branch/franchise.
 *
 * Run with: npx tsx scripts/adhoc/run-glasgow-north-dayrate.ts
 *
 * On failure, the underlying automation engine already writes a debug
 * screenshot of the page at the moment of failure to
 * pp-debug-screenshots/fail-<jobId>.png — this script surfaces that path
 * so you don't have to go looking for it.
 */
import path from "path";
import fs from "fs";
import { getAllFranchises } from "../../server/repositories/day-rate.repository";
import {
  getBranchIdForDayRateOffice,
  programmaticQueueFinancialSummarySync,
  listFinancialSummarySessions,
} from "../../server/features/people-planner/automation-routes";

const DEBUG_DIR = path.resolve(process.cwd(), "pp-debug-screenshots");
const TARGET_OFFICE = "Glasgow North";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function fmt(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function monthRange(today: Date, monthOffset: number) {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + monthOffset;
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));
  return {
    startDate: fmt(start),
    endDate: fmt(end),
    reportingMonth: `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}`,
    daysInMonth: end.getUTCDate(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function listPngsAfter(dir: string, sinceMs: number): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith(".png"))
    .filter(f => {
      try {
        return fs.statSync(path.join(dir, f)).mtimeMs >= sinceMs;
      } catch {
        return false;
      }
    })
    .map(f => path.join(dir, f));
}

async function main() {
  const branchId = getBranchIdForDayRateOffice(TARGET_OFFICE);
  if (!branchId) {
    console.error(`No People Planner branch mapping found for office "${TARGET_OFFICE}"`);
    process.exit(1);
  }

  const allFranchises = await getAllFranchises();
  const franchises = allFranchises.filter(f => f.office === TARGET_OFFICE);
  if (franchises.length === 0) {
    console.error(`No day_rate_franchises rows found for office "${TARGET_OFFICE}"`);
    process.exit(1);
  }

  const now = new Date();
  const today = fmt(now);
  const ranges = [monthRange(now, 0), monthRange(now, 1)]; // current + forward month, same as the nightly job

  const jobs = franchises.flatMap(f =>
    ranges.map(range => ({
      franchiseId: f.id,
      financeFranchiseName: f.franchiseName,
      date: today,
      reportingMonth: range.reportingMonth,
      daysInMonth: range.daysInMonth,
      startDate: range.startDate,
      endDate: range.endDate,
    }))
  );

  console.log(`Queuing Financial Summary sync for "${TARGET_OFFICE}" (branch ${branchId})`);
  console.log(`Franchises: ${franchises.map(f => f.franchiseName).join(", ")}`);
  console.log(`Jobs: ${jobs.length} (${ranges.map(r => r.reportingMonth).join(", ")})`);

  const runStartedAt = Date.now();
  const { sessionId, queued } = await programmaticQueueFinancialSummarySync(
    branchId,
    jobs,
    "manual-glasgow-north-script"
  );
  console.log(`Session ${sessionId} ${queued ? "queued (waiting for a free slot)" : "started"}`);

  const deadline = Date.now() + 15 * 60 * 1000; // 15 min ceiling for a single branch
  let session = listFinancialSummarySessions().find(s => s.sessionId === sessionId);
  while (Date.now() < deadline) {
    session = listFinancialSummarySessions().find(s => s.sessionId === sessionId);
    if (session && (session.status === "completed" || session.status === "failed")) break;
    await sleep(5000);
  }

  if (!session) {
    console.error("Could not find session status after queuing — check server logs directly.");
    process.exit(1);
  }

  console.log(`\nSession status: ${session.status}`);
  for (const jr of session.jobResults) {
    if (jr.status === "completed") {
      console.log(`  OK   ${jr.franchiseName} / ${jr.reportingMonth} — revenue ${jr.revenue}`);
    } else {
      console.log(`  FAIL ${jr.franchiseName} / ${jr.reportingMonth} — ${jr.error}`);
    }
  }
  if (session.error) {
    console.log(`Session-level error: ${session.error}`);
  }

  const failed = session.status === "failed" || session.jobResults.some(j => j.status === "failed");
  if (failed) {
    const shots = listPngsAfter(DEBUG_DIR, runStartedAt);
    if (shots.length > 0) {
      console.log(`\nFailure screenshot(s) captured:`);
      shots.forEach(s => console.log(`  ${s}`));
    } else {
      console.log(`\nNo failure screenshot found in ${DEBUG_DIR} — the failure likely happened before a page was open (e.g. no PP branch config).`);
    }
    process.exit(1);
  }

  console.log("\nGlasgow North Day Rate Tracker sync completed successfully.");
  process.exit(0);
}

main().catch(err => {
  console.error("Script crashed:", err);
  process.exit(1);
});
