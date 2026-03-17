
import type { Express, Request, Response } from 'express';
import { storage } from './storage';
import { hashPassword, verifyPassword, requireAuth, requireRole, auditLog } from './auth';
import { logger } from './logger';
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

  // ─── Bootstrap: Create first admin user (only if no users exist) ────────────

  app.post('/api/auth/bootstrap-admin', async (req: Request, res: Response) => {
    try {
      // Check if any users exist yet
      const allUsers = await storage.getAllUsers();
      if (allUsers.length > 0) {
        return res.status(403).json({ message: 'Users already exist. Use /api/auth/login' });
      }

      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid email or password format' });
      }

      const { email, password } = parsed.data;

      // Create admin user
      const hash = await hashPassword(password);
      const user = await storage.createUser({
        email,
        passwordHash: hash,
        displayName: 'System Administrator',
        role: 'admin',
        isActive: 1,
      } as any);

      logger.info(`Bootstrap admin user created: ${email}`);

      // Log in the new admin
      req.session.userId = user.id;
      req.session.userRole = user.role;

      return res.json({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        branches: [],
      });
    } catch (err) {
      logger.error('Failed to bootstrap admin:', err);
      return res.status(500).json({ message: 'Failed to create admin user' });
    }
  });

  // ─── Reset admin password (recovery endpoint) ────────────────────────────

  app.post('/api/auth/reset-admin-password', async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Invalid email or password format' });
    }

    const { email, password } = parsed.data;

    // Only allow resetting if email is admin@homeinstead.com
    if (email !== 'admin@homeinstead.com') {
      return res.status(403).json({ message: 'Only admin@homeinstead.com can be reset via this endpoint' });
    }

    try {
      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(404).json({ message: 'Admin user not found' });
      }

      const hash = await hashPassword(password);
      await storage.updateUser(user.id, { passwordHash: hash });

      logger.info(`Admin password reset for ${email}`);

      return res.json({ message: 'Admin password reset successfully' });
    } catch (err) {
      logger.error('Failed to reset admin password:', err);
      return res.status(500).json({ message: 'Failed to reset password' });
    }
  });

  // ─── Auth endpoints ─────────────────────────────────────────────────────────

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Invalid email or password format' });
    }

    const { email, password } = parsed.data;

    try {
      const user = await storage.getUserByEmail(email);
      if (!user || !user.isActive) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      req.session.userId = user.id;
      req.session.userRole = user.role;
      req.session.userEmail = user.email;
      req.session.displayName = user.displayName;

      await auditLog(user.id, user.email, null, 'LOGIN', `User logged in from ${req.ip}`);

      return res.json({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        branches: await storage.getUserBranches(user.id),
      });
    } catch (err) {
      logger.error('Login error', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.post('/api/auth/logout', requireAuth, async (req: Request, res: Response) => {
    const { userId, userEmail } = req.session;
    await auditLog(userId ?? null, userEmail ?? null, null, 'LOGOUT', 'User logged out');
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ message: 'Logged out' });
    });
  });

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

      const passwordHash = await hashPassword(password);
      const user = await storage.createUser({ email, passwordHash, displayName, role, isActive: 1 });

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
      if (newPassword) updates.passwordHash = await hashPassword(newPassword);

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
