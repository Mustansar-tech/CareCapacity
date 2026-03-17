import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { storage } from './storage';
import { logger } from './logger';
import type { UserRole } from '@shared/schema';

export const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  next();
}

export function requireRole(...roles: UserRole[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    if (!roles.includes(req.session.userRole as UserRole)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    next();
  };
}

export const roleHierarchy: Record<UserRole, number> = {
  admin: 4,
  manager: 3,
  supervisor: 2,
  viewer: 1,
};

export function hasRoleAtLeast(userRole: UserRole, requiredRole: UserRole): boolean {
  return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}

export function requireRoleAtLeast(role: UserRole) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    if (!hasRoleAtLeast(req.session.userRole as UserRole, role)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    next();
  };
}

export async function auditLog(
  userId: string | null,
  userEmail: string | null,
  branchId: string | null,
  action: string,
  detail?: string
) {
  try {
    await storage.createAuditLog({ userId, userEmail, branchId, action, detail: detail ?? null });
  } catch (err) {
    logger.warn('Failed to write audit log', { action, err });
  }
}

export async function seedAdminUser() {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    logger.warn('ADMIN_EMAIL and ADMIN_PASSWORD not set — skipping admin seed');
    return;
  }

  try {
    const existing = await storage.getUserByEmail(adminEmail);
    if (existing) {
      logger.info('Admin user already exists, skipping seed');
      return;
    }

    const passwordHash = await hashPassword(adminPassword);
    await storage.createUser({
      email: adminEmail,
      passwordHash,
      displayName: 'System Administrator',
      role: 'admin',
      isActive: 1,
    });

    logger.info(`Admin user seeded: ${adminEmail}`);
  } catch (err) {
    logger.error('Failed to seed admin user', err);
  }
}
