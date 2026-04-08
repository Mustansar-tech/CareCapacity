import { Request, Response } from 'express';
import { resolveBranch, isUkBst, ukScheduleTimeToUtc } from '../utils/helpers';
import { TravelTimeService, travelTimeService } from '../travel-time-service';
import { logger } from '../logger';

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
