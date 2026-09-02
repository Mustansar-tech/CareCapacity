import { db } from '../infrastructure/db';
import { clientEnquiries, feedback } from '@shared/schema';
import type {
  ClientEnquiry, InsertClientEnquiry,
  Feedback, InsertFeedback,
} from '@shared/schema';
import { eq, desc, and, notInArray } from 'drizzle-orm';

/** Rolling window size for saved client enquiry ("Search History") records, per branch. */
const MAX_ENQUIRIES_PER_BRANCH = 50;

export async function saveClientEnquiry(enquiry: InsertClientEnquiry): Promise<ClientEnquiry> {
  const [result] = await db.insert(clientEnquiries).values({
    ...enquiry,
    isMultiVisit: enquiry.isMultiVisit ? 1 : 0,
    visitDurationMinutes: enquiry.visitDurationMinutes ?? 60,
  }).returning();
  await pruneOldClientEnquiries(enquiry.branchId);
  return result;
}

/**
 * Keep only the MAX_ENQUIRIES_PER_BRANCH most recent (by createdAt) enquiries
 * for a branch, deleting anything older that has fallen off the rolling window.
 * Runs after every save so Search History always shows the latest records
 * without unbounded row growth.
 */
export async function pruneOldClientEnquiries(branchId: string): Promise<number> {
  const keepIds = await db.select({ id: clientEnquiries.id })
    .from(clientEnquiries)
    .where(eq(clientEnquiries.branchId, branchId))
    .orderBy(desc(clientEnquiries.createdAt))
    .limit(MAX_ENQUIRIES_PER_BRANCH);

  if (keepIds.length < MAX_ENQUIRIES_PER_BRANCH) return 0; // nothing to prune yet

  const result = await db.delete(clientEnquiries)
    .where(and(
      eq(clientEnquiries.branchId, branchId),
      notInArray(clientEnquiries.id, keepIds.map(r => r.id)),
    ))
    .returning({ id: clientEnquiries.id });
  return result.length;
}

export async function getClientEnquiries(branchId: string, limit = 50): Promise<ClientEnquiry[]> {
  return db.select().from(clientEnquiries)
    .where(eq(clientEnquiries.branchId, branchId))
    .orderBy(desc(clientEnquiries.createdAt))
    .limit(limit);
}

export async function deleteClientEnquiry(id: string, branchId?: string): Promise<boolean> {
  const result = await db.delete(clientEnquiries)
    .where(branchId
      ? and(eq(clientEnquiries.id, id), eq(clientEnquiries.branchId, branchId))
      : eq(clientEnquiries.id, id))
    .returning({ id: clientEnquiries.id });
  return result.length > 0;
}

export async function updateStarredSelections(id: string, starredSelections: unknown, branchId?: string): Promise<boolean> {
  const result = await db.update(clientEnquiries)
    .set({ starredSelections })
    .where(branchId
      ? and(eq(clientEnquiries.id, id), eq(clientEnquiries.branchId, branchId))
      : eq(clientEnquiries.id, id))
    .returning({ id: clientEnquiries.id });
  return result.length > 0;
}

export async function createFeedback(data: InsertFeedback): Promise<Feedback> {
  const [result] = await db.insert(feedback).values(data).returning();
  return result;
}

export async function listFeedback(limit = 200): Promise<Feedback[]> {
  return db.select().from(feedback).orderBy(desc(feedback.submittedAt)).limit(limit);
}
