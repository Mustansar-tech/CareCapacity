import type { AutomationJob, JobConfig } from "./automation-engine";
import { describeAutomationFailure, type AutomationFailure } from "./automation-failure";

export type ExportJobOutcome =
  | { ok: true; job: AutomationJob; slotUsed: number; attempts: number }
  | { ok: false; error: string; slotUsed: number; attempts: number };

export interface ExportFallbackDependencies {
  runJob: (config: JobConfig, slot: number) => Promise<string>;
  waitForJob: (id: string, timeoutMs: number) => Promise<AutomationJob>;
  /** Wait for and atomically claim the next unfailed global backup. -1 means unavailable. */
  claimBackup: (failedSlot: number) => Promise<number>;
  switchSlot: (previousSlot: number, backupSlot: number) => Promise<void>;
  notifyFailure: (slot: number, backup: boolean, failure: AutomationFailure) => Promise<void>;
  failedSlots: Set<number>;
}

/**
 * One attempt per account per session. A failed export switches directly to the
 * global backups, once each. No failed account is retried. Shared by all PP paths.
 */
export async function runExportWithBackup(
  config: JobConfig,
  initialSlot: number,
  timeoutMs: number,
  deps: ExportFallbackDependencies,
  onJobStarted?: (id: string) => void,
): Promise<ExportJobOutcome> {
  let slot = initialSlot;
  let attempts = 0;
  let preparationError: unknown;
  if (deps.failedSlots.has(slot)) {
    return { ok: false, error: "This account already failed in this session; not retrying it.", slotUsed: slot, attempts };
  }
  while (attempts < 3) {
    attempts++;
    try {
      if (preparationError) throw preparationError;
      const jobId = await deps.runJob(config, slot);
      onJobStarted?.(jobId);
      const job = await deps.waitForJob(jobId, timeoutMs);
      if (job.status !== "completed") {
        throw new Error(job.error || "Automation job did not complete");
      }
      return { ok: true, job, slotUsed: slot, attempts };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const failure = describeAutomationFailure(error);
      // Lock loss/busy infrastructure is NOT an account failure. Never evade a
      // coordination failure by starting another uncoordinated browser.
      if (failure.category === "coordination") {
        return { ok: false, error, slotUsed: slot, attempts };
      }
      deps.failedSlots.add(slot);
      // Email failure must never prevent the backup from running.
      let notificationTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          deps.notifyFailure(slot, attempts > 1, failure).catch(() => {}),
          new Promise<void>(resolve => {
            notificationTimer = setTimeout(resolve, Math.min(timeoutMs, 5000));
          }),
        ]);
      } finally {
        if (notificationTimer) clearTimeout(notificationTimer);
      }
      if (attempts === 3) return { ok: false, error, slotUsed: slot, attempts };
      let backup: number;
      try {
        backup = await deps.claimBackup(slot);
      } catch {
        return { ok: false, error: `${error} (Could not reserve the backup; no login was retried.)`, slotUsed: slot, attempts };
      }
      if (backup === -1 || deps.failedSlots.has(backup)) {
        return {
          ok: false,
          error: `${error} (Backup unavailable or already failed; the original account was not retried.)`,
          slotUsed: slot,
          attempts,
        };
      }
      const previousSlot = slot;
      slot = backup;
      try {
        await deps.switchSlot(previousSlot, backup);
        preparationError = undefined;
      } catch (err) {
        // Treat preparation as this account's one failed attempt, then continue
        // to the remaining global account rather than abandoning both backups.
        preparationError = err instanceof Error ? err : new Error("Could not prepare the backup account.");
      }
    }
  }
  return { ok: false, error: "Automation failed", slotUsed: slot, attempts };
}
