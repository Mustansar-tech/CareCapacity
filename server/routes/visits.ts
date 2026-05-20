import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler';
import * as visitsController from '../controllers/visits.controller';

const router = Router();

// Week endpoint MUST come before :date to avoid "week" being captured as the date param
router.get('/visits/week/:weekStart', asyncHandler(visitsController.getVisitsByWeek));
router.get('/visits/:date', asyncHandler(visitsController.getVisitsByDate));
router.get('/visits', asyncHandler(visitsController.listVisitsBetween));

export function registerVisitsRoutes(app: { use: Function }): void {
  app.use('/api', router);
}
