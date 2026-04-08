import type { Express } from 'express';
import { storage } from '../storage';
import { logger } from '../logger';
import { resolveBranch } from '../utils/helpers';
import { getLatestGuaranteedBuffer } from './state';

export function registerVisitsRoutes(app: Express): void {
  app.get('/api/visits/:date', async (req, res) => {
    try {
      const { date } = req.params;
      const branchId = await resolveBranch(req);
      logger.debug('Extracting client visits from Guaranteed Hours Excel', { date, branchId });

      const guaranteedBuffer = await getLatestGuaranteedBuffer(branchId);
      if (!guaranteedBuffer) {
        return res.status(404).json({
          error: 'No processed data available for this branch. Please upload the Excel files first to enable scheduling.',
        });
      }

      const { extractClientVisitsFromGHExcel } = await import('../excel-visit-extractor');
      const parsedDate = new Date(date + 'T00:00:00.000Z');
      const visits = await extractClientVisitsFromGHExcel(guaranteedBuffer, parsedDate, branchId, storage);
      res.json(visits);
    } catch (error) {
      logger.error('Error extracting visits', error);
      res.status(500).json({ error: 'Failed to extract visits' });
    }
  });

  app.get('/api/visits', async (req, res) => {
    const { startDate, endDate } = req.query;
    const branchId = await resolveBranch(req);

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Start date and end date are required' });
    }

    if (!branchId) {
      return res.status(400).json({ message: 'Branch selection is required' });
    }

    try {
      logger.debug('Fetching visits', { branchId, startDate, endDate });
      const visits = await storage.listVisitsBetween(branchId, String(startDate), String(endDate));
      logger.debug('Found visits for date range', { count: visits.length });
      res.json(visits);
    } catch (error) {
      logger.error('Error fetching visits', error);
      res.status(500).json({ message: 'Failed to fetch visits' });
    }
  });
}
