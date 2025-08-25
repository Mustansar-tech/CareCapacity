import { sql } from "drizzle-orm";
import { pgTable, text, varchar } from "drizzle-orm/pg-core";
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
}

export interface ClientDemandRow {
  "Date": string;
  "Required Client Hours": number;
}

// Processed data interfaces
export interface CleanedEmployeeRecord {
  employeeName: string;
  contractedWeeklyHours: number;
  contractedDailyHours: number;
  date: string;
  status: string;
  timeWindows: string;
  hours: number;
  netCapacity: number;
  notes: string;
}

export interface DailySummaryRecord {
  date: string;
  availableHours: number;
  netCapacity: number;
  sickness: number;
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
  hours: number;
  netCapacity: number;
  notes: string;
}

export interface ProcessingResult {
  kpis: {
    netCapacitySum: number;
    clientRequiredSum: number;
    gapSum: number;
    sicknessSum: number;
    holidaysSum: number;
  };
  dailySummary: DailySummaryRecord[];
  employeesByDate: Record<string, EmployeeDailyDetail[]>;
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
});

export const clientDemandSchema = z.object({
  "Date": z.string().min(1, "Date is required"),
  "Required Client Hours": z.number().min(0, "Required hours must be non-negative"),
});
