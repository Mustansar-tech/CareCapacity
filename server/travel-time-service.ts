/**
 * Travel Time Service for Route Optimization
 *
 * Car employees:
 *   1. ORS Matrix API (batch pre-warm, all-pairs including client→client)
 *   2. ORS Directions API (individual fallback)
 *   3. OSRM public API (real road, free, no key)
 *   [Heuristic DISABLED — unreachable pairs go to unallocated]
 *
 * Walker / public transport employees:
 *   1. TravelTime Matrix API (arrival_searches — arrive BY visit start time)
 *   2. TravelTime single search API (arrival_searches, individual fallback)
 *   [Heuristic DISABLED — unreachable pairs go to unallocated]
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
  source: string;
}

export interface TravelSourceStats {
  ors: number;
  'ors-matrix': number;
  osrm: number;
  traveltime: number;
  'traveltime-matrix': number;
  heuristic: number;
  unreachable: number;
  total: number;
}

export type TransportMode = "car" | "walking" | "public";

const ORS_MATRIX_BATCH_SIZE = 50;
const TRAVELTIME_MATRIX_BATCH_SIZE = 100;
const OSRM_TIMEOUT_MS = 8000;
const TRAVELTIME_TIMEOUT_MS = 10000;

export class TravelTimeService {
  private readonly ROAD_FACTOR = 1.2;

  private readonly MODE_CONFIG: Record<TransportMode, { speedKmh: number; overheadMinutes: number; minMinutes: number }> = {
    car:     { speedKmh: 35, overheadMinutes: 0,  minMinutes: 5  },
    walking: { speedKmh: 5,  overheadMinutes: 0,  minMinutes: 2  },
    public:  { speedKmh: 15, overheadMinutes: 5,  minMinutes: 5  },
  };

  private readonly maxTravelMinutes: number;
  private readonly softLimitMinutes: number;
  private readonly ORS_API_KEY = process.env.ORS_API_KEY;
  private readonly TRAVELTIME_APP_ID = process.env.TRAVELTIME_APP_ID;
  private readonly TRAVELTIME_API_KEY = process.env.TRAVELTIME_API_KEY;

  private _sourceStats: TravelSourceStats = { ors: 0, 'ors-matrix': 0, osrm: 0, traveltime: 0, 'traveltime-matrix': 0, heuristic: 0, unreachable: 0, total: 0 };
  private _sessionCache: Map<string, { durationMinutes: number; distanceMeters: number; source: string }> = new Map();

  constructor(maxTravelMinutes: number = 45, softLimitMinutes?: number) {
    this.maxTravelMinutes = maxTravelMinutes;
    this.softLimitMinutes = softLimitMinutes || Math.round(maxTravelMinutes * 0.75);
  }

  resetSourceStats(): void {
    this._sourceStats = { ors: 0, 'ors-matrix': 0, osrm: 0, traveltime: 0, 'traveltime-matrix': 0, heuristic: 0, unreachable: 0, total: 0 };
    this._sessionCache.clear();
  }

  getSourceStats(): TravelSourceStats {
    return { ...this._sourceStats };
  }

  getSessionResults(): Array<{ fromLat: number; fromLng: number; toLat: number; toLng: number; mode: string; durationMinutes: number; source: string }> {
    return Array.from(this._sessionCache.entries()).reduce<Array<{ fromLat: number; fromLng: number; toLat: number; toLng: number; mode: string; durationMinutes: number; source: string }>>((acc, [key, val]) => {
      const parts = key.split(':');
      if (parts.length === 5) {
        acc.push({
          fromLat: parseFloat(parts[0]),
          fromLng: parseFloat(parts[1]),
          toLat: parseFloat(parts[2]),
          toLng: parseFloat(parts[3]),
          mode: parts[4],
          durationMinutes: val.durationMinutes,
          source: val.source,
        });
      }
      return acc;
    }, []);
  }

  private sessionKey(fromLat: string, fromLng: string, toLat: string, toLng: string, mode: string): string {
    return `${fromLat}:${fromLng}:${toLat}:${toLng}:${mode}`;
  }

  private trackSource(source: string): void {
    const key = source as keyof TravelSourceStats;
    if (key in this._sourceStats) {
      (this._sourceStats[key] as number)++;
    }
    this._sourceStats.total++;
  }

  private calculateHeuristicTravelTime(straightLineKm: number, mode: TransportMode): number {
    const roadDistanceKm = straightLineKm * this.ROAD_FACTOR;
    const config = this.MODE_CONFIG[mode] || this.MODE_CONFIG.car;
    const baseTravelMinutes = (roadDistanceKm / config.speedKmh) * 60 + config.overheadMinutes;
    return Math.max(config.minMinutes, Math.round(baseTravelMinutes));
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

  private readonly WALK_THRESHOLD_KM = 1.6; // ~1 mile — closer than this, use TravelTime walking mode

  /**
   * Pick the TravelTime API transportation type based on straight-line distance.
   * ≤ 1 mile (1.6 km): use 'walking' — quicker and more realistic than waiting for a bus
   * >  1 mile (1.6 km): use 'public_transport' — bus/train is the realistic option
   */
  private toTravelTimeTransport(distanceKm: number): string {
    return distanceKm <= this.WALK_THRESHOLD_KM ? 'walking' : 'public_transport';
  }

  private hasTravelTimeCredentials(): boolean {
    return !!(this.TRAVELTIME_APP_ID && this.TRAVELTIME_API_KEY);
  }

  /**
   * TravelTime single-search API — point-to-point walking or public transport time.
   * Uses arrival_searches: "arrive at destination BY arrivalTime, how long is the journey?"
   * Picks walking vs public_transport automatically based on straight-line distance:
   *   ≤ 1.6 km  → walking (faster, no bus waiting time)
   *   > 1.6 km  → public_transport (bus/train is the realistic option)
   */
  private async fetchTravelTimeSingle(
    from: Location,
    to: Location,
    distanceKm: number,
    arrivalTime?: Date,
    forceMode?: string,
    departureTime?: Date
  ): Promise<{ durationMinutes: number } | null> {
    if (!this.hasTravelTimeCredentials()) return null;

    try {
      const transportation = forceMode ?? this.toTravelTimeTransport(distanceKm);

      // Use departure_searches when a departure time is given (return-home / break-departure legs).
      // Use arrival_searches when an arrival deadline is given (client visit legs).
      let body: object;
      if (departureTime) {
        const departure = departureTime.toISOString();
        body = {
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
      } else {
        const arrival = (arrivalTime || new Date()).toISOString();
        body = {
          locations: [
            { id: 'origin', coords: { lat: from.lat, lng: from.lng } },
            { id: 'destination', coords: { lat: to.lat, lng: to.lng } },
          ],
          arrival_searches: [
            {
              id: 'search',
              arrival_location_id: 'destination',
              departure_location_ids: ['origin'],
              transportation: { type: transportation },
              arrival_time: arrival,
              travel_time: 7200,
              properties: ['travel_time'],
            },
          ],
        };
      }

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
        logger.debug(`TravelTime single: unreachable (${departureTime ? 'depart' : 'arrive'} ${transportation}, ${distanceKm.toFixed(2)}km)`);
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
   * TravelTime Matrix (arrival_searches) — "arrive at arrivalLocation BY arrivalTime,
   * departing from each of departureLocations — how long is each journey?"
   *
   * travelType should be 'walking' or 'public_transport'.
   * Returns a map: departureLocationIndex → durationMinutes, or null on API failure.
   * Indices not in the map are unreachable (no feasible route).
   */
  private async fetchTravelTimeMatrix(
    arrivalLocation: { lat: number; lng: number },
    departureLocations: Array<{ lat: number; lng: number }>,
    travelType: string,
    arrivalTime?: Date
  ): Promise<Map<number, number> | null> {
    if (!this.hasTravelTimeCredentials() || departureLocations.length === 0) return null;

    try {
      const arrival = (arrivalTime || new Date()).toISOString();

      const locations = [
        { id: 'arrival', coords: { lat: arrivalLocation.lat, lng: arrivalLocation.lng } },
        ...departureLocations.map((d, i) => ({ id: `dep_${i}`, coords: { lat: d.lat, lng: d.lng } })),
      ];

      const body = {
        locations,
        arrival_searches: [
          {
            id: 'matrix',
            arrival_location_id: 'arrival',
            departure_location_ids: departureLocations.map((_, i) => `dep_${i}`),
            transportation: { type: travelType },
            arrival_time: arrival,
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
        const result0 = data?.results?.[0];
        const reachable = result0?.locations || [];
        const unreachable: string[] = result0?.unreachable || [];
        if (unreachable.length > 0) {
          logger.info(`TravelTime matrix (${travelType}): ${reachable.length} reachable, ${unreachable.length} unreachable departures`);
        }
        const resultMap = new Map<number, number>();
        for (const loc of reachable) {
          const match = loc.id?.match(/^dep_(\d+)$/);
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

  /**
   * Normalise any raw transport mode string from the database or frontend
   * into one of the three canonical values: 'car' | 'walking' | 'public'.
   * Walkers are treated identically to public transport users — they both
   * rely on buses/trains between visits and use the TravelTime API.
   */
  static normalizeMode(raw: string | null | undefined): TransportMode {
    const s = (raw || '').toLowerCase().trim();
    if (s.includes('car') || s.includes('driv')) return 'car';
    if (s.includes('public') || s.includes('bus') || s.includes('train') || s.includes('transit')) return 'public';
    if (s.includes('walk') || s.includes('foot') || s.includes('pedestrian')) return 'walking';
    return 'car';
  }

  private isWalkerOrPublic(mode: TransportMode): boolean {
    return mode === 'walking' || mode === 'public';
  }

  async calculateTravelTime(
    branchId: string,
    from: Location,
    to: Location,
    transportMode: TransportMode = "car",
    arrivalTime?: Date,
    departureTime?: Date
  ): Promise<TravelMatrix> {
    const fromLat = from.lat.toString();
    const fromLng = from.lng.toString();
    const toLat = to.lat.toString();
    const toLng = to.lng.toString();

    const currentMaxTravel = this.isWalkerOrPublic(transportMode) ? 90 : this.maxTravelMinutes;
    const isNonCar = this.isWalkerOrPublic(transportMode);

    // 1a. Check in-memory session cache (resets each scheduling run — no persistence)
    // For walker/public calls, include the date in the key so Saturday and Sunday (or
    // different arrival times on the same day) never share a cached result — TravelTime
    // uses day-specific timetables so cross-day reuse would return the wrong duration.
    const timeRef = arrivalTime || departureTime;
    const dateTag = (timeRef && isNonCar) ? `-${timeRef.toISOString().slice(0, 10)}` : '';
    const sKey = this.sessionKey(fromLat, fromLng, toLat, toLng, transportMode) + dateTag;
    const sessHit = this._sessionCache.get(sKey);
    if (sessHit) {
      return {
        fromLocation: from,
        toLocation: to,
        distanceKm: (sessHit.distanceMeters || 0) / 1000,
        travelTimeMinutes: sessHit.durationMinutes,
        feasible: sessHit.durationMinutes <= currentMaxTravel,
        penaltyScore: this.calculatePenalty(sessHit.durationMinutes),
        source: sessHit.source,
      };
    }

    // 1b. Check DB cache — DISABLED: always fetch fresh from API
    // // For walkers/public: accept traveltime or traveltime-matrix sources; reject old heuristic/ors entries
    // // For car: accept ors, ors-matrix, osrm, or heuristic
    // try {
    //   const cached = await storage.getTravelTime(branchId, fromLat, fromLng, toLat, toLng, transportMode);
    //   if (cached) {
    //     const isRealTravelTime = cached.source === 'traveltime' || cached.source === 'traveltime-matrix';
    //     const isCarRealRoad = cached.source === 'ors' || cached.source === 'ors-matrix' || cached.source === 'osrm';
    //     const isHeuristic = cached.source === 'heuristic';
    //
    //     let useCache = false;
    //     if (isNonCar) {
    //       useCache = isRealTravelTime || (isHeuristic && !this.hasTravelTimeCredentials());
    //     } else {
    //       useCache = isCarRealRoad || isHeuristic;
    //     }
    //
    //     if (useCache) {
    //       return {
    //         fromLocation: from,
    //         toLocation: to,
    //         distanceKm: (cached.distanceMeters || 0) / 1000,
    //         travelTimeMinutes: cached.durationMinutes,
    //         feasible: cached.durationMinutes <= currentMaxTravel,
    //         penaltyScore: this.calculatePenalty(cached.durationMinutes),
    //       };
    //     }
    //
    //     if (isNonCar && (isCarRealRoad || (isHeuristic && this.hasTravelTimeCredentials()))) {
    //       logger.debug(`Refreshing stale cache for walker/public (${cached.source}) with TravelTime API`);
    //     }
    //   }
    // } catch (e) {
    //   logger.error("Cache lookup failed:", e);
    // }

    // 2a. Walker / public transport — TravelTime API (arrival_searches)
    // Distance decides the TravelTime mode: ≤ WALK_THRESHOLD_KM → walking, else public_transport
    if (isNonCar) {
      const distKm = this.calculateHaversineDistance(from, to);
      const ttMode = this.toTravelTimeTransport(distKm);
      let tt = await this.fetchTravelTimeSingle(from, to, distKm, arrivalTime, undefined, departureTime);
      let usedMode = ttMode;
      if (!tt && ttMode === 'public_transport') {
        logger.info(`TravelTime single (public_transport) unreachable for ${distKm.toFixed(2)}km — retrying with walking`);
        tt = await this.fetchTravelTimeSingle(from, to, distKm, arrivalTime, 'walking', departureTime);
        usedMode = 'walking';
      }
      if (tt) {
        logger.debug(`TravelTime single (${usedMode}, ${distKm.toFixed(2)}km): ${tt.durationMinutes} min`);
        this.trackSource('traveltime');
        this._sessionCache.set(sKey, { durationMinutes: tt.durationMinutes, distanceMeters: Math.round(distKm * this.ROAD_FACTOR * 1000), source: 'traveltime' });
        return {
          fromLocation: from,
          toLocation: to,
          distanceKm: Math.round(distKm * this.ROAD_FACTOR * 100) / 100,
          travelTimeMinutes: tt.durationMinutes,
          feasible: tt.durationMinutes <= currentMaxTravel,
          penaltyScore: this.calculatePenalty(tt.durationMinutes),
          source: 'traveltime',
        };
      }

      // 2b. TravelTime unavailable — fall back to Haversine heuristic for walker/public
      const heuristicMinutes = this.calculateHeuristicTravelTime(distKm, transportMode);
      logger.warn(`TravelTime API unavailable for ${fromLat},${fromLng} → ${toLat},${toLng} (${transportMode}) — using Haversine fallback: ${heuristicMinutes}min`);
      this.trackSource('heuristic');
      this._sessionCache.set(sKey, { durationMinutes: heuristicMinutes, distanceMeters: Math.round(distKm * this.ROAD_FACTOR * 1000), source: 'heuristic' });
      return {
        fromLocation: from,
        toLocation: to,
        distanceKm: Math.round(distKm * this.ROAD_FACTOR * 100) / 100,
        travelTimeMinutes: heuristicMinutes,
        feasible: heuristicMinutes <= currentMaxTravel,
        penaltyScore: this.calculatePenalty(heuristicMinutes),
        source: 'heuristic',
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
          // Cache save DISABLED: always fetch fresh from API
          // await storage.saveTravelTime({ branchId, fromLat, fromLng, toLat, toLng, transportMode, durationMinutes, distanceMeters, source: 'ors' });
          this.trackSource('ors');
          this._sessionCache.set(sKey, { durationMinutes, distanceMeters, source: 'ors' });
          return {
            fromLocation: from,
            toLocation: to,
            distanceKm: distanceMeters / 1000,
            travelTimeMinutes: durationMinutes,
            feasible: durationMinutes <= currentMaxTravel,
            penaltyScore: this.calculatePenalty(durationMinutes),
            source: 'ors',
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
      // Cache save DISABLED: always fetch fresh from API
      // try {
      //   await storage.saveTravelTime({ branchId, fromLat, fromLng, toLat, toLng, transportMode, durationMinutes: osrm.durationMinutes, distanceMeters: osrm.distanceMeters, source: 'osrm' });
      // } catch (e) {
      //   logger.error("Cache save (OSRM) failed:", e);
      // }
      this.trackSource('osrm');
      this._sessionCache.set(sKey, { durationMinutes: osrm.durationMinutes, distanceMeters: osrm.distanceMeters, source: 'osrm' });
      return {
        fromLocation: from,
        toLocation: to,
        distanceKm: osrm.distanceMeters / 1000,
        travelTimeMinutes: osrm.durationMinutes,
        feasible: osrm.durationMinutes <= currentMaxTravel,
        penaltyScore: this.calculatePenalty(osrm.durationMinutes),
        source: 'osrm',
      };
    }

    // 5. Car — both ORS and OSRM unavailable — mark as unreachable (no heuristic fallback)
    logger.warn(`ORS and OSRM both failed for ${fromLat},${fromLng} → ${toLat},${toLng} — marking unreachable, will go to unallocated`);
    this.trackSource('unreachable');
    this._sessionCache.set(sKey, { durationMinutes: 9999, distanceMeters: 0, source: 'unreachable' });
    return {
      fromLocation: from,
      toLocation: to,
      distanceKm: 0,
      travelTimeMinutes: 9999,
      feasible: false,
      penaltyScore: 9999,
      source: 'unreachable',
    };
  }

  /**
   * Pre-warm the travel time cache before scheduling starts.
   *
   * Phase 1 — Employee → Client (home → each client):
   *   Car:          ORS Matrix
   *   Walker/public: TravelTime Matrix (arrival_searches — arrive BY visit start time)
   *
   * Phase 2 — Client → Client (between-visit travel):
   *   Car:          ORS Matrix all-pairs (clients + employee homes as locations)
   *   Walker/public: TravelTime Matrix arrival_searches, per-client
   *
   * Unreachable pairs are stored with 9999 minutes → scheduler rejects → unallocated.
   * Heuristic fallback is DISABLED.
   *
   * @param scheduleDate    YYYY-MM-DD of the schedule week start (used to build correct arrival time)
   * @param earliestStartTime HH:MM of the earliest visit start time in the schedule
   */
  async prewarmTravelCache(
    branchId: string,
    employeeLocations: Array<{ id: string; lat: number; lng: number; transportMode: TransportMode }>,
    clientLocations: Array<{ id: string; lat: number; lng: number }>,
    scheduleDate?: string,
    earliestStartTime?: string
  ): Promise<void> {
    if (employeeLocations.length === 0 || clientLocations.length === 0) return;

    const startTime = Date.now();
    let totalNew = 0;

    const carEmployees = employeeLocations.filter(e => e.transportMode === 'car');
    const nonCarEmployees = employeeLocations.filter(e => this.isWalkerOrPublic(e.transportMode));

    // Build arrival deadline: schedule date at earliest visit start time (or 08:00 default)
    const timeStr = earliestStartTime || '08:00';
    const dateStr = scheduleDate || new Date().toISOString().split('T')[0];
    const arrivalDeadline = new Date(`${dateStr}T${timeStr}:00`);
    logger.info(`[Cache Pre-warm] Starting for ${employeeLocations.length} employees (${carEmployees.length} car, ${nonCarEmployees.length} walker/public) × ${clientLocations.length} clients. Arrival deadline: ${arrivalDeadline.toISOString()}`);

    // Helper: run a TravelTime Matrix batch (arrival_searches) and save results for a single arrival location
    // empOrClientEntries: array of {lat, lng, mode, cacheKey_from, cacheKey_to} representing departure locations
    const runTravelTimeArrivalGroup = async (
      arrivalLoc: { lat: number; lng: number },
      departures: Array<{ lat: number; lng: number; distanceKm: number; fromLat: string; fromLng: string; toLat: string; toLng: string; mode: string }>,
      travelType: string,
      fallbackType?: string
    ): Promise<void> => {
      if (departures.length === 0) return;
      for (let bi = 0; bi < departures.length; bi += TRAVELTIME_MATRIX_BATCH_SIZE) {
        // Add shorter delay and larger batches to speed up
        await new Promise(resolve => setTimeout(resolve, 500));

        const batch = departures.slice(bi, bi + TRAVELTIME_MATRIX_BATCH_SIZE);
        const depLocations = batch.map(d => ({ lat: d.lat, lng: d.lng }));
        let resultMap = await this.fetchTravelTimeMatrix(arrivalLoc, depLocations, travelType, arrivalDeadline);
        let usedType = travelType;
        if ((!resultMap || resultMap.size === 0) && fallbackType) {
          logger.info(`[Cache Pre-warm] TravelTime Matrix (${travelType}) empty — retrying with ${fallbackType}`);
          // Add delay before fallback
          await new Promise(resolve => setTimeout(resolve, 1000));
          resultMap = await this.fetchTravelTimeMatrix(arrivalLoc, depLocations, fallbackType, arrivalDeadline);
          usedType = fallbackType;
        }
        for (let di = 0; di < batch.length; di++) {
          const dep = batch[di];
          const sk = this.sessionKey(dep.fromLat, dep.fromLng, dep.toLat, dep.toLng, dep.mode);
          if (resultMap && resultMap.has(di)) {
            const durationMinutes = resultMap.get(di)!;
            this._sessionCache.set(sk, { durationMinutes, distanceMeters: Math.round(dep.distanceKm * this.ROAD_FACTOR * 1000), source: 'traveltime-matrix' });
            this.trackSource('traveltime-matrix');
          } else {
            // TravelTime unreachable or API failed — use Haversine heuristic for walker/public
            const heuristicMinutes = this.calculateHeuristicTravelTime(dep.distanceKm, dep.mode as TransportMode);
            this._sessionCache.set(sk, { durationMinutes: heuristicMinutes, distanceMeters: Math.round(dep.distanceKm * this.ROAD_FACTOR * 1000), source: 'heuristic' });
            this.trackSource('heuristic');
          }
          totalNew++;
        }
        if (resultMap) {
          logger.debug(`[Cache Pre-warm] TravelTime Matrix (${usedType}): arrival (${arrivalLoc.lat.toFixed(4)},${arrivalLoc.lng.toFixed(4)}) ← ${batch.length} departures, ${resultMap.size} reachable`);
        } else {
          logger.warn(`[Cache Pre-warm] TravelTime Matrix (${travelType}${fallbackType ? `/${fallbackType}` : ''}) API failure — using Haversine heuristic for ${batch.length} walker/public pairs`);
        }
      }
    };

    // ── PHASE 1a: Walker/public employee → client — DISABLED for ORS testing ──
    // TravelTime API calls skipped; walker/public routes use Haversine heuristic via calculateTravelTime
    // if (nonCarEmployees.length > 0 && this.hasTravelTimeCredentials()) {
    //   for (const arrivalClient of clientLocations) {
    //     ... runTravelTimeArrivalGroup calls ...
    //   }
    // }
    if (nonCarEmployees.length > 0) {
      logger.info(`[Cache Pre-warm] Phase 1a: SKIPPED (TravelTime disabled for ORS testing) — ${nonCarEmployees.length} walker/public employees will use Haversine heuristic`);
    }

    // ── PHASE 1b: Car employee → client (ORS Matrix) ──────────────────────────
    if (carEmployees.length > 0) {
      logger.info(`[Cache Pre-warm] Phase 1b: ${carEmployees.length} car employees → ${clientLocations.length} clients (ORS Matrix)`);
      for (let ei = 0; ei < carEmployees.length; ei += ORS_MATRIX_BATCH_SIZE) {
        const empBatch = carEmployees.slice(ei, ei + ORS_MATRIX_BATCH_SIZE);
        for (let ci = 0; ci < clientLocations.length; ci += ORS_MATRIX_BATCH_SIZE) {
          const clientBatch = clientLocations.slice(ci, ci + ORS_MATRIX_BATCH_SIZE);
          const added = await this.orsMatrixBatch(empBatch, clientBatch);
          totalNew += added;
        }
      }
    }

    // ── PHASE 2: Client → Client all-pairs ─────────────────────────────────────
    if (clientLocations.length > 1) {
      // Phase 2a: Car client→client via ORS Matrix (all-pairs: clients + car employee homes)
      if (carEmployees.length > 0 && this.ORS_API_KEY) {
        logger.info(`[Cache Pre-warm] Phase 2a: client→client car (ORS Matrix all-pairs, ${clientLocations.length} clients + ${carEmployees.length} employee homes)`);
        const carUniqueLocations: Array<{ lat: number; lng: number; id: string }> = [
          ...clientLocations.map((c, i) => ({ lat: c.lat, lng: c.lng, id: `c${i}` })),
          ...carEmployees.map((e) => ({ lat: e.lat, lng: e.lng, id: `e${e.id}` })),
        ];
        for (let si = 0; si < carUniqueLocations.length; si += ORS_MATRIX_BATCH_SIZE) {
          const srcBatch = carUniqueLocations.slice(si, si + ORS_MATRIX_BATCH_SIZE);
          for (let di = 0; di < carUniqueLocations.length; di += ORS_MATRIX_BATCH_SIZE) {
            const dstBatch = carUniqueLocations.slice(di, di + ORS_MATRIX_BATCH_SIZE);
            const added = await this.orsMatrixBatch(srcBatch, dstBatch, true);
            totalNew += added;
          }
        }
      }

      // Phase 2b: Walker/public client→client — DISABLED for ORS testing
      // if (nonCarEmployees.length > 0 && this.hasTravelTimeCredentials()) {
      //   ... TravelTime arrival_searches for client→client walker/public ...
      // }
      if (nonCarEmployees.length > 0) {
        logger.info(`[Cache Pre-warm] Phase 2b: SKIPPED (TravelTime disabled for ORS testing) — client→client walker/public will use Haversine heuristic`);
      }
    }

    logger.info(`[Cache Pre-warm] Complete in ${Date.now() - startTime}ms — ${totalNew} entries stored (unreachable pairs included)`);
  }

  /**
   * Helper: run one ORS Matrix batch (sources × destinations) and store in session cache.
   * @param skipSameCoords When true, skips entries where source and destination coords are identical.
   * Returns count of new entries stored.
   */
  private async orsMatrixBatch(
    sources: Array<{ lat: number; lng: number; id?: string }>,
    destinations: Array<{ lat: number; lng: number; id?: string }>,
    skipSameCoords = false
  ): Promise<number> {
    if (!this.ORS_API_KEY || sources.length === 0 || destinations.length === 0) return 0;
    let added = 0;
    try {
      const allLocations = [
        ...sources.map(e => [e.lng, e.lat]),
        ...destinations.map(c => [c.lng, c.lat]),
      ];
      const srcIndices = sources.map((_, i) => i);
      const dstIndices = destinations.map((_, i) => sources.length + i);

      // Add delay to respect ORS Free Tier rate limits (40 requests per minute)
      await new Promise(resolve => setTimeout(resolve, 800));

      const response = await fetch('https://api.openrouteservice.org/v2/matrix/driving-car', {
        method: 'POST',
        headers: { 'Authorization': this.ORS_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ locations: allLocations, metrics: ['duration', 'distance'], sources: srcIndices, destinations: dstIndices }),
      });

      if (response.ok) {
        const data = await response.json();
        const durations: (number | null)[][] = data.durations;
        const distances: (number | null)[][] = data.distances;
        for (let si = 0; si < sources.length; si++) {
          for (let di = 0; di < destinations.length; di++) {
            const src = sources[si];
            const dst = destinations[di];
            if (skipSameCoords && src.lat === dst.lat && src.lng === dst.lng) continue;
            const durationSec = durations?.[si]?.[di];
            const distMeters = distances?.[si]?.[di];
            if (durationSec == null || distMeters == null) continue;
            const dMin = Math.max(2, Math.round(durationSec / 60));
            const sk = this.sessionKey(src.lat.toString(), src.lng.toString(), dst.lat.toString(), dst.lng.toString(), 'car');
            this._sessionCache.set(sk, { durationMinutes: dMin, distanceMeters: Math.round(distMeters), source: 'ors-matrix' });
            this.trackSource('ors-matrix');
            added++;
          }
        }
        logger.debug(`[Cache Pre-warm] ORS Matrix: ${sources.length}×${destinations.length} batch → ${added} entries`);
      } else {
        const errText = await response.text();
        logger.warn(`[Cache Pre-warm] ORS Matrix batch failed (${response.status}): ${errText.slice(0, 200)}`);
        // No heuristic fallback — OSRM per-pair as secondary attempt
        for (const src of sources) {
          for (const dst of destinations) {
            if (skipSameCoords && src.lat === dst.lat && src.lng === dst.lng) continue;
            const osrm = await this.fetchOSRMRoute({ lat: src.lat, lng: src.lng }, { lat: dst.lat, lng: dst.lng });
            if (osrm) {
              const sk = this.sessionKey(src.lat.toString(), src.lng.toString(), dst.lat.toString(), dst.lng.toString(), 'car');
              this._sessionCache.set(sk, { durationMinutes: osrm.durationMinutes, distanceMeters: osrm.distanceMeters, source: 'osrm' });
              this.trackSource('osrm');
              added++;
            }
            // If OSRM also fails, pair is not stored → client-side returns 9999 → unallocated
          }
        }
      }
    } catch (err) {
      logger.warn('[Cache Pre-warm] ORS Matrix exception:', err instanceof Error ? err.message : err);
    }
    return added;
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
