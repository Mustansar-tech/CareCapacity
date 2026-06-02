import type { Express, Request, Response } from 'express';
import { requireRole } from '../features/auth/auth';
import { sendLeaverReport } from '../jobs/leaver-report';
import { logger } from '../infrastructure/logger';

export function registerLeaverReportRoutes(app: Express): void {
  /**
   * POST /api/leaver-report/send
   * Admin-only manual trigger — sends the leaver report for a given month
   * (defaults to the previous calendar month).
   *
   * Optional body: { year: number, month: number }  (month is 0-indexed)
   */
  app.post(
    '/api/leaver-report/send',
    requireRole('admin'),
    async (req: Request, res: Response) => {
      try {
        const { year, month } = req.body ?? {};
        const result = await sendLeaverReport(
          typeof year === 'number' ? year : undefined,
          typeof month === 'number' ? month : undefined,
        );
        res.json({ ok: true, ...result });
      } catch (err) {
        logger.error('Leaver report manual trigger failed', err instanceof Error ? err : undefined);
        res.status(500).json({ ok: false, message: err instanceof Error ? err.message : 'Failed to send report' });
      }
    },
  );
}
