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
  type UserBranch,
  type AuditLog,
  type InsertAuditLog,
  type CpScheduledVisit,
  type InsertCpScheduledVisit,
  type GhClientVisit,
  type InsertGhClientVisit,
  type Feedback,
  type InsertFeedback,
} from "@shared/schema";
import { randomUUID } from "crypto";
import * as userRepo from "./repositories/user.repository";
import * as branchRepo from "./repositories/branch.repository";
import * as capacityRepo from "./repositories/capacity.repository";
import * as geoRepo from "./repositories/geo.repository";
import * as scheduleRepo from "./repositories/schedule.repository";
import * as enquiryRepo from "./repositories/enquiry.repository";

export interface IStorage {
  // User auth methods
  getUserById(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<Omit<User, 'id' | 'createdAt'>>): Promise<User>;
  updateUserLegalConsent(userId: string, version: string): Promise<User>;
  getAllUsers(): Promise<User[]>;

  // User-Branch assignments
  getUserBranches(userId: string): Promise<Branch[]>;
  assignUserToBranch(userId: string, branchId: string): Promise<UserBranch>;
  setUserBranches(userId: string, branchIds: string[]): Promise<void>;

  // Audit log
  createAuditLog(log: Omit<InsertAuditLog, 'timestamp'>): Promise<AuditLog>;
  getAuditLogs(opts?: { branchId?: string; limit?: number }): Promise<AuditLog[]>;

  // Legacy compat - keep for any remaining references
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;

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
  getCapacityAnalysisByWeekStart(branchId: string, weekStartDate: string): Promise<CapacityAnalysis | undefined>;
  getLatestWeeksAnalyses(branchId: string, limit?: number): Promise<CapacityAnalysis[]>;
  enforceRetentionLatestWeeks(branchId: string, limit?: number): Promise<number>;
  cleanupOldAnalyses(branchId: string, monthsOld: number): Promise<number>;

  // Geographical scheduling
  upsertEmployeeLocation(location: InsertEmployeeLocation): Promise<EmployeeLocation>;
  getEmployeeLocationByName(branchId: string, employeeName: string): Promise<EmployeeLocation | undefined>;
  getEmployeeLocationById(id: string): Promise<EmployeeLocation | undefined>;
  getAllEmployeeLocations(branchId: string): Promise<EmployeeLocation[]>;
  clearEmployeeLocations(branchId: string): Promise<number>; // Delete all for branch (called before fresh upload)

  upsertClientLocation(location: InsertClientLocation): Promise<ClientLocation>;
  getClientLocationByName(branchId: string, clientName: string): Promise<ClientLocation | undefined>;
  getClientLocationById(id: string): Promise<ClientLocation | undefined>;
  getAllClientLocations(branchId: string): Promise<ClientLocation[]>;
  clearClientLocations(branchId: string): Promise<number>; // Delete all for branch (called before fresh upload)

  saveVisit(visit: InsertVisit): Promise<Visit>;
  getVisitById(id: string): Promise<Visit | undefined>;
  getVisitsByDate(branchId: string, date: string): Promise<Visit[]>;
  getVisitsByClientAndDate(clientId: string, date: string): Promise<Visit[]>;
  listVisitsBetween(branchId: string, startDate: string | null, endDate: string | null): Promise<Visit[]>;
  clearAllVisits(branchId: string): Promise<any>;

  // CP Scheduled Visits (from GH Excel, persisted at upload time for BD Matcher)
  saveCpScheduledVisits(visits: InsertCpScheduledVisit[]): Promise<void>;
  getCpScheduledVisitsByBranch(branchId: string, dates: string[]): Promise<CpScheduledVisit[]>;
  deleteCpScheduledVisitsByBranch(branchId: string): Promise<void>;
  replaceCpScheduledVisits(branchId: string, visits: InsertCpScheduledVisit[]): Promise<void>;
  upsertCpScheduledVisitsByDates(branchId: string, dates: string[], visits: InsertCpScheduledVisit[]): Promise<void>;
  enforceRetentionCpScheduledVisits(branchId: string): Promise<void>;

  // GH Client Visits (client-demand, parsed at processing time)
  upsertGhClientVisitsByDates(branchId: string, dates: string[], visits: InsertGhClientVisit[]): Promise<void>;
  enforceRetentionGhClientVisits(branchId: string): Promise<void>;
  getGhClientVisitsByDate(branchId: string, date: string): Promise<GhClientVisit[]>;
  getGhClientVisitsByWeek(branchId: string, weekStart: string, weekEnd: string): Promise<GhClientVisit[]>;

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

  // Feedback / bug reports
  createFeedback(data: InsertFeedback): Promise<Feedback>;
  listFeedback(limit?: number): Promise<Feedback[]>;
}

/**
 * DatabaseStorage: thin facade delegating to domain repositories.
 * All DB logic lives in server/repositories/*
 */
export class DatabaseStorage implements IStorage {
  // ─── User auth ───────────────────────────────────────────────────────────────
  getUserById(id: string) { return userRepo.getUserById(id); }
  getUser(id: string) { return userRepo.getUserById(id); }
  getUserByEmail(email: string) { return userRepo.getUserByEmail(email); }
  getUserByUsername(username: string) { return userRepo.getUserByEmail(username); }
  createUser(insertUser: InsertUser) { return userRepo.createUser(insertUser); }
  updateUser(id: string, updates: Partial<Omit<User, 'id' | 'createdAt'>>) { return userRepo.updateUser(id, updates); }
  updateUserLegalConsent(userId: string, version: string) { return userRepo.updateUserLegalConsent(userId, version); }
  getAllUsers() { return userRepo.getAllUsers(); }

  // ─── User-Branch assignments ─────────────────────────────────────────────────
  getUserBranches(userId: string) { return userRepo.getUserBranches(userId); }
  assignUserToBranch(userId: string, branchId: string) { return userRepo.assignUserToBranch(userId, branchId); }
  setUserBranches(userId: string, branchIds: string[]) { return userRepo.setUserBranches(userId, branchIds); }

  // ─── Audit log ────────────────────────────────────────────────────────────────
  createAuditLog(log: Omit<InsertAuditLog, 'timestamp'>) { return userRepo.createAuditLog(log); }
  getAuditLogs(opts?: { branchId?: string; limit?: number }) { return userRepo.getAuditLogs(opts); }

  // ─── Branches ─────────────────────────────────────────────────────────────────
  getAllBranches() { return branchRepo.getAllBranches(); }
  getBranchById(id: string) { return branchRepo.getBranchById(id); }
  getBranchByName(name: string) { return branchRepo.getBranchByName(name); }
  saveBranchUpload(upload: InsertBranchUpload) { return branchRepo.saveBranchUpload(upload); }
  getLatestBranchUpload(branchId: string, uploadType: string) {
    return branchRepo.getLatestBranchUpload(branchId, uploadType as 'guaranteedHours' | 'availability' | 'demand' | 'cgData');
  }
  getBranchSchedulingPreference(branchId: string) { return branchRepo.getBranchSchedulingPreference(branchId); }
  saveBranchSchedulingPreference(preference: InsertBranchSchedulingPreference) { return branchRepo.saveBranchSchedulingPreference(preference); }

  // ─── Capacity analysis ────────────────────────────────────────────────────────
  saveCapacityAnalysis(analysis: InsertCapacityAnalysis) { return capacityRepo.saveCapacityAnalysis(analysis); }
  getCapacityAnalysesByDateRange(branchId: string, startDate: string, endDate: string) { return capacityRepo.getCapacityAnalysesByDateRange(branchId, startDate, endDate); }
  getAllCapacityAnalyses(branchId: string) { return capacityRepo.getAllCapacityAnalyses(branchId); }
  getCapacityAnalyses(branchId: string) { return capacityRepo.getAllCapacityAnalyses(branchId); }
  getLatestCapacityAnalysis(branchId: string) { return capacityRepo.getLatestCapacityAnalysis(branchId); }
  getCapacityAnalysisByWeekStart(branchId: string, weekStartDate: string) { return capacityRepo.getCapacityAnalysisByWeekStart(branchId, weekStartDate); }
  getLatestWeeksAnalyses(branchId: string, limit?: number) { return capacityRepo.getLatestWeeksAnalyses(branchId, limit); }
  enforceRetentionLatestWeeks(branchId: string, limit?: number) { return capacityRepo.enforceRetentionLatestWeeks(branchId, limit); }
  cleanupOldAnalyses(branchId: string, monthsOld: number) { return capacityRepo.cleanupOldAnalyses(branchId, monthsOld); }

  // ─── Geo / locations / visits ─────────────────────────────────────────────────
  upsertEmployeeLocation(location: InsertEmployeeLocation) { return geoRepo.upsertEmployeeLocation(location); }
  getEmployeeLocationByName(branchId: string, employeeName: string) { return geoRepo.getEmployeeLocationByName(branchId, employeeName); }
  getEmployeeLocationById(id: string) { return geoRepo.getEmployeeLocationById(id); }
  getAllEmployeeLocations(branchId: string) { return geoRepo.getAllEmployeeLocations(branchId); }
  clearEmployeeLocations(branchId: string) { return geoRepo.clearEmployeeLocations(branchId); }
  upsertClientLocation(location: InsertClientLocation) { return geoRepo.upsertClientLocation(location); }
  getClientLocationByName(branchId: string, clientName: string) { return geoRepo.getClientLocationByName(branchId, clientName); }
  getClientLocationById(id: string) { return geoRepo.getClientLocationById(id); }
  getAllClientLocations(branchId: string) { return geoRepo.getAllClientLocations(branchId); }
  clearClientLocations(branchId: string) { return geoRepo.clearClientLocations(branchId); }
  saveVisit(visit: InsertVisit) { return geoRepo.saveVisit(visit); }
  getVisitById(id: string) { return geoRepo.getVisitById(id); }
  getVisitsByDate(branchId: string, date: string) { return geoRepo.getVisitsByDate(branchId, date); }
  getVisitsByClientAndDate(clientId: string, date: string) { return geoRepo.getVisitsByClientAndDate(clientId, date); }
  listVisitsBetween(branchId: string, startDate: string | null, endDate: string | null) { return geoRepo.listVisitsBetween(branchId, startDate, endDate); }
  clearAllVisits(branchId: string) { return geoRepo.clearAllVisits(branchId); }
  saveRoutePlan(plan: InsertRoutePlan) { return geoRepo.saveRoutePlan(plan); }
  getRoutePlansByDate(branchId: string, date: string) { return geoRepo.getRoutePlansByDate(branchId, date); }
  getRoutePlanByEmployeeAndDate(employeeId: string, date: string) { return geoRepo.getRoutePlanByEmployeeAndDate(employeeId, date); }
  saveRouteStop(stop: InsertRouteStop) { return geoRepo.saveRouteStop(stop); }
  getRouteStopsByPlan(routePlanId: string) { return geoRepo.getRouteStopsByPlan(routePlanId); }
  getGeocode(branchId: string, key: string) { return geoRepo.getGeocode(branchId, key); }
  saveGeocode(geocode: InsertGeocode) { return geoRepo.saveGeocode(geocode); }
  clearRoutesAndVisits(branchId: string) { return geoRepo.clearRoutesAndVisits(branchId); }
  getTravelTime(branchId: string, fromLat: string, fromLng: string, toLat: string, toLng: string, mode: string) { return geoRepo.getTravelTime(branchId, fromLat, fromLng, toLat, toLng, mode); }
  saveTravelTime(insertTravelTime: InsertTravelTimeCache) { return geoRepo.saveTravelTime(insertTravelTime); }

  // ─── Schedules / CP visits ────────────────────────────────────────────────────
  saveWeeklySchedule(schedule: InsertWeeklySchedule) { return scheduleRepo.saveWeeklySchedule(schedule); }
  getLatestWeeklySchedule(branchId: string) { return scheduleRepo.getLatestWeeklySchedule(branchId); }
  getWeeklyScheduleByWeek(branchId: string, weekStartDate: string, weekEndDate: string) { return scheduleRepo.getWeeklyScheduleByWeek(branchId, weekStartDate, weekEndDate); }
  getAllWeeklySchedules(branchId: string) { return scheduleRepo.getAllWeeklySchedules(branchId); }
  saveCpScheduledVisits(visits: InsertCpScheduledVisit[]) { return scheduleRepo.saveCpScheduledVisits(visits); }
  getCpScheduledVisitsByBranch(branchId: string, dates: string[]) { return scheduleRepo.getCpScheduledVisitsByBranch(branchId, dates); }
  deleteCpScheduledVisitsByBranch(branchId: string) { return scheduleRepo.deleteCpScheduledVisitsByBranch(branchId); }
  replaceCpScheduledVisits(branchId: string, visits: InsertCpScheduledVisit[]) { return scheduleRepo.replaceCpScheduledVisits(branchId, visits); }
  upsertCpScheduledVisitsByDates(branchId: string, dates: string[], visits: InsertCpScheduledVisit[]) { return scheduleRepo.upsertCpScheduledVisitsByDates(branchId, dates, visits); }
  enforceRetentionCpScheduledVisits(branchId: string) { return scheduleRepo.enforceRetentionCpScheduledVisits(branchId); }
  upsertGhClientVisitsByDates(branchId: string, dates: string[], visits: InsertGhClientVisit[]) { return scheduleRepo.upsertGhClientVisitsByDates(branchId, dates, visits); }
  enforceRetentionGhClientVisits(branchId: string) { return scheduleRepo.enforceRetentionGhClientVisits(branchId); }
  getGhClientVisitsByDate(branchId: string, date: string) { return scheduleRepo.getGhClientVisitsByDate(branchId, date); }
  getGhClientVisitsByWeek(branchId: string, weekStart: string, weekEnd: string) { return scheduleRepo.getGhClientVisitsByWeek(branchId, weekStart, weekEnd); }

  // ─── Enquiries / feedback ─────────────────────────────────────────────────────
  saveClientEnquiry(enquiry: InsertClientEnquiry) { return enquiryRepo.saveClientEnquiry(enquiry); }
  getClientEnquiries(branchId: string, limit?: number) { return enquiryRepo.getClientEnquiries(branchId, limit); }
  deleteClientEnquiry(id: string) { return enquiryRepo.deleteClientEnquiry(id); }
  createFeedback(data: InsertFeedback) { return enquiryRepo.createFeedback(data); }
  listFeedback(limit?: number) { return enquiryRepo.listFeedback(limit); }
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
  async getUserById(id: string): Promise<User | undefined> { return this.users.get(id); }
  async getUserByEmail(email: string): Promise<User | undefined> { return Array.from(this.users.values()).find(u => u.email === email); }
  async getUserByUsername(username: string): Promise<User | undefined> { return Array.from(this.users.values()).find(u => u.email === username); }
  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, username: insertUser.username ?? null, supabaseUserId: insertUser.supabaseUserId ?? null, id, createdAt: new Date() };
    this.users.set(id, user);
    return user;
  }
  async updateUser(id: string, updates: Partial<Omit<User, 'id' | 'createdAt'>>): Promise<User> {
    const user = this.users.get(id);
    if (!user) throw new Error(`User ${id} not found`);
    const updated = { ...user, ...updates };
    this.users.set(id, updated);
    return updated;
  }
  async getAllUsers(): Promise<User[]> { return Array.from(this.users.values()); }
  async getUserBranches(userId: string): Promise<Branch[]> { return []; }
  async assignUserToBranch(userId: string, branchId: string): Promise<UserBranch> {
    return { id: randomUUID(), userId, branchId, assignedAt: new Date() } as UserBranch;
  }
  async setUserBranches(userId: string, branchIds: string[]): Promise<void> {}
  async createAuditLog(log: Omit<InsertAuditLog, 'timestamp'>): Promise<AuditLog> {
    return { ...log, id: randomUUID(), timestamp: new Date(), detail: log.detail ?? null, branchId: log.branchId ?? null } as AuditLog;
  }
  async getAuditLogs(opts?: { branchId?: string; limit?: number }): Promise<AuditLog[]> { return []; }

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
    const result: CapacityAnalysis = { ...analysis, id, uploadedAt: new Date(), employeeSummaryByDate: analysis.employeeSummaryByDate || {}, warnings: analysis.warnings || [], ghLossRawSummary: analysis.ghLossRawSummary ?? null };
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
  async getCapacityAnalysisByWeekStart(branchId: string, weekStartDate: string): Promise<CapacityAnalysis | undefined> {
    return Array.from(this.capacityAnalyses.values()).find(a => a.branchId === branchId && a.weekStartDate === weekStartDate);
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
  async clearEmployeeLocations(branchId: string): Promise<number> {
    let count = 0;
    Array.from(this.employeeLocations.entries()).forEach(([id, l]) => { if (l.branchId === branchId) { this.employeeLocations.delete(id); count++; } });
    return count;
  }

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
  async clearClientLocations(branchId: string): Promise<number> {
    let count = 0;
    Array.from(this.clientLocations.entries()).forEach(([id, l]) => { if (l.branchId === branchId) { this.clientLocations.delete(id); count++; } });
    return count;
  }

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

  // CP Scheduled Visits - in-memory implementation
  private cpVisits: Map<string, CpScheduledVisit> = new Map();
  async saveCpScheduledVisits(visitRows: InsertCpScheduledVisit[]): Promise<void> {
    for (const v of visitRows) {
      const id = randomUUID();
      this.cpVisits.set(id, { ...v, id, clientLat: v.clientLat ?? null, clientLng: v.clientLng ?? null, clientPostcode: v.clientPostcode ?? null });
    }
  }
  async getCpScheduledVisitsByBranch(branchId: string, dates: string[]): Promise<CpScheduledVisit[]> {
    const dateSet = new Set(dates);
    return Array.from(this.cpVisits.values()).filter(v => v.branchId === branchId && dateSet.has(v.date));
  }
  async deleteCpScheduledVisitsByBranch(branchId: string): Promise<void> {
    Array.from(this.cpVisits.entries()).forEach(([id, v]) => { if (v.branchId === branchId) this.cpVisits.delete(id); });
  }
  async replaceCpScheduledVisits(branchId: string, visitRows: InsertCpScheduledVisit[]): Promise<void> {
    await this.deleteCpScheduledVisitsByBranch(branchId);
    await this.saveCpScheduledVisits(visitRows);
  }

  async upsertCpScheduledVisitsByDates(branchId: string, dates: string[], visitRows: InsertCpScheduledVisit[]): Promise<void> {
    const dateSet = new Set(dates);
    // Remove only visits for the specific dates being uploaded
    Array.from(this.cpVisits.entries()).forEach(([id, v]) => {
      if (v.branchId === branchId && dateSet.has(v.date)) this.cpVisits.delete(id);
    });
    await this.saveCpScheduledVisits(visitRows);
  }

  async enforceRetentionCpScheduledVisits(branchId: string): Promise<void> {
    // Keep 2 past weeks (14 days before current Monday) + all future weeks.
    const now = new Date();
    const day = now.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    const currentMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff));
    const cutoffDate = new Date(currentMonday);
    cutoffDate.setUTCDate(cutoffDate.getUTCDate() - 14);
    const cutoffStr = cutoffDate.toISOString().slice(0, 10);
    Array.from(this.cpVisits.entries()).forEach(([id, v]) => {
      if (v.branchId === branchId && v.date < cutoffStr) this.cpVisits.delete(id);
    });
  }

  // GH Client Visits - in-memory stubs (dev/test only)
  private ghVisits: Map<string, GhClientVisit> = new Map();
  async upsertGhClientVisitsByDates(branchId: string, dates: string[], visitRows: InsertGhClientVisit[]): Promise<void> {
    const dateSet = new Set(dates);
    Array.from(this.ghVisits.entries()).forEach(([id, v]) => {
      if (v.branchId === branchId && dateSet.has(v.date)) this.ghVisits.delete(id);
    });
    for (const v of visitRows) {
      const id = randomUUID();
      this.ghVisits.set(id, { ...v, id, serviceType: v.serviceType ?? null, priority: v.priority ?? 1, lat: v.lat ?? null, lng: v.lng ?? null, postcode: v.postcode ?? null });
    }
  }
  async enforceRetentionGhClientVisits(branchId: string): Promise<void> {
    // Keep 2 past weeks (14 days before current Monday) + all future weeks.
    const now = new Date();
    const day = now.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    const currentMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff));
    const cutoffDate = new Date(currentMonday);
    cutoffDate.setUTCDate(cutoffDate.getUTCDate() - 14);
    const cutoffStr = cutoffDate.toISOString().slice(0, 10);
    Array.from(this.ghVisits.entries()).forEach(([id, v]) => {
      if (v.branchId === branchId && v.date < cutoffStr) this.ghVisits.delete(id);
    });
  }
  async getGhClientVisitsByDate(branchId: string, date: string): Promise<GhClientVisit[]> {
    return Array.from(this.ghVisits.values()).filter(v => v.branchId === branchId && v.date === date);
  }
  async getGhClientVisitsByWeek(branchId: string, weekStart: string, weekEnd: string): Promise<GhClientVisit[]> {
    return Array.from(this.ghVisits.values()).filter(v => v.branchId === branchId && v.date >= weekStart && v.date <= weekEnd);
  }

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
    const result: WeeklySchedule = { ...schedule, id, generatedAt: new Date(), unallocatedVisits: schedule.unallocatedVisits ?? [] };
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

  private clientEnquiriesMap: Map<string, ClientEnquiry> = new Map();

  async saveClientEnquiry(enquiry: InsertClientEnquiry): Promise<ClientEnquiry> {
    const id = randomUUID();
    const result: ClientEnquiry = {
      ...enquiry,
      id,
      postcode: enquiry.postcode ?? null,
      genderPreference: enquiry.genderPreference ?? null,
      topMatch: enquiry.topMatch ?? null,
      results: enquiry.results ?? null,
      visits: enquiry.visits ?? null,
      matchCount: enquiry.matchCount ?? 0,
      isMultiVisit: enquiry.isMultiVisit ?? 0,
      visitDurationMinutes: enquiry.visitDurationMinutes ?? 60,
      starredSelections: enquiry.starredSelections ?? null,
      createdAt: new Date(),
    };
    this.clientEnquiriesMap.set(id, result);
    return result;
  }

  async getClientEnquiries(branchId: string, limit: number = 50): Promise<ClientEnquiry[]> {
    return Array.from(this.clientEnquiriesMap.values())
      .filter(e => e.branchId === branchId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async deleteClientEnquiry(id: string): Promise<void> {
    this.clientEnquiriesMap.delete(id);
  }

  async createFeedback(data: InsertFeedback): Promise<Feedback> {
    return enquiryRepo.createFeedback(data);
  }

  async listFeedback(limit: number = 200): Promise<Feedback[]> {
    return enquiryRepo.listFeedback(limit);
  }
}

export const storage = new DatabaseStorage();
