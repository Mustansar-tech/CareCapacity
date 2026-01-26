/**
 * Travel Time Service for Route Optimization
 * Calculates travel times between locations using:
 * - OpenRouteService for driving and walking routes
 * - NaPTAN + ORS for multi-modal public transport (walk → bus → walk)
 */

import { storage } from "./storage";
import { naptanService } from "./naptan-service";

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

export class TravelTimeService {
  // Road distance inflation factor (Haversine × 1.2 approximates UK road distance)
  private readonly ROAD_FACTOR = 1.2;
  
  // Mode-specific average speeds (km/h) and minimums (minutes)
  // Note: For 'walking' and 'public', we prefer ORS foot-walking API for accurate path routing
  // The haversine fallback uses these speeds only when ORS is unavailable
  private readonly MODE_CONFIG: Record<TransportMode, { speedKmh: number; overheadMinutes: number; minMinutes: number; orsProfile: string }> = {
    car: { speedKmh: 32.5, overheadMinutes: 0, minMinutes: 5, orsProfile: 'driving-car' },
    walking: { speedKmh: 4.5, overheadMinutes: 0, minMinutes: 3, orsProfile: 'foot-walking' }, // Real walking speed ~4.5 km/h
    public: { speedKmh: 4.5, overheadMinutes: 15, minMinutes: 10, orsProfile: 'foot-walking' } // Walking + bus wait/travel overhead
  };

  private readonly maxTravelMinutes: number;
  private readonly softLimitMinutes: number;
  private readonly ORS_API_KEY = process.env.ORS_API_KEY;
  
  // Get time-of-day congestion multiplier
  private getTimeOfDayMultiplier(startTimeMinutes?: number): number {
    if (startTimeMinutes === undefined) return 1.0;
    const hours = startTimeMinutes / 60;
    if (hours >= 7 && hours < 9.5) return 1.3;      // Morning peak
    if (hours >= 15.5 && hours < 18.5) return 1.25; // School run / evening
    return 1.0; // Off-peak
  }
  
  // Calculate heuristic travel time using distance-based approach
  private calculateHeuristicTravelTime(straightLineKm: number, mode: TransportMode, startTimeMinutes?: number): number {
    const roadDistanceKm = straightLineKm * this.ROAD_FACTOR;
    const config = this.MODE_CONFIG[mode] || this.MODE_CONFIG.car;
    
    const baseTravelMinutes = (roadDistanceKm / config.speedKmh) * 60 + config.overheadMinutes;
    const congestionMultiplier = this.getTimeOfDayMultiplier(startTimeMinutes);
    const adjustedMinutes = baseTravelMinutes * congestionMultiplier;
    
    return Math.max(config.minMinutes, Math.round(adjustedMinutes));
  }

  constructor(maxTravelMinutes: number = 20, softLimitMinutes?: number) {
    this.maxTravelMinutes = maxTravelMinutes;
    this.softLimitMinutes = softLimitMinutes || Math.round(maxTravelMinutes * 0.75);
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

    // 1. Check Cache
    try {
      const cached = await storage.getTravelTime(branchId, fromLat, fromLng, toLat, toLng, transportMode);
      // Only return cached value if it's from ORS, or if we don't have an API key to refresh it
      if (cached && (cached.source === 'ors' || !this.ORS_API_KEY)) {
        return {
          fromLocation: from,
          toLocation: to,
          distanceKm: (cached.distanceMeters || 0) / 1000,
          travelTimeMinutes: cached.durationMinutes,
          feasible: cached.durationMinutes <= this.maxTravelMinutes,
          penaltyScore: this.calculatePenalty(cached.durationMinutes)
        };
      }
      
      if (cached && (cached.source === 'haversine' || cached.source === 'heuristic') && this.ORS_API_KEY) {
        console.log(`🔄 Refreshing travel time cache for ${fromLat},${fromLng} to ${toLat},${toLng} (previously ${cached.source})`);
      }
    } catch (e) {
      console.error("Cache lookup failed:", e);
    }

    // 2. Try OpenRouteService - Use ORS for ALL modes now
    // For cars: driving-car profile
    // For walking/public: foot-walking profile (accurate paths along real roads/paths)
    if (this.ORS_API_KEY) {
      try {
        const config = this.MODE_CONFIG[transportMode] || this.MODE_CONFIG.car;
        const orsProfile = config.orsProfile;
        
        console.log(`🌐 Requesting ORS (${orsProfile}) for ${transportMode}: ${fromLat},${fromLng} to ${toLat},${toLng}`);
        const response = await fetch(`https://api.openrouteservice.org/v2/directions/${orsProfile}`, {
          method: 'POST',
          headers: {
            'Authorization': this.ORS_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            coordinates: [[from.lng, from.lat], [to.lng, to.lat]]
          })
        });

        if (response.ok) {
          const data = await response.json();
          const durationSeconds = data.routes[0].summary.duration;
          const distanceMeters = data.routes[0].summary.distance;
          let durationMinutes = Math.max(config.minMinutes, Math.round(durationSeconds / 60));

          // For public transport: use NaPTAN to find actual bus stops and calculate multi-modal route
          if (transportMode === 'public') {
            const pureWalkingMinutes = durationMinutes;
            
            // Try to find a transit route using NaPTAN
            try {
              const transitRoute = await naptanService.findBestTransitRoute(from, to, 800);
              
              if (transitRoute && transitRoute.originStop && transitRoute.destinationStop) {
                // Calculate walking times to/from stops using ORS walking speed (5 km/h average)
                const walkToStopMinutes = Math.round((transitRoute.walkToStopMeters / 1000) / 5 * 60);
                const walkFromStopMinutes = Math.round((transitRoute.walkFromStopMeters / 1000) / 5 * 60);
                const busMinutes = transitRoute.estimatedTransitMinutes;
                
                const multiModalMinutes = walkToStopMinutes + busMinutes + walkFromStopMinutes;
                
                // Use transit if it saves time vs pure walking
                if (multiModalMinutes < pureWalkingMinutes) {
                  durationMinutes = multiModalMinutes;
                  console.log(`🚌 NaPTAN multi-modal: Walk ${walkToStopMinutes}min → ${transitRoute.originStop.commonName} → Bus ${busMinutes}min → ${transitRoute.destinationStop.commonName} → Walk ${walkFromStopMinutes}min = ${durationMinutes}min (saved ${pureWalkingMinutes - multiModalMinutes}min vs walking)`);
                } else {
                  // Walking is faster, just add small buffer
                  durationMinutes = pureWalkingMinutes + 3;
                  console.log(`🚶 Walking faster than transit: ${durationMinutes}min (transit would be ${multiModalMinutes}min)`);
                }
              } else {
                // No bus stops found nearby - use walking with buffer
                durationMinutes = pureWalkingMinutes + 5;
                console.log(`🚶 No nearby stops, walking with buffer: ${durationMinutes}min`);
              }
            } catch (transitError) {
              // Fallback: estimate based on walking time
              if (pureWalkingMinutes > 20) {
                const busTimeSaved = Math.round(pureWalkingMinutes * 0.4);
                durationMinutes = pureWalkingMinutes - busTimeSaved + 10;
                console.log(`🚌 Estimated transit (NaPTAN unavailable): ${durationMinutes}min`);
              } else {
                durationMinutes = pureWalkingMinutes + 5;
                console.log(`🚶 Short distance walking: ${durationMinutes}min`);
              }
            }
          } else if (transportMode === 'walking') {
            console.log(`🚶 ORS foot-walking: ${durationMinutes} min for ${(distanceMeters/1000).toFixed(2)} km`);
          } else {
            console.log(`🚗 ORS driving: ${durationMinutes} min for ${(distanceMeters/1000).toFixed(2)} km`);
          }

          await storage.saveTravelTime({
            branchId,
            fromLat,
            fromLng,
            toLat,
            toLng,
            transportMode,
            durationMinutes,
            distanceMeters: Math.round(distanceMeters),
            source: 'ors'
          });

          return {
            fromLocation: from,
            toLocation: to,
            distanceKm: distanceMeters / 1000,
            travelTimeMinutes: durationMinutes,
            feasible: durationMinutes <= this.maxTravelMinutes,
            penaltyScore: this.calculatePenalty(durationMinutes)
          };
        } else {
          const errorText = await response.text();
          console.error(`❌ ORS API Error (${response.status}):`, errorText);
        }
      } catch (error) {
        console.error("ORS API Exception, falling back to Haversine:", error);
      }
    }

    // 3. Fallback to Heuristic (Haversine × 1.2 road factor with mode-specific speeds)
    const distanceKm = this.calculateHaversineDistance(from, to);
    const travelTimeMinutes = this.calculateHeuristicTravelTime(distanceKm, transportMode);
    const config = this.MODE_CONFIG[transportMode] || this.MODE_CONFIG.car;

    console.log(`⚠️ Heuristic fallback (${transportMode}, ${config.speedKmh}km/h): ${travelTimeMinutes} min for ${(distanceKm * this.ROAD_FACTOR).toFixed(2)} km road distance`);

    // Cache the fallback result (using road distance)
    const roadDistanceKm = distanceKm * this.ROAD_FACTOR;
    try {
      await storage.saveTravelTime({
        branchId,
        fromLat,
        fromLng,
        toLat,
        toLng,
        transportMode,
        durationMinutes: travelTimeMinutes,
        distanceMeters: Math.round(roadDistanceKm * 1000),
        source: 'heuristic'
      });
    } catch (e) {
      console.error("Cache save failed:", e);
    }

    return {
      fromLocation: from,
      toLocation: to,
      distanceKm: Math.round(roadDistanceKm * 100) / 100,
      travelTimeMinutes,
      feasible: travelTimeMinutes <= this.maxTravelMinutes,
      penaltyScore: this.calculatePenalty(travelTimeMinutes)
    };
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
    return feasibleClients.sort((a, b) => 
      a.travelTime.travelTimeMinutes - b.travelTime.travelTimeMinutes
    );
  }

  private calculatePenalty(minutes: number): number {
    if (minutes <= this.softLimitMinutes) return 0;
    const excess = minutes - this.softLimitMinutes;
    const maxExcess = this.maxTravelMinutes - this.softLimitMinutes;
    return Math.pow(excess / maxExcess, 2) * 100;
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
}

export const travelTimeService = new TravelTimeService();

// Normalize names to handle special characters
function normalizeName(name: string): string {
  if (!name) return '';
  return name.trim().toLowerCase().replace(/\s+/g, ' ').replace(/['"''""]/g, '').replace(/['']/g, "'").replace(/\s*\([^)]*\)/g, '').trim();
}

// Enhanced location lookup
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
    console.error(`Error getting location for ${type} ${name}:`, error);
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
    console.error(`Error calculating travel time:`, error);
    return 0;
  }
}
