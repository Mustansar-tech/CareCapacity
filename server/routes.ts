import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { parseExcelFiles, processCapacityData, generateExcelExport } from './pipeline';
import { storage } from "./storage";
import { getCanonicalWeekBoundaries, type ProcessingResult } from "@shared/schema";


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

// Store Guaranteed Hours Excel buffer for extracting real client visit times
let latestGuaranteedBuffer: Buffer | null = null;

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

      // Store Guaranteed Hours buffer for real-time visit extraction
      latestGuaranteedBuffer = guaranteedFile.buffer;

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
      const results = [];

      // Process postcodes using postcodes.io (free UK postcodes)
      for (const postcode of postcodes) {
        try {
          console.log(`🔍 Geocoding postcode: "${postcode}"`);
          // Try geocoding with fallback hierarchy
          const geocodeResult = await geocodeWithFallback(postcode, storage);
          if (geocodeResult && geocodeResult.lat && geocodeResult.lng) {
            results.push({
              ...geocodeResult,
              success: true,
              lat: Number(geocodeResult.lat),
              lng: Number(geocodeResult.lng)
            });
            console.log(`✅ Geocoded "${postcode}" -> ${geocodeResult.lat}, ${geocodeResult.lng}`);
          } else {
            results.push({
              query: postcode,
              type: 'postcode',
              error: 'No coordinates returned',
              success: false,
              source: 'none'
            });
            console.log(`❌ Failed to geocode "${postcode}" - no coordinates`);
          }
        } catch (error) {
          results.push({
            query: postcode,
            type: 'postcode',
            error: 'Geocoding completely failed',
            success: false,
            source: 'error'
          });
          console.log(`❌ Error geocoding "${postcode}":`, error);
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



  

  


  // Weekly schedule generation endpoint
  app.post('/api/weekly-schedule/generate', async (req, res) => {
    try {
      const { weekStartDate } = req.body;
      
      if (!weekStartDate) {
        return res.status(400).json({ message: 'weekStartDate is required' });
      }
      
      // Get the week boundaries
      const { weekStart, weekEnd } = getCanonicalWeekBoundaries(weekStartDate);
      
      // Get latest processed data
      const latestData = await storage.getLatestCapacityAnalysis();
      if (!latestData) {
        return res.status(404).json({ message: 'No processed data available. Please process files first.' });
      }
      
      // Convert to ProcessingResult format
      const processingResult = {
        kpis: latestData.kpis as any,
        dailySummary: latestData.dailySummary as any,
        employeesByDate: latestData.employeesByDate as any,
        employeeSummaryByDate: latestData.employeeSummaryByDate as any,
        warnings: latestData.warnings as string[] | undefined,
        employeeLocations: await storage.getAllEmployeeLocations().then(locs => locs.map(loc => ({
          employeeName: loc.employeeName,
          homePostcode: loc.homePostcode,
          homeLat: loc.homeLat ? Number(loc.homeLat) : undefined,
          homeLng: loc.homeLng ? Number(loc.homeLng) : undefined,
          transportMode: loc.transportMode || undefined,
        }))),
        clientLocations: await storage.getAllClientLocations().then(locs => locs.map(loc => ({
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
      const [employees, clients] = await Promise.all([
        storage.getAllEmployeeLocations(),
        storage.getAllClientLocations()
      ]);
      
      res.json({
        employees,
        clients
      });
    } catch (error) {
      console.error('Error fetching locations:', error);
      res.status(500).json({ 
        error: 'Failed to fetch location data',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get latest weekly schedule
  app.get('/api/weekly-schedule/latest', async (req, res) => {
    try {
      const latestSchedule = await storage.getLatestWeeklySchedule();
      
      if (!latestSchedule) {
        return res.status(404).json({ message: 'No weekly schedules found' });
      }
      
      res.json(latestSchedule);
    } catch (error) {
      console.error('Error fetching latest weekly schedule:', error);
      res.status(500).json({ 
        message: 'Failed to fetch weekly schedule',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get weekly schedule by week
  app.get('/api/weekly-schedule/:weekStartDate', async (req, res) => {
    try {
      const { weekStartDate } = req.params;
      const { weekStart, weekEnd } = getCanonicalWeekBoundaries(weekStartDate);
      
      const schedule = await storage.getWeeklyScheduleByWeek(weekStart, weekEnd);
      
      if (!schedule) {
        return res.status(404).json({ message: 'Schedule not found for this week' });
      }
      
      res.json(schedule);
    } catch (error) {
      console.error('Error fetching weekly schedule:', error);
      res.status(500).json({ 
        message: 'Failed to fetch weekly schedule',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Save/update weekly schedule
  app.post('/api/weekly-schedule/save', async (req, res) => {
    try {
      const { weekStartDate, weekEndDate, scheduleData, unallocatedVisits, metrics } = req.body;
      
      if (!weekStartDate || !weekEndDate || !scheduleData || !metrics) {
        return res.status(400).json({ message: 'Missing required fields' });
      }
      
      const savedSchedule = await storage.saveWeeklySchedule({
        weekStartDate,
        weekEndDate,
        scheduleData,
        unallocatedVisits: unallocatedVisits || [],
        metrics,
      });
      
      res.json(savedSchedule);
    } catch (error) {
      console.error('Error saving weekly schedule:', error);
      res.status(500).json({ 
        message: 'Failed to save weekly schedule',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}