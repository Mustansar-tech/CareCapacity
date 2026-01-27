/**
 * NaPTAN Service for Public Transport Stop Discovery
 * Uses the UK National Public Transport Access Nodes API to find nearby bus/train stops
 */

export interface NaptanStop {
  atcoCode: string;
  commonName: string;
  localityName: string;
  lat: number;
  lng: number;
  stopType: string; // 'BCT' = bus, 'RLY' = rail, 'MET' = metro, etc.
  distanceMeters: number;
}

export interface Location {
  lat: number;
  lng: number;
}

// Scotland ATCO area codes (601-690)
const SCOTLAND_ATCO_CODES = [
  '600', '601', '602', '603', '604', '605', '606', '607', '608', '609',
  '610', '611', '612', '613', '614', '615', '616', '617', '618', '619',
  '620', '621', '622', '623', '624', '625', '626', '627', '628', '629',
  '630', '631', '632', '633', '634', '635', '636', '637', '638', '639',
  '640', '641', '642', '643', '644', '645', '646', '647', '648', '649'
];

// Cache for NaPTAN data by area
const naptanCache = new Map<string, { stops: NaptanStop[]; timestamp: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

class NaptanService {
  private readonly API_BASE = 'https://naptan.api.dft.gov.uk/v1';
  
  /**
   * Calculate Haversine distance between two points in meters
   */
  private calculateDistance(from: Location, to: Location): number {
    const R = 6371000; // Earth's radius in meters
    const dLat = this.toRadians(to.lat - from.lat);
    const dLng = this.toRadians(to.lng - from.lng);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(from.lat)) * Math.cos(this.toRadians(to.lat)) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
  
  private toRadians(deg: number): number {
    return deg * (Math.PI / 180);
  }
  
  /**
   * Get relevant ATCO area codes from coordinates for Scotland
   * Returns multiple codes to ensure coverage across administrative boundaries
   */
  private getAtcoAreasFromCoords(lat: number, lng: number): string[] {
    const areas: string[] = [];
    
    // Scotland regions mapped to ATCO codes with approximate bounding boxes
    const scottishRegions = [
      { code: '609', name: 'Glasgow', minLat: 55.7, maxLat: 55.95, minLng: -4.6, maxLng: -4.0 },
      { code: '610', name: 'South Lanarkshire', minLat: 55.4, maxLat: 55.8, minLng: -4.2, maxLng: -3.4 },
      { code: '611', name: 'North Lanarkshire', minLat: 55.7, maxLat: 56.0, minLng: -4.2, maxLng: -3.6 },
      { code: '612', name: 'East Dunbartonshire', minLat: 55.9, maxLat: 56.1, minLng: -4.4, maxLng: -4.0 },
      { code: '613', name: 'West Dunbartonshire', minLat: 55.9, maxLat: 56.1, minLng: -4.8, maxLng: -4.3 },
      { code: '614', name: 'Renfrewshire', minLat: 55.7, maxLat: 55.95, minLng: -4.7, maxLng: -4.3 },
      { code: '615', name: 'East Renfrewshire', minLat: 55.7, maxLat: 55.85, minLng: -4.5, maxLng: -4.2 },
      { code: '616', name: 'Inverclyde', minLat: 55.85, maxLat: 56.0, minLng: -4.9, maxLng: -4.6 },
      { code: '620', name: 'Edinburgh', minLat: 55.85, maxLat: 56.0, minLng: -3.4, maxLng: -3.0 },
      { code: '621', name: 'Midlothian', minLat: 55.75, maxLat: 55.95, minLng: -3.2, maxLng: -2.9 },
      { code: '622', name: 'East Lothian', minLat: 55.85, maxLat: 56.05, minLng: -3.0, maxLng: -2.4 },
      { code: '623', name: 'West Lothian', minLat: 55.85, maxLat: 56.0, minLng: -3.8, maxLng: -3.3 },
      { code: '639', name: 'Aberdeen City', minLat: 57.1, maxLat: 57.2, minLng: -2.3, maxLng: -2.0 },
      { code: '640', name: 'Aberdeenshire', minLat: 56.8, maxLat: 57.7, minLng: -3.5, maxLng: -1.8 },
      { code: '648', name: 'Dundee', minLat: 56.4, maxLat: 56.5, minLng: -3.1, maxLng: -2.8 },
      { code: '649', name: 'Angus', minLat: 56.5, maxLat: 56.9, minLng: -3.4, maxLng: -2.4 },
      { code: '650', name: 'Perth & Kinross', minLat: 56.2, maxLat: 56.9, minLng: -4.5, maxLng: -3.2 },
      { code: '660', name: 'Fife', minLat: 56.0, maxLat: 56.5, minLng: -3.5, maxLng: -2.7 },
      { code: '670', name: 'Stirling', minLat: 56.0, maxLat: 56.5, minLng: -4.3, maxLng: -3.8 },
      { code: '630', name: 'Scottish Borders', minLat: 55.3, maxLat: 55.8, minLng: -3.5, maxLng: -2.0 },
      { code: '617', name: 'Argyll & Bute', minLat: 55.8, maxLat: 56.8, minLng: -6.5, maxLng: -4.6 },
      { code: '680', name: 'Highland', minLat: 56.5, maxLat: 58.6, minLng: -7.0, maxLng: -3.0 },
    ];
    
    // Find matching regions (with 0.1 degree buffer for boundary cases)
    const buffer = 0.15;
    for (const region of scottishRegions) {
      if (lat >= region.minLat - buffer && lat <= region.maxLat + buffer &&
          lng >= region.minLng - buffer && lng <= region.maxLng + buffer) {
        areas.push(region.code);
      }
    }
    
    // If no specific match found, use nearest major city
    if (areas.length === 0) {
      // Default to Glasgow + Edinburgh + nearby areas for central belt coverage
      if (lat >= 55.0 && lat <= 57.0) {
        areas.push('609', '620', '610', '660'); // Glasgow, Edinburgh, S Lanarkshire, Fife
      } else if (lat >= 57.0) {
        areas.push('639', '640', '680'); // Aberdeen, Aberdeenshire, Highland
      } else {
        areas.push('630', '610'); // Borders, S Lanarkshire
      }
    }
    
    console.log(`📍 Location ${lat.toFixed(3)}, ${lng.toFixed(3)} → ATCO areas: ${areas.join(', ')}`);
    return areas;
  }
  
  /**
   * Fetch stops from NaPTAN API for a given area
   */
  private async fetchStopsForArea(atcoCode: string, retryCount: number = 0): Promise<NaptanStop[]> {
    // Check cache first
    const cached = naptanCache.get(atcoCode);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.stops;
    }
    
    try {
      // Add a small jittered delay to avoid hitting the API too hard at once
      await new Promise(resolve => setTimeout(resolve, Math.random() * 800));

      const response = await fetch(
        `${this.API_BASE}/access-nodes?atcoAreaCodes=${atcoCode}&dataFormat=json`,
        {
          headers: {
            'Accept': 'application/json'
          }
        }
      );
      
      if (response.status === 429 && retryCount < 2) {
        console.warn(`⏳ NaPTAN Rate limit for area ${atcoCode}, waiting 3s...`);
        await new Promise(resolve => setTimeout(resolve, 3000 * (retryCount + 1)));
        return this.fetchStopsForArea(atcoCode, retryCount + 1);
      }

      if (!response.ok) {
        console.error(`NaPTAN API error: ${response.status} for area ${atcoCode}`);
        return [];
      }
      
      const data = await response.json();
      
      // Parse the response - NaPTAN returns an array of stops
      const stops: NaptanStop[] = (data.stops || data || [])
        .filter((stop: any) => stop.Latitude && stop.Longitude)
        .map((stop: any) => ({
          atcoCode: stop.ATCOCode || stop.atcoCode,
          commonName: stop.CommonName || stop.commonName || 'Unknown Stop',
          localityName: stop.LocalityName || stop.localityName || '',
          lat: parseFloat(stop.Latitude || stop.latitude),
          lng: parseFloat(stop.Longitude || stop.longitude),
          stopType: stop.StopType || stop.stopType || 'BCT',
          distanceMeters: 0
        }));
      
      console.log(`✅ Loaded ${stops.length} stops for area ${atcoCode}`);
      
      // Cache the results
      naptanCache.set(atcoCode, { stops, timestamp: Date.now() });
      
      return stops;
    } catch (error) {
      console.error(`NaPTAN fetch error for area ${atcoCode}:`, error);
      return [];
    }
  }
  
  /**
   * Find nearest bus/train stops to a given location
   * Fetches from multiple relevant ATCO areas to ensure coverage
   */
  async findNearestStops(
    location: Location,
    maxDistanceMeters: number = 1000,
    limit: number = 5,
    stopTypes: string[] = ['BCT', 'BCS', 'RLY', 'MET'] // Bus, Rail, Metro stops
  ): Promise<NaptanStop[]> {
    const atcoCodes = this.getAtcoAreasFromCoords(location.lat, location.lng);
    
    // Fetch stops from all relevant areas in parallel
    const stopsArrays = await Promise.all(
      atcoCodes.map(code => this.fetchStopsForArea(code))
    );
    
    // Combine all stops from all areas
    const allStops = stopsArrays.flat();
    
    // Calculate distance to each stop and filter/sort
    const nearbyStops = allStops
      .filter(stop => stopTypes.includes(stop.stopType))
      .map(stop => ({
        ...stop,
        distanceMeters: this.calculateDistance(location, { lat: stop.lat, lng: stop.lng })
      }))
      .filter(stop => stop.distanceMeters <= maxDistanceMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, limit);
    
    console.log(`🚏 Found ${nearbyStops.length} stops within ${maxDistanceMeters}m from ${atcoCodes.length} areas`);
    return nearbyStops;
  }
  
  /**
   * Find the best transit route between two locations
   * Returns origin stop, destination stop, and estimated times
   */
  async findBestTransitRoute(
    origin: Location,
    destination: Location,
    maxWalkDistanceMeters: number = 800 // Max walk to/from stop
  ): Promise<{
    originStop: NaptanStop | null;
    destinationStop: NaptanStop | null;
    walkToStopMeters: number;
    walkFromStopMeters: number;
    transitDistanceMeters: number;
    estimatedTransitMinutes: number;
  } | null> {
    try {
      // Find stops near origin and destination
      const [originStops, destStops] = await Promise.all([
        this.findNearestStops(origin, maxWalkDistanceMeters, 3),
        this.findNearestStops(destination, maxWalkDistanceMeters, 3)
      ]);
      
      if (originStops.length === 0 || destStops.length === 0) {
        console.log(`🚏 No nearby stops found within ${maxWalkDistanceMeters}m`);
        return null;
      }
      
      // Find the best combination (shortest total walk + reasonable transit)
      let bestRoute = {
        originStop: originStops[0],
        destinationStop: destStops[0],
        walkToStopMeters: originStops[0].distanceMeters,
        walkFromStopMeters: destStops[0].distanceMeters,
        transitDistanceMeters: 0,
        estimatedTransitMinutes: 0
      };
      
      // Calculate transit distance between the closest stops
      bestRoute.transitDistanceMeters = this.calculateDistance(
        { lat: bestRoute.originStop.lat, lng: bestRoute.originStop.lng },
        { lat: bestRoute.destinationStop.lat, lng: bestRoute.destinationStop.lng }
      );
      
      // Estimate transit time: buses average ~20 km/h in urban areas with stops
      // Add 5 min wait time average
      const transitKm = bestRoute.transitDistanceMeters / 1000;
      const busSpeedKmh = 18; // Conservative urban bus speed
      bestRoute.estimatedTransitMinutes = Math.max(5, Math.round((transitKm / busSpeedKmh) * 60) + 5);
      
      console.log(`🚌 Transit route: Walk ${Math.round(bestRoute.walkToStopMeters)}m → ${bestRoute.originStop.commonName} → Bus ${Math.round(transitKm * 10) / 10}km (${bestRoute.estimatedTransitMinutes}min) → ${bestRoute.destinationStop.commonName} → Walk ${Math.round(bestRoute.walkFromStopMeters)}m`);
      
      return bestRoute;
    } catch (error) {
      console.error('Error finding transit route:', error);
      return null;
    }
  }
}

export const naptanService = new NaptanService();
