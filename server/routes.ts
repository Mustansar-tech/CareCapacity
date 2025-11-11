import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { parseExcelFiles, processCapacityData, generateExcelExport } from './pipeline';
import { storage } from "./storage";
import { getCanonicalWeekBoundaries, type ProcessingResult } from "@shared/schema";

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
  guaranteedBufferByBranch.set(branchId, buffer);
}

// Getter function for guaranteedBufferByBranch
export function getLatestGuaranteedBuffer(branchId: string): Buffer | null {
  return guaranteedBufferByBranch.get(branchId) || null;
}

// Helper function to normalize file names by removing browser download numbers
function normalizeFileName(fileName: string): string {
  // Remove numbers in parentheses that browsers add for duplicate downloads
  // e.g. "Hours by Service Type (1).xlsx" -> "Hours by Service Type.xlsx"
  return fileName.replace(/\s*\(\d+\)/g, '');
}

// Enhanced geocoding with fallback hierarchy
async function geocodeWithFallback(postcode: string, storage: any): Promise<any> {
  const normalizedPostcode = postcode.trim().toUpperCase();

  // Step 1: Try exact postcode from cache
  const cached = await storage.getGeocode(`postcode:${normalizedPostcode}`);
  if (cached) {
    return {
      query: normalizedPostcode,
      type: 'postcode',
      lat: cached.lat,
      lng: cached.lng,
    };
  }

  // Step 2: Try postcodes.io API
  try {
    const response = await fetch(`https://api.postcodes.io/postcodes/${normalizedPostcode}`);
    if (response.ok) {
      const data = await response.json();
      if (data.result) {
        const result = {
          query: normalizedPostcode,
          type: 'postcode',
          lat: data.result.latitude,
          lng: data.result.longitude,
        };

        // Cache the result
        await storage.saveGeocode({
          key: `postcode:${normalizedPostcode}`,
          lat: result.lat,
          lng: result.lng,
          source: 'postcodes.io'
        });

        return result;
      }
    }
  } catch (error) {
    console.log(`geocodeWithFallback: postcodes.io failed for ${normalizedPostcode}:`, error);
  }

  return null;
}

export async function registerRoutes(app: Express): Promise<Server> {

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
    { name: 'demand', maxCount: 1 },
    { name: 'cgData', maxCount: 1 }
  ]), async (req, res) => {
    try {
      console.log(`🚀 ===== NEW FILE UPLOAD REQUEST RECEIVED =====`);
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const requestedBranchId = req.body.branchId; // Branch ID from frontend

      console.log(`📋 Files received:`, files ? Object.keys(files) : 'No files');
      console.log(`🏢 Requested branch ID:`, requestedBranchId || 'NONE');

      // Validate that all four files are present
      if (!files.availability || !files.guaranteed || !files.demand || !files.cgData) {
        return res.status(400).json({
          message: 'Missing required files. Please upload availability, guaranteed, demand, and CG Data Export files.'
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
      const demandFile = files.demand[0];
      const cgDataFile = files.cgData[0];

      // Validate file names (allowing for browser download numbers like (2), (3))
      const expectedNames = {
        availability: 'Availability Export.xlsx',
        guaranteed: 'Care Pro Guaranteed Hours.xlsx', 
        demand: 'Hours by Service Type.xlsx',
        cgData: 'CG Data Export.xlsx'
      };

      const normalizedAvailabilityName = normalizeFileName(availabilityFile.originalname);
      const normalizedGuaranteedName = normalizeFileName(guaranteedFile.originalname);
      const normalizedDemandName = normalizeFileName(demandFile.originalname);
      const normalizedCgDataName = normalizeFileName(cgDataFile.originalname);

      console.log(`📁 File name validation:`);
      console.log(`  Availability: "${availabilityFile.originalname}" -> "${normalizedAvailabilityName}"`);
      console.log(`  Guaranteed: "${guaranteedFile.originalname}" -> "${normalizedGuaranteedName}"`);
      console.log(`  Demand: "${demandFile.originalname}" -> "${normalizedDemandName}"`);
      console.log(`  CG Data: "${cgDataFile.originalname}" -> "${normalizedCgDataName}"`);
      console.log(`  Expected: ${JSON.stringify(expectedNames)}`);

      if (normalizedAvailabilityName !== expectedNames.availability ||
          normalizedGuaranteedName !== expectedNames.guaranteed ||
          normalizedDemandName !== expectedNames.demand ||
          normalizedCgDataName !== expectedNames.cgData) {
        console.log(`❌ FILE VALIDATION FAILED:`);
        console.log(`  Availability check: ${normalizedAvailabilityName} === ${expectedNames.availability} ? ${normalizedAvailabilityName === expectedNames.availability}`);
        console.log(`  CG Data check: ${normalizedCgDataName} === ${expectedNames.cgData} ? ${normalizedCgDataName === expectedNames.cgData}`);
        console.log(`  Guaranteed check: ${normalizedGuaranteedName} === ${expectedNames.guaranteed} ? ${normalizedGuaranteedName === expectedNames.guaranteed}`);
        console.log(`  Demand check: ${normalizedDemandName} === ${expectedNames.demand} ? ${normalizedDemandName === expectedNames.demand}`);
        return res.status(400).json({
          message: `File names must be: "${expectedNames.availability}", "${expectedNames.guaranteed}", "${expectedNames.demand}", "${expectedNames.cgData}" (browser download numbers like (2) are allowed)`
        });
      }

      console.log(`✅ FILE VALIDATION PASSED - Proceeding to parsing...`);

      // Parse Excel files including CG Data Export
      const parsedData = await parseExcelFiles(
        availabilityFile.buffer,
        guaranteedFile.buffer,
        demandFile.buffer,
        cgDataFile.buffer
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

      // Store Guaranteed Hours buffer per branch for visit extraction
      setLatestGuaranteedBuffer(requestedBranchId, guaranteedFile.buffer);
      console.log(`✅ Stored Guaranteed Hours buffer (${guaranteedFile.buffer.length} bytes) for branch ${requestedBranchId}`);

      // Save Excel file to disk
      const exportPath = path.join(process.cwd(), 'capacity_dashboard.xlsx');
      fs.writeFileSync(exportPath, exportBuffer);

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

      console.log(`✅ Data processing complete - scheduling tab will show new visits on next load`);

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

      const guaranteedBuffer = getLatestGuaranteedBuffer(branchId);
      if (!guaranteedBuffer) {
        return res.status(404).json({ error: "No processed data available for this branch. Please process files first." });
      }

      // Dynamically import the function to avoid circular dependencies or unnecessary loads
      const { extractClientVisitsFromGHExcel } = await import('./excel-visit-extractor');
      const parsedDate = new Date(date + 'T00:00:00.000Z'); // Parse as UTC
      const visits = extractClientVisitsFromGHExcel(guaranteedBuffer, parsedDate);
      res.json(visits);
    } catch (error) {
      console.error("Error extracting visits:", error);
      res.status(500).json({ error: "Failed to extract visits" });
    }
  });

  // Get visits between dates
  app.get('/api/visits', async (req, res) => {
    const { startDate, endDate } = req.query;
    const branchId = req.headers['x-branch-id'] as string | undefined;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Start date and end date are required' });
    }

    try {
      console.log(`📅 Fetching visits for branch ${branchId || 'default'} from ${startDate} to ${endDate}`);

      const visits = await storage.listVisitsBetween(
        String(startDate),
        String(endDate),
        branchId
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

  // Enhanced geocoding with fallback hierarchy
  async function geocodeWithFallback(postcode: string, storage: any): Promise<any> {
    const normalizedPostcode = postcode.trim().toUpperCase();

    // Step 1: Try exact postcode from cache
    const cached = await storage.getGeocode(`postcode:${normalizedPostcode}`);
    if (cached) {
      return {
        query: normalizedPostcode,
        type: 'postcode',
        lat: cached.lat,
        lng: cached.lng,
        source: 'cache',
        approximate: false
      };
    }

    // Step 2: Try exact postcode from API
    try {
      const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(normalizedPostcode)}`);
      if (response.ok) {
        const data = await response.json();
        if (data.status === 200 && data.result) {
          const lat = data.result.latitude.toString();
          const lng = data.result.longitude.toString();

          // Cache the exact result
          await storage.saveGeocode({
            key: `postcode:${normalizedPostcode}`,
            lat,
            lng,
            source: 'postcodes.io'
          });

          return {
            query: normalizedPostcode,
            type: 'postcode',
            lat,
            lng,
            source: 'postcodes.io',
            approximate: false
          };
        }
      }
    } catch (err) {
      console.log(`🔄 Exact postcode geocoding failed for ${normalizedPostcode}, trying fallback...`);
    }

    // Step 3: Try postcode district (first part)
    const parts = normalizedPostcode.split(' ');
    if (parts.length >= 2) {
      const district = parts[0];

      // Check cache for district
      const districtCached = await storage.getGeocode(`district:${district}`);
      if (districtCached) {
        return {
          query: normalizedPostcode,
          type: 'postcode',
          lat: districtCached.lat,
          lng: districtCached.lng,
          source: 'cache-district',
          approximate: true
        };
      }

      // Try district from API
      try {
        const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(district)}`);
        if (response.ok) {
          const data = await response.json();
          if (data.status === 200 && data.result) {
            const lat = data.result.latitude.toString();
            const lng = data.result.longitude.toString();

            // Cache the district result
            await storage.saveGeocode({
              key: `district:${district}`,
              lat,
              lng,
              source: 'postcodes.io'
            });

            return {
              query: normalizedPostcode,
              type: 'postcode',
              lat,
              lng,
              source: 'postcodes.io-district',
              approximate: true
            };
          }
        }
      } catch (err) {
        console.log(`🔄 District geocoding failed for ${district}, trying area fallback...`);
      }
    }

    // Step 4: Default to approximate city center based on postcode prefix
    const prefix = normalizedPostcode.substring(0, 2);
    const fallbackLocations: Record<string, {lat: string, lng: string, name: string}> = {
      'EH': { lat: '55.9533', lng: '-3.1883', name: 'Edinburgh' },   // Edinburgh
      'G': { lat: '55.8642', lng: '-4.2518', name: 'Glasgow' },       // Glasgow  
      'AB': { lat: '57.1497', lng: '-2.0943', name: 'Aberdeen' },     // Aberdeen
      'DD': { lat: '56.4620', lng: '-2.9707', name: 'Dundee' },       // Dundee
      'IV': { lat: '57.4778', lng: '-4.2247', name: 'Inverness' },    // Inverness
      'KY': { lat: '56.1165', lng: '-3.1359', name: 'Fife' },         // Fife
      'PH': { lat: '56.3959', lng: '-3.4370', name: 'Perth' },        // Perth
      'FK': { lat: '56.1165', lng: '-3.7836', name: 'Falkirk' },      // Falkirk
      'ML': { lat: '55.8642', lng: '-3.9442', name: 'Motherwell' },   // Motherwell/North Lanarkshire
      'PA': { lat: '55.9467', lng: '-4.6249', name: 'Paisley' },      // Paisley
      'KA': { lat: '55.6118', lng: '-4.6298', name: 'Kilmarnock' },   // Kilmarnock/Ayrshire
      'DG': { lat: '55.0709', lng: '-3.6059', name: 'Dumfries' },     // Dumfries
      'TD': { lat: '55.6038', lng: '-2.5650', name: 'Galashiels' },   // Scottish Borders
    };

    const fallback = fallbackLocations[prefix];
    if (fallback) {
      console.log(`📍 Using fallback location for ${normalizedPostcode}: ${fallback.name} (very approximate)`);

      // Cache the fallback to avoid repeated lookups
      await storage.saveGeocode({
        key: `fallback:${prefix}`,
        lat: fallback.lat,
        lng: fallback.lng,
        source: 'fallback'
      });

      return {
        query: normalizedPostcode,
        type: 'postcode',
        lat: fallback.lat,
        lng: fallback.lng,
        source: 'fallback-' + fallback.name.toLowerCase(),
        approximate: true
      };
    }

    // Step 5: Ultimate fallback to Edinburgh city center
    console.log(`📍 Using ultimate fallback (Edinburgh) for unknown postcode: ${normalizedPostcode}`);
    return {
      query: normalizedPostcode,
      type: 'postcode',
      lat: '55.9533',
      lng: '-3.1883',
      source: 'fallback-edinburgh',
      approximate: true
    };
  }

  // POST /api/geo/geocode-batch - Batch geocode postcodes and addresses
  app.post('/api/geo/geocode-batch', async (req, res) => {
    try {
      const { postcodes = [], addresses = [] } = req.body;

      // OPTIMIZATION: Process unique postcodes in parallel for 70-80% faster geocoding
      const uniquePostcodes = Array.from(new Set(postcodes as string[]));
      console.log(`🚀 Parallel geocoding ${uniquePostcodes.length} unique postcodes (from ${postcodes.length} total)...`);

      // CACHE VERIFICATION: Check which postcodes are already cached
      const cacheChecks = await Promise.all(
        uniquePostcodes.map(async (postcode) => {
          const normalizedPostcode = postcode.trim().toUpperCase();
          const cached = await storage.getGeocode(`postcode:${normalizedPostcode}`);
          return { postcode, normalizedPostcode, cached };
        })
      );

      const cachedResults = cacheChecks.filter(c => c.cached).map(c => ({
        query: c.normalizedPostcode,
        input: c.postcode,
        postcode: c.postcode,
        type: 'postcode',
        lat: Number(c.cached.lat),
        lng: Number(c.cached.lng),
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
          const geocodeResult = await geocodeWithFallback(postcode, storage);
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