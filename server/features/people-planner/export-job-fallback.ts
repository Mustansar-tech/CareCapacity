import type { AutomationJob, JobConfig } from "./automation-engine";

export type ExportJobOutcome =
  | { ok: true; job: AutomationJob; slotUsed: number; attempts: number }
  | { ok: false; error: string; slotUsed: number; attempts: number };

export interface ExportFallbackDependencies {
  runJob: (config: JobConfig, slot: number) => Promise<string>;
  waitForJob: (id: string, timeoutMs: number) => Promise<AutomationJob>;
  /** Wait for and atomically claim the extra backup. -1 means unavailable. */
  claimBackup: (failedSlot: number) => Promise<number>;
  switchSlot: (previousSlot: number, backupSlot: number) => Promise<void>;
  notifyFailure: (slot: number, backup: boolean) => Promise<void>;
  failedSlots: Set<number>;
}

/**
 * One attempt per account per session. A failed export switches directly to the
 * extra backup; neither account is retried if it fails. Shared by all PP paths.
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
  if (deps.failedSlots.has(slot)) {
    return { ok: false, error: "This account already failed in this session; not retrying it.", slotUsed: slot, attempts };
  }
  while (attempts < 2) {
    attempts++;
    try {
      const jobId = await deps.runJob(config, slot);
      onJobStarted?.(jobId);
      const job = await deps.waitForJob(jobId, timeoutMs);
      if (job.status !== "completed") {
        throw new Error(job.error || "Automation job did not complete");
      }
      return { ok: true, job, slotUsed: slot, attempts };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      deps.failedSlots.add(slot);
      // Email failure must never prevent the backup from running.
      await deps.notifyFailure(slot, attempts === 2).catch(() => {});
      if (attempts === 2) return { ok: false, error, slotUsed: slot, attempts };
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
      } catch {
        return { ok: false, error: "Could not prepare the backup account; no further login attempts made.", slotUsed: slot, attempts };
      }
    }
  }
  return { ok: false, error: "Automation failed", slotUsed: slot, attempts };
}
