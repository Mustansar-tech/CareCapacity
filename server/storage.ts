import { 
  users, type User, type InsertUser,
  capacityAnalyses, type CapacityAnalysis, type InsertCapacityAnalysis,
  branchUploads, type BranchUpload, type InsertBranchUpload,
  employeeLocations, type EmployeeLocation, type InsertEmployeeLocation,
  clientLocations, type ClientLocation, type InsertClientLocation,
  visits, type Visit, type InsertVisit,
  routePlans, type RoutePlan, type InsertRoutePlan,
  routeStops, type RouteStop, type InsertRouteStop,
  geocodeCache, type GeocodeCache, type InsertGeocode,
  travelTimeCache, type TravelTimeCache, type InsertTravelTimeCache,
  weeklySchedules, type WeeklySchedule, type InsertWeeklySchedule,
  branchSchedulingPreferences, type BranchSchedulingPreference, type InsertBranchSchedulingPreference,
  clientEnquiries, type ClientEnquiry, type InsertClientEnquiry
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // User management
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Branch management
  getAllBranches(): Promise<any[]>;
  getBranchById(id: string): Promise<any | undefined>;
  getBranchByName(name: string): Promise<any | undefined>;

  // Capacity Analysis
  saveCapacityAnalysis(analysis: InsertCapacityAnalysis): Promise<CapacityAnalysis>;
  getCapacityAnalyses(branchId: string): Promise<CapacityAnalysis[]>;
  getLatestCapacityAnalysis(branchId: string): Promise<CapacityAnalysis | undefined>;
  getLatestWeeksAnalyses(branchId: string, limit?: number): Promise<CapacityAnalysis[]>;
  getCapacityAnalysesByDateRange(branchId: string, startDate: string, endDate: string): Promise<CapacityAnalysis[]>;

  // File Uploads
  saveBranchUpload(upload: InsertBranchUpload): Promise<BranchUpload>;
  getLatestBranchUpload(branchId: string, uploadType: string): Promise<BranchUpload | undefined>;

  // Locations
  upsertEmployeeLocation(location: InsertEmployeeLocation): Promise<EmployeeLocation>;
  getEmployeeLocationByName(branchId: string, employeeName: string): Promise<EmployeeLocation | undefined>;
  getEmployeeLocationById(id: string): Promise<EmployeeLocation | undefined>;
  getAllEmployeeLocations(branchId: string): Promise<EmployeeLocation[]>;

  upsertClientLocation(location: InsertClientLocation): Promise<ClientLocation>;
  getClientLocationByName(branchId: string, clientName: string): Promise<ClientLocation | undefined>;
  getClientLocationById(id: string): Promise<ClientLocation | undefined>;
  getAllClientLocations(branchId: string): Promise<ClientLocation[]>;

  // Geocoding Cache
  getGeocode(branchId: string, key: string): Promise<GeocodeCache | undefined>;
  saveGeocode(geocode: InsertGeocode): Promise<GeocodeCache>;

  // Travel Time Cache
  getTravelTime(branchId: string, fromLat: string, fromLng: string, toLat: string, toLng: string, mode: string): Promise<TravelTimeCache | undefined>;
  saveTravelTime(travelTime: InsertTravelTimeCache): Promise<TravelTimeCache>;

  // Scheduling Preferences
  getBranchSchedulingPreference(branchId: string): Promise<BranchSchedulingPreference>;
  saveBranchSchedulingPreference(preference: InsertBranchSchedulingPreference): Promise<BranchSchedulingPreference>;

  // Client Enquiries
  saveClientEnquiry(enquiry: InsertClientEnquiry): Promise<ClientEnquiry>;
  getClientEnquiries(branchId: string, limit?: number): Promise<ClientEnquiry[]>;
  deleteClientEnquiry(id: string): Promise<void>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User> = new Map();
  private capacityAnalyses: Map<string, CapacityAnalysis> = new Map();
  private branchUploads: Map<string, BranchUpload> = new Map();
  private employeeLocations: Map<string, EmployeeLocation> = new Map();
  private clientLocations: Map<string, ClientLocation> = new Map();
  private geocodeCache: Map<string, GeocodeCache> = new Map();
  private travelTimeCache: Map<string, TravelTimeCache> = new Map();
  private branchSchedulingPreferences: Map<string, BranchSchedulingPreference> = new Map();
  private clientEnquiries: Map<string, ClientEnquiry> = new Map();

  async getUser(id: string): Promise<User | undefined> { return this.users.get(id); }
  async getUserByUsername(username: string): Promise<User | undefined> { 
    return Array.from(this.users.values()).find(u => u.username === username); 
  }
  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async getAllBranches(): Promise<any[]> { return []; }
  async getBranchById(id: string): Promise<any | undefined> { return undefined; }
  async getBranchByName(name: string): Promise<any | undefined> { return undefined; }

  async saveBranchUpload(upload: InsertBranchUpload): Promise<BranchUpload> {
    const id = randomUUID();
    const result: BranchUpload = { ...upload, id, uploadedAt: new Date(), originalFileName: upload.originalFileName ?? null, fileSize: upload.fileSize ?? null, sha256: upload.sha256 ?? null };
    this.branchUploads.set(`${upload.branchId}:${upload.uploadType}`, result);
    return result;
  }
  async getLatestBranchUpload(branchId: string, uploadType: string): Promise<BranchUpload | undefined> { 
    return this.branchUploads.get(`${branchId}:${uploadType}`); 
  }

  async saveCapacityAnalysis(analysis: InsertCapacityAnalysis): Promise<CapacityAnalysis> {
    const id = randomUUID();
    const result: CapacityAnalysis = { 
      ...analysis, id, uploadedAt: new Date(), 
      employeeSummaryByDate: analysis.employeeSummaryByDate || {}, 
      warnings: analysis.warnings || []
    };
    this.capacityAnalyses.set(id, result);
    return result;
  }
  async getCapacityAnalyses(branchId: string): Promise<CapacityAnalysis[]> { 
    return Array.from(this.capacityAnalyses.values()).filter(a => a.branchId === branchId); 
  }
  async getLatestCapacityAnalysis(branchId: string): Promise<CapacityAnalysis | undefined> {
    return Array.from(this.capacityAnalyses.values())
      .filter(a => a.branchId === branchId)
      .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())[0];
  }
  async getLatestWeeksAnalyses(branchId: string, limit: number = 4): Promise<CapacityAnalysis[]> {
    return Array.from(this.capacityAnalyses.values())
      .filter(a => a.branchId === branchId)
      .sort((a, b) => b.weekStartDate.localeCompare(a.weekStartDate))
      .slice(0, limit);
  }
  async getCapacityAnalysesByDateRange(branchId: string, startDate: string, endDate: string): Promise<CapacityAnalysis[]> {
    return Array.from(this.capacityAnalyses.values())
      .filter(a => a.branchId === branchId && a.weekStartDate >= startDate && a.weekEndDate <= endDate);
  }

  async upsertEmployeeLocation(location: InsertEmployeeLocation): Promise<EmployeeLocation> {
    const id = randomUUID();
    const result: EmployeeLocation = { 
      ...location, id, geocodedAt: location.homeLat && location.homeLng ? new Date() : null, 
      homeLat: location.homeLat ?? null, homeLng: location.homeLng ?? null, 
      transportMode: location.transportMode ?? null, gender: location.gender ?? null 
    };
    this.employeeLocations.set(`${location.branchId}:${location.employeeName}`, result);
    return result;
  }
  async getEmployeeLocationByName(branchId: string, employeeName: string): Promise<EmployeeLocation | undefined> { 
    return this.employeeLocations.get(`${branchId}:${employeeName}`); 
  }
  async getEmployeeLocationById(id: string): Promise<EmployeeLocation | undefined> { 
    return Array.from(this.employeeLocations.values()).find(l => l.id === id); 
  }
  async getAllEmployeeLocations(branchId: string): Promise<EmployeeLocation[]> { 
    return Array.from(this.employeeLocations.values()).filter(l => l.branchId === branchId); 
  }

  async upsertClientLocation(location: InsertClientLocation): Promise<ClientLocation> {
    const id = randomUUID();
    const result: ClientLocation = { 
      ...location, id, geocodedAt: location.lat && location.lng ? new Date() : null, 
      lat: location.lat ?? null, lng: location.lng ?? null 
    };
    this.clientLocations.set(`${location.branchId}:${location.clientName}`, result);
    return result;
  }
  async getClientLocationByName(branchId: string, clientName: string): Promise<ClientLocation | undefined> { 
    return this.clientLocations.get(`${branchId}:${clientName}`); 
  }
  async getClientLocationById(id: string): Promise<ClientLocation | undefined> { 
    return Array.from(this.clientLocations.values()).find(l => l.id === id); 
  }
  async getAllClientLocations(branchId: string): Promise<ClientLocation[]> {
    return Array.from(this.clientLocations.values()).filter(l => l.branchId === branchId);
  }

  async getGeocode(branchId: string, key: string): Promise<GeocodeCache | undefined> {
    return this.geocodeCache.get(`${branchId}:${key}`);
  }
  async saveGeocode(geocode: InsertGeocode): Promise<GeocodeCache> {
    const id = randomUUID();
    const result: GeocodeCache = { ...geocode, id, cachedAt: new Date() };
    this.geocodeCache.set(`${geocode.branchId}:${geocode.key}`, result);
    return result;
  }

  async getTravelTime(branchId: string, fromLat: string, fromLng: string, toLat: string, toLng: string, mode: string): Promise<TravelTimeCache | undefined> {
    return this.travelTimeCache.get(`${branchId}:${fromLat}:${fromLng}:${toLat}:${toLng}:${mode}`);
  }
  async saveTravelTime(travelTime: InsertTravelTimeCache): Promise<TravelTimeCache> {
    const id = randomUUID();
    const result: TravelTimeCache = { 
      ...travelTime, id, cachedAt: new Date(), 
      distanceMeters: travelTime.distanceMeters ?? null, 
      transportMode: travelTime.transportMode ?? null 
    };
    this.travelTimeCache.set(`${travelTime.branchId}:${travelTime.fromLat}:${travelTime.fromLng}:${travelTime.toLat}:${travelTime.toLng}:${travelTime.transportMode}`, result);
    return result;
  }

  async getBranchSchedulingPreference(branchId: string): Promise<BranchSchedulingPreference> {
    let pref = this.branchSchedulingPreferences.get(branchId);
    if (!pref) {
      pref = { id: randomUUID(), branchId, excludedServiceTypes: [], updatedAt: new Date() };
      this.branchSchedulingPreferences.set(branchId, pref);
    }
    return pref;
  }
  async saveBranchSchedulingPreference(preference: InsertBranchSchedulingPreference): Promise<BranchSchedulingPreference> {
    const id = randomUUID();
    const result: BranchSchedulingPreference = { 
      ...preference, id, updatedAt: new Date(), 
      excludedServiceTypes: preference.excludedServiceTypes || [] 
    };
    this.branchSchedulingPreferences.set(preference.branchId, result);
    return result;
  }

  async saveClientEnquiry(enquiry: InsertClientEnquiry): Promise<ClientEnquiry> {
    const id = randomUUID();
    const result: ClientEnquiry = { 
      ...enquiry, id, createdAt: new Date(), 
      visitDurationMinutes: enquiry.visitDurationMinutes ?? 60,
      isMultiVisit: enquiry.isMultiVisit ?? false,
      criteria: enquiry.criteria ?? null,
      topMatch: enquiry.topMatch ?? null,
      postcode: enquiry.postcode ?? null,
      genderPreference: enquiry.genderPreference ?? null,
      results: enquiry.results ?? null
    };
    this.clientEnquiries.set(id, result);
    return result;
  }
  async getClientEnquiries(branchId: string, limit: number = 50): Promise<ClientEnquiry[]> {
    return Array.from(this.clientEnquiries.values())
      .filter(e => e.branchId === branchId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
  async deleteClientEnquiry(id: string): Promise<void> {
    this.clientEnquiries.delete(id);
  }
}

export const storage = new MemStorage();
