import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { parseExcelFiles, processCapacityData, generateExcelExport } from './pipeline';
import { storage } from "./storage";
import { getCanonicalWeekBoundaries, type ProcessingResult } from "@shared/schema";

import { logger } from "./logger";

const isProduction = process.env.NODE_ENV === 'production';

function safeErrorMessage(error: unknown, fallback: string): string {
  if (!isProduction) {
    return error instanceof Error ? error.message : fallback;
  }
  return fallback;
}

/**
 * Resolves branchId from request query (GET) or body (POST/PUT/DELETE)
 */
async function resolveBranch(req: Request): Promise<string> {
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


// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (_req, file, cb) => {
    logger.debug('File upload attempt', { fileName: file.originalname, mimeType: file.mimetype });

    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        file.mimetype === 'application/vnd.ms-excel' ||
        file.originalname.toLowerCase().endsWith('.xlsx') ||
        file.originalname.toLowerCase().endsWith('.xls')) {
      logger.debug('File accepted', { fileName: file.originalname });
      cb(null, true);
    } else {
      logger.warn('File rejected', { fileName: file.originalname, mimeType: file.mimetype });
      cb(new Error(`Only Excel files are allowed. Got MIME type: ${file.mimetype}`));
    }
  }
});

// Store the latest processed data and export file
let latestExportBuffer: Buffer | null = null;

// Store Guaranteed Hours Excel buffer for extracting real client visit times, per branch
const guaranteedBufferByBranch: Map<string, Buffer> = new Map();

// Setter function for guaranteedBufferByBranch
function setLatestGuaranteedBuffer(branchId: string, buffer: Buffer): void {
  logger.debug('Storing GH buffer', { branchId, bytes: buffer.length });
  logger.debug('Branches in map before set', { branches: Array.from(guaranteedBufferByBranch.keys()) });
  guaranteedBufferByBranch.set(branchId, buffer);
  logger.debug('Branches in map after set', { branches: Array.from(guaranteedBufferByBranch.keys()) });
  logger.debug('GH buffer verification', { branchId, canRetrieve: guaranteedBufferByBranch.has(branchId) });
}

// Getter function for guaranteedBufferByBranch (checks in-memory cache + database fallback)
export async function getLatestGuaranteedBuffer(branchId: string): Promise<Buffer | null> {
  logger.debug('Retrieving GH buffer', { branchId });
  logger.debug('Available branches in map', { branches: Array.from(guaranteedBufferByBranch.keys()) });

  // Check in-memory cache first
  let buffer = guaranteedBufferByBranch.get(branchId) || null;

  if (!buffer) {
    // Fallback to database
    logger.debug('GH buffer not in memory, checking database', { branchId });
    try {
      const upload = await storage.getLatestBranchUpload(branchId, 'guaranteedHours');
      if (upload) {
        buffer = Buffer.from(upload.fileBuffer, 'base64');
        // Hydrate the cache
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

// Helper function to normalize file names by removing browser download numbers
function normalizeFileName(fileName: string): string {
  // Remove numbers in parentheses that browsers add for duplicate downloads
  // e.g. "Hours by Service Type (1).xlsx" -> "Hours by Service Type.xlsx"
  return fileName.replace(/\s*\(\d+\)/g, '');
}

// Import shared geocoding function from pipeline
import { geocodeWithFallback } from './pipeline';

export async function registerRoutes(app: Express): Promise<Server> {

  // Health check endpoint for monitoring
  app.get('/health', async (_req, res) => {
    try {
      const { checkDatabaseHealth } = await import('./db');
      const dbHealthy = await checkDatabaseHealth();
      
      const health = {
        status: dbHealthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: dbHealthy ? 'connected' : 'disconnected'
      };

      res.status(dbHealthy ? 200 : 503).json(health);
    } catch (error) {
      logger.error('Health check failed', error);
      res.status(500).json({ status: 'error' });
    }
  });

  // GET /api/branches - Get all available branches
  app.get('/api/branches', async (_req, res) => {
    try {
      const branches = await storage.getAllBranches();
      res.json(branches);
    } catch (error) {
      logger.error('Error fetching branches', error);
      res.status(500).json({ 
        message: 'Failed to fetch branches',
        error: safeErrorMessage(error, 'Unknown error')
      });
    }
  });

  // POST /api/process - Process uploaded Excel files
  app.post('/api/process', upload.fields([
    { name: 'availability', maxCount: 1 },
    { name: 'guaranteed', maxCount: 1 },
    { name: 'cgData', maxCount: 1 }
  ]), async (req, res) => {
    try {
      logger.info('New file upload request received');
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const requestedBranchId = req.body.branchId; // Branch ID from frontend

      logger.info('Files received', { fields: files ? Object.keys(files) : 'No files' });
      logger.info('Requested branch ID', { branchId: requestedBranchId || 'NONE' });

      // Validate that all three files are present
      if (!files.availability || !files.guaranteed || !files.cgData) {
        return res.status(400).json({
          message: 'Missing required files. Please upload availability, guaranteed hours, and CG Data Export files.'
        });
      }

      // Validate branchId is provided
      if (!requestedBranchId) {
        return res.status(400).json({
          message: 'Branch selection is required. Please select a branch before uploading files.'
        });
      }

      // Validate branchId exists in database
      const branch = await storage.getBranchById(requestedBranchId);
      if (!branch) {
        return res.status(400).json({
          message: 'Invalid branch selected. Please refresh and try again.'
        });
      }

      logger.info('Branch validated', { displayName: branch.displayName, name: branch.name });

      const availabilityFile = files.availability[0];
      const guaranteedFile = files.guaranteed[0];
      const cgDataFile = files.cgData[0];

      // Validate file names (allowing for browser download numbers like (2), (3))
      const expectedNames = {
        availability: 'Availability Export.xlsx',
        guaranteed: 'Care Pro Guaranteed Hours.xlsx',
        cgData: 'CG Data Export.xlsx'
      };

      const normalizedAvailabilityName = normalizeFileName(availabilityFile.originalname);
      const normalizedGuaranteedName = normalizeFileName(guaranteedFile.originalname);
      const normalizedCgDataName = normalizeFileName(cgDataFile.originalname);

      logger.debug('File name validation', {
        availability: { original: availabilityFile.originalname, normalized: normalizedAvailabilityName },
        guaranteed: { original: guaranteedFile.originalname, normalized: normalizedGuaranteedName },
        cgData: { original: cgDataFile.originalname, normalized: normalizedCgDataName },
        expected: expectedNames
      });

      if (normalizedAvailabilityName !== expectedNames.availability ||
          normalizedGuaranteedName !== expectedNames.guaranteed ||
          normalizedCgDataName !== expectedNames.cgData) {
        logger.warn('File validation failed', {
          availabilityMatch: normalizedAvailabilityName === expectedNames.availability,
          cgDataMatch: normalizedCgDataName === expectedNames.cgData,
          guaranteedMatch: normalizedGuaranteedName === expectedNames.guaranteed
        });
        return res.status(400).json({
          message: `File names must be: "${expectedNames.availability}", "${expectedNames.guaranteed}", "${expectedNames.cgData}" (browser download numbers like (2) are allowed)`
        });
      }

      logger.info('File validation passed, proceeding to parsing');

      // Parse Excel files including CG Data Export - pass branchId for branch-scoped parsing
      const parsedData = await parseExcelFiles(
        availabilityFile.buffer,
        guaranteedFile.buffer,
        cgDataFile.buffer,
        undefined, // ghWorkbookBuffer (not needed here)
        requestedBranchId  // Pass branchId for proper branch scoping
      );

      // Validate detected branch matches requested branch
      if (parsedData.detectedBranch) {
        const detectedBranchObj = await storage.getBranchByName(parsedData.detectedBranch);
        if (detectedBranchObj && detectedBranchObj.id !== requestedBranchId) {
          return res.status(400).json({
            message: `Branch mismatch: You selected "${branch.displayName}" but the Excel files contain data for "${detectedBranchObj.displayName}". Please upload the correct files or select the matching branch.`
          });
        }
      } else {
        logger.warn('No branch detected in Excel files, proceeding with selected branch', { displayName: branch.displayName });
      }

      logger.info('Branch validation complete, processing data', { displayName: branch.displayName });

      // Process the data with CG Data as master employee list
      const result = await processCapacityData(
        parsedData.availability,
        parsedData.guaranteed,     // still the filtered rows for scheduling
        parsedData.demand,
        parsedData.cgData,
        { ghWorkbookBuffer: guaranteedFile.buffer, branchId: requestedBranchId }   // pass branchId and raw workbook buffer
      );

      // Add parsing warnings to result
      if (parsedData.warnings.length > 0) {
        result.warnings = [...(result.warnings || []), ...parsedData.warnings];
      }

      // Use cleaned records from pipeline
      const cleanedRecords = result.cleanedRecords;

      // Generate Excel export with enhanced analysis tabs
      const exportBuffer = await generateExcelExport(result, cleanedRecords, parsedData.cgData);

      // Store for export endpoint
      latestExportBuffer = exportBuffer;

      // Store Guaranteed Hours buffer per branch for visit extraction (in-memory + database)
      setLatestGuaranteedBuffer(requestedBranchId, guaranteedFile.buffer);
      logger.info('Stored Guaranteed Hours buffer in memory', { bytes: guaranteedFile.buffer.length, branchId: requestedBranchId });

      // Persist to database for cross-restart/cross-branch reliability
      try {
        await storage.saveBranchUpload({
          branchId: requestedBranchId,
          uploadType: 'guaranteedHours',
          fileBuffer: guaranteedFile.buffer.toString('base64'),
          originalFileName: guaranteedFile.originalname,
          fileSize: guaranteedFile.buffer.length,
          sha256: null, // Could add crypto.createHash('sha256').update(buffer).digest('hex') if needed
        });
        logger.info('Persisted Guaranteed Hours buffer to database', { branchId: requestedBranchId });
      } catch (dbError) {
        logger.error('Failed to persist GH buffer to database', dbError);
        // Don't fail the request if database persistence fails - in-memory cache still works
      }

      // Save Excel file to disk
      const exportPath = path.join(process.cwd(), 'capacity_dashboard.xlsx');
      fs.writeFileSync(exportPath, exportBuffer);

      // Clear old visits data before processing new data
      logger.info('Clearing old visits data', { displayName: branch.displayName });
      await storage.clearAllVisits(requestedBranchId);

      // Persist processed data to database with derived week boundaries
      try {
        if (result.dailySummary && result.dailySummary.length > 0) {
          // Get week boundaries from the first date in daily summary
          const firstDate = result.dailySummary[0].date;
          const { weekStart, weekEnd } = getCanonicalWeekBoundaries(firstDate);

          logger.info('Persisting analysis for week', { weekStart, weekEnd, displayName: branch.displayName });

          // Save to database (will upsert if week already exists per branch)
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
        // Don't fail the request if persistence fails
      }

      logger.info('Pipeline complete', {
        branchId: requestedBranchId,
        clientLocationsGeocoded: true,
        employeeLocationsGeocoded: true,
        visitsReady: true
      });

      res.json(result);

    } catch (error) {
      logger.error('Processing error', error, {
        errorType: (error as any)?.constructor?.name,
        errorMessage: (error as any)?.message
      });

      res.status(500).json({
        message: safeErrorMessage(error, 'Internal processing error')
      });
    }
  });

  // GET /api/export - Download the latest generated Excel file
  app.get('/api/export', (_req, res) => {
    try {
      if (!latestExportBuffer) {
        return res.status(404).json({
          message: 'No processed data available. Please process files first.'
        });
      }

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="capacity_dashboard.xlsx"');
      res.send(latestExportBuffer);

    } catch (error) {
      logger.error('Export error', error);
      res.status(500).json({
        message: 'Failed to export data'
      });
    }
  });

  // Get visits for a specific date for scheduling
  app.get("/api/visits/:date", async (req, res) => {
    try {
      const { date } = req.params;
      const branchId = await resolveBranch(req); // Resolve branchId for buffer lookup
      logger.debug('Extracting client visits from Guaranteed Hours Excel', { date, branchId });

      const guaranteedBuffer = await getLatestGuaranteedBuffer(branchId);
      if (!guaranteedBuffer) {
        return res.status(404).json({ error: "No processed data available for this branch. Please upload the Excel files first to enable scheduling." });
      }

      // Dynamically import the function to avoid circular dependencies or unnecessary loads
      const { extractClientVisitsFromGHExcel } = await import('./excel-visit-extractor');
      const parsedDate = new Date(date + 'T00:00:00.000Z'); // Parse as UTC
      const visits = await extractClientVisitsFromGHExcel(guaranteedBuffer, parsedDate, branchId, storage);
      res.json(visits);
    } catch (error) {
      logger.error('Error extracting visits', error);
      res.status(500).json({ error: "Failed to extract visits" });
    }
  });

  // Get visits between dates
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

      const visits = await storage.listVisitsBetween(
        branchId,
        String(startDate),
        String(endDate)
      );

      logger.debug('Found visits for date range', { count: visits.length });
      res.json(visits);
    } catch (error) {
      logger.error('Error fetching visits', error);
      res.status(500).json({ message: 'Failed to fetch visits' });
    }
  });

  // Auto-schedule a single day
  app.post("/api/schedule/auto-day", async (req, res) => {
    try {
      const { date } = req.body;
      const branchId = await resolveBranch(req);

      if (!date) {
        return res.status(400).json({ error: "Date is required" });
      }

      logger.info('Generating schedule for day', { date, branchId });

      const { autoScheduler } = await import("./auto-scheduler");
      const schedule = await autoScheduler.scheduleDay(date, branchId); // Pass branchId

      res.json(schedule);
    } catch (error) {
      logger.error('Error auto-scheduling day', error);
      res.status(500).json({ error: "Failed to auto-schedule day" });
    }
  });

  // Auto-schedule entire week
  app.post("/api/schedule/auto-week", async (req, res) => {
    try {
      const { startDate } = req.body;
      const branchId = await resolveBranch(req);

      if (!startDate) {
        return res.status(400).json({ error: "Start date is required" });
      }

      logger.info('Generating schedule for week', { startDate, branchId });

      const { autoScheduler } = await import("./auto-scheduler");
      const weekSchedule = await autoScheduler.scheduleWeek(startDate, branchId); // Pass branchId

      res.json(weekSchedule);
    } catch (error) {
      logger.error('Error auto-scheduling week', error);
      res.status(500).json({ error: "Failed to auto-schedule week" });
    }
  });

  // Get weekly schedule
  app.get("/api/schedule/week/:startDate", async (req, res) => {
    try {
      const { startDate } = req.params;
      const branchId = await resolveBranch(req);

      const { autoScheduler } = await import("./auto-scheduler");
      const weekSchedule = await autoScheduler.getWeekSchedule(startDate, branchId); // Pass branchId

      res.json(weekSchedule);
    } catch (error) {
      logger.error('Error getting weekly schedule', error);
      res.status(500).json({ error: "Failed to get weekly schedule" });
    }
  });

  // Auto-scheduler endpoints
  app.post('/api/run-optimization/optimize', async (req, res) => {
    try {
      const { date, maxCareMinutes, bufferMinutes, maxTravelBetweenVisits } = req.body;
      const branchId = await resolveBranch(req);

      if (!date) {
        return res.status(400).json({ error: 'Date is required' });
      }

      logger.info('Starting run optimization', { date, branchId });
      const { autoScheduler } = await import("./auto-scheduler");
      const result = await autoScheduler.scheduleDay(date, branchId); // Pass branchId

      res.json(result);
    } catch (error) {
      logger.error('Run optimization error', error);
      res.status(500).json({ 
        error: 'Run optimization failed',
        details: safeErrorMessage(error, 'An error occurred')
      });
    }
  });

  // Weekly route-optimized scheduling endpoint
  app.post('/api/auto-schedule', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const { date, settings } = req.body;

      if (!date) {
        return res.status(400).json({ error: 'Date is required' });
      }

      logger.info('Starting route optimization', { date, branchId });

      // Get available employees for the date
      const employees = await getAvailableEmployeesForDate(branchId, date);
      logger.debug('Found available employees', { count: employees.length });

      // Get unassigned visits for the date  
      const visits = await getUnassignedVisitsForDate(branchId, date);
      logger.debug('Found visits to schedule', { count: visits.length });

      if (employees.length === 0 || visits.length === 0) {
        return res.json({
          date,
          employees: [],
          unassignedVisits: visits,
          metrics: {
            totalAssignedVisits: 0,
            totalUnassignedVisits: visits.length,
            averageUtilization: 0,
            totalTravelTime: 0,
            routeEfficiency: 0,
          }
        });
      }

      // Apply route optimization algorithm
      const optimizedSchedule = await optimizeRoutesForDay(date, employees, visits, settings);

      res.json(optimizedSchedule);
    } catch (error) {
      logger.error('Auto-scheduling error', error);
      res.status(500).json({ 
        error: 'Auto-scheduling failed',
        details: safeErrorMessage(error, 'An error occurred')
      });
    }
  });

  // GET /api/history - Get all historical analyses (latest 8 weeks only)
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

  // GET /api/history/latest - Get the latest analysis
  app.get('/api/history/latest', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const analysis = await storage.getLatestCapacityAnalysis(branchId);
      if (!analysis) {
        return res.status(404).json({
          message: 'No historical data found'
        });
      }
      res.json(analysis);
    } catch (error) {
      logger.error('Latest history fetch error', error);
      const message = safeErrorMessage(error, 'Failed to fetch latest data');
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message });
    }
  });


  // GET /api/history/range/:startDate/:endDate - Get analyses by date range
  app.get('/api/history/range/:startDate/:endDate', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const { startDate, endDate } = req.params;

      // Validate date format (YYYY-MM-DD)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
        return res.status(400).json({
          message: 'Invalid date format. Use YYYY-MM-DD'
        });
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

  // POST /api/cleanup - Clean up old data
  app.post('/api/cleanup', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const { months = 6 } = req.body;

      if (typeof months !== 'number' || months < 1 || months > 60) {
        return res.status(400).json({
          message: 'Months parameter must be between 1 and 60'
        });
      }

      const deletedCount = await storage.cleanupOldAnalyses(branchId, months);

      res.json({
        message: `Successfully cleaned up old data`,
        deletedAnalyses: deletedCount,
        cutoffMonths: months
      });
    } catch (error) {
      logger.error('Cleanup error', error);
      const message = safeErrorMessage(error, 'Failed to cleanup old data');
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message });
    }
  });

  // GET /api/cleanup/preview/:months - Preview what would be deleted
  app.get('/api/cleanup/preview/:months', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const months = parseInt(req.params.months);

      if (isNaN(months) || months < 1 || months > 60) {
        return res.status(400).json({
          message: 'Months parameter must be between 1 and 60'
        });
      }

      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - months);
      const cutoffString = cutoffDate.toISOString().split('T')[0];

      // Get all analyses to count how many would be deleted
      const allAnalyses = await storage.getLatestWeeksAnalyses(branchId, 12); // Get more for cleanup preview
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
        newestAnalysis: allAnalyses.length > 0 ? allAnalyses[0]?.uploadedAt : null
      });
    } catch (error) {
      logger.error('Cleanup preview error', error);
      const message = safeErrorMessage(error, 'Failed to preview cleanup');
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message });
    }
  });

  // Geographical scheduling optimization routes
  // NOTE: geocodeWithFallback is imported from pipeline.ts at the top of this file

  // POST /api/geo/geocode-batch - Batch geocode postcodes and addresses
  app.post('/api/geo/geocode-batch', async (req, res) => {
    try {
      const { postcodes = [], addresses = [], branchId } = req.body;

      // Validate branchId - required for proper cache isolation
      if (!branchId) {
        logger.warn('geocode-batch called without branchId, cache lookups may not work correctly');
      }

      // OPTIMIZATION: Process unique postcodes in parallel for 70-80% faster geocoding
      const uniquePostcodes = Array.from(new Set(postcodes as string[]));
      logger.info('Parallel geocoding postcodes', { uniqueCount: uniquePostcodes.length, totalCount: postcodes.length, branchId: branchId || 'UNKNOWN' });

      // CACHE VERIFICATION: Check which postcodes are already cached
      const cacheChecks = await Promise.all(
        uniquePostcodes.map(async (postcode) => {
          const normalizedPostcode = postcode.trim().toUpperCase();
          // Only check cache if branchId is provided
          const cached = branchId ? await storage.getGeocode(branchId, `postcode:${normalizedPostcode}`) : undefined;
          return { postcode, normalizedPostcode, cached };
        })
      );

      const cachedResults = cacheChecks.filter(c => c.cached).map(c => ({
        query: c.normalizedPostcode,
        input: c.postcode,
        postcode: c.postcode,
        type: 'postcode',
        lat: Number(c.cached!.lat),
        lng: Number(c.cached!.lng),
        source: 'cache',
        success: true,
        approximate: false
      }));

      const uncachedPostcodes = cacheChecks.filter(c => !c.cached).map(c => c.postcode);

      logger.debug('Geocoding cache stats', { cached: cachedResults.length, uncached: uncachedPostcodes.length });

      // Process all uncached postcodes in parallel using Promise.all
      const postcodePromises = uncachedPostcodes.map(async (postcode) => {
        try {
          logger.debug('Geocoding postcode', { postcode });
          const geocodeResult = await geocodeWithFallback(postcode, storage, branchId);
          if (geocodeResult && geocodeResult.lat && geocodeResult.lng) {
            logger.debug('Geocoded postcode successfully', { postcode, lat: geocodeResult.lat, lng: geocodeResult.lng });
            return {
              ...geocodeResult,
              input: postcode,
              postcode: postcode,
              success: true,
              lat: Number(geocodeResult.lat),
              lng: Number(geocodeResult.lng)
            };
          } else {
            logger.warn('Failed to geocode postcode, no coordinates returned', { postcode });
            return {
              query: postcode,
              input: postcode,
              postcode: postcode,
              type: 'postcode',
              error: 'No coordinates returned',
              success: false,
              source: 'none'
            };
          }
        } catch (error) {
          logger.error('Error geocoding postcode', error, { postcode });
          return {
            query: postcode,
            input: postcode,
            postcode: postcode,
            type: 'postcode',
            error: 'Geocoding completely failed',
            success: false,
            source: 'error'
          };
        }
      });

      const newResults = await Promise.all(postcodePromises);

      // Merge cached and newly geocoded results
      const results = [...cachedResults, ...newResults];

      // TODO: Process full addresses using Mapbox/Google Maps when needed
      for (const address of addresses) {
        results.push({
          query: address,
          type: 'address',
          error: 'Address geocoding not implemented yet',
          source: 'none'
        });
      }

      res.json({ results });
    } catch (error) {
      logger.error('Geocoding error', error);
      res.status(500).json({ message: 'Geocoding failed' });
    }
  });

  // POST /api/routing/distance-matrix - Calculate travel times between locations
  app.post('/api/routing/distance-matrix', async (req, res) => {
    try {
      const { origins, destinations, transportMode = 'driving' } = req.body;

      if (!origins || !destinations || origins.length === 0 || destinations.length === 0) {
        return res.status(400).json({ message: 'Origins and destinations are required' });
      }

      // Format coordinates for OpenRouteService
      const originsCoords = origins.map((o: any) => [parseFloat(o.lng), parseFloat(o.lat)]);
      const destinationsCoords = destinations.map((d: any) => [parseFloat(d.lng), parseFloat(d.lat)]);

      // TODO: Add OpenRouteService API key via environment variable
      const ORS_API_KEY = process.env.ORS_API_KEY;
      if (!ORS_API_KEY) {
        return res.status(500).json({ message: 'OpenRouteService API key not configured' });
      }

      const response = await fetch('https://api.openrouteservice.org/v2/matrix/driving-car', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': ORS_API_KEY
        },
        body: JSON.stringify({
          locations: [...originsCoords, ...destinationsCoords],
          sources: Array.from({ length: origins.length }, (_, i) => i),
          destinations: Array.from({ length: destinations.length }, (_, i) => origins.length + i),
          metrics: ['duration', 'distance']
        })
      });

      if (!response.ok) {
        throw new Error(`OpenRouteService error: ${response.status}`);
      }

      const data = await response.json();

      // Format response to match our needs
      const matrix = {
        durations: data.durations, // in seconds
        distances: data.distances, // in meters
        origins: origins,
        destinations: destinations
      };

      res.json(matrix);
    } catch (error) {
      logger.error('Distance matrix error', error);
      res.status(500).json({ message: 'Distance matrix calculation failed' });
    }
  });

  // POST /api/routing/optimize - Optimize routes for employees with 15-minute constraint
  app.post('/api/routing/optimize', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const { date, employeeIds = [] } = req.body;

      if (!date) {
        return res.status(400).json({ message: 'Date is required' });
      }

      // TODO: Implement route optimization algorithm
      // 1. Get employee locations and visits for the date
      // 2. Calculate distance matrix between all locations
      // 3. Apply 15-minute travel constraint
      // 4. Use constructive heuristic + local search optimization
      // 5. Return optimized route plans

      const optimizedRoutes = [];

      // Placeholder implementation
      for (const employeeId of employeeIds) {
        const employeeLocation = await storage.getEmployeeLocationByName(branchId, employeeId);
        if (employeeLocation) {
          const routePlan = await storage.saveRoutePlan({
            branchId,
            date,
            employeeId: employeeLocation.id,
            status: 'infeasible',
            warnings: ['Route optimization algorithm not yet implemented']
          });
          optimizedRoutes.push(routePlan);
        }
      }

      res.json({ optimizedRoutes });
    } catch (error) {
      logger.error('Route optimization error', error);
      const message = safeErrorMessage(error, 'Route optimization failed');
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message });
    }
  });

  // GET /api/routing/plans?date=YYYY-MM-DD - Get route plans for a date
  app.get('/api/routing/plans', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const date = req.query.date as string;
      if (!date) {
        return res.status(400).json({ message: 'Date parameter is required' });
      }

      const plans = await storage.getRoutePlansByDate(branchId, date);

      // Fetch route stops for each plan
      const plansWithStops = await Promise.all(
        plans.map(async (plan) => {
          const stops = await storage.getRouteStopsByPlan(plan.id);
          return { ...plan, stops };
        })
      );

      res.json(plansWithStops);
    } catch (error) {
      logger.error('Get route plans error', error);
      const message = safeErrorMessage(error, 'Failed to get route plans');
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message });
    }
  });

  // GET /api/geographical/employees - Get all employee locations
  app.get('/api/geographical/employees', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const locations = await storage.getAllEmployeeLocations(branchId);
      res.json(locations);
    } catch (error) {
      logger.error('Get employee locations error', error);
      const message = safeErrorMessage(error, 'Failed to get employee locations');
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message });
    }
  });

  // GET /api/geographical/clients - Get all client locations
  app.get('/api/geographical/clients', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const locations = await storage.getAllClientLocations(branchId);
      res.json(locations);
    } catch (error) {
      logger.error('Get client locations error', error);
      const message = safeErrorMessage(error, 'Failed to get client locations');
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message });
    }
  });



  // POST /api/cleanup/routes-visits - Clean up routes and visits data
  app.post('/api/cleanup/routes-visits', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      logger.info('Starting cleanup of routes and visits data', { branchId });

      const result = await storage.clearRoutesAndVisits(branchId);

      logger.info('Cleanup complete', { routePlansDeleted: result.routePlansDeleted, routeStopsDeleted: result.routeStopsDeleted, visitsDeleted: result.visitsDeleted });

      res.json({
        message: 'Routes and visits data cleaned successfully',
        deletedCounts: result
      });

    } catch (error) {
      logger.error('Cleanup error', error);
      const message = safeErrorMessage(error, 'Failed to cleanup routes and visits data');
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ 
        message, 
        details: safeErrorMessage(error, 'An error occurred') 
      });
    }
  });

  // Helper function to get full processing results
  async function getProcessingResults(branchId: string): Promise<ProcessingResult | null> {
    try {
      const analyses = await storage.getCapacityAnalyses(branchId);
      if (analyses.length === 0) return null;

      return analyses[0] as ProcessingResult;
    } catch (error) {
      logger.error('Error getting processing results', error);
      return null;
    }
  }

  // Helper functions for route optimization
  async function getAvailableEmployeesForDate(branchId: string, date: string) {
    try {
      const results = await getProcessingResults(branchId);
      if (!results) return [];

      const employeesForDate = results.employeesByDate?.[date] || [];
      const employeeLocations = results.employeeLocations || [];

      return employeesForDate
        .filter((emp: any) => ['Available', 'Partial Availability'].includes(emp.status))
        .map((emp: any) => {
          const location = employeeLocations.find((loc: any) => loc.employeeName === emp.employeeName);
          const timeWindows = parseTimeWindowsForRouting(emp.timeWindows);

          return {
            employeeName: emp.employeeName,
            homeLat: location?.homeLat ? Number(location.homeLat) : 55.9533,
            homeLng: location?.homeLng ? Number(location.homeLng) : -3.1883,
            transportMode: location?.transportMode?.toLowerCase().includes('car') ? 'car' : 'walking',
            timeWindows,
            contractedDailyHours: emp.contractedDailyHours,
            visits: [],
            totalTravelTime: 0,
            totalWorkTime: 0,
            utilizationPercent: 0,
          };
        });
    } catch (error) {
      logger.error('Error getting available employees', error);
      return [];
    }
  }

  async function getUnassignedVisitsForDate(branchId: string, date: string) {
    try {
      const visits = await storage.listVisitsBetween(branchId, date, date);
      const results = await getProcessingResults(branchId);
      const clientLocations = results?.clientLocations || [];

      return visits.map((visit: any) => {
        const clientName = visit.clientId || visit.clientName || 'Unknown Client';
        const client = clientLocations.find((c: any) => c.clientName === clientName);

        return {
          id: visit.id || `${clientName}-${date}`,
          clientName,
          startTime: timeStringToMinutes(visit.preferredStartTime || '09:00'),
          endTime: timeStringToMinutes(visit.preferredEndTime || '10:00'),
          durationMinutes: visit.durationMinutes || 60,
          priority: visit.priority || 2,
          serviceType: visit.serviceType || 'Personal Care',
          lat: client?.lat ? Number(client.lat) : undefined,
          lng: client?.lng ? Number(client.lng) : undefined,
        };
      });
    } catch (error) {
      logger.error('Error getting unassigned visits', error);
      return [];
    }
  }

  async function optimizeRoutesForDay(date: string, employees: any[], visits: any[], settings: any) {
    logger.info('Optimizing routes', { date, employeeCount: employees.length, visitCount: visits.length });

    // Simple greedy algorithm - assign visits to minimize total travel time
    const employeeSchedules = employees.map(emp => ({ ...emp, visits: [] }));
    const unassignedVisits = [...visits];

    // Sort visits by priority (1 = highest)
    unassignedVisits.sort((a, b) => a.priority - b.priority);

    for (const visit of visits) {
      if (!visit.lat || !visit.lng) {
        continue; // Skip visits without coordinates
      }

      let bestEmployee = null;
      let bestScore = -1;
      let bestInsertionIndex = 0;

      for (const employee of employeeSchedules) {
        // Check if employee can handle this visit within time windows
        const canFit = employee.timeWindows.some((window: any) => 
          visit.startTime >= window.start && visit.endTime <= window.end
        );

        if (!canFit) continue;

        // Try inserting at different positions
        for (let insertionIndex = 0; insertionIndex <= employee.visits.length; insertionIndex++) {
          const score = calculateInsertionScore(visit, employee, insertionIndex, settings);

          if (score > bestScore) {
            bestScore = score;
            bestEmployee = employee;
            bestInsertionIndex = insertionIndex;
          }
        }
      }

      if (bestEmployee && bestScore > 0) {
        // Calculate travel times
        const travelTimeBefore = calculateTravelTimeBefore(visit, bestEmployee, bestInsertionIndex);
        const travelTimeAfter = calculateTravelTimeAfter(visit, bestEmployee, bestInsertionIndex);

        const assignedVisit = {
          ...visit,
          employeeName: bestEmployee.employeeName,
          actualStartTime: visit.startTime,
          actualEndTime: visit.endTime,
          travelTimeBefore,
          travelTimeAfter,
          score: bestScore,
        };

        bestEmployee.visits.splice(bestInsertionIndex, 0, assignedVisit);
        bestEmployee.totalTravelTime += travelTimeBefore + travelTimeAfter;
        bestEmployee.totalWorkTime += visit.durationMinutes;
        bestEmployee.utilizationPercent = bestEmployee.contractedDailyHours > 0 
          ? Math.round((bestEmployee.totalWorkTime / 60) / bestEmployee.contractedDailyHours * 100)
          : 0;

        // Remove from unassigned
        const index = unassignedVisits.findIndex(v => v.id === visit.id);
        if (index > -1) {
          unassignedVisits.splice(index, 1);
        }
      }
    }

    const totalAssigned = employeeSchedules.reduce((sum, emp) => sum + emp.visits.length, 0);
    const totalTravelTime = employeeSchedules.reduce((sum, emp) => sum + emp.totalTravelTime, 0);
    const avgUtilization = employeeSchedules.length > 0 
      ? Math.round(employeeSchedules.reduce((sum, emp) => sum + emp.utilizationPercent, 0) / employeeSchedules.length)
      : 0;

    // Calculate route efficiency (assigned visits / total possible visits)
    const routeEfficiency = visits.length > 0 ? Math.round((totalAssigned / visits.length) * 100) : 0;

    return {
      date,
      employees: employeeSchedules,
      unassignedVisits,
      metrics: {
        totalAssignedVisits: totalAssigned,
        totalUnassignedVisits: unassignedVisits.length,
        averageUtilization: avgUtilization,
        totalTravelTime,
        routeEfficiency,
      }
    };
  }

  function parseTimeWindowsForRouting(windows: string): Array<{ start: number; end: number }> {
    if (!windows) return [];

    const timeRanges = windows.split(',').map(w => w.trim()).filter(w => w);
    return timeRanges.map(range => {
      const match = range.match(/(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/);
      if (!match) return null;

      const startHour = parseInt(match[1]);
      const startMin = parseInt(match[2]);
      const endHour = parseInt(match[3]);
      const endMin = parseInt(match[4]);

      return {
        start: startHour * 60 + startMin,
        end: endHour * 60 + endMin,
      };
    }).filter((w): w is { start: number; end: number } => w !== null);
  }

  function timeStringToMinutes(timeStr: string): number {
    if (!timeStr) return 0;

    // Handle both "HH:MM" and ISO datetime formats
    let time = timeStr;
    if (timeStr.includes('T')) {
      time = timeStr.split('T')[1].split(':').slice(0, 2).join(':');
    }

    const [hours, minutes] = time.split(':').map(Number);
    return (hours || 0) * 60 + (minutes || 0);
  }

  function calculateInsertionScore(visit: any, employee: any, insertionIndex: number, settings: any): number {
    // Calculate travel time if inserted at this position
    const travelBefore = calculateTravelTimeBefore(visit, employee, insertionIndex);
    const travelAfter = calculateTravelTimeAfter(visit, employee, insertionIndex);
    const totalTravel = travelBefore + travelAfter;

    // Reject if travel exceeds maximum
    if (totalTravel > settings.maxTravelPerVisit) {
      return 0;
    }

    let score = 1.0;

    // Travel time factor (40% weight)
    score *= (1 - totalTravel / (settings.maxTravelPerVisit * 2)) * 0.4;

    // Time window fit factor (30% weight)
    const timeWindowFit = employee.timeWindows.some((window: any) => 
      visit.startTime >= window.start && visit.endTime <= window.end
    ) ? 1 : 0;
    score += timeWindowFit * 0.3;

    // Employee utilization factor (20% weight)
    const currentUtilization = employee.contractedDailyHours > 0 
      ? (employee.totalWorkTime / 60) / employee.contractedDailyHours 
      : 0;
    const utilizationScore = currentUtilization < 0.8 ? 1 : Math.max(0, 1 - (currentUtilization - 0.8) / 0.2);
    score += utilizationScore * 0.2;

    // Priority factor (10% weight)
    score += (4 - visit.priority) / 3 * 0.1;

    return Math.max(0, score);
  }

  function calculateTravelTimeBefore(visit: any, employee: any, insertionIndex: number): number {
    if (insertionIndex === 0) {
      // Travel from home
      return calculateTravelMinutes(
        { lat: employee.homeLat, lng: employee.homeLng },
        { lat: visit.lat, lng: visit.lng },
        employee.transportMode
      );
    } else {
      // Travel from previous visit
      const prevVisit = employee.visits[insertionIndex - 1];
      return calculateTravelMinutes(
        { lat: prevVisit.lat, lng: prevVisit.lng },
        { lat: visit.lat, lng: visit.lng },
        employee.transportMode
      );
    }
  }

  function calculateTravelTimeAfter(visit: any, employee: any, insertionIndex: number): number {
    if (insertionIndex >= employee.visits.length) {
      // Last visit, travel to home
      return calculateTravelMinutes(
        { lat: visit.lat, lng: visit.lng },
        { lat: employee.homeLat, lng: employee.homeLng },
        employee.transportMode
      );
    } else {
      // Travel to next visit
      const nextVisit = employee.visits[insertionIndex];
      return calculateTravelMinutes(
        { lat: visit.lat, lng: visit.lng },
        { lat: nextVisit.lat, lng: nextVisit.lng },
        employee.transportMode
      );
    }
  }

  function calculateTravelMinutes(from: {lat: number, lng: number}, to: {lat: number, lng: number}, mode: string): number {
    // Haversine distance calculation
    const R = 6371; // Earth's radius in kilometers
    const dLat = (to.lat - from.lat) * Math.PI / 180;
    const dLon = (to.lng - from.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(from.lat * Math.PI / 180) * Math.cos(to.lat * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;

    // Apply road factor (1.4 for UK/Scottish winding roads)
    const roadDistance = distance * 1.4;
    
    if (mode === 'walking' || mode === 'public') {
      const baseMins = (roadDistance / 15) * 60 + 15; // 15 km/h + 15 min overhead
      return Math.max(15, Math.round(baseMins));
    }
    
    return Math.max(10, Math.round((roadDistance / 25) * 60)); // car: 25 km/h, min 10 min
  }


  // Weekly schedule generation endpoint
  app.post('/api/weekly-schedule/generate', async (req, res) => {
    try {
      const { weekStartDate } = req.body;
      const branchId = await resolveBranch(req);

      if (!weekStartDate) {
        return res.status(400).json({ message: 'weekStartDate is required' });
      }

      // Get the week boundaries
      const { weekStart, weekEnd } = getCanonicalWeekBoundaries(weekStartDate);

      // Get latest processed data for the branch
      const latestData = await storage.getLatestCapacityAnalysis(branchId);
      if (!latestData) {
        return res.status(404).json({ message: `No processed data available for branch ${branchId}. Please process files first.` });
      }

      // Convert to ProcessingResult format
      const processingResult = {
        kpis: latestData.kpis as any,
        dailySummary: latestData.dailySummary as any,
        employeesByDate: latestData.employeesByDate as any,
        employeeSummaryByDate: latestData.employeeSummaryByDate as any,
        warnings: latestData.warnings as string[] | undefined,
        employeeLocations: await storage.getAllEmployeeLocations(branchId).then(locs => locs.map(loc => ({
          employeeName: loc.employeeName,
          homePostcode: loc.homePostcode,
          homeLat: loc.homeLat ? Number(loc.homeLat) : undefined,
          homeLng: loc.homeLng ? Number(loc.homeLng) : undefined,
          transportMode: loc.transportMode || undefined,
        }))),
        clientLocations: await storage.getAllClientLocations(branchId).then(locs => locs.map(loc => ({
          clientName: loc.clientName,
          addressLine: loc.addressLine,
          postcode: loc.postcode,
          lat: loc.lat ? Number(loc.lat) : undefined,
          lng: loc.lng ? Number(loc.lng) : undefined,
        }))),
      };

      // Generate weekly schedule using the same algorithm as manual scheduling
      // For now, return empty schedule structure that the frontend will populate
      const scheduleData = {
        employees: [],
        weekDates: [],
      };

      const metrics = {
        totalVisitsAssigned: 0,
        totalVisitsUnallocated: 0,
        averageTravelTimePerVisit: 0,
        employeesUtilized: 0,
      };

      // Save to database
      const savedSchedule = await storage.saveWeeklySchedule({
        branchId,
        weekStartDate: weekStart,
        weekEndDate: weekEnd,
        scheduleData,
        unallocatedVisits: [],
        metrics,
      });

      res.json(savedSchedule);
    } catch (error) {
      logger.error('Error generating weekly schedule', error);
      res.status(500).json({ 
        message: 'Failed to generate weekly schedule',
        error: safeErrorMessage(error, 'Unknown error')
      });
    }
  });

  // Get all employee and client locations for scheduling
  app.get('/api/locations', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const [employees, clients] = await Promise.all([
        storage.getAllEmployeeLocations(branchId),
        storage.getAllClientLocations(branchId)
      ]);

      res.json({
        employees,
        clients
      });
    } catch (error) {
      logger.error('Error fetching locations', error);
      const message = safeErrorMessage(error, 'Failed to fetch location data');
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ 
        error: message,
        details: safeErrorMessage(error, 'An error occurred')
      });
    }
  });

  // Get latest weekly schedule
  app.get('/api/weekly-schedule/latest', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const latestSchedule = await storage.getLatestWeeklySchedule(branchId);

      if (!latestSchedule) {
        return res.status(404).json({ message: 'No weekly schedules found' });
      }

      res.json(latestSchedule);
    } catch (error) {
      logger.error('Error fetching latest weekly schedule', error);
      const message = safeErrorMessage(error, 'Failed to fetch weekly schedule');
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ 
        message,
        error: safeErrorMessage(error, 'Unknown error')
      });
    }
  });

  // Get weekly schedule by week
  app.get('/api/weekly-schedule/:weekStartDate', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const { weekStartDate } = req.params;
      const { weekStart, weekEnd } = getCanonicalWeekBoundaries(weekStartDate);

      const schedule = await storage.getWeeklyScheduleByWeek(branchId, weekStart, weekEnd);

      if (!schedule) {
        return res.status(404).json({ message: 'Schedule not found for this week' });
      }

      res.json(schedule);
    } catch (error) {
      logger.error('Error fetching weekly schedule', error);
      const message = safeErrorMessage(error, 'Failed to fetch weekly schedule');
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ 
        message,
        error: safeErrorMessage(error, 'Unknown error')
      });
    }
  });

  // Save/update weekly schedule
  app.post('/api/weekly-schedule/save', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const { weekStartDate, weekEndDate, scheduleData, unallocatedVisits, metrics } = req.body;

      if (!weekStartDate || !weekEndDate || !scheduleData || !metrics) {
        return res.status(400).json({ message: 'Missing required fields' });
      }

      const savedSchedule = await storage.saveWeeklySchedule({
        branchId,
        weekStartDate,
        weekEndDate,
        scheduleData,
        unallocatedVisits: unallocatedVisits || [],
        metrics,
      });

      res.json(savedSchedule);
    } catch (error) {
      logger.error('Error saving weekly schedule', error);
      const message = safeErrorMessage(error, 'Failed to save weekly schedule');
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ 
        message,
        error: safeErrorMessage(error, 'Unknown error')
      });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}

// Haversine distance formula
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}