import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler';
import * as debugController from '../controllers/debug.controller';

const router = Router();

router.get('/debug/employee-comparison', asyncHandler(debugController.employeeComparison));

export function registerDebugRoutes(app: { use: Function }): void {
  app.use('/api', router);
}
