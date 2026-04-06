/**
 * Travel Time Service for Route Optimization
 *
 * Car employees:
 *   1. ORS Matrix API (batch pre-warm, all-pairs including client→client)
 *   2. ORS Directions API (individual fallback)
 *   3. OSRM public API (real road, free, no key)
 *   [Heuristic DISABLED — unreachable pairs go to unallocated]
 *
 * Walker employees:
 *   Uses ONLY Haversine heuristic (no API calls)
 *
 * Public transport employees:
 *   Uses ONLY Haversine heuristic (no API calls)
 *
 * Prewarm (pre-cache phase):
 *   Car pairs: ORS Matrix batches (Phases 1b, 2a)
 *   Walker/public pairs: Haversine heuristic (fast, no API calls, no rate-limit risk)
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
  private _ttGeoCache: Map<string, { lat: number; lng: number } | null> = new Map();

  constructor(maxTravelMinutes: number = 45, softLimitMinutes?: number) {
    this.maxTravelMinutes = maxTravelMinutes;
    this.softLimitMinutes = softLimitMinutes || Math.round(maxTravelMinutes * 0.75);
  }

  /**
   * Synchronous haversine-based travel estimate using this service's exact MODE_CONFIG and ROAD_FACTOR.
   * Use for in-process scheduling checks (e.g. BD Matcher forward-travel rule) where async API
   * calls are not practical inside a tight inner loop.
   */
  heuristicEstimate(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    transportMode: string | undefined
  ): number {
    const raw = (transportMode || 'walking').toLowerCase();
    const mode: TransportMode = raw === 'car' || raw === 'driver' ? 'car' : raw === 'walking' ? 'walking' : 'public';
    const straightLineKm = this.calculateHaversineDistance(from, to);
    return this.calculateHeuristicTravelTime(straightLineKm, mode);
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

  /**
   * Read pre-warmed travel data directly from session cache (for cars with ORS Matrix pre-warm).
   * Avoids making individual API calls — returns cached data or null if not found.
   */
  getCachedTravelTime(from: Location, to: Location, mode: string): { durationMinutes: number; distanceMeters: number; source: string } | null {
    const sk = this.sessionKey(from.lat.toString(), from.lng.toString(), to.lat.toString(), to.lng.toString(), mode);
    const cached = this._sessionCache.get(sk);
    return cached || null;
  }

  /**
   * Public OSRM fallback — use when ORS Matrix cache miss occurs.
   * Free, reliable fallback to real roads if ORS pre-warm failed.
   */
  async fetchOSRMRouteFallback(from: Location, to: Location): Promise<{ durationMinutes: number; distanceMeters: number } | null> {
    return this.fetchOSRMRoute(from, to);
  }

  /** Returns true if an ORS API key is configured (Matrix calls will succeed). */
  hasORSKey(): boolean {
    return !!this.ORS_API_KEY;
  }

  /**
   * Direct ORS Directions API call (driving-car profile).
   * Falls back to OSRM if the ORS API key is missing or the call fails.
   */
  async fetchORSDirections(from: Location, to: Location): Promise<{ durationMinutes: number; distanceMeters: number } | null> {
    if (this.ORS_API_KEY) {
      try {
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
          this.trackSource('ors');
          return { durationMinutes, distanceMeters };
        }
        const errorText = await response.text();
        logger.warn(`[ORS Directions] API error (${response.status}): ${errorText.slice(0, 200)} — falling back to OSRM`);
      } catch (err) {
        logger.warn('[ORS Directions] request failed — falling back to OSRM', { error: String(err) });
      }
    }
    // Fallback to OSRM when ORS key missing or call fails
    return this.fetchOSRMRoute(from, to);
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
   * [COMMENTED OUT] TravelTime geocoding API
   * TravelTime API is disabled for walkers. Using Haversine heuristic only.
   */
  async geocodePostcode(postcode: string): Promise<{ lat: number; lng: number } | null> {
    // if (!this.hasTravelTimeCredentials()) return null;
    // const key = postcode.trim().toUpperCase().replace(/\s+/g, '');
    // // Return cached result (including null for previously-failed lookups — avoids repeat calls)
    // if (this._ttGeoCache.has(key)) return this._ttGeoCache.get(key) ?? null;
    // try {
    //   const url = `https://api.traveltimeapp.com/v4/geocoding/search?query=${encodeURIComponent(postcode)}&limit=1`;
    //   const response = await fetch(url, {
    //     headers: {
    //       'X-Application-Id': this.TRAVELTIME_APP_ID!,
    //       'X-Api-Key': this.TRAVELTIME_API_KEY!,
    //       'Accept': 'application/json',
    //       'Accept-Language': 'en',
    //     },
    //   });
    //   if (response.ok) {
    //     const data = await response.json();
    //     const feature = data?.features?.[0];
    //     if (feature?.geometry?.coordinates) {
    //       const [lng, lat] = feature.geometry.coordinates as [number, number];
    //       const result = { lat, lng };
    //       this._ttGeoCache.set(key, result);
    //       logger.info(`[TT Geocode] ${postcode} → (${lat.toFixed(4)},${lng.toFixed(4)})`);
    //       return result;
    //     }
    //     // No feature returned — cache null so we don't retry
    //     logger.warn(`TravelTime geocoding: no result for "${postcode}"`);
    //     this._ttGeoCache.set(key, null);
    //   } else {
    //     const errText = await response.text();
    //     logger.warn(`TravelTime geocoding failed for "${postcode}" (${response.status}): ${errText.slice(0, 200)}`);
    //     // Cache null to prevent hammering a failing endpoint with the same postcode
    //     this._ttGeoCache.set(key, null);
    //   }
    // } catch (e) {
    //   logger.warn(`TravelTime geocoding error for "${postcode}":`, e instanceof Error ? e.message : e);
    //   this._ttGeoCache.set(key, null);
    // }
    return null;
  }

  /**
   * [COMMENTED OUT] TravelTime single-search API
   * TravelTime API is disabled for walkers. Using Haversine heuristic only.
   */
  private async fetchTravelTimeSingle(
    from: Location,
    to: Location,
    distanceKm: number,
    arrivalTime?: Date,
    forceMode?: string,
    departureTime?: Date
  ): Promise<{ durationMinutes: number } | null> {
    // if (!this.hasTravelTimeCredentials()) return null;
    //
    // try {
    //   const transportation = forceMode ?? this.toTravelTimeTransport(distanceKm);
    //
    //   // Use departure_searches when a departure time is given (return-home / break-departure legs).
    //   // Use arrival_searches when an arrival deadline is given (client visit legs).
    //   let body: object;
    //   if (departureTime) {
    //     const departure = departureTime.toISOString();
    //     body = {
    //       locations: [
    //         { id: 'origin', coords: { lat: from.lat, lng: from.lng } },
    //         { id: 'destination', coords: { lat: to.lat, lng: to.lng } },
    //       ],
    //       departure_searches: [
    //         {
    //           id: 'search',
    //           departure_location_id: 'origin',
    //           arrival_location_ids: ['destination'],
    //           transportation: { type: transportation },
    //           departure_time: departure,
    //           travel_time: 7200,
    //           properties: ['travel_time'],
    //         },
    //       ],
    //     };
    //   } else {
    //     const arrival = (arrivalTime || new Date()).toISOString();
    //     body = {
    //       locations: [
    //         { id: 'origin', coords: { lat: from.lat, lng: from.lng } },
    //         { id: 'destination', coords: { lat: to.lat, lng: to.lng } },
    //       ],
    //       arrival_searches: [
    //         {
    //           id: 'search',
    //           arrival_location_id: 'destination',
    //           departure_location_ids: ['origin'],
    //           transportation: { type: transportation },
    //           arrival_time: arrival,
    //           travel_time: 7200,
    //           properties: ['travel_time'],
    //         },
    //       ],
    //     };
    //   }
    //
    //   const controller = new AbortController();
    //   const timeout = setTimeout(() => controller.abort(), TRAVELTIME_TIMEOUT_MS);
    //
    //   const response = await fetch('https://api.traveltimeapp.com/v4/time-filter', {
    //     method: 'POST',
    //     headers: {
    //       'X-Application-Id': this.TRAVELTIME_APP_ID!,
    //       'X-Api-Key': this.TRAVELTIME_API_KEY!,
    //       'Content-Type': 'application/json',
    //       'Accept': 'application/json',
    //     },
    //     body: JSON.stringify(body),
    //     signal: controller.signal,
    //   });
    //   clearTimeout(timeout);
    //
    //   if (response.ok) {
    //     const data = await response.json();
    //     const results = data?.results?.[0]?.locations;
    //     if (results && results.length > 0) {
    //       const travelTimeSec = results[0]?.properties?.[0]?.travel_time;
    //       if (travelTimeSec != null) {
    //         return { durationMinutes: Math.max(1, Math.round(travelTimeSec / 60)) };
    //       }
    //     }
    //     logger.debug(`TravelTime single: unreachable (${departureTime ? 'depart' : 'arrive'} ${transportation}, ${distanceKm.toFixed(2)}km)`);
    //     return null;
    //   } else {
    //     const errText = await response.text();
    //     logger.warn(`TravelTime single API error (${response.status}): ${errText.slice(0, 200)}`);
    //     return null;
    //   }
    // } catch (error) {
    //   logger.warn('TravelTime single fetch failed:', error instanceof Error ? error.message : error);
    //   return null;
    // }
    return null;
  }

  /**
   * [COMMENTED OUT] TravelTime Matrix API
   * TravelTime API is disabled for walkers. Using Haversine heuristic only.
   */
  private async fetchTravelTimeMatrix(
    arrivalLocation: { lat: number; lng: number },
    departureLocations: Array<{ lat: number; lng: number }>,
    travelType: string,
    arrivalTime?: Date
  ): Promise<Map<number, number> | null> {
    // if (!this.hasTravelTimeCredentials() || departureLocations.length === 0) return null;
    //
    // try {
    //   const arrival = (arrivalTime || new Date()).toISOString();
    //
    //   const locations = [
    //     { id: 'arrival', coords: { lat: arrivalLocation.lat, lng: arrivalLocation.lng } },
    //     ...departureLocations.map((d, i) => ({ id: `dep_${i}`, coords: { lat: d.lat, lng: d.lng } })),
    //   ];
    //
    //   const body = {
    //     locations,
    //     arrival_searches: [
    //       {
    //         id: 'matrix',
    //         arrival_location_id: 'arrival',
    //         departure_location_ids: departureLocations.map((_, i) => `dep_${i}`),
    //         transportation: { type: travelType },
    //         arrival_time: arrival,
    //         travel_time: 7200,
    //         properties: ['travel_time'],
    //       },
    //     ],
    //   };
    //
    //   const controller = new AbortController();
    //   const timeout = setTimeout(() => controller.abort(), TRAVELTIME_TIMEOUT_MS);
    //
    //   const response = await fetch('https://api.traveltimeapp.com/v4/time-filter', {
    //     method: 'POST',
    //     headers: {
    //       'X-Application-Id': this.TRAVELTIME_APP_ID!,
    //       'X-Api-Key': this.TRAVELTIME_API_KEY!,
    //       'Content-Type': 'application/json',
    //       'Accept': 'application/json',
    //     },
    //     body: JSON.stringify(body),
    //     signal: controller.signal,
    //   });
    //   clearTimeout(timeout);
    //
    //   if (response.ok) {
    //     const data = await response.json();
    //     const result0 = data?.results?.[0];
    //     const reachable = result0?.locations || [];
    //     const unreachable: string[] = result0?.unreachable || [];
    //     if (unreachable.length > 0) {
    //       logger.info(`TravelTime matrix (${travelType}): ${reachable.length} reachable, ${unreachable.length} unreachable departures`);
    //     }
    //     const resultMap = new Map<number, number>();
    //     for (const loc of reachable) {
    //       const match = loc.id?.match(/^dep_(\d+)$/);
    //       if (!match) continue;
    //       const idx = parseInt(match[1], 10);
    //       const travelTimeSec = loc?.properties?.[0]?.travel_time;
    //       if (travelTimeSec != null) {
    //         resultMap.set(idx, Math.max(1, Math.round(travelTimeSec / 60)));
    //       }
    //     }
    //     return resultMap;
    //   } else {
    //     const errText = await response.text();
    //     logger.warn(`TravelTime matrix API error (${response.status}): ${errText.slice(0, 200)}`);
    //     return null;
    //   }
    // } catch (error) {
    //   logger.warn('TravelTime matrix fetch failed:', error instanceof Error ? error.message : error);
    //   return null;
    // }
    return null;
  }

  /**
   * OSRM fallback — real road distances via OpenStreetMap, free, no API key.
   * Used for car employees when ORS is unavailable.
   */
  private async fetchOSRMRoute(from: Location, to: Location): Promise<{ durationMinutes: number; distanceMeters: number } | null> {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
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
    // For walker/public calls, include the full ISO timestamp (date + HH:MM) in the key
    // so the same route at different times on the same day gets separate cache entries.
    // TravelTime uses real timetables: ML6 0JH → ML6 8SY at 10:30 and at 15:30 on a
    // Saturday can return very different durations depending on which buses are running.
    const timeRef = arrivalTime || departureTime;
    const timeTag = (timeRef && isNonCar) ? `-${timeRef.toISOString().slice(0, 16)}` : '';
    const sKey = this.sessionKey(fromLat, fromLng, toLat, toLng, transportMode) + timeTag;
    const sessHit = this._sessionCache.get(sKey);
    if (!isNonCar && sessHit) {
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

    // 2. Walker / public transport — Use Haversine heuristic for walkers, TravelTime for public transport
    if (isNonCar) {
      const distKm = this.calculateHaversineDistance(from, to);

      // 2a. For walkers: Use ONLY Haversine (TravelTime API disabled for walkers)
      if (transportMode === 'walking') {
        const heuristicMinutes = this.calculateHeuristicTravelTime(distKm, transportMode);
        logger.debug(`Walker travel time (Haversine only, ${distKm.toFixed(2)}km): ${heuristicMinutes}min`);
        this.trackSource('heuristic');
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

      // 2b. For public transport: Try TravelTime API with Haversine fallback
      // [COMMENTED OUT] TravelTime API calls for public transport
      // const ttMode = 'public_transport';
      // let tt = await this.fetchTravelTimeSingle(from, to, distKm, arrivalTime, ttMode, departureTime);
      // if (!tt) {
      //   logger.info(`TravelTime single (public_transport) unreachable for ${distKm.toFixed(2)}km — retrying with walking`);
      //   tt = await this.fetchTravelTimeSingle(from, to, distKm, arrivalTime, 'walking', departureTime);
      // }
      // if (tt) {
      //   logger.debug(`TravelTime single (${ttMode}, ${distKm.toFixed(2)}km): ${tt.durationMinutes} min`);
      //   this.trackSource('traveltime');
      //   return {
      //     fromLocation: from,
      //     toLocation: to,
      //     distanceKm: Math.round(distKm * this.ROAD_FACTOR * 100) / 100,
      //     travelTimeMinutes: tt.durationMinutes,
      //     feasible: tt.durationMinutes <= currentMaxTravel,
      //     penaltyScore: this.calculatePenalty(tt.durationMinutes),
      //     source: 'traveltime',
      //   };
      // }

      // Fall back to Haversine heuristic
      const heuristicMinutes = this.calculateHeuristicTravelTime(distKm, transportMode);
      logger.debug(`Public transport travel time (Haversine fallback, ${distKm.toFixed(2)}km): ${heuristicMinutes}min`);
      this.trackSource('heuristic');
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

    // ── PHASE 1a: Walker/public employee → client — Haversine prewarm only ──
    // All walker/public pairs use Haversine heuristic only (no API calls).
    if (nonCarEmployees.length > 0) {
      logger.info(`[Cache Pre-warm] Phase 1a: ${nonCarEmployees.length} walker/public employees → ${clientLocations.length} clients — Haversine heuristic`);
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

      // Phase 2b: Walker/public client→client — Haversine heuristic only (no API calls).
      if (nonCarEmployees.length > 0) {
        logger.info(`[Cache Pre-warm] Phase 2b: client→client walker/public (${clientLocations.length} clients) — Haversine heuristic`);
      }
    }

    logger.info(`[Cache Pre-warm] Complete in ${Date.now() - startTime}ms — ${totalNew} entries stored (unreachable pairs included)`);
  }

  /**
   * Helper: run one ORS Matrix batch (sources × destinations) and store in session cache.
   * @param skipSameCoords When true, skips entries where source and destination coords are identical.
   * Returns count of new entries stored.
   */
  async orsMatrixBatch(
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

      // Add delay to respect ORS Free Tier rate limits (40 requests per minute = 1500ms per request)
      // 800ms is conservative; use 1500ms for strict compliance at ~40/min
      await new Promise(resolve => setTimeout(resolve, 1500));

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
        logger.info(`[Cache Pre-warm] ORS Matrix: ${sources.length}×${destinations.length} batch → ${added} entries cached`);
      } else {
        const errText = await response.text();
        logger.warn(`[Cache Pre-warm] ORS Matrix batch failed (${response.status}): ${errText.slice(0, 200)}`);
        return added;
      }
    } catch (err) {
      logger.warn('[Cache Pre-warm] ORS Matrix exception:', err instanceof Error ? err.message : err);
      return added;
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

  /**
   * Debug helper: calls BOTH /v4/time-filter and /v4/time-filter/fast for the same
   * origin→destination pair and returns both durations side-by-side.
   * /v4/time-filter/fast uses time *periods* (weekday_morning etc.) not specific timestamps.
   */
  async debugCompareBothEndpoints(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    transportType: string,
    arrivalTime?: Date
  ): Promise<{ timeFilter: number | null; timeFilterFast: number | null; timePeriod: string }> {
    if (!this.hasTravelTimeCredentials()) return { timeFilter: null, timeFilterFast: null, timePeriod: 'n/a' };
    const headers = {
      'X-Application-Id': this.TRAVELTIME_APP_ID!,
      'X-Api-Key': this.TRAVELTIME_API_KEY!,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    // --- /v4/time-filter (regular) ---
    const regularBody = {
      locations: [
        { id: 'origin', coords: from },
        { id: 'destination', coords: to },
      ],
      arrival_searches: [{
        id: 'search',
        arrival_location_id: 'destination',
        departure_location_ids: ['origin'],
        transportation: { type: transportType },
        arrival_time: (arrivalTime || new Date()).toISOString(),
        travel_time: 7200,
        properties: ['travel_time'],
      }],
    };

    // --- /v4/time-filter/fast (approximate time period) ---
    const ref = arrivalTime || new Date();
    const dow = ref.getUTCDay(); // 0=Sun, 6=Sat
    const hour = ref.getUTCHours();
    const isWeekend = dow === 0 || dow === 6;
    const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    const timePeriod = `${isWeekend ? 'weekend' : 'weekday'}_${part}`;

    const fastBody = {
      locations: [
        { id: 'origin', coords: from },
        { id: 'destination', coords: to },
      ],
      arrival_one_to_many_search: {
        id: 'search',
        arrival_location_id: 'destination',
        departure_location_ids: ['origin'],
        transportation: { type: transportType },
        arrival_time_period: timePeriod,
        travel_time: 7200,
        properties: ['travel_time'],
      },
    };

    const [regularResp, fastResp] = await Promise.all([
      fetch('https://api.traveltimeapp.com/v4/time-filter', { method: 'POST', headers, body: JSON.stringify(regularBody) }),
      fetch('https://api.traveltimeapp.com/v4/time-filter/fast', { method: 'POST', headers, body: JSON.stringify(fastBody) }),
    ]);

    let timeFilter: number | null = null;
    if (regularResp.ok) {
      const d = await regularResp.json();
      const sec = d?.results?.[0]?.locations?.[0]?.properties?.[0]?.travel_time;
      if (sec != null) timeFilter = Math.round(sec / 60);
    } else {
      logger.warn(`[DebugCompare] time-filter error ${regularResp.status}: ${(await regularResp.text()).slice(0, 200)}`);
    }

    let timeFilterFast: number | null = null;
    if (fastResp.ok) {
      const d = await fastResp.json();
      const locs = d?.results?.arrival_one_to_many_search?.[0]?.locations;
      const sec = locs?.[0]?.properties?.[0]?.travel_time;
      if (sec != null) timeFilterFast = Math.round(sec / 60);
    } else {
      logger.warn(`[DebugCompare] time-filter/fast error ${fastResp.status}: ${(await fastResp.text()).slice(0, 200)}`);
    }

    return { timeFilter, timeFilterFast, timePeriod };
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

