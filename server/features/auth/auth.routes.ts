import type { Express, Request, Response } from 'express';
import { storage } from '../../storage';
import { requireAuth, requireRole, auditLog } from './auth';
import { supabaseAdmin, supabaseAnon } from '../../infrastructure/supabase';
import { logger } from '../../infrastructure/logger';
import { z } from 'zod';
import { userRoles } from '@shared/schema';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().min(1),
  role: z.enum(userRoles),
  branchIds: z.array(z.string()).min(1, 'Assign at least one branch'),
});

const updateUserSchema = z.object({
  displayName: z.string().min(1).optional(),
  role: z.enum(userRoles).optional(),
  isActive: z.number().optional(),
  branchIds: z.array(z.string()).optional(),
  newPassword: z.string().min(8).optional(),
});

export function registerAuthRoutes(app: Express) {

  // ─── Login via Supabase Auth ─────────────────────────────────────────────────

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Invalid email or password format' });
    }

    const { email, password } = parsed.data;

    try {
      // Verify credentials with Supabase (anon client required for signInWithPassword)
      const { data: authData, error: authError } = await supabaseAnon.auth.signInWithPassword({
        email,
        password,
      });

      if (authError || !authData.user) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      // Load local user profile (role, branches, active status)
      const user = await storage.getUserByEmail(email);
      if (!user || !user.isActive) {
        return res.status(401).json({ message: 'Account is inactive. Contact your administrator.' });
      }

      req.session.userId = user.id;
      req.session.userRole = user.role;
      req.session.userEmail = user.email;
      req.session.displayName = user.displayName;
      req.session.touch();

      return new Promise((resolve) => {
        req.session.save(async (err) => {
          if (err) {
            logger.error('Session save error', err);
            res.status(500).json({ message: 'Failed to establish session' });
            return resolve(undefined);
          }

          await auditLog(user.id, user.email, null, 'LOGIN', `User logged in from ${req.ip}`);

          const branches = await storage.getUserBranches(user.id);
          res.json({
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            role: user.role,
            branches,
          });
          resolve(undefined);
        });
      });
    } catch (err) {
      logger.error('Login error', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });

  // ─── Logout ──────────────────────────────────────────────────────────────────

  app.post('/api/auth/logout', requireAuth, async (req: Request, res: Response) => {
    const { userId, userEmail } = req.session;
    await auditLog(userId ?? null, userEmail ?? null, null, 'LOGOUT', 'User logged out');
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ message: 'Logged out' });
    });
  });

  // ─── Current user ────────────────────────────────────────────────────────────

  app.get('/api/auth/me', async (req: Request, res: Response) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: 'Not authenticated' });
    }
    try {
      const user = await storage.getUserById(req.session.userId);
      if (!user || !user.isActive) {
        req.session.destroy(() => {});
        return res.status(401).json({ message: 'Session expired' });
      }
      const branches = await storage.getUserBranches(user.id);
      return res.json({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        branches,
      });
    } catch (err) {
      logger.error('/api/auth/me error', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });

  // ─── User management (Admin only) ───────────────────────────────────────────

  app.get('/api/admin/users', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const users = await storage.getAllUsers();
      const result = await Promise.all(users.map(async (u) => ({
        ...u,
        passwordHash: undefined,
        branches: await storage.getUserBranches(u.id),
      })));
      return res.json(result);
    } catch (err) {
      logger.error('List users error', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.post('/api/admin/users', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }

    const { email, password, displayName, role, branchIds } = parsed.data;

    try {
      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(409).json({ message: 'A user with this email already exists' });
      }

      // Create in Supabase Auth first
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (authError) {
        logger.error('Supabase create user error', authError);
        return res.status(500).json({ message: authError.message || 'Failed to create auth user' });
      }

      // Create local profile record
      const user = await storage.createUser({ email, passwordHash: '', displayName, role, isActive: 1 });

      for (const branchId of branchIds) {
        await storage.assignUserToBranch(user.id, branchId);
      }

      await auditLog(
        req.session.userId ?? null,
        req.session.userEmail ?? null,
        null,
        'USER_CREATED',
        `Created user ${email} with role ${role}`
      );

      return res.status(201).json({ ...user, passwordHash: undefined, branches: await storage.getUserBranches(user.id) });
    } catch (err) {
      logger.error('Create user error', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.patch('/api/admin/users/:userId', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }

    const { userId } = req.params;
    const { displayName, role, isActive, branchIds, newPassword } = parsed.data;

    try {
      if (userId === req.session.userId && isActive === 0) {
        return res.status(400).json({ message: 'You cannot deactivate your own account' });
      }

      const updates: Record<string, any> = {};
      if (displayName !== undefined) updates.displayName = displayName;
      if (role !== undefined) updates.role = role;
      if (isActive !== undefined) updates.isActive = isActive;

      // If password is being reset, update in Supabase
      if (newPassword) {
        const targetUser = await storage.getUserById(userId);
        if (targetUser) {
          const { data: list } = await supabaseAdmin.auth.admin.listUsers();
          const supaUser = list?.users?.find(u => u.email === targetUser.email);
          if (supaUser) {
            const { error } = await supabaseAdmin.auth.admin.updateUserById(supaUser.id, {
              password: newPassword,
            });
            if (error) {
              logger.error('Supabase password update error', error);
              return res.status(500).json({ message: 'Failed to update password' });
            }
          }
        }
      }

      const user = await storage.updateUser(userId, updates);

      if (branchIds !== undefined) {
        await storage.setUserBranches(userId, branchIds);
      }

      await auditLog(
        req.session.userId ?? null,
        req.session.userEmail ?? null,
        null,
        'USER_UPDATED',
        `Updated user ${user.email}: ${Object.keys(updates).join(', ')}`
      );

      return res.json({ ...user, passwordHash: undefined, branches: await storage.getUserBranches(user.id) });
    } catch (err) {
      logger.error('Update user error', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });

  // ─── Audit log (Admin only) ─────────────────────────────────────────────────

  app.get('/api/admin/audit-logs', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const branchId = req.query.branchId as string | undefined;
      const limit = parseInt(req.query.limit as string || '200', 10);
      const logs = await storage.getAuditLogs({ branchId, limit });
      return res.json(logs);
    } catch (err) {
      logger.error('Audit log error', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });
}
