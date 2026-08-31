import type { Express } from 'express';
import { asyncHandler } from '../middleware/error-handler';
import { createAppError } from '../middleware/error-handler';
import { requireRoleAtLeast } from '../features/auth/auth';
import {
  getKpiWeeks,
  getKpiWeekEntries,
  upsertKpiWeeklyEntry,
  deleteKpiWeek,
  KPI_STORE_ORDER,
} from '../repositories/kpi.repository';
import { insertKpiWeeklyEntrySchema } from '@shared/schema';
import { z } from 'zod';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const weekPayloadSchema = z.object({
  weekBeginning: z.string().regex(DATE_RE),
  weekNumber: z.number().int().positive(),
  qtrNumber: z.number().int().positive(),
  daysInMonth: z.number().int().nonnegative(),
  groupName: z.string().default('SUR Group'),
  rows: z.array(insertKpiWeeklyEntrySchema.omit({ weekBeginning: true, weekNumber: true, qtrNumber: true, daysInMonth: true, groupName: true })),
});

// KPI Tracker tab (under Day Rate Tracker) — weekly per-store KPI figures,
// manually entered/edited in-app after the initial historical import.
// Admin-only, same access level as the rest of the Day Rate Tracker.
export function registerKpiWeeklyRoutes(app: Express): void {
  const adminOnly = requireRoleAtLeast('admin');

  // GET /api/kpi-weekly/stores — canonical store list/order for the tab
  app.get('/api/kpi-weekly/stores', adminOnly, asyncHandler(async (_req, res) => {
    res.json(KPI_STORE_ORDER);
  }));

  // GET /api/kpi-weekly/weeks — every week that has data, most recent first
  app.get('/api/kpi-weekly/weeks', adminOnly, asyncHandler(async (_req, res) => {
    const weeks = await getKpiWeeks();
    res.json(weeks);
  }));

  // GET /api/kpi-weekly/:weekBeginning — all store rows for one week
  app.get('/api/kpi-weekly/:weekBeginning', adminOnly, asyncHandler(async (req, res) => {
    const { weekBeginning } = req.params;
    if (!DATE_RE.test(weekBeginning)) {
      throw createAppError('weekBeginning must be YYYY-MM-DD', 400);
    }
    const entries = await getKpiWeekEntries(weekBeginning);
    res.json(entries);
  }));

  // PUT /api/kpi-weekly/:weekBeginning — upsert every store row for one week in one go
  app.put('/api/kpi-weekly/:weekBeginning', adminOnly, asyncHandler(async (req, res) => {
    const { weekBeginning } = req.params;
    if (!DATE_RE.test(weekBeginning)) {
      throw createAppError('weekBeginning must be YYYY-MM-DD', 400);
    }
    const parsed = weekPayloadSchema.safeParse({ ...req.body, weekBeginning });
    if (!parsed.success) {
      throw createAppError(`Invalid payload: ${parsed.error.message}`, 400);
    }
    const { weekNumber, qtrNumber, daysInMonth, groupName, rows } = parsed.data;

    const saved = [];
    for (const row of rows) {
      saved.push(await upsertKpiWeeklyEntry({
        ...row,
        weekBeginning,
        weekNumber,
        qtrNumber,
        daysInMonth,
        groupName,
      }));
    }
    res.json(saved);
  }));

  // DELETE /api/kpi-weekly/:weekBeginning — remove every row for one week
  app.delete('/api/kpi-weekly/:weekBeginning', adminOnly, asyncHandler(async (req, res) => {
    const { weekBeginning } = req.params;
    if (!DATE_RE.test(weekBeginning)) {
      throw createAppError('weekBeginning must be YYYY-MM-DD', 400);
    }
    const deleted = await deleteKpiWeek(weekBeginning);
    res.json({ deleted });
  }));
}
