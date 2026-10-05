import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { runExportWithBackup, type ExportFallbackDependencies } from "../../server/features/people-planner/export-job-fallback";
import type { AutomationJob, JobConfig } from "../../server/features/people-planner/automation-engine";

const config: JobConfig = {
  branchUrl: "https://example.com/branch",
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  reportType: "financialSummaryExport",
  exportType: "Excel",
  exportTemplate: "Summary",
};
const completed = { id: "backup-job", status: "completed" } as AutomationJob;
const failed = { id: "primary-job", status: "failed", error: "Still on login page" } as AutomationJob;

function dependencies() {
  return {
    runJob: mock.fn(async (_config: JobConfig, _slot: number) => "job"),
    waitForJob: mock.fn(async (_id: string, _timeout: number): Promise<AutomationJob> => completed),
    claimBackup: mock.fn(async (_failedSlot: number) => 6),
    switchSlot: mock.fn(async (_previous: number, _backup: number) => {}),
    notifyFailure: mock.fn(async (_slot: number, _backup: boolean) => {}),
    failedSlots: new Set<number>(),
  } satisfies ExportFallbackDependencies;
}

describe("PP and Day Rate one-attempt backup policy", () => {
  it("does not use backup or send alerts when primary succeeds", async () => {
    const deps = dependencies();
    const result = await runExportWithBackup(config, 2, 1000, deps);
    assert.equal(result.ok, true);
    assert.equal(result.slotUsed, 2);
    assert.equal(result.attempts, 1);
    assert.equal(deps.claimBackup.mock.callCount(), 0);
    assert.equal(deps.notifyFailure.mock.callCount(), 0);
  });

  it("switches after one failure and reports both job IDs", async () => {
    const deps = dependencies();
    deps.runJob.mock.mockImplementation(async (_config, slot) => slot === 2 ? "primary-job" : "backup-job");
    deps.waitForJob.mock.mockImplementation(async id => id === "primary-job" ? failed : completed);
    const started = mock.fn((_id: string) => {});
    const result = await runExportWithBackup(config, 2, 1000, deps, started);
    assert.equal(result.ok, true);
    assert.equal(result.slotUsed, 6);
    assert.equal(result.attempts, 2);
    assert.deepEqual(deps.runJob.mock.calls.map(c => c.arguments[1]), [2, 6]);
    assert.deepEqual(deps.switchSlot.mock.calls[0].arguments, [2, 6]);
    assert.equal(deps.notifyFailure.mock.callCount(), 1);
    assert.deepEqual(started.mock.calls.map(c => c.arguments[0]), ["primary-job", "backup-job"]);
    assert.equal(deps.failedSlots.has(2), true);
  });

  it("also backs up Glasgow North's existing universal account", async () => {
    const deps = dependencies();
    let attempts = 0;
    deps.waitForJob.mock.mockImplementation(async () => ++attempts === 1 ? failed : completed);
    const result = await runExportWithBackup(config, 0, 1000, deps);
    assert.equal(result.ok, true);
    assert.deepEqual(deps.runJob.mock.calls.map(c => c.arguments[1]), [0, 6]);
  });

  it("stops after backup fails and blocks subsequent attempts in the same session", async () => {
    const deps = dependencies();
    deps.waitForJob.mock.mockImplementation(async () => failed);
    const result = await runExportWithBackup(config, 2, 1000, deps);
    assert.equal(result.ok, false);
    assert.equal(result.slotUsed, 6);
    assert.equal(result.attempts, 2);
    assert.deepEqual(deps.notifyFailure.mock.calls[1].arguments, [6, true]);
    assert.equal((await runExportWithBackup(config, 6, 1000, deps)).attempts, 0);
    assert.equal(deps.runJob.mock.callCount(), 2);
  });

  it("never retries primary if backup is unavailable", async () => {
    const deps = dependencies();
    deps.waitForJob.mock.mockImplementation(async () => failed);
    deps.claimBackup.mock.mockImplementation(async () => -1);
    const result = await runExportWithBackup(config, 2, 1000, deps);
    assert.equal(result.ok, false);
    assert.equal(result.attempts, 1);
    assert.equal(deps.runJob.mock.callCount(), 1);
    assert.equal((await runExportWithBackup(config, 2, 1000, deps)).attempts, 0);
  });

  it("waits for busy backup without repeating the primary login", async () => {
    const deps = dependencies();
    let attempts = 0;
    deps.waitForJob.mock.mockImplementation(async () => ++attempts === 1 ? failed : completed);
    let release!: (slot: number) => void;
    deps.claimBackup.mock.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = runExportWithBackup(config, 2, 1000, deps);
    while (!release) await new Promise(resolve => setImmediate(resolve));
    assert.equal(deps.runJob.mock.callCount(), 1);
    release(6);
    const result = await pending;
    assert.equal(result.ok, true);
    assert.equal(result.slotUsed, 6);
  });

  it("still runs backup if email delivery rejects", async () => {
    const deps = dependencies();
    let attempts = 0;
    deps.waitForJob.mock.mockImplementation(async () => ++attempts === 1 ? failed : completed);
    deps.notifyFailure.mock.mockImplementation(async () => { throw new Error("Email unavailable"); });
    assert.equal((await runExportWithBackup(config, 2, 1000, deps)).ok, true);
  });

  it("returns correct final slot on backup preparation failure", async () => {
    const deps = dependencies();
    deps.waitForJob.mock.mockImplementation(async () => failed);
    deps.switchSlot.mock.mockImplementation(async () => { throw new Error("Browser reset failed"); });
    const result = await runExportWithBackup(config, 2, 1000, deps);
    assert.equal(result.ok, false);
    assert.equal(result.slotUsed, 6);
    assert.equal(deps.runJob.mock.callCount(), 1);
  });

  it("alerts on startup exceptions and stops if backup reservation fails", async () => {
    const deps = dependencies();
    deps.runJob.mock.mockImplementation(async () => { throw new Error("Login startup failed"); });
    deps.claimBackup.mock.mockImplementation(async () => { throw new Error("Reservation failed"); });
    assert.equal((await runExportWithBackup(config, 2, 1000, deps)).ok, false);
    assert.equal(deps.notifyFailure.mock.callCount(), 1);
    assert.equal(deps.runJob.mock.callCount(), 1);
  });
});
