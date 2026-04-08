import type { Express } from 'express';
import { storage } from '../storage';
import { logger } from '../logger';
import { safeErrorMessage, resolveBranch } from '../utils/helpers';
import { geocodeWithFallback } from '../pipeline';

export function registerGeoRoutes(app: Express): void {
  app.post('/api/geo/geocode-batch', async (req, res) => {
    try {
      const { postcodes = [], addresses = [], branchId } = req.body;

      if (!branchId) {
        logger.warn('geocode-batch called without branchId, cache lookups may not work correctly');
      }

      const uniquePostcodes = Array.from(new Set(postcodes as string[]));
      logger.info('Parallel geocoding postcodes', {
        uniqueCount: uniquePostcodes.length,
        totalCount: postcodes.length,
        branchId: branchId || 'UNKNOWN',
      });

      const cacheChecks = await Promise.all(
        uniquePostcodes.map(async (postcode) => {
          const normalizedPostcode = postcode.trim().toUpperCase();
          const cached = branchId
            ? await storage.getGeocode(branchId, `postcode:${normalizedPostcode}`)
            : undefined;
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
        approximate: false,
      }));

      const uncachedPostcodes = cacheChecks.filter(c => !c.cached).map(c => c.postcode);

      logger.debug('Geocoding cache stats', { cached: cachedResults.length, uncached: uncachedPostcodes.length });

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
              lng: Number(geocodeResult.lng),
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
              source: 'none',
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
            source: 'error',
          };
        }
      });

      const newResults = await Promise.all(postcodePromises);
      const results = [...cachedResults, ...newResults];

      for (const address of addresses) {
        results.push({
          query: address,
          type: 'address',
          error: 'Address geocoding not implemented yet',
          source: 'none',
        });
      }

      res.json({ results });
    } catch (error) {
      logger.error('Geocoding error', error);
      res.status(500).json({ message: 'Geocoding failed' });
    }
  });

  app.post('/api/routing/distance-matrix', async (req, res) => {
    try {
      const { origins, destinations } = req.body;

      if (!origins || !destinations || origins.length === 0 || destinations.length === 0) {
        return res.status(400).json({ message: 'Origins and destinations are required' });
      }

      const originsCoords = origins.map((o: any) => [parseFloat(o.lng), parseFloat(o.lat)]);
      const destinationsCoords = destinations.map((d: any) => [parseFloat(d.lng), parseFloat(d.lat)]);

      const ORS_API_KEY = process.env.ORS_API_KEY;
      if (!ORS_API_KEY) {
        return res.status(500).json({ message: 'OpenRouteService API key not configured' });
      }

      const response = await fetch('https://api.openrouteservice.org/v2/matrix/driving-car', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: ORS_API_KEY,
        },
        body: JSON.stringify({
          locations: [...originsCoords, ...destinationsCoords],
          sources: Array.from({ length: origins.length }, (_, i) => i),
          destinations: Array.from({ length: destinations.length }, (_, i) => origins.length + i),
          metrics: ['duration', 'distance'],
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenRouteService error: ${response.status}`);
      }

      const data = await response.json();
      const matrix = {
        durations: data.durations,
        distances: data.distances,
        origins: origins,
        destinations: destinations,
      };

      res.json(matrix);
    } catch (error) {
      logger.error('Distance matrix error', error);
      res.status(500).json({ message: 'Distance matrix calculation failed' });
    }
  });

  app.post('/api/routing/optimize', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const { date, employeeIds = [] } = req.body;

      if (!date) return res.status(400).json({ message: 'Date is required' });

      const optimizedRoutes = [];
      for (const employeeId of employeeIds) {
        const employeeLocation = await storage.getEmployeeLocationByName(branchId, employeeId);
        if (employeeLocation) {
          const routePlan = await storage.saveRoutePlan({
            branchId,
            date,
            employeeId: employeeLocation.id,
            status: 'infeasible',
            warnings: ['Route optimization algorithm not yet implemented'],
          });
          optimizedRoutes.push(routePlan);
        }
      }

      res.json({ optimizedRoutes });
    } catch (error) {
      logger.error('Route optimization error', error);
      const message = safeErrorMessage(error, 'Route optimization failed');
      const statusCode =
        message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message });
    }
  });

  app.get('/api/routing/plans', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const date = req.query.date as string;
      if (!date) return res.status(400).json({ message: 'Date parameter is required' });

      const plans = await storage.getRoutePlansByDate(branchId, date);
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
      const statusCode =
        message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message });
    }
  });

  app.get('/api/geographical/employees', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const locations = await storage.getAllEmployeeLocations(branchId);
      res.json(locations);
    } catch (error) {
      logger.error('Get employee locations error', error);
      const message = safeErrorMessage(error, 'Failed to get employee locations');
      const statusCode =
        message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message });
    }
  });

  app.get('/api/geographical/clients', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const locations = await storage.getAllClientLocations(branchId);
      res.json(locations);
    } catch (error) {
      logger.error('Get client locations error', error);
      const message = safeErrorMessage(error, 'Failed to get client locations');
      const statusCode =
        message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message });
    }
  });

  app.get('/api/locations', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const [employees, clients] = await Promise.all([
        storage.getAllEmployeeLocations(branchId),
        storage.getAllClientLocations(branchId),
      ]);

      const validEmployees = employees.filter(e => e.homeLat && e.homeLng);
      const validClients = clients.filter(c => c.lat && c.lng);

      res.json({
        employees: validEmployees,
        clients: validClients,
        fetchedAt: new Date().toISOString(),
        totalInUpload: employees.length,
        totalClientsInUpload: clients.length,
      });
    } catch (error) {
      logger.error('Error fetching locations', error);
      const message = safeErrorMessage(error, 'Failed to fetch location data');
      const statusCode =
        message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ error: message, details: safeErrorMessage(error, 'An error occurred') });
    }
  });
}
