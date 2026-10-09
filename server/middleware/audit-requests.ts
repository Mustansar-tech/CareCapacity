import type { RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { auditRequestContext } from "../infrastructure/audit-context";
import { writeAuditEntry } from "../repositories/audit.repository";
import { logger } from "../infrastructure/logger";
import type { AuditDetails } from "@shared/audit";

function subjectName(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  for (const key of ["employeeName", "candidateName", "clientName", "displayName", "subjectName", "name"]) {
    if (typeof record[key] === "string") return String(record[key]).slice(0, 200);
  }
}

/** Safety-net events for application mutations without a domain-specific audit. */
export const auditRequests: RequestHandler = (req, res, next) => {
  if (!req.path.startsWith("/api/")) return next();
  const context = {
    actor: { userId: req.session?.userId ?? null, userEmail: req.session?.userEmail ?? null },
    request: {
      id: randomUUID(), method: req.method, path: req.path.slice(0, 500),
      ip: req.ip?.slice(0, 128) ?? null, userAgent: req.get("user-agent")?.slice(0, 256) ?? null,
    },
    recorded: false,
  };
  res.setHeader("X-Request-Id", context.request.id);
  auditRequestContext.run(context, () => {
    let name = subjectName(req.body);
    let recordId: string | undefined;
    const originalJson = res.json;
    res.json = function(body) {
      name = subjectName(body) ?? name;
      if (body && typeof body === "object" && typeof body.id === "string") recordId = body.id;
      return originalJson.call(this, body);
    };
    res.once("finish", () => {
      const streamErrorStatus = res.locals?.streamErrorStatus;
      const streamFailed = typeof streamErrorStatus === "number" && streamErrorStatus >= 400;
      const failed = res.statusCode >= 400 || streamFailed;
      const mutation = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
      if ((!mutation && !(failed && res.statusCode === 403)) || (context.recorded && !failed)) return;
      const actor = {
        userId: req.session?.userId ?? context.actor.userId,
        userEmail: req.session?.userEmail ?? context.actor.userEmail,
      };
      // Anonymous auth probes aren't application changes and would flood the log.
      if (!actor.userId) return;
      const resource = req.path.split("/").filter(Boolean)[1]?.replaceAll("-", " ") ?? "application";
      const routePath = typeof req.route?.path === "string" ? req.route.path : req.path;
      const readableTarget = routePath.split("/").filter((part: string) =>
        part && part !== "api" && !part.startsWith(":") && !/^[0-9a-f-]{36}$/i.test(part) && !/^\d+$/.test(part),
      ).map((part: string) => part.replaceAll("-", " ")).join(" / ");
      const operation = req.method === "DELETE" ? "delete" : req.method === "POST" ? "create" : "update";
      const action = failed ? "REQUEST_FAILED" : `APPLICATION_${operation === "delete" ? "DELETED" : operation === "create" ? "CREATED" : "UPDATED"}`;
      const summary = failed
        ? `Request failed: ${readableTarget}${name ? ` — ${name}` : ""} (${streamFailed ? `stream error ${streamErrorStatus}` : `HTTP ${res.statusCode}`}); no successful change is claimed`
        : `${req.method === "DELETE" ? "Removal completed" : req.method === "POST" ? "Action completed" : "Update completed"}: ${readableTarget}${name ? ` — ${name}` : ""}`;
      const metadata: AuditDetails = {
        format: "care-capacity.audit.v1", summary, entityType: resource, entityName: name,
        entityId: recordId ?? req.params.id ?? req.params.userId,
        outcome: failed ? "failure" : "success", scope: "request",
        request: { ...context.request, statusCode: res.statusCode },
      };
      const branchId = typeof req.body?.branchId === "string" ? req.body.branchId
        : typeof req.query.branchId === "string" ? req.query.branchId : null;
      void writeAuditEntry({ ...actor, branchId, action, detail: JSON.stringify(metadata) })
        .catch(error => logger.error("Application audit event could not be persisted", error, { requestId: context.request.id, action }));
    });
    next();
  });
};
