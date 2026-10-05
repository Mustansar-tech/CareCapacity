import { db } from "../infrastructure/db";
import { auditLogs, users, branches, type InsertAuditLog, type AuditLog } from "@shared/schema";
import { parseAuditDetails, csvCell, auditActionLabel, type AuditDetails, type AuditEvent } from "@shared/audit";
import { auditRequestContext, markAuditRecorded } from "../infrastructure/audit-context";
import { and, or, eq, ilike, gte, lt, desc, count, type SQL } from "drizzle-orm";

export type AuditDatabase = Pick<typeof db, "select" | "insert">;
export async function writeAuditEntry(log: InsertAuditLog, executor: AuditDatabase = db, markRecorded = true): Promise<AuditLog> {
  const context = auditRequestContext.getStore();
  const metadata: AuditDetails = parseAuditDetails(log.detail) ?? {
    format: "care-capacity.audit.v1", summary: log.detail ?? auditActionLabel(log.action), outcome: "success",
  };
  const [actor, branch] = await Promise.all([
    log.userId ? executor.select({ name: users.displayName }).from(users).where(eq(users.id, log.userId)).limit(1) : Promise.resolve([]),
    log.branchId ? executor.select({ name: branches.displayName }).from(branches).where(eq(branches.id, log.branchId)).limit(1) : Promise.resolve([]),
  ]);
  metadata.actorName = actor[0]?.name ?? log.userEmail ?? "System";
  metadata.branchName = branch[0]?.name ?? null;
  if (context) metadata.request = { ...context.request, ...metadata.request };
  const [saved] = await executor.insert(auditLogs).values({ ...log, detail: JSON.stringify(metadata) }).returning();
  if (markRecorded) markAuditRecorded();
  return saved;
}

export interface AuditFilters {
  search?: string; action?: string; branchId?: string; from?: string; to?: string;
  page: number; pageSize: number;
}
function londonMidnight(day: string): Date {
  const utc = new Date(`${day}T00:00:00Z`);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(utc));
  return new Date(utc.getTime() - hour * 3600000);
}
export function auditFilterConditions(filters: AuditFilters): SQL | undefined {
  const clauses: SQL[] = [];
  if (filters.action) clauses.push(eq(auditLogs.action, filters.action));
  if (filters.branchId) clauses.push(eq(auditLogs.branchId, filters.branchId));
  if (filters.search) {
    const term = `%${filters.search.replace(/[\\%_]/g, "\\$&")}%`;
    clauses.push(or(ilike(auditLogs.detail, term), ilike(auditLogs.userEmail, term), ilike(auditLogs.action, term), ilike(auditLogs.id, term))!);
  }
  if (filters.from) clauses.push(gte(auditLogs.timestamp, londonMidnight(filters.from)));
  if (filters.to) {
    const next = new Date(`${filters.to}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    clauses.push(lt(auditLogs.timestamp, londonMidnight(next.toISOString().slice(0, 10))));
  }
  return and(...clauses);
}
function eventFromRow(row: { log: AuditLog; actorName: string | null; branchName: string | null }): AuditEvent {
  const metadata = parseAuditDetails(row.log.detail);
  return {
    ...row.log, timestamp: row.log.timestamp.toISOString(),
    detail: metadata?.summary ?? row.log.detail,
    metadata: metadata ? {
      ...metadata,
      actorName: metadata.actorName ?? row.actorName,
      branchName: metadata.branchName ?? row.branchName,
    } : null,
  };
}
async function rowsFor(filters: AuditFilters, limit: number, offset = 0) {
  const rows = await db.select({ log: auditLogs, actorName: users.displayName, branchName: branches.displayName })
    .from(auditLogs).leftJoin(users, eq(auditLogs.userId, users.id)).leftJoin(branches, eq(auditLogs.branchId, branches.id))
    .where(auditFilterConditions(filters)).orderBy(desc(auditLogs.timestamp), desc(auditLogs.id)).limit(limit).offset(offset);
  return rows.map(eventFromRow);
}
export async function listAuditEvents(filters: AuditFilters) {
  const [events, totalRows, actionRows] = await Promise.all([
    rowsFor(filters, filters.pageSize, (filters.page - 1) * filters.pageSize),
    db.select({ total: count() }).from(auditLogs).where(auditFilterConditions(filters)),
    db.selectDistinct({ action: auditLogs.action }).from(auditLogs).orderBy(auditLogs.action),
  ]);
  return { events, total: totalRows[0]?.total ?? 0, page: filters.page, pageSize: filters.pageSize, actions: actionRows.map(row => row.action) };
}
export async function exportAuditEvents(filters: AuditFilters) {
  const [{ total }] = await db.select({ total: count() }).from(auditLogs).where(auditFilterConditions(filters));
  if (total > 10000) throw new Error("Narrow the date range or filters to export no more than 10,000 events.");
  const events = await rowsFor(filters, 10000);
  const header = ["Event reference", "Timestamp (UTC)", "Action", "Actor name", "Actor email", "Actor reference", "Branch", "Branch reference", "Subject", "Record reference", "Operation", "Outcome", "Summary", "Changes", "Before", "After", "Request reference", "Method", "Path", "IP address"];
  const csv = [header, ...events.map(e => [
    e.id, e.timestamp, auditActionLabel(e.action), e.metadata?.actorName ?? "", e.userEmail, e.userId,
    e.metadata?.branchName ?? "", e.branchId, e.metadata?.entityName ?? "", e.metadata?.entityId ?? "",
    e.metadata?.operation ?? "", e.metadata?.outcome ?? "Legacy (not recorded)", e.detail,
    JSON.stringify(e.metadata?.changes ?? []), JSON.stringify(e.metadata?.before ?? null), JSON.stringify(e.metadata?.after ?? null),
    e.metadata?.request?.id ?? "", e.metadata?.request?.method ?? "", e.metadata?.request?.path ?? "", e.metadata?.request?.ip ?? "",
  ])].map(row => row.map(csvCell).join(",")).join("\r\n");
  return { csv: "\uFEFF" + csv, count: events.length };
}
