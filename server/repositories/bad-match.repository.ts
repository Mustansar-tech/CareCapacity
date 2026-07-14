import { db } from '../infrastructure/db';
import { badMatches, type BadMatch, type InsertBadMatch } from '@shared/schema';
import { and, eq } from 'drizzle-orm';

export async function getBadMatches(branchId: string): Promise<BadMatch[]> {
  return db.select().from(badMatches).where(eq(badMatches.branchId, branchId));
}

export async function createBadMatch(data: InsertBadMatch): Promise<BadMatch> {
  const [result] = await db
    .insert(badMatches)
    .values(data)
    .onConflictDoNothing()
    .returning();
  if (!result) {
    // Already exists — return the existing row
    const [existing] = await db
      .select()
      .from(badMatches)
      .where(and(
        eq(badMatches.branchId, data.branchId),
        eq(badMatches.clientName, data.clientName),
        eq(badMatches.employeeName, data.employeeName),
      ));
    return existing;
  }
  return result;
}

export async function deleteBadMatch(branchId: string, id: string): Promise<boolean> {
  const result = await db
    .delete(badMatches)
    .where(and(eq(badMatches.id, id), eq(badMatches.branchId, branchId)))
    .returning();
  return result.length > 0;
}
