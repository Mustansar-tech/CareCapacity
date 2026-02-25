/**
 * Travel Time Service for Route Optimization
 * Calculates travel times between locations using:
 *   1. ORS Matrix API (batch pre-warm before scheduling)
 *   2. ORS Directions API (individual fallback)
 *   3. OSRM public API (real road distances, free, no key needed)
 *   4. Haversine heuristic (last-resort emergency fallback only)
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
const OSRM_TIMEOUT_MS = 8000;

export class TravelTimeService {
  private readonly ROAD_FACTOR = 1.2;

  private readonly MODE_CONFIG: Record<TransportMode, { speedKmh: number; overheadMinutes: number; minMinutes: number }> = {
    car:     { speedKmh: 35, overheadMinutes: 0,  minMinutes: 5  },
    walking: { speedKmh: 15, overheadMinutes: 15, minMinutes: 15 },
    public:  { speedKmh: 15, overheadMinutes: 15, minMinutes: 15 },
  };

  private readonly maxTravelMinutes: number;
  private readonly softLimitMinutes: number;
  private readonly ORS_API_KEY = process.env.ORS_API_KEY;

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
    const congestionMultiplier = this.getTimeOfDayMultiplier(startTimeMinutes);
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
   * OSRM fallback — real road distances via OpenStreetMap, free, no API key.
   * Used when ORS is unavailable or rate-limited, before falling back to Haversine.
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

    const currentMaxTravel = (transportMode === 'walking' || transportMode === 'public') ? 60 : this.maxTravelMinutes;

    // 1. Check cache — accept any real-road source (ors, ors-matrix, osrm) or heuristic when no ORS key
    try {
      const cached = await storage.getTravelTime(branchId, fromLat, fromLng, toLat, toLng, transportMode);

      if (cached && transportMode === 'walking' && (cached.source === 'ors' || cached.source === 'ors-matrix')) {
        logger.debug(`Bypassing ORS cache for walker - using heuristic for realistic public transport estimate`);
      } else if (cached) {
        const isRealRoad = cached.source === 'ors' || cached.source === 'ors-matrix' || cached.source === 'osrm';
        const isAcceptable = isRealRoad || cached.source === 'heuristic' || !this.ORS_API_KEY;
        if (isAcceptable) {
          return {
            fromLocation: from,
            toLocation: to,
            distanceKm: (cached.distanceMeters || 0) / 1000,
            travelTimeMinutes: cached.durationMinutes,
            feasible: cached.durationMinutes <= currentMaxTravel,
            penaltyScore: this.calculatePenalty(cached.durationMinutes),
          };
        }
        if (cached.source === 'haversine' && (this.ORS_API_KEY)) {
          logger.debug(`Refreshing haversine cache entry for ${fromLat},${fromLng} → ${toLat},${toLng}`);
        }
      }
    } catch (e) {
      logger.error("Cache lookup failed:", e);
    }

    // 2. Try ORS Directions API (skip for walkers — heuristic matches public transport better)
    if (this.ORS_API_KEY && transportMode !== 'walking') {
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

    // 3. OSRM fallback — real road distances, completely free, no API key required
    if (transportMode !== 'walking') {
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
      logger.warn(`OSRM also failed for ${fromLat},${fromLng} → ${toLat},${toLng} - falling back to Haversine`);
    }

    // 4. Last-resort: Haversine heuristic (straight-line × road factor)
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
   * Uses the ORS Matrix API to fetch hundreds of routes in just a few batch calls,
   * so the scheduler's main loop never hits the ORS rate limit.
   *
   * Fallback chain for pre-warm: ORS Matrix → OSRM (per-pair) → Haversine
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

    // Separate car vs. walking/public employees
    const carEmployees = employeeLocations.filter(e => e.transportMode === 'car');
    const nonCarEmployees = employeeLocations.filter(e => e.transportMode !== 'car');

    // Pre-warm walkers/public with heuristic (fast, no API needed — consistent with scheduler logic)
    for (const emp of nonCarEmployees) {
      for (const client of clientLocations) {
        const fromLat = emp.lat.toString();
        const fromLng = emp.lng.toString();
        const toLat = client.lat.toString();
        const toLng = client.lng.toString();
        try {
          const cached = await storage.getTravelTime(branchId, fromLat, fromLng, toLat, toLng, emp.transportMode);
          if (cached) { totalHits++; continue; }
          const distanceKm = this.calculateHaversineDistance({ lat: emp.lat, lng: emp.lng }, { lat: client.lat, lng: client.lng });
          const durationMinutes = this.calculateHeuristicTravelTime(distanceKm, emp.transportMode);
          const roadDistanceKm = distanceKm * this.ROAD_FACTOR;
          await storage.saveTravelTime({ branchId, fromLat, fromLng, toLat, toLng, transportMode: emp.transportMode, durationMinutes, distanceMeters: Math.round(roadDistanceKm * 1000), source: 'heuristic' });
          totalNew++;
        } catch (_) {}
      }
    }

    if (carEmployees.length === 0) {
      logger.info(`[Cache Pre-warm] Done in ${Date.now() - startTime}ms (walkers only, ${totalNew} new, ${totalHits} hits)`);
      return;
    }

    // For car employees: use ORS Matrix API in batches
    // ORS Matrix: up to 25 sources × 25 destinations per call (safe for free tier)
    for (let ei = 0; ei < carEmployees.length; ei += ORS_MATRIX_BATCH_SIZE) {
      const empBatch = carEmployees.slice(ei, ei + ORS_MATRIX_BATCH_SIZE);

      for (let ci = 0; ci < clientLocations.length; ci += ORS_MATRIX_BATCH_SIZE) {
        const clientBatch = clientLocations.slice(ci, ci + ORS_MATRIX_BATCH_SIZE);

        // Find uncached pairs in this sub-batch
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

        const neededEmps = [...uncachedEmpSet].map(i => empBatch[i]);
        const neededClients = [...uncachedClientSet].map(i => clientBatch[i]);

        // Try ORS Matrix API first
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

        // If ORS Matrix failed, fall back to OSRM per-pair (still real road distances)
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
                // Final fallback: heuristic
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
