import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler';
import * as visitsController from '../controllers/visits.controller';

const router = Router();

router.get('/visits/:date', asyncHandler(visitsController.getVisitsByDate));
router.get('/visits', asyncHandler(visitsController.listVisitsBetween));

export function registerVisitsRoutes(app: { use: Function }): void {
  app.use('/api', router);
}
