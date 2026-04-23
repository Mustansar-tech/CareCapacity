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

// Temporary ORS diagnostic — admin only
router.get('/debug/ors-test', requireRole('admin'), asyncHandler(async (_req, res) => {
  const key = process.env.ORS_API_KEY;
  if (!key) { res.json({ error: 'ORS_API_KEY not set in environment' }); return; }
  const keyPreview = `${key.slice(0, 8)}...${key.slice(-6)} (length: ${key.length})`;
  try {
    const response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
      method: 'POST',
      headers: { 'Authorization': key, 'Content-Type': 'application/json', 'Accept': 'application/json, application/geo+json' },
      body: JSON.stringify({ coordinates: [[-4.318474, 55.940053], [-4.210072, 55.874085]] }),
    });
    const body = await response.text();
    res.json({ keyPreview, status: response.status, statusText: response.statusText, body: body.slice(0, 500) });
  } catch (err: unknown) {
    res.json({ keyPreview, fetchError: String(err) });
  }
}));

export function registerDebugRoutes(app: { use: Function }): void {
  app.use('/api', router);
}
