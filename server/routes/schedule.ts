import { Router } from 'express';
import { requireAuth } from '../middleware/require-auth';
import { requireRoleAtLeast } from '../middleware/require-role';
import { asyncHandler } from '../middleware/error-handler';
import * as scheduleController from '../controllers/schedule.controller';

const router = Router();

router.post('/schedule/auto-day', asyncHandler(scheduleController.autoScheduleDay));
router.post('/schedule/auto-week', asyncHandler(scheduleController.autoScheduleWeek));
router.get('/schedule/week/:startDate', asyncHandler(scheduleController.getWeekSchedule));
router.post('/run-optimization/optimize', asyncHandler(scheduleController.runOptimization));
router.post('/auto-schedule', asyncHandler(scheduleController.autoSchedule));

router.post('/weekly-schedule/generate', requireAuth, requireRoleAtLeast('scheduler'), asyncHandler(scheduleController.generateWeeklySchedule));
router.get('/weekly-schedule/latest', asyncHandler(scheduleController.getLatestWeeklySchedule));
router.get('/weekly-schedule/:weekStartDate', asyncHandler(scheduleController.getWeeklyScheduleByDate));
router.post('/weekly-schedule/save', requireAuth, requireRoleAtLeast('scheduler'), asyncHandler(scheduleController.saveWeeklySchedule));

export function registerScheduleRoutes(app: { use: Function }): void {
  app.use('/api', router);
}
