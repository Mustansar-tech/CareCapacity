import type { Express } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { parseExcelFiles, processCapacityData, generateExcelExport } from '../pipeline';
import { storage } from '../storage';
import { getCanonicalWeekBoundaries } from '@shared/schema';
import { logger } from '../logger';
import { requireAuth, requireRoleAtLeast } from '../auth';
import { safeErrorMessage, normalizeFileName } from '../utils/helpers';
import { setLatestExportBuffer, setLatestGuaranteedBuffer, getLatestExportBuffer } from './state';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
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

export function registerProcessRoutes(app: Express): void {
  app.post(
    '/api/process',
    requireAuth,
    requireRoleAtLeast('scheduler'),
    upload.fields([
      { name: 'availability', maxCount: 1 },
      { name: 'guaranteed', maxCount: 1 },
      { name: 'cgData', maxCount: 1 },
    ]),
    async (req, res) => {
      try {
        logger.info('New file upload request received');
        const files = req.files as { [fieldname: string]: Express.Multer.File[] };
        const requestedBranchId = req.body.branchId;

        logger.info('Files received', { fields: files ? Object.keys(files) : 'No files' });
        logger.info('Requested branch ID', { branchId: requestedBranchId || 'NONE' });

        if (!files.availability || !files.guaranteed || !files.cgData) {
          return res.status(400).json({
            message: 'Missing required files. Please upload availability, guaranteed hours, and CG Data Export files.',
          });
        }

        if (!requestedBranchId) {
          return res.status(400).json({
            message: 'Branch selection is required. Please select a branch before uploading files.',
          });
        }

        const branch = await storage.getBranchById(requestedBranchId);
        if (!branch) {
          return res.status(400).json({
            message: 'Invalid branch selected. Please refresh and try again.',
          });
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
          return res.status(400).json({
            message: `File names must be: "${expectedNames.availability}", "${expectedNames.guaranteed}", "${expectedNames.cgData}" (browser download numbers like (2) are allowed)`,
          });
        }

        logger.info('File validation passed, proceeding to parsing');

        const parsedData = await parseExcelFiles(
          availabilityFile.buffer,
          guaranteedFile.buffer,
          cgDataFile.buffer,
          undefined,
          requestedBranchId
        );

        if (parsedData.detectedBranch) {
          const detectedBranchObj = await storage.getBranchByName(parsedData.detectedBranch);
          if (detectedBranchObj && detectedBranchObj.id !== requestedBranchId) {
            return res.status(400).json({
              message: `Branch mismatch: You selected "${branch.displayName}" but the Excel files contain data for "${detectedBranchObj.displayName}". Please upload the correct files or select the matching branch.`,
            });
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
          { ghWorkbookBuffer: guaranteedFile.buffer, branchId: requestedBranchId }
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
          await storage.saveBranchUpload({
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
        await storage.clearAllVisits(requestedBranchId);

        try {
          const { extractEmployeeVisitsFromGHExcel } = await import('../excel-visit-extractor');
          const weekDates = result.dailySummary?.map(d => d.date) ?? [];
          if (weekDates.length > 0) {
            const scheduleMap = await extractEmployeeVisitsFromGHExcel(
              guaranteedFile.buffer, weekDates, requestedBranchId, storage
            );
            const visitRows: import('@shared/schema').InsertCpScheduledVisit[] = [];
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
            await storage.upsertCpScheduledVisitsByDates(requestedBranchId, weekDates, visitRows);
            await storage.enforceRetentionCpScheduledVisits(requestedBranchId, 8);
            logger.info('Persisted CP scheduled visits to database (date-aware upsert)', {
              branchId: requestedBranchId, employees: scheduleMap.size, totalVisits: visitRows.length, weekDates: weekDates.length,
            });
          }
        } catch (cpErr) {
          logger.warn('Failed to persist CP scheduled visits (non-fatal):', cpErr);
        }

        try {
          if (result.dailySummary && result.dailySummary.length > 0) {
            const firstDate = result.dailySummary[0].date;
            const { weekStart, weekEnd } = getCanonicalWeekBoundaries(firstDate);

            logger.info('Persisting analysis for week', { weekStart, weekEnd, displayName: branch.displayName });

            await storage.saveCapacityAnalysis({
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
          } else {
            logger.warn('No daily summary data to persist');
          }
        } catch (persistError) {
          logger.error('Failed to persist analysis to database', persistError);
        }

        logger.info('Pipeline complete', {
          branchId: requestedBranchId,
          clientLocationsGeocoded: true,
          employeeLocationsGeocoded: true,
          visitsReady: true,
        });

        res.json(result);
      } catch (error) {
        logger.error('Processing error', error, {
          errorType: (error as any)?.constructor?.name,
          errorMessage: (error as any)?.message,
        });
        res.status(500).json({ message: safeErrorMessage(error, 'Internal processing error') });
      }
    }
  );

  app.get('/api/export', (_req, res) => {
    try {
      const buf = getLatestExportBuffer();
      if (!buf) {
        return res.status(404).json({
          message: 'No processed data available. Please process files first.',
        });
      }
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="capacity_dashboard.xlsx"');
      res.send(buf);
    } catch (error) {
      logger.error('Export error', error);
      res.status(500).json({ message: 'Failed to export data' });
    }
  });
}
