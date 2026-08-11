import { Request, Response } from 'express';
import { resolveBranch } from '../utils/helpers';
import * as geoRepo from '../repositories/geo.repository';
import { geocodeWithFallback } from '../pipeline';
import { logger } from '../infrastructure/logger';

export async function geocodeBatch(req: Request, res: Response): Promise<void> {
  const { postcodes = [], addresses = [], branchId } = req.body;

  if (!branchId) {
    logger.warn('geocode-batch called without branchId, cache lookups may not work correctly');
  }

  const uniquePostcodes = Array.from(new Set(postcodes as string[]));
  logger.info('Parallel geocoding postcodes', { uniqueCount: uniquePostcodes.length, totalCount: postcodes.length, branchId: branchId || 'UNKNOWN' });

  const { storage } = await import('../storage');
  const cacheChecks = await Promise.all(
    uniquePostcodes.map(async (postcode: string) => {
      const normalizedPostcode = postcode.trim().toUpperCase();
      const cached = branchId ? await storage.getGeocode(branchId, `postcode:${normalizedPostcode}`) : undefined;
      return { postcode, normalizedPostcode, cached };
    }),
  );

  const cachedResults = cacheChecks.filter(c => c.cached).map(c => ({
    query: c.normalizedPostcode, input: c.postcode, postcode: c.postcode, type: 'postcode',
    lat: Number(c.cached!.lat), lng: Number(c.cached!.lng), source: 'cache', success: true, approximate: false,
  }));

  const uncachedPostcodes = cacheChecks.filter(c => !c.cached).map(c => c.postcode);
  logger.debug('Geocoding cache stats', { cached: cachedResults.length, uncached: uncachedPostcodes.length });

  const newResults = await Promise.all(
    uncachedPostcodes.map(async (postcode: string) => {
      try {
        const geocodeResult = await geocodeWithFallback(postcode, storage, branchId);
        if (geocodeResult && geocodeResult.lat && geocodeResult.lng) {
          return { ...geocodeResult, input: postcode, postcode, success: true, lat: Number(geocodeResult.lat), lng: Number(geocodeResult.lng) };
        }
        return { query: postcode, input: postcode, postcode, type: 'postcode', error: 'No coordinates returned', success: false, source: 'none' };
      } catch (error) {
        logger.error('Error geocoding postcode', error, { postcode });
        return { query: postcode, input: postcode, postcode, type: 'postcode', error: 'Geocoding completely failed', success: false, source: 'error' };
      }
    }),
  );

  const results = [...cachedResults, ...newResults];
  for (const address of addresses) {
    results.push({ query: address, type: 'address', error: 'Address geocoding not implemented yet', source: 'none' });
  }
  res.json({ results });
}

export async function distanceMatrix(req: Request, res: Response): Promise<void> {
  const { origins, destinations } = req.body;
  if (!origins || !destinations || origins.length === 0 || destinations.length === 0) {
    res.status(400).json({ message: 'Origins and destinations are required' }); return;
  }
  const ORS_API_KEY = process.env.ORS_API_KEY;
  if (!ORS_API_KEY) { res.status(500).json({ message: 'OpenRouteService API key not configured' }); return; }

  const originsCoords = origins.map((o: any) => [parseFloat(o.lng), parseFloat(o.lat)]);
  const destinationsCoords = destinations.map((d: any) => [parseFloat(d.lng), parseFloat(d.lat)]);

  const response = await fetch('https://api.openrouteservice.org/v2/matrix/driving-car', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: ORS_API_KEY },
    body: JSON.stringify({
      locations: [...originsCoords, ...destinationsCoords],
      sources: Array.from({ length: origins.length }, (_, i) => i),
      destinations: Array.from({ length: destinations.length }, (_, i) => origins.length + i),
      metrics: ['duration', 'distance'],
    }),
  });

  if (!response.ok) throw new Error(`OpenRouteService error: ${response.status}`);
  const data = await response.json();
  res.json({ durations: data.durations, distances: data.distances, origins, destinations });
}

export async function optimizeRouting(req: Request, res: Response): Promise<void> {
  const branchId = await resolveBranch(req);
  const { date, employeeIds = [] } = req.body;
  if (!date) { res.status(400).json({ message: 'Date is required' }); return; }

  const { storage } = await import('../storage');
  const optimizedRoutes = [];
  for (const employeeId of employeeIds) {
    const employeeLocation = await storage.getEmployeeLocationByName(branchId, employeeId);
    if (employeeLocation) {
      const routePlan = await geoRepo.saveRoutePlan({
        branchId, date, employeeId: employeeLocation.id,
        status: 'infeasible',
        warnings: ['Route optimization algorithm not yet implemented'],
      });
      optimizedRoutes.push(routePlan);
    }
  }
  res.json({ optimizedRoutes });
}

export async function getRoutingPlans(req: Request, res: Response): Promise<void> {
  const branchId = await resolveBranch(req);
  const date = req.query.date as string;
  if (!date) { res.status(400).json({ message: 'Date parameter is required' }); return; }

  const plans = await geoRepo.getRoutePlansByDate(branchId, date);
  const plansWithStops = await Promise.all(
    plans.map(async (plan) => {
      const stops = await geoRepo.getRouteStopsByPlan(plan.id);
      return { ...plan, stops };
    }),
  );
  res.json(plansWithStops);
}

export async function getEmployeeLocations(req: Request, res: Response): Promise<void> {
  const branchId = await resolveBranch(req);
  const locations = await geoRepo.getAllEmployeeLocations(branchId);
  res.json(locations);
}

export async function getClientLocations(req: Request, res: Response): Promise<void> {
  const branchId = await resolveBranch(req);
  const locations = await geoRepo.getAllClientLocations(branchId);
  res.json(locations);
}

export async function geocodeSingle(req: Request, res: Response): Promise<void> {
  const { postcode } = req.params;
  if (!postcode) { res.status(400).json({ error: 'postcode required' }); return; }
  const branchId = await resolveBranch(req);
  const { storage } = await import('../storage');
  const result = await geocodeWithFallback(postcode.trim().toUpperCase(), storage, branchId);
  if (result?.lat && result?.lng) {
    res.json({ postcode: result.query, lat: parseFloat(result.lat), lng: parseFloat(result.lng) });
  } else {
    res.status(404).json({ error: 'Postcode not found' });
  }
}

export async function getAllLocations(req: Request, res: Response): Promise<void> {
  const branchId = await resolveBranch(req);
  const [employees, clients] = await Promise.all([
    geoRepo.getAllEmployeeLocations(branchId),
    geoRepo.getAllClientLocations(branchId),
  ]);
  res.json({
    employees: employees.filter(e => e.homeLat && e.homeLng),
    clients: clients.filter(c => c.lat && c.lng),
    fetchedAt: new Date().toISOString(),
    totalInUpload: employees.length,
    totalClientsInUpload: clients.length,
  });
}
