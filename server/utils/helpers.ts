import type { Request } from 'express';
import { storage } from '../storage';
import { logger } from '../logger';

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
    throw new Error('branchId is required');
  }

  const branch = await storage.getBranchById(resolvedBranchId);
  if (!branch) {
    throw new Error(`Branch with ID '${resolvedBranchId}' not found`);
  }

  if (!branchId && defaultBranchId) {
    logger.warn(`Request using DEFAULT_BRANCH_ID fallback`, { defaultBranchId, path: req.path });
  }

  return resolvedBranchId;
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
