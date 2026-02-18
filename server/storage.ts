import {
  type User,
  type InsertUser,
  type Branch,
  type CapacityAnalysis,
  type InsertCapacityAnalysis,
  type BranchUpload,
  type InsertBranchUpload,
  type BranchSchedulingPreference,
  type InsertBranchSchedulingPreference,
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
  type TravelTimeCache,
  type InsertTravelTimeCache,
  type WeeklySchedule,
  type InsertWeeklySchedule,
  type ClientEnquiry,
  type InsertClientEnquiry,
} from "@shared/schema";
import { randomUUID } from "crypto";
import { db } from "./db";
import { 
  users, branches, capacityAnalyses, branchUploads, 
  employeeLocations, clientLocations, visits, 
  routePlans, routeStops, geocodeCache, 
  weeklySchedules, branchSchedulingPreferences,
  travelTimeCache, clientEnquiries
} from "@shared/schema";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Branch methods
  getAllBranches(): Promise<Branch[]>;
  getBranchById(id: string): Promise<Branch | undefined>;
  getBranchByName(name: string): Promise<Branch | undefined>;

  // Branch upload methods
  saveBranchUpload(upload: InsertBranchUpload): Promise<BranchUpload>;
  getLatestBranchUpload(branchId: string, uploadType: string): Promise<BranchUpload | undefined>;

  // Capacity analysis
  saveCapacityAnalysis(analysis: InsertCapacityAnalysis): Promise<CapacityAnalysis>;
  getCapacityAnalysesByDateRange(branchId: string, startDate: string, endDate: string): Promise<CapacityAnalysis[]>;
  getAllCapacityAnalyses(branchId: string): Promise<CapacityAnalysis[]>;
  getCapacityAnalyses(branchId: string): Promise<CapacityAnalysis[]>;
  getLatestCapacityAnalysis(branchId: string): Promise<CapacityAnalysis | undefined>;
  getLatestWeeksAnalyses(branchId: string, limit?: number): Promise<CapacityAnalysis[]>;
  enforceRetentionLatestWeeks(branchId: string, limit?: number): Promise<number>;
  cleanupOldAnalyses(branchId: string, monthsOld: number): Promise<number>;

  // Geographical scheduling
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

  saveWeeklySchedule(schedule: InsertWeeklySchedule): Promise<WeeklySchedule>;
  getLatestWeeklySchedule(branchId: string): Promise<WeeklySchedule | undefined>;
  getWeeklyScheduleByWeek(branchId: string, weekStartDate: string, weekEndDate: string): Promise<WeeklySchedule | undefined>;
  getAllWeeklySchedules(branchId: string): Promise<WeeklySchedule[]>;

  getTravelTime(branchId: string, fromLat: string, fromLng: string, toLat: string, toLng: string, mode: string): Promise<TravelTimeCache | undefined>;
  saveTravelTime(travelTime: InsertTravelTimeCache): Promise<TravelTimeCache>;

  getBranchSchedulingPreference(branchId: string): Promise<BranchSchedulingPreference>;
  saveBranchSchedulingPreference(preference: InsertBranchSchedulingPreference): Promise<BranchSchedulingPreference>;

  saveClientEnquiry(enquiry: InsertClientEnquiry): Promise<ClientEnquiry>;
  getClientEnquiries(branchId: string, limit?: number): Promise<ClientEnquiry[]>;
  deleteClientEnquiry(id: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getAllBranches(): Promise<Branch[]> {
    return await db.select().from(branches);
  }

  async getBranchById(id: string): Promise<Branch | undefined> {
    const [branch] = await db.select().from(branches).where(eq(branches.id, id));
    return branch;
  }

  async getBranchByName(name: string): Promise<Branch | undefined> {
    const [branch] = await db.select().from(branches).where(eq(branches.name, name));
    return branch;
  }

  async saveBranchUpload(upload: InsertBranchUpload): Promise<BranchUpload> {
    const [result] = await db
      .insert(branchUploads)
      .values(upload)
      .onConflictDoUpdate({
        target: [branchUploads.branchId, branchUploads.uploadType],
        set: {
          fileBuffer: upload.fileBuffer,
          originalFileName: upload.originalFileName,
          fileSize: upload.fileSize,
          sha256: upload.sha256,
          uploadedAt: new Date()
        }
      })
      .returning();
    return result;
  }

  async getLatestBranchUpload(branchId: string, uploadType: any): Promise<BranchUpload | undefined> {
    const [upload] = await db
      .select()
      .from(branchUploads)
      .where(
        and(
          eq(branchUploads.branchId, branchId),
          eq(branchUploads.uploadType, uploadType)
        )
      )
      .orderBy(desc(branchUploads.uploadedAt));
    return upload;
  }

  async saveCapacityAnalysis(analysis: InsertCapacityAnalysis): Promise<CapacityAnalysis> {
    const [result] = await db
      .insert(capacityAnalyses)
      .values(analysis)
      .onConflictDoUpdate({
        target: [capacityAnalyses.branchId, capacityAnalyses.weekStartDate, capacityAnalyses.weekEndDate],
        set: {
          kpis: analysis.kpis,
          dailySummary: analysis.dailySummary,
          employeesByDate: analysis.employeesByDate,
          employeeSummaryByDate: analysis.employeeSummaryByDate,
          warnings: analysis.warnings,
          uploadedAt: new Date()
        }
      })
      .returning();
    return result;
  }

  async getCapacityAnalysesByDateRange(branchId: string, startDate: string, endDate: string): Promise<CapacityAnalysis[]> {
    return await db
      .select()
      .from(capacityAnalyses)
      .where(
        and(
          eq(capacityAnalyses.branchId, branchId),
          gte(capacityAnalyses.weekStartDate, startDate),
          lte(capacityAnalyses.weekEndDate, endDate)
        )
      );
  }

  async getAllCapacityAnalyses(branchId: string): Promise<CapacityAnalysis[]> {
    return await db
      .select()
      .from(capacityAnalyses)
      .where(eq(capacityAnalyses.branchId, branchId))
      .orderBy(desc(capacityAnalyses.uploadedAt));
  }

  async getCapacityAnalyses(branchId: string): Promise<CapacityAnalysis[]> {
    return this.getAllCapacityAnalyses(branchId);
  }

  async getLatestCapacityAnalysis(branchId: string): Promise<CapacityAnalysis | undefined> {
    const [analysis] = await db
      .select()
      .from(capacityAnalyses)
      .where(eq(capacityAnalyses.branchId, branchId))
      .orderBy(desc(capacityAnalyses.uploadedAt))
      .limit(1);
    return analysis;
  }

  async getLatestWeeksAnalyses(branchId: string, limit: number = 4): Promise<CapacityAnalysis[]> {
    return await db
      .select()
      .from(capacityAnalyses)
      .where(eq(capacityAnalyses.branchId, branchId))
      .orderBy(desc(capacityAnalyses.weekStartDate))
      .limit(limit);
  }

  async enforceRetentionLatestWeeks(branchId: string, limit: number = 4): Promise<number> {
    const analyses = await this.getLatestWeeksAnalyses(branchId, limit);
    if (analyses.length < limit) return 0;
    const lastKeepDate = analyses[analyses.length - 1].weekStartDate;
    const result = await db
      .delete(capacityAnalyses)
      .where(
        and(
          eq(capacityAnalyses.branchId, branchId),
          sql`${capacityAnalyses.weekStartDate} < ${lastKeepDate}`
        )
      );
    return result.rowCount ?? 0;
  }

  async cleanupOldAnalyses(branchId: string, monthsOld: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsOld);
    const result = await db
      .delete(capacityAnalyses)
      .where(
        and(
          eq(capacityAnalyses.branchId, branchId),
          lte(capacityAnalyses.uploadedAt, cutoffDate)
        )
      );
    return result.rowCount ?? 0;
  }

  async upsertEmployeeLocation(location: InsertEmployeeLocation): Promise<EmployeeLocation> {
    const [result] = await db
      .insert(employeeLocations)
      .values(location)
      .onConflictDoUpdate({
        target: [employeeLocations.branchId, employeeLocations.employeeName],
        set: {
          homePostcode: location.homePostcode,
          homeLat: location.homeLat,
          homeLng: location.homeLng,
          transportMode: location.transportMode,
          gender: location.gender,
          geocodedAt: location.homeLat && location.homeLng ? new Date() : null
        }
      })
      .returning();
    return result;
  }

  async getEmployeeLocationByName(branchId: string, employeeName: string): Promise<EmployeeLocation | undefined> {
    const [location] = await db
      .select()
      .from(employeeLocations)
      .where(
        and(
          eq(employeeLocations.branchId, branchId),
          eq(employeeLocations.employeeName, employeeName)
        )
      );
    return location;
  }

  async getEmployeeLocationById(id: string): Promise<EmployeeLocation | undefined> {
    const [location] = await db.select().from(employeeLocations).where(eq(employeeLocations.id, id));
    return location;
  }

  async getAllEmployeeLocations(branchId: string): Promise<EmployeeLocation[]> {
    return await db.select().from(employeeLocations).where(eq(employeeLocations.branchId, branchId));
  }

  async upsertClientLocation(location: InsertClientLocation): Promise<ClientLocation> {
    const [result] = await db
      .insert(clientLocations)
      .values(location)
      .onConflictDoUpdate({
        target: [clientLocations.branchId, clientLocations.clientName],
        set: {
          addressLine: location.addressLine,
          postcode: location.postcode,
          lat: location.lat,
          lng: location.lng,
          geocodedAt: location.lat && location.lng ? new Date() : null
        }
      })
      .returning();
    return result;
  }

  async getClientLocationByName(branchId: string, clientName: string): Promise<ClientLocation | undefined> {
    const [location] = await db
      .select()
      .from(clientLocations)
      .where(
        and(
          eq(clientLocations.branchId, branchId),
          eq(clientLocations.clientName, clientName)
        )
      );
    return location;
  }

  async getClientLocationById(id: string): Promise<ClientLocation | undefined> {
    const [location] = await db.select().from(clientLocations).where(eq(clientLocations.id, id));
    return location;
  }

  async getAllClientLocations(branchId: string): Promise<ClientLocation[]> {
    return await db.select().from(clientLocations).where(eq(clientLocations.branchId, branchId));
  }

  async saveVisit(visit: InsertVisit): Promise<Visit> {
    const [result] = await db.insert(visits).values(visit).returning();
    return result;
  }

  async getVisitById(id: string): Promise<Visit | undefined> {
    const [visit] = await db.select().from(visits).where(eq(visits.id, id));
    return visit;
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
    let q = db.select().from(visits).where(eq(visits.branchId, branchId)).$dynamic();
    if (startDate) q = q.where(gte(visits.date, startDate));
    if (endDate) q = q.where(lte(visits.date, endDate));
    return await q;
  }

  async clearAllVisits(branchId: string): Promise<any> {
    return await db.delete(visits).where(eq(visits.branchId, branchId));
  }

  async saveRoutePlan(plan: InsertRoutePlan): Promise<RoutePlan> {
    const [result] = await db.insert(routePlans).values(plan).returning();
    return result;
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
    return plan;
  }

  async saveRouteStop(stop: InsertRouteStop): Promise<RouteStop> {
    const [result] = await db.insert(routeStops).values(stop).returning();
    return result;
  }

  async getRouteStopsByPlan(routePlanId: string): Promise<RouteStop[]> {
    return await db
      .select()
      .from(routeStops)
      .where(eq(routeStops.routePlanId, routePlanId))
      .orderBy(routeStops.sequence);
  }

  async getGeocode(branchId: string, key: string): Promise<GeocodeCache | undefined> {
    const [result] = await db
      .select()
      .from(geocodeCache)
      .where(and(eq(geocodeCache.branchId, branchId), eq(geocodeCache.key, key)));
    return result;
  }

  async saveGeocode(geocode: InsertGeocode): Promise<GeocodeCache> {
    const [result] = await db
      .insert(geocodeCache)
      .values(geocode)
      .onConflictDoUpdate({
        target: [geocodeCache.branchId, geocodeCache.key],
        set: {
          lat: geocode.lat,
          lng: geocode.lng,
          source: geocode.source,
          cachedAt: new Date()
        }
      })
      .returning();
    return result;
  }

  async clearRoutesAndVisits(branchId: string): Promise<{ routePlansDeleted: number; routeStopsDeleted: number; visitsDeleted: number }> {
    const routePlansToDelete = await db.select({ id: routePlans.id }).from(routePlans).where(eq(routePlans.branchId, branchId));
    const routePlanIds = routePlansToDelete.map(p => p.id);
    let routeStopsDeleted = 0;
    if (routePlanIds.length > 0) {
      const stopsResult = await db.delete(routeStops).where(sql`${routeStops.routePlanId} IN ${routePlanIds}`);
      routeStopsDeleted = stopsResult.rowCount ?? 0;
    }
    const plansResult = await db.delete(routePlans).where(eq(routePlans.branchId, branchId));
    const visitsResult = await db.delete(visits).where(eq(visits.branchId, branchId));
    return {
      routePlansDeleted: plansResult.rowCount ?? 0,
      routeStopsDeleted,
      visitsDeleted: visitsResult.rowCount ?? 0
    };
  }

  async saveWeeklySchedule(schedule: InsertWeeklySchedule): Promise<WeeklySchedule> {
    const [result] = await db
      .insert(weeklySchedules)
      .values(schedule)
      .onConflictDoUpdate({
        target: [weeklySchedules.branchId, weeklySchedules.weekStartDate, weeklySchedules.weekEndDate],
        set: {
          scheduleData: schedule.scheduleData,
          unallocatedVisits: schedule.unallocatedVisits,
          metrics: schedule.metrics,
          generatedAt: new Date()
        }
      })
      .returning();
    return result;
  }

  async getLatestWeeklySchedule(branchId: string): Promise<WeeklySchedule | undefined> {
    const [schedule] = await db
      .select()
      .from(weeklySchedules)
      .where(eq(weeklySchedules.branchId, branchId))
      .orderBy(desc(weeklySchedules.generatedAt))
      .limit(1);
    return schedule;
  }

  async getWeeklyScheduleByWeek(branchId: string, weekStartDate: string, weekEndDate: string): Promise<WeeklySchedule | undefined> {
    const [schedule] = await db
      .select()
      .from(weeklySchedules)
      .where(
        and(
          eq(weeklySchedules.branchId, branchId),
          eq(weeklySchedules.weekStartDate, weekStartDate),
          eq(weeklySchedules.weekEndDate, weekEndDate)
        )
      );
    return schedule;
  }

  async getAllWeeklySchedules(branchId: string): Promise<WeeklySchedule[]> {
    return await db
      .select()
      .from(weeklySchedules)
      .where(eq(weeklySchedules.branchId, branchId))
      .orderBy(desc(weeklySchedules.generatedAt));
  }

  async getTravelTime(branchId: string, fromLat: string, fromLng: string, toLat: string, toLng: string, mode: string): Promise<TravelTimeCache | undefined> {
    const [result] = await db.select().from(travelTimeCache).where(
      and(
        eq(travelTimeCache.branchId, branchId),
        eq(travelTimeCache.fromLat, fromLat),
        eq(travelTimeCache.fromLng, fromLng),
        eq(travelTimeCache.toLat, toLat),
        eq(travelTimeCache.toLng, toLng),
        eq(travelTimeCache.transportMode, mode as any)
      )
    );
    return result;
  }

  async saveTravelTime(insertTravelTime: InsertTravelTimeCache): Promise<TravelTimeCache> {
    const [result] = await db.insert(travelTimeCache).values(insertTravelTime).returning();
    return result;
  }

  async getBranchSchedulingPreference(branchId: string): Promise<BranchSchedulingPreference> {
    const [pref] = await db.select().from(branchSchedulingPreferences).where(eq(branchSchedulingPreferences.branchId, branchId));
    if (pref) return pref;
    const [newPref] = await db.insert(branchSchedulingPreferences).values({ branchId }).returning();
    return newPref;
  }

  async saveBranchSchedulingPreference(preference: InsertBranchSchedulingPreference): Promise<BranchSchedulingPreference> {
    const [result] = await db
      .insert(branchSchedulingPreferences)
      .values(preference)
      .onConflictDoUpdate({
        target: [branchSchedulingPreferences.branchId],
        set: {
          excludedServiceTypes: preference.excludedServiceTypes,
          updatedAt: new Date()
        }
      })
      .returning();
    return result;
  }

  async saveClientEnquiry(enquiry: InsertClientEnquiry): Promise<ClientEnquiry> {
    const [result] = await db.insert(clientEnquiries).values({
      ...enquiry,
      visitDurationMinutes: enquiry.visitDurationMinutes ?? 60,
    }).returning();
    return result;
  }

  async getClientEnquiries(branchId: string, limit: number = 50): Promise<ClientEnquiry[]> {
    return await db.select().from(clientEnquiries)
      .where(eq(clientEnquiries.branchId, branchId))
      .orderBy(desc(clientEnquiries.createdAt))
      .limit(limit);
  }

  async deleteClientEnquiry(id: string): Promise<void> {
    await db.delete(clientEnquiries).where(eq(clientEnquiries.id, id));
  }
}

export class MemStorage implements IStorage {
  private users: Map<string, User> = new Map();
  private capacityAnalyses: Map<string, CapacityAnalysis> = new Map();
  private branchUploads: Map<string, BranchUpload> = new Map();
  private employeeLocations: Map<string, EmployeeLocation> = new Map();
  private clientLocations: Map<string, ClientLocation> = new Map();
  private visits: Map<string, Visit> = new Map();
  private routePlans: Map<string, RoutePlan> = new Map();
  private routeStops: Map<string, RouteStop> = new Map();
  private geocodeCache: Map<string, GeocodeCache> = new Map();
  private travelTimeCache: Map<string, TravelTimeCache> = new Map();
  private weeklySchedules: Map<string, WeeklySchedule> = new Map();
  private branchSchedulingPreferences: Map<string, BranchSchedulingPreference> = new Map();

  async getUser(id: string): Promise<User | undefined> { return this.users.get(id); }
  async getUserByUsername(username: string): Promise<User | undefined> { return Array.from(this.users.values()).find(u => u.username === username); }
  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async getAllBranches(): Promise<Branch[]> { return []; }
  async getBranchById(id: string): Promise<Branch | undefined> { return undefined; }
  async getBranchByName(name: string): Promise<Branch | undefined> { return undefined; }

  async saveBranchUpload(upload: InsertBranchUpload): Promise<BranchUpload> {
    const id = randomUUID();
    const result: BranchUpload = { ...upload, id, uploadedAt: new Date(), originalFileName: upload.originalFileName ?? null, fileSize: upload.fileSize ?? null, sha256: upload.sha256 ?? null };
    this.branchUploads.set(`${upload.branchId}:${upload.uploadType}`, result);
    return result;
  }
  async getLatestBranchUpload(branchId: string, uploadType: string): Promise<BranchUpload | undefined> { return this.branchUploads.get(`${branchId}:${uploadType}`); }

  async saveCapacityAnalysis(analysis: InsertCapacityAnalysis): Promise<CapacityAnalysis> {
    const id = randomUUID();
    const result: CapacityAnalysis = { ...analysis, id, uploadedAt: new Date(), employeeSummaryByDate: analysis.employeeSummaryByDate || {}, warnings: analysis.warnings || [], unallocatedVisits: analysis.unallocatedVisits || null };
    this.capacityAnalyses.set(id, result);
    return result;
  }
  async getCapacityAnalysesByDateRange(branchId: string, startDate: string, endDate: string): Promise<CapacityAnalysis[]> {
    return Array.from(this.capacityAnalyses.values()).filter(a => a.branchId === branchId && a.weekStartDate >= startDate && a.weekEndDate <= endDate);
  }
  async getAllCapacityAnalyses(branchId: string): Promise<CapacityAnalysis[]> { return Array.from(this.capacityAnalyses.values()).filter(a => a.branchId === branchId); }
  async getCapacityAnalyses(branchId: string): Promise<CapacityAnalysis[]> { return this.getAllCapacityAnalyses(branchId); }
  async getLatestCapacityAnalysis(branchId: string): Promise<CapacityAnalysis | undefined> {
    return Array.from(this.capacityAnalyses.values()).filter(a => a.branchId === branchId).sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())[0];
  }
  async getLatestWeeksAnalyses(branchId: string, limit: number = 4): Promise<CapacityAnalysis[]> {
    return Array.from(this.capacityAnalyses.values()).filter(a => a.branchId === branchId).sort((a, b) => b.weekStartDate.localeCompare(a.weekStartDate)).slice(0, limit);
  }
  async enforceRetentionLatestWeeks(branchId: string, limit: number = 4): Promise<number> { return 0; }
  async cleanupOldAnalyses(branchId: string, monthsOld: number): Promise<number> { return 0; }

  async upsertEmployeeLocation(location: InsertEmployeeLocation): Promise<EmployeeLocation> {
    const id = randomUUID();
    const result: EmployeeLocation = { ...location, id, homeLat: location.homeLat ?? null, homeLng: location.homeLng ?? null, transportMode: location.transportMode ?? null, gender: location.gender ?? null, geocodedAt: new Date() };
    this.employeeLocations.set(id, result);
    return result;
  }
  async getEmployeeLocationByName(branchId: string, employeeName: string): Promise<EmployeeLocation | undefined> {
    return Array.from(this.employeeLocations.values()).find(l => l.branchId === branchId && l.employeeName === employeeName);
  }
  async getEmployeeLocationById(id: string): Promise<EmployeeLocation | undefined> { return this.employeeLocations.get(id); }
  async getAllEmployeeLocations(branchId: string): Promise<EmployeeLocation[]> { return Array.from(this.employeeLocations.values()).filter(l => l.branchId === branchId); }

  async upsertClientLocation(location: InsertClientLocation): Promise<ClientLocation> {
    const id = randomUUID();
    const result: ClientLocation = { ...location, id, lat: location.lat ?? null, lng: location.lng ?? null, geocodedAt: new Date() };
    this.clientLocations.set(id, result);
    return result;
  }
  async getClientLocationByName(branchId: string, clientName: string): Promise<ClientLocation | undefined> {
    return Array.from(this.clientLocations.values()).find(l => l.branchId === branchId && l.clientName === clientName);
  }
  async getClientLocationById(id: string): Promise<ClientLocation | undefined> { return this.clientLocations.get(id); }
  async getAllClientLocations(branchId: string): Promise<ClientLocation[]> { return Array.from(this.clientLocations.values()).filter(l => l.branchId === branchId); }

  async saveVisit(visit: InsertVisit): Promise<Visit> {
    const id = randomUUID();
    const result: Visit = { ...visit, id, createdAt: new Date(), preferredStartTime: visit.preferredStartTime ?? null, preferredEndTime: visit.preferredEndTime ?? null, priority: visit.priority ?? null, serviceType: visit.serviceType ?? null };
    this.visits.set(id, result);
    return result;
  }
  async getVisitById(id: string): Promise<Visit | undefined> { return this.visits.get(id); }
  async getVisitsByDate(branchId: string, date: string): Promise<Visit[]> { return Array.from(this.visits.values()).filter(v => v.branchId === branchId && v.date === date); }
  async getVisitsByClientAndDate(clientId: string, date: string): Promise<Visit[]> { return Array.from(this.visits.values()).filter(v => v.clientId === clientId && v.date === date); }
  async listVisitsBetween(branchId: string, startDate: string | null, endDate: string | null): Promise<Visit[]> { return Array.from(this.visits.values()).filter(v => v.branchId === branchId); }
  async clearAllVisits(branchId: string): Promise<any> { Array.from(this.visits.values()).forEach(v => { if (v.branchId === branchId) this.visits.delete(v.id); }); }

  async saveRoutePlan(plan: InsertRoutePlan): Promise<RoutePlan> {
    const id = randomUUID();
    const result: RoutePlan = { ...plan, id, createdAt: new Date(), updatedAt: new Date(), totalDistanceKm: plan.totalDistanceKm ?? null, totalTravelMinutes: plan.totalTravelMinutes ?? null, status: plan.status ?? null, warnings: plan.warnings ?? [] };
    this.routePlans.set(id, result);
    return result;
  }
  async getRoutePlansByDate(branchId: string, date: string): Promise<RoutePlan[]> { return Array.from(this.routePlans.values()).filter(p => p.branchId === branchId && p.date === date); }
  async getRoutePlanByEmployeeAndDate(employeeId: string, date: string): Promise<RoutePlan | undefined> { return Array.from(this.routePlans.values()).find(p => p.employeeId === employeeId && p.date === date); }

  async saveRouteStop(stop: InsertRouteStop): Promise<RouteStop> {
    const id = randomUUID();
    const result: RouteStop = { ...stop, id, scheduledStart: stop.scheduledStart ?? null, scheduledEnd: stop.scheduledEnd ?? null, travelMinutesFromPrev: stop.travelMinutesFromPrev ?? null, distanceKmFromPrev: stop.distanceKmFromPrev ?? null };
    this.routeStops.set(id, result);
    return result;
  }
  async getRouteStopsByPlan(routePlanId: string): Promise<RouteStop[]> { return Array.from(this.routeStops.values()).filter(s => s.routePlanId === routePlanId); }

  async getGeocode(branchId: string, key: string): Promise<GeocodeCache | undefined> { return this.geocodeCache.get(`${branchId}:${key}`); }
  async saveGeocode(geocode: InsertGeocode): Promise<GeocodeCache> {
    const id = randomUUID();
    const result: GeocodeCache = { ...geocode, id, cachedAt: new Date() };
    this.geocodeCache.set(`${geocode.branchId}:${geocode.key}`, result);
    return result;
  }
  async clearRoutesAndVisits(branchId: string): Promise<any> { return {}; }

  async saveWeeklySchedule(schedule: InsertWeeklySchedule): Promise<WeeklySchedule> {
    const id = randomUUID();
    const result: WeeklySchedule = { ...schedule, id, generatedAt: new Date() };
    this.weeklySchedules.set(id, result);
    return result;
  }
  async getLatestWeeklySchedule(branchId: string): Promise<WeeklySchedule | undefined> {
    return Array.from(this.weeklySchedules.values()).filter(s => s.branchId === branchId).sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime())[0];
  }
  async getWeeklyScheduleByWeek(branchId: string, weekStartDate: string, weekEndDate: string): Promise<WeeklySchedule | undefined> {
    return Array.from(this.weeklySchedules.values()).find(s => s.branchId === branchId && s.weekStartDate === weekStartDate && s.weekEndDate === weekEndDate);
  }
  async getAllWeeklySchedules(branchId: string): Promise<WeeklySchedule[]> { return Array.from(this.weeklySchedules.values()).filter(s => s.branchId === branchId); }

  async getTravelTime(branchId: string, fromLat: string, fromLng: string, toLat: string, toLng: string, mode: string): Promise<TravelTimeCache | undefined> {
    return this.travelTimeCache.get(`${branchId}:${fromLat}:${fromLng}:${toLat}:${toLng}:${mode}`);
  }
  async saveTravelTime(travelTime: InsertTravelTimeCache): Promise<TravelTimeCache> {
    const id = randomUUID();
    const result: TravelTimeCache = { ...travelTime, id, cachedAt: new Date(), distanceMeters: travelTime.distanceMeters ?? null, transportMode: travelTime.transportMode ?? null };
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
    const result: BranchSchedulingPreference = { ...preference, id, updatedAt: new Date(), excludedServiceTypes: preference.excludedServiceTypes || [] };
    this.branchSchedulingPreferences.set(preference.branchId, result);
    return result;
  }

  async saveClientEnquiry(enquiry: InsertClientEnquiry): Promise<ClientEnquiry> {
    const [result] = await db.insert(clientEnquiries).values({
      ...enquiry,
      visitDurationMinutes: enquiry.visitDurationMinutes ?? 60,
    }).returning();
    return result;
  }

  async getClientEnquiries(branchId: string, limit: number = 50): Promise<ClientEnquiry[]> {
    return await db.select().from(clientEnquiries)
      .where(eq(clientEnquiries.branchId, branchId))
      .orderBy(desc(clientEnquiries.createdAt))
      .limit(limit);
  }

  async deleteClientEnquiry(id: string): Promise<void> {
    await db.delete(clientEnquiries).where(eq(clientEnquiries.id, id));
  }
}

export const storage = new DatabaseStorage();
