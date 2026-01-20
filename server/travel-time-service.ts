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

  constructor(maxTravelMinutes: number = 60, softLimitMinutes?: number) {
    console.log(`🚀 TravelTimeService initialized with ORS_API_KEY: ${this.ORS_API_KEY ? 'YES' : 'NO'}`);
    this.maxTravelMinutes = maxTravelMinutes;
    this.softLimitMinutes = softLimitMinutes || Math.round(maxTravelMinutes * 0.75);
  }

  async calculateTravelTime(
    branchId: string,
    from: Location,
    to: Location,
    transportMode: TransportMode = "car"
  ): Promise<TravelMatrix> {
    // Round coordinates to 4 decimal places for cache consistency (NON-NEGOTIABLE)
    const fLatStr = Number(from.lat).toFixed(4);
    const fLngStr = Number(from.lng).toFixed(4);
    const tLatStr = Number(to.lat).toFixed(4);
    const tLngStr = Number(to.lng).toFixed(4);

    const fLatNum = Number(fLatStr);
    const fLngNum = Number(fLngStr);
    const tLatNum = Number(tLatStr);
    const tLngNum = Number(tLngStr);

    // 1. Check Cache
    try {
      const cached = await storage.getTravelTime(branchId, fLatStr, fLngStr, tLatStr, tLngStr, transportMode);
      // Return cached value if it's from ORS
      if (cached && (cached.source === 'ors' || !this.ORS_API_KEY)) {
        console.log(`✨ Travel Cache HIT: ${fLatStr},${fLngStr} → ${tLatStr},${tLngStr} (${transportMode}) = ${cached.durationMinutes}min`);
        return {
          fromLocation: from,
          toLocation: to,
          distanceKm: (cached.distanceMeters || 0) / 1000,
          travelTimeMinutes: cached.durationMinutes,
          feasible: cached.durationMinutes <= this.maxTravelMinutes,
          penaltyScore: this.calculatePenalty(cached.durationMinutes)
        };
      }
    } catch (e) {
      console.error("Cache lookup failed:", e);
    }

    // 2. Try OpenRouteService (CAR ONLY - KILL WALKING ORS CALLS)
    if (this.ORS_API_KEY && transportMode === 'car') {
      try {
        console.log(`🌐 Requesting ORS (driving-car) for ${fLatStr},${fLngStr} to ${tLatStr},${tLngStr}`);
        const result = await this.fetchORSRoute({ lat: fLatNum, lng: fLngNum }, { lat: tLatNum, lng: tLngNum }, 'driving-car');
        
        if (result) {
          const durationMinutes = result.durationMinutes;
          const distanceMeters = result.distanceMeters;

          console.log(`✅ ORS result: ${durationMinutes} min, ${distanceMeters} m (mode: car)`);

          await storage.saveTravelTime({
            branchId,
            fromLat: fLatStr,
            fromLng: fLngStr,
            toLat: tLatStr,
            toLng: tLngStr,
            transportMode: 'car',
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
        }
      } catch (error) {
        console.error("ORS API Exception, falling back to Haversine:", error);
      }
    }

    // 3. Fallback/Approximation (Walking & Public use Haversine × 1.2 + Fixed Penalty)
    const rawDistanceKm = this.calculateHaversineDistance({ lat: fLatNum, lng: fLngNum }, { lat: tLatNum, lng: tLngNum });
    // Apply 1.2 multiplier for road distance approximation
    const distanceKm = rawDistanceKm * 1.2;
    let travelTimeMinutes: number;
    let penaltyBonus = 0;
    
    if (transportMode === 'car') {
      const speedKmh = this.SPEED_KMH.car;
      travelTimeMinutes = Math.max(2, Math.round((distanceKm / speedKmh) * 60));
      console.log(`⚠️ Fallback Haversine (car, ${speedKmh}km/h): ${travelTimeMinutes} min for ${distanceKm.toFixed(2)} km (incl 1.2x factor)`);
    } else {
      // Walking and Public now both use public transport approximation (NO FOOT-WALKING ORS CALLS)
      // Formula: (Distance / 20km/h) * 60 + 15 min fixed penalty
      const baseTime = (distanceKm / 20) * 60;
      const fixedPenalty = 15;
      travelTimeMinutes = Math.max(5, Math.round(baseTime + fixedPenalty));
      penaltyBonus = 20; // Extra penalty score for non-car modes
      console.log(`🚌 [Approximation] ${transportMode}: ${travelTimeMinutes} min (${distanceKm.toFixed(2)} km @ 20km/h + 15min fixed penalty)`);
    }

    // Cache the result
    try {
      await storage.saveTravelTime({
        branchId,
        fromLat: fLatStr,
        fromLng: fLngStr,
        toLat: tLatStr,
        toLng: tLngStr,
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
      penaltyScore: this.calculatePenalty(travelTimeMinutes) + penaltyBonus
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
