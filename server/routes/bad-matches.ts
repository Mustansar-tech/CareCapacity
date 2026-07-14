import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/require-auth';
import { requireRoleAtLeast } from '../middleware/require-role';
import { asyncHandler } from '../middleware/error-handler';
import { resolveBranch } from '../utils/helpers';
import { insertBadMatchSchema } from '@shared/schema';
import * as badMatchRepo from '../repositories/bad-match.repository';

const router = Router();

router.get('/bad-matches', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const branchId = await resolveBranch(req);
  const matches = await badMatchRepo.getBadMatches(branchId);
  res.json(matches);
}));

router.post('/bad-matches', requireAuth, requireRoleAtLeast('scheduler'), asyncHandler(async (req: Request, res: Response) => {
  const branchId = await resolveBranch(req);
  const parsed = insertBadMatchSchema.safeParse({ ...req.body, branchId });
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid bad match data', details: parsed.error.flatten() });
    return;
  }
  const clientName = parsed.data.clientName.trim();
  const employeeName = parsed.data.employeeName.trim();
  if (!clientName || !employeeName) {
    res.status(400).json({ error: 'Client name and care pro name are required' });
    return;
  }
  const created = await badMatchRepo.createBadMatch({ ...parsed.data, clientName, employeeName });
  res.status(201).json(created);
}));

router.delete('/bad-matches/:id', requireAuth, requireRoleAtLeast('scheduler'), asyncHandler(async (req: Request, res: Response) => {
  const branchId = await resolveBranch(req);
  const deleted = await badMatchRepo.deleteBadMatch(branchId, req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Bad match not found' });
    return;
  }
  res.json({ success: true });
}));

export function registerBadMatchRoutes(app: { use: Function }): void {
  app.use('/api', router);
}
