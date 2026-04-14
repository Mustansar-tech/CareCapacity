import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler';
import { requireRole } from '../middleware/require-role';
import * as debugController from '../controllers/debug.controller';

const router = Router();

router.get('/debug/employee-comparison', requireRole('admin'), asyncHandler(debugController.employeeComparison));

router.post('/admin/re-geocode-clients', requireRole('admin'), asyncHandler(async (_req, res) => {
  const { sweepMissingClientGeocode } = await import('../jobs/geo-sweeper');
  const result = await sweepMissingClientGeocode();
  res.json({ success: true, ...result });
}));

export function registerDebugRoutes(app: { use: Function }): void {
  app.use('/api', router);
}
