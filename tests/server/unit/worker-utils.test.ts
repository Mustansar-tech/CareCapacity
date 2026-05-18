/**
 * Unit tests for the worker date/week utilities.
 * Heavy dependencies (Playwright automation, node-cron) are mocked.
 */
import { describe, it, expect, vi } from 'vitest';

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../server/infrastructure/db', () => ({
  pool: { query: vi.fn(), end: vi.fn() },
  db: { execute: vi.fn() },
  checkDatabaseHealth: vi.fn().mockResolvedValue(true),
  withRetry: vi.fn().mockImplementation((fn: () => unknown) => fn()),
}));

vi.mock('../../../server/infrastructure/supabase', () => ({
  supabaseAdmin: { auth: { admin: {} } },
  supabaseAnon: { auth: {} },
}));

vi.mock('../../../server/features/people-planner/automation-engine', () => ({
  prewarmAllSlots: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../server/features/people-planner/automation-routes', () => ({
  programmaticQueueSync: vi.fn().mockResolvedValue({
    sessionId: 'test-session',
    queued: true,
    queuePosition: 0,
  }),
  getConfiguredBranchIds: vi.fn().mockReturnValue([]),
}));

vi.mock('node-cron', () => ({
  default: { schedule: vi.fn() },
  schedule: vi.fn(),
}));

// ─── Import ────────────────────────────────────────────────────────────────────

import { getMondayWithOffset } from '../../../server/worker';

// ─── getMondayWithOffset ──────────────────────────────────────────────────────

describe('getMondayWithOffset', () => {
  it('returns the Monday of the current week (offset 0) for a Wednesday', () => {
    // Wednesday 17 Jan 2024 → Monday 15 Jan 2024
    const wednesday = new Date('2024-01-17T12:00:00Z');
    expect(getMondayWithOffset(wednesday, 0)).toBe('2024-01-15');
  });

  it('returns the same Monday when called on a Monday (offset 0)', () => {
    const monday = new Date('2024-01-15T12:00:00Z');
    expect(getMondayWithOffset(monday, 0)).toBe('2024-01-15');
  });

  it('treats Sunday as part of the previous week (offset 0)', () => {
    // Sunday 21 Jan 2024 → Monday 15 Jan 2024 (algorithm: diffToMonday = -6)
    const sunday = new Date('2024-01-21T12:00:00Z');
    expect(getMondayWithOffset(sunday, 0)).toBe('2024-01-15');
  });

  it('returns previous week Monday (offset -7)', () => {
    const wednesday = new Date('2024-01-17T12:00:00Z');
    expect(getMondayWithOffset(wednesday, -7)).toBe('2024-01-08');
  });

  it('returns next week Monday (offset +7)', () => {
    const wednesday = new Date('2024-01-17T12:00:00Z');
    expect(getMondayWithOffset(wednesday, 7)).toBe('2024-01-22');
  });

  it('handles week boundary crossing a month', () => {
    // Friday 2 Feb 2024 → Monday 29 Jan 2024
    const friday = new Date('2024-02-02T12:00:00Z');
    expect(getMondayWithOffset(friday, 0)).toBe('2024-01-29');
  });

  it('handles week boundary crossing a year', () => {
    // Wednesday 3 Jan 2024 → Monday 1 Jan 2024
    const wednesday = new Date('2024-01-03T12:00:00Z');
    expect(getMondayWithOffset(wednesday, 0)).toBe('2024-01-01');
  });

  it('result is always in YYYY-MM-DD format', () => {
    const date = new Date('2024-06-15T12:00:00Z');
    const result = getMondayWithOffset(date, 0);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
