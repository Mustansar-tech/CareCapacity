import { Request, Response } from 'express';
import { resolveBranch } from '../utils/helpers';
import * as geoRepo from '../repositories/geo.repository';
import { getLatestGuaranteedBuffer, getGuaranteedBufferVersion } from '../routes/state';
import { logger } from '../logger';
import type { ExcelClientVisit } from '../excel-visit-extractor';

// ---------------------------------------------------------------------------
// In-memory visits parse cache
// ---------------------------------------------------------------------------
// Key: `${branchId}:${date}:${bufferVersion}`
// Avoids re-reading and re-parsing the ~5 MB Excel file on every request.
// The cache entry is invalidated automatically when a new file is uploaded
// (setLatestGuaranteedBuffer bumps the version counter).
// ---------------------------------------------------------------------------
interface VisitsCacheEntry {
  visits: ExcelClientVisit[];
  createdAt: number; // ms timestamp — for optional TTL eviction
}

const visitsCache = new Map<string, VisitsCacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour safety TTL

function makeCacheKey(branchId: string, date: string, version: number): string {
  return `${branchId}:${date}:${version}`;
}

/** Evict cache entries older than CACHE_TTL_MS */
function evictStaleEntries(): void {
  const now = Date.now();
  for (const [key, entry] of visitsCache.entries()) {
    if (now - entry.createdAt > CACHE_TTL_MS) {
      visitsCache.delete(key);
    }
  }
}

export async function getVisitsByDate(req: Request, res: Response): Promise<void> {
  const { date } = req.params;
  const branchId = await resolveBranch(req);
  logger.debug('getVisitsByDate', { date, branchId });

  const guaranteedBuffer = await getLatestGuaranteedBuffer(branchId);
  if (!guaranteedBuffer) {
    res.status(404).json({
      error: 'No processed data available for this branch. Please upload the Excel files first to enable scheduling.',
    });
    return;
  }

  const version = getGuaranteedBufferVersion(branchId);
  const cacheKey = makeCacheKey(branchId, date, version);

  const cached = visitsCache.get(cacheKey);
  if (cached) {
    logger.debug('visits cache hit', { cacheKey, count: cached.visits.length });
    res.json(cached.visits);
    return;
  }

  logger.debug('visits cache miss — parsing Excel', { cacheKey });
  const { extractClientVisitsFromGHExcel } = await import('../excel-visit-extractor');
  const { storage } = await import('../storage');
  const parsedDate = new Date(date + 'T00:00:00.000Z');
  const visits = await extractClientVisitsFromGHExcel(guaranteedBuffer, parsedDate, branchId, storage);

  // Store in cache
  evictStaleEntries();
  visitsCache.set(cacheKey, { visits, createdAt: Date.now() });
  logger.debug('visits cached', { cacheKey, count: visits.length });

  res.json(visits);
}

export async function listVisitsBetween(req: Request, res: Response): Promise<void> {
  const { startDate, endDate } = req.query;
  const branchId = await resolveBranch(req);

  if (!startDate || !endDate) {
    res.status(400).json({ message: 'Start date and end date are required' });
    return;
  }

  logger.debug('Fetching visits', { branchId, startDate, endDate });
  const visits = await geoRepo.listVisitsBetween(branchId, String(startDate), String(endDate));
  logger.debug('Found visits for date range', { count: visits.length });
  res.json(visits);
}
