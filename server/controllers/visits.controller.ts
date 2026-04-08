import { Request, Response } from 'express';
import { resolveBranch } from '../utils/helpers';
import * as geoRepo from '../repositories/geo.repository';
import { getLatestGuaranteedBuffer } from '../routes/state';
import { logger } from '../logger';

export async function getVisitsByDate(req: Request, res: Response): Promise<void> {
  const { date } = req.params;
  const branchId = await resolveBranch(req);
  logger.debug('Extracting client visits from Guaranteed Hours Excel', { date, branchId });

  const guaranteedBuffer = await getLatestGuaranteedBuffer(branchId);
  if (!guaranteedBuffer) {
    res.status(404).json({
      error: 'No processed data available for this branch. Please upload the Excel files first to enable scheduling.',
    });
    return;
  }

  const { extractClientVisitsFromGHExcel } = await import('../excel-visit-extractor');
  const { storage } = await import('../storage');
  const parsedDate = new Date(date + 'T00:00:00.000Z');
  const visits = await extractClientVisitsFromGHExcel(guaranteedBuffer, parsedDate, branchId, storage);
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
