import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb, unique, index, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Historical data storage tables
export const capacityAnalyses = pgTable("capacity_analyses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  weekStartDate: text("week_start_date").notNull(),
  weekEndDate: text("week_end_date").notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  kpis: jsonb("kpis").notNull(),
  dailySummary: jsonb("daily_summary").notNull(),
  employeesByDate: jsonb("employees_by_date").notNull(),
  employeeSummaryByDate: jsonb("employee_summary_by_date").notNull().default({}),
  warnings: jsonb("warnings").default([]),
}, (table) => ({
  // Unique constraint to prevent duplicate weeks
  uniqueWeek: unique("unique_week").on(table.weekStartDate, table.weekEndDate),
  // Indexes for efficient querying
  weekStartIdx: index("week_start_idx").on(table.weekStartDate),
  uploadedAtIdx: index("uploaded_at_idx").on(table.uploadedAt),
}));

export const insertCapacityAnalysisSchema = createInsertSchema(capacityAnalyses).omit({
  id: true,
  uploadedAt: true,
});

export type InsertCapacityAnalysis = z.infer<typeof insertCapacityAnalysisSchema>;
export type CapacityAnalysis = typeof capacityAnalyses.$inferSelect;

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

// Raw Excel data interfaces
export interface AvailabilityRow {
  "CAREGiver Name": string;
  "Start Date": string;
  "Start Time": string;
  "End Time": string;
  "Type": string;
  "Hours"?: number;
  "Notes"?: string;
}

export interface GuaranteedHoursRow {
  "Actual Employee Name": string;
  "Actual Employee Hours Per Week": number;
  "Actual Pay Rate Hours": number;
  "Service Requirement Start Date And Time": string;
  "Service Requirement End Date And Time": string;
  "Actual Service Type Description"?: string;
  "Cancellation Description"?: string;
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
  holidays: number;
  clientRequired: number;
  gap: number;
  status: "Sufficient" | "Shortage";
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

export interface ProcessingResult {
  kpis: {
    netCapacitySum: number;
    clientRequiredSum: number;
    gapSum: number;
    unavailabilitySum: number;
    holidaysSum: number;
  };
  dailySummary: DailySummaryRecord[];
  employeesByDate: Record<string, EmployeeDailyDetail[]>;
  employeeSummaryByDate: Record<string, EmployeeSummaryRecord[]>;
  warnings?: string[];
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
  employeeName: text("employee_name").notNull(),
  homePostcode: text("home_postcode").notNull(),
  homeLat: text("home_lat"),
  homeLng: text("home_lng"),
  transportMode: text("transport_mode", { enum: ["car", "walking", "public"] }).default("car"),
  geocodedAt: timestamp("geocoded_at"),
}, (table) => ({
  employeeNameIdx: index("employee_name_idx").on(table.employeeName),
  postcodeIdx: index("postcode_idx").on(table.homePostcode),
}));

// Client location data
export const clientLocations = pgTable("client_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientName: text("client_name").notNull(),
  addressLine: text("address_line").notNull(),
  postcode: text("postcode").notNull(),
  lat: text("lat"),
  lng: text("lng"),
  geocodedAt: timestamp("geocoded_at"),
}, (table) => ({
  clientNameIdx: index("client_name_idx").on(table.clientName),
  postcodeIdx: index("client_postcode_idx").on(table.postcode),
}));

// Visit requirements
export const visits = pgTable("visits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clientLocations.id),
  date: text("date").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  preferredStartTime: text("preferred_start_time"),
  preferredEndTime: text("preferred_end_time"),
  priority: integer("priority").default(1),
  serviceType: text("service_type"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  dateIdx: index("visit_date_idx").on(table.date),
  clientDateIdx: index("visit_client_date_idx").on(table.clientId, table.date),
}));

// Route plans
export const routePlans = pgTable("route_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: text("date").notNull(),
  employeeId: varchar("employee_id").notNull().references(() => employeeLocations.id),
  totalDistanceKm: text("total_distance_km"),
  totalTravelMinutes: integer("total_travel_minutes"),
  status: text("status", { enum: ["optimized", "manual", "infeasible"] }).default("optimized"),
  warnings: jsonb("warnings").default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
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
  key: text("key").notNull().unique(),
  lat: text("lat").notNull(),
  lng: text("lng").notNull(),
  source: text("source").notNull(),
  cachedAt: timestamp("cached_at").defaultNow().notNull(),
}, (table) => ({
  keyIdx: index("geocode_key_idx").on(table.key),
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
  createdAt: true,
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
