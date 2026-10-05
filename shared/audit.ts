/** Structured audit details live in the existing audit_logs.detail column. */
export type AuditValue = string | number | boolean | null;
export interface AuditChange {
  field: string;
  label: string;
  before: AuditValue;
  after: AuditValue;
  redacted?: boolean;
}
export interface AuditDetails {
  format: "care-capacity.audit.v1";
  summary: string;
  actorName?: string | null;
  branchName?: string | null;
  entityType?: string;
  entityId?: string;
  entityName?: string;
  operation?: "create" | "update" | "archive" | "delete";
  outcome?: "success" | "failure";
  scope?: "record" | "request";
  before?: Record<string, AuditValue> | null;
  after?: Record<string, AuditValue> | null;
  changes?: AuditChange[];
  request?: {
    id: string;
    method: string;
    path: string;
    ip: string | null;
    userAgent: string | null;
    statusCode?: number;
  };
}
export interface AuditEvent {
  id: string;
  userId: string | null;
  userEmail: string | null;
  branchId: string | null;
  action: string;
  detail: string | null;
  timestamp: string;
  metadata: AuditDetails | null;
}
export interface AuditPage {
  events: AuditEvent[];
  total: number;
  page: number;
  pageSize: number;
  actions: string[];
}
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  LOGIN: "Signed in", LOGOUT: "Signed out", LEGAL_CONSENT_ACCEPTED: "Legal documents accepted",
  USER_CREATED: "User created", USER_UPDATED: "User updated",
  LEAVER_CREATED: "Leaver added", LEAVER_UPDATED: "Leaver updated", LEAVER_DELETED: "Leaver removed",
  JOINER_CREATED: "Joiner added", JOINER_UPDATED: "Joiner updated", JOINER_DELETED: "Joiner removed",
  AVAIL_CHANGE_CREATED: "Availability change added", AVAIL_CHANGE_UPDATED: "Availability change updated",
  AVAIL_CHANGE_DELETED: "Availability change removed",
  MONTH_UPDATED: "Monthly snapshot updated", MONTH_REOPENED: "Month reopened",
  SCHEDULE_SAVED: "Schedule saved", SCHEDULE_GENERATED: "Schedule generated",
  VISIT_REASSIGNED: "Visit reassigned", REQUEST_FAILED: "Request failed",
  APPLICATION_CREATED: "Record created / action run", APPLICATION_UPDATED: "Record updated",
  APPLICATION_DELETED: "Record deleted", AUDIT_EXPORTED: "Audit log exported",
  hr_manual_created: "HR record added", hr_manual_updated: "HR record updated",
  hr_manual_deleted: "HR record removed", hr_active_status: "Employee status changed",
  hr_backfill: "HR history backfilled", dsar_logged: "Data request logged",
  dsar_updated: "Data request updated", dsar_export: "Data request exported",
};
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action.toLowerCase().replaceAll("_", " ").replace(/^\w/, c => c.toUpperCase());
}

export function parseAuditDetails(detail: string | null | undefined): AuditDetails | null {
  if (!detail?.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(detail);
    return parsed?.format === "care-capacity.audit.v1" && typeof parsed.summary === "string" ? parsed : null;
  } catch { return null; }
}

export const AUDIT_FIELD_LABELS: Record<string, string> = {
  id: "Record reference", employeeName: "Employee name", candidateName: "Candidate name",
  displayName: "Name", email: "Email", role: "Role", isActive: "Account active",
  lastWorkingDay: "Last working day", weeklyHours: "Weekly hours", isLic: "Live-in care",
  status: "Status", stage: "Stage", desiredWeeklyHours: "Desired weekly hours",
  expectedStartDate: "Expected start date", hiredAt: "Hired date", applicationDate: "Application date",
  trainingDate: "Training days", trainingDay2Date: "Training day 2 date",
  changeType: "Change type", currentHours: "Previous hours", newHours: "New hours",
  effectiveDate: "Effective date", year: "Year", month: "Month",
  hoursIn: "Hours gained", headsIn: "People joining", hoursOut: "Hours lost", headsOut: "People leaving",
  femaleHoursIn: "Female hours gained", maleHoursIn: "Male hours gained",
  femaleHeadsIn: "Female people joining", maleHeadsIn: "Male people joining",
  femaleHoursOut: "Female hours lost", maleHoursOut: "Male hours lost",
  femaleHeadsOut: "Female people leaving", maleHeadsOut: "Male people leaving",
  branchNames: "Assigned branches", passwordReset: "Password reset",
};
const SAFE_FIELDS = new Set(Object.keys(AUDIT_FIELD_LABELS));
const OMIT_FIELDS = new Set(["createdAt", "updatedAt", "createdBy", "snapshotCreatedAt", "branchId"]);
const SECRET_FIELD = /password|token|secret|credential|cookie|session/i;
function scalar(value: unknown): AuditValue {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return Array.isArray(value) ? value.map(String).join(", ") : "[not retained]";
}
export function safeAuditSnapshot(record: Record<string, unknown> | null): Record<string, AuditValue> | null {
  if (!record) return null;
  return Object.fromEntries(Object.entries(record).filter(([key]) => SAFE_FIELDS.has(key)).map(([key, value]) => [key, scalar(value)]));
}
export function auditChanges(before: Record<string, unknown> | null, after: Record<string, unknown> | null): AuditChange[] {
  if (!before || !after) return [];
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(key => !OMIT_FIELDS.has(key) && (!SECRET_FIELD.test(key) || key === "passwordReset") && JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
    .map(field => ({
      field, label: AUDIT_FIELD_LABELS[field] ?? field.replace(/([A-Z])/g, " $1").replace(/^\w/, c => c.toUpperCase()),
      before: SAFE_FIELDS.has(field) ? scalar(before[field]) : "[not retained]",
      after: SAFE_FIELDS.has(field) ? scalar(after[field]) : "[not retained]",
      ...(!SAFE_FIELDS.has(field) ? { redacted: true } : {}),
    }));
}
export function recordAuditDetails(
  entityType: string, operation: AuditDetails["operation"],
  before: Record<string, unknown> | null, after: Record<string, unknown> | null,
  name?: string,
): AuditDetails {
  const record = before ?? after ?? {};
  const entityName = name ?? String(record.employeeName ?? record.candidateName ?? record.displayName ?? record.email ?? entityType);
  const verbs = { create: "added", update: "updated", archive: "archived / removed from active records", delete: "permanently deleted" };
  const noun = entityType.replace(/^\w/, c => c.toUpperCase());
  const context = record.lastWorkingDay ? `; last working day ${record.lastWorkingDay}` : "";
  return {
    format: "care-capacity.audit.v1",
    summary: `${noun} ${verbs[operation ?? "update"]}: ${entityName}${context}`,
    entityType, entityId: String(record.id ?? ""), entityName, operation, outcome: "success", scope: "record",
    before: safeAuditSnapshot(before), after: safeAuditSnapshot(after), changes: auditChanges(before, after),
  };
}
export function csvCell(value: unknown): string {
  const text = String(value ?? "");
  // Stop spreadsheet formula execution from user-supplied names/details.
  return `"${(/^\s*[=+\-@]|^[\t\r\n]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`;
}
