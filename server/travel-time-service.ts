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

const ORS_MATRIX_BATCH_SIZE = 50;
const TRAVELTIME_MATRIX_BATCH_SIZE = 40;
const OSRM_TIMEOUT_MS = 5000;
const TRAVELTIME_TIMEOUT_MS = 5000;

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

  constructor(maxTravelMinutes: number = 45, softLimitMinutes?: number) {
    this.maxTravelMinutes = maxTravelMinutes;
    this.softLimitMinutes = softLimitMinutes || Math.round(maxTravelMinutes * 0.75);
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
   * Picks walking vs public_transport automatically based on straight-line distance:
   *   ≤ 2 miles  → walking (faster, no bus waiting time)
   *   >  2 miles → public_transport (bus/train is the realistic option)
   */
  private async fetchTravelTimeSingle(
    from: Location,
    to: Location,
    distanceKm: number,
    departureTime?: Date,
    forceMode?: string
  ): Promise<{ durationMinutes: number } | null> {
    if (!this.hasTravelTimeCredentials()) return null;

    try {
      const departure = (departureTime || new Date()).toISOString();
      const transportation = forceMode ?? this.toTravelTimeTransport(distanceKm);

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
        logger.debug(`TravelTime single: destination unreachable within time limit (${transportation}, ${distanceKm.toFixed(2)}km)`);
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
   * TravelTime Matrix — batch walking times (departure_searches).
   * Used for close clients (≤1.6 km) where walking is the realistic mode.
   * One employee (source) → many client destinations.
   * Returns a map: destinationIndex → durationMinutes, or null on failure.
   */
  private async fetchTravelTimeMatrix(
    source: { lat: number; lng: number },
    destinations: Array<{ lat: number; lng: number }>,
    travelType: string,
    departureTime?: Date
  ): Promise<Map<number, number> | null> {
    if (!this.hasTravelTimeCredentials() || destinations.length === 0) return null;

    try {
      const departure = (departureTime || new Date()).toISOString();
      const transportation = travelType;

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
        const result0 = data?.results?.[0];
        const reachable = result0?.locations || [];
        const unreachable: string[] = result0?.unreachable || [];
        if (unreachable.length > 0) {
          logger.info(`TravelTime matrix (${travelType}): ${reachable.length} reachable, ${unreachable.length} unreachable destinations`);
        }
        const resultMap = new Map<number, number>();
        for (const loc of reachable) {
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
   * TravelTime arrival_searches matrix — real-world public transport routing.
   *
   * Models the actual journey: employee walks to nearest bus stop → takes bus/train
   * → walks from final stop to the client's address. This is what TravelTime's
   * public_transport mode computes automatically.
   *
   * Uses arrival_searches (client-first) rather than departure_searches because
   * we know exactly when the employee must ARRIVE (the visit start time).
   * The API finds all valid journeys that reach the destination by arrival_time,
   * checking real timetables for that date and time.
   *
   * destination  = client location (single arrival point)
   * sources      = employee home locations (multiple potential departure points)
   * arrivalTime  = the visit's scheduled start time on the schedule date
   *
   * Returns a map: sourceIndex → durationMinutes, or null on API failure.
   */
  private async fetchTravelTimeMatrixByArrival(
    destination: { lat: number; lng: number },
    sources: Array<{ lat: number; lng: number }>,
    arrivalTime: Date
  ): Promise<Map<number, number> | null> {
    if (!this.hasTravelTimeCredentials() || sources.length === 0) return null;

    try {
      const arrival = arrivalTime.toISOString();

      const locations = [
        { id: 'dest', coords: { lat: destination.lat, lng: destination.lng } },
        ...sources.map((s, i) => ({ id: `src_${i}`, coords: { lat: s.lat, lng: s.lng } })),
      ];

      const body = {
        locations,
        arrival_searches: [
          {
            id: 'matrix',
            arrival_location_id: 'dest',
            departure_location_ids: sources.map((_, i) => `src_${i}`),
            transportation: { type: 'public_transport' },
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
          logger.info(`TravelTime arrival_matrix (public_transport): ${reachable.length} reachable, ${unreachable.length} unreachable sources (arriving by ${arrival})`);
        }
        const resultMap = new Map<number, number>();
        for (const loc of reachable) {
          const match = loc.id?.match(/^src_(\d+)$/);
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
        logger.warn(`TravelTime arrival_matrix API error (${response.status}): ${errText.slice(0, 200)}`);
        return null;
      }
    } catch (error) {
      logger.warn('TravelTime arrival_matrix fetch failed:', error instanceof Error ? error.message : error);
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
    // Distance is calculated first to pick the right TravelTime mode:
    //   ≤ 2 miles → walking API (accurate for short trips, no bus wait)
    //   >  2 miles → public_transport API (realistic for longer trips)
    if (isNonCar) {
      const distanceKm = this.calculateHaversineDistance(from, to);
      const ttMode = this.toTravelTimeTransport(distanceKm);
      let tt = await this.fetchTravelTimeSingle(from, to, distanceKm);
      let usedMode = ttMode;
      if (!tt && ttMode === 'public_transport') {
        logger.info(`TravelTime single (public_transport) unreachable for ${distanceKm.toFixed(2)}km — retrying with walking`);
        tt = await this.fetchTravelTimeSingle(from, to, distanceKm, undefined, 'walking');
        usedMode = 'walking';
      }
      if (tt) {
        logger.debug(`TravelTime single (${usedMode}, ${distanceKm.toFixed(2)}km): ${tt.durationMinutes} min`);
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
   *
   * For public transport employees the routing model is:
   *   walk from home → nearest bus/train stop → transit → walk from stop → client address
   * This is what TravelTime's public_transport mode computes automatically.
   * We use arrival_searches (client-first) so TravelTime queries real timetables
   * for the exact moment the employee must arrive at the client — the visit start time.
   */
  async prewarmTravelCache(
    branchId: string,
    employeeLocations: Array<{ id: string; lat: number; lng: number; transportMode: TransportMode }>,
    clientLocations: Array<{ id: string; lat: number; lng: number; arrivalTimeMinutes?: number }>,
    scheduleDate?: string
  ): Promise<void> {
    if (employeeLocations.length === 0 || clientLocations.length === 0) return;

    const startTime = Date.now();
    let totalNew = 0;
    let totalHits = 0;

    // Validate coordinates — skip employees/clients with zero or missing lat/lng
    const validEmployees = employeeLocations.filter(e => {
      if (!e.lat || !e.lng || e.lat === 0 || e.lng === 0) {
        logger.warn(`[Cache Pre-warm] Skipping invalid coordinates for emp ${e.id} (lat=${e.lat}, lng=${e.lng})`);
        return false;
      }
      return true;
    });
    const validClients = clientLocations.filter(c => {
      if (!c.lat || !c.lng || c.lat === 0 || c.lng === 0) {
        logger.warn(`[Cache Pre-warm] Skipping invalid coordinates for client ${c.id} (lat=${c.lat}, lng=${c.lng})`);
        return false;
      }
      return true;
    });

    const carEmployees = validEmployees.filter(e => e.transportMode === 'car');
    const nonCarEmployees = validEmployees.filter(e => this.isWalkerOrPublic(e.transportMode));

    logger.info(`[Cache Pre-warm] Starting for ${validEmployees.length} employees (${carEmployees.length} car, ${nonCarEmployees.length} walker/public) × ${validClients.length} clients`);

    // ── Walker / public: TravelTime Matrix API ──────────────────────────────
    if (nonCarEmployees.length > 0 && this.hasTravelTimeCredentials()) {
      logger.info(`[Cache Pre-warm] Processing ${nonCarEmployees.length} walker/public employees via TravelTime API`);

      // Helper to build the arrival Date for a given visit's arrival time (minutes since midnight).
      // Uses scheduleDate if provided, otherwise falls back to today.
      const buildArrivalDate = (arrivalTimeMinutes: number): Date => {
        const base = scheduleDate ? new Date(`${scheduleDate}T00:00:00`) : new Date();
        base.setHours(0, 0, 0, 0);
        base.setMinutes(arrivalTimeMinutes);
        return base;
      };

      // Default arrival time: 09:00 if a client has no visit time set
      const DEFAULT_ARRIVAL_MINUTES = 9 * 60;

      // ── Phase A: Collect uncached pairs across all non-car employees ─────
      type UncachedPair = {
        emp: typeof nonCarEmployees[0];
        client: typeof validClients[0];
        distanceKm: number;
        arrivalTimeMinutes: number;
      };

      const closeWalkingPairs: UncachedPair[] = [];
      const farPublicPairs: UncachedPair[] = [];

      await Promise.all(nonCarEmployees.map(async (emp) => {
        for (const client of validClients) {
          try {
            const cached = await storage.getTravelTime(
              branchId,
              emp.lat.toString(), emp.lng.toString(),
              client.lat.toString(), client.lng.toString(),
              emp.transportMode
            );
            const isRealTravelTime = cached?.source === 'traveltime' || cached?.source === 'traveltime-matrix';
            if (cached && isRealTravelTime) {
              totalHits++;
              continue;
            }
          } catch (_) {}

          const distanceKm = this.calculateHaversineDistance(
            { lat: emp.lat, lng: emp.lng },
            { lat: client.lat, lng: client.lng }
          );
          const arrivalTimeMinutes = client.arrivalTimeMinutes ?? DEFAULT_ARRIVAL_MINUTES;

          if (distanceKm <= this.WALK_THRESHOLD_KM) {
            closeWalkingPairs.push({ emp, client, distanceKm, arrivalTimeMinutes });
          } else {
            farPublicPairs.push({ emp, client, distanceKm, arrivalTimeMinutes });
          }
        }
      }));

      logger.info(`[Cache Pre-warm] Uncached pairs: ${closeWalkingPairs.length} walking (≤${this.WALK_THRESHOLD_KM}km), ${farPublicPairs.length} public_transport (>${this.WALK_THRESHOLD_KM}km)`);

      // ── Phase B: Close clients — per-employee walking matrix ─────────────
      // Group walking pairs by employee so we can do one matrix call per employee
      const walkByEmp = new Map<string, UncachedPair[]>();
      for (const pair of closeWalkingPairs) {
        if (!walkByEmp.has(pair.emp.id)) walkByEmp.set(pair.emp.id, []);
        walkByEmp.get(pair.emp.id)!.push(pair);
      }

      await Promise.all(Array.from(walkByEmp.entries()).map(async ([, pairs]) => {
        const emp = pairs[0].emp;
        for (let bi = 0; bi < pairs.length; bi += TRAVELTIME_MATRIX_BATCH_SIZE) {
          const batch = pairs.slice(bi, bi + TRAVELTIME_MATRIX_BATCH_SIZE);
          const destinations = batch.map((b: UncachedPair) => ({ lat: b.client.lat, lng: b.client.lng }));
          const resultMap = await this.fetchTravelTimeMatrix(
            { lat: emp.lat, lng: emp.lng }, destinations, 'walking'
          );
          for (let di = 0; di < batch.length; di++) {
            const { client, distanceKm } = batch[di];
            const durationMinutes = resultMap?.get(di);
            const finalMinutes = durationMinutes ?? this.calculateHeuristicTravelTime(distanceKm, emp.transportMode);
            const source = durationMinutes != null ? 'traveltime-matrix' : 'heuristic';
            if (durationMinutes == null) {
              logger.debug(`[Cache Pre-warm] Walking unreachable for emp ${emp.id} → client ${client.id} — using heuristic: ${finalMinutes} min`);
            }
            try {
              await storage.saveTravelTime({
                branchId,
                fromLat: emp.lat.toString(), fromLng: emp.lng.toString(),
                toLat: client.lat.toString(), toLng: client.lng.toString(),
                transportMode: emp.transportMode,
                durationMinutes: finalMinutes,
                distanceMeters: Math.round(distanceKm * this.ROAD_FACTOR * 1000),
                source,
              });
              totalNew++;
            } catch (_) {}
          }
        }
      }));

      // ── Phase C: Far clients — client-first public_transport arrival_searches ─
      //
      // We query TravelTime with arrival_searches instead of departure_searches.
      // For each client, we ask: "which of my employees can reach this address
      // by the visit start time, travelling by public transport?"
      //
      // TravelTime models the full journey automatically:
      //   employee home → walk to bus stop → bus/train → walk from stop → client
      //
      // Grouping by (client + arrivalTime) lets us query all employees in one
      // API call per client, keeping API usage efficient.

      const publicByClientKey = new Map<string, {
        client: typeof validClients[0];
        arrivalDate: Date;
        employees: Array<{ emp: typeof nonCarEmployees[0]; distanceKm: number }>;
      }>();

      for (const pair of farPublicPairs) {
        const key = `${pair.client.lat},${pair.client.lng},${pair.arrivalTimeMinutes}`;
        if (!publicByClientKey.has(key)) {
          publicByClientKey.set(key, {
            client: pair.client,
            arrivalDate: buildArrivalDate(pair.arrivalTimeMinutes),
            employees: [],
          });
        }
        publicByClientKey.get(key)!.employees.push({ emp: pair.emp, distanceKm: pair.distanceKm });
      }

      const dateLabel = scheduleDate ?? 'today';

      for (const group of Array.from(publicByClientKey.values())) {
        const arrivalStr = group.arrivalDate.toTimeString().slice(0, 5);
        logger.info(`[Cache Pre-warm] public_transport: ${group.employees.length} employees → client ${group.client.id}, must arrive by ${arrivalStr} on ${dateLabel}`);

        // Batch employees (API limit per call)
        for (let bi = 0; bi < group.employees.length; bi += TRAVELTIME_MATRIX_BATCH_SIZE) {
          const empBatch = group.employees.slice(bi, bi + TRAVELTIME_MATRIX_BATCH_SIZE);
          const sources = empBatch.map((e: { emp: { lat: number; lng: number }; distanceKm: number }) => ({ lat: e.emp.lat, lng: e.emp.lng }));

          const resultMap = await this.fetchTravelTimeMatrixByArrival(
            { lat: group.client.lat, lng: group.client.lng },
            sources,
            group.arrivalDate
          );

          for (let si = 0; si < empBatch.length; si++) {
            const { emp, distanceKm } = empBatch[si];
            const durationMinutes = resultMap?.get(si);
            const finalMinutes = durationMinutes ?? this.calculateHeuristicTravelTime(distanceKm, emp.transportMode);
            const source = durationMinutes != null ? 'traveltime-matrix' : 'heuristic';
            if (durationMinutes == null) {
              logger.warn(`[Cache Pre-warm] public_transport unreachable for emp ${emp.id} → client ${group.client.id} (arrive by ${arrivalStr}) — using heuristic (walk+bus+walk estimate): ${finalMinutes} min`);
            }
            try {
              await storage.saveTravelTime({
                branchId,
                fromLat: emp.lat.toString(), fromLng: emp.lng.toString(),
                toLat: group.client.lat.toString(), toLng: group.client.lng.toString(),
                transportMode: emp.transportMode,
                durationMinutes: finalMinutes,
                distanceMeters: Math.round(distanceKm * this.ROAD_FACTOR * 1000),
                source,
              });
              totalNew++;
            } catch (_) {}
          }
        }
      }
    } else if (nonCarEmployees.length > 0 && !this.hasTravelTimeCredentials()) {
      // No TravelTime credentials — use heuristic for all walker/public pairs
      logger.warn('[Cache Pre-warm] No TravelTime credentials — using heuristic for all walker/public employees');
      for (const emp of nonCarEmployees) {
        for (const client of validClients) {
          const distanceKm = this.calculateHaversineDistance(
            { lat: emp.lat, lng: emp.lng },
            { lat: client.lat, lng: client.lng }
          );
          const durationMinutes = this.calculateHeuristicTravelTime(distanceKm, emp.transportMode);
          try {
            await storage.saveTravelTime({
              branchId,
              fromLat: emp.lat.toString(), fromLng: emp.lng.toString(),
              toLat: client.lat.toString(), toLng: client.lng.toString(),
              transportMode: emp.transportMode,
              durationMinutes,
              distanceMeters: Math.round(distanceKm * this.ROAD_FACTOR * 1000),
              source: 'heuristic',
            });
            totalNew++;
          } catch (_) {}
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
