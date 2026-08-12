import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler';
import * as bdMatcherController from '../controllers/bd-matcher.controller';

const router = Router();

router.post('/bd-matcher', asyncHandler(bdMatcherController.bdMatch));
router.post('/bd-matcher/multi-visit', asyncHandler(bdMatcherController.bdMatchMultiVisit));
router.post('/bd-matcher/multi-week', asyncHandler(bdMatcherController.bdMatchMultiWeek));

export function registerBdMatcherRoutes(app: { use: Function }): void {
  app.use('/api', router);
}
