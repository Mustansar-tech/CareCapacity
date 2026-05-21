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
  createJoiner,
  updateJoiner,
  deleteJoiner,
  getOutlookDetail,
  getConfidenceWeight,
} from '../repositories/capacity-outlook.repository';
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
    const rows = await getJoiners(branchId, includeDropped);
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
  app.delete(
    '/api/capacity-outlook/leavers/:id',
    requireRoleAtLeast('scheduler'),
    asyncHandler(async (req, res) => {
      const branchId = await resolveBranch(req);
      const { id } = req.params;
      const ok = await deleteLeaver(id, branchId);
      if (!ok) throw createAppError('Leaver not found or access denied', 404);

      await auditLog(
        req.session?.userId ?? null,
        req.session?.userEmail ?? null,
        branchId,
        'LEAVER_DELETED',
        `Leaver soft-deleted: ${id}`,
      );

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
      const confidenceWeight = getConfidenceWeight(data.stage);

      const joiner = await createJoiner({
        ...data,
        confidenceWeight,
        createdBy: req.session?.userId ?? null,
      });

      await auditLog(
        req.session?.userId ?? null,
        req.session?.userEmail ?? null,
        branchId,
        'JOINER_CREATED',
        `Joiner created: ${data.candidateName}, stage ${data.stage}, start ${data.expectedStartDate}`,
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
      const extra: { confidenceWeight?: number } = {};
      if (data.stage) {
        extra.confidenceWeight = getConfidenceWeight(data.stage);
      }

      const updated = await updateJoiner(id, branchId, { ...data, ...extra });
      if (!updated) throw createAppError('Joiner not found or access denied', 404);

      await auditLog(
        req.session?.userId ?? null,
        req.session?.userEmail ?? null,
        branchId,
        'JOINER_UPDATED',
        `Joiner updated: ${id}`,
      );

      res.json(updated);
    }),
  );

  // DELETE /api/capacity-outlook/joiners/:id
  app.delete(
    '/api/capacity-outlook/joiners/:id',
    requireRoleAtLeast('scheduler'),
    asyncHandler(async (req, res) => {
      const branchId = await resolveBranch(req);
      const { id } = req.params;
      const ok = await deleteJoiner(id, branchId);
      if (!ok) throw createAppError('Joiner not found or access denied', 404);

      await auditLog(
        req.session?.userId ?? null,
        req.session?.userEmail ?? null,
        branchId,
        'JOINER_DELETED',
        `Joiner soft-deleted: ${id}`,
      );

      res.json({ success: true });
    }),
  );
}
