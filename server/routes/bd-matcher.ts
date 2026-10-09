import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler';
import { safeTravel } from '../middleware/safe-travel';
import * as bdMatcherController from '../controllers/bd-matcher.controller';

const router = Router();

router.post('/bd-matcher', asyncHandler(safeTravel(bdMatcherController.bdMatch)));
router.post('/bd-matcher/multi-visit', asyncHandler(safeTravel(bdMatcherController.bdMatchMultiVisit)));
// Each week retains its own 90-second deadline; the complete streamed run is
// bounded to 15 minutes rather than forcing all weeks into one 90-second request.
router.post('/bd-matcher/multi-week', asyncHandler(safeTravel(bdMatcherController.bdMatchMultiWeek, 15 * 60 * 1000)));

export function registerBdMatcherRoutes(app: { use: Function }): void {
  app.use('/api', router);
}
