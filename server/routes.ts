
import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { parseExcelFiles, processCapacityData, generateExcelExport } from './pipeline';
import { storage } from "./storage";
import { CapacityAnalysis, getCanonicalWeekBoundaries } from "@shared/schema";
import { aggregateMonthlyData } from "./monthlyAnalysis";

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
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
let latestProcessingResult: any = null;
let latestExportBuffer: Buffer | null = null;

// Helper function to normalize file names by removing browser download numbers
function normalizeFileName(fileName: string): string {
  // Remove numbers in parentheses that browsers add for duplicate downloads
  // e.g. "Hours by Service Type (1).xlsx" -> "Hours by Service Type.xlsx"
  return fileName.replace(/\s*\(\d+\)/g, '');
}

export async function registerRoutes(app: Express): Promise<Server> {
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
      console.log(`📋 Files received:`, files ? Object.keys(files) : 'No files');
      
      // Validate that all four files are present
      if (!files.availability || !files.guaranteed || !files.demand || !files.cgData) {
        return res.status(400).json({
          message: 'Missing required files. Please upload availability, guaranteed, demand, and CG Data Export files.'
        });
      }

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
      const parsedData = parseExcelFiles(
        availabilityFile.buffer,
        guaranteedFile.buffer,
        demandFile.buffer,
        cgDataFile.buffer
      );

      // Process the data with CG Data as master employee list
      const result = processCapacityData(
        parsedData.availability,
        parsedData.guaranteed,
        parsedData.demand,
        parsedData.cgData
      );

      // Add parsing warnings to result
      if (parsedData.warnings.length > 0) {
        result.warnings = [...(result.warnings || []), ...parsedData.warnings];
      }

      // Use cleaned records from pipeline
      const cleanedRecords = result.cleanedRecords;

      // Generate Excel export
      const exportBuffer = generateExcelExport(result, cleanedRecords);
      
      // Store for export endpoint
      latestProcessingResult = result;
      latestExportBuffer = exportBuffer;

      // Save Excel file to disk
      const exportPath = path.join(process.cwd(), 'capacity_dashboard.xlsx');
      fs.writeFileSync(exportPath, exportBuffer);

      // Persist processed data to database with derived week boundaries
      try {
        if (result.dailySummary && result.dailySummary.length > 0) {
          // Get week boundaries from the first date in daily summary
          const firstDate = result.dailySummary[0].date;
          const { weekStart, weekEnd } = getCanonicalWeekBoundaries(firstDate);
          
          console.log(`💾 Persisting analysis for week: ${weekStart} to ${weekEnd}`);
          
          // Save to database (will upsert if week already exists)
          await storage.saveCapacityAnalysis({
            weekStartDate: weekStart,
            weekEndDate: weekEnd,
            kpis: result.kpis,
            dailySummary: result.dailySummary,
            employeesByDate: result.employeesByDate,
            employeeSummaryByDate: result.employeeSummaryByDate || {},
            warnings: result.warnings || [],
          });
          
          console.log(`✅ Analysis persisted successfully for week ${weekStart}`);
        } else {
          console.log(`⚠️  No daily summary data to persist`);
        }
      } catch (persistError) {
        console.error('⚠️  Failed to persist analysis to database:', persistError);
        // Don't fail the request if persistence fails
      }

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
  app.get('/api/export', (req, res) => {
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

  // GET /api/history - Get all historical analyses (latest 8 weeks only)
  app.get('/api/history', async (req, res) => {
    try {
      const analyses = await storage.getLatestWeeksAnalyses(8);
      res.json(analyses);
    } catch (error) {
      console.error('History fetch error:', error);
      res.status(500).json({
        message: 'Failed to fetch historical data'
      });
    }
  });

  // GET /api/history/latest - Get the latest analysis
  app.get('/api/history/latest', async (req, res) => {
    try {
      const analysis = await storage.getLatestCapacityAnalysis();
      if (!analysis) {
        return res.status(404).json({
          message: 'No historical data found'
        });
      }
      res.json(analysis);
    } catch (error) {
      console.error('Latest history fetch error:', error);
      res.status(500).json({
        message: 'Failed to fetch latest data'
      });
    }
  });

  // GET /api/history/monthly/:year/:month - Get monthly analysis
  app.get('/api/history/monthly/:year/:month', async (req, res) => {
    try {
      const year = parseInt(req.params.year);
      const month = parseInt(req.params.month);
      
      if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
        return res.status(400).json({
          message: 'Invalid year or month parameters'
        });
      }

      const analyses = await storage.getCapacityAnalysesByMonth(year, month);
      
      // Aggregate monthly data
      const monthlyAnalysis = aggregateMonthlyData(analyses);
      
      res.json({
        year,
        month,
        weeklyAnalyses: analyses,
        monthlyAggregate: monthlyAnalysis
      });
    } catch (error) {
      console.error('Monthly analysis error:', error);
      res.status(500).json({
        message: 'Failed to generate monthly analysis'
      });
    }
  });

  // GET /api/history/range/:startDate/:endDate - Get analyses by date range
  app.get('/api/history/range/:startDate/:endDate', async (req, res) => {
    try {
      const { startDate, endDate } = req.params;
      
      // Validate date format (YYYY-MM-DD)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
        return res.status(400).json({
          message: 'Invalid date format. Use YYYY-MM-DD'
        });
      }

      const analyses = await storage.getCapacityAnalysesByDateRange(startDate, endDate);
      res.json(analyses);
    } catch (error) {
      console.error('Date range fetch error:', error);
      res.status(500).json({
        message: 'Failed to fetch data for date range'
      });
    }
  });

  // POST /api/cleanup - Clean up old data
  app.post('/api/cleanup', async (req, res) => {
    try {
      const { months = 6 } = req.body;
      
      if (typeof months !== 'number' || months < 1 || months > 60) {
        return res.status(400).json({
          message: 'Months parameter must be between 1 and 60'
        });
      }

      const deletedCount = await storage.cleanupOldAnalyses(months);
      
      res.json({
        message: `Successfully cleaned up old data`,
        deletedAnalyses: deletedCount,
        cutoffMonths: months
      });
    } catch (error) {
      console.error('Cleanup error:', error);
      res.status(500).json({
        message: 'Failed to cleanup old data'
      });
    }
  });

  // GET /api/cleanup/preview/:months - Preview what would be deleted
  app.get('/api/cleanup/preview/:months', async (req, res) => {
    try {
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
      const allAnalyses = await storage.getLatestWeeksAnalyses(12); // Get more for cleanup preview
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
      res.status(500).json({
        message: 'Failed to preview cleanup'
      });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
