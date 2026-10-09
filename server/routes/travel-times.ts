import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler';
import { safeTravel } from '../middleware/safe-travel';
import * as travelTimesController from '../controllers/travel-times.controller';

const router = Router();

router.post('/travel-times/pairs', asyncHandler(safeTravel(travelTimesController.pairsTravelTimes)));
router.post('/travel-times/batch', asyncHandler(safeTravel(travelTimesController.batchTravelTimes)));
router.post('/travel-times/schedule-block', asyncHandler(safeTravel(travelTimesController.scheduleTravelBlock)));
router.post('/travel-times/debug-single', asyncHandler(safeTravel(travelTimesController.debugSingleTravelTime)));

export function registerTravelTimesRoutes(app: { use: Function }): void {
  app.use('/api', router);
}
