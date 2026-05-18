/**
 * API security tests — verifies authentication and authorisation boundaries.
 *
 * Uses a minimal Express app built with the real auth middleware so tests
 * validate the actual enforcement code, not just stubs.
 * No real DB connections or external services are used.
 */
import { describe, it, expect, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

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
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
    },
  },
  supabaseAnon: {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ data: null, error: { message: 'invalid' } }),
    },
  },
}));

vi.mock('../../../server/storage', () => ({
  storage: {
    getUserById: vi.fn().mockResolvedValue(null),
    getUserByEmail: vi.fn().mockResolvedValue(null),
    getAllBranches: vi.fn().mockResolvedValue([{ id: 'b1', name: 'Test Branch' }]),
    getBranchById: vi.fn().mockResolvedValue({ id: 'b1', name: 'Test Branch' }),
    createAuditLog: vi.fn().mockResolvedValue(undefined),
    getAdminUsers: vi.fn().mockResolvedValue([]),
    getUserBranches: vi.fn().mockResolvedValue([]),
  },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { requireAuth, requireRoleAtLeast } from '../../../server/features/auth/auth';

// ─── Test app factory ─────────────────────────────────────────────────────────

/**
 * Builds a minimal Express app with the real auth middleware.
 * @param sessionData — when provided, injected as req.session to simulate an
 *   authenticated request. Omit for unauthenticated request tests.
 */
function buildTestApp(sessionData?: { userId: string; userRole: string }) {
  const app = express();
  app.use(express.json());

  // Inject a fake session if specified
  if (sessionData) {
    app.use((req: any, _res: Response, next: NextFunction) => {
      req.session = sessionData;
      next();
    });
  }

  // Public health endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', service: 'Care Capacity API' });
  });

  // Any authenticated user
  app.get('/api/data', requireAuth, (_req: Request, res: Response) => {
    res.json({ data: 'ok' });
  });

  // Admin-only endpoint (mirrors /api/admin/users)
  app.get(
    '/api/admin/users',
    requireAuth,
    requireRoleAtLeast('admin'),
    (_req: Request, res: Response) => res.json({ users: [] }),
  );

  // Admin-only trigger (mirrors /api/pp/trigger)
  app.post(
    '/api/pp/trigger',
    requireAuth,
    requireRoleAtLeast('admin'),
    (_req: Request, res: Response) => res.json({ sessionId: 'test' }),
  );

  // Scheduler-or-above endpoint
  app.post(
    '/api/process',
    requireAuth,
    requireRoleAtLeast('scheduler'),
    (_req: Request, res: Response) => res.json({ ok: true }),
  );

  return app;
}

// ─── Health endpoint ───────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('returns 200 without any authentication', async () => {
    const app = buildTestApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('also returns 200 when authenticated', async () => {
    const app = buildTestApp({ userId: 'u1', userRole: 'viewer' });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });
});

// ─── Unauthenticated access → 401 ────────────────────────────────────────────

describe('Protected routes return 401 when unauthenticated', () => {
  let app: ReturnType<typeof buildTestApp>;

  beforeEach(() => {
    app = buildTestApp(); // no session injected
  });

  it('GET /api/data → 401', async () => {
    const res = await request(app).get('/api/data');
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Authentication required');
  });

  it('GET /api/admin/users → 401', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });

  it('POST /api/pp/trigger → 401', async () => {
    const res = await request(app).post('/api/pp/trigger').send({});
    expect(res.status).toBe(401);
  });

  it('POST /api/process → 401', async () => {
    const res = await request(app).post('/api/process').send({});
    expect(res.status).toBe(401);
  });
});

// ─── Insufficient role → 403 ──────────────────────────────────────────────────

describe('Admin routes return 403 for non-admin roles', () => {
  it('viewer cannot access GET /api/admin/users', async () => {
    const app = buildTestApp({ userId: 'u1', userRole: 'viewer' });
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Insufficient permissions');
  });

  it('scheduler cannot access GET /api/admin/users', async () => {
    const app = buildTestApp({ userId: 'u1', userRole: 'scheduler' });
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(403);
  });

  it('viewer cannot POST /api/pp/trigger', async () => {
    const app = buildTestApp({ userId: 'u1', userRole: 'viewer' });
    const res = await request(app).post('/api/pp/trigger').send({});
    expect(res.status).toBe(403);
  });

  it('viewer cannot POST /api/process (scheduler-only)', async () => {
    const app = buildTestApp({ userId: 'u1', userRole: 'viewer' });
    const res = await request(app).post('/api/process').send({});
    expect(res.status).toBe(403);
  });
});

// ─── Correct role → 200 ───────────────────────────────────────────────────────

describe('Admin routes return 200 for admin role', () => {
  it('admin can access GET /api/admin/users', async () => {
    const app = buildTestApp({ userId: 'u1', userRole: 'admin' });
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(200);
  });

  it('admin can POST /api/pp/trigger', async () => {
    const app = buildTestApp({ userId: 'u1', userRole: 'admin' });
    const res = await request(app).post('/api/pp/trigger').send({});
    expect(res.status).toBe(200);
  });

  it('scheduler can POST /api/process', async () => {
    const app = buildTestApp({ userId: 'u1', userRole: 'scheduler' });
    const res = await request(app).post('/api/process').send({});
    expect(res.status).toBe(200);
  });
});
