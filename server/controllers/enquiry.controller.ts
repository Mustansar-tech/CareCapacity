import { Request, Response } from 'express';
import { z } from 'zod';
import * as enquiryRepo from '../repositories/enquiry.repository';
import { resolveBranch } from '../utils/helpers';
import { logger } from '../infrastructure/logger';

export async function createClientEnquiry(req: Request, res: Response): Promise<void> {
  const branchId = await resolveBranch(req);
  const {
    clientName, postcode, genderPreference,
    requiredDays, preferredTimeWindow, matchCount, topMatch, results, isMultiVisit,
  } = req.body;

  if (!clientName) {
    res.status(400).json({ message: 'Missing required field: clientName' });
    return;
  }
  if (!isMultiVisit && (!requiredDays || !preferredTimeWindow)) {
    res.status(400).json({ message: 'Missing required fields' });
    return;
  }

  const enquiry = await enquiryRepo.saveClientEnquiry({
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
    isMultiVisit: isMultiVisit ? 1 : 0,
  });

  res.json(enquiry);
}

export async function listClientEnquiries(req: Request, res: Response): Promise<void> {
  const branchId = await resolveBranch(req);
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  const enquiries = await enquiryRepo.getClientEnquiries(branchId, limit);
  res.json(enquiries);
}

export async function deleteClientEnquiry(req: Request, res: Response): Promise<void> {
  await enquiryRepo.deleteClientEnquiry(req.params.id);
  res.json({ success: true });
}

const feedbackSchema = z.object({
  type: z.enum(['bug', 'general']).default('bug'),
  title: z.string().min(1, 'Title required').max(200),
  description: z.string().min(1, 'Description required').max(5000),
  stepsToReproduce: z.string().max(5000).optional().nullable(),
  branchId: z.string().optional().nullable(),
});

export async function submitFeedback(req: Request, res: Response): Promise<void> {
  const parsed = feedbackSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid feedback data', errors: parsed.error.flatten() });
    return;
  }
  const submittedByEmail = req.session?.userEmail ?? 'unknown';
  const record = await enquiryRepo.createFeedback({
    ...parsed.data,
    submittedByEmail,
    stepsToReproduce: parsed.data.stepsToReproduce ?? null,
    branchId: parsed.data.branchId ?? null,
  });
  logger.info('Feedback submitted', { id: record.id, type: parsed.data.type });
  res.status(201).json(record);
}

export async function listFeedback(_req: Request, res: Response): Promise<void> {
  const records = await enquiryRepo.listFeedback();
  res.json(records);
}
