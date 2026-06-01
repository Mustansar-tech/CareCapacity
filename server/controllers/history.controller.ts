import { Request, Response } from 'express';
import * as capacityRepo from '../repositories/capacity.repository';
import { resolveBranch, safeErrorMessage } from '../utils/helpers';
import { logger } from '../infrastructure/logger';

function branchErrorStatus(message: string): number {
  return message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
}

export async function getHistory(req: Request, res: Response): Promise<void> {
  const branchId = await resolveBranch(req);
  const headers = await capacityRepo.getCapacityAnalysisHeaders(branchId, 17);
  res.json(headers);
}

export async function getHistoryById(req: Request, res: Response): Promise<void> {
  const branchId = await resolveBranch(req);
  const { id } = req.params;
  if (!id) { res.status(400).json({ message: 'id is required' }); return; }
  const analysis = await capacityRepo.getCapacityAnalysisById(id, branchId);
  if (!analysis) { res.status(404).json({ message: 'Analysis not found' }); return; }
  res.json(analysis);
}

export async function getLatestHistory(req: Request, res: Response): Promise<void> {
  const branchId = await resolveBranch(req);
  const analysis = await capacityRepo.getLatestCapacityAnalysis(branchId);
  if (!analysis) {
    res.status(404).json({ message: 'No historical data found' });
    return;
  }
  res.json(analysis);
}

export async function getHistoryByDateRange(req: Request, res: Response): Promise<void> {
  const branchId = await resolveBranch(req);
  const { startDate, endDate } = req.params;
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
    res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
    return;
  }
  const analyses = await capacityRepo.getCapacityAnalysesByDateRange(branchId, startDate, endDate);
  res.json(analyses);
}

export async function cleanupOldData(req: Request, res: Response): Promise<void> {
  const branchId = await resolveBranch(req);
  const { months = 6 } = req.body;
  if (typeof months !== 'number' || months < 1 || months > 60) {
    res.status(400).json({ message: 'Months parameter must be between 1 and 60' });
    return;
  }
  const deletedCount = await capacityRepo.cleanupOldAnalyses(branchId, months);
  res.json({ message: 'Successfully cleaned up old data', deletedAnalyses: deletedCount, cutoffMonths: months });
}

export async function previewCleanup(req: Request, res: Response): Promise<void> {
  const branchId = await resolveBranch(req);
  const months = parseInt(req.params.months);
  if (isNaN(months) || months < 1 || months > 60) {
    res.status(400).json({ message: 'Months parameter must be between 1 and 60' });
    return;
  }
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - months);
  const cutoffString = cutoffDate.toISOString().split('T')[0];
  const allAnalyses = await capacityRepo.getLatestWeeksAnalyses(branchId, 12);
  const oldAnalyses = allAnalyses.filter(
    a => new Date(a.uploadedAt).toISOString().split('T')[0] < cutoffString,
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
}

export async function cleanupRoutesAndVisits(req: Request, res: Response): Promise<void> {
  const { storage } = await import('../storage');
  const branchId = await resolveBranch(req);
  logger.info('Starting cleanup of routes and visits data', { branchId });
  const result = await storage.clearRoutesAndVisits(branchId);
  logger.info('Cleanup complete', result);
  res.json({ message: 'Routes and visits data cleaned successfully', deletedCounts: result });
}
