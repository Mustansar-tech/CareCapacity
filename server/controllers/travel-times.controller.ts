import { Request, Response } from 'express';
import { resolveBranch, isUkBst, ukScheduleTimeToUtc } from '../utils/helpers';
import { TravelTimeService, travelTimeService } from '../features/travel/travel-time-service';
import { logger } from '../infrastructure/logger';

// A schedule can require hundreds of matrix requests. Return one bounded block
// at a time instead of holding a browser request open for the entire prewarm.
export async function scheduleTravelBlock(req: Request, res: Response): Promise<void> {
  await resolveBranch(req);
  const { sources, destinations } = req.body ?? {};
  const validLocations = (locations: unknown): locations is Array<{ lat: number; lng: number }> =>
    Array.isArray(locations) && locations.length > 0 && locations.length <= 12 &&
    locations.every(loc => loc && Number.isFinite(loc.lat) && Math.abs(loc.lat) <= 90 &&
      Number.isFinite(loc.lng) && Math.abs(loc.lng) <= 180);

  if (!validLocations(sources) || !validLocations(destinations)) {
    res.status(400).json({ error: 'sources and destinations must each contain 1–12 valid locations' });
    return;
  }

  // Isolate each block from concurrent debug/matcher requests that reset the
  // shared service cache. No new persistent cache or database writes.
  const service = new TravelTimeService(45, undefined, 20_000);
  if (!service.hasCarMatrixKey()) {
    res.status(503).json({ error: 'Road-travel routing is unavailable. Schedule generation stopped.' });
    return;
  }
  await service.carMatrixBatch(sources, destinations);
  const results = sources.flatMap(from => destinations.map(to => {
    const cached = service.getCachedTravelTime(from, to, 'car');
    return {
      fromLat: from.lat, fromLng: from.lng, toLat: to.lat, toLng: to.lng,
      mode: 'car', durationMinutes: cached?.durationMinutes ?? 9999,
      source: cached?.source ?? 'unreachable',
    };
  }));
  const hasDistinctPair = sources.some(from =>
    destinations.some(to => from.lat !== to.lat || from.lng !== to.lng));
  // Valid matrices containing null routes mean genuinely unreachable pairs,
  // not an outage. Keep those as 9999, just as the scheduler already does.
  if (hasDistinctPair && !service.hasValidRoadResponse()) {
    res.status(503).json({ error: 'No road-travel times were returned for this block. Schedule generation stopped; please retry.' });
    return;
  }
  logger.info(`[Schedule Travel Block] ${sources.length}×${destinations.length} complete`);
  res.json({ results, travelSources: service.getSourceStats() });
}

export async function pairsTravelTimes(req: Request, res: Response): Promise<void> {
  const branchId = await resolveBranch(req);
  const { pairs } = req.body as {
    pairs: Array<{
      fromLat: number; fromLng: number; toLat: number; toLng: number;
      mode: string; visitDate?: string; startTimeMinutes?: number;
    }>;
  };
  if (!Array.isArray(pairs) || pairs.length === 0) {
    res.json({ results: [] });
    return;
  }
  // Clear the in-memory session cache before this request so every lookup
  // reflects a live ORS call rather than a value left over from an earlier,
  // unrelated request in this server process (see bdMatch for the same pattern).
  travelTimeService.resetSourceStats();
  const results = await Promise.all(pairs.map(async p => {
    try {
      const mode = TravelTimeService.normalizeMode(p.mode);
      let arrivalTime: Date | undefined;
      if (p.startTimeMinutes !== undefined && p.visitDate) {
        arrivalTime = ukScheduleTimeToUtc(p.visitDate, p.startTimeMinutes);
      }
      const result = await travelTimeService.calculateTravelTime(
        branchId,
        { lat: p.fromLat, lng: p.fromLng },
        { lat: p.toLat, lng: p.toLng },
        mode,
        arrivalTime,
      );
      return { durationMinutes: result?.travelTimeMinutes ?? null, source: result?.source ?? null };
    } catch (err) {
      logger.warn(`pairsTravelTimes: failed for pair ${p.fromLat},${p.fromLng}→${p.toLat},${p.toLng}: ${err}`);
      return { durationMinutes: null, source: 'error' };
    }
  }));
  res.json({ results });
}

export async function batchTravelTimes(req: Request, res: Response): Promise<void> {
  const branchId = await resolveBranch(req);
  const { employees, clients, weekStart, earliestStartTime } = req.body as {
    employees: Array<{ lat: number; lng: number; mode: string }>;
    clients: Array<{ lat: number; lng: number }>;
    weekStart?: string;
    earliestStartTime?: string;
  };

  if (!Array.isArray(employees) || !Array.isArray(clients)) {
    res.status(400).json({ error: 'employees and clients arrays are required' });
    return;
  }

  const validEmployees = employees.filter(e => e.lat && e.lng);
  const validClients = clients.filter(c => c.lat && c.lng);

  if (validEmployees.length === 0 || validClients.length === 0) {
    res.json({ results: [] });
    return;
  }

  const normalizedEmployees = validEmployees.map((e, i) => ({
    id: String(i), lat: e.lat, lng: e.lng,
    transportMode: TravelTimeService.normalizeMode(e.mode),
  }));

  const modeSummary = normalizedEmployees.reduce<Record<string, number>>((acc, e) => {
    acc[e.transportMode] = (acc[e.transportMode] || 0) + 1;
    return acc;
  }, {});

  logger.info(`[Travel Batch] Mode distribution: ${JSON.stringify(modeSummary)}. Schedule: ${weekStart || 'no date'} @${earliestStartTime || '08:00'}`);

  travelTimeService.resetSourceStats();
  await travelTimeService.prewarmTravelCache(
    branchId,
    normalizedEmployees,
    validClients.map((c, i) => ({ id: String(i), lat: c.lat, lng: c.lng })),
    weekStart,
    earliestStartTime,
  );

  const sessionResults = travelTimeService.getSessionResults();
  const travelSources = travelTimeService.getSourceStats();

  logger.info(`[Travel Batch] Returned ${sessionResults.length} travel times for ${validEmployees.length} employees × ${validClients.length} clients. Sources: ${JSON.stringify(travelSources)}`);
  res.json({ results: sessionResults, travelSources });
}

export async function debugSingleTravelTime(req: Request, res: Response): Promise<void> {
  const branchId = await resolveBranch(req);
  const { fromLat, fromLng, toLat, toLng, mode, visitDate, arrivalTimeMinutes } = req.body as {
    fromLat: number; fromLng: number; toLat: number; toLng: number;
    mode: string; visitDate?: string; arrivalTimeMinutes?: number;
  };

  if (fromLat == null || fromLng == null || toLat == null || toLng == null) {
    res.status(400).json({ error: 'fromLat, fromLng, toLat, toLng are required' });
    return;
  }

  const normalizedMode = TravelTimeService.normalizeMode(mode);
  const from = { lat: fromLat, lng: fromLng };
  const to = { lat: toLat, lng: toLng };

  let arrivalTime: Date | undefined;
  if (arrivalTimeMinutes !== undefined && arrivalTimeMinutes !== null && visitDate) {
    arrivalTime = ukScheduleTimeToUtc(visitDate, arrivalTimeMinutes);
  } else if (arrivalTimeMinutes !== undefined && arrivalTimeMinutes !== null) {
    arrivalTime = ukScheduleTimeToUtc(new Date().toISOString().slice(0, 10), arrivalTimeMinutes);
  }

  const isoTimestamp = arrivalTime ? arrivalTime.toISOString() : null;
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayOfWeek = arrivalTime ? dayNames[arrivalTime.getUTCDay()] : null;
  const bstActive = arrivalTime ? isUkBst(arrivalTime) : false;

  const R2 = 6371;
  const dLat2 = (toLat - fromLat) * Math.PI / 180;
  const dLng2 = (toLng - fromLng) * Math.PI / 180;
  const a2 = Math.sin(dLat2 / 2) ** 2 + Math.cos(fromLat * Math.PI / 180) * Math.cos(toLat * Math.PI / 180) * Math.sin(dLng2 / 2) ** 2;
  const distKm = R2 * 2 * Math.atan2(Math.sqrt(a2), Math.sqrt(1 - a2));
  const ttTransportType = normalizedMode === 'car' ? 'driving' : distKm <= 1.6 ? 'walking' : 'public_transport';

  const requestBody = {
    _endpoint: 'POST https://api.traveltimeapp.com/v4/time-filter',
    locations: [
      { id: 'origin', coords: { lat: fromLat, lng: fromLng } },
      { id: 'destination', coords: { lat: toLat, lng: toLng } },
    ],
    arrival_searches: [{
      id: 'search',
      arrival_location_id: 'destination',
      departure_location_ids: ['origin'],
      transportation: { type: ttTransportType },
      arrival_time: isoTimestamp,
      travel_time: 7200,
      properties: ['travel_time'],
    }],
  };

  // Same reasoning as pairsTravelTimes/bdMatch — always hit ORS/TravelTime live for a debug lookup.
  travelTimeService.resetSourceStats();

  const [result, compare] = await Promise.all([
    travelTimeService.calculateTravelTime(branchId, from, to, normalizedMode, arrivalTime),
    travelTimeService.debugCompareBothEndpoints({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng }, ttTransportType, arrivalTime),
  ]);

  res.json({
    requestSent: requestBody,
    isoTimestamp, dayOfWeek, bstActive,
    distanceKm: Math.round(distKm * 100) / 100,
    transportMode: ttTransportType,
    results: {
      'time-filter': compare.timeFilter,
      'time-filter/fast': compare.timeFilterFast,
      timePeriodUsedByFast: compare.timePeriod,
      systemCurrentlyUses: compare.timeFilter,
    },
    durationMinutes: result?.travelTimeMinutes ?? null,
    source: result?.source ?? null,
    note: 'Compare time-filter vs time-filter/fast to see which matches your playground result',
  });
}
