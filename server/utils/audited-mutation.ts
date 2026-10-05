import type { AuditActor } from "../infrastructure/audit-context";
import { markAuditRecorded } from "../infrastructure/audit-context";
import { writeAuditEntry, type AuditDatabase } from "../repositories/audit.repository";
import { recordAuditDetails, type AuditDetails } from "@shared/audit";
import { db } from "../infrastructure/db";

export async function auditedMutation<T>(
  actor: AuditActor | undefined,
  branchId: string,
  action: string,
  entityType: string,
  operation: AuditDetails["operation"],
  mutate: (executor: typeof db) => Promise<{ result: T; before: Record<string, unknown> | null; after: Record<string, unknown> | null; name?: string }>,
): Promise<T> {
  if (!actor) return (await mutate(db)).result;
  const result = await db.transaction(async tx => {
    const mutation = await mutate(tx as unknown as typeof db);
    if (mutation.before || mutation.after) {
      await writeAuditEntry({
        ...actor, branchId, action,
        detail: JSON.stringify(recordAuditDetails(entityType, operation, mutation.before, mutation.after, mutation.name)),
      }, tx as AuditDatabase, false);
    }
    return mutation.result;
  });
  // Mark only after COMMIT succeeds; failed operations must not claim a success.
  if (result !== null && result !== false) markAuditRecorded();
  return result;
}
