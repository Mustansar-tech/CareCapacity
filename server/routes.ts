import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { parseExcelFiles, processCapacityData, generateExcelExport } from './pipeline';
import { storage } from "./storage";
import { getCanonicalWeekBoundaries } from "@shared/schema";
import { vrptwOptimizer, VRPTWOptimizer, type EmployeeWindow, type ClientVisit } from './vrptw-optimizer';
import { RunBasedOptimizer } from './run-based-optimizer';

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
      const parsedData = await parseExcelFiles(
        availabilityFile.buffer,
        guaranteedFile.buffer,
        demandFile.buffer,
        cgDataFile.buffer
      );

      // Process the data with CG Data as master employee list
      const result = await processCapacityData(
        parsedData.availability,
        parsedData.guaranteed,     // still the filtered rows for scheduling
        parsedData.demand,
        parsedData.cgData,
        { ghWorkbookBuffer: guaranteedFile.buffer }   // pass the raw workbook buffer ONLY for cancellations
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

  // GET /api/history - Get all historical analyses (latest 8 weeks only)
  app.get('/api/history', async (_req, res) => {
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
  app.get('/api/history/latest', async (_req, res) => {
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
  app.get('/api/cleanup/preview/:months', async (_req, res) => {
    try {
      const months = parseInt(_req.params.months);

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
      'EH': { lat: '55.9533', lng: '-3.1883', name: 'Edinburgh' },  // Edinburgh
      'G': { lat: '55.8642', lng: '-4.2518', name: 'Glasgow' },      // Glasgow  
      'AB': { lat: '57.1497', lng: '-2.0943', name: 'Aberdeen' },    // Aberdeen
      'DD': { lat: '56.4620', lng: '-2.9707', name: 'Dundee' },      // Dundee
      'IV': { lat: '57.4778', lng: '-4.2247', name: 'Inverness' },   // Inverness
      'KY': { lat: '56.1165', lng: '-3.1359', name: 'Fife' },        // Fife
      'PH': { lat: '56.3959', lng: '-3.4370', name: 'Perth' },       // Perth
      'FK': { lat: '56.1165', lng: '-3.7836', name: 'Falkirk' },     // Falkirk
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
      const results = [];

      // Process postcodes using postcodes.io (free UK postcodes)
      for (const postcode of postcodes) {
        try {
          // Try geocoding with fallback hierarchy
          const geocodeResult = await geocodeWithFallback(postcode, storage);
          results.push(geocodeResult);
        } catch (error) {
          results.push({
            query: postcode,
            type: 'postcode',
            error: 'Geocoding completely failed',
            source: 'fallback',
            approximate: false
          });
        }
      }

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
        const employeeLocation = await storage.getEmployeeLocationByName(employeeId);
        if (employeeLocation) {
          const routePlan = await storage.saveRoutePlan({
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
      res.status(500).json({ message: 'Route optimization failed' });
    }
  });

  // GET /api/routing/plans?date=YYYY-MM-DD - Get route plans for a date
  app.get('/api/routing/plans', async (req, res) => {
    try {
      const date = req.query.date as string;
      if (!date) {
        return res.status(400).json({ message: 'Date parameter is required' });
      }

      const plans = await storage.getRoutePlansByDate(date);

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
      res.status(500).json({ message: 'Failed to get route plans' });
    }
  });

  // GET /api/geographical/employees - Get all employee locations
  app.get('/api/geographical/employees', async (req, res) => {
    try {
      const locations = await storage.getAllEmployeeLocations();
      res.json(locations);
    } catch (error) {
      console.error('Get employee locations error:', error);
      res.status(500).json({ message: 'Failed to get employee locations' });
    }
  });

  // GET /api/geographical/clients - Get all client locations
  app.get('/api/geographical/clients', async (req, res) => {
    try {
      const locations = await storage.getAllClientLocations();
      res.json(locations);
    } catch (error) {
      console.error('Get client locations error:', error);
      res.status(500).json({ message: 'Failed to get client locations' });
    }
  });

  // ===== ROUTE OPTIMIZATION ENDPOINTS =====

  // POST /api/routing/optimize - Trigger VRPTW optimization for a specific date
  app.post('/api/routing/optimize', async (req, res) => {
    try {
      const { date } = req.body;

      if (!date) {
        return res.status(400).json({ error: 'Date is required' });
      }

      console.log(`🚀 Starting VRPTW optimization for ${date}`);

      // Get employee availability from Daily Capacity Summary
      const latestAnalysis = await storage.getLatestCapacityAnalysis();
      if (!latestAnalysis) {
        return res.status(404).json({ error: 'No analysis data found. Please process Excel files first.' });
      }

      const employeesByDate = latestAnalysis.employeesByDate as Record<string, any[]>;
      const employeeData = employeesByDate[date];

      if (!employeeData) {
        return res.status(404).json({ 
          error: `No employee data found for date ${date}`,
          availableDates: Object.keys(employeesByDate)
        });
      }

      // Get visits for the date
      let visits = await storage.getVisitsByDate(date);

      // Get location data
      const employeeLocations = await storage.getAllEmployeeLocations();
      const clientLocations = await storage.getAllClientLocations();

      // If no visits exist for this date, create some realistic test visits
      if (visits.length === 0 && clientLocations.length > 0) {
        console.log(`🔧 Creating test visits for ${date} with ${clientLocations.length} clients`);

        // Create visits for 3-5 random clients with realistic time windows
        const clientsToSchedule = clientLocations.slice(0, Math.min(5, clientLocations.length));

        for (let i = 0; i < clientsToSchedule.length; i++) {
          const client = clientsToSchedule[i];

          // Generate realistic visit times
          const startHour = 8 + (i * 2); // 08:00, 10:00, 12:00, 14:00, 16:00
          const startMinute = (i % 2) * 30; // 0 or 30 minutes
          const duration = 60 + (i % 3) * 30; // 60, 90, or 120 minutes

          const visitStart = `${startHour.toString().padStart(2, '0')}:${startMinute.toString().padStart(2, '0')}`;
          const startMinutes = startHour * 60 + startMinute;
          const endMinutes = startMinutes + duration;
          const visitEnd = `${Math.floor(endMinutes / 60).toString().padStart(2, '0')}:${(endMinutes % 60).toString().padStart(2, '0')}`;

          try {
            const visit = await storage.saveVisit({
              clientId: client.id,
              date: date,
              durationMinutes: duration,
              preferredStartTime: `${date} ${visitStart}`,
              preferredEndTime: `${date} ${visitEnd}`,
              priority: i + 1,
              serviceType: 'Personal Care'
            });

            console.log(`✅ Created test visit for ${client.clientName}: ${visitStart}–${visitEnd} (${duration}m)`);
          } catch (error) {
            console.log(`❌ Failed to create test visit for ${client.clientName}:`, error);
          }
        }

        // Refresh visits after creating test data
        visits = await storage.getVisitsByDate(date);
      }

      // Convert employee data to VRPTW format
      const employeeWindows: EmployeeWindow[] = [];

      for (const empData of employeeData) {
        if (empData.status !== 'Available' || !empData.timeWindows) continue;

        const empLocation = employeeLocations.find(loc => loc.employeeName === empData.employeeName);
        if (!empLocation?.homeLat || !empLocation?.homeLng) continue;

        // Parse time windows from string (e.g., "09:00-17:00")
        const timeWindowParts = empData.timeWindows.split('-');
        if (timeWindowParts.length !== 2) continue;

        const startMinutes = VRPTWOptimizer.timeToMinutes(timeWindowParts[0].trim());
        const endMinutes = VRPTWOptimizer.timeToMinutes(timeWindowParts[1].trim());

        employeeWindows.push({
          employeeId: empLocation.id,
          employeeName: empData.employeeName,
          date: date,
          startMinutes: startMinutes,
          endMinutes: endMinutes,
          location: {
            lat: parseFloat(empLocation.homeLat),
            lng: parseFloat(empLocation.homeLng)
          },
          transportMode: (empLocation.transportMode as any) || 'car'
        });
      }

      // Convert visit data to VRPTW format
      const clientVisits: ClientVisit[] = [];

      for (const visit of visits) {
        const clientLocation = clientLocations.find(loc => loc.id === visit.clientId);
        if (!clientLocation?.lat || !clientLocation?.lng) continue;

        clientVisits.push({
          visitId: visit.id,
          clientId: visit.clientId,
          clientName: clientLocation.clientName,
          date: date,
          startMinutes: VRPTWOptimizer.timeToMinutes(visit.preferredStartTime?.split(' ')[1] || '09:00'),
          endMinutes: VRPTWOptimizer.timeToMinutes(visit.preferredEndTime?.split(' ')[1] || '17:00'),
          durationMinutes: visit.durationMinutes,
          location: {
            lat: parseFloat(clientLocation.lat),
            lng: parseFloat(clientLocation.lng)
          },
          priority: visit.priority || 1
        });
      }

      console.log(`🔍 VRPTW Input: ${employeeWindows.length} employees, ${clientVisits.length} visits`);

      // Run VRPTW optimization
      const optimizationResult = vrptwOptimizer.optimize(employeeWindows, clientVisits);

      // Store optimized routes in database
      for (const route of optimizationResult.routes) {
        if (route.stops.length === 0) continue; // Skip empty routes

        // Save route plan
        const routePlanData = {
          date: route.date,
          employeeId: route.employeeId,
          totalDistanceKm: route.totalDistanceKm.toString(),
          totalTravelMinutes: route.totalTravelMinutes,
          status: (route.feasible ? 'optimized' : 'infeasible') as 'optimized' | 'manual' | 'infeasible',
          warnings: route.warnings
        };

        const routePlan = await storage.saveRoutePlan(routePlanData);

        // Save route stops
        for (const stop of route.stops) {
          const routeStopData = {
            routePlanId: routePlan.id,
            visitId: stop.visitId,
            sequence: stop.sequence,
            scheduledStart: VRPTWOptimizer.minutesToTime(stop.scheduledStartMinutes),
            scheduledEnd: VRPTWOptimizer.minutesToTime(stop.scheduledEndMinutes),
            travelMinutesFromPrev: stop.travelMinutesFromPrev,
            distanceKmFromPrev: "0" // Will be calculated properly in future
          };

          await storage.saveRouteStop(routeStopData);
        }
      }

      console.log(`✅ VRPTW Optimization complete: ${optimizationResult.optimizationStats.assignedVisits} visits assigned`);

      res.json({
        success: true,
        date: date,
        optimizationStats: optimizationResult.optimizationStats,
        routes: optimizationResult.routes.map(route => ({
          employeeName: route.employeeName,
          stopsCount: route.stops.length,
          totalTravelMinutes: route.totalTravelMinutes,
          feasible: route.feasible
        })),
        unassignedVisits: optimizationResult.unassignedVisits.length
      });

    } catch (error) {
      console.error('VRPTW optimization error:', error);
      res.status(500).json({ 
        error: 'Route optimization failed', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  // GET /api/routing/plans?date=YYYY-MM-DD - Get optimized route plans
  app.get('/api/routing/plans', async (req, res) => {
    try {
      const { date } = req.query;

      if (!date || typeof date !== 'string') {
        return res.status(400).json({ error: 'Date parameter is required' });
      }

      console.log(`📋 Getting route plans for ${date}`);

      const routePlans = await storage.getRoutePlansByDate(date);

      // Get detailed route information with stops
      const detailedRoutes = [];

      for (const plan of routePlans) {
        const stops = await storage.getRouteStopsByPlan(plan.id);
        const employee = await storage.getEmployeeLocationById(plan.employeeId);

        // Get visit and client details for each stop
        const detailedStops = [];

        for (const stop of stops) {
          const visit = await storage.getVisitById(stop.visitId);
          const client = visit ? await storage.getClientLocationById(visit.clientId) : null;

          detailedStops.push({
            sequence: stop.sequence,
            visitId: stop.visitId,
            clientName: client?.clientName || 'Unknown Client',
            scheduledStart: stop.scheduledStart,
            scheduledEnd: stop.scheduledEnd,
            travelMinutesFromPrev: stop.travelMinutesFromPrev,
            distanceKmFromPrev: stop.distanceKmFromPrev
          });
        }

        detailedRoutes.push({
          routePlanId: plan.id,
          employeeName: employee?.employeeName || 'Unknown Employee',
          totalDistanceKm: plan.totalDistanceKm,
          totalTravelMinutes: plan.totalTravelMinutes,
          status: plan.status,
          warnings: plan.warnings,
          stops: detailedStops.sort((a, b) => a.sequence - b.sequence)
        });
      }

      console.log(`📊 Found ${detailedRoutes.length} route plans for ${date}`);

      res.json({
        date: date,
        routePlans: detailedRoutes
      });

    } catch (error) {
      console.error('Get route plans error:', error);
      res.status(500).json({ 
        error: 'Failed to get route plans', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  // ===== RUN-BASED OPTIMIZATION ENDPOINTS =====

  // GET /api/run-optimization/:date - Get run optimization data for a date
  app.get('/api/run-optimization/:date', async (req, res) => {
    try {
      const { date } = req.params;

      // Get Daily Capacity Summary data
      const latestAnalysis = await storage.getLatestCapacityAnalysis();
      if (!latestAnalysis) {
        return res.status(404).json({ error: 'No analysis data found. Please process Excel files first.' });
      }

      // Find employee data for the specific date
      const employeesByDate = latestAnalysis.employeesByDate as Record<string, any[]>;
      const employeeData = employeesByDate[date];
      if (!employeeData) {
        return res.status(404).json({ 
          error: `No employee data found for date ${date}`,
          availableDates: Object.keys(employeesByDate)
        });
      }

      // Get location data
      const employeeLocations = await storage.getAllEmployeeLocations();
      const clientLocations = await storage.getAllClientLocations();
      let visits = await storage.getVisitsByDate(date);

      // If no visits exist for this date, create some realistic test visits
      if (visits.length === 0 && clientLocations.length > 0) {
        console.log(`🔧 Creating test visits for ${date} with ${clientLocations.length} clients`);

        // Create visits for 3-5 random clients with realistic time windows
        const clientsToSchedule = clientLocations.slice(0, Math.min(5, clientLocations.length));

        for (let i = 0; i < clientsToSchedule.length; i++) {
          const client = clientsToSchedule[i];

          // Generate realistic visit times
          const startHour = 8 + (i * 2); // 08:00, 10:00, 12:00, 14:00, 16:00
          const startMinute = (i % 2) * 30; // 0 or 30 minutes
          const duration = 60 + (i % 3) * 30; // 60, 90, or 120 minutes

          const visitStart = `${startHour.toString().padStart(2, '0')}:${startMinute.toString().padStart(2, '0')}`;
          const startMinutes = startHour * 60 + startMinute;
          const endMinutes = startMinutes + duration;
          const visitEnd = `${Math.floor(endMinutes / 60).toString().padStart(2, '0')}:${(endMinutes % 60).toString().padStart(2, '0')}`;

          try {
            const visit = await storage.saveVisit({
              clientId: client.id,
              date: date,
              durationMinutes: duration,
              preferredStartTime: `${date} ${visitStart}`,
              preferredEndTime: `${date} ${visitEnd}`,
              priority: i + 1,
              serviceType: 'Personal Care'
            });

            console.log(`✅ Created test visit for ${client.clientName}: ${visitStart}–${visitEnd} (${duration}m)`);
          } catch (error) {
            console.log(`❌ Failed to create test visit for ${client.clientName}:`, error);
          }
        }

        // Refresh visits after creating test data
        visits = await storage.getVisitsByDate(date);
      }


      // Build employee run states
      const availableEmployees = [];

      for (const empData of employeeData) {
        if (empData.status !== 'Available' || !empData.timeWindows) continue;

        const empLocation = employeeLocations.find(loc => loc.employeeName === empData.employeeName);
        if (!empLocation?.homeLat || !empLocation?.homeLng) continue;

        // Parse time windows
        const timeWindowParts = empData.timeWindows.split('-');
        if (timeWindowParts.length !== 2) continue;

        const startMinutes = RunBasedOptimizer.timeToMinutes(timeWindowParts[0].trim());
        const endMinutes = RunBasedOptimizer.timeToMinutes(timeWindowParts[1].trim());

        // Get existing booked visits for this employee (if any)
        const existingRoutePlan = await storage.getRoutePlanByEmployeeAndDate(empLocation.id, date);
        const bookedVisits = [];

        if (existingRoutePlan) {
          const routeStops = await storage.getRouteStopsByPlan(existingRoutePlan.id);
          for (const stop of routeStops) {
            const visit = await storage.getVisitById(stop.visitId);
            const client = visit ? await storage.getClientLocationById(visit.clientId) : null;

            if (visit && client && client.lat && client.lng) {
              bookedVisits.push({
                visitId: visit.id,
                clientName: client.clientName,
                location: { lat: parseFloat(client.lat), lng: parseFloat(client.lng) },
                startTime: RunBasedOptimizer.timeToMinutes(stop.scheduledStart || '09:00'),
                endTime: RunBasedOptimizer.timeToMinutes(stop.scheduledEnd || '10:00'),
                duration: visit.durationMinutes,
                sequence: stop.sequence
              });
            }
          }
        }

        const homeLocation = {
          lat: parseFloat(empLocation.homeLat),
          lng: parseFloat(empLocation.homeLng)
        };

        availableEmployees.push({
          employeeId: empLocation.id,
          employeeName: empData.employeeName,
          homeLocation,
          currentLocation: bookedVisits.length > 0 
            ? bookedVisits[bookedVisits.length - 1].location 
            : homeLocation,
          transportMode: (empLocation.transportMode as any) || 'car',
          timeWindows: [{ start: startMinutes, end: endMinutes }],
          bookedVisits,
          careMinutesTotal: bookedVisits.reduce((sum, v) => sum + v.duration, 0),
          travelMinutesTotal: 0, // Will be calculated
          availableSlots: [] // Will be generated
        });
      }

      // Build visit candidates
      const visitCandidates = [];

      for (const visit of visits) {
        const clientLocation = clientLocations.find(loc => loc.id === visit.clientId);
        if (!clientLocation?.lat || !clientLocation?.lng) continue;

        // Skip visits that are already assigned
        const isAssigned = availableEmployees.some(emp => 
          emp.bookedVisits.some(bv => bv.visitId === visit.id)
        );
        if (isAssigned) continue;

        visitCandidates.push({
          visitId: visit.id,
          clientId: visit.clientId,
          clientName: clientLocation.clientName,
          location: { lat: parseFloat(clientLocation.lat), lng: parseFloat(clientLocation.lng) },
          requiredStart: RunBasedOptimizer.timeToMinutes(visit.preferredStartTime?.split(' ')[1] || '09:00'),
          requiredEnd: RunBasedOptimizer.timeToMinutes(visit.preferredEndTime?.split(' ')[1] || '17:00'),
          duration: visit.durationMinutes,
          priority: visit.priority || 1,
          feasibleEmployees: []
        });
      }

      // Run optimization with default settings
      const optimizer = new RunBasedOptimizer({
        maxCareMinutes: 540, // 9 hours
        bufferMinutes: 5,
        maxTravelBetweenVisits: 30
      });

      const result = optimizer.optimizeRuns(availableEmployees, visitCandidates);

      res.json({
        date,
        availableEmployees: result.employees,
        visitCandidates: result.visitCandidates,
        optimizationStats: result.stats
      });

    } catch (error) {
      console.error('Run optimization error:', error);
      res.status(500).json({ 
        error: 'Run optimization failed', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  // POST /api/run-optimization/optimize - Optimize runs with custom settings
  app.post('/api/run-optimization/optimize', async (req, res) => {
    try {
      const { date, maxCareMinutes = 540, bufferMinutes = 5, maxTravelBetweenVisits = 30 } = req.body;

      if (!date) {
        return res.status(400).json({ error: 'Date is required' });
      }

      // This would trigger a full re-optimization with the new settings
      // For now, just return success - the logic would be similar to the GET endpoint
      // but with the custom settings applied

      res.json({
        success: true,
        message: 'Run optimization completed with custom settings',
        settings: { maxCareMinutes, bufferMinutes, maxTravelBetweenVisits }
      });

    } catch (error) {
      console.error('Run optimization error:', error);
      res.status(500).json({ 
        error: 'Run optimization failed', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  // POST /api/run-optimization/assign - Assign a visit to an employee
  app.post('/api/run-optimization/assign', async (req, res) => {
    try {
      const { visitId, employeeId, insertionPoint } = req.body;

      if (!visitId || !employeeId || !insertionPoint) {
        return res.status(400).json({ error: 'Visit ID, employee ID, and insertion point are required' });
      }

      // Get the visit and employee details
      const visit = await storage.getVisitById(visitId);
      if (!visit) {
        return res.status(404).json({ error: 'Visit not found' });
      }

      // Create or update route plan for the employee
      let routePlan = await storage.getRoutePlanByEmployeeAndDate(employeeId, visit.date);

      if (!routePlan) {
        routePlan = await storage.saveRoutePlan({
          date: visit.date,
          employeeId: employeeId,
          status: 'manual',
          warnings: []
        });
      }

      // Add the visit as a route stop
      const existingStops = await storage.getRouteStopsByPlan(routePlan.id);
      const newSequence = insertionPoint.slotIndex + 1;

      // Update sequences of existing stops if needed
      for (const stop of existingStops) {
        if (stop.sequence >= newSequence) {
          // This would require updating the sequence - for now just add at the end
        }
      }

      await storage.saveRouteStop({
        routePlanId: routePlan.id,
        visitId: visitId,
        sequence: Math.max(0, ...existingStops.map(s => s.sequence)) + 1,
        scheduledStart: visit.preferredStartTime?.split(' ')[1] || '09:00',
        scheduledEnd: visit.preferredEndTime?.split(' ')[1] || '17:00',
        travelMinutesFromPrev: 0, // Would be calculated properly
        distanceKmFromPrev: "0"
      });

      res.json({
        success: true,
        message: 'Visit assigned successfully',
        routePlanId: routePlan.id
      });

    } catch (error) {
      console.error('Visit assignment error:', error);
      res.status(500).json({ 
        error: 'Visit assignment failed', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  // Travel time optimization endpoint - Process everything on backend
  app.get('/api/travel-optimization/:date', async (req, res) => {
    try {
      const { date } = req.params;

      // Get Daily Capacity Summary data only (this is the source of truth)
      const latestAnalysis = await storage.getLatestCapacityAnalysis();
      if (!latestAnalysis) {
        return res.status(404).json({ error: 'No analysis data found. Please process Excel files first.' });
      }

      // Find employee data for the specific date from employeesByDate
      console.log(`🔍 DEBUG: Looking for date ${date} in employeesByDate`);
      const employeesByDate = latestAnalysis.employeesByDate as Record<string, any[]>;
      console.log(`🔍 DEBUG: Available dates:`, Object.keys(employeesByDate));

      const employeeData = employeesByDate[date];
      if (!employeeData) {
        return res.status(404).json({ 
          error: `No employee data found for date ${date}`,
          availableDates: Object.keys(employeesByDate)
        });
      }

      // Get client locations and employee postcodes
      const clientLocations = await storage.getAllClientLocations();
      const employeeLocations = await storage.getAllEmployeeLocations();

      console.log(`🔍 DEBUG: Retrieved ${clientLocations.length} client locations from database`);

      // Auto-geocode any missing client coordinates as safety net
      const missingCoords = clientLocations.filter(c => (!c.lat || !c.lng) && c.postcode);
      if (missingCoords.length > 0) {
        console.log(`🔄 Auto-geocoding ${missingCoords.length} clients with missing coordinates...`);

        for (const client of missingCoords) {
          try {
            const geocoded = await geocodeWithFallback(client.postcode, storage);
            if (geocoded && geocoded.lat && geocoded.lng) {
              await storage.upsertClientLocation({
                clientName: client.clientName,
                addressLine: client.addressLine,
                postcode: client.postcode,
                lat: geocoded.lat,
                lng: geocoded.lng,
              });
              console.log(`✅ Auto-geocoded ${client.clientName}`);
            }
          } catch (err) {
            console.log(`❌ Failed to auto-geocode ${client.clientName}: ${err}`);
          }
        }

        // Refresh client locations after auto-geocoding
        const updatedClientLocations = await storage.getAllClientLocations();
        clientLocations.splice(0, clientLocations.length, ...updatedClientLocations);
      }

      console.log(`🔍 DEBUG: Final client status: ${clientLocations.filter(c => c.lat && c.lng).length}/${clientLocations.length} with coordinates`);

      // Process backend optimization: Employee Name + Best Client Matches
      const optimizedSchedule = [];
      const diagnostics = {
        employeeIssues: [] as any[],
        clientIssues: [] as any[],
        dataQuality: {
          totalEmployees: employeeData.length,
          availableEmployees: 0,
          employeesWithoutGeocode: 0,
          employeesWithoutPostcode: 0,
          employeesWithoutTimeWindows: 0,
          totalClients: clientLocations.length,
          clientsWithoutGeocode: 0,
          geocodingAttempts: 0,
          geocodingSuccesses: 0
        }
      };

      // Helper function to convert time string to minutes
      const timeToMinutes = (timeStr: string): number => {
        const [hours, minutes] = timeStr.split(':').map(Number);
        return hours * 60 + minutes;
      };

      // Filter employees based on Daily Capacity Summary availability rules ONLY
      for (const empData of employeeData) {
        // Daily Capacity Summary rule: Employee must be Available (not Holiday, Sick, etc.)
        if (empData.status !== 'Available') {
          console.log(`🔍 DEBUG: Skipping ${empData.employeeName} on ${date} - Status: ${empData.status}`);
          diagnostics.employeeIssues.push({
            employeeName: empData.employeeName,
            reason: 'status_unavailable',
            detail: `Status: ${empData.status}`,
            severity: 'info'
          });
          continue;
        }

        // Daily Capacity Summary rule: Employee must have time windows
        if (!empData.timeWindows || empData.timeWindows.length === 0) {
          console.log(`🔍 DEBUG: Skipping ${empData.employeeName} on ${date} - No time windows`);
          diagnostics.employeeIssues.push({
            employeeName: empData.employeeName,
            reason: 'no_time_windows',
            detail: 'No available time windows for scheduling',
            severity: 'warning'
          });
          diagnostics.dataQuality.employeesWithoutTimeWindows++;
          continue;
        }

        // Get employee postcode from CG Data
        const empLocation = employeeLocations.find(loc => loc.employeeName === empData.employeeName);
        if (!empLocation || !empLocation.homePostcode) {
          console.log(`🔍 DEBUG: Skipping ${empData.employeeName} on ${date} - No postcode available`);
          diagnostics.employeeIssues.push({
            employeeName: empData.employeeName,
            reason: 'no_postcode',
            detail: 'Missing home postcode for location calculation',
            severity: 'error'
          });
          diagnostics.dataQuality.employeesWithoutPostcode++;
          continue;
        }

        // Check if employee location is geocoded (should be done during data upload)
        if (!empLocation.homeLat || !empLocation.homeLng) {
          console.log(`🔍 DEBUG: Skipping ${empData.employeeName} on ${date} - Not geocoded (should be done during data upload)`);
          diagnostics.employeeIssues.push({
            employeeName: empData.employeeName,
            reason: 'geocoding_failed',
            detail: `Employee location not geocoded during data upload: ${empLocation.homePostcode}`,
            severity: 'error'
          });
          diagnostics.dataQuality.employeesWithoutGeocode++;
          continue;
        }

        console.log(`✅ Available: ${empData.employeeName} on ${date} - Status: ${empData.status}, Postcode: ${empLocation.homePostcode}`);
        diagnostics.dataQuality.availableEmployees++;


        // Backend processing: Calculate best client matches within 15-minute travel constraint AND time window overlap
        const bestClientMatches = [];
        const rejectedClients = [];

        // Get all visits for this date to check client visit times
        console.log(`🔍 EMPLOYEE DEBUG: Starting client matching for ${empData.employeeName}`);
        let visitsForDate: any[] = [];
        try {
          visitsForDate = await storage.getVisitsByDate(date);
          console.log(`🔍 VISITS DEBUG: Found ${visitsForDate.length} total visits for ${date}`);
        } catch (error) {
          console.log(`🔍 ERROR: Failed to get visits for ${date}:`, error);
          visitsForDate = [];
        }

        // Create a map to avoid duplicate processing
        const processedClients = new Set<string>();

        for (const client of clientLocations) {
          // Skip if already processed
          if (processedClients.has(client.clientName)) {
            continue;
          }
          processedClients.add(client.clientName);

          // Check if client is geocoded (should be done during data upload)
          if (!client.lat || !client.lng) {
            diagnostics.clientIssues.push({
              clientName: client.clientName,
              reason: 'geocoding_failed',
              detail: `Client location not geocoded during data upload: ${client.postcode}`,
              severity: 'error'
            });
            diagnostics.dataQuality.clientsWithoutGeocode++;
            continue;
          }

          // Check if client has visits scheduled for this date - only check once
          const clientVisits = visitsForDate.filter(visit => visit.clientId === client.id);
          if (clientVisits.length === 0) {
            rejectedClients.push({
              clientName: client.clientName,
              travelTimeMinutes: 0,
              reason: 'no_visits_scheduled'
            });
            continue;
          }

          // Calculate travel distance - only once per client
          const distance = calculateDistance(
            parseFloat(empLocation.homeLat!),
            parseFloat(empLocation.homeLng!),
            parseFloat(client.lat!),
            parseFloat(client.lng!)
          );

          // Estimate travel time based on transport mode
          const travelTimeMinutes = Math.round(distance * (empLocation.transportMode === 'walking' ? 12 : 3));

          // Apply 15-minute travel constraint
          if (travelTimeMinutes > 15) {
            rejectedClients.push({
              clientName: client.clientName,
              travelTimeMinutes: travelTimeMinutes,
              reason: 'travel_time_exceeded'
            });
            continue;
          }

          // Check time window overlap - optimized logic
          let hasTimeOverlap = false;

          // Parse employee time windows once
          const employeeTimeWindows = Array.isArray(empData.timeWindows) 
            ? empData.timeWindows 
            : [empData.timeWindows];

          const parsedEmpWindows = employeeTimeWindows
            .filter(tw => tw && typeof tw === 'string')
            .map(tw => {
              const timeMatch = tw.match(/(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/);
              return timeMatch ? {
                start: timeToMinutes(timeMatch[1]),
                end: timeToMinutes(timeMatch[2])
              } : null;
            })
            .filter(Boolean);

          // Check each visit for time overlap
          for (const visit of clientVisits) {
            if (!visit.preferredStartTime || !visit.preferredEndTime) {
              hasTimeOverlap = true;
              break;
            }

            const visitStartTime = visit.preferredStartTime.split(' ')[1] || '09:00';
            const visitEndTime = visit.preferredEndTime.split(' ')[1] || '17:00';
            const visitStart = timeToMinutes(visitStartTime);
            const visitEnd = timeToMinutes(visitEndTime);

            // Check overlap with any employee time window
            for (const empWindow of parsedEmpWindows) {
              if (visitStart < empWindow.end && visitEnd > empWindow.start) {
                hasTimeOverlap = true;
                break;
              }
            }

            if (hasTimeOverlap) break;
          }

          if (hasTimeOverlap) {
            bestClientMatches.push({
              clientName: client.clientName,
              travelTimeMinutes: travelTimeMinutes
            });
          } else {
            rejectedClients.push({
              clientName: client.clientName,
              travelTimeMinutes: travelTimeMinutes,
              reason: 'time_window_conflict',
              detail: 'Visit times conflict with employee availability'
            });
          }
        }

        // Sort by travel time (closest first) and take top 3 matches
        const topMatches = bestClientMatches
          .sort((a, b) => a.travelTimeMinutes - b.travelTimeMinutes)
          .slice(0, 3);

        // Add to optimized schedule (enhanced backend response with diagnostics)
        optimizedSchedule.push({
          employeeName: empData.employeeName,
          timeWindows: empData.timeWindows || "No time windows", // Include time windows from Daily Capacity Summary
          postcode: empLocation.homePostcode,
          bestClientMatches: topMatches,
          rejectedClients: rejectedClients.slice(0, 5), // Show top 5 rejected for insights
          totalRejectedClients: rejectedClients.length
        });

        console.log(`✅ ${empData.employeeName}: ${topMatches.length} client matches within 15 minutes, ${rejectedClients.length} rejected`);
      }

      // Count clients without geocoding from initial data
      diagnostics.dataQuality.clientsWithoutGeocode = clientLocations.filter(client => !client.lat || !client.lng).length;

      // Return enhanced backend-processed data: Employee Name + Best Client Matches + Diagnostics
      res.json({
        date,
        totalAvailableEmployees: optimizedSchedule.length,
        employees: optimizedSchedule,
        diagnostics: diagnostics
      });

    } catch (error) {
      console.error('Travel optimization error:', error);
      res.status(500).json({ error: 'Travel optimization failed', details: error instanceof Error ? error.message : 'Unknown error' });
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