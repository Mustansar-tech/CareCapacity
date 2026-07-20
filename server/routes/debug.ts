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

router.post('/admin/clear-map-locations', requireRole('admin'), asyncHandler(async (req, res) => {
  const { resolveBranch } = await import('../utils/helpers');
  const {
    clearAllRoutePlans,
    clearAllVisits,
    clearEmployeeLocations,
    clearClientLocations,
  } = await import('../repositories/geo.repository');
  const branchId = await resolveBranch(req);

  // Delete child rows first to satisfy FK constraints:
  //   route_stops  → route_plans (cascade, handled automatically)
  //   visits       → client_locations
  //   route_plans  → employee_locations
  await Promise.all([clearAllRoutePlans(branchId), clearAllVisits(branchId)]);
  const [empCount, clientCount] = await Promise.all([
    clearEmployeeLocations(branchId),
    clearClientLocations(branchId),
  ]);
  res.json({ success: true, employeesRemoved: empCount, clientsRemoved: clientCount });
}));

export function registerDebugRoutes(app: { use: Function }): void {
  app.use('/api', router);
}
