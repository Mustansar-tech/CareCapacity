import { Request, Response } from 'express';
import { resolveBranch } from '../utils/helpers';
import * as geoRepo from '../repositories/geo.repository';
import { getLatestGuaranteedBuffer, getGuaranteedBufferVersion } from '../routes/state';
import { logger } from '../infrastructure/logger';
import type { ExcelClientVisit } from '../features/imports/excel-visit-extractor';

// ---------------------------------------------------------------------------
// In-memory visits parse cache — keyed by branchId:version (ALL dates)
// ---------------------------------------------------------------------------
// Parsing the ~5 MB Excel file takes ~10 s.  When the Daily View loads it
// fires 7 simultaneous requests (one per day).  Without coalescing this meant
// 7 concurrent parses — all equally slow.
//
// Strategy:
//   1. Parse once per (branchId, bufferVersion) → store ALL visits.
//   2. Concurrent requests for the same buffer share ONE Promise (coalescing).
//   3. Per-date filtering is done in memory after the parse completes.
//   4. Cache is invalidated automatically when a new GH buffer is uploaded
//      (setLatestGuaranteedBuffer bumps the version counter).
// ---------------------------------------------------------------------------

interface AllVisitsCacheEntry {
  visits: ExcelClientVisit[];
  createdAt: number;
}

const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Cached parse results: `${branchId}:${version}` → all visits (all dates) */
const allVisitsCache = new Map<string, AllVisitsCacheEntry>();

/** In-flight parse promises — deduplicates concurrent requests */
const parsePromises = new Map<string, Promise<ExcelClientVisit[]>>();

function allVisitesCacheKey(branchId: string, version: number): string {
  return `${branchId}:${version}`;
}

function evictStaleEntries(): void {
  const now = Date.now();
  for (const [key, entry] of allVisitsCache.entries()) {
    if (now - entry.createdAt > CACHE_TTL_MS) allVisitsCache.delete(key);
  }
}

/**
 * Returns ALL visits for the branch's current GH buffer.
 * Concurrent callers share a single parse promise so the Excel file is
 * read at most once per (branchId, bufferVersion).
 */
async function getAllVisitsForBranch(
  branchId: string,
  version: number,
  buffer: Buffer,
): Promise<ExcelClientVisit[]> {
  const key = allVisitesCacheKey(branchId, version);

  // 1. Result cache hit
  const cached = allVisitsCache.get(key);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    logger.debug('all-visits cache hit', { key, count: cached.visits.length });
    return cached.visits;
  }

  // 2. In-flight deduplication: share the existing promise
  const inFlight = parsePromises.get(key);
  if (inFlight) {
    logger.debug('all-visits parse in-flight — awaiting shared promise', { key });
    return inFlight;
  }

  // 3. Start a new parse
  logger.debug('all-visits cache miss — starting Excel parse', { key });
  const { extractClientVisitsFromGHExcel } = await import('../features/imports/excel-visit-extractor');
  const { storage } = await import('../storage');

  const promise = extractClientVisitsFromGHExcel(buffer, null, branchId, storage)
    .then(visits => {
      evictStaleEntries();
      allVisitsCache.set(key, { visits, createdAt: Date.now() });
      parsePromises.delete(key);
      logger.debug('all-visits parse complete and cached', { key, count: visits.length });
      return visits;
    })
    .catch(err => {
      parsePromises.delete(key);
      throw err;
    });

  parsePromises.set(key, promise);
  return promise;
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
  const allVisits = await getAllVisitsForBranch(branchId, version, guaranteedBuffer);
  const visits = allVisits.filter(v => v.date === date);

  logger.debug('visits filtered by date', { date, total: allVisits.length, filtered: visits.length });
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
