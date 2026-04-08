import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler';
import * as historyController from '../controllers/history.controller';

const router = Router();

router.get('/history', asyncHandler(historyController.getHistory));
router.get('/history/latest', asyncHandler(historyController.getLatestHistory));
router.get('/history/range/:startDate/:endDate', asyncHandler(historyController.getHistoryByDateRange));
router.post('/cleanup', asyncHandler(historyController.cleanupOldData));
router.get('/cleanup/preview/:months', asyncHandler(historyController.previewCleanup));
router.post('/cleanup/routes-visits', asyncHandler(historyController.cleanupRoutesAndVisits));

export function registerHistoryRoutes(app: { use: Function }): void {
  app.use('/api', router);
}
