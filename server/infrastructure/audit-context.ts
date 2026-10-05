import { AsyncLocalStorage } from "node:async_hooks";
import type { AuditDetails } from "@shared/audit";

export interface AuditActor { userId: string | null; userEmail: string | null }
export interface AuditRequestContext {
  actor: AuditActor;
  request: NonNullable<AuditDetails["request"]>;
  recorded: boolean;
}
export const auditRequestContext = new AsyncLocalStorage<AuditRequestContext>();
export function markAuditRecorded(): void {
  const context = auditRequestContext.getStore();
  if (context) context.recorded = true;
}
