import type { Express, Request, Response } from 'express';
import { requireRole, auditLog } from '../features/auth/auth';
import { logger } from '../infrastructure/logger';
import { db } from '../infrastructure/db';
import {
  dataRequests,
  insertDataRequestSchema,
  users,
  auditLogs,
  employeeLocations,
  clientLocations,
  joiners,
  leavers,
  feedback,
} from '@shared/schema';
import { eq, or, ilike } from 'drizzle-orm';

/**
 * Data Subject Access Request (DSAR) tooling — admin only.
 *
 * This tracks incoming requests (access / rectification / erasure / restriction /
 * portability) against their one-month statutory deadline, and lets an admin
 * generate a data export covering everything the app holds that matches a
 * subject's name or email.
 *
 * By design this tool only TRACKS and EXPORTS. It never deletes or rectifies
 * data automatically — erasure and rectification stay deliberate manual actions
 * elsewhere in the app so a bug or misclick here can't destroy real records.
 */

function addOneMonth(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + 1);
  // handle month-length overflow (e.g. 31 Jan + 1 month)
  if (d.getUTCDate() !== day) {
    d.setUTCDate(0);
  }
  return d.toISOString().slice(0, 10);
}

export function registerDataRequestRoutes(app: Express): void {
  // GET /api/data-requests — list all logged requests
  app.get('/api/data-requests', requireRole('admin'), async (_req: Request, res: Response) => {
    try {
      const rows = await db.select().from(dataRequests).orderBy(dataRequests.dueDate);
      res.json(rows);
    } catch (err) {
      logger.error('Failed to fetch data requests', err instanceof Error ? err : undefined);
      res.status(500).json({ message: 'Failed to fetch data requests.' });
    }
  });

  // POST /api/data-requests — log a new request; due date is auto-calculated (+1 month)
  app.post('/api/data-requests', requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const body = { ...req.body };
      if (body.dateReceived && !body.dueDate) {
        body.dueDate = addOneMonth(body.dateReceived);
      }
      const parsed = insertDataRequestSchema.safeParse(body);
      if (!parsed.success) {
        res.status(400).json({ message: parsed.error.errors[0]?.message ?? 'Invalid request' });
        return;
      }
      const [row] = await db.insert(dataRequests).values({
        ...parsed.data,
        createdBy: req.session.userId ?? null,
      }).returning();
      await auditLog(req.session.userId ?? null, req.session.userEmail ?? null, null, 'dsar_logged', `${parsed.data.requestType} request for ${parsed.data.subjectName}`);
      res.status(201).json(row);
    } catch (err) {
      logger.error('Failed to create data request', err instanceof Error ? err : undefined);
      res.status(500).json({ message: 'Failed to log data request.' });
    }
  });

  // PUT /api/data-requests/:id — update status / notes / assignment
  app.put('/api/data-requests/:id', requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const allowed = ['status', 'notes', 'assignedTo', 'completedAt'] as const;
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      for (const key of allowed) {
        if (key in req.body) updates[key] = req.body[key];
      }
      if (updates.status === 'complete' && !updates.completedAt) {
        updates.completedAt = new Date();
      }
      const [row] = await db.update(dataRequests).set(updates).where(eq(dataRequests.id, id)).returning();
      if (!row) {
        res.status(404).json({ message: 'Data request not found.' });
        return;
      }
      await auditLog(req.session.userId ?? null, req.session.userEmail ?? null, null, 'dsar_updated', `Request ${id} -> ${updates.status ?? 'updated'}`);
      res.json(row);
    } catch (err) {
      logger.error('Failed to update data request', err instanceof Error ? err : undefined);
      res.status(500).json({ message: 'Failed to update data request.' });
    }
  });

  // DELETE /api/data-requests/:id — remove a logged entry (e.g. duplicate/mistaken log)
  app.delete('/api/data-requests/:id', requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await db.delete(dataRequests).where(eq(dataRequests.id, id));
      res.status(204).end();
    } catch (err) {
      logger.error('Failed to delete data request', err instanceof Error ? err : undefined);
      res.status(500).json({ message: 'Failed to delete data request.' });
    }
  });

  // GET /api/data-requests/:id/export-data — aggregate everything the app holds
  // matching the request's subject name/email, for access/portability requests.
  // Sensitive internal fields (password hashes, session tokens) are always stripped.
  app.get('/api/data-requests/:id/export-data', requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const [request] = await db.select().from(dataRequests).where(eq(dataRequests.id, id));
      if (!request) {
        res.status(404).json({ message: 'Data request not found.' });
        return;
      }

      const name = request.subjectName?.trim();
      const email = request.subjectEmail?.trim();
      const namePattern = name ? `%${name}%` : null;

      const [platformUsers, auditEntries, employeeRecords, clientRecords, joinerRecords, leaverRecords, feedbackEntries] = await Promise.all([
        email ? db.select().from(users).where(eq(users.email, email)) : Promise.resolve([]),
        email ? db.select().from(auditLogs).where(eq(auditLogs.userEmail, email)) : Promise.resolve([]),
        namePattern ? db.select().from(employeeLocations).where(ilike(employeeLocations.employeeName, namePattern)) : Promise.resolve([]),
        namePattern ? db.select().from(clientLocations).where(ilike(clientLocations.clientName, namePattern)) : Promise.resolve([]),
        namePattern ? db.select().from(joiners).where(ilike(joiners.candidateName, namePattern)) : Promise.resolve([]),
        namePattern ? db.select().from(leavers).where(ilike(leavers.employeeName, namePattern)) : Promise.resolve([]),
        email ? db.select().from(feedback).where(eq(feedback.submittedByEmail, email)) : Promise.resolve([]),
      ]);

      // Strip internal/sensitive fields that must never leave the system in an export.
      const sanitizedUsers = platformUsers.map(({ passwordHash, supabaseUserId, ...rest }) => rest);

      const exportPayload = {
        requestId: request.id,
        subjectName: request.subjectName,
        subjectEmail: request.subjectEmail,
        generatedAt: new Date().toISOString(),
        note: 'This export aggregates all personal data Care Capacity holds matching the requested name and/or email address, across all application tables. Internal security fields (password hashes, auth tokens) are excluded.',
        sections: {
          platformAccount: sanitizedUsers,
          auditActivity: auditEntries,
          employeeRecord: employeeRecords,
          clientRecord: clientRecords,
          joinerRecord: joinerRecords,
          leaverRecord: leaverRecords,
          feedbackSubmitted: feedbackEntries,
        },
      };

      await auditLog(req.session.userId ?? null, req.session.userEmail ?? null, null, 'dsar_export', `Export generated for request ${id} (${request.subjectName})`);
      res.json(exportPayload);
    } catch (err) {
      logger.error('Failed to build data request export', err instanceof Error ? err : undefined);
      res.status(500).json({ message: 'Failed to build export.' });
    }
  });
}
