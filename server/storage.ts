import { 
  type User, 
  type InsertUser,
  type Branch,
  type CapacityAnalysis, 
  type InsertCapacityAnalysis,
  type EmployeeLocation,
  type InsertEmployeeLocation,
  type ClientLocation,
  type InsertClientLocation,
  type Visit,
  type InsertVisit,
  type RoutePlan,
  type InsertRoutePlan,
  type RouteStop,
  type InsertRouteStop,
  type GeocodeCache,
  type InsertGeocode,
  type WeeklySchedule,
  type InsertWeeklySchedule
} from "@shared/schema";
import { randomUUID } from "crypto";

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Branch methods
  getAllBranches(): Promise<Branch[]>;
  getBranchById(id: string): Promise<Branch | undefined>;
  getBranchByName(name: string): Promise<Branch | undefined>;

  // Capacity analysis methods (branch-aware)
  saveCapacityAnalysis(analysis: InsertCapacityAnalysis): Promise<CapacityAnalysis>;
  getCapacityAnalysesByDateRange(branchId: string, startDate: string, endDate: string): Promise<CapacityAnalysis[]>;
  getAllCapacityAnalyses(branchId: string): Promise<CapacityAnalysis[]>;
  getCapacityAnalyses(branchId: string): Promise<CapacityAnalysis[]>; // Alias for getAllCapacityAnalyses
  getLatestCapacityAnalysis(branchId: string): Promise<CapacityAnalysis | undefined>;
  getLatestWeeksAnalyses(branchId: string, limit?: number): Promise<CapacityAnalysis[]>;
  enforceRetentionLatestWeeks(branchId: string, limit?: number): Promise<number>;
  cleanupOldAnalyses(branchId: string, monthsOld: number): Promise<number>;

  // Geographical scheduling methods (branch-aware)
  upsertEmployeeLocation(location: InsertEmployeeLocation): Promise<EmployeeLocation>;
  getEmployeeLocationByName(branchId: string, employeeName: string): Promise<EmployeeLocation | undefined>;
  getEmployeeLocationById(id: string): Promise<EmployeeLocation | undefined>;
  getAllEmployeeLocations(branchId: string): Promise<EmployeeLocation[]>;

  upsertClientLocation(location: InsertClientLocation): Promise<ClientLocation>;
  getClientLocationByName(branchId: string, clientName: string): Promise<ClientLocation | undefined>;
  getClientLocationById(id: string): Promise<ClientLocation | undefined>;
  getAllClientLocations(branchId: string): Promise<ClientLocation[]>;

  saveVisit(visit: InsertVisit): Promise<Visit>;
  getVisitById(id: string): Promise<Visit | undefined>;
  getVisitsByDate(branchId: string, date: string): Promise<Visit[]>;
  getVisitsByClientAndDate(clientId: string, date: string): Promise<Visit[]>;
  listVisitsBetween(branchId: string, startDate: string | null, endDate: string | null): Promise<Visit[]>;
  clearAllVisits(branchId: string): Promise<any>;

  saveRoutePlan(plan: InsertRoutePlan): Promise<RoutePlan>;
  getRoutePlansByDate(branchId: string, date: string): Promise<RoutePlan[]>;
  getRoutePlanByEmployeeAndDate(employeeId: string, date: string): Promise<RoutePlan | undefined>;

  saveRouteStop(stop: InsertRouteStop): Promise<RouteStop>;
  getRouteStopsByPlan(routePlanId: string): Promise<RouteStop[]>;

  getGeocode(branchId: string, key: string): Promise<GeocodeCache | undefined>;
  saveGeocode(geocode: InsertGeocode): Promise<GeocodeCache>;

  clearRoutesAndVisits(branchId: string): Promise<{ routePlansDeleted: number; routeStopsDeleted: number; visitsDeleted: number }>;

  // Weekly schedule methods (branch-aware)
  saveWeeklySchedule(schedule: InsertWeeklySchedule): Promise<WeeklySchedule>;
  getLatestWeeklySchedule(branchId: string): Promise<WeeklySchedule | undefined>;
  getWeeklyScheduleByWeek(branchId: string, weekStartDate: string, weekEndDate: string): Promise<WeeklySchedule | undefined>;
  getAllWeeklySchedules(branchId: string): Promise<WeeklySchedule[]>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private capacityAnalyses: Map<string, CapacityAnalysis>;
  private employeeLocations: Map<string, EmployeeLocation>;
  private clientLocations: Map<string, ClientLocation>;
  private visits: Map<string, Visit>;
  private routePlans: Map<string, RoutePlan>;
  private routeStops: Map<string, RouteStop>;
  private geocodeCache: Map<string, GeocodeCache>;
  private weeklySchedules: Map<string, WeeklySchedule>;

  constructor() {
    this.users = new Map();
    this.capacityAnalyses = new Map();
    this.employeeLocations = new Map();
    this.clientLocations = new Map();
    this.visits = new Map();
    this.routePlans = new Map();
    this.routeStops = new Map();
    this.geocodeCache = new Map();
    this.weeklySchedules = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async saveCapacityAnalysis(insertAnalysis: InsertCapacityAnalysis): Promise<CapacityAnalysis> {
    // Remove existing entry with same week dates for deduplication
    const existingEntry = Array.from(this.capacityAnalyses.values()).find(
      analysis => analysis.weekStartDate === insertAnalysis.weekStartDate && 
                  analysis.weekEndDate === insertAnalysis.weekEndDate
    );
    if (existingEntry) {
      this.capacityAnalyses.delete(existingEntry.id);
    }

    const id = randomUUID();
    const analysis: CapacityAnalysis = {
      ...insertAnalysis,
      id,
      uploadedAt: new Date(),
      employeeSummaryByDate: insertAnalysis.employeeSummaryByDate || {},
      warnings: insertAnalysis.warnings || [],
    };
    this.capacityAnalyses.set(id, analysis);

    // Automatically enforce retention after saving - keep all weeks for 3 months, deduplicated
    await this.enforceSimpleRetention(3);

    return analysis;
  }

  async getCapacityAnalysesByDateRange(branchId: string, startDate: string, endDate: string): Promise<CapacityAnalysis[]> {
    return Array.from(this.capacityAnalyses.values()).filter(
      (analysis) => analysis.branchId === branchId && analysis.weekStartDate >= startDate && analysis.weekEndDate <= endDate
    );
  }


  async getAllCapacityAnalyses(branchId: string): Promise<CapacityAnalysis[]> {
    return Array.from(this.capacityAnalyses.values())
      .filter(analysis => analysis.branchId === branchId)
      .sort(
      (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );
  }

  async getCapacityAnalyses(branchId: string): Promise<CapacityAnalysis[]> {
    return this.getAllCapacityAnalyses(branchId);
  }

  async getLatestCapacityAnalysis(branchId: string): Promise<CapacityAnalysis | undefined> {
    const analyses = await this.getAllCapacityAnalyses(branchId);
    return analyses[0];
  }

  async getLatestWeeksAnalyses(branchId: string, limit: number = 4): Promise<CapacityAnalysis[]> {
    // Group by week, then get the latest analysis per week, then take the latest N weeks
    const weekMap = new Map<string, CapacityAnalysis>();

    Array.from(this.capacityAnalyses.values())
      .filter(analysis => analysis.branchId === branchId)
      .forEach(analysis => {
      const weekKey = `${analysis.weekStartDate}-${analysis.weekEndDate}`;
      const existing = weekMap.get(weekKey);
      if (!existing || new Date(analysis.uploadedAt) > new Date(existing.uploadedAt)) {
        weekMap.set(weekKey, analysis);
      }
    });

    return Array.from(weekMap.values())
      .sort((a, b) => new Date(b.weekStartDate).getTime() - new Date(a.weekStartDate).getTime())
      .slice(0, limit);
  }

  async enforceRetentionLatestWeeks(branchId: string, limit: number = 4): Promise<number> {
    // Group by week and keep only the latest N weeks
    const weekMap = new Map<string, CapacityAnalysis[]>();

    Array.from(this.capacityAnalyses.values())
      .filter(analysis => analysis.branchId === branchId)
      .forEach(analysis => {
      const weekKey = `${analysis.weekStartDate}-${analysis.weekEndDate}`;
      if (!weekMap.has(weekKey)) {
        weekMap.set(weekKey, []);
      }
      weekMap.get(weekKey)!.push(analysis);
    });

    // Sort weeks by start date descending using actual weekStartDate from analyses
    const sortedWeeks = Array.from(weekMap.entries())
      .sort(([, analysesA], [, analysesB]) => {
        const dateA = new Date(analysesA[0].weekStartDate); // Use actual weekStartDate field
        const dateB = new Date(analysesB[0].weekStartDate); 
        return dateB.getTime() - dateA.getTime();
      });

    let deletedCount = 0;

    // Delete weeks beyond the limit
    sortedWeeks.slice(limit).forEach(([_weekKey, analyses]) => {
      analyses.forEach(analysis => {
        this.capacityAnalyses.delete(analysis.id);
        deletedCount++;
      });
    });

    // For remaining weeks, keep only the latest analysis per week
    sortedWeeks.slice(0, limit).forEach(([_weekKey, analyses]) => {
      if (analyses.length > 1) {
        const sortedAnalyses = analyses.sort((a, b) => 
          new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
        );
        // Delete all but the latest
        sortedAnalyses.slice(1).forEach(analysis => {
          this.capacityAnalyses.delete(analysis.id);
          deletedCount++;
        });
      }
    });

    return deletedCount;
  }

  async enforceSimpleRetention(monthsToKeep: number = 3): Promise<number> {
    // Simple retention: keep all weeks for N months, removing duplicates (keep latest per week)
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsToKeep);
    const cutoffString = cutoffDate.toISOString().split('T')[0];

    let deletedCount = 0;

    // Delete anything older than cutoff date
    Array.from(this.capacityAnalyses.values()).forEach(analysis => {
      if (analysis.weekStartDate < cutoffString) {
        this.capacityAnalyses.delete(analysis.id);
        deletedCount++;
      }
    });

    // Remove duplicates - keep only latest per week
    const weekMap = new Map<string, CapacityAnalysis>();

    Array.from(this.capacityAnalyses.values()).forEach(analysis => {
      const weekKey = `${analysis.weekStartDate}-${analysis.weekEndDate}`;
      const existing = weekMap.get(weekKey);
      if (!existing || new Date(analysis.uploadedAt) > new Date(existing.uploadedAt)) {
        if (existing) {
          this.capacityAnalyses.delete(existing.id);
          deletedCount++;
        }
        weekMap.set(weekKey, analysis);
      } else {
        this.capacityAnalyses.delete(analysis.id);
        deletedCount++;
      }
    });

    return deletedCount;
  }


  async cleanupOldAnalyses(branchId: string, monthsOld: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsOld);
    const cutoffString = cutoffDate.toISOString().split('T')[0];

    const oldAnalyses = Array.from(this.capacityAnalyses.values()).filter(
      analysis => analysis.branchId === branchId && new Date(analysis.uploadedAt).toISOString().split('T')[0] < cutoffString
    );

    oldAnalyses.forEach(analysis => {
      this.capacityAnalyses.delete(analysis.id);
    });

    return oldAnalyses.length;
  }

  // Geographical scheduling method implementations
  async upsertEmployeeLocation(insertLocation: InsertEmployeeLocation): Promise<EmployeeLocation> {
    // Check if employee already exists in this branch
    const existing = Array.from(this.employeeLocations.values()).find(
      loc => loc.branchId === insertLocation.branchId && loc.employeeName === insertLocation.employeeName
    );

    if (existing) {
      // Update existing
      const updated: EmployeeLocation = { ...existing, ...insertLocation };
      this.employeeLocations.set(existing.id, updated);
      return updated;
    } else {
      // Create new
      const id = randomUUID();
      const location: EmployeeLocation = {
        ...insertLocation,
        id,
        homeLat: insertLocation.homeLat || null,
        homeLng: insertLocation.homeLng || null,
        transportMode: insertLocation.transportMode || null,
        gender: insertLocation.gender || null, // Convert undefined to null
        geocodedAt: insertLocation.homeLat && insertLocation.homeLng ? new Date() : null,
      };
      this.employeeLocations.set(id, location);
      return location;
    }
  }

  async getEmployeeLocationByName(branchId: string, employeeName: string): Promise<EmployeeLocation | undefined> {
    return Array.from(this.employeeLocations.values()).find(
      loc => loc.branchId === branchId && loc.employeeName === employeeName
    );
  }

  async getEmployeeLocationById(id: string): Promise<EmployeeLocation | undefined> {
    return this.employeeLocations.get(id);
  }

  async getAllEmployeeLocations(branchId: string): Promise<EmployeeLocation[]> {
    return Array.from(this.employeeLocations.values()).filter(loc => loc.branchId === branchId);
  }

  async upsertClientLocation(insertLocation: InsertClientLocation): Promise<ClientLocation> {
    // Check if client already exists in this branch
    const existing = Array.from(this.clientLocations.values()).find(
      loc => loc.branchId === insertLocation.branchId && loc.clientName === insertLocation.clientName
    );

    if (existing) {
      // Update existing
      const updated: ClientLocation = { ...existing, ...insertLocation };
      this.clientLocations.set(existing.id, updated);
      return updated;
    } else {
      // Create new
      const id = randomUUID();
      const location: ClientLocation = {
        ...insertLocation,
        id,
        lat: insertLocation.lat || null,
        lng: insertLocation.lng || null,
        geocodedAt: insertLocation.lat && insertLocation.lng ? new Date() : null,
      };
      this.clientLocations.set(id, location);
      return location;
    }
  }

  async getClientLocationByName(branchId: string, clientName: string): Promise<ClientLocation | undefined> {
    return Array.from(this.clientLocations.values()).find(
      loc => loc.branchId === branchId && loc.clientName === clientName
    );
  }

  async getClientLocationById(id: string): Promise<ClientLocation | undefined> {
    return this.clientLocations.get(id);
  }

  async getAllClientLocations(branchId: string): Promise<ClientLocation[]> {
    return Array.from(this.clientLocations.values()).filter(loc => loc.branchId === branchId);
  }

  async saveVisit(insertVisit: InsertVisit): Promise<Visit> {
    const id = randomUUID();
    const visit: Visit = {
      ...insertVisit,
      id,
      preferredStartTime: insertVisit.preferredStartTime || null,
      preferredEndTime: insertVisit.preferredEndTime || null,
      priority: insertVisit.priority || null,
      serviceType: insertVisit.serviceType || null,
      createdAt: new Date(),
    };
    this.visits.set(id, visit);
    return visit;
  }

  async getVisitById(id: string): Promise<Visit | undefined> {
    return this.visits.get(id);
  }

  async getVisitsByDate(branchId: string, date: string): Promise<Visit[]> {
    return Array.from(this.visits.values()).filter(visit => visit.branchId === branchId && visit.date === date);
  }

  async getVisitsByClientAndDate(clientId: string, date: string): Promise<Visit[]> {
    return Array.from(this.visits.values()).filter(
      visit => visit.clientId === clientId && visit.date === date
    );
  }

  async listVisitsBetween(branchId: string, startDate: string | null, endDate: string | null): Promise<Visit[]> {
    const allVisits = Array.from(this.visits.values()).filter(visit => visit.branchId === branchId);
    if (!startDate && !endDate) {
      return allVisits;
    }
    return allVisits.filter(visit => {
      if (startDate && visit.date < startDate) return false;
      if (endDate && visit.date > endDate) return false;
      return true;
    });
  }

  async clearAllVisits(branchId: string): Promise<any> {
    console.log(`🧹 Clearing all visits data for branch ${branchId}...`);
    // In-memory storage doesn't have a direct way to clear by branch, so we'd iterate and delete
    // For simplicity here, we'll just clear all if no branchId is provided, or if we want to simulate branch clearing by creating a new map
    // A more accurate simulation would involve filtering and deleting.
    if (!branchId) {
      this.visits.clear();
      console.log(`✅ Cleared all visits data`);
      return { visitsDeleted: 0 }; // Size would be 0 after clear
    } else {
      // Simulate branch clearing by filtering
      const initialSize = this.visits.size;
      const visitsToKeep = new Map<string, Visit>();
      for (const [id, visit] of this.visits.entries()) {
        if (visit.branchId !== branchId) {
          visitsToKeep.set(id, visit);
        }
      }
      this.visits = visitsToKeep;
      const deletedCount = initialSize - this.visits.size;
      console.log(`✅ Cleared ${deletedCount} visits for branch ${branchId}`);
      return { visitsDeleted: deletedCount };
    }
  }

  async saveRoutePlan(insertPlan: InsertRoutePlan): Promise<RoutePlan> {
    const id = randomUUID();
    const plan: RoutePlan = {
      ...insertPlan,
      id,
      status: insertPlan.status || null,
      warnings: insertPlan.warnings || [],
      totalDistanceKm: insertPlan.totalDistanceKm || null,
      totalTravelMinutes: insertPlan.totalTravelMinutes || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.routePlans.set(id, plan);
    return plan;
  }

  async getRoutePlansByDate(branchId: string, date: string): Promise<RoutePlan[]> {
    return Array.from(this.routePlans.values()).filter(plan => plan.branchId === branchId && plan.date === date);
  }

  async getRoutePlanByEmployeeAndDate(employeeId: string, date: string): Promise<RoutePlan | undefined> {
    return Array.from(this.routePlans.values()).find(
      plan => plan.employeeId === employeeId && plan.date === date
    );
  }

  async saveRouteStop(insertStop: InsertRouteStop): Promise<RouteStop> {
    const id = randomUUID();
    const stop: RouteStop = {
      ...insertStop,
      id,
      scheduledStart: insertStop.scheduledStart || null,
      scheduledEnd: insertStop.scheduledEnd || null,
      travelMinutesFromPrev: insertStop.travelMinutesFromPrev || null,
      distanceKmFromPrev: insertStop.distanceKmFromPrev || null,
    };
    this.routeStops.set(id, stop);
    return stop;
  }

  async getRouteStopsByPlan(routePlanId: string): Promise<RouteStop[]> {
    return Array.from(this.routeStops.values())
      .filter(stop => stop.routePlanId === routePlanId)
      .sort((a, b) => a.sequence - b.sequence);
  }

  async getGeocode(branchId: string, key: string): Promise<GeocodeCache | undefined> {
    // In-memory storage needs to consider branchId for geocache lookup if it's branch-specific
    // Assuming key includes branchId or is unique across branches for simplicity here.
    // A more robust implementation might structure the cache by branchId.
    return this.geocodeCache.get(key);
  }

  async saveGeocode(insertGeocode: InsertGeocode): Promise<GeocodeCache> {
    const existing = this.geocodeCache.get(insertGeocode.key);
    if (existing) {
      return existing;
    }

    const id = randomUUID();
    const geocode: GeocodeCache = {
      ...insertGeocode,
      id,
      cachedAt: new Date(),
    };
    this.geocodeCache.set(insertGeocode.key, geocode);
    return geocode;
  }

  async clearRoutesAndVisits(branchId: string): Promise<{ routePlansDeleted: number; routeStopsDeleted: number; visitsDeleted: number }> {
    let routePlansDeleted = 0;
    let routeStopsDeleted = 0;
    let visitsDeleted = 0;

    // Simulate branch clearing for each
    const initialRoutePlansSize = this.routePlans.size;
    const initialRouteStopsSize = this.routeStops.size;
    const initialVisitsSize = this.visits.size;

    const routePlansToKeep = new Map<string, RoutePlan>();
    for (const [id, plan] of this.routePlans.entries()) {
      if (plan.branchId !== branchId) {
        routePlansToKeep.set(id, plan);
      } else {
        routePlansDeleted++;
      }
    }
    this.routePlans = routePlansToKeep;

    const routeStopsToKeep = new Map<string, RouteStop>();
    for (const [id, stop] of this.routeStops.entries()) {
      // Assuming route stops are associated with route plans which are branch-specific
      // A direct branchId on routeStops would be better. For now, infer.
      // This is a simplification. A real implementation would need a way to link stops to branch.
      if (stop.routePlanId && this.routePlans.has(stop.routePlanId)) {
        routeStopsToKeep.set(id, stop);
      } else if (!stop.routePlanId) { // If stop doesn't have a planId, assume it might be orphaned or not branch-specific
         routeStopsToKeep.set(id, stop); // Keep if no planId, or if plan is kept
      } else {
        routeStopsDeleted++; // Delete if plan associated with it was deleted
      }
    }
    this.routeStops = routeStopsToKeep;


    const visitsToKeep = new Map<string, Visit>();
    for (const [id, visit] of this.visits.entries()) {
      if (visit.branchId !== branchId) {
        visitsToKeep.set(id, visit);
      } else {
        visitsDeleted++;
      }
    }
    this.visits = visitsToKeep;

    return { routePlansDeleted, routeStopsDeleted, visitsDeleted };
  }

  // Weekly schedule methods
  async saveWeeklySchedule(insertSchedule: InsertWeeklySchedule): Promise<WeeklySchedule> {
    // Remove existing entry with same week dates for deduplication
    const existingEntry = Array.from(this.weeklySchedules.values()).find(
      schedule => schedule.branchId === insertSchedule.branchId &&
                  schedule.weekStartDate === insertSchedule.weekStartDate && 
                  schedule.weekEndDate === insertSchedule.weekEndDate
    );
    if (existingEntry) {
      this.weeklySchedules.delete(existingEntry.id);
    }

    const id = randomUUID();
    const schedule: WeeklySchedule = {
      ...insertSchedule,
      id,
      generatedAt: new Date(),
      unallocatedVisits: insertSchedule.unallocatedVisits || [],
    };
    this.weeklySchedules.set(id, schedule);
    return schedule;
  }

  async getLatestWeeklySchedule(branchId: string): Promise<WeeklySchedule | undefined> {
    const schedules = Array.from(this.weeklySchedules.values())
      .filter(schedule => schedule.branchId === branchId)
      .sort(
      (a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
    );
    return schedules[0];
  }

  async getWeeklyScheduleByWeek(branchId: string, weekStartDate: string, weekEndDate: string): Promise<WeeklySchedule | undefined> {
    return Array.from(this.weeklySchedules.values()).find(
      schedule => schedule.branchId === branchId && schedule.weekStartDate === weekStartDate && schedule.weekEndDate === weekEndDate
    );
  }

  async getAllWeeklySchedules(branchId: string): Promise<WeeklySchedule[]> {
    return Array.from(this.weeklySchedules.values())
      .filter(schedule => schedule.branchId === branchId)
      .sort(
      (a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
    );
  }
}

// Switch to database storage in production
import { db } from "./db";
import { 
  users,
  branches,
  capacityAnalyses, 
  employeeLocations, 
  clientLocations, 
  visits, 
  routePlans, 
  routeStops, 
  geocodeCache,
  weeklySchedules
} from "@shared/schema";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  // Branch methods
  async getAllBranches(): Promise<Branch[]> {
    return await db.select().from(branches).orderBy(branches.displayName);
  }

  async getBranchById(id: string): Promise<Branch | undefined> {
    const [branch] = await db.select().from(branches).where(eq(branches.id, id));
    return branch || undefined;
  }

  async getBranchByName(name: string): Promise<Branch | undefined> {
    const [branch] = await db.select().from(branches).where(eq(branches.name, name));
    return branch || undefined;
  }

  async saveCapacityAnalysis(insertAnalysis: InsertCapacityAnalysis): Promise<CapacityAnalysis> {
    // Use upsert to replace existing week data with new data (per branch)
    const [analysis] = await db
      .insert(capacityAnalyses)
      .values({
        ...insertAnalysis,
        employeeSummaryByDate: insertAnalysis.employeeSummaryByDate || {},
        warnings: insertAnalysis.warnings || [],
      })
      .onConflictDoUpdate({
        target: [capacityAnalyses.branchId, capacityAnalyses.weekStartDate, capacityAnalyses.weekEndDate],
        set: {
          kpis: insertAnalysis.kpis,
          dailySummary: insertAnalysis.dailySummary,
          employeesByDate: insertAnalysis.employeesByDate,
          employeeSummaryByDate: insertAnalysis.employeeSummaryByDate || {},
          warnings: insertAnalysis.warnings || [],
          uploadedAt: sql`now()`,
        },
      })
      .returning();

    // Automatically enforce retention after saving - keep all weeks for 3 months, deduplicated
    if (insertAnalysis.branchId) {
      await this.enforceSimpleRetention(insertAnalysis.branchId, 3);
    }

    return analysis;
  }

  async getCapacityAnalysesByDateRange(branchId: string, startDate: string, endDate: string): Promise<CapacityAnalysis[]> {
    return await db
      .select()
      .from(capacityAnalyses)
      .where(and(
        eq(capacityAnalyses.branchId, branchId),
        gte(capacityAnalyses.weekStartDate, startDate),
        lte(capacityAnalyses.weekEndDate, endDate)
      ))
      .orderBy(desc(capacityAnalyses.uploadedAt));
  }


  async getAllCapacityAnalyses(branchId: string): Promise<CapacityAnalysis[]> {
    // Return deduplicated results using window function with proper column aliasing (filtered by branch)
    return await db.execute(sql`
      SELECT DISTINCT ON (week_start_date, week_end_date) 
             id,
             branch_id AS "branchId",
             week_start_date AS "weekStartDate",
             week_end_date AS "weekEndDate", 
             uploaded_at AS "uploadedAt",
             kpis,
             daily_summary AS "dailySummary",
             employees_by_date AS "employeesByDate",
             employee_summary_by_date AS "employeeSummaryByDate",
             warnings
      FROM capacity_analyses
      WHERE branch_id = ${branchId}
      ORDER BY week_start_date DESC, week_end_date DESC, uploaded_at DESC
    `).then(result => result.rows as CapacityAnalysis[]);
  }

  async getCapacityAnalyses(branchId: string): Promise<CapacityAnalysis[]> {
    return this.getAllCapacityAnalyses(branchId);
  }

  async getLatestWeeksAnalyses(branchId: string, limit: number = 4): Promise<CapacityAnalysis[]> {
    // Get the latest record for each of the latest N weeks with proper column aliasing (filtered by branch)
    return await db.execute(sql`
      WITH latest_per_week AS (
        SELECT *,
               ROW_NUMBER() OVER (
                 PARTITION BY week_start_date, week_end_date 
                 ORDER BY uploaded_at DESC
               ) as rn
        FROM capacity_analyses
        WHERE branch_id = ${branchId}
      ),
      week_ranking AS (
        SELECT *,
               ROW_NUMBER() OVER (ORDER BY week_start_date DESC) as week_rank
        FROM latest_per_week 
        WHERE rn = 1
      )
      SELECT id,
             branch_id AS "branchId",
             week_start_date AS "weekStartDate",
             week_end_date AS "weekEndDate", 
             uploaded_at AS "uploadedAt",
             kpis,
             daily_summary AS "dailySummary",
             employees_by_date AS "employeesByDate",
             employee_summary_by_date AS "employeeSummaryByDate",
             warnings
      FROM week_ranking 
      WHERE week_rank <= ${limit}
      ORDER BY week_start_date DESC
    `).then(result => result.rows as CapacityAnalysis[]);
  }

  async enforceRetentionLatestWeeks(branchId: string, limit: number = 4): Promise<number> {
    // Delete all but the latest record for each week, and keep only latest N weeks (per branch)
    const result = await db.execute(sql`
      WITH week_ranks AS (
        SELECT DISTINCT week_start_date, week_end_date,
               ROW_NUMBER() OVER (ORDER BY week_start_date DESC) as week_rank
        FROM capacity_analyses
        WHERE branch_id = ${branchId}
      ),
      records_to_keep AS (
        SELECT ca.id
        FROM capacity_analyses ca
        INNER JOIN week_ranks wr ON ca.week_start_date = wr.week_start_date 
                                 AND ca.week_end_date = wr.week_end_date
        WHERE ca.branch_id = ${branchId}
          AND wr.week_rank <= ${limit}
          AND ca.id IN (
            SELECT id FROM (
              SELECT id, 
                     ROW_NUMBER() OVER (
                       PARTITION BY week_start_date, week_end_date 
                       ORDER BY uploaded_at DESC
                     ) as rn
              FROM capacity_analyses
              WHERE branch_id = ${branchId}
            ) ranked WHERE rn = 1
          )
      )
      DELETE FROM capacity_analyses 
      WHERE branch_id = ${branchId} AND id NOT IN (SELECT id FROM records_to_keep)
    `);

    return result.rowCount || 0;
  }

  async enforceSimpleRetention(branchId: string, monthsToKeep: number = 3): Promise<number> {
    // Simple retention: keep all weeks for N months, removing duplicates (keep latest per week per branch)
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsToKeep);
    const cutoffString = cutoffDate.toISOString().split('T')[0];

    const result = await db.execute(sql`
      WITH latest_per_week AS (
        -- Keep only the latest entry for each week
        SELECT *,
               ROW_NUMBER() OVER (
                 PARTITION BY week_start_date, week_end_date 
                 ORDER BY uploaded_at DESC
               ) as rn
        FROM capacity_analyses
        WHERE branch_id = ${branchId} AND week_start_date >= ${cutoffString}
      ),
      records_to_keep AS (
        SELECT id 
        FROM latest_per_week
        WHERE rn = 1  -- Keep only latest per week
      )
      DELETE FROM capacity_analyses 
      WHERE branch_id = ${branchId} AND id NOT IN (SELECT id FROM records_to_keep)
    `);

    return result.rowCount || 0;
  }


  async getLatestCapacityAnalysis(branchId: string): Promise<CapacityAnalysis | undefined> {
    const [analysis] = await db
      .select()
      .from(capacityAnalyses)
      .where(eq(capacityAnalyses.branchId, branchId))
      .orderBy(desc(capacityAnalyses.uploadedAt))
      .limit(1);
    return analysis || undefined;
  }

  async cleanupOldAnalyses(branchId: string, monthsOld: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsOld);

    const result = await db
      .delete(capacityAnalyses)
      .where(and(
        eq(capacityAnalyses.branchId, branchId),
        lte(capacityAnalyses.uploadedAt, cutoffDate)
      ))
      .returning({ id: capacityAnalyses.id });

    return result.length;
  }

  // Geographical scheduling database method implementations
  async upsertEmployeeLocation(insertLocation: InsertEmployeeLocation): Promise<EmployeeLocation> {
    const [location] = await db
      .insert(employeeLocations)
      .values({
        ...insertLocation,
        homeLat: insertLocation.homeLat || null,
        homeLng: insertLocation.homeLng || null,
        transportMode: insertLocation.transportMode || "car",
        gender: insertLocation.gender || null,
        geocodedAt: insertLocation.homeLat && insertLocation.homeLng ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: [employeeLocations.branchId, employeeLocations.employeeName],
        set: {
          homePostcode: insertLocation.homePostcode,
          homeLat: insertLocation.homeLat || null,
          homeLng: insertLocation.homeLng || null,
          transportMode: insertLocation.transportMode || "car",
          gender: insertLocation.gender || null,
          geocodedAt: insertLocation.homeLat && insertLocation.homeLng ? new Date() : null,
        },
      })
      .returning();
    return location;
  }

  async getEmployeeLocationByName(branchId: string, employeeName: string): Promise<EmployeeLocation | undefined> {
    const [location] = await db
      .select()
      .from(employeeLocations)
      .where(and(
        eq(employeeLocations.branchId, branchId),
        eq(employeeLocations.employeeName, employeeName)
      ));
    return location || undefined;
  }

  async getEmployeeLocationById(id: string): Promise<EmployeeLocation | undefined> {
    const [location] = await db
      .select()
      .from(employeeLocations)
      .where(eq(employeeLocations.id, id));
    return location || undefined;
  }

  async getAllEmployeeLocations(branchId: string): Promise<EmployeeLocation[]> {
    return await db.select().from(employeeLocations).where(eq(employeeLocations.branchId, branchId));
  }

  async upsertClientLocation(insertLocation: InsertClientLocation): Promise<ClientLocation> {
    const [location] = await db
      .insert(clientLocations)
      .values({
        ...insertLocation,
        lat: insertLocation.lat || null,
        lng: insertLocation.lng || null,
        geocodedAt: insertLocation.lat && insertLocation.lng ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: [clientLocations.branchId, clientLocations.clientName],
        set: {
          addressLine: insertLocation.addressLine,
          postcode: insertLocation.postcode,
          lat: insertLocation.lat || null,
          lng: insertLocation.lng || null,
          geocodedAt: insertLocation.lat && insertLocation.lng ? new Date() : null,
        },
      })
      .returning();
    return location;
  }

  async getClientLocationByName(branchId: string, clientName: string): Promise<ClientLocation | undefined> {
    const [location] = await db
      .select()
      .from(clientLocations)
      .where(and(
        eq(clientLocations.branchId, branchId),
        eq(clientLocations.clientName, clientName)
      ));
    return location || undefined;
  }

  async getClientLocationById(id: string): Promise<ClientLocation | undefined> {
    const [location] = await db
      .select()
      .from(clientLocations)
      .where(eq(clientLocations.id, id));
    return location || undefined;
  }

  async getAllClientLocations(branchId: string): Promise<ClientLocation[]> {
    return await db.select().from(clientLocations).where(eq(clientLocations.branchId, branchId));
  }

  async saveVisit(insertVisit: InsertVisit): Promise<Visit> {
    const [visit] = await db
      .insert(visits)
      .values({
        ...insertVisit,
        preferredStartTime: insertVisit.preferredStartTime || null,
        preferredEndTime: insertVisit.preferredEndTime || null,
        priority: insertVisit.priority || 1,
        serviceType: insertVisit.serviceType || null,
      })
      .returning();
    return visit;
  }

  async getVisitById(id: string): Promise<Visit | undefined> {
    const [visit] = await db
      .select()
      .from(visits)
      .where(eq(visits.id, id));
    return visit || undefined;
  }

  async getVisitsByDate(branchId: string, date: string): Promise<Visit[]> {
    return await db
      .select()
      .from(visits)
      .where(and(eq(visits.branchId, branchId), eq(visits.date, date)));
  }

  async getVisitsByClientAndDate(clientId: string, date: string): Promise<Visit[]> {
    return await db
      .select()
      .from(visits)
      .where(and(eq(visits.clientId, clientId), eq(visits.date, date)));
  }

  async listVisitsBetween(branchId: string, startDate: string | null, endDate: string | null): Promise<Visit[]> {
    if (startDate && endDate) {
      return await db.select().from(visits).where(and(eq(visits.branchId, branchId), gte(visits.date, startDate), lte(visits.date, endDate)));
    } else if (startDate) {
      return await db.select().from(visits).where(and(eq(visits.branchId, branchId), gte(visits.date, startDate)));
    } else if (endDate) {
      return await db.select().from(visits).where(and(eq(visits.branchId, branchId), lte(visits.date, endDate)));
    }

    return await db.select().from(visits).where(eq(visits.branchId, branchId));
  }

  async clearAllVisits(branchId: string): Promise<any> {
    console.log(`🧹 Clearing all visits data for branch ${branchId}...`);
    const result = await db.delete(visits).where(eq(visits.branchId, branchId));
    console.log(`✅ Cleared visits data for branch ${branchId}`);
    return result;
  }

  async saveRoutePlan(insertPlan: InsertRoutePlan): Promise<RoutePlan> {
    const [plan] = await db
      .insert(routePlans)
      .values({
        ...insertPlan,
        totalDistanceKm: insertPlan.totalDistanceKm || null,
        totalTravelMinutes: insertPlan.totalTravelMinutes || null,
        status: insertPlan.status || "optimized",
        warnings: insertPlan.warnings || [],
      })
      .returning();
    return plan;
  }

  async getRoutePlansByDate(branchId: string, date: string): Promise<RoutePlan[]> {
    return await db
      .select()
      .from(routePlans)
      .where(and(eq(routePlans.branchId, branchId), eq(routePlans.date, date)));
  }

  async getRoutePlanByEmployeeAndDate(employeeId: string, date: string): Promise<RoutePlan | undefined> {
    const [plan] = await db
      .select()
      .from(routePlans)
      .where(and(eq(routePlans.employeeId, employeeId), eq(routePlans.date, date)));
    return plan || undefined;
  }

  async saveRouteStop(insertStop: InsertRouteStop): Promise<RouteStop> {
    const [stop] = await db
      .insert(routeStops)
      .values({
        ...insertStop,
        scheduledStart: insertStop.scheduledStart || null,
        scheduledEnd: insertStop.scheduledEnd || null,
        travelMinutesFromPrev: insertStop.travelMinutesFromPrev || null,
        distanceKmFromPrev: insertStop.distanceKmFromPrev || null,
      })
      .returning();
    return stop;
  }

  async getRouteStopsByPlan(routePlanId: string): Promise<RouteStop[]> {
    return await db
      .select()
      .from(routeStops)
      .where(eq(routeStops.routePlanId, routePlanId))
      .orderBy(routeStops.sequence);
  }

  async getGeocode(branchId: string, key: string): Promise<GeocodeCache | undefined> {
    const [geocode] = await db
      .select()
      .from(geocodeCache)
      .where(and(eq(geocodeCache.branchId, branchId), eq(geocodeCache.key, key)));
    return geocode || undefined;
  }

  async saveGeocode(insertGeocode: InsertGeocode): Promise<GeocodeCache> {
    const [geocode] = await db
      .insert(geocodeCache)
      .values(insertGeocode)
      .onConflictDoNothing()
      .returning();

    if (!geocode) {
      // If no insert happened due to conflict, get existing
      return (await this.getGeocode(insertGeocode.branchId!, insertGeocode.key))!;
    }

    return geocode;
  }

  async clearRoutesAndVisits(branchId: string): Promise<{ routePlansDeleted: number; routeStopsDeleted: number; visitsDeleted: number }> {
    // Count existing records
    const routePlansCount = await db.execute(sql`SELECT COUNT(*) as count FROM route_plans WHERE branch_id = ${branchId}`);
    const routeStopsCount = await db.execute(sql`SELECT COUNT(*) as count FROM route_stops WHERE route_plan_id IN (SELECT id FROM route_plans WHERE branch_id = ${branchId})`);
    const visitsCount = await db.execute(sql`SELECT COUNT(*) as count FROM visits WHERE branch_id = ${branchId}`);

    const routePlansDeleted = Number(routePlansCount.rows[0]?.count || 0);
    const routeStopsDeleted = Number(routeStopsCount.rows[0]?.count || 0);
    const visitsDeleted = Number(visitsCount.rows[0]?.count || 0);

    // Delete in correct order (route_stops first due to foreign key)
    await db.delete(routeStops).where(inArray(routeStops.routePlanId, db.select({id: routePlans.id}).from(routePlans).where(eq(routePlans.branchId, branchId))));
    await db.delete(routePlans).where(eq(routePlans.branchId, branchId));
    await db.delete(visits).where(eq(visits.branchId, branchId));

    return { routePlansDeleted, routeStopsDeleted, visitsDeleted };
  }

  // Weekly schedule methods
  async saveWeeklySchedule(insertSchedule: InsertWeeklySchedule): Promise<WeeklySchedule> {
    // First check if a schedule already exists for this branch and week
    const existing = await db
      .select()
      .from(weeklySchedules)
      .where(and(
        eq(weeklySchedules.branchId, insertSchedule.branchId),
        eq(weeklySchedules.weekStartDate, insertSchedule.weekStartDate),
        eq(weeklySchedules.weekEndDate, insertSchedule.weekEndDate)
      ))
      .limit(1);

    if (existing.length > 0) {
      // Update existing schedule for this specific branch
      const [updated] = await db
        .update(weeklySchedules)
        .set({
          scheduleData: insertSchedule.scheduleData,
          unallocatedVisits: insertSchedule.unallocatedVisits || [],
          metrics: insertSchedule.metrics,
          generatedAt: new Date(),
        })
        .where(eq(weeklySchedules.id, existing[0].id))
        .returning();
      return updated;
    } else {
      // Insert new schedule
      const [schedule] = await db
        .insert(weeklySchedules)
        .values({
          ...insertSchedule,
          unallocatedVisits: insertSchedule.unallocatedVisits || [],
        })
        .returning();
      return schedule;
    }
  }

  async getLatestWeeklySchedule(branchId: string): Promise<WeeklySchedule | undefined> {
    const [schedule] = await db
      .select()
      .from(weeklySchedules)
      .where(eq(weeklySchedules.branchId, branchId))
      .orderBy(desc(weeklySchedules.generatedAt))
      .limit(1);
    return schedule || undefined;
  }

  async getWeeklyScheduleByWeek(branchId: string, weekStartDate: string, weekEndDate: string): Promise<WeeklySchedule | undefined> {
    const [schedule] = await db
      .select()
      .from(weeklySchedules)
      .where(and(
        eq(weeklySchedules.branchId, branchId),
        eq(weeklySchedules.weekStartDate, weekStartDate),
        eq(weeklySchedules.weekEndDate, weekEndDate)
      ));
    return schedule || undefined;
  }

  async getAllWeeklySchedules(branchId: string): Promise<WeeklySchedule[]> {
    return await db
      .select()
      .from(weeklySchedules)
      .where(eq(weeklySchedules.branchId, branchId))
      .orderBy(desc(weeklySchedules.generatedAt));
  }
}

export const storage = process.env.DATABASE_URL ? new DatabaseStorage() : new MemStorage();