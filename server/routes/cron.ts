/**
 * External cron trigger endpoints.
 *
 * Protected by CRON_SECRET env var — callers must send:
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Designed for cron-job.org (or any HTTP cron service) to fire the
 * People Planner weekly sync when the autoscale instance is asleep.
 *
 * Three Monday jobs:
 *   POST /api/cron/sync?label=previous   →  01:00 UTC
 *   POST /api/cron/sync?label=current    →  03:00 UTC
 *   POST /api/cron/sync?label=next       →  05:00 UTC
 */

import type { Express } from "express";
import { logger } from "../infrastructure/logger";
import {
  getConfiguredBranchIds,
  programmaticQueueSync,
} from "../features/people-planner/automation-routes";

type SyncLabel = "previous" | "current" | "next";

const WEEK_OFFSETS: Record<SyncLabel, number> = {
  previous: -7,
  current:   0,
  next:      7,
};

/** Returns the Monday of the week containing `date`, offset by `dayOffset` days, as YYYY-MM-DD (UTC). */
function getMondayWithOffset(date: Date, dayOffset: number): string {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday + dayOffset);
  return d.toISOString().split("T")[0];
}

export function registerCronRoutes(app: Express): void {
  app.post("/api/cron/sync", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      logger.warn("Cron trigger hit but CRON_SECRET is not configured");
      return res.status(503).json({ error: "Cron not configured on this server" });
    }

    const authHeader = req.headers["authorization"] ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (token !== secret) {
      logger.warn("Cron trigger rejected — invalid secret", { ip: req.ip });
      return res.status(401).json({ error: "Unauthorized" });
    }

    const label = (req.query.label as string | undefined) ?? "current";
    if (!["previous", "current", "next"].includes(label)) {
      return res.status(400).json({ error: "label must be previous | current | next" });
    }

    const syncLabel = label as SyncLabel;
    const weekStartDate = getMondayWithOffset(new Date(), WEEK_OFFSETS[syncLabel]);
    const branchIds = getConfiguredBranchIds();

    logger.info("Cron trigger received", { label: syncLabel, weekStartDate, branchIds });

    const results: Record<string, string> = {};
    for (const branchId of branchIds) {
      try {
        const r = await programmaticQueueSync(branchId, weekStartDate, `cron-${syncLabel}`);
        results[branchId] = r.queued ? `queued (#${r.queuePosition})` : "already queued";
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results[branchId] = `error: ${msg}`;
        logger.error("Cron sync queue failed", err instanceof Error ? err : undefined, { branchId, label: syncLabel });
      }
    }

    return res.json({ ok: true, label: syncLabel, weekStartDate, results });
  });
}
