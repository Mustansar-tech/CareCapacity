import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { parseExcelFiles, processCapacityData, generateExcelExport } from './pipeline';
import { storage } from "./storage";
import { getCanonicalWeekBoundaries, type ProcessingResult } from "@shared/schema";
import { PeoplePlannerAutomation, formatDateForPP, getAvailableBranches, type PPCredentials, type PPExportConfig } from './pp-automation';

/**
 * Resolves branchId from request query (GET) or body (POST/PUT/DELETE)
 * Validates that the branch exists in the database
 * Provides backward compatibility via DEFAULT_BRANCH_ID env var
 */
async function resolveBranch(req: Request): Promise<string> {
  // Extract branchId from query (GET) or body (POST/PUT/DELETE)
  const branchId = req.query.branchId as string || req.body?.branchId as string;

  // Fallback to default branch if configured (for backward compatibility during transition)
  const defaultBranchId = process.env.DEFAULT_BRANCH_ID;
  const resolvedBranchId = branchId || defaultBranchId;

  if (!resolvedBranchId) {
    throw new Error('branchId is required. Provide it as a query parameter (GET) or in request body (POST/PUT/DELETE)');
  }

  // Validate branch exists
  const branch = await storage.getBranchById(resolvedBranchId);
  if (!branch) {
    throw new Error(`Branch with ID '${resolvedBranchId}' not found`);
  }

  // Log for metrics (to identify legacy callers using fallback)
  if (!branchId && defaultBranchId) {
    console.log(`⚠️  Request to ${req.method} ${req.path} using DEFAULT_BRANCH_ID fallback: ${defaultBranchId}`);
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
    console.log(`📂 File upload attempt: "${file.originalname}" with MIME type: "${file.mimetype}"`);

    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        file.mimetype === 'application/vnd.ms-excel' ||
        file.originalname.toLowerCase().endsWith('.xlsx') ||
        file.originalname.toLowerCase().endsWith('.xls')) {
      console.log(`✅ File accepted: "${file.originalname}"`);
      cb(null, true);
    } else {
      console.log(`❌ File rejected: "${file.originalname}" - MIME: "${file.mimetype}"`);
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
  console.log(`📦 STORING GH buffer for branch ${branchId}: ${buffer.length} bytes`);
  console.log(`📦 Current branches in map BEFORE set: ${Array.from(guaranteedBufferByBranch.keys()).join(', ')}`);
  guaranteedBufferByBranch.set(branchId, buffer);
  console.log(`📦 Current branches in map AFTER set: ${Array.from(guaranteedBufferByBranch.keys()).join(', ')}`);
  console.log(`📦 Verification - can retrieve?: ${guaranteedBufferByBranch.has(branchId)}`);
}

// Getter function for guaranteedBufferByBranch (checks in-memory cache + database fallback)
export async function getLatestGuaranteedBuffer(branchId: string): Promise<Buffer | null> {
  console.log(`📦 RETRIEVING GH buffer for branch ${branchId}`);
  console.log(`📦 Available branches in map: ${Array.from(guaranteedBufferByBranch.keys()).join(', ')}`);

  // Check in-memory cache first
  let buffer = guaranteedBufferByBranch.get(branchId) || null;

  if (!buffer) {
    // Fallback to database
    console.log(`📦 Not in memory - checking database...`);
    try {
      const upload = await storage.getLatestBranchUpload(branchId, 'guaranteedHours');
      if (upload) {
        buffer = Buffer.from(upload.fileBuffer, 'base64');
        // Hydrate the cache
        guaranteedBufferByBranch.set(branchId, buffer);
        console.log(`📦 Retrieved from database and cached (${buffer.length} bytes)`);
      }
    } catch (dbError) {
      console.error(`❌ Failed to retrieve GH buffer from database:`, dbError);
    }
  }

  console.log(`📦 Final result: ${buffer ? `${buffer.length} bytes` : 'NULL'}`);
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
    const { checkDatabaseHealth } = await import('./db');
    const dbHealthy = await checkDatabaseHealth();
    
    const health = {
      status: dbHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: dbHealthy ? 'connected' : 'disconnected',
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
      }
    };

    const statusCode = dbHealthy ? 200 : 503;
    res.status(statusCode).json(health);
  });

  // GET /api/branches - Get all available branches
  app.get('/api/branches', async (_req, res) => {
    try {
      const branches = await storage.getAllBranches();
      res.json(branches);
    } catch (error) {
      console.error('Error fetching branches:', error);
      res.status(500).json({ 
        message: 'Failed to fetch branches',
        error: error instanceof Error ? error.message : 'Unknown error'
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
      console.log(`🚀 ===== NEW FILE UPLOAD REQUEST RECEIVED =====`);
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const requestedBranchId = req.body.branchId; // Branch ID from frontend

      console.log(`📋 Files received:`, files ? Object.keys(files) : 'No files');
      console.log(`🏢 Requested branch ID:`, requestedBranchId || 'NONE');

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

      console.log(`✅ Branch validated: ${branch.displayName} (${branch.name})`);

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

      console.log(`📁 File name validation:`);
      console.log(`  Availability: "${availabilityFile.originalname}" -> "${normalizedAvailabilityName}"`);
      console.log(`  Guaranteed: "${guaranteedFile.originalname}" -> "${normalizedGuaranteedName}"`);
      console.log(`  CG Data: "${cgDataFile.originalname}" -> "${normalizedCgDataName}"`);
      console.log(`  Expected: ${JSON.stringify(expectedNames)}`);

      if (normalizedAvailabilityName !== expectedNames.availability ||
          normalizedGuaranteedName !== expectedNames.guaranteed ||
          normalizedCgDataName !== expectedNames.cgData) {
        console.log(`❌ FILE VALIDATION FAILED:`);
        console.log(`  Availability check: ${normalizedAvailabilityName} === ${expectedNames.availability} ? ${normalizedAvailabilityName === expectedNames.availability}`);
        console.log(`  CG Data check: ${normalizedCgDataName} === ${expectedNames.cgData} ? ${normalizedCgDataName === expectedNames.cgData}`);
        console.log(`  Guaranteed check: ${normalizedGuaranteedName} === ${expectedNames.guaranteed} ? ${normalizedGuaranteedName === expectedNames.guaranteed}`);
        return res.status(400).json({
          message: `File names must be: "${expectedNames.availability}", "${expectedNames.guaranteed}", "${expectedNames.cgData}" (browser download numbers like (2) are allowed)`
        });
      }

      console.log(`✅ FILE VALIDATION PASSED - Proceeding to parsing...`);

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
        console.log(`⚠️  No branch detected in Excel files - proceeding with selected branch: ${branch.displayName}`);
      }

      console.log(`✅ Branch validation complete - processing data for: ${branch.displayName}`);

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
      console.log(`✅ Stored Guaranteed Hours buffer in memory (${guaranteedFile.buffer.length} bytes) for branch ${requestedBranchId}`);

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
        console.log(`✅ Persisted Guaranteed Hours buffer to database for branch ${requestedBranchId}`);
      } catch (dbError) {
        console.error('⚠️  Failed to persist GH buffer to database:', dbError);
        // Don't fail the request if database persistence fails - in-memory cache still works
      }

      // Save Excel file to disk
      const exportPath = path.join(process.cwd(), 'capacity_dashboard.xlsx');
      fs.writeFileSync(exportPath, exportBuffer);

      // Clear old visits data before processing new data
      console.log(`🧹 Clearing old visits data for branch ${branch.displayName}...`);
      await storage.clearAllVisits(requestedBranchId);

      // Persist processed data to database with derived week boundaries
      try {
        if (result.dailySummary && result.dailySummary.length > 0) {
          // Get week boundaries from the first date in daily summary
          const firstDate = result.dailySummary[0].date;
          const { weekStart, weekEnd } = getCanonicalWeekBoundaries(firstDate);

          console.log(`💾 Persisting analysis for week: ${weekStart} to ${weekEnd} (Branch: ${branch.displayName})`);

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

          console.log(`✅ Analysis persisted successfully for week ${weekStart} (Branch: ${branch.name})`);
        } else {
          console.log(`⚠️  No daily summary data to persist`);
        }
      } catch (persistError) {
        console.error('⚠️  Failed to persist analysis to database:', persistError);
        // Don't fail the request if persistence fails
      }

      console.log(`✅ PIPELINE COMPLETE for branch ${requestedBranchId}`);
      console.log(`   - Client locations should now be geocoded and stored`);
      console.log(`   - Employee locations should now be geocoded and stored`);
      console.log(`   - Visits data is ready for scheduling tab`);

      res.json(result);

    } catch (error) {
      console.error('Processing error:', error);
      console.error('Error type:', (error as any)?.constructor?.name);
      console.error('Error message:', (error as any)?.message);
      console.error('Error stack:', (error as any)?.stack);

      if (error && typeof error === 'object') {
        console.error('Error details:', JSON.stringify(error, null, 2));
      }

      res.status(500).json({
        message: error instanceof Error ? error.message : 'Internal processing error'
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
      console.error('Export error:', error);
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
      console.log(`📋 Extracting client visits from Guaranteed Hours Excel for ${date} (Branch: ${branchId})`);

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
      console.error("Error extracting visits:", error);
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
      console.log(`📅 Fetching visits for branch ${branchId} from ${startDate} to ${endDate}`);

      const visits = await storage.listVisitsBetween(
        branchId,
        String(startDate),
        String(endDate)
      );

      console.log(`✅ Found ${visits.length} visits for the date range`);
      res.json(visits);
    } catch (error) {
      console.error('Error fetching visits:', error);
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

      console.log(`📅 Generating schedule for ${date} (branch: ${branchId})`);

      const { autoScheduler } = await import("./auto-scheduler");
      const schedule = await autoScheduler.scheduleDay(date, branchId); // Pass branchId

      res.json(schedule);
    } catch (error) {
      console.error("Error auto-scheduling day:", error);
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

      console.log(`📅 Generating schedule for week starting ${startDate} (branch: ${branchId})`);

      const { autoScheduler } = await import("./auto-scheduler");
      const weekSchedule = await autoScheduler.scheduleWeek(startDate, branchId); // Pass branchId

      res.json(weekSchedule);
    } catch (error) {
      console.error("Error auto-scheduling week:", error);
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
      console.error("Error getting weekly schedule:", error);
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

      console.log(`🤖 Starting run optimization for ${date} (branch: ${branchId})`);
      const { autoScheduler } = await import("./auto-scheduler");
      const result = await autoScheduler.scheduleDay(date, branchId); // Pass branchId

      res.json(result);
    } catch (error) {
      console.error('Run optimization error:', error);
      res.status(500).json({ 
        error: 'Run optimization failed',
        details: error instanceof Error ? error.message : 'Unknown error'
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

      console.log(`🚗 Starting route optimization for ${date} (Branch: ${branchId})`);

      // Get available employees for the date
      const employees = await getAvailableEmployeesForDate(branchId, date);
      console.log(`👥 Found ${employees.length} available employees`);

      // Get unassigned visits for the date  
      const visits = await getUnassignedVisitsForDate(branchId, date);
      console.log(`📋 Found ${visits.length} visits to schedule`);

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
      console.error('Auto-scheduling error:', error);
      res.status(500).json({ 
        error: 'Auto-scheduling failed',
        details: error instanceof Error ? error.message : 'Unknown error'
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
      console.error('History fetch error:', error);
      const message = error instanceof Error ? error.message : 'Failed to fetch historical data';
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
      console.error('Latest history fetch error:', error);
      const message = error instanceof Error ? error.message : 'Failed to fetch latest data';
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
      console.error('Date range fetch error:', error);
      const message = error instanceof Error ? error.message : 'Failed to fetch data for date range';
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
      console.error('Cleanup error:', error);
      const message = error instanceof Error ? error.message : 'Failed to cleanup old data';
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
      console.error('Cleanup preview error:', error);
      const message = error instanceof Error ? error.message : 'Failed to preview cleanup';
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
        console.warn(`⚠️ geocode-batch called without branchId - cache lookups may not work correctly`);
      }

      // OPTIMIZATION: Process unique postcodes in parallel for 70-80% faster geocoding
      const uniquePostcodes = Array.from(new Set(postcodes as string[]));
      console.log(`🚀 Parallel geocoding ${uniquePostcodes.length} unique postcodes (from ${postcodes.length} total) for branch ${branchId || 'UNKNOWN'}...`);

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

      console.log(`📊 Cache stats: ${cachedResults.length} cached, ${uncachedPostcodes.length} need geocoding`);

      // Process all uncached postcodes in parallel using Promise.all
      const postcodePromises = uncachedPostcodes.map(async (postcode) => {
        try {
          console.log(`🔍 Geocoding postcode: "${postcode}"`);
          const geocodeResult = await geocodeWithFallback(postcode, storage, branchId);
          if (geocodeResult && geocodeResult.lat && geocodeResult.lng) {
            console.log(`✅ Geocoded "${postcode}" -> ${geocodeResult.lat}, ${geocodeResult.lng}`);
            return {
              ...geocodeResult,
              input: postcode,
              postcode: postcode,
              success: true,
              lat: Number(geocodeResult.lat),
              lng: Number(geocodeResult.lng)
            };
          } else {
            console.log(`❌ Failed to geocode "${postcode}" - no coordinates`);
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
          console.log(`❌ Error geocoding "${postcode}":`, error);
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
      console.error('Geocoding error:', error);
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
      console.error('Distance matrix error:', error);
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
      console.error('Route optimization error:', error);
      const message = error instanceof Error ? error.message : 'Route optimization failed';
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
      console.error('Get route plans error:', error);
      const message = error instanceof Error ? error.message : 'Failed to get route plans';
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
      console.error('Get employee locations error:', error);
      const message = error instanceof Error ? error.message : 'Failed to get employee locations';
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
      console.error('Get client locations error:', error);
      const message = error instanceof Error ? error.message : 'Failed to get client locations';
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message });
    }
  });



  // POST /api/cleanup/routes-visits - Clean up routes and visits data
  app.post('/api/cleanup/routes-visits', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      console.log(`🧹 Starting cleanup of routes and visits data for branch ${branchId}...`);

      const result = await storage.clearRoutesAndVisits(branchId);

      console.log(`✅ Cleanup complete: ${result.routePlansDeleted} route plans, ${result.routeStopsDeleted} route stops, ${result.visitsDeleted} visits deleted`);

      res.json({
        message: 'Routes and visits data cleaned successfully',
        deletedCounts: result
      });

    } catch (error) {
      console.error('Cleanup error:', error);
      const message = error instanceof Error ? error.message : 'Failed to cleanup routes and visits data';
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ 
        message, 
        details: error instanceof Error ? error.message : 'Unknown error' 
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
      console.error('Error getting processing results:', error);
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
      console.error('Error getting available employees:', error);
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
      console.error('Error getting unassigned visits:', error);
      return [];
    }
  }

  async function optimizeRoutesForDay(date: string, employees: any[], visits: any[], settings: any) {
    console.log(`🔄 Optimizing routes for ${date} with ${employees.length} employees and ${visits.length} visits`);

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

    // Convert to travel time based on mode
    const speeds = {
      car: 40,      // km/h
      walking: 4.5, // km/h
    };

    const speed = speeds[mode as keyof typeof speeds] || speeds.car;
    return Math.max(1, Math.round((distance / speed) * 60));
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
      console.error('Error generating weekly schedule:', error);
      res.status(500).json({ 
        message: 'Failed to generate weekly schedule',
        error: error instanceof Error ? error.message : 'Unknown error'
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
      console.error('Error fetching locations:', error);
      const message = error instanceof Error ? error.message : 'Failed to fetch location data';
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ 
        error: message,
        details: error instanceof Error ? error.message : 'Unknown error'
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
      console.error('Error fetching latest weekly schedule:', error);
      const message = error instanceof Error ? error.message : 'Failed to fetch weekly schedule';
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ 
        message,
        error: error instanceof Error ? error.message : 'Unknown error'
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
      console.error('Error fetching weekly schedule:', error);
      const message = error instanceof Error ? error.message : 'Failed to fetch weekly schedule';
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ 
        message,
        error: error instanceof Error ? error.message : 'Unknown error'
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
      console.error('Error saving weekly schedule:', error);
      const message = error instanceof Error ? error.message : 'Failed to save weekly schedule';
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ 
        message,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // ============================================
  // People Planner Automation Endpoints
  // ============================================

  // Get available branches for PP automation
  app.get('/api/pp-automation/branches', (_req, res) => {
    try {
      const branches = getAvailableBranches();
      res.json(branches);
    } catch (error) {
      console.error('Error getting PP branches:', error);
      res.status(500).json({ message: 'Failed to get branches' });
    }
  });

  // Run PP automation to download exports
  app.post('/api/pp-automation/export', async (req, res) => {
    try {
      const { branchName, weekStartDate, weekEndDate } = req.body;

      if (!branchName || !weekStartDate || !weekEndDate) {
        return res.status(400).json({ 
          message: 'Missing required fields: branchName, weekStartDate, weekEndDate' 
        });
      }

      // Get credentials from environment/secrets
      const credentials: PPCredentials = {
        clientId: process.env.PP_CLIENT_ID || '',
        username: process.env.PP_USERNAME || '',
        password: process.env.PP_PASSWORD || '',
      };

      if (!credentials.clientId || !credentials.username || !credentials.password) {
        return res.status(400).json({ 
          message: 'People Planner credentials not configured. Please set PP_CLIENT_ID, PP_USERNAME, and PP_PASSWORD.' 
        });
      }

      // Format dates for People Planner (DD/MM/YYYY)
      const config: PPExportConfig = {
        branchName,
        startDate: formatDateForPP(weekStartDate),
        endDate: formatDateForPP(weekEndDate),
      };

      console.log(`🤖 Starting PP automation for ${branchName} (${config.startDate} - ${config.endDate})`);

      const automation = new PeoplePlannerAutomation();
      const result = await automation.runFullExport(credentials, config);

      if (result.success) {
        console.log('✅ PP automation completed successfully');
        res.json({
          success: true,
          message: 'Exports downloaded successfully',
          files: result.files,
        });
      } else {
        console.log('⚠️ PP automation completed with errors:', result.errors);
        res.status(500).json({
          success: false,
          message: 'Some exports failed',
          files: result.files,
          errors: result.errors,
        });
      }
    } catch (error) {
      console.error('❌ PP automation error:', error);
      res.status(500).json({ 
        message: 'Automation failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get automation status/history
  app.get('/api/pp-automation/status', async (req, res) => {
    try {
      const branchId = req.query.branchId as string;
      
      // Check if we have recent downloads for this branch
      const downloadDir = path.join(process.cwd(), 'downloads', 'pp-exports');
      
      if (!fs.existsSync(downloadDir)) {
        return res.json({ 
          hasRecentDownloads: false,
          files: [] 
        });
      }

      const files = fs.readdirSync(downloadDir)
        .filter(f => f.endsWith('.xlsx'))
        .map(f => {
          const stats = fs.statSync(path.join(downloadDir, f));
          return {
            id: Buffer.from(f).toString('base64'), // Safe file identifier
            name: f,
            size: stats.size,
            downloadedAt: stats.mtime.toISOString(),
            exportType: f.includes('Visits') ? 'visits' : f.includes('Caregivers') ? 'caregivers' : f.includes('Availability') ? 'availability' : 'unknown',
          };
        })
        .sort((a, b) => new Date(b.downloadedAt).getTime() - new Date(a.downloadedAt).getTime());

      res.json({
        hasRecentDownloads: files.length > 0,
        files: files.slice(0, 10), // Return last 10 files
      });
    } catch (error) {
      console.error('Error getting PP automation status:', error);
      res.status(500).json({ message: 'Failed to get automation status' });
    }
  });

  // Process downloaded PP files into the dashboard pipeline
  app.post('/api/pp-automation/process', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const { visitsFileId, caregiversFileId, availabilityFileId } = req.body;

      if (!visitsFileId || !caregiversFileId || !availabilityFileId) {
        return res.status(400).json({ 
          message: 'Missing required file IDs: visitsFileId, caregiversFileId, availabilityFileId' 
        });
      }

      // Decode file IDs to filenames (base64 encoded)
      const downloadDir = path.join(process.cwd(), 'downloads', 'pp-exports');
      
      const visitsFileName = Buffer.from(visitsFileId, 'base64').toString();
      const caregiversFileName = Buffer.from(caregiversFileId, 'base64').toString();
      const availabilityFileName = Buffer.from(availabilityFileId, 'base64').toString();

      // Validate filenames are safe (no path traversal)
      const isValidFileName = (name: string) => {
        return name.endsWith('.xlsx') && !name.includes('/') && !name.includes('\\') && !name.includes('..');
      };

      if (!isValidFileName(visitsFileName) || !isValidFileName(caregiversFileName) || !isValidFileName(availabilityFileName)) {
        return res.status(400).json({ message: 'Invalid file identifiers' });
      }

      // Build safe paths within downloads directory
      const visitsPath = path.join(downloadDir, visitsFileName);
      const caregiversPath = path.join(downloadDir, caregiversFileName);
      const availabilityPath = path.join(downloadDir, availabilityFileName);

      // Verify files exist
      if (!fs.existsSync(visitsPath) || !fs.existsSync(caregiversPath) || !fs.existsSync(availabilityPath)) {
        return res.status(400).json({ message: 'One or more files not found in downloads' });
      }

      // Read the downloaded files
      const availabilityBuffer = fs.readFileSync(availabilityPath);
      const guaranteedBuffer = fs.readFileSync(visitsPath);
      const cgDataBuffer = fs.readFileSync(caregiversPath);

      console.log(`📂 Processing PP automation files for branch ${branchId}`);

      // Process through the existing pipeline
      const parseResult = await parseExcelFiles(
        availabilityBuffer,
        guaranteedBuffer,
        cgDataBuffer,
        guaranteedBuffer, // ghWorkbookBuffer
        branchId
      );

      // Store the guaranteed buffer for later scheduling use
      setLatestGuaranteedBuffer(branchId, guaranteedBuffer);

      // Store files in database for persistence
      const crypto = await import('crypto');
      
      await storage.saveBranchUpload({
        branchId,
        uploadType: 'availability',
        fileBuffer: availabilityBuffer.toString('base64'),
        originalFileName: path.basename(availabilityPath),
        fileSize: availabilityBuffer.length,
        sha256: crypto.createHash('sha256').update(availabilityBuffer).digest('hex'),
      });

      await storage.saveBranchUpload({
        branchId,
        uploadType: 'guaranteedHours',
        fileBuffer: guaranteedBuffer.toString('base64'),
        originalFileName: path.basename(visitsPath),
        fileSize: guaranteedBuffer.length,
        sha256: crypto.createHash('sha256').update(guaranteedBuffer).digest('hex'),
      });

      await storage.saveBranchUpload({
        branchId,
        uploadType: 'cgData',
        fileBuffer: cgDataBuffer.toString('base64'),
        originalFileName: path.basename(caregiversPath),
        fileSize: cgDataBuffer.length,
        sha256: crypto.createHash('sha256').update(cgDataBuffer).digest('hex'),
      });

      // Process capacity data
      const result = await processCapacityData(
        parseResult.availability,
        parseResult.guaranteed,
        parseResult.demand,
        parseResult.cgData,
        { ghWorkbookBuffer: guaranteedBuffer, branchId }
      );

      // Get week boundaries from the first date in daily summary
      const firstDate = result.dailySummary[0]?.date;
      const { weekStart, weekEnd } = getCanonicalWeekBoundaries(firstDate);

      // Save to history
      await storage.saveCapacityAnalysis({
        branchId,
        weekStartDate: weekStart,
        weekEndDate: weekEnd,
        kpis: result.kpis,
        dailySummary: result.dailySummary,
        employeesByDate: result.employeesByDate,
        employeeSummaryByDate: result.employeeSummaryByDate || {},
        warnings: result.warnings || [],
      });

      console.log(`✅ PP automation files processed successfully for branch ${branchId}`);

      res.json({
        success: true,
        message: 'Files processed successfully',
        result,
      });
    } catch (error) {
      console.error('❌ Error processing PP automation files:', error);
      res.status(500).json({ 
        message: 'Failed to process files',
        error: error instanceof Error ? error.message : 'Unknown error'
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