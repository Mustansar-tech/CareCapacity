import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/require-auth';
import { requireRoleAtLeast } from '../middleware/require-role';
import { asyncHandler } from '../middleware/error-handler';
import { logger } from '../logger';
import * as processController from '../controllers/process.controller';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    logger.debug('File upload attempt', { fileName: file.originalname, mimeType: file.mimetype });
    if (
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.originalname.toLowerCase().endsWith('.xlsx') ||
      file.originalname.toLowerCase().endsWith('.xls')
    ) {
      logger.debug('File accepted', { fileName: file.originalname });
      cb(null, true);
    } else {
      logger.warn('File rejected', { fileName: file.originalname, mimeType: file.mimetype });
      cb(new Error(`Only Excel files are allowed. Got MIME type: ${file.mimetype}`));
    }
  },
});

const router = Router();

router.post(
  '/process',
  requireAuth,
  requireRoleAtLeast('scheduler'),
  upload.fields([
    { name: 'availability', maxCount: 1 },
    { name: 'guaranteed', maxCount: 1 },
    { name: 'cgData', maxCount: 1 },
  ]),
  asyncHandler(processController.processCapacity),
);

router.get('/export', processController.getExport);

export function registerProcessRoutes(app: { use: Function }): void {
  app.use('/api', router);
}
