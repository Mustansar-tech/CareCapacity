import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { parseExcelFiles, processCapacityData, generateExcelExport } from '../pipeline';
import { getCanonicalWeekBoundaries } from '@shared/schema';
import { logger } from '../infrastructure/logger';
import { safeErrorMessage, normalizeFileName } from '../utils/helpers';
import { setLatestExportBuffer, setLatestGuaranteedBuffer, getLatestExportBuffer } from '../routes/state';
import * as branchRepo from '../repositories/branch.repository';
import * as capacityRepo from '../repositories/capacity.repository';
import * as geoRepo from '../repositories/geo.repository';
import * as scheduleRepo from '../repositories/schedule.repository';
import * as hrRepo from '../repositories/hr.repository';
import type { InsertCpScheduledVisit, InsertHrCalendar } from '@shared/schema';

export async function processCapacity(req: Request, res: Response): Promise<void> {
  logger.info('New file upload request received');
  const files = req.files as { [fieldname: string]: Express.Multer.File[] };
  const requestedBranchId = req.body.branchId;

  logger.info('Files received', { fields: files ? Object.keys(files) : 'No files' });
  logger.info('Requested branch ID', { branchId: requestedBranchId || 'NONE' });

  if (!files.availability || !files.guaranteed || !files.cgData) {
    res.status(400).json({
      message: 'Missing required files. Please upload availability, guaranteed hours, and CG Data Export files.',
    });
    return;
  }

  if (!requestedBranchId) {
    res.status(400).json({
      message: 'Branch selection is required. Please select a branch before uploading files.',
    });
    return;
  }

  const branch = await branchRepo.getBranchById(requestedBranchId);
  if (!branch) {
    res.status(400).json({ message: 'Invalid branch selected. Please refresh and try again.' });
    return;
  }

  logger.info('Branch validated', { displayName: branch.displayName, name: branch.name });

  const availabilityFile = files.availability[0];
  const guaranteedFile = files.guaranteed[0];
  const cgDataFile = files.cgData[0];

  const expectedNames = {
    availability: 'Availability Export.xlsx',
    guaranteed: 'Care Pro Guaranteed Hours.xlsx',
    cgData: 'CG Data Export.xlsx',
  };

  const normalizedAvailabilityName = normalizeFileName(availabilityFile.originalname);
  const normalizedGuaranteedName = normalizeFileName(guaranteedFile.originalname);
  const normalizedCgDataName = normalizeFileName(cgDataFile.originalname);

  logger.debug('File name validation', {
    availability: { original: availabilityFile.originalname, normalized: normalizedAvailabilityName },
    guaranteed: { original: guaranteedFile.originalname, normalized: normalizedGuaranteedName },
    cgData: { original: cgDataFile.originalname, normalized: normalizedCgDataName },
    expected: expectedNames,
  });

  if (
    normalizedAvailabilityName !== expectedNames.availability ||
    normalizedGuaranteedName !== expectedNames.guaranteed ||
    normalizedCgDataName !== expectedNames.cgData
  ) {
    logger.warn('File validation failed', {
      availabilityMatch: normalizedAvailabilityName === expectedNames.availability,
      cgDataMatch: normalizedCgDataName === expectedNames.cgData,
      guaranteedMatch: normalizedGuaranteedName === expectedNames.guaranteed,
    });
    res.status(400).json({
      message: `File names must be: "${expectedNames.availability}", "${expectedNames.guaranteed}", "${expectedNames.cgData}" (browser download numbers like (2) are allowed)`,
    });
    return;
  }

  logger.info('File validation passed, proceeding to parsing');

  const parsedData = await parseExcelFiles(
    availabilityFile.buffer,
    guaranteedFile.buffer,
    cgDataFile.buffer,
    undefined,
    requestedBranchId,
  );

  if (parsedData.detectedBranch) {
    const detectedBranchObj = await branchRepo.getBranchByName(parsedData.detectedBranch);
    if (detectedBranchObj && detectedBranchObj.id !== requestedBranchId) {
      res.status(400).json({
        message: `Branch mismatch: You selected "${branch.displayName}" but the Excel files contain data for "${detectedBranchObj.displayName}". Please upload the correct files or select the matching branch.`,
      });
      return;
    }
  } else {
    logger.warn('No branch detected in Excel files, proceeding with selected branch', { displayName: branch.displayName });
  }

  logger.info('Branch validation complete, processing data', { displayName: branch.displayName });

  const result = await processCapacityData(
    parsedData.availability,
    parsedData.guaranteed,
    parsedData.demand,
    parsedData.cgData,
    { ghWorkbookBuffer: guaranteedFile.buffer, branchId: requestedBranchId, guaranteedRaw: parsedData.guaranteedRaw },
  );

  if (parsedData.warnings.length > 0) {
    result.warnings = [...(result.warnings || []), ...parsedData.warnings];
  }

  const cleanedRecords = result.cleanedRecords;
  const exportBuffer = await generateExcelExport(result, cleanedRecords, parsedData.cgData);

  setLatestExportBuffer(exportBuffer);
  setLatestGuaranteedBuffer(requestedBranchId, guaranteedFile.buffer);
  logger.info('Stored Guaranteed Hours buffer in memory', { bytes: guaranteedFile.buffer.length, branchId: requestedBranchId });

  try {
    await branchRepo.saveBranchUpload({
      branchId: requestedBranchId,
      uploadType: 'guaranteedHours',
      fileBuffer: guaranteedFile.buffer.toString('base64'),
      originalFileName: guaranteedFile.originalname,
      fileSize: guaranteedFile.buffer.length,
      sha256: null,
    });
    logger.info('Persisted Guaranteed Hours buffer to database', { branchId: requestedBranchId });
  } catch (dbError) {
    logger.error('Failed to persist GH buffer to database', dbError);
  }

  const exportPath = path.join(process.cwd(), 'capacity_dashboard.xlsx');
  fs.writeFileSync(exportPath, exportBuffer);

  logger.info('Clearing old visits data', { displayName: branch.displayName });
  await geoRepo.clearAllVisits(requestedBranchId);

  try {
    const { extractEmployeeVisitsFromGHExcel } = await import('../features/imports/excel-visit-extractor');
    const weekDates = result.dailySummary?.map(d => d.date) ?? [];
    if (weekDates.length > 0) {
      const { storage } = await import('../storage');
      const scheduleMap = await extractEmployeeVisitsFromGHExcel(
        guaranteedFile.buffer, weekDates, requestedBranchId, storage,
      );
      const visitRows: InsertCpScheduledVisit[] = [];
      for (const [cpName, dayMap] of scheduleMap) {
        for (const [date, entries] of dayMap) {
          for (const entry of entries) {
            visitRows.push({
              branchId: requestedBranchId,
              cpName,
              clientName: entry.clientName,
              clientLat: entry.lat != null ? String(entry.lat) : null,
              clientLng: entry.lng != null ? String(entry.lng) : null,
              clientPostcode: entry.postcode ?? null,
              date,
              startTime: entry.startTime,
              endTime: entry.endTime,
            });
          }
        }
      }
      await scheduleRepo.upsertCpScheduledVisitsByDates(requestedBranchId, weekDates, visitRows);
      await scheduleRepo.enforceRetentionCpScheduledVisits(requestedBranchId);
      logger.info('Persisted CP scheduled visits to database (date-aware upsert)', {
        branchId: requestedBranchId, employees: scheduleMap.size, totalVisits: visitRows.length, weekDates: weekDates.length,
      });
    }
  } catch (cpErr) {
    logger.warn('Failed to persist CP scheduled visits (non-fatal):', cpErr);
  }

  try {
    const { extractAllClientVisitsFromGHExcel } = await import('../features/imports/excel-visit-extractor');
    const { storage } = await import('../storage');
    const weekDates = result.dailySummary?.map(d => d.date) ?? [];
    if (weekDates.length > 0) {
      const clientVisitMap = await extractAllClientVisitsFromGHExcel(guaranteedFile.buffer, weekDates, requestedBranchId, storage);
      const clientVisitRows: import('@shared/schema').InsertGhClientVisit[] = [];
      for (const [date, visits] of clientVisitMap) {
        for (const v of visits) {
          clientVisitRows.push({
            branchId: requestedBranchId,
            clientName: v.clientName,
            date,
            startTime: v.startTime,
            endTime: v.endTime,
            durationMinutes: v.durationMinutes,
            serviceType: v.serviceType ?? null,
            priority: v.priority ?? 1,
            lat: v.lat != null ? String(v.lat) : null,
            lng: v.lng != null ? String(v.lng) : null,
            postcode: v.postcode ?? null,
          });
        }
      }
      await scheduleRepo.upsertGhClientVisitsByDates(requestedBranchId, weekDates, clientVisitRows);
      await scheduleRepo.enforceRetentionGhClientVisits(requestedBranchId);
      logger.info('Persisted GH client visits to database (date-aware upsert)', {
        branchId: requestedBranchId, totalVisits: clientVisitRows.length, weekDates: weekDates.length,
      });
    }
  } catch (clientErr) {
    logger.warn('Failed to persist GH client visits (non-fatal):', clientErr);
  }

  try {
    if (result.dailySummary && result.dailySummary.length > 0) {
      const firstDate = result.dailySummary[0].date;
      const { weekStart, weekEnd } = getCanonicalWeekBoundaries(firstDate);
      logger.info('Persisting analysis for week', { weekStart, weekEnd, displayName: branch.displayName });
      await capacityRepo.saveCapacityAnalysis({
        branchId: requestedBranchId,
        weekStartDate: weekStart,
        weekEndDate: weekEnd,
        kpis: result.kpis,
        dailySummary: result.dailySummary,
        employeesByDate: result.employeesByDate,
        employeeSummaryByDate: result.employeeSummaryByDate || {},
        warnings: result.warnings || [],
      });
      logger.info('Analysis persisted successfully', { weekStart, branchName: branch.name });
      capacityRepo.enforceRetentionLatestWeeks(requestedBranchId).catch((e) =>
        logger.warn('Retention sweep failed (non-fatal)', { err: e }),
      );
    } else {
      logger.warn('No daily summary data to persist');
    }
  } catch (persistError) {
    logger.error('Failed to persist analysis to database', persistError);
  }

  try {
    const weekDates = result.dailySummary?.map(d => d.date) ?? [];
    if (weekDates.length > 0 && result.employeesByDate) {
      const hrRows: InsertHrCalendar[] = [];
      // Build transport-mode lookup from employeeLocations (name → mode)
      const transportModeByName = new Map<string, string>();
      if (result.employeeLocations) {
        for (const loc of result.employeeLocations) {
          if (loc.transportMode) transportModeByName.set(loc.employeeName.toLowerCase(), loc.transportMode);
        }
      }
      // Also check employeeSummaryByDate for transportMode field
      for (const [, summaries] of Object.entries(result.employeeSummaryByDate ?? {})) {
        for (const s of summaries) {
          if (s.transportMode) transportModeByName.set(s.employeeName.toLowerCase(), s.transportMode);
        }
      }

      for (const [date, employees] of Object.entries(result.employeesByDate)) {
        if (!weekDates.includes(date)) continue;
        for (const emp of employees) {
          const key = emp.employeeName
            .toLowerCase()
            .replace(/\b(mr|mrs|ms|miss|dr|prof)\b\.?\s*/gi, '')
            .trim()
            .split(/\s+/)
            .sort()
            .join(' ');
          hrRows.push({
            branchId: requestedBranchId,
            employeeKey: key,
            employeeName: emp.employeeName,
            date,
            status: emp.status,
            source: 'processed',
            notes: emp.notes || null,
            contractedHours: emp.contractedDailyHours ?? null,
            transportMode: transportModeByName.get(emp.employeeName.toLowerCase()) ?? null,
          });
        }
      }
      if (hrRows.length > 0) {
        await hrRepo.upsertProcessedRecords(hrRows);
        logger.info('HR calendar records upserted', { branchId: requestedBranchId, count: hrRows.length });
      }
    }
  } catch (hrErr) {
    logger.warn('Failed to upsert HR calendar records (non-fatal):', hrErr);
  }

  logger.info('Pipeline complete', { branchId: requestedBranchId });
  res.json(result);
}

export function getExport(_req: Request, res: Response): void {
  const buf = getLatestExportBuffer();
  if (!buf) {
    res.status(404).json({
      message: 'No processed data available. Please process files first.',
    });
    return;
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="capacity_dashboard.xlsx"');
  res.send(buf);
}
