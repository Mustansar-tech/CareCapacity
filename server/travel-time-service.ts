/**
 * Travel Time Service for Route Optimization
 * Calculates travel times between locations using OpenRouteService with haversine fallback
 */

import { storage } from "./storage";

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
  private readonly SPEED_KMH: Record<TransportMode, number> = {
    car: 35,       // Increased from 30 to 35 for better fallback accuracy
    walking: 4.0,
    public: 20
  };

  private readonly maxTravelMinutes: number;
  private readonly softLimitMinutes: number;
  private readonly ORS_API_KEY = process.env.ORS_API_KEY;

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
      
      if (cached && cached.source === 'haversine' && this.ORS_API_KEY) {
        console.log(`🔄 Refreshing travel time cache for ${fromLat},${fromLng} to ${toLat},${toLng} (previously haversine)`);
      }
    } catch (e) {
      console.error("Cache lookup failed:", e);
    }

    // 2. Try OpenRouteService
    if (this.ORS_API_KEY) {
      try {
        // For public transport: use foot-walking for short distances, calculate realistic transit for longer
        const distanceEstimate = this.calculateHaversineDistance(from, to);
        
        // Short distance (<1km): just walk, no need for public transport
        if (transportMode === 'public' && distanceEstimate < 1.0) {
          console.log(`🚶 Short distance (${distanceEstimate.toFixed(2)}km) - using walking instead of public transport`);
          return this.calculateTravelTime(branchId, from, to, 'walking');
        }
        
        // For public transport, we need both walking time and driving time to calculate realistic transit
        let durationMinutes: number;
        let distanceMeters: number;
        
        if (transportMode === 'public') {
          // Get walking route to understand the actual route distance
          const walkingResult = await this.fetchORSRoute(from, to, 'foot-walking');
          
          if (walkingResult) {
            distanceMeters = walkingResult.distanceMeters;
            const walkingMinutes = walkingResult.durationMinutes;
            const distanceKm = distanceMeters / 1000;
            
            // Realistic UK public transport calculation:
            // 1. Walk to bus stop: ~3-5 min (average 4 min)
            // 2. Wait for bus: ~5-10 min (average 7 min for UK bus)
            // 3. Bus travel: roughly 20-25 km/h average speed in urban areas
            // 4. Walk from bus stop to destination: ~3-5 min (average 4 min)
            
            const walkToStop = 4; // minutes
            const waitTime = 7;   // average bus wait time UK
            const walkFromStop = 4; // minutes
            const busSpeedKmh = 22; // average urban bus speed including stops
            
            // Bus covers most of the distance, minus ~400m walking each end
            const busDistanceKm = Math.max(0, distanceKm - 0.8);
            const busTimeMinutes = Math.round((busDistanceKm / busSpeedKmh) * 60);
            
            durationMinutes = walkToStop + waitTime + busTimeMinutes + walkFromStop;
            
            // For very short bus journeys, walking might be faster
            if (walkingMinutes <= durationMinutes && distanceKm < 2.0) {
              console.log(`🚶 Walking faster than bus (${walkingMinutes}min vs ${durationMinutes}min) - using walking`);
              durationMinutes = walkingMinutes;
            } else {
              console.log(`🚌 Public transport breakdown: walk to stop (${walkToStop}min) + wait (${waitTime}min) + bus ${busDistanceKm.toFixed(1)}km (${busTimeMinutes}min) + walk from stop (${walkFromStop}min) = ${durationMinutes}min`);
            }
          } else {
            // Fallback if walking route fails
            distanceMeters = distanceEstimate * 1000;
            durationMinutes = Math.round(15 + (distanceEstimate / 22) * 60); // 15 min overhead + bus time
          }
        } else {
          // Car or walking - use appropriate ORS mode
          const orsMode = transportMode === 'walking' ? 'foot-walking' : 'driving-car';
          console.log(`🌐 Requesting ORS (${orsMode}) for ${fromLat},${fromLng} to ${toLat},${toLng}`);
          
          const result = await this.fetchORSRoute(from, to, orsMode);
          if (!result) {
            throw new Error('ORS request failed');
          }
          durationMinutes = result.durationMinutes;
          distanceMeters = result.distanceMeters;
        }

        console.log(`✅ ORS result: ${durationMinutes} min, ${distanceMeters} m (mode: ${transportMode})`);

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
      } catch (error) {
        console.error("ORS API Exception, falling back to Haversine:", error);
      }
    }

    // 3. Fallback to Haversine
    const distanceKm = this.calculateHaversineDistance(from, to);
    let travelTimeMinutes: number;
    
    if (transportMode === 'public') {
      // Realistic UK public transport fallback calculation
      if (distanceKm < 1.0) {
        // Short distance - just walk
        travelTimeMinutes = Math.max(2, Math.round((distanceKm / 4.0) * 60)); // 4 km/h walking
        console.log(`🚶 [Fallback] Short distance walking: ${travelTimeMinutes} min for ${distanceKm.toFixed(2)} km`);
      } else {
        // Calculate realistic public transport time
        const walkToStop = 4;
        const waitTime = 7;
        const walkFromStop = 4;
        const busSpeedKmh = 22;
        const busDistanceKm = Math.max(0, distanceKm - 0.8);
        const busTimeMinutes = Math.round((busDistanceKm / busSpeedKmh) * 60);
        travelTimeMinutes = walkToStop + waitTime + busTimeMinutes + walkFromStop;
        console.log(`🚌 [Fallback] Public transport: walk (${walkToStop}min) + wait (${waitTime}min) + bus ${busDistanceKm.toFixed(1)}km (${busTimeMinutes}min) + walk (${walkFromStop}min) = ${travelTimeMinutes}min`);
      }
    } else {
      const speedKmh = this.SPEED_KMH[transportMode] || this.SPEED_KMH.car;
      travelTimeMinutes = Math.max(2, Math.round((distanceKm / speedKmh) * 60));
      console.log(`⚠️ Fallback Haversine (${transportMode}, ${speedKmh}km/h): ${travelTimeMinutes} min for ${distanceKm.toFixed(2)} km`);
    }

    // Cache the fallback result
    try {
      await storage.saveTravelTime({
        branchId,
        fromLat,
        fromLng,
        toLat,
        toLng,
        transportMode,
        durationMinutes: travelTimeMinutes,
        distanceMeters: Math.round(distanceKm * 1000),
        source: 'haversine'
      });
    } catch (e) {
      console.error("Cache save failed:", e);
    }

    return {
      fromLocation: from,
      toLocation: to,
      distanceKm: Math.round(distanceKm * 100) / 100,
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

  private async fetchORSRoute(
    from: Location,
    to: Location,
    orsMode: string
  ): Promise<{ durationMinutes: number; distanceMeters: number } | null> {
    if (!this.ORS_API_KEY) return null;
    
    try {
      const response = await fetch(`https://api.openrouteservice.org/v2/directions/${orsMode}`, {
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
        const durationMinutes = Math.max(2, Math.round(durationSeconds / 60));
        return { durationMinutes, distanceMeters: Math.round(distanceMeters) };
      } else {
        const errorText = await response.text();
        console.error(`❌ ORS API Error (${response.status}):`, errorText);
        return null;
      }
    } catch (error) {
      console.error("ORS fetch error:", error);
      return null;
    }
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
