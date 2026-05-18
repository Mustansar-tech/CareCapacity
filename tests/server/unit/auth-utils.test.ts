/**
 * Unit tests for auth utility functions and middleware.
 * All DB / Supabase calls are mocked — no real connections made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Module mocks (hoisted before imports) ────────────────────────────────────

vi.mock('../../../server/infrastructure/db', () => ({
  pool: { query: vi.fn(), end: vi.fn() },
  db: { execute: vi.fn() },
  checkDatabaseHealth: vi.fn().mockResolvedValue(true),
  withRetry: vi.fn().mockImplementation((fn: () => unknown) => fn()),
}));

vi.mock('../../../server/infrastructure/supabase', () => ({
  supabaseAdmin: {
    auth: {
      admin: { updateUserById: vi.fn() },
      getUser: vi.fn(),
      resetPasswordForEmail: vi.fn(),
    },
  },
  supabaseAnon: {
    auth: { signInWithPassword: vi.fn() },
  },
}));

vi.mock('../../../server/storage', () => ({
  storage: {
    getUserById: vi.fn().mockResolvedValue(null),
    createAuditLog: vi.fn().mockResolvedValue(undefined),
    getAllBranches: vi.fn().mockResolvedValue([]),
    getBranchById: vi.fn().mockResolvedValue(null),
  },
}));

// ─── Imports (resolved after mocks are in place) ──────────────────────────────

import {
  hasRoleAtLeast,
  roleHierarchy,
  requireAuth,
  requireRoleAtLeast,
} from '../../../server/features/auth/auth';

// ─── roleHierarchy ────────────────────────────────────────────────────────────

describe('roleHierarchy', () => {
  it('admin has the highest rank', () => {
    expect(roleHierarchy.admin).toBeGreaterThan(roleHierarchy.scheduler);
    expect(roleHierarchy.admin).toBeGreaterThan(roleHierarchy.viewer);
  });

  it('scheduler ranks above viewer', () => {
    expect(roleHierarchy.scheduler).toBeGreaterThan(roleHierarchy.viewer);
  });

  it('all three roles are defined with positive values', () => {
    expect(roleHierarchy.admin).toBeGreaterThan(0);
    expect(roleHierarchy.scheduler).toBeGreaterThan(0);
    expect(roleHierarchy.viewer).toBeGreaterThan(0);
  });
});

// ─── hasRoleAtLeast ───────────────────────────────────────────────────────────

describe('hasRoleAtLeast', () => {
  it('admin satisfies all role requirements', () => {
    expect(hasRoleAtLeast('admin', 'admin')).toBe(true);
    expect(hasRoleAtLeast('admin', 'scheduler')).toBe(true);
    expect(hasRoleAtLeast('admin', 'viewer')).toBe(true);
  });

  it('scheduler satisfies scheduler and viewer but not admin', () => {
    expect(hasRoleAtLeast('scheduler', 'scheduler')).toBe(true);
    expect(hasRoleAtLeast('scheduler', 'viewer')).toBe(true);
    expect(hasRoleAtLeast('scheduler', 'admin')).toBe(false);
  });

  it('viewer only satisfies viewer', () => {
    expect(hasRoleAtLeast('viewer', 'viewer')).toBe(true);
    expect(hasRoleAtLeast('viewer', 'scheduler')).toBe(false);
    expect(hasRoleAtLeast('viewer', 'admin')).toBe(false);
  });

  it('same-role comparison always returns true', () => {
    expect(hasRoleAtLeast('admin', 'admin')).toBe(true);
    expect(hasRoleAtLeast('scheduler', 'scheduler')).toBe(true);
    expect(hasRoleAtLeast('viewer', 'viewer')).toBe(true);
  });
});

// ─── requireAuth middleware ───────────────────────────────────────────────────

describe('requireAuth middleware', () => {
  it('calls next() when session contains userId', () => {
    const req = { session: { userId: 'user-1' } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 when session is undefined', () => {
    const req = { session: undefined } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Authentication required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when session exists but has no userId', () => {
    const req = { session: {} } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when userId is an empty string', () => {
    const req = { session: { userId: '' } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ─── requireRoleAtLeast middleware ────────────────────────────────────────────

describe('requireRoleAtLeast middleware', () => {
  it('calls next() when user role meets the requirement', async () => {
    const middleware = requireRoleAtLeast('scheduler');
    const req = { session: { userId: 'u1', userRole: 'admin' } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next() when user role exactly matches requirement', async () => {
    const middleware = requireRoleAtLeast('scheduler');
    const req = { session: { userId: 'u1', userRole: 'scheduler' } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 403 when role is below requirement', async () => {
    const middleware = requireRoleAtLeast('admin');
    const req = { session: { userId: 'u1', userRole: 'viewer' } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Insufficient permissions' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when scheduler tries to access admin route', async () => {
    const middleware = requireRoleAtLeast('admin');
    const req = { session: { userId: 'u1', userRole: 'scheduler' } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const middleware = requireRoleAtLeast('viewer');
    const req = { session: undefined } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
