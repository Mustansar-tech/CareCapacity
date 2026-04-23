import { db } from '../infrastructure/db';
import { clientEnquiries, feedback } from '@shared/schema';
import type {
  ClientEnquiry, InsertClientEnquiry,
  Feedback, InsertFeedback,
} from '@shared/schema';
import { eq, desc } from 'drizzle-orm';

export async function saveClientEnquiry(enquiry: InsertClientEnquiry): Promise<ClientEnquiry> {
  const [result] = await db.insert(clientEnquiries).values({
    ...enquiry,
    isMultiVisit: enquiry.isMultiVisit ? 1 : 0,
    visitDurationMinutes: enquiry.visitDurationMinutes ?? 60,
  }).returning();
  return result;
}

export async function getClientEnquiries(branchId: string, limit = 50): Promise<ClientEnquiry[]> {
  return db.select().from(clientEnquiries)
    .where(eq(clientEnquiries.branchId, branchId))
    .orderBy(desc(clientEnquiries.createdAt))
    .limit(limit);
}

export async function deleteClientEnquiry(id: string): Promise<void> {
  await db.delete(clientEnquiries).where(eq(clientEnquiries.id, id));
}

export async function updateStarredSelections(id: string, starredSelections: unknown): Promise<void> {
  await db.update(clientEnquiries)
    .set({ starredSelections })
    .where(eq(clientEnquiries.id, id));
}

export async function createFeedback(data: InsertFeedback): Promise<Feedback> {
  const [result] = await db.insert(feedback).values(data).returning();
  return result;
}

export async function listFeedback(limit = 200): Promise<Feedback[]> {
  return db.select().from(feedback).orderBy(desc(feedback.submittedAt)).limit(limit);
}
