/**
 * Minimal, single-attempt repro of the Glasgow North Day Rate Tracker
 * (Financial Summary) automation failure — no retries, exits the moment
 * the first real error happens, and reports exactly where the failure
 * screenshot landed.
 *
 * Run with: npx tsx scripts/adhoc/glasgow-north-single-attempt.ts
 */
import path from "path";
import {
  runAutomationJob,
  waitForJob,
  type JobConfig,
} from "../../server/features/people-planner/automation-engine";

const GLASGOW_NORTH_BRANCH_ID = "2f706320-5585-4e3c-8eb2-6c624acd7fca";
// Slot override: pass 0 to use ACCESS_EMAIL (universal fallback account, access to
// all branches) instead of the preferred slot 1 (ACCESS_EMAIL_1) — lets us tell
// apart "this specific account is Cloudflare-flagged" from "this tenant is broken".
const GLASGOW_NORTH_SLOT = Number(process.argv[2] ?? 1);
const GLASGOW_NORTH_BRANCH_URL = "https://go.accessacloud.com/o/home-instead-uk-glasgow-north/";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function fmt(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

async function main() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));

  const config: JobConfig = {
    branchUrl: GLASGOW_NORTH_BRANCH_URL,
    startDate: fmt(start),
    endDate: fmt(end),
    reportType: "financialSummaryExport",
    exportType: "",
    exportTemplate: "",
    financeFranchiseName: "Glasgow North",
    careGiverType: "Summary",
    careGiverStatus: "All",
    branchId: GLASGOW_NORTH_BRANCH_ID,
  };

  console.log(`Single attempt, no retries — Glasgow North, slot ${GLASGOW_NORTH_SLOT} (ACCESS_EMAIL_1)`);
  const t0 = Date.now();
  const jobId = await runAutomationJob(config, GLASGOW_NORTH_SLOT);
  const job = await waitForJob(jobId, 120000); // 2 min ceiling — we want the FIRST failure, not a war of attrition
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

  if (job.status === "failed") {
    const shotPath = path.resolve(process.cwd(), "pp-debug-screenshots", `fail-${jobId}.png`);
    console.log(`\nFAILED after ${elapsedSec}s`);
    console.log(`Error: ${job.error}`);
    console.log(`Screenshot: ${shotPath}`);
    process.exit(1);
  }

  console.log(`\nSUCCEEDED after ${elapsedSec}s — file: ${job.fileName}`);
  process.exit(0);
}

main().catch(err => {
  console.error("Script crashed:", err);
  process.exit(1);
});
