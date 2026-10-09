import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler';
import { safeTravel } from '../middleware/safe-travel';
import * as bdMatcherController from '../controllers/bd-matcher.controller';

const router = Router();

router.post('/bd-matcher', asyncHandler(safeTravel(bdMatcherController.bdMatch)));
router.post('/bd-matcher/multi-visit', asyncHandler(safeTravel(bdMatcherController.bdMatchMultiVisit)));
router.post('/bd-matcher/multi-week', asyncHandler(safeTravel(bdMatcherController.bdMatchMultiWeek)));

export function registerBdMatcherRoutes(app: { use: Function }): void {
  app.use('/api', router);
}
