import type { Express } from 'express';
import { storage } from '../storage';
import { logger } from '../logger';
import { safeErrorMessage, resolveBranch } from '../utils/helpers';
import { requireAuth, requireRoleAtLeast } from '../auth';

export function registerEnquiriesRoutes(app: Express): void {
  app.post('/api/client-enquiries', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const {
        clientName,
        postcode,
        genderPreference,
        requiredDays,
        preferredTimeWindow,
        matchCount,
        topMatch,
        results,
        isMultiVisit,
      } = req.body;

      if (!clientName) {
        return res.status(400).json({ message: 'Missing required field: clientName' });
      }
      if (!isMultiVisit && (!requiredDays || !preferredTimeWindow)) {
        return res.status(400).json({ message: 'Missing required fields' });
      }

      const enquiry = await storage.saveClientEnquiry({
        branchId,
        clientName,
        postcode: postcode || null,
        genderPreference: genderPreference || null,
        requiredDays: requiredDays || [],
        preferredTimeWindow: preferredTimeWindow || {},
        visitDurationMinutes: req.body.visitDurationMinutes || 60,
        matchCount: matchCount || 0,
        topMatch: topMatch || null,
        results: results || null,
      });

      res.json(enquiry);
    } catch (error) {
      logger.error('Save client enquiry error', error);
      res.status(500).json({ message: safeErrorMessage(error, 'Failed to save enquiry') });
    }
  });

  app.get('/api/client-enquiries', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const enquiries = await storage.getClientEnquiries(branchId, limit);
      res.json(enquiries);
    } catch (error) {
      logger.error('Get client enquiries error', error);
      res.status(500).json({ message: safeErrorMessage(error, 'Failed to fetch enquiries') });
    }
  });

  app.delete('/api/client-enquiries/:id', async (req, res) => {
    try {
      await storage.deleteClientEnquiry(req.params.id);
      res.json({ success: true });
    } catch (error) {
      logger.error('Delete client enquiry error', error);
      res.status(500).json({ message: safeErrorMessage(error, 'Failed to delete enquiry') });
    }
  });

  app.post('/api/feedback', requireAuth, async (req, res) => {
    try {
      const { z } = await import('zod');
      const bodySchema = z.object({
        type: z.enum(['bug', 'general']).default('bug'),
        title: z.string().min(1, 'Title required').max(200),
        description: z.string().min(1, 'Description required').max(5000),
        stepsToReproduce: z.string().max(5000).optional().nullable(),
        branchId: z.string().optional().nullable(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid feedback data', errors: parsed.error.flatten() });
      }
      const submittedByEmail = req.session.userEmail || 'unknown';
      const record = await storage.createFeedback({
        ...parsed.data,
        submittedByEmail,
        stepsToReproduce: parsed.data.stepsToReproduce ?? null,
        branchId: parsed.data.branchId ?? null,
      });
      res.status(201).json(record);
    } catch (error) {
      logger.error('Create feedback error', error);
      res.status(500).json({ message: safeErrorMessage(error, 'Failed to submit feedback') });
    }
  });

  app.get('/api/feedback', requireAuth, requireRoleAtLeast('admin'), async (_req, res) => {
    try {
      const records = await storage.listFeedback();
      res.json(records);
    } catch (error) {
      logger.error('List feedback error', error);
      res.status(500).json({ message: safeErrorMessage(error, 'Failed to fetch feedback') });
    }
  });
}
