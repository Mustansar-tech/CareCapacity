import { Request, Response, NextFunction } from 'express';
import { storage } from '../../storage';
import { logger } from '../../infrastructure/logger';
import { supabaseAdmin } from '../../infrastructure/supabase';
import type { UserRole } from '@shared/schema';

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
  admin: 3,
  scheduler: 2,
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
      await ensureSupabaseAuthUser(adminEmail, adminPassword, existing.id);
      return;
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });

    if (authError) throw authError;

    await storage.createUser({
      email: adminEmail,
      passwordHash: '',
      displayName: 'System Administrator',
      role: 'admin',
      isActive: 1,
    });

    logger.info(`Admin user seeded: ${adminEmail} (Supabase UID: ${authData.user.id})`);
  } catch (err) {
    logger.error('Failed to seed admin user', err);
  }
}

async function ensureSupabaseAuthUser(email: string, password: string, _localId: string) {
  try {
    const { data: list } = await supabaseAdmin.auth.admin.listUsers();
    const exists = list?.users?.some(u => u.email === email);
    if (!exists) {
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      logger.info(`Supabase auth user created for existing local user: ${email}`);
    }
  } catch (err) {
    logger.warn('Could not verify/create Supabase auth user for existing admin', { err });
  }
}
