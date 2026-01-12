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
    car: 30,       // Reduced for more realistic urban travel
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
      if (cached) {
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

    // 2. Try OpenRouteService
    if (this.ORS_API_KEY) {
      try {
        const orsMode = transportMode === 'walking' ? 'foot-walking' : 'driving-car';
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
          const durationMinutes = Math.max(1, Math.round(durationSeconds / 60));

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
        }
      } catch (error) {
        console.error("ORS API Error, falling back to Haversine:", error);
      }
    }

    // 3. Fallback to Haversine
    const distanceKm = this.calculateHaversineDistance(from, to);
    const speedKmh = this.SPEED_KMH[transportMode] || this.SPEED_KMH.car;
    const travelTimeMinutes = Math.max(1, Math.round((distanceKm / speedKmh) * 60));

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
