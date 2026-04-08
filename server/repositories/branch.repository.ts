import { db } from '../db';
import { branches, branchUploads, branchSchedulingPreferences } from '@shared/schema';
import type {
  Branch, BranchUpload, InsertBranchUpload,
  BranchSchedulingPreference, InsertBranchSchedulingPreference,
} from '@shared/schema';
import { eq, and, desc } from 'drizzle-orm';

export async function getAllBranches(): Promise<Branch[]> {
  return db.select().from(branches);
}

export async function getBranchById(id: string): Promise<Branch | undefined> {
  const [branch] = await db.select().from(branches).where(eq(branches.id, id));
  return branch;
}

export async function getBranchByName(name: string): Promise<Branch | undefined> {
  const [branch] = await db.select().from(branches).where(eq(branches.name, name));
  return branch;
}

export async function saveBranchUpload(upload: InsertBranchUpload): Promise<BranchUpload> {
  const [result] = await db
    .insert(branchUploads)
    .values(upload)
    .onConflictDoUpdate({
      target: [branchUploads.branchId, branchUploads.uploadType],
      set: {
        fileBuffer: upload.fileBuffer,
        originalFileName: upload.originalFileName,
        fileSize: upload.fileSize,
        sha256: upload.sha256,
        uploadedAt: new Date(),
      },
    })
    .returning();
  return result;
}

export async function getLatestBranchUpload(branchId: string, uploadType: string): Promise<BranchUpload | undefined> {
  const [upload] = await db
    .select()
    .from(branchUploads)
    .where(and(eq(branchUploads.branchId, branchId), eq(branchUploads.uploadType, uploadType as any)))
    .orderBy(desc(branchUploads.uploadedAt));
  return upload;
}

export async function getBranchSchedulingPreference(branchId: string): Promise<BranchSchedulingPreference> {
  const [pref] = await db.select().from(branchSchedulingPreferences).where(eq(branchSchedulingPreferences.branchId, branchId));
  if (pref) return pref;
  const [newPref] = await db.insert(branchSchedulingPreferences).values({ branchId }).returning();
  return newPref;
}

export async function saveBranchSchedulingPreference(preference: InsertBranchSchedulingPreference): Promise<BranchSchedulingPreference> {
  const [result] = await db
    .insert(branchSchedulingPreferences)
    .values(preference)
    .onConflictDoUpdate({
      target: [branchSchedulingPreferences.branchId],
      set: {
        excludedServiceTypes: preference.excludedServiceTypes,
        updatedAt: new Date(),
      },
    })
    .returning();
  return result;
}
