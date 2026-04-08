import { Router } from 'express';
import { requireAuth } from '../middleware/require-auth';
import { requireRoleAtLeast } from '../middleware/require-role';
import { asyncHandler } from '../middleware/error-handler';
import * as enquiryController from '../controllers/enquiry.controller';

const router = Router();

router.post('/client-enquiries', asyncHandler(enquiryController.createClientEnquiry));
router.get('/client-enquiries', asyncHandler(enquiryController.listClientEnquiries));
router.delete('/client-enquiries/:id', asyncHandler(enquiryController.deleteClientEnquiry));
router.post('/feedback', requireAuth, asyncHandler(enquiryController.submitFeedback));
router.get('/feedback', requireAuth, requireRoleAtLeast('admin'), asyncHandler(enquiryController.listFeedback));

export function registerEnquiriesRoutes(app: { use: Function }): void {
  app.use('/api', router);
}
