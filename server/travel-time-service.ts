/**
 * Travel Time Service for Route Optimization
 * Calculates travel times between locations using haversine distance
 * and transport-mode-specific speeds with 15-minute constraints
 */

export interface Location {
  lat: number;
  lng: number;
}

export interface TravelMatrix {
  fromLocation: Location;
  toLocation: Location;
  distanceKm: number;
  travelTimeMinutes: number;
  feasible: boolean; // Within preferred travel time
  penaltyScore: number; // Soft penalty for longer travel times
}

export type TransportMode = "car" | "walking" | "public";

export class TravelTimeService {
  // Transport mode speeds (km/h)
  private readonly SPEED_KMH: Record<TransportMode, number> = {
    car: 40,        // Urban driving speed
    walking: 4.5,   // Average walking speed
    public: 25      // Public transport average
  };

  private readonly maxTravelMinutes: number;
  private readonly softLimitMinutes: number;

  constructor(maxTravelMinutes: number = 30, softLimitMinutes?: number) {
    this.maxTravelMinutes = maxTravelMinutes;
    this.softLimitMinutes = softLimitMinutes || Math.round(maxTravelMinutes * 0.6); // 60% of max as soft limit
  }

  /**
   * Calculate haversine distance between two points
   */
  calculateDistance(from: Location, to: Location): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(to.lat - from.lat);
    const dLng = this.toRadians(to.lng - from.lng);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(from.lat)) * Math.cos(this.toRadians(to.lat)) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in kilometers
  }

  /**
   * Calculate travel time between locations
   */
  calculateTravelTime(
    from: Location, 
    to: Location, 
    transportMode: TransportMode = "car"
  ): TravelMatrix {
    const distanceKm = this.calculateDistance(from, to);
    const speedKmh = this.SPEED_KMH[transportMode];
    const travelTimeMinutes = Math.round((distanceKm / speedKmh) * 60);
    
    // Calculate soft penalty score
    let penaltyScore = 0;
    if (travelTimeMinutes > this.softLimitMinutes) {
      // Exponential penalty for travel times exceeding soft limit
      const excess = travelTimeMinutes - this.softLimitMinutes;
      const maxExcess = this.maxTravelMinutes - this.softLimitMinutes;
      penaltyScore = Math.pow(excess / maxExcess, 2) * 100; // 0-100 penalty score
    }
    
    return {
      fromLocation: from,
      toLocation: to,
      distanceKm: Math.round(distanceKm * 100) / 100, // Round to 2 decimal places
      travelTimeMinutes,
      feasible: travelTimeMinutes <= this.maxTravelMinutes, // Still mark as feasible within max limit
      penaltyScore
    };
  }

  /**
   * Build travel matrix between all employee and client locations
   */
  buildTravelMatrix(
    employeeLocations: Array<{ id: string; lat: number; lng: number; transportMode: TransportMode }>,
    clientLocations: Array<{ id: string; lat: number; lng: number }>
  ): Map<string, Map<string, TravelMatrix>> {
    const matrix = new Map<string, Map<string, TravelMatrix>>();

    for (const emp of employeeLocations) {
      const empMatrix = new Map<string, TravelMatrix>();
      
      for (const client of clientLocations) {
        const travel = this.calculateTravelTime(
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

  /**
   * Get feasible clients within 15-minute travel time
   */
  getFeasibleClients(
    employeeLocation: Location,
    clientLocations: Array<{ id: string; lat: number; lng: number }>,
    transportMode: TransportMode = "car"
  ): Array<{ id: string; travelTime: TravelMatrix }> {
    const feasibleClients = [];

    for (const client of clientLocations) {
      const travelTime = this.calculateTravelTime(
        employeeLocation,
        { lat: client.lat, lng: client.lng },
        transportMode
      );

      if (travelTime.feasible) {
        feasibleClients.push({
          id: client.id,
          travelTime
        });
      }
    }

    // Sort by travel time (closest first)
    return feasibleClients.sort((a, b) => 
      a.travelTime.travelTimeMinutes - b.travelTime.travelTimeMinutes
    );
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }
}

// Default instance for backward compatibility
export const travelTimeService = new TravelTimeService();