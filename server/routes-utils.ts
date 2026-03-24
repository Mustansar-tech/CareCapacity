import type { Request } from "express";
import multer from 'multer';
import { storage } from "./storage";
import { logger } from "./logger";

const isProduction = process.env.NODE_ENV === 'production';

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

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    logger.debug('File upload attempt', { fileName: file.originalname, mimeType: file.mimetype });
    if (
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.originalname.toLowerCase().endsWith('.xlsx') ||
      file.originalname.toLowerCase().endsWith('.xls')
    ) {
      logger.debug('File accepted', { fileName: file.originalname });
      cb(null, true);
    } else {
      logger.warn('File rejected', { fileName: file.originalname, mimeType: file.mimetype });
      cb(new Error(`Only Excel files are allowed. Got MIME type: ${file.mimetype}`));
    }
  },
});

export function normalizeFileName(fileName: string): string {
  return fileName.replace(/\s*\(\d+\)/g, '');
}

const guaranteedBufferByBranch: Map<string, Buffer> = new Map();

export function setLatestGuaranteedBuffer(branchId: string, buffer: Buffer): void {
  logger.debug('Storing GH buffer', { branchId, bytes: buffer.length });
  logger.debug('Branches in map before set', { branches: Array.from(guaranteedBufferByBranch.keys()) });
  guaranteedBufferByBranch.set(branchId, buffer);
  logger.debug('Branches in map after set', { branches: Array.from(guaranteedBufferByBranch.keys()) });
  logger.debug('GH buffer verification', { branchId, canRetrieve: guaranteedBufferByBranch.has(branchId) });
}

export async function getLatestGuaranteedBuffer(branchId: string): Promise<Buffer | null> {
  logger.debug('Retrieving GH buffer', { branchId });
  logger.debug('Available branches in map', { branches: Array.from(guaranteedBufferByBranch.keys()) });

  let buffer = guaranteedBufferByBranch.get(branchId) || null;

  if (!buffer) {
    logger.debug('GH buffer not in memory, checking database', { branchId });
    try {
      const upload = await storage.getLatestBranchUpload(branchId, 'guaranteedHours');
      if (upload) {
        buffer = Buffer.from(upload.fileBuffer, 'base64');
        guaranteedBufferByBranch.set(branchId, buffer);
        logger.debug('Retrieved GH buffer from database and cached', { branchId, bytes: buffer.length });
      }
    } catch (dbError) {
      logger.error('Failed to retrieve GH buffer from database', dbError);
    }
  }

  logger.debug('GH buffer retrieval result', { branchId, bytes: buffer ? buffer.length : 0, found: !!buffer });
  return buffer;
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
