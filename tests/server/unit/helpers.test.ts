/**
 * Unit tests for server-side helper utilities.
 * Pure functions — no DB connections, no network calls.
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

vi.mock('../../../server/storage', () => ({
  storage: {
    getBranchById: vi.fn().mockResolvedValue(null),
    getAllBranches: vi.fn().mockResolvedValue([]),
    createAuditLog: vi.fn().mockResolvedValue(undefined),
  },
}));

// ─── Imports ───────────────────────────────────────────────────────────────────

import {
  isUkBst,
  ukScheduleTimeToUtc,
  normalizeFileName,
  safeErrorMessage,
  isProduction,
} from '../../../server/utils/helpers';

// ─── isUkBst ──────────────────────────────────────────────────────────────────

describe('isUkBst', () => {
  it('returns true for a date in July (always BST)', () => {
    expect(isUkBst(new Date('2024-07-15T12:00:00Z'))).toBe(true);
  });

  it('returns false for a date in January (always GMT)', () => {
    expect(isUkBst(new Date('2024-01-15T12:00:00Z'))).toBe(false);
  });

  it('returns false for a date in December (always GMT)', () => {
    expect(isUkBst(new Date('2024-12-25T12:00:00Z'))).toBe(false);
  });

  it('returns false just before BST starts (last Sunday of March at 01:00 UTC)', () => {
    // 2024: last Sunday of March = March 31; BST starts at 01:00 UTC
    expect(isUkBst(new Date('2024-03-30T23:59:00Z'))).toBe(false);
  });

  it('returns true on the exact BST start moment', () => {
    // lastSundayOfMonth sets time to 01:00:00 UTC — boundary is inclusive (>=)
    expect(isUkBst(new Date('2024-03-31T01:00:00Z'))).toBe(true);
  });

  it('returns true just after BST starts', () => {
    expect(isUkBst(new Date('2024-03-31T01:30:00Z'))).toBe(true);
  });

  it('returns false just after BST ends (last Sunday of October)', () => {
    // 2024: last Sunday of October = October 27; BST ends at 01:00 UTC
    expect(isUkBst(new Date('2024-10-27T01:01:00Z'))).toBe(false);
  });

  it('returns true just before BST ends', () => {
    expect(isUkBst(new Date('2024-10-27T00:59:00Z'))).toBe(true);
  });
});

// ─── ukScheduleTimeToUtc ──────────────────────────────────────────────────────

describe('ukScheduleTimeToUtc', () => {
  it('does not adjust time in winter (GMT === UTC)', () => {
    // January: UK is GMT, so 09:00 UK = 09:00 UTC
    const result = ukScheduleTimeToUtc('2024-01-15', 9 * 60); // 540 minutes
    expect(result.toISOString()).toBe('2024-01-15T09:00:00.000Z');
  });

  it('subtracts 1 hour in summer (BST = UTC+1)', () => {
    // July: UK is BST (UTC+1), so 09:00 UK = 08:00 UTC
    const result = ukScheduleTimeToUtc('2024-07-15', 9 * 60);
    expect(result.toISOString()).toBe('2024-07-15T08:00:00.000Z');
  });

  it('handles midnight correctly in winter', () => {
    const result = ukScheduleTimeToUtc('2024-01-15', 0);
    expect(result.toISOString()).toBe('2024-01-15T00:00:00.000Z');
  });

  it('handles 30-minute increments correctly', () => {
    // 09:30 in winter → 09:30 UTC
    const result = ukScheduleTimeToUtc('2024-01-15', 9 * 60 + 30);
    expect(result.toISOString()).toBe('2024-01-15T09:30:00.000Z');
  });

  it('returns a Date object', () => {
    const result = ukScheduleTimeToUtc('2024-06-01', 480);
    expect(result).toBeInstanceOf(Date);
  });
});

// ─── normalizeFileName ────────────────────────────────────────────────────────

describe('normalizeFileName', () => {
  it('removes trailing duplicate counter like " (1)"', () => {
    expect(normalizeFileName('file (1).xlsx')).toBe('file.xlsx');
  });

  it('removes counter from middle of filename', () => {
    expect(normalizeFileName('report (2) final.xlsx')).toBe('report final.xlsx');
  });

  it('removes multiple counters', () => {
    expect(normalizeFileName('file (1) (2).xlsx')).toBe('file.xlsx');
  });

  it('does not modify a filename without counters', () => {
    expect(normalizeFileName('schedule-2024.xlsx')).toBe('schedule-2024.xlsx');
  });

  it('does not remove non-counter parentheses', () => {
    // "(abc)" has no digits so it is not matched by the regex
    expect(normalizeFileName('file (abc).xlsx')).toBe('file (abc).xlsx');
  });

  it('handles empty string', () => {
    expect(normalizeFileName('')).toBe('');
  });
});

// ─── safeErrorMessage ─────────────────────────────────────────────────────────

describe('safeErrorMessage', () => {
  it('returns Error.message in non-production (NODE_ENV=test)', () => {
    // isProduction = (NODE_ENV === 'production') → false in test env
    const err = new Error('detailed internal error');
    expect(safeErrorMessage(err, 'fallback')).toBe('detailed internal error');
  });

  it('returns fallback for non-Error values in non-production', () => {
    expect(safeErrorMessage('string error', 'fallback')).toBe('fallback');
    expect(safeErrorMessage(42, 'fallback')).toBe('fallback');
    expect(safeErrorMessage(null, 'fallback')).toBe('fallback');
  });

  it('isProduction flag is false in test environment', () => {
    // This verifies the test env is set correctly
    expect(isProduction).toBe(false);
  });
});
