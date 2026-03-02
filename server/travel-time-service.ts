/**
 * Travel Time Service for Route Optimization
 *
 * Car employees:
 *   1. ORS Matrix API (batch pre-warm)
 *   2. ORS Directions API (individual fallback)
 *   3. OSRM public API (real road, free, no key)
 *   4. Haversine heuristic (last resort)
 *
 * Walker / public transport employees:
 *   1. TravelTime Matrix API (batch pre-warm, real public-transport times)
 *   2. TravelTime single search API (individual fallback)
 *   3. Haversine heuristic (last resort)
 */

import { storage } from "./storage";
import { logger } from './logger';

export interface Location {
  lat: number;
  lng: number;
}

export interface TravelMatrix {
  fromLocation: Location;
  toLocation: Location;
  distanceKm: number;
  travelTimeMinutes: number;
  feasible: boolean;
  penaltyScore: number;
}

export type TransportMode = "car" | "walking" | "public";

const ORS_MATRIX_BATCH_SIZE = 25;
const TRAVELTIME_MATRIX_BATCH_SIZE = 20;
const OSRM_TIMEOUT_MS = 8000;
const TRAVELTIME_TIMEOUT_MS = 10000;

export class TravelTimeService {
  private readonly ROAD_FACTOR = 1.2;

  private readonly MODE_CONFIG: Record<TransportMode, { speedKmh: number; overheadMinutes: number; minMinutes: number }> = {
    car:     { speedKmh: 35, overheadMinutes: 0,  minMinutes: 5  },
    walking: { speedKmh: 5,  overheadMinutes: 2,  minMinutes: 5  },
    public:  { speedKmh: 15, overheadMinutes: 5,  minMinutes: 5  },
  };

  private readonly maxTravelMinutes: number;
  private readonly softLimitMinutes: number;
  private readonly ORS_API_KEY = process.env.ORS_API_KEY;
  private readonly TRAVELTIME_APP_ID = process.env.TRAVELTIME_APP_ID;
  private readonly TRAVELTIME_API_KEY = process.env.TRAVELTIME_API_KEY;

  constructor(maxTravelMinutes: number = 45, softLimitMinutes?: number) {
    this.maxTravelMinutes = maxTravelMinutes;
    this.softLimitMinutes = softLimitMinutes || Math.round(maxTravelMinutes * 0.75);
  }

  private getTimeOfDayMultiplier(startTimeMinutes?: number): number {
    if (startTimeMinutes === undefined) return 1.0;
    const hours = startTimeMinutes / 60;
    if (hours >= 7 && hours < 9.5) return 1.3;
    if (hours >= 15.5 && hours < 18.5) return 1.25;
    return 1.0;
  }

  private calculateHeuristicTravelTime(straightLineKm: number, mode: TransportMode, startTimeMinutes?: number): number {
    const roadDistanceKm = straightLineKm * this.ROAD_FACTOR;
    const config = this.MODE_CONFIG[mode] || this.MODE_CONFIG.car;
    const baseTravelMinutes = (roadDistanceKm / config.speedKmh) * 60 + config.overheadMinutes;
    const congestionMultiplier = (mode === 'car') ? this.getTimeOfDayMultiplier(startTimeMinutes) : 1.0;
    return Math.max(config.minMinutes, Math.round(baseTravelMinutes * congestionMultiplier));
  }

  private calculateHaversineDistance(from: Location, to: Location): number {
    const R = 6371;
    const dLat = this.toRadians(to.lat - from.lat);
    const dLng = this.toRadians(to.lng - from.lng);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(from.lat)) * Math.cos(this.toRadians(to.lat)) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRadians(deg: number): number { return deg * (Math.PI / 180); }

  private calculatePenalty(minutes: number): number {
    if (minutes <= this.softLimitMinutes) return 0;
    const excess = minutes - this.softLimitMinutes;
    const maxExcess = this.maxTravelMinutes - this.softLimitMinutes;
    return Math.pow(excess / maxExcess, 2) * 100;
  }

  /**
   * Map our TransportMode to TravelTime API transportation type.
   * Both "walking" and "public" employees use public_transport — walkers
   * are treated exactly like public transport users since they rely on buses/trains
   * between visits (they don't have a car).
   */
  private toTravelTimeTransport(mode: TransportMode): string {
    return 'public_transport';
  }

  private hasTravelTimeCredentials(): boolean {
    return !!(this.TRAVELTIME_APP_ID && this.TRAVELTIME_API_KEY);
  }

  /**
   * TravelTime single-search API — point-to-point public transport / walking time.
   * Uses the /v4/routes endpoint for a single origin → destination query.
   * Returns duration in minutes, or null on failure.
   */
  private async fetchTravelTimeSingle(
    from: Location,
    to: Location,
    mode: TransportMode,
    departureTime?: Date
  ): Promise<{ durationMinutes: number } | null> {
    if (!this.hasTravelTimeCredentials()) return null;

    try {
      const departure = (departureTime || new Date()).toISOString();
      const transportation = this.toTravelTimeTransport(mode);

      const body = {
        locations: [
          { id: 'origin', coords: { lat: from.lat, lng: from.lng } },
          { id: 'destination', coords: { lat: to.lat, lng: to.lng } },
        ],
        departure_searches: [
          {
            id: 'search',
            departure_location_id: 'origin',
            arrival_location_ids: ['destination'],
            transportation: { type: transportation },
            departure_time: departure,
            travel_time: 7200,
            properties: ['travel_time'],
          },
        ],
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TRAVELTIME_TIMEOUT_MS);

      const response = await fetch('https://api.traveltimeapp.com/v4/time-filter', {
        method: 'POST',
        headers: {
          'X-Application-Id': this.TRAVELTIME_APP_ID!,
          'X-Api-Key': this.TRAVELTIME_API_KEY!,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        const results = data?.results?.[0]?.locations;
        if (results && results.length > 0) {
          const travelTimeSec = results[0]?.properties?.[0]?.travel_time;
          if (travelTimeSec != null) {
            return { durationMinutes: Math.max(1, Math.round(travelTimeSec / 60)) };
          }
        }
        logger.debug(`TravelTime single: destination unreachable within time limit for mode ${mode}`);
        return null;
      } else {
        const errText = await response.text();
        logger.warn(`TravelTime single API error (${response.status}): ${errText.slice(0, 200)}`);
        return null;
      }
    } catch (error) {
      logger.warn('TravelTime single fetch failed:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * TravelTime Matrix (time-filter/fast) — batch public transport times.
   * Fetches one source → many destinations in a single API call.
   * Returns a map: destinationIndex → durationMinutes, or null on failure.
   */
  private async fetchTravelTimeMatrix(
    source: { lat: number; lng: number },
    destinations: Array<{ lat: number; lng: number }>,
    mode: TransportMode,
    departureTime?: Date
  ): Promise<Map<number, number> | null> {
    if (!this.hasTravelTimeCredentials() || destinations.length === 0) return null;

    try {
      const departure = (departureTime || new Date()).toISOString();
      const transportation = this.toTravelTimeTransport(mode);

      const locations = [
        { id: 'source', coords: { lat: source.lat, lng: source.lng } },
        ...destinations.map((d, i) => ({ id: `dest_${i}`, coords: { lat: d.lat, lng: d.lng } })),
      ];

      const body = {
        locations,
        departure_searches: [
          {
            id: 'matrix',
            departure_location_id: 'source',
            arrival_location_ids: destinations.map((_, i) => `dest_${i}`),
            transportation: { type: transportation },
            departure_time: departure,
            travel_time: 7200,
            properties: ['travel_time'],
          },
        ],
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TRAVELTIME_TIMEOUT_MS);

      const response = await fetch('https://api.traveltimeapp.com/v4/time-filter', {
        method: 'POST',
        headers: {
          'X-Application-Id': this.TRAVELTIME_APP_ID!,
          'X-Api-Key': this.TRAVELTIME_API_KEY!,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        const results = data?.results?.[0]?.locations || [];
        const resultMap = new Map<number, number>();
        for (const loc of results) {
          const match = loc.id?.match(/^dest_(\d+)$/);
          if (!match) continue;
          const idx = parseInt(match[1], 10);
          const travelTimeSec = loc?.properties?.[0]?.travel_time;
          if (travelTimeSec != null) {
            resultMap.set(idx, Math.max(1, Math.round(travelTimeSec / 60)));
          }
        }
        return resultMap;
      } else {
        const errText = await response.text();
        logger.warn(`TravelTime matrix API error (${response.status}): ${errText.slice(0, 200)}`);
        return null;
      }
    } catch (error) {
      logger.warn('TravelTime matrix fetch failed:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * OSRM fallback — real road distances via OpenStreetMap, free, no API key.
   * Used for car employees when ORS is unavailable.
   */
  private async fetchOSRMRoute(from: Location, to: Location): Promise<{ durationMinutes: number; distanceMeters: number } | null> {
    try {
      const url = `http://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok) {
        const data = await response.json();
        if (data.code === 'Ok' && data.routes?.length > 0) {
          return {
            durationMinutes: Math.max(2, Math.round(data.routes[0].duration / 60)),
            distanceMeters: Math.round(data.routes[0].distance),
          };
        }
      }
    } catch (error) {
      logger.debug('OSRM route fetch failed:', error instanceof Error ? error.message : error);
    }
    return null;
  }

  private isWalkerOrPublic(mode: TransportMode): boolean {
    return mode === 'walking' || mode === 'public';
  }

  async calculateTravelTime(
    branchId: string,
    from: Location,
    to: Location,
    transportMode: TransportMode = "car"
  ): Promise<TravelMatrix> {
    const fromLat = from.lat.toString();
    const fromLng = from.lng.toString();
    const toLat = to.lat.toString();
    const toLng = to.lng.toString();

    const currentMaxTravel = this.isWalkerOrPublic(transportMode) ? 90 : this.maxTravelMinutes;
    const isNonCar = this.isWalkerOrPublic(transportMode);

    // 1. Check cache
    // For walkers/public: accept traveltime or traveltime-matrix sources; reject old heuristic/ors entries
    // For car: accept ors, ors-matrix, osrm, or heuristic
    try {
      const cached = await storage.getTravelTime(branchId, fromLat, fromLng, toLat, toLng, transportMode);
      if (cached) {
        const isRealTravelTime = cached.source === 'traveltime' || cached.source === 'traveltime-matrix';
        const isCarRealRoad = cached.source === 'ors' || cached.source === 'ors-matrix' || cached.source === 'osrm';
        const isHeuristic = cached.source === 'heuristic';

        let useCache = false;
        if (isNonCar) {
          useCache = isRealTravelTime || (isHeuristic && !this.hasTravelTimeCredentials());
        } else {
          useCache = isCarRealRoad || isHeuristic;
        }

        if (useCache) {
          return {
            fromLocation: from,
            toLocation: to,
            distanceKm: (cached.distanceMeters || 0) / 1000,
            travelTimeMinutes: cached.durationMinutes,
            feasible: cached.durationMinutes <= currentMaxTravel,
            penaltyScore: this.calculatePenalty(cached.durationMinutes),
          };
        }

        if (isNonCar && (isCarRealRoad || (isHeuristic && this.hasTravelTimeCredentials()))) {
          logger.debug(`Refreshing stale cache for walker/public (${cached.source}) with TravelTime API`);
        }
      }
    } catch (e) {
      logger.error("Cache lookup failed:", e);
    }

    // 2a. Walker / public transport — use TravelTime API (single search)
    if (isNonCar) {
      const tt = await this.fetchTravelTimeSingle(from, to, transportMode);
      if (tt) {
        logger.debug(`TravelTime single result: ${tt.durationMinutes} min for ${transportMode}`);
        const distanceKm = this.calculateHaversineDistance(from, to);
        try {
          await storage.saveTravelTime({
            branchId, fromLat, fromLng, toLat, toLng,
            transportMode,
            durationMinutes: tt.durationMinutes,
            distanceMeters: Math.round(distanceKm * this.ROAD_FACTOR * 1000),
            source: 'traveltime',
          });
        } catch (e) {
          logger.error("Cache save (traveltime) failed:", e);
        }
        return {
          fromLocation: from,
          toLocation: to,
          distanceKm: Math.round(distanceKm * this.ROAD_FACTOR * 100) / 100,
          travelTimeMinutes: tt.durationMinutes,
          feasible: tt.durationMinutes <= currentMaxTravel,
          penaltyScore: this.calculatePenalty(tt.durationMinutes),
        };
      }

      // 2b. TravelTime unavailable — fall through to heuristic
      logger.warn(`TravelTime API unavailable for ${fromLat},${fromLng} → ${toLat},${toLng} (${transportMode}) — using heuristic`);
      const distanceKm = this.calculateHaversineDistance(from, to);
      const travelTimeMinutes = this.calculateHeuristicTravelTime(distanceKm, transportMode);
      const roadDistanceKm = distanceKm * this.ROAD_FACTOR;
      logger.debug(`Haversine heuristic (${transportMode}): ${travelTimeMinutes} min for ${roadDistanceKm.toFixed(2)} km`);
      try {
        await storage.saveTravelTime({
          branchId, fromLat, fromLng, toLat, toLng,
          transportMode,
          durationMinutes: travelTimeMinutes,
          distanceMeters: Math.round(roadDistanceKm * 1000),
          source: 'heuristic',
        });
      } catch (e) {
        logger.error("Cache save (heuristic) failed:", e);
      }
      return {
        fromLocation: from,
        toLocation: to,
        distanceKm: Math.round(roadDistanceKm * 100) / 100,
        travelTimeMinutes,
        feasible: travelTimeMinutes <= currentMaxTravel,
        penaltyScore: this.calculatePenalty(travelTimeMinutes),
      };
    }

    // 3. Car — ORS Directions API
    if (this.ORS_API_KEY) {
      try {
        logger.debug(`Requesting ORS directions for ${fromLat},${fromLng} → ${toLat},${toLng}`);
        const response = await fetch(`https://api.openrouteservice.org/v2/directions/driving-car`, {
          method: 'POST',
          headers: {
            'Authorization': this.ORS_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ coordinates: [[from.lng, from.lat], [to.lng, to.lat]] }),
        });

        if (response.ok) {
          const data = await response.json();
          const durationMinutes = Math.max(2, Math.round(data.routes[0].summary.duration / 60));
          const distanceMeters = Math.round(data.routes[0].summary.distance);
          logger.debug(`ORS result: ${durationMinutes} min, ${distanceMeters} m`);
          await storage.saveTravelTime({ branchId, fromLat, fromLng, toLat, toLng, transportMode, durationMinutes, distanceMeters, source: 'ors' });
          return {
            fromLocation: from,
            toLocation: to,
            distanceKm: distanceMeters / 1000,
            travelTimeMinutes: durationMinutes,
            feasible: durationMinutes <= currentMaxTravel,
            penaltyScore: this.calculatePenalty(durationMinutes),
          };
        } else {
          const errorText = await response.text();
          logger.warn(`ORS API error (${response.status}) - trying OSRM fallback: ${errorText.slice(0, 200)}`);
        }
      } catch (error) {
        logger.warn("ORS API exception - trying OSRM fallback:", error instanceof Error ? error.message : error);
      }
    }

    // 4. Car — OSRM fallback
    const osrm = await this.fetchOSRMRoute(from, to);
    if (osrm) {
      logger.debug(`OSRM result: ${osrm.durationMinutes} min, ${osrm.distanceMeters} m`);
      try {
        await storage.saveTravelTime({ branchId, fromLat, fromLng, toLat, toLng, transportMode, durationMinutes: osrm.durationMinutes, distanceMeters: osrm.distanceMeters, source: 'osrm' });
      } catch (e) {
        logger.error("Cache save (OSRM) failed:", e);
      }
      return {
        fromLocation: from,
        toLocation: to,
        distanceKm: osrm.distanceMeters / 1000,
        travelTimeMinutes: osrm.durationMinutes,
        feasible: osrm.durationMinutes <= currentMaxTravel,
        penaltyScore: this.calculatePenalty(osrm.durationMinutes),
      };
    }

    // 5. Car — last-resort Haversine
    logger.warn(`OSRM also failed for ${fromLat},${fromLng} → ${toLat},${toLng} - falling back to Haversine`);
    const distanceKm = this.calculateHaversineDistance(from, to);
    const travelTimeMinutes = this.calculateHeuristicTravelTime(distanceKm, transportMode);
    const roadDistanceKm = distanceKm * this.ROAD_FACTOR;
    const config = this.MODE_CONFIG[transportMode] || this.MODE_CONFIG.car;
    logger.debug(`Haversine fallback (${transportMode}, ${config.speedKmh}km/h): ${travelTimeMinutes} min for ${roadDistanceKm.toFixed(2)} km`);

    try {
      await storage.saveTravelTime({ branchId, fromLat, fromLng, toLat, toLng, transportMode, durationMinutes: travelTimeMinutes, distanceMeters: Math.round(roadDistanceKm * 1000), source: 'heuristic' });
    } catch (e) {
      logger.error("Cache save (heuristic) failed:", e);
    }

    return {
      fromLocation: from,
      toLocation: to,
      distanceKm: Math.round(roadDistanceKm * 100) / 100,
      travelTimeMinutes,
      feasible: travelTimeMinutes <= currentMaxTravel,
      penaltyScore: this.calculatePenalty(travelTimeMinutes),
    };
  }

  /**
   * Pre-warm the travel time cache before scheduling starts.
   *
   * Car employees:    ORS Matrix → OSRM per-pair → Haversine
   * Walker/public:    TravelTime Matrix → TravelTime single → Haversine
   */
  async prewarmTravelCache(
    branchId: string,
    employeeLocations: Array<{ id: string; lat: number; lng: number; transportMode: TransportMode }>,
    clientLocations: Array<{ id: string; lat: number; lng: number }>
  ): Promise<void> {
    if (employeeLocations.length === 0 || clientLocations.length === 0) return;

    logger.info(`[Cache Pre-warm] Starting for ${employeeLocations.length} employees × ${clientLocations.length} clients`);
    const startTime = Date.now();
    let totalNew = 0;
    let totalHits = 0;

    const carEmployees = employeeLocations.filter(e => e.transportMode === 'car');
    const nonCarEmployees = employeeLocations.filter(e => this.isWalkerOrPublic(e.transportMode));

    // ── Walker / public: TravelTime Matrix API ──────────────────────────────
    if (nonCarEmployees.length > 0) {
      logger.info(`[Cache Pre-warm] Processing ${nonCarEmployees.length} walker/public employees via TravelTime API`);

      for (const emp of nonCarEmployees) {
        // Find uncached clients for this employee
        const uncachedClients: Array<{ idx: number; client: typeof clientLocations[0] }> = [];

        for (let ci = 0; ci < clientLocations.length; ci++) {
          const client = clientLocations[ci];
          try {
            const cached = await storage.getTravelTime(
              branchId,
              emp.lat.toString(), emp.lng.toString(),
              client.lat.toString(), client.lng.toString(),
              emp.transportMode
            );
            const isRealTravelTime = cached?.source === 'traveltime' || cached?.source === 'traveltime-matrix';
            if (cached && (isRealTravelTime || !this.hasTravelTimeCredentials())) {
              totalHits++;
            } else {
              uncachedClients.push({ idx: ci, client });
            }
          } catch (_) {
            uncachedClients.push({ idx: ci, client });
          }
        }

        if (uncachedClients.length === 0) continue;

        // Process in batches (TravelTime allows up to ~2000 locations per request on most plans)
        for (let bi = 0; bi < uncachedClients.length; bi += TRAVELTIME_MATRIX_BATCH_SIZE) {
          const batch = uncachedClients.slice(bi, bi + TRAVELTIME_MATRIX_BATCH_SIZE);
          const destinations = batch.map(b => ({ lat: b.client.lat, lng: b.client.lng }));

          let matrixSuccess = false;

          if (this.hasTravelTimeCredentials()) {
            const resultMap = await this.fetchTravelTimeMatrix(
              { lat: emp.lat, lng: emp.lng },
              destinations,
              emp.transportMode
            );

            if (resultMap && resultMap.size > 0) {
              for (let di = 0; di < batch.length; di++) {
                const durationMinutes = resultMap.get(di);
                const client = batch[di].client;
                if (durationMinutes != null) {
                  const distanceKm = this.calculateHaversineDistance(
                    { lat: emp.lat, lng: emp.lng },
                    { lat: client.lat, lng: client.lng }
                  );
                  try {
                    await storage.saveTravelTime({
                      branchId,
                      fromLat: emp.lat.toString(), fromLng: emp.lng.toString(),
                      toLat: client.lat.toString(), toLng: client.lng.toString(),
                      transportMode: emp.transportMode,
                      durationMinutes,
                      distanceMeters: Math.round(distanceKm * this.ROAD_FACTOR * 1000),
                      source: 'traveltime-matrix',
                    });
                    totalNew++;
                  } catch (_) {}
                }
              }
              logger.debug(`[Cache Pre-warm] TravelTime Matrix: emp ${emp.id} → ${batch.length} clients, got ${resultMap.size} results`);
              matrixSuccess = true;
            } else {
              logger.warn(`[Cache Pre-warm] TravelTime Matrix returned no results for emp ${emp.id} batch`);
            }
          }

          // For any clients not covered by the matrix (unreachable or API failed), fall back to heuristic
          if (!matrixSuccess) {
            logger.info(`[Cache Pre-warm] TravelTime Matrix failed — using heuristic for ${batch.length} pairs`);
            for (const { client } of batch) {
              const distanceKm = this.calculateHaversineDistance(
                { lat: emp.lat, lng: emp.lng },
                { lat: client.lat, lng: client.lng }
              );
              const durationMinutes = this.calculateHeuristicTravelTime(distanceKm, emp.transportMode);
              const roadDistanceKm = distanceKm * this.ROAD_FACTOR;
              try {
                await storage.saveTravelTime({
                  branchId,
                  fromLat: emp.lat.toString(), fromLng: emp.lng.toString(),
                  toLat: client.lat.toString(), toLng: client.lng.toString(),
                  transportMode: emp.transportMode,
                  durationMinutes,
                  distanceMeters: Math.round(roadDistanceKm * 1000),
                  source: 'heuristic',
                });
                totalNew++;
              } catch (_) {}
            }
          }
        }
      }
    }

    if (carEmployees.length === 0) {
      logger.info(`[Cache Pre-warm] Done in ${Date.now() - startTime}ms (walker/public only, ${totalNew} new, ${totalHits} hits)`);
      return;
    }

    // ── Car employees: ORS Matrix API ────────────────────────────────────────
    for (let ei = 0; ei < carEmployees.length; ei += ORS_MATRIX_BATCH_SIZE) {
      const empBatch = carEmployees.slice(ei, ei + ORS_MATRIX_BATCH_SIZE);

      for (let ci = 0; ci < clientLocations.length; ci += ORS_MATRIX_BATCH_SIZE) {
        const clientBatch = clientLocations.slice(ci, ci + ORS_MATRIX_BATCH_SIZE);

        const uncachedEmpSet = new Set<number>();
        const uncachedClientSet = new Set<number>();

        for (let e = 0; e < empBatch.length; e++) {
          for (let c = 0; c < clientBatch.length; c++) {
            try {
              const cached = await storage.getTravelTime(
                branchId,
                empBatch[e].lat.toString(), empBatch[e].lng.toString(),
                clientBatch[c].lat.toString(), clientBatch[c].lng.toString(),
                'car'
              );
              if (cached && cached.source !== 'haversine') {
                totalHits++;
              } else {
                uncachedEmpSet.add(e);
                uncachedClientSet.add(c);
              }
            } catch (_) {
              uncachedEmpSet.add(e);
              uncachedClientSet.add(c);
            }
          }
        }

        if (uncachedEmpSet.size === 0) continue;

        const neededEmps = Array.from(uncachedEmpSet).map(i => empBatch[i]);
        const neededClients = Array.from(uncachedClientSet).map(i => clientBatch[i]);

        let orsMatrixSuccess = false;
        if (this.ORS_API_KEY) {
          try {
            const allLocations = [
              ...neededEmps.map(e => [e.lng, e.lat]),
              ...neededClients.map(c => [c.lng, c.lat]),
            ];
            const sources = neededEmps.map((_, i) => i);
            const destinations = neededClients.map((_, i) => neededEmps.length + i);

            const response = await fetch('https://api.openrouteservice.org/v2/matrix/driving-car', {
              method: 'POST',
              headers: {
                'Authorization': this.ORS_API_KEY,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ locations: allLocations, metrics: ['duration', 'distance'], sources, destinations }),
            });

            if (response.ok) {
              const data = await response.json();
              const durations: (number | null)[][] = data.durations;
              const distances: (number | null)[][] = data.distances;

              for (let ei2 = 0; ei2 < neededEmps.length; ei2++) {
                for (let ci2 = 0; ci2 < neededClients.length; ci2++) {
                  const durationSec = durations?.[ei2]?.[ci2];
                  const distMeters = distances?.[ei2]?.[ci2];
                  if (durationSec == null || distMeters == null) continue;
                  const emp = neededEmps[ei2];
                  const client = neededClients[ci2];
                  try {
                    await storage.saveTravelTime({
                      branchId,
                      fromLat: emp.lat.toString(), fromLng: emp.lng.toString(),
                      toLat: client.lat.toString(), toLng: client.lng.toString(),
                      transportMode: 'car',
                      durationMinutes: Math.max(2, Math.round(durationSec / 60)),
                      distanceMeters: Math.round(distMeters),
                      source: 'ors-matrix',
                    });
                    totalNew++;
                  } catch (_) {}
                }
              }
              logger.debug(`[Cache Pre-warm] ORS Matrix: ${neededEmps.length}×${neededClients.length} batch populated`);
              orsMatrixSuccess = true;
            } else {
              const errText = await response.text();
              logger.warn(`[Cache Pre-warm] ORS Matrix batch failed (${response.status}): ${errText.slice(0, 200)}`);
            }
          } catch (err) {
            logger.warn('[Cache Pre-warm] ORS Matrix exception:', err instanceof Error ? err.message : err);
          }
        }

        if (!orsMatrixSuccess) {
          logger.info(`[Cache Pre-warm] ORS Matrix unavailable — using OSRM per-pair for ${neededEmps.length}×${neededClients.length} pairs`);
          for (const emp of neededEmps) {
            for (const client of neededClients) {
              const osrm = await this.fetchOSRMRoute({ lat: emp.lat, lng: emp.lng }, { lat: client.lat, lng: client.lng });
              if (osrm) {
                try {
                  await storage.saveTravelTime({
                    branchId,
                    fromLat: emp.lat.toString(), fromLng: emp.lng.toString(),
                    toLat: client.lat.toString(), toLng: client.lng.toString(),
                    transportMode: 'car',
                    durationMinutes: osrm.durationMinutes,
                    distanceMeters: osrm.distanceMeters,
                    source: 'osrm',
                  });
                  totalNew++;
                } catch (_) {}
              } else {
                const distanceKm = this.calculateHaversineDistance({ lat: emp.lat, lng: emp.lng }, { lat: client.lat, lng: client.lng });
                const durationMinutes = this.calculateHeuristicTravelTime(distanceKm, 'car');
                const roadDistanceKm = distanceKm * this.ROAD_FACTOR;
                try {
                  await storage.saveTravelTime({
                    branchId,
                    fromLat: emp.lat.toString(), fromLng: emp.lng.toString(),
                    toLat: client.lat.toString(), toLng: client.lng.toString(),
                    transportMode: 'car',
                    durationMinutes,
                    distanceMeters: Math.round(roadDistanceKm * 1000),
                    source: 'heuristic',
                  });
                  totalNew++;
                } catch (_) {}
              }
            }
          }
        }
      }
    }

    logger.info(`[Cache Pre-warm] Complete in ${Date.now() - startTime}ms — ${totalNew} new entries, ${totalHits} cache hits`);
  }

  async buildTravelMatrix(
    branchId: string,
    employeeLocations: Array<{ id: string; lat: number; lng: number; transportMode: TransportMode }>,
    clientLocations: Array<{ id: string; lat: number; lng: number }>
  ): Promise<Map<string, Map<string, TravelMatrix>>> {
    const matrix = new Map<string, Map<string, TravelMatrix>>();
    for (const emp of employeeLocations) {
      const empMatrix = new Map<string, TravelMatrix>();
      for (const client of clientLocations) {
        const travel = await this.calculateTravelTime(
          branchId,
          { lat: emp.lat, lng: emp.lng },
          { lat: client.lat, lng: client.lng },
          emp.transportMode
        );
        empMatrix.set(client.id, travel);
      }
      matrix.set(emp.id, empMatrix);
    }
    return matrix;
  }

  async getFeasibleClients(
    branchId: string,
    employeeLocation: Location,
    clientLocations: Array<{ id: string; lat: number; lng: number }>,
    transportMode: TransportMode = "car"
  ): Promise<Array<{ id: string; travelTime: TravelMatrix }>> {
    const feasibleClients = [];
    for (const client of clientLocations) {
      const travelTime = await this.calculateTravelTime(
        branchId,
        employeeLocation,
        { lat: client.lat, lng: client.lng },
        transportMode
      );
      if (travelTime.feasible) {
        feasibleClients.push({ id: client.id, travelTime });
      }
    }
    return feasibleClients.sort((a, b) => a.travelTime.travelTimeMinutes - b.travelTime.travelTimeMinutes);
  }
}

export const travelTimeService = new TravelTimeService();

function normalizeName(name: string): string {
  if (!name) return '';
  return name.trim().toLowerCase().replace(/\s+/g, ' ').replace(/['"''""]/g, '').replace(/['']/g, "'").replace(/\s*\([^)]*\)/g, '').trim();
}

async function getLocationCoordinates(branchId: string, name: string, type: 'client' | 'employee'): Promise<{ lat: number; lng: number } | null> {
  try {
    if (type === 'client') {
      let clientLocation = await storage.getClientLocationByName(branchId, name);
      if (!clientLocation) {
        const allClients = await storage.getAllClientLocations(branchId);
        clientLocation = allClients.find(client => {
          const storedName = normalizeName(client.clientName);
          const searchName = normalizeName(name);
          return storedName === searchName || storedName.includes(searchName) || searchName.includes(storedName);
        });
      }
      if (clientLocation && clientLocation.lat && clientLocation.lng) {
        return { lat: parseFloat(clientLocation.lat), lng: parseFloat(clientLocation.lng) };
      }
    } else if (type === 'employee') {
      let employeeLocation = await storage.getEmployeeLocationByName(branchId, name);
      if (!employeeLocation) {
        const allEmployees = await storage.getAllEmployeeLocations(branchId);
        employeeLocation = allEmployees.find(employee => {
          const storedName = normalizeName(employee.employeeName);
          const searchName = normalizeName(name);
          return storedName === searchName || storedName.includes(searchName) || searchName.includes(storedName);
        });
      }
      if (employeeLocation && employeeLocation.homeLat && employeeLocation.homeLng) {
        return { lat: parseFloat(employeeLocation.homeLat), lng: parseFloat(employeeLocation.homeLng) };
      }
    }
    return null;
  } catch (error) {
    logger.error(`Error getting location for ${type} ${name}:`, error);
    return null;
  }
}

export async function calculateTravelTime(
  branchId: string,
  employeeName: string,
  clientName: string,
  transportMode: TransportMode = 'car'
): Promise<number> {
  try {
    const employeeCoords = await getLocationCoordinates(branchId, employeeName, 'employee');
    const clientCoords = await getLocationCoordinates(branchId, clientName, 'client');
    if (!employeeCoords || !clientCoords) return 0;
    const travelMatrix = await travelTimeService.calculateTravelTime(branchId, employeeCoords, clientCoords, transportMode);
    return travelMatrix.travelTimeMinutes;
  } catch (error) {
    logger.error(`Error calculating travel time:`, error);
    return 0;
  }
}
