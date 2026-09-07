import type { Express } from 'express';
import { asyncHandler } from '../middleware/error-handler';
import { createAppError } from '../middleware/error-handler';
import { requireRole } from '../features/auth/auth';
import { getReportingMonths, getAllFranchises, getDayRateGrid } from '../repositories/day-rate.repository';

const MONTH_RE = /^\d{4}-\d{2}$/;

// BI users can read franchise-level figures. Automation remains admin-only in
// automation-routes.ts.
export function registerDayRateRoutes(app: Express): void {
  const biRead = requireRole('admin', 'bi_user');

  // GET /api/day-rate/months — every reporting month with data, ascending
  app.get('/api/day-rate/months', biRead, asyncHandler(async (_req, res) => {
    const months = await getReportingMonths();
    res.json(months);
  }));

  // GET /api/day-rate/franchises — full franchise reference list
  app.get('/api/day-rate/franchises', biRead, asyncHandler(async (_req, res) => {
    const franchises = await getAllFranchises();
    res.json(franchises);
  }));

  // GET /api/day-rate/grid?month=YYYY-MM — scoreboard data for one reporting month
  app.get('/api/day-rate/grid', biRead, asyncHandler(async (req, res) => {
    const month = req.query.month as string;
    if (!month || !MONTH_RE.test(month)) {
      throw createAppError('Query param "month" is required in YYYY-MM format', 400);
    }
    const grid = await getDayRateGrid(month);
    res.json(grid);
  }));
}
