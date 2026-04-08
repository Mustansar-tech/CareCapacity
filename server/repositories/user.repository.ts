import { db } from '../db';
import { users, branches, userBranches, auditLogs } from '@shared/schema';
import type {
  User, InsertUser, Branch, UserBranch,
  AuditLog, InsertAuditLog,
} from '@shared/schema';
import { eq, desc, inArray } from 'drizzle-orm';

export async function getUserById(id: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  return user;
}

export async function createUser(insertUser: InsertUser): Promise<User> {
  const [user] = await db.insert(users).values({
    email: insertUser.email,
    passwordHash: insertUser.passwordHash,
    displayName: insertUser.displayName,
    role: insertUser.role ?? 'viewer',
    isActive: insertUser.isActive ?? 1,
    username: insertUser.email,
  }).returning();
  return user;
}

export async function updateUser(id: string, updates: Partial<Omit<User, 'id' | 'createdAt'>>): Promise<User> {
  const [user] = await db.update(users).set(updates).where(eq(users.id, id)).returning();
  if (!user) throw new Error(`User ${id} not found`);
  return user;
}

export async function getAllUsers(): Promise<User[]> {
  return db.select().from(users).orderBy(users.email);
}

export async function getUserBranches(userId: string): Promise<Branch[]> {
  const assignments = await db.select().from(userBranches).where(eq(userBranches.userId, userId));
  if (assignments.length === 0) return [];
  const branchIds = assignments.map(a => a.branchId);
  return db.select().from(branches).where(inArray(branches.id, branchIds));
}

export async function assignUserToBranch(userId: string, branchId: string): Promise<UserBranch> {
  const [result] = await db.insert(userBranches).values({ userId, branchId })
    .onConflictDoNothing().returning();
  return result;
}

export async function setUserBranches(userId: string, branchIds: string[]): Promise<void> {
  await db.delete(userBranches).where(eq(userBranches.userId, userId));
  if (branchIds.length > 0) {
    await db.insert(userBranches).values(branchIds.map(branchId => ({ userId, branchId })));
  }
}

export async function createAuditLog(log: Omit<InsertAuditLog, 'timestamp'>): Promise<AuditLog> {
  const [result] = await db.insert(auditLogs).values(log).returning();
  return result;
}

export async function getAuditLogs(opts?: { branchId?: string; limit?: number }): Promise<AuditLog[]> {
  const limit = opts?.limit ?? 200;
  return db.select().from(auditLogs).orderBy(desc(auditLogs.timestamp)).limit(limit);
}
