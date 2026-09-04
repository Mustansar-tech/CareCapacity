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
import { getAllBranches } from '../repositories/branch.repository';
import { getCapacityAnalysisByWeekStart } from '../repositories/capacity.repository';
import {
  getCarerHomeBranchMap,
  getCrossBranchCpHours,
  getForeignCarerNames,
} from '../repositories/schedule.repository';
import { calculateGhLossTotal } from '../features/capacity/gh-loss-calculator';
import type { GhLossRawSummary } from '@shared/schema';
import { insertKpiWeeklyEntrySchema } from '@shared/schema';
import { z } from 'zod';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const BRANCH_TO_KPI_STORE: Record<string, string> = {
  'glasgow-north': 'Glasgow North',
  'glasgow-south': 'Glasgow South',
  'stirling-falkirk': 'Stirling',
  'south-ayrshire': 'South Ayrshire',
  'perthshire': 'Perthshire',
  'north-lanarkshire': 'North Lanarkshire',
  'aberdeen': 'Aberdeen',
  'east-lothian': 'East Lothian',
  'scottish-borders': 'Scottish Borders',
  'west-fife-kinross': 'West Fife',
};

type EmployeeSummaryByDate = Record<string, Array<{
  employeeName: string;
  scheduledHours: number;
  ghScheduledHours?: number;
  unavailability: number;
  availability?: number;
}>>;

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function getCapacityCardValues(branchId: string, weekBeginning: string) {
  const analysis = await getCapacityAnalysisByWeekStart(branchId, weekBeginning);
  if (!analysis) return null;

  const employeeSummary = analysis.employeeSummaryByDate as EmployeeSummaryByDate;
  const summaryDates = Object.keys(employeeSummary)
    .filter(date => DATE_RE.test(date))
    .sort();
  const dailyDates = (analysis.dailySummary as Array<{ date?: string }>)
    .map(day => day.date ?? '')
    .filter(date => DATE_RE.test(date));
  const dates = summaryDates.length > 0 ? summaryDates : dailyDates;
  const extra = await getCrossBranchCpHours(branchId, dates);
  const names = Object.keys(extra);
  if (names.length > 0) {
    const homeMap = await getCarerHomeBranchMap(names);
    for (const name of names) {
      const homeBranchId = homeMap[name];
      if (homeBranchId && homeBranchId !== branchId) delete extra[name];
    }
  }
  const foreignCarers = await getForeignCarerNames(branchId);
  const kpis = analysis.kpis as { sicknessSum?: number };

  return {
    ghLoss: calculateGhLossTotal(
      employeeSummary,
      analysis.ghLossRawSummary as GhLossRawSummary | null,
      extra,
      foreignCarers,
    ),
    sickness: Number(kpis.sicknessSum ?? 0),
  };
}

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

  // Values synced from the Care Capacity cards for the selected KPI week.
  app.get('/api/kpi-weekly/capacity-sync/:weekBeginning', adminOnly, asyncHandler(async (req, res) => {
    const { weekBeginning } = req.params;
    if (!DATE_RE.test(weekBeginning)) {
      throw createAppError('weekBeginning must be YYYY-MM-DD', 400);
    }

    const previousWeek = addDays(weekBeginning, -7);
    const branches = await getAllBranches();
    const rows: Record<string, {
      guaranteedHourWastageLastWeek: number | null;
      guaranteedHourWastageCurrentWeek: number | null;
      absenceHoursLastWeek: number | null;
    }> = {};

    // Keep these sequential: each calculation performs several database reads,
    // and a fan-out across all branches can exhaust smaller connection pools.
    for (const branch of branches) {
      const store = BRANCH_TO_KPI_STORE[branch.name];
      if (!store) continue;
      const previous = await getCapacityCardValues(branch.id, previousWeek);
      const current = await getCapacityCardValues(branch.id, weekBeginning);
      rows[store] = {
        guaranteedHourWastageLastWeek: previous?.ghLoss ?? null,
        guaranteedHourWastageCurrentWeek: current?.ghLoss ?? null,
        absenceHoursLastWeek: previous?.sickness ?? null,
      };
    }

    res.json({ weekBeginning, previousWeek, rows });
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
