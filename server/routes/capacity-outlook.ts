import type { Express } from 'express';
import { requireRoleAtLeast } from '../features/auth/auth';
import { auditLog } from '../features/auth/auth';
import { resolveBranch } from '../utils/helpers';
import { asyncHandler } from '../middleware/error-handler';
import { createAppError } from '../middleware/error-handler';
import {
  computeOutlook,
  getLeavers,
  getJoiners,
  createLeaver,
  updateLeaver,
  deleteLeaver,
  hardDeleteLeaver,
  createJoiner,
  updateJoiner,
  deleteJoiner,
  hardDeleteJoiner,
  getOutlookDetail,
  getMonthlySnapshots,
  getCurrentMonthLive,
  updateMonthlySnapshot,
  deleteMonthlySnapshot,
  computeCumulativeKpi,
} from '../repositories/capacity-outlook.repository';

const MILESTONE_WEIGHTS: Record<string, number> = {
  'Hired': 1.0,
  'Onboarding': 0.33,
  'Training Attended': 0.33,
  'PVG': 0.11,
  'REF1': 0.11,
  'REF2': 0.11,
};
const MILESTONE_PRIORITY = ['Hired', 'REF2', 'REF1', 'PVG', 'Training Attended', 'Onboarding'];

function computeConfidenceFromMilestones(stages: string[]): number {
  if (stages.includes('Hired')) return 1.0;
  return stages.reduce((sum, s) => sum + (MILESTONE_WEIGHTS[s] ?? 0), 0);
}

function deriveStageFromMilestones(stages: string[], status: string): string {
  if (status === 'dropped') return 'Dropped';
  if (status === 'hired' || status === 'hired_archived') return 'Hired';
  for (const m of MILESTONE_PRIORITY) {
    if (stages.includes(m)) return m;
  }
  return 'Onboarding';
}

import { insertLeaverSchema, insertJoinerSchema } from '@shared/schema';
import { z } from 'zod';

export function registerCapacityOutlookRoutes(app: Express): void {

  // GET /api/capacity-outlook — weekly aggregates
  app.get('/api/capacity-outlook', asyncHandler(async (req, res) => {
    const branchId = await resolveBranch(req);
    const weeks = Math.min(parseInt((req.query.weeks as string) || '4', 10), 12);
    const segment = (req.query.segment as string) || 'all';

    const result = await computeOutlook(branchId, weeks, segment);
    res.json(result);
  }));

  // GET /api/capacity-outlook/leavers
  app.get('/api/capacity-outlook/leavers', asyncHandler(async (req, res) => {
    const branchId = await resolveBranch(req);
    const includeProcessed = req.query.includeProcessed === 'true';
    const rows = await getLeavers(branchId, includeProcessed);
    res.json(rows);
  }));

  // GET /api/capacity-outlook/joiners
  app.get('/api/capacity-outlook/joiners', asyncHandler(async (req, res) => {
    const branchId = await resolveBranch(req);
    const includeDropped = req.query.includeDropped === 'true';
    const includeAll = req.query.includeAll === 'true';
    const rows = await getJoiners(branchId, includeDropped, includeAll);
    res.json(rows);
  }));

  // GET /api/capacity-outlook/detail?branchId=&weekStart=
  app.get('/api/capacity-outlook/detail', asyncHandler(async (req, res) => {
    const branchId = await resolveBranch(req);
    const weekStart = req.query.weekStart as string;
    if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      throw createAppError('weekStart must be a YYYY-MM-DD date', 400);
    }
    const detail = await getOutlookDetail(branchId, weekStart);
    res.json(detail);
  }));

  // GET /api/capacity-outlook/monthly — saved snapshots + live current month
  app.get('/api/capacity-outlook/monthly', asyncHandler(async (req, res) => {
    const branchId = await resolveBranch(req);
    const snapshots = await getMonthlySnapshots(branchId);
    const live = await getCurrentMonthLive(branchId);
    const now = new Date();
    res.json({
      snapshots,
      live,
      currentYear: now.getUTCFullYear(),
      currentMonth: now.getUTCMonth() + 1,
    });
  }));

  // GET /api/capacity-outlook/cumulative-kpi — all-time KPI from snapshots + live month
  app.get('/api/capacity-outlook/cumulative-kpi', asyncHandler(async (req, res) => {
    const branchId = await resolveBranch(req);
    const result = await computeCumulativeKpi(branchId);
    res.json(result);
  }));

  // PUT /api/capacity-outlook/monthly/:year/:month — edit a saved snapshot
  app.put(
    '/api/capacity-outlook/monthly/:year/:month',
    requireRoleAtLeast('scheduler'),
    asyncHandler(async (req, res) => {
      const branchId = await resolveBranch(req);
      const year = parseInt(req.params.year, 10);
      const month = parseInt(req.params.month, 10);
      if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
        throw createAppError('Invalid year or month', 400);
      }
      const { hoursIn, headsIn, hoursOut, headsOut } = req.body;
      const snapshot = await updateMonthlySnapshot(branchId, year, month, {
        hoursIn: Number(hoursIn) || 0,
        headsIn: Number(headsIn) || 0,
        hoursOut: Number(hoursOut) || 0,
        headsOut: Number(headsOut) || 0,
      });
      await auditLog(
        req.session?.userId ?? null,
        req.session?.userEmail ?? null,
        branchId,
        'MONTH_UPDATED',
        `Monthly snapshot updated: ${year}-${String(month).padStart(2, '0')}`,
      );

      res.json(snapshot);
    }),
  );

  // DELETE /api/capacity-outlook/monthly/:year/:month — reopen a closed month
  app.delete(
    '/api/capacity-outlook/monthly/:year/:month',
    requireRoleAtLeast('scheduler'),
    asyncHandler(async (req, res) => {
      const branchId = await resolveBranch(req);
      const year = parseInt(req.params.year, 10);
      const month = parseInt(req.params.month, 10);
      if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
        throw createAppError('Invalid year or month', 400);
      }
      const ok = await deleteMonthlySnapshot(branchId, year, month);
      if (!ok) throw createAppError('Snapshot not found', 404);
      await auditLog(
        req.session?.userId ?? null,
        req.session?.userEmail ?? null,
        branchId,
        'MONTH_REOPENED',
        `Monthly snapshot deleted (reopened): ${year}-${String(month).padStart(2, '0')}`,
      );
      res.json({ success: true });
    }),
  );

  // POST /api/capacity-outlook/leavers
  app.post(
    '/api/capacity-outlook/leavers',
    requireRoleAtLeast('scheduler'),
    asyncHandler(async (req, res) => {
      const branchId = await resolveBranch(req);
      const parsed = insertLeaverSchema.safeParse({ ...req.body, branchId });
      if (!parsed.success) {
        throw createAppError(parsed.error.errors[0]?.message || 'Invalid leaver data', 400);
      }
      const data = parsed.data;

      const leaver = await createLeaver({
        ...data,
        createdBy: req.session?.userId ?? null,
      });

      await auditLog(
        req.session?.userId ?? null,
        req.session?.userEmail ?? null,
        branchId,
        'LEAVER_CREATED',
        `Leaver created: ${data.employeeName}, last working day ${data.lastWorkingDay}`,
      );

      res.status(201).json(leaver);
    }),
  );

  // PUT /api/capacity-outlook/leavers/:id
  app.put(
    '/api/capacity-outlook/leavers/:id',
    requireRoleAtLeast('scheduler'),
    asyncHandler(async (req, res) => {
      const branchId = await resolveBranch(req);
      const { id } = req.params;

      const updateSchema = insertLeaverSchema.partial().omit({ branchId: true });
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw createAppError(parsed.error.errors[0]?.message || 'Invalid update data', 400);
      }

      const data = parsed.data;

      const updated = await updateLeaver(id, branchId, data);
      if (!updated) throw createAppError('Leaver not found or access denied', 404);

      await auditLog(
        req.session?.userId ?? null,
        req.session?.userEmail ?? null,
        branchId,
        'LEAVER_UPDATED',
        `Leaver updated: ${id}`,
      );

      res.json(updated);
    }),
  );

  // DELETE /api/capacity-outlook/leavers/:id
  // ?hard=true requires admin and permanently removes the record
  app.delete(
    '/api/capacity-outlook/leavers/:id',
    requireRoleAtLeast('scheduler'),
    asyncHandler(async (req, res) => {
      const branchId = await resolveBranch(req);
      const { id } = req.params;
      const hard = req.query.hard === 'true';

      if (hard) {
        if (req.session?.userRole !== 'admin') {
          throw createAppError('Admin role required for permanent deletion', 403);
        }
        const ok = await hardDeleteLeaver(id, branchId);
        if (!ok) throw createAppError('Leaver not found or access denied', 404);
        await auditLog(
          req.session?.userId ?? null,
          req.session?.userEmail ?? null,
          branchId,
          'LEAVER_DELETED',
          `Leaver permanently deleted: ${id}`,
        );
      } else {
        const ok = await deleteLeaver(id, branchId);
        if (!ok) throw createAppError('Leaver not found or access denied', 404);
        await auditLog(
          req.session?.userId ?? null,
          req.session?.userEmail ?? null,
          branchId,
          'LEAVER_DELETED',
          `Leaver soft-deleted: ${id}`,
        );
      }

      res.json({ success: true });
    }),
  );

  // POST /api/capacity-outlook/joiners
  app.post(
    '/api/capacity-outlook/joiners',
    requireRoleAtLeast('scheduler'),
    asyncHandler(async (req, res) => {
      const branchId = await resolveBranch(req);
      const parsed = insertJoinerSchema.safeParse({ ...req.body, branchId });
      if (!parsed.success) {
        throw createAppError(parsed.error.errors[0]?.message || 'Invalid joiner data', 400);
      }
      const data = parsed.data;
      const completedStages = data.completedStages ?? [];
      const status = data.status ?? 'active';
      const stage = deriveStageFromMilestones(completedStages, status) as string;
      const confidenceWeight = status === 'dropped' ? 0 : computeConfidenceFromMilestones(completedStages);

      // Auto-set hiredAt when marking as hired
      const hiredAt = (status === 'hired' && !data.hiredAt)
        ? new Date().toISOString().split('T')[0]
        : (data.hiredAt ?? null);

      const joiner = await createJoiner({
        ...data,
        stage,
        status,
        completedStages,
        confidenceWeight,
        hiredAt,
        createdBy: req.session?.userId ?? null,
      });

      await auditLog(
        req.session?.userId ?? null,
        req.session?.userEmail ?? null,
        branchId,
        'JOINER_CREATED',
        `Joiner created: ${data.candidateName}, stage ${stage}`,
      );

      res.status(201).json(joiner);
    }),
  );

  // PUT /api/capacity-outlook/joiners/:id
  app.put(
    '/api/capacity-outlook/joiners/:id',
    requireRoleAtLeast('scheduler'),
    asyncHandler(async (req, res) => {
      const branchId = await resolveBranch(req);
      const { id } = req.params;

      const updateSchema = insertJoinerSchema.partial().omit({ branchId: true });
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw createAppError(parsed.error.errors[0]?.message || 'Invalid update data', 400);
      }

      const data = parsed.data;
      const completedStages = data.completedStages ?? [];
      const status = data.status ?? 'active';
      const stage = deriveStageFromMilestones(completedStages, status) as string;
      const confidenceWeight = status === 'dropped' ? 0 : computeConfidenceFromMilestones(completedStages);

      // Auto-set hiredAt when transitioning to hired
      const hiredAt = (status === 'hired' && !data.hiredAt)
        ? new Date().toISOString().split('T')[0]
        : (data.hiredAt ?? undefined);

      const updated = await updateJoiner(id, branchId, {
        ...data, stage, status, completedStages, confidenceWeight, hiredAt,
      });
      if (!updated) throw createAppError('Joiner not found or access denied', 404);

      await auditLog(
        req.session?.userId ?? null,
        req.session?.userEmail ?? null,
        branchId,
        'JOINER_UPDATED',
        `Joiner updated: ${id}, stage ${stage}`,
      );

      res.json(updated);
    }),
  );

  // DELETE /api/capacity-outlook/joiners/:id
  // ?hard=true requires admin and permanently removes the record
  app.delete(
    '/api/capacity-outlook/joiners/:id',
    requireRoleAtLeast('scheduler'),
    asyncHandler(async (req, res) => {
      const branchId = await resolveBranch(req);
      const { id } = req.params;
      const hard = req.query.hard === 'true';

      if (hard) {
        if (req.session?.userRole !== 'admin') {
          throw createAppError('Admin role required for permanent deletion', 403);
        }
        const ok = await hardDeleteJoiner(id, branchId);
        if (!ok) throw createAppError('Joiner not found or access denied', 404);
        await auditLog(
          req.session?.userId ?? null,
          req.session?.userEmail ?? null,
          branchId,
          'JOINER_DELETED',
          `Joiner permanently deleted: ${id}`,
        );
      } else {
        const ok = await deleteJoiner(id, branchId);
        if (!ok) throw createAppError('Joiner not found or access denied', 404);
        await auditLog(
          req.session?.userId ?? null,
          req.session?.userEmail ?? null,
          branchId,
          'JOINER_DELETED',
          `Joiner soft-deleted: ${id}`,
        );
      }

      res.json({ success: true });
    }),
  );
}
