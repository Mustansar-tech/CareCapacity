import { Request, Response } from 'express';
import { resolveBranch } from '../utils/helpers';
import * as scheduleRepo from '../repositories/schedule.repository';
import { getUserBranches } from '../repositories/user.repository';
import * as geoRepo from '../repositories/geo.repository';
import { getCanonicalWeekBoundaries } from '@shared/schema';
import { logger } from '../infrastructure/logger';
import type { ClientVisit } from '@shared/schema';

/** Convert a GhClientVisit DB row into the ClientVisit shape the frontend expects */
function toClientVisit(row: { id: string; clientName: string; date: string; startTime: string; endTime: string; durationMinutes: number; serviceType: string | null; priority: number | null; lat: string | null; lng: string | null }): ClientVisit {
  return {
    id: row.id,
    clientName: row.clientName,
    date: row.date,
    startTime: row.startTime,
    endTime: row.endTime,
    durationMinutes: row.durationMinutes,
    serviceType: row.serviceType ?? undefined,
    priority: row.priority ?? 1,
    lat: row.lat != null ? Number(row.lat) : undefined,
    lng: row.lng != null ? Number(row.lng) : undefined,
  };
}

/**
 * GET /api/visits/:date
 * Returns client-demand visits for a single date from the DB.
 * Data is populated at processing time — no Excel parsing at request time.
 */
export async function getVisitsByDate(req: Request, res: Response): Promise<void> {
  const { date } = req.params;
  const branchId = await resolveBranch(req);
  logger.debug('getVisitsByDate (DB)', { date, branchId });

  const rows = await scheduleRepo.getGhClientVisitsByDate(branchId, date);
  res.json(rows.map(toClientVisit));
}

/**
 * GET /api/visits/week/:weekStart
 * Returns all client-demand visits for the Mon–Sun week in one DB query.
 * Replaces 7× /api/visits/:date calls from the weekly plan tab.
 */
export async function getVisitsByWeek(req: Request, res: Response): Promise<void> {
  const { weekStart } = req.params;
  const branchId = await resolveBranch(req);
  logger.debug('getVisitsByWeek (DB)', { weekStart, branchId });

  const { weekStart: monday, weekEnd: sunday } = getCanonicalWeekBoundaries(weekStart);
  const rows = await scheduleRepo.getGhClientVisitsByWeek(branchId, monday, sunday);
  res.json(rows.map(toClientVisit));
}

/**
 * GET /api/visits?startDate=&endDate=
 * Legacy range query against the old visits table (kept for backward compat).
 */
export async function listVisitsBetween(req: Request, res: Response): Promise<void> {
  const { startDate, endDate } = req.query;
  const branchId = await resolveBranch(req);

  if (!startDate || !endDate) {
    res.status(400).json({ message: 'Start date and end date are required' });
    return;
  }

  const visits = await geoRepo.listVisitsBetween(branchId, String(startDate), String(endDate));
  res.json(visits);
}

/**
 * GET /api/gh-loss/cross-branch?branchId=&dates=yyyy-MM-dd,yyyy-MM-dd,...
 * Hours a carer works in OTHER branches during the given dates, keyed by
 * normalized carer name. Used to credit cross-branch cover back to the
 * carer's home-branch GH loss calculation.
 */
export async function getCrossBranchGhHours(req: Request, res: Response): Promise<void> {
  const branchId = await resolveBranch(req);
  const datesParam = String(req.query.dates ?? '');
  const dates = datesParam.split(',').map(d => d.trim()).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (dates.length === 0 || dates.length > 14) {
    res.status(400).json({ message: 'dates query param required (1-14 yyyy-MM-dd values, comma-separated)' });
    return;
  }
  // Non-admin users only see hours from branches they are assigned to —
  // prevents cross-branch schedule disclosure.
  let allowedBranchIds: string[] | undefined;
  const userId = req.session?.userId;
  const userRole = req.session?.userRole;
  if (userId && userRole !== 'admin') {
    const assigned = await getUserBranches(userId);
    allowedBranchIds = assigned.map(b => b.id);
  }
  const extra = await scheduleRepo.getCrossBranchCpHours(branchId, dates, allowedBranchIds);

  // Only credit hours to carers whose recorded home branch is the requesting
  // branch (from the CG Data "Branch" column). Carers with no recorded home
  // branch are kept (legacy behaviour before the mapping existed).
  const names = Object.keys(extra);
  if (names.length > 0) {
    const homeMap = await scheduleRepo.getCarerHomeBranchMap(names);
    for (const name of names) {
      const home = homeMap[name];
      if (home && home !== branchId) delete extra[name];
    }
  }
  res.json({ extraScheduled: extra });
}
