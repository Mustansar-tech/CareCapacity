import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb, unique, index, integer, serial, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const userRoles = ['admin', 'scheduler', 'viewer'] as const;
export type UserRole = typeof userRoles[number];

export const CURRENT_LEGAL_VERSION = "1.0";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  username: text("username"),
  passwordHash: text("password").notNull(), // Maps to 'password' column in DB
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default('viewer'),
  isActive: integer("is_active").notNull().default(1), // 1=active, 0=inactive
  supabaseUserId: text("supabase_user_id"),            // Supabase Auth UUID
  legalConsentVersion: text("legal_consent_version"),  // e.g. "1.0"
  legalConsentAt: timestamp("legal_consent_at"),       // when they accepted
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// PostgreSQL session store table (managed by connect-pg-simple)
export const session = pgTable("session", {
  sid: varchar("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
}, (table) => ({
  expireIdx: index("IDX_session_expire").on(table.expire),
}));

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
}).extend({
  role: z.enum(userRoles).default('viewer'),
  isActive: z.number().default(1),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// User-Branch assignments (many-to-many)
export const userBranches = pgTable("user_branches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  branchId: varchar("branch_id").notNull().references(() => branches.id, { onDelete: 'cascade' }),
}, (table) => ({
  uniqueUserBranch: unique("unique_user_branch").on(table.userId, table.branchId),
}));

export const insertUserBranchSchema = createInsertSchema(userBranches).omit({ id: true });
export type InsertUserBranch = z.infer<typeof insertUserBranchSchema>;
export type UserBranch = typeof userBranches.$inferSelect;

// Audit log for compliance
export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  userEmail: text("user_email"),
  branchId: varchar("branch_id"),
  action: text("action").notNull(),
  detail: text("detail"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, timestamp: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

// Branches table for multi-franchise support
export const branches = pgTable("branches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertBranchSchema = createInsertSchema(branches).omit({
  id: true,
  createdAt: true,
});

export type InsertBranch = z.infer<typeof insertBranchSchema>;
export type Branch = typeof branches.$inferSelect;

// Historical data storage tables
export const capacityAnalyses = pgTable("capacity_analyses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  branchId: varchar("branch_id").notNull().references(() => branches.id),
  weekStartDate: text("week_start_date").notNull(),
  weekEndDate: text("week_end_date").notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  kpis: jsonb("kpis").notNull(),
  dailySummary: jsonb("daily_summary").notNull(),
  employeesByDate: jsonb("employees_by_date").notNull(),
  employeeSummaryByDate: jsonb("employee_summary_by_date").notNull().default({}),
  warnings: jsonb("warnings").default([]),
  ghLossRawSummary: jsonb("gh_loss_raw_summary"),
}, (table) => ({
  // Unique constraint to prevent duplicate weeks PER BRANCH
  uniqueWeek: unique("unique_week").on(table.branchId, table.weekStartDate, table.weekEndDate),
  // Indexes for efficient querying
  branchIdx: index("branch_idx").on(table.branchId),
  weekStartIdx: index("week_start_idx").on(table.weekStartDate),
  uploadedAtIdx: index("uploaded_at_idx").on(table.uploadedAt),
}));

export const insertCapacityAnalysisSchema = createInsertSchema(capacityAnalyses).omit({
  id: true,
  uploadedAt: true,
});

export type InsertCapacityAnalysis = z.infer<typeof insertCapacityAnalysisSchema>;
export type CapacityAnalysis = typeof capacityAnalyses.$inferSelect;

// Branch file uploads storage - stores the latest upload per (branch, type)
export const branchUploads = pgTable("branch_uploads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  branchId: varchar("branch_id").notNull().references(() => branches.id),
  uploadType: text("upload_type", { enum: ["guaranteedHours", "availability", "demand", "cgData"] }).notNull(),
  fileBuffer: text("file_buffer").notNull(), // Base64 encoded buffer (raw binary would use bytea in PostgreSQL)
  originalFileName: text("original_file_name"),
  fileSize: integer("file_size"),
  sha256: text("sha256"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
}, (table) => ({
  // Unique constraint: only keep the latest file per (branch, uploadType)
  uniqueBranchUpload: unique("unique_branch_upload").on(table.branchId, table.uploadType),
  branchIdx: index("branch_upload_branch_idx").on(table.branchId),
  uploadedAtIdx: index("upload_uploaded_at_idx").on(table.uploadedAt),
}));

export const insertBranchUploadSchema = createInsertSchema(branchUploads).omit({
  id: true,
  uploadedAt: true,
});

export type InsertBranchUpload = z.infer<typeof insertBranchUploadSchema>;
export type BranchUpload = typeof branchUploads.$inferSelect;

// Week boundary helper functions
export function getCanonicalWeekBoundaries(dateStr: string): { weekStart: string; weekEnd: string } {
  const date = new Date(dateStr + 'T00:00:00.000Z'); // Parse as UTC
  
  // Get the Monday of the week (ISO week starts on Monday)
  const dayOfWeek = date.getUTCDay(); // 0 = Sunday, 1 = Monday, etc.
  const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Convert Sunday=0 to Sunday=6
  
  const weekStart = new Date(date);
  weekStart.setUTCDate(date.getUTCDate() - daysToSubtract);
  
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6); // Sunday is +6 days from Monday
  
  return {
    weekStart: weekStart.toISOString().split('T')[0], // YYYY-MM-DD format
    weekEnd: weekEnd.toISOString().split('T')[0]
  };
}

// ====================== CARE CAPACITY DASHBOARD SCHEMAS ======================

// Raw Excel data interfaces - using Record for dynamic Excel column access
export interface AvailabilityRow extends Record<string, unknown> {
  "CAREGiver Name": string;
  "Start Date": string;
  "Start Time": string;
  "End Time": string;
  "Type": string;
  "Hours"?: number;
  "Notes"?: string;
  "End Date"?: string;
  "Time Window(s)"?: string;
  "Time Window"?: string;
}

export interface GuaranteedHoursRow extends Record<string, unknown> {
  "Actual Employee Name": string;
  "Actual Employee Hours Per Week": number;
  "Actual Pay Rate Hours": number;
  "Service Requirement Start Date And Time": string;
  "Service Requirement End Date And Time": string;
  "Actual Service Type Description"?: string;
  "Cancellation Description"?: string;
  "Planned Duration"?: number;
  "Planned Start Date And Time"?: string;
  "Planned End Date And Time"?: string;
  "Service Type Description"?: string;
  "Duration (Planned)"?: number;
  "Duration"?: number;
  "Planned Hrs"?: number;
  "Planned Hours"?: number;
  "Planned Time"?: number;
}

export interface ClientDemandRow {
  "Date": string;
  "Required Client Hours": number;
}

export interface ServiceDeliveryRow {
  "Count": number;
  "Customer Name": string;
  "Actual Start Date And Time": string | number;
  "Actual End Date And Time": string | number;
  "Actual Duration": number;
  "Actual Start Date Year": string;
  "Actual Start Date Month": string;
  "Actual Start Date Weekday": string;
  "Actual Employee Name": string;
  "Actual Service Type Description": string;
  "Cancellation Description"?: string;
}

// Processed data interfaces
export interface CleanedEmployeeRecord {
  employeeName: string;
  contractedWeeklyHours: number;
  contractedDailyHours: number;
  date: string;
  status: string;
  timeWindows: string;
  scheduledHours: number;
  clientScheduledHours: number;
  otherScheduledHours: number;
  hours: number;
  netCapacity: number;
  notes: string;
  postCode: string;
}

export interface DailySummaryRecord {
  date: string;
  availableHours: number;
  netCapacity: number;
  unavailability: number;
  sickness: number;
  clientScheduledHours: number;
  otherScheduledHours: number;
  holidays: number;
  clientRequired: number;
  gap: number;
  status: "Sufficient" | "Shortage";
  scheduledHours: number;
}

export interface EmployeeDailyDetail {
  employeeName: string;
  status: string;
  timeWindows: string;
  contractedDailyHours: number;
  scheduledHours: number;
  hours: number;
  netCapacity: number;
  notes: string;
  gender?: string; // Gender derived from title (e.g., "male", "female")
}

export interface EmployeeSummaryRecord {
  employeeName: string;
  availability: number;
  unavailability: number;
  scheduledHours: number;
  difference: number;
  freeWindows: string; // Time slots available for new clients (e.g., "09:00-12:00, 14:00-16:00")
  cancelledVisits: string; // Cancelled visit time windows (e.g., "Mon 15 Sep • 10:30–11:30; Tue 16 Sep • 14:00–15:00")
  transportMode?: string; // Transport mode from CG Data (e.g., "Car", "Walker")
  gender?: string; // Gender derived from title (e.g., "male", "female")
}

// Raw GH loss summary computed directly from guaranteed hours file (before any availability pipeline filtering).
// This is the source of truth for scheduled hours in GH loss calculations —
// it includes night visits, paid cancellations, and any hours that might not
// appear in employeeSummaryByDate due to availability data gaps.
export interface GhLossRawSummary {
  /** normalizedName → { ghHours, displayName } */
  targets: Record<string, { hours: number; displayName: string }>;
  /** normalizedName → total weekly paid hours (from raw guaranteed hours) */
  scheduled: Record<string, number>;
  /**
   * normalizedName → weekly unavailability totals (from employeeSummaryByDate).
   * Pre-computed server-side so Path A is fully self-contained.
   */
  unavailability?: Record<string, { weeklyUnavailability: number; weeklyAvailability: number }>;
}

export interface ProcessingResult {
  kpis: {
    netCapacitySum: number;
    clientRequiredSum: number;
    gapSum: number;
    unavailabilitySum: number;
    holidaysSum: number;
    sicknessSum: number;
    totalScheduledHoursSum: number;
    clientScheduledHoursSum: number;
    otherScheduledHoursSum: number;
    capacityAfterSchedulingSum: number;
    totalDesiredHoursSum: number;
  };
  dailySummary: DailySummaryRecord[];
  employeesByDate: Record<string, EmployeeDailyDetail[]>;
  employeeSummaryByDate: Record<string, EmployeeSummaryRecord[]>;
  warnings?: string[];
  /** Weekly GH loss totals computed from raw guaranteed hours (bypasses availability pipeline). */
  ghLossRawSummary?: GhLossRawSummary;
  // Geographical data for scheduling optimization
  employeeLocations?: Array<{
    employeeName: string;
    homePostcode: string;
    homeLat?: number;
    homeLng?: number;
    transportMode?: string;
    gender?: string; // Employee gender for client matching
  }>;
  clientLocations?: Array<{
    clientName: string;
    addressLine: string;
    postcode: string;
    lat?: number;
    lng?: number;
  }>;
}

// Weekly schedule data structures
export interface ScheduledVisit {
  clientName: string;
  startTime: string; // HH:MM format
  endTime: string;   // HH:MM format
  travelTimeBefore: number; // minutes
  score: number;
  lat?: number;
  lng?: number;
}

// Client visit for VRPTW optimization - combines visit data with location
export interface ClientVisit {
  id: string;
  clientName: string;
  startTime: string; // HH:MM format
  endTime: string;   // HH:MM format
  durationMinutes: number;
  date: string;
  lat?: number;
  lng?: number;
  serviceType?: string;
  priority?: number;
}

export interface EmployeeWeeklySchedule {
  employeeName: string;
  [date: string]: ScheduledVisit[] | string; // date as key -> visits array
}

export interface WeeklyScheduleData {
  employees: EmployeeWeeklySchedule[];
  weekDates: string[]; // Array of dates in the week
}

export interface WeeklyScheduleMetrics {
  totalVisitsAssigned: number;
  totalVisitsUnallocated: number;
  averageTravelTimePerVisit: number;
  employeesUtilized: number;
}

// ── History list item returned by GET /api/history ────────────────────────────
export interface CapacityAnalysisSummary {
  id: string;
  branchId: string;
  weekStartDate: string;
  weekEndDate: string;
  uploadedAt: string;
  kpis: ProcessingResult['kpis'];
  dailySummary: DailySummaryRecord[];
  employeesByDate: Record<string, EmployeeDailyDetail[]>;
  employeeSummaryByDate: Record<string, EmployeeSummaryRecord[]>;
  warnings?: string[];
  ghLossRawSummary?: GhLossRawSummary;
}

// ── ProcessingResult augmented with DB metadata (returned by /api/history/latest) ──
export interface ProcessingResultWithMeta extends ProcessingResult {
  id: string;
  branchId: string;
  weekStartDate: string;
  weekEndDate: string;
  uploadedAt: string;
}

// Validation schemas
export const availabilitySchema = z.object({
  "CAREGiver Name": z.string().min(1, "CAREGiver Name is required"),
  "Start Date": z.string().min(1, "Start Date is required"),
  "Start Time": z.string().min(1, "Start Time is required"),
  "End Time": z.string().min(1, "End Time is required"),
  "Type": z.string().min(1, "Type is required"),
  "Hours": z.number().optional(),
  "Notes": z.string().optional(),
});

export const guaranteedSchema = z.object({
  "Actual Employee Name": z.string().min(1, "Actual Employee Name is required"),
  "Actual Employee Hours Per Week": z.number().min(0, "Weekly hours must be non-negative"),
  "Actual Pay Rate Hours": z.number().min(0, "Pay rate hours must be non-negative"),
  "Service Requirement Start Date And Time": z.string().min(1, "Service Requirement Start Date And Time is required"),
  "Service Requirement End Date And Time": z.string().min(1, "Service Requirement End Date And Time is required"),
});

export const clientDemandSchema = z.object({
  "Date": z.string().min(1, "Date is required"),
  "Required Client Hours": z.number().min(0, "Required hours must be non-negative"),
});

// ====================== GEOGRAPHICAL SCHEDULING SCHEMAS ======================

// Employee location data
export const employeeLocations = pgTable("employee_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  branchId: varchar("branch_id").notNull().references(() => branches.id),
  employeeName: text("employee_name").notNull(),
  homePostcode: text("home_postcode").notNull(),
  homeLat: text("home_lat"),
  homeLng: text("home_lng"),
  transportMode: text("transport_mode", { enum: ["car", "walking", "public"] }).default("car"),
  gender: text("gender", { enum: ["male", "female"] }), // Employee gender for client matching
  geocodedAt: timestamp("geocoded_at"),
}, (table) => ({
  // Unique constraint: employee name must be unique WITHIN each branch
  uniqueEmployeePerBranch: unique("unique_employee_per_branch").on(table.branchId, table.employeeName),
  branchIdx: index("employee_branch_idx").on(table.branchId),
  employeeNameIdx: index("employee_name_idx").on(table.employeeName),
  postcodeIdx: index("postcode_idx").on(table.homePostcode),
}));

// Client location data
export const clientLocations = pgTable("client_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  branchId: varchar("branch_id").notNull().references(() => branches.id),
  clientName: text("client_name").notNull(),
  addressLine: text("address_line").notNull(),
  postcode: text("postcode").notNull(),
  lat: text("lat"),
  lng: text("lng"),
  geocodedAt: timestamp("geocoded_at"),
}, (table) => ({
  // Unique constraint: client name must be unique WITHIN each branch
  uniqueClientPerBranch: unique("unique_client_per_branch").on(table.branchId, table.clientName),
  branchIdx: index("client_branch_idx").on(table.branchId),
  clientNameIdx: index("client_name_idx").on(table.clientName),
  postcodeIdx: index("client_postcode_idx").on(table.postcode),
}));

// Visit requirements
export const visits = pgTable("visits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  branchId: varchar("branch_id").notNull().references(() => branches.id),
  clientId: varchar("client_id").notNull().references(() => clientLocations.id),
  date: text("date").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  preferredStartTime: text("preferred_start_time"),
  preferredEndTime: text("preferred_end_time"),
  priority: integer("priority").default(1),
  serviceType: text("service_type"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  branchIdx: index("visit_branch_idx").on(table.branchId),
  dateIdx: index("visit_date_idx").on(table.date),
  clientDateIdx: index("visit_client_date_idx").on(table.clientId, table.date),
}));

// Route plans
export const routePlans = pgTable("route_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  branchId: varchar("branch_id").notNull().references(() => branches.id),
  date: text("date").notNull(),
  employeeId: varchar("employee_id").notNull().references(() => employeeLocations.id),
  totalDistanceKm: text("total_distance_km"),
  totalTravelMinutes: integer("total_travel_minutes"),
  status: text("status", { enum: ["optimized", "manual", "infeasible"] }).default("optimized"),
  warnings: jsonb("warnings").default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  branchIdx: index("route_branch_idx").on(table.branchId),
  employeeDateIdx: index("route_employee_date_idx").on(table.employeeId, table.date),
  dateIdx: index("route_date_idx").on(table.date),
}));

// Route stops
export const routeStops = pgTable("route_stops", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  routePlanId: varchar("route_plan_id").notNull().references(() => routePlans.id, { onDelete: "cascade" }),
  visitId: varchar("visit_id").notNull().references(() => visits.id),
  sequence: integer("sequence").notNull(),
  scheduledStart: text("scheduled_start"),
  scheduledEnd: text("scheduled_end"),
  travelMinutesFromPrev: integer("travel_minutes_from_prev"),
  distanceKmFromPrev: text("distance_km_from_prev"),
}, (table) => ({
  routePlanSeqIdx: index("route_stop_plan_seq_idx").on(table.routePlanId, table.sequence),
}));

// Geocoding cache
export const geocodeCache = pgTable("geocode_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  branchId: varchar("branch_id").notNull().references(() => branches.id),
  key: text("key").notNull(),
  lat: text("lat").notNull(),
  lng: text("lng").notNull(),
  source: text("source").notNull(),
  cachedAt: timestamp("cached_at").defaultNow().notNull(),
}, (table) => ({
  // Unique constraint: cache key must be unique WITHIN each branch
  uniqueCachePerBranch: unique("unique_cache_per_branch").on(table.branchId, table.key),
  branchIdx: index("geocode_branch_idx").on(table.branchId),
  keyIdx: index("geocode_key_idx").on(table.key),
}));

// Weekly schedules - stores generated employee schedules
export const weeklySchedules = pgTable("weekly_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  branchId: varchar("branch_id").notNull().references(() => branches.id),
  weekStartDate: text("week_start_date").notNull(),
  weekEndDate: text("week_end_date").notNull(),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
  scheduleData: jsonb("schedule_data").notNull(), // Full weekly schedule with employee assignments
  unallocatedVisits: jsonb("unallocated_visits").default([]), // Visits that couldn't be assigned
  metrics: jsonb("metrics").notNull(), // Week-level metrics
}, (table) => ({
  // Unique constraint: week must be unique WITHIN each branch
  uniqueWeek: unique("unique_weekly_schedule").on(table.branchId, table.weekStartDate, table.weekEndDate),
  branchIdx: index("weekly_schedule_branch_idx").on(table.branchId),
  weekStartIdx: index("weekly_schedule_start_idx").on(table.weekStartDate),
  generatedAtIdx: index("weekly_schedule_generated_idx").on(table.generatedAt),
}));

// Bad matches: client + care pro pairs that must never be scheduled together
export const badMatches = pgTable("bad_matches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  branchId: varchar("branch_id").notNull().references(() => branches.id),
  clientName: text("client_name").notNull(),
  employeeName: text("employee_name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  uniqueBadMatchPerBranch: unique("unique_bad_match_per_branch").on(table.branchId, table.clientName, table.employeeName),
  branchIdx: index("bad_match_branch_idx").on(table.branchId),
}));

// Insert schemas for geographical data
export const insertEmployeeLocationSchema = createInsertSchema(employeeLocations).omit({
  id: true,
  geocodedAt: true,
});

export const insertClientLocationSchema = createInsertSchema(clientLocations).omit({
  id: true,
  geocodedAt: true,
});

export const insertVisitSchema = createInsertSchema(visits).omit({
  id: true,
  createdAt: true
}).required({
  branchId: true,
  clientId: true,
});

export const insertRoutePlanSchema = createInsertSchema(routePlans).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertRouteStopSchema = createInsertSchema(routeStops).omit({
  id: true,
});

export const insertGeocodeSchema = createInsertSchema(geocodeCache).omit({
  id: true,
  cachedAt: true,
});

export const insertWeeklyScheduleSchema = createInsertSchema(weeklySchedules).omit({
  id: true,
  generatedAt: true,
});

// Types for geographical data
export type InsertEmployeeLocation = z.infer<typeof insertEmployeeLocationSchema>;
export type EmployeeLocation = typeof employeeLocations.$inferSelect;

export type InsertClientLocation = z.infer<typeof insertClientLocationSchema>;
export type ClientLocation = typeof clientLocations.$inferSelect;

export type InsertVisit = z.infer<typeof insertVisitSchema>;
export type Visit = typeof visits.$inferSelect;

export type InsertRoutePlan = z.infer<typeof insertRoutePlanSchema>;
export type RoutePlan = typeof routePlans.$inferSelect;

export type InsertRouteStop = z.infer<typeof insertRouteStopSchema>;
export type RouteStop = typeof routeStops.$inferSelect;

export type InsertGeocode = z.infer<typeof insertGeocodeSchema>;
export type GeocodeCache = typeof geocodeCache.$inferSelect;

export type InsertWeeklySchedule = z.infer<typeof insertWeeklyScheduleSchema>;

export const insertBadMatchSchema = createInsertSchema(badMatches).omit({
  id: true,
  createdAt: true,
});
export type InsertBadMatch = z.infer<typeof insertBadMatchSchema>;
export type BadMatch = typeof badMatches.$inferSelect;
export type WeeklySchedule = typeof weeklySchedules.$inferSelect;

// Travel time cache - stores ORS API results for faster lookups
export const travelTimeCache = pgTable("travel_time_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  branchId: varchar("branch_id").notNull().references(() => branches.id),
  fromLat: text("from_lat").notNull(),
  fromLng: text("from_lng").notNull(),
  toLat: text("to_lat").notNull(),
  toLng: text("to_lng").notNull(),
  transportMode: text("transport_mode", { enum: ["car", "walking", "public"] }).default("car"),
  durationMinutes: integer("duration_minutes").notNull(),
  distanceMeters: integer("distance_meters"),
  source: text("source", { enum: ["ors", "ors-matrix", "osrm", "haversine", "heuristic", "traveltime", "traveltime-matrix"] }).notNull(), // Whether from API or heuristic fallback
  cachedAt: timestamp("cached_at").defaultNow().notNull(),
}, (table) => ({
  uniqueTravelTime: unique("unique_travel_time").on(
    table.branchId, table.fromLat, table.fromLng, table.toLat, table.toLng, table.transportMode
  ),
  branchIdx: index("travel_cache_branch_idx").on(table.branchId),
  fromIdx: index("travel_cache_from_idx").on(table.fromLat, table.fromLng),
  toIdx: index("travel_cache_to_idx").on(table.toLat, table.toLng),
}));

export const insertTravelTimeCacheSchema = createInsertSchema(travelTimeCache).omit({
  id: true,
  cachedAt: true,
});

export type InsertTravelTimeCache = z.infer<typeof insertTravelTimeCacheSchema>;
export type TravelTimeCache = typeof travelTimeCache.$inferSelect;

// Branch scheduling preferences - stores filter preferences per branch
export const branchSchedulingPreferences = pgTable("branch_scheduling_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  branchId: varchar("branch_id").notNull().references(() => branches.id).unique(),
  excludedServiceTypes: text("excluded_service_types").array().notNull().default(sql`ARRAY[
    'office hours',
    'office',
    'nights - sleep in',
    'sleep in',
    'nights - waking nights',
    'waking nights',
    'multiple care (secondary)',
    'secondary',
    '(secondary)'
  ]`),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertBranchSchedulingPreferenceSchema = createInsertSchema(branchSchedulingPreferences).omit({ 
  id: true,
  updatedAt: true,
});

export type InsertBranchSchedulingPreference = z.infer<typeof insertBranchSchedulingPreferenceSchema>;
export type BranchSchedulingPreference = typeof branchSchedulingPreferences.$inferSelect;

export const clientEnquiries = pgTable("client_enquiries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  branchId: varchar("branch_id").notNull().references(() => branches.id),
  clientName: text("client_name").notNull(),
  postcode: text("postcode"),
  genderPreference: text("gender_preference"),
  requiredDays: jsonb("required_days").notNull(),
  preferredTimeWindow: jsonb("preferred_time_window").notNull(),
  matchCount: integer("match_count").notNull().default(0),
  topMatch: text("top_match"),
  results: jsonb("results"),
  starredSelections: jsonb("starred_selections"), // Persisted starred CP map { key: { employeeName, timeWindow, gender, transportMode } }
  visits: jsonb("visits"), // Store the input criteria for all visits
  isMultiVisit: integer("is_multi_visit").default(0), // 0 for false, 1 for true
  visitDurationMinutes: integer("visit_duration_minutes").notNull().default(60),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  branchIdx: index("enquiry_branch_idx").on(table.branchId),
  createdAtIdx: index("enquiry_created_at_idx").on(table.createdAt),
}));

export const insertClientEnquirySchema = createInsertSchema(clientEnquiries).omit({
  id: true,
  createdAt: true,
});

export type InsertClientEnquiry = z.infer<typeof insertClientEnquirySchema>;
export type ClientEnquiry = typeof clientEnquiries.$inferSelect;

// CP Scheduled Visits - persisted from Guaranteed Hours Excel on each upload
// Used by BD Matcher to determine realistic departure points (90-min gap rule)
export const cpScheduledVisits = pgTable("cp_scheduled_visits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  branchId: varchar("branch_id").notNull().references(() => branches.id),
  cpName: text("cp_name").notNull(), // Normalized employee name (lowercase, sorted words)
  clientName: text("client_name").notNull(),
  clientLat: text("client_lat"),
  clientLng: text("client_lng"),
  clientPostcode: text("client_postcode"),
  date: text("date").notNull(), // yyyy-MM-dd
  startTime: text("start_time").notNull(), // HH:MM
  endTime: text("end_time").notNull(), // HH:MM
}, (table) => ({
  branchDateIdx: index("cp_visit_branch_date_idx").on(table.branchId, table.date),
  branchCpIdx: index("cp_visit_branch_cp_idx").on(table.branchId, table.cpName),
}));

export const insertCpScheduledVisitSchema = createInsertSchema(cpScheduledVisits).omit({
  id: true,
});

export type InsertCpScheduledVisit = z.infer<typeof insertCpScheduledVisitSchema>;
export type CpScheduledVisit = typeof cpScheduledVisits.$inferSelect;

// GH Client Visits - client-demand visits parsed from GH Excel at processing time.
// Replaces per-request Excel parsing for /api/visits/:date and /api/visits/week/:weekStart.
// 8-week rolling retention mirrors cpScheduledVisits.
export const ghClientVisits = pgTable("gh_client_visits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  branchId: varchar("branch_id").notNull().references(() => branches.id),
  clientName: text("client_name").notNull(),
  date: text("date").notNull(),            // yyyy-MM-dd
  startTime: text("start_time").notNull(), // HH:MM
  endTime: text("end_time").notNull(),     // HH:MM
  durationMinutes: integer("duration_minutes").notNull(),
  serviceType: text("service_type"),
  priority: integer("priority").default(1),
  lat: text("lat"),
  lng: text("lng"),
  postcode: text("postcode"),
}, (table) => ({
  branchDateIdx: index("gh_visit_branch_date_idx").on(table.branchId, table.date),
}));

export const insertGhClientVisitSchema = createInsertSchema(ghClientVisits).omit({ id: true });
export type InsertGhClientVisit = z.infer<typeof insertGhClientVisitSchema>;
export type GhClientVisit = typeof ghClientVisits.$inferSelect;

// ── Feedback / Bug reports ────────────────────────────────────────────────────

export const feedbackTypes = ['bug', 'general'] as const;
export type FeedbackType = typeof feedbackTypes[number];

export const feedback = pgTable("feedback", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull().default('bug'),
  title: text("title").notNull(),
  description: text("description").notNull(),
  stepsToReproduce: text("steps_to_reproduce"),
  submittedByEmail: text("submitted_by_email").notNull(),
  branchId: varchar("branch_id"),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
}, (table) => ({
  submittedAtIdx: index("feedback_submitted_at_idx").on(table.submittedAt),
}));

export const insertFeedbackSchema = createInsertSchema(feedback).omit({
  id: true,
  submittedAt: true,
});

export type InsertFeedback = z.infer<typeof insertFeedbackSchema>;
export type Feedback = typeof feedback.$inferSelect;

// ── Capacity Outlook — Leavers ────────────────────────────────────────────────

export const leaverStatuses = ['active', 'processed'] as const;
export type LeaverStatus = typeof leaverStatuses[number];

export const employmentTypes = ['driver', 'walker'] as const;
export type EmploymentType = typeof employmentTypes[number];

export const leaverReasons = ['Resigned', 'Dismissed', 'End of Contract', 'Other'] as const;
export type LeaverReason = typeof leaverReasons[number];

export const leavers = pgTable("leavers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  branchId: varchar("branch_id").notNull().references(() => branches.id),
  employeeName: text("employee_name").notNull(),
  employeeNo: text("employee_no"),
  gender: text("gender", { enum: ["male", "female", "other"] }),
  employmentType: text("employment_type", { enum: ["driver", "walker"] }).notNull(),
  weeklyHours: real("weekly_hours").notNull(),
  contractedHours: real("contracted_hours"),
  postcode: text("postcode"),
  firstDayOfNotice: text("first_day_of_notice"),
  lastWorkingDay: text("last_working_day").notNull(),
  notes: text("notes"),
  status: text("status", { enum: ["active", "processed"] }).notNull().default("active"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  branchIdx: index("leaver_branch_idx").on(table.branchId),
  lastWorkingDayIdx: index("leaver_lwd_idx").on(table.lastWorkingDay),
}));

export const insertLeaverSchema = createInsertSchema(leavers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  employmentType: z.enum(["driver", "walker"]),
  weeklyHours: z.number().nonnegative(),
  contractedHours: z.number().nonnegative().optional().nullable(),
  status: z.enum(["active", "processed"]).default("active"),
});

export type InsertLeaver = z.infer<typeof insertLeaverSchema>;
export type Leaver = typeof leavers.$inferSelect;

// ── Capacity Outlook — Joiners ────────────────────────────────────────────────

export const joinerMilestones = ['Onboarding', 'Training Attended', 'PVG', 'REF1', 'REF2', 'Hired'] as const;
export type JoinerMilestone = typeof joinerMilestones[number];

export const joinerStages = [...joinerMilestones, 'Dropped'] as const;
export type JoinerStage = typeof joinerStages[number];

export const joinerStatuses = ['active', 'dropped', 'hired', 'hired_archived'] as const;
export type JoinerStatus = typeof joinerStatuses[number];

export const joiners = pgTable("joiners", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  branchId: varchar("branch_id").notNull().references(() => branches.id),
  candidateName: text("candidate_name").notNull(),
  gender: text("gender", { enum: ["male", "female", "other"] }),
  employmentType: text("employment_type", { enum: ["driver", "walker"] }).notNull(),
  desiredWeeklyHours: real("desired_weekly_hours").notNull(),
  contractedHours: real("contracted_hours"),
  postcode: text("postcode"),
  trainingDate: text("training_date"),
  expectedStartDate: text("expected_start_date"),
  completedStages: text("completed_stages").array(),
  stage: text("stage").notNull(),
  status: text("status", { enum: ["active", "dropped", "hired", "hired_archived"] }).notNull().default("active"),
  hiredAt: text("hired_at"),
  confidenceWeight: real("confidence_weight").notNull(),
  availability: text("availability"),
  notes: text("notes"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  branchIdx: index("joiner_branch_idx").on(table.branchId),
}));

export const insertJoinerSchema = createInsertSchema(joiners).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  confidenceWeight: true,
}).extend({
  employmentType: z.enum(["driver", "walker"]),
  desiredWeeklyHours: z.number().nonnegative(),
  contractedHours: z.number().nonnegative().optional().nullable(),
  postcode: z.string().optional().nullable(),
  completedStages: z.array(z.string()).default([]),
  stage: z.enum(joinerStages).optional(),
  status: z.enum(["active", "dropped", "hired", "hired_archived"]).default("active"),
  expectedStartDate: z.string().optional().nullable(),
  hiredAt: z.string().optional().nullable(),
  availability: z.string().optional().nullable(),
});

export type InsertJoiner = z.infer<typeof insertJoinerSchema>;
export type Joiner = typeof joiners.$inferSelect;

// ── Capacity Outlook — Monthly Snapshots ─────────────────────────────────────

export const monthlyCapacitySnapshots = pgTable("monthly_capacity_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  branchId: varchar("branch_id").notNull().references(() => branches.id),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  hoursIn: real("hours_in").notNull().default(0),
  headsIn: integer("heads_in").notNull().default(0),
  hoursOut: real("hours_out").notNull().default(0),
  headsOut: integer("heads_out").notNull().default(0),
  femaleHoursIn: real("female_hours_in"),
  maleHoursIn: real("male_hours_in"),
  femaleHeadsIn: integer("female_heads_in"),
  maleHeadsIn: integer("male_heads_in"),
  femaleHoursOut: real("female_hours_out"),
  maleHoursOut: real("male_hours_out"),
  femaleHeadsOut: integer("female_heads_out"),
  maleHeadsOut: integer("male_heads_out"),
  snapshotCreatedAt: timestamp("snapshot_created_at").defaultNow().notNull(),
}, (table) => ({
  uniqueMonthBranch: unique("unique_month_branch").on(table.branchId, table.year, table.month),
  snapshotBranchIdx: index("snapshot_branch_idx").on(table.branchId),
}));

export const insertMonthlySnapshotSchema = createInsertSchema(monthlyCapacitySnapshots).omit({
  id: true,
  snapshotCreatedAt: true,
}).extend({
  hoursIn: z.number().nonnegative().default(0),
  headsIn: z.number().int().nonnegative().default(0),
  hoursOut: z.number().nonnegative().default(0),
  headsOut: z.number().int().nonnegative().default(0),
});

export type InsertMonthlySnapshot = z.infer<typeof insertMonthlySnapshotSchema>;
export type MonthlySnapshot = typeof monthlyCapacitySnapshots.$inferSelect;

// ── Capacity Outlook — computed types ────────────────────────────────────────

export type OutlookRag = 'green' | 'amber' | 'red';

export interface OutlookWeek {
  weekStart: string;
  weekEnd: string;
  label: string;
  hoursLost: number;
  hoursGained: number;
  netChange: number;
  coverage: number;
  rag: OutlookRag;
}

export interface OutlookTotals {
  hoursLost: number;
  hoursGained: number;
  netChange: number;
  coverage: number;
  rag: OutlookRag;
}

export interface OutlookResponse {
  weeks: OutlookWeek[];
  totals: OutlookTotals;
  computedAt: string;
}

export interface OutlookDetail {
  leavers: Leaver[];
  joiners: Joiner[];
}

// ── HR Calendar — per-employee daily status log ───────────────────────────────

export const hrCalendarSources = ['processed', 'manual'] as const;
export type HrCalendarSource = typeof hrCalendarSources[number];

export const employeeHrCalendar = pgTable("employee_hr_calendar", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  branchId: varchar("branch_id").notNull().references(() => branches.id),
  employeeKey: text("employee_key").notNull(),
  employeeName: text("employee_name").notNull(),
  date: text("date").notNull(),
  status: text("status").notNull(),
  source: text("source", { enum: ["processed", "manual"] }).notNull().default("processed"),
  notes: text("notes"),
  contractedHours: real("contracted_hours"),
  transportMode: text("transport_mode"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueHrCalEntry: unique("unique_hr_cal_entry").on(table.branchId, table.employeeKey, table.date),
  hrCalBranchIdx: index("hr_cal_branch_idx").on(table.branchId),
  hrCalDateIdx: index("hr_cal_date_idx").on(table.date),
  hrCalBranchDateIdx: index("hr_cal_branch_date_idx").on(table.branchId, table.date),
}));

export const insertHrCalendarSchema = createInsertSchema(employeeHrCalendar).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertHrCalendar = z.infer<typeof insertHrCalendarSchema>;
export type HrCalendar = typeof employeeHrCalendar.$inferSelect;

// ── Leaver Report Recipients ──────────────────────────────────────────────────

export const leaverReportRecipients = pgTable("leaver_report_recipients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  addedAt: timestamp("added_at").defaultNow().notNull(),
});

export const insertLeaverReportRecipientSchema = createInsertSchema(leaverReportRecipients).omit({
  id: true,
  addedAt: true,
}).extend({
  email: z.string().email('Must be a valid email address'),
});

export type InsertLeaverReportRecipient = z.infer<typeof insertLeaverReportRecipientSchema>;
export type LeaverReportRecipient = typeof leaverReportRecipients.$inferSelect;
