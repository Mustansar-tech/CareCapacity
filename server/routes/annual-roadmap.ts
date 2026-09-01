import type { Express } from 'express';
import { asyncHandler } from '../middleware/error-handler';
import { createAppError } from '../middleware/error-handler';
import { requireRoleAtLeast } from '../features/auth/auth';
import {
  getRoadmapYears,
  getRoadmapEntriesForYear,
  upsertRoadmapEntry,
  getRoadmapEntry,
  getRoadmapAssumptions,
  replaceRoadmapAssumptions,
  ROADMAP_OFFICE_ORDER,
} from '../repositories/annual-roadmap.repository';
import { insertAnnualRoadmapEntrySchema, insertAnnualRoadmapAssumptionSchema } from '@shared/schema';
import { z } from 'zod';

const monthEntrySchema = insertAnnualRoadmapEntrySchema.omit({ year: true, office: true, month: true });

const officePayloadSchema = z.object({
  months: z.array(monthEntrySchema.extend({ month: z.number().int().min(1).max(12) })).min(1),
});

const assumptionsPayloadSchema = z.object({
  assumptions: z.array(insertAnnualRoadmapAssumptionSchema.omit({ year: true })),
});

// Annual Roadmap tab (next to KPI Tracker, under Day Rate Tracker) — one place
// to hold each franchise's (and the group's) yearly plan/growth-driver
// targets, reused as KPI Tracker targets and reusable across future years.
export function registerAnnualRoadmapRoutes(app: Express): void {
  const adminOnly = requireRoleAtLeast('admin');

  // GET /api/annual-roadmap/offices — canonical office list/order for the tab
  app.get('/api/annual-roadmap/offices', adminOnly, asyncHandler(async (_req, res) => {
    res.json(ROADMAP_OFFICE_ORDER);
  }));

  // GET /api/annual-roadmap/years — every year that has data, most recent first
  app.get('/api/annual-roadmap/years', adminOnly, asyncHandler(async (_req, res) => {
    const years = await getRoadmapYears();
    res.json(years);
  }));

  // GET /api/annual-roadmap/:year — every office's 12 months for a year, plus assumptions
  app.get('/api/annual-roadmap/:year', adminOnly, asyncHandler(async (req, res) => {
    const year = parseInt(req.params.year, 10);
    if (!Number.isFinite(year)) throw createAppError('year must be a number', 400);
    const [entries, assumptions] = await Promise.all([
      getRoadmapEntriesForYear(year),
      getRoadmapAssumptions(year),
    ]);
    res.json({ entries, assumptions });
  }));

  // GET /api/annual-roadmap/:year/:office/:month — single entry, used to prefill KPI Tracker targets
  app.get('/api/annual-roadmap/:year/:office/:month', adminOnly, asyncHandler(async (req, res) => {
    const year = parseInt(req.params.year, 10);
    const month = parseInt(req.params.month, 10);
    if (!Number.isFinite(year) || !Number.isFinite(month)) throw createAppError('year and month must be numbers', 400);
    const entry = await getRoadmapEntry(year, req.params.office, month);
    res.json(entry);
  }));

  // PUT /api/annual-roadmap/:year/:office — upsert all 12 months for one office in one go
  app.put('/api/annual-roadmap/:year/:office', adminOnly, asyncHandler(async (req, res) => {
    const year = parseInt(req.params.year, 10);
    if (!Number.isFinite(year)) throw createAppError('year must be a number', 400);
    const office = req.params.office;
    const parsed = officePayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      throw createAppError(`Invalid payload: ${parsed.error.message}`, 400);
    }
    const saved = [];
    for (const month of parsed.data.months) {
      const { month: monthNumber, ...rest } = month;
      saved.push(await upsertRoadmapEntry({ ...rest, year, office, month: monthNumber }));
    }
    res.json(saved);
  }));

  // PUT /api/annual-roadmap/:year/assumptions — replace the Key Player assumptions table for a year
  app.put('/api/annual-roadmap/:year/assumptions', adminOnly, asyncHandler(async (req, res) => {
    const year = parseInt(req.params.year, 10);
    if (!Number.isFinite(year)) throw createAppError('year must be a number', 400);
    const parsed = assumptionsPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      throw createAppError(`Invalid payload: ${parsed.error.message}`, 400);
    }
    const saved = await replaceRoadmapAssumptions(year, parsed.data.assumptions.map(a => ({ ...a, year })));
    res.json(saved);
  }));
}
