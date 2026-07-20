import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler';
import * as travelTimesController from '../controllers/travel-times.controller';

const router = Router();

router.post('/travel-times/pairs', asyncHandler(travelTimesController.pairsTravelTimes));
router.post('/travel-times/batch', asyncHandler(travelTimesController.batchTravelTimes));
router.post('/travel-times/debug-single', asyncHandler(travelTimesController.debugSingleTravelTime));

export function registerTravelTimesRoutes(app: { use: Function }): void {
  app.use('/api', router);
}
