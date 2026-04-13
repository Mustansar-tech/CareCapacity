import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler';
import * as debugController from '../controllers/debug.controller';

const router = Router();

router.get('/debug/employee-comparison', asyncHandler(debugController.employeeComparison));

router.post('/admin/re-geocode-clients', asyncHandler(async (_req, res) => {
  const { sweepMissingClientGeocode } = await import('../jobs/geo-sweeper');
  const result = await sweepMissingClientGeocode();
  res.json({ success: true, ...result });
}));

export function registerDebugRoutes(app: { use: Function }): void {
  app.use('/api', router);
}
