import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler';
import * as geoController from '../controllers/geo.controller';

const router = Router();

router.post('/geo/geocode-batch', asyncHandler(geoController.geocodeBatch));
router.post('/routing/distance-matrix', asyncHandler(geoController.distanceMatrix));
router.post('/routing/optimize', asyncHandler(geoController.optimizeRouting));
router.get('/routing/plans', asyncHandler(geoController.getRoutingPlans));
router.get('/geographical/employees', asyncHandler(geoController.getEmployeeLocations));
router.get('/geographical/clients', asyncHandler(geoController.getClientLocations));
router.get('/locations', asyncHandler(geoController.getAllLocations));

export function registerGeoRoutes(app: { use: Function }): void {
  app.use('/api', router);
}
