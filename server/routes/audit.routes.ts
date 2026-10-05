import type { Express } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../features/auth/auth";
import { listAuditEvents, exportAuditEvents, writeAuditEntry } from "../repositories/audit.repository";
import { logger } from "../infrastructure/logger";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(value => !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, "Invalid date");
const querySchema = z.object({
  search: z.string().trim().max(200).optional(),
  action: z.string().max(100).optional(),
  branchId: z.string().max(80).optional(),
  from: date.optional(), to: date.optional(),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
}).refine(q => !q.from || !q.to || q.from <= q.to, "Start date must be before the end date");

export function registerAuditRoutes(app: Express): void {
  app.get("/api/admin/audit-events", requireAuth, requireRole("admin"), async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0].message });
    try { return res.json(await listAuditEvents(parsed.data)); }
    catch (err) {
      logger.error("Audit search failed", err);
      return res.status(500).json({ message: "Could not load the audit log. Please try again." });
    }
  });
  app.get("/api/admin/audit-events/export", requireAuth, requireRole("admin"), async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0].message });
    try {
      const exported = await exportAuditEvents(parsed.data);
      // Do not release a sensitive export if its own audit write fails.
      await writeAuditEntry({
        userId: req.session.userId ?? null, userEmail: req.session.userEmail ?? null,
        branchId: parsed.data.branchId ?? null, action: "AUDIT_EXPORTED",
        detail: `Audit log exported: ${exported.count} events; dates and filters applied`,
      });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="care-capacity-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send(exported.csv);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Narrow the date")) return res.status(400).json({ message: err.message });
      logger.error("Audit export failed", err);
      return res.status(500).json({ message: "Could not export the audit log. Please try again." });
    }
  });
}
