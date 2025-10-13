/**
 * Travel Time Service for Route Optimization
 * Calculates travel times between locations using haversine distance
 * and transport-mode-specific speeds with 15-minute constraints
 */

// Mock storage interface for demonstration purposes. Replace with your actual storage implementation.
const storage = {
  getClientLocationByName: async (name: string) => {
    // Simulate fetching from a database
    const clients = mockClients; // Use mock data
    const normalizedName = normalizeName(name);
    let foundClient = clients.find(c => normalizeName(c.clientName) === normalizedName);

    if (foundClient) {
      // Simulate a successful lookup
      return {
        id: foundClient.id,
        lat: foundClient.lat,
        lng: foundClient.lng,
        clientName: foundClient.clientName,
      };
    }
    return null;
  },
  getAllClientLocations: async () => {
    // Simulate fetching all clients
    return mockClients.map(c => ({
      id: c.id,
      clientName: c.clientName,
      lat: c.lat,
      lng: c.lng,
    }));
  },
  getEmployeeLocationByName: async (name: string) => {
    // Simulate fetching from a database
    const employees = mockEmployees; // Use mock data
    const normalizedName = normalizeName(name);
    let foundEmployee = employees.find(e => normalizeName(e.employeeName) === normalizedName);

    if (foundEmployee) {
      // Simulate a successful lookup
      return {
        id: foundEmployee.id,
        homeLat: foundEmployee.homeLat,
        homeLng: foundEmployee.homeLng,
        employeeName: foundEmployee.employeeName,
      };
    }
    return null;
  },
  getAllEmployeeLocations: async () => {
    // Simulate fetching all employees
    return mockEmployees.map(e => ({
      id: e.id,
      employeeName: e.employeeName,
      homeLat: e.homeLat,
      homeLng: e.homeLng,
    }));
  },
};

// Mock data for clients and employees
const mockClients = [
  { id: 'c1', clientName: 'Acme Corp', lat: '40.7128', lng: '-74.0060' },
  { id: 'c2', clientName: 'Beta Industries', lat: '34.0522', lng: '-118.2437' },
  { id: 'c3', clientName: 'Gamma Solutions (NL)', lat: '48.8566', lng: '2.3522' },
  { id: 'c4', clientName: 'Delta Enterprises', lat: '51.5074', lng: '-0.1278' },
  { id: 'c5', clientName: 'Epsilon LLC', lat: '35.6895', lng: '139.6917' },
  { id: 'c6', clientName: 'Zeta Group', lat: '41.8781', lng: '-87.6298' },
  { id: 'c7', clientName: 'Omega Systems', lat: '37.7749', lng: '-122.4194' },
  { id: 'c8', clientName: 'Alpha Co.', lat: '40.7128', lng: '-74.0060' }, // Duplicate coords, diff name
  { id: 'c9', clientName: 'Smith & Sons', lat: '34.0522', lng: '-118.2437' }, // Duplicate coords, diff name
];

const mockEmployees = [
  { id: 'e1', employeeName: 'John Smith', homeLat: '40.7000', homeLng: '-74.0000', transportMode: 'car' as const },
  { id: 'e2', employeeName: 'Jane Doe', homeLat: '34.0000', homeLng: '-118.2000', transportMode: 'car' as const },
  { id: 'e3', employeeName: 'Peter Jones', homeLat: '48.8000', homeLng: '2.3000', transportMode: 'walking' as const },
  { id: 'e4', employeeName: 'Alice Brown', homeLat: '51.5000', homeLng: '-0.1000', transportMode: 'public' as const },
  { id: 'e5', employeeName: 'Bob White', homeLat: '35.6000', homeLng: '139.6000', transportMode: 'car' as const },
  { id: 'e6', employeeName: 'Charlie Green', homeLat: '41.8000', homeLng: '-87.6000', transportMode: 'car' as const },
  { id: 'e7', employeeName: 'Diana Black', homeLat: '37.7000', homeLng: '-122.4000', transportMode: 'walking' as const },
  { id: 'e8', employeeName: 'Smith, John', homeLat: '40.7000', homeLng: '-74.0000', transportMode: 'car' as const }, // Different format, same person/coords
];


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

  constructor(maxTravelMinutes: number = 20, softLimitMinutes?: number) {
    this.maxTravelMinutes = maxTravelMinutes;
    this.softLimitMinutes = softLimitMinutes || Math.round(maxTravelMinutes * 0.75); // 75% of max as soft limit (15min)
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
    // Validate input coordinates
    if (!Number.isFinite(from.lat) || !Number.isFinite(from.lng) || 
        !Number.isFinite(to.lat) || !Number.isFinite(to.lng)) {
      console.log(`⚠️ Invalid coordinates: from(${from.lat}, ${from.lng}) to(${to.lat}, ${to.lng})`);
      throw new Error('Invalid coordinates provided');
    }

    const distanceKm = this.calculateDistance(from, to);
    const speedKmh = this.SPEED_KMH[transportMode] || this.SPEED_KMH.car;
    const travelTimeMinutes = Math.max(1, Math.round((distanceKm / speedKmh) * 60)); // Minimum 1 minute

    console.log(`🚗 Travel calc: ${distanceKm.toFixed(2)}km at ${speedKmh}km/h = ${travelTimeMinutes}min (${transportMode})`);

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

// Normalize names to handle special characters, encoding issues, etc.
function normalizeName(name: string): string {
  if (!name) return '';

  return name
    .trim()
    .toLowerCase()
    // Remove extra whitespace
    .replace(/\s+/g, ' ')
    // Remove common punctuation that might cause mismatches
    .replace(/['"''""]/g, '')
    // Normalize apostrophes
    .replace(/['']/g, "'")
    // Remove parentheses content like "(NL)" 
    .replace(/\s*\([^)]*\)/g, '')
    .trim();
}


// Enhanced location lookup with better name matching
async function getLocationCoordinates(name: string, type: 'client' | 'employee'): Promise<{ lat: number; lng: number } | null> {
  try {
    if (type === 'client') {
      // First try exact name match
      let clientLocation = await storage.getClientLocationByName(name);

      // If no exact match, try fuzzy matching on all client locations
      if (!clientLocation) {
        const allClients = await storage.getAllClientLocations();

        // Try partial matching with normalized names
        clientLocation = allClients.find(client => {
          const storedName = normalizeName(client.clientName);
          const searchName = normalizeName(name);

          // Try exact match first
          if (storedName === searchName) return true;

          // Then try partial matches (both directions)
          if (storedName.includes(searchName) || searchName.includes(storedName)) return true;

          // Try matching individual words (for cases like "Smith, John" vs "John Smith")
          const storedWords = storedName.split(/[\s,]+/).filter(w => w.length > 1);
          const searchWords = searchName.split(/[\s,]+/).filter(w => w.length > 1);

          // Check if at least 2 words match (or all words if fewer than 2)
          const matchingWords = storedWords.filter(word => 
            searchWords.some(searchWord => searchWord.includes(word) || word.includes(searchWord))
          );

          return matchingWords.length >= Math.min(2, Math.min(storedWords.length, searchWords.length));
        });

        if (clientLocation) {
          console.log(`🔍 Found client via fuzzy match: "${name}" -> "${clientLocation.clientName}"`);
        }
      }

      if (clientLocation && clientLocation.lat && clientLocation.lng) {
        return {
          lat: parseFloat(clientLocation.lat),
          lng: parseFloat(clientLocation.lng)
        };
      }
    } else if (type === 'employee') {
      // First try exact name match
      let employeeLocation = await storage.getEmployeeLocationByName(name);

      // If no exact match, try fuzzy matching on all employee locations
      if (!employeeLocation) {
        const allEmployees = await storage.getAllEmployeeLocations();

        // Try partial matching with normalized names
        employeeLocation = allEmployees.find(employee => {
          const storedName = normalizeName(employee.employeeName);
          const searchName = normalizeName(name);

          // Try exact match first
          if (storedName === searchName) return true;

          // Then try partial matches (both directions)
          if (storedName.includes(searchName) || searchName.includes(storedName)) return true;

          // Try matching individual words (for cases like "Smith, John" vs "John Smith")
          const storedWords = storedName.split(/[\s,]+/).filter(w => w.length > 1);
          const searchWords = searchName.split(/[\s,]+/).filter(w => w.length > 1);

          // Check if at least 2 words match (or all words if fewer than 2)
          const matchingWords = storedWords.filter(word => 
            searchWords.some(searchWord => searchWord.includes(word) || word.includes(searchWord))
          );

          return matchingWords.length >= Math.min(2, Math.min(storedWords.length, searchWords.length));
        });

        if (employeeLocation) {
          console.log(`🔍 Found employee via fuzzy match: "${name}" -> "${employeeLocation.employeeName}"`);
        }
      }

      if (employeeLocation && employeeLocation.homeLat && employeeLocation.homeLng) {
        return {
          lat: parseFloat(employeeLocation.homeLat),
          lng: parseFloat(employeeLocation.homeLng)
        };
      }
    }

    console.log(`❌ Location not found for ${type}: ${name}`);
    return null;
  } catch (error) {
    console.error(`Error getting location for ${type} ${name}:`, error);
    return null;
  }
}

export async function calculateTravelTime(
  employeeName: string,
  clientName: string,
  transportMode: 'walking' | 'car' = 'car'
): Promise<number> {
  try {
    // Debug: Log what we're searching for
    console.log(`🔍 Travel calc searching - Employee: "${employeeName}", Client: "${clientName}"`);

    // Get coordinates for both locations
    const employeeCoords = await getLocationCoordinates(employeeName, 'employee');
    const clientCoords = await getLocationCoordinates(clientName, 'client');

    if (!employeeCoords || !clientCoords) {
      // Debug: Show what names are actually available in the database
      if (!employeeCoords) {
        const allEmployees = await storage.getAllEmployeeLocations();
        const availableEmployeeNames = allEmployees.map(e => e.employeeName).slice(0, 5);
        console.log(`❌ Employee "${employeeName}" not found. Available employees (first 5): ${availableEmployeeNames.join(', ')}`);
      }

      if (!clientCoords) {
        const allClients = await storage.getAllClientLocations();
        const availableClientNames = allClients.map(c => c.clientName).slice(0, 5);
        console.log(`❌ Client "${clientName}" not found. Available clients (first 5): ${availableClientNames.join(', ')}`);
      }

      console.log(`Missing location data for ${clientName} or ${employeeName}`);
      return 0; // Return 0 minutes if we can't calculate travel time
    }

    // Use the existing TravelTimeService instance to calculate travel time
    const travelTimeService = new TravelTimeService(); // Or get a singleton instance if preferred
    const travelMatrix = travelTimeService.calculateTravelTime(
      employeeCoords,
      clientCoords,
      transportMode
    );

    return travelMatrix.travelTimeMinutes;

  } catch (error) {
    console.error(`Error calculating travel time between ${employeeName} and ${clientName}:`, error);
    return 0; // Return 0 in case of any error
  }
}

// Default instance for backward compatibility
export const travelTimeService = new TravelTimeService();