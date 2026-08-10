import type { Request } from 'express';
import { storage } from '../storage';
import { logger } from '../infrastructure/logger';
import { createAppError } from '../middleware/error-handler';
import { getUserBranches } from '../repositories/user.repository';

export const isProduction = process.env.NODE_ENV === 'production';

export function safeErrorMessage(error: unknown, fallback: string): string {
  if (!isProduction) {
    return error instanceof Error ? error.message : fallback;
  }
  return fallback;
}

export async function resolveBranch(req: Request): Promise<string> {
  const branchId = req.query.branchId as string || req.body?.branchId as string;
  const defaultBranchId = process.env.DEFAULT_BRANCH_ID;
  const resolvedBranchId = branchId || defaultBranchId;

  if (!resolvedBranchId) {
    throw createAppError('branchId is required', 400);
  }

  const branch = await storage.getBranchById(resolvedBranchId);
  if (!branch) {
    throw createAppError(`Branch with ID '${resolvedBranchId}' not found`, 404);
  }

  if (!branchId && defaultBranchId) {
    logger.warn(`Request using DEFAULT_BRANCH_ID fallback`, { defaultBranchId, path: req.path });
  }

  const userId = req.session?.userId;
  const userRole = req.session?.userRole;
  if (userId && userRole !== 'admin') {
    const assignedBranches = await getUserBranches(userId);
    const hasAccess = assignedBranches.some(b => b.id === resolvedBranchId);
    if (!hasAccess) {
      logger.warn('Branch access denied', { userId, resolvedBranchId, path: req.path });
      throw createAppError('You do not have access to this branch', 403);
    }
  }

  return resolvedBranchId;
}

/**
 * Resolves a set of branch IDs for cross-franchise views (e.g. the multi-branch
 * map). Accepts a comma-separated `branchIds` query param; when omitted, falls
 * back to every branch the user is allowed to see. Filters out any branch the
 * user does not have access to rather than erroring, since callers may pass a
 * broad "all franchises" selection.
 */
export async function resolveBranches(req: Request): Promise<string[]> {
  const raw = (req.query.branchIds as string || '').trim();
  const requested = raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];

  const userId = req.session?.userId;
  const userRole = req.session?.userRole;

  let allowedIds: string[] | null = null; // null = no restriction (admin or no session)
  if (userId && userRole !== 'admin') {
    const assignedBranches = await getUserBranches(userId);
    allowedIds = assignedBranches.map(b => b.id);
  }

  if (requested.length === 0) {
    if (allowedIds) return allowedIds;
    const allBranches = await storage.getAllBranches();
    return allBranches.map(b => b.id);
  }

  if (!allowedIds) return requested;

  const allowedSet = new Set(allowedIds);
  return requested.filter(id => allowedSet.has(id));
}

function lastSundayOfMonth(year: number, month: number): Date {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const daysToSubtract = lastDay.getUTCDay();
  const d = new Date(lastDay.getTime() - daysToSubtract * 86400000);
  d.setUTCHours(1, 0, 0, 0);
  return d;
}

export function isUkBst(utcDate: Date): boolean {
  const y = utcDate.getUTCFullYear();
  return utcDate >= lastSundayOfMonth(y, 2) && utcDate < lastSundayOfMonth(y, 9);
}

export function ukScheduleTimeToUtc(dateStr: string, minutesFromMidnight: number): Date {
  const hh = String(Math.floor(minutesFromMidnight / 60)).padStart(2, '0');
  const mm = String(minutesFromMidnight % 60).padStart(2, '0');
  const utcNaive = new Date(`${dateStr}T${hh}:${mm}:00Z`);
  if (isUkBst(utcNaive)) {
    return new Date(utcNaive.getTime() - 3600000);
  }
  return utcNaive;
}

export function normalizeFileName(fileName: string): string {
  return fileName.replace(/\s*\(\d+\)/g, '');
}
