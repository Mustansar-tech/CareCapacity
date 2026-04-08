import type { Express } from 'express';
import { storage } from '../storage';
import { logger } from '../logger';
import { safeErrorMessage, resolveBranch } from '../utils/helpers';

export function registerHistoryRoutes(app: Express): void {
  app.get('/api/history', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const analyses = await storage.getLatestWeeksAnalyses(branchId, 8);
      res.json(analyses);
    } catch (error) {
      logger.error('History fetch error', error);
      const message = safeErrorMessage(error, 'Failed to fetch historical data');
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message });
    }
  });

  app.get('/api/history/latest', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const analysis = await storage.getLatestCapacityAnalysis(branchId);
      if (!analysis) {
        return res.status(404).json({ message: 'No historical data found' });
      }
      res.json(analysis);
    } catch (error) {
      logger.error('Latest history fetch error', error);
      const message = safeErrorMessage(error, 'Failed to fetch latest data');
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message });
    }
  });

  app.get('/api/history/range/:startDate/:endDate', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const { startDate, endDate } = req.params;

      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
        return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
      }

      const analyses = await storage.getCapacityAnalysesByDateRange(branchId, startDate, endDate);
      res.json(analyses);
    } catch (error) {
      logger.error('Date range fetch error', error);
      const message = safeErrorMessage(error, 'Failed to fetch data for date range');
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message });
    }
  });

  app.post('/api/cleanup', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const { months = 6 } = req.body;

      if (typeof months !== 'number' || months < 1 || months > 60) {
        return res.status(400).json({ message: 'Months parameter must be between 1 and 60' });
      }

      const deletedCount = await storage.cleanupOldAnalyses(branchId, months);
      res.json({
        message: 'Successfully cleaned up old data',
        deletedAnalyses: deletedCount,
        cutoffMonths: months,
      });
    } catch (error) {
      logger.error('Cleanup error', error);
      const message = safeErrorMessage(error, 'Failed to cleanup old data');
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message });
    }
  });

  app.get('/api/cleanup/preview/:months', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const months = parseInt(req.params.months);

      if (isNaN(months) || months < 1 || months > 60) {
        return res.status(400).json({ message: 'Months parameter must be between 1 and 60' });
      }

      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - months);
      const cutoffString = cutoffDate.toISOString().split('T')[0];

      const allAnalyses = await storage.getLatestWeeksAnalyses(branchId, 12);
      const oldAnalyses = allAnalyses.filter(
        analysis => new Date(analysis.uploadedAt).toISOString().split('T')[0] < cutoffString
      );

      res.json({
        cutoffDate: cutoffString,
        monthsOld: months,
        totalAnalyses: allAnalyses.length,
        analysesToDelete: oldAnalyses.length,
        analysesToKeep: allAnalyses.length - oldAnalyses.length,
        oldestAnalysis: allAnalyses.length > 0 ? allAnalyses[allAnalyses.length - 1]?.uploadedAt : null,
        newestAnalysis: allAnalyses.length > 0 ? allAnalyses[0]?.uploadedAt : null,
      });
    } catch (error) {
      logger.error('Cleanup preview error', error);
      const message = safeErrorMessage(error, 'Failed to preview cleanup');
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message });
    }
  });

  app.post('/api/cleanup/routes-visits', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      logger.info('Starting cleanup of routes and visits data', { branchId });

      const result = await storage.clearRoutesAndVisits(branchId);

      logger.info('Cleanup complete', {
        routePlansDeleted: result.routePlansDeleted,
        routeStopsDeleted: result.routeStopsDeleted,
        visitsDeleted: result.visitsDeleted,
      });

      res.json({ message: 'Routes and visits data cleaned successfully', deletedCounts: result });
    } catch (error) {
      logger.error('Cleanup error', error);
      const message = safeErrorMessage(error, 'Failed to cleanup routes and visits data');
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message, details: safeErrorMessage(error, 'An error occurred') });
    }
  });
}
