import type { Express, Request, Response } from 'express';
import { requireRole } from '../features/auth/auth';
import { sendLeaverReport } from '../jobs/leaver-report';
import { logger } from '../infrastructure/logger';
import { db } from '../infrastructure/db';
import { leaverReportRecipients, insertLeaverReportRecipientSchema } from '@shared/schema';
import { eq } from 'drizzle-orm';

export function registerLeaverReportRoutes(app: Express): void {
  /**
   * GET /api/leaver-report/recipients
   * Returns the current DB recipient list (admin only).
   */
  app.get(
    '/api/leaver-report/recipients',
    requireRole('admin'),
    async (_req: Request, res: Response) => {
      try {
        const rows = await db.select().from(leaverReportRecipients).orderBy(leaverReportRecipients.addedAt);
        res.json(rows);
      } catch (err) {
        res.status(500).json({ message: err instanceof Error ? err.message : 'Failed to fetch recipients' });
      }
    },
  );

  /**
   * POST /api/leaver-report/recipients
   * Add a recipient email address (admin only).
   */
  app.post(
    '/api/leaver-report/recipients',
    requireRole('admin'),
    async (req: Request, res: Response) => {
      try {
        const parsed = insertLeaverReportRecipientSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ message: parsed.error.errors[0]?.message ?? 'Invalid email' });
          return;
        }
        const [row] = await db
          .insert(leaverReportRecipients)
          .values(parsed.data)
          .onConflictDoNothing()
          .returning();
        if (!row) {
          res.status(409).json({ message: 'This email address is already on the list' });
          return;
        }
        logger.info('Leaver report recipient added', { email: parsed.data.email });
        res.status(201).json(row);
      } catch (err) {
        res.status(500).json({ message: err instanceof Error ? err.message : 'Failed to add recipient' });
      }
    },
  );

  /**
   * DELETE /api/leaver-report/recipients/:id
   * Remove a recipient by ID (admin only).
   */
  app.delete(
    '/api/leaver-report/recipients/:id',
    requireRole('admin'),
    async (req: Request, res: Response) => {
      try {
        await db.delete(leaverReportRecipients).where(eq(leaverReportRecipients.id, req.params.id));
        logger.info('Leaver report recipient removed', { id: req.params.id });
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ message: err instanceof Error ? err.message : 'Failed to remove recipient' });
      }
    },
  );

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
