import {
  type User,
  type InsertUser,
  type CapacityAnalysis,
  type InsertCapacityAnalysis,
  type EmployeeLocation,
  type InsertEmployeeLocation,
  type ClientLocation,
  type InsertClientLocation,
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

  // Capacity analysis methods
  saveCapacityAnalysis(analysis: InsertCapacityAnalysis): Promise<CapacityAnalysis>;
  getCapacityAnalysesByDateRange(startDate: string, endDate: string): Promise<CapacityAnalysis[]>;
  getAllCapacityAnalyses(): Promise<CapacityAnalysis[]>;
  getCapacityAnalyses(): Promise<CapacityAnalysis[]>; // Alias for getAllCapacityAnalyses
  getLatestCapacityAnalysis(): Promise<CapacityAnalysis | undefined>;
  getLatestWeeksAnalyses(limit?: number): Promise<CapacityAnalysis[]>;
  enforceRetentionLatestWeeks(limit?: number): Promise<number>;
  cleanupOldAnalyses(monthsOld: number): Promise<number>;

  // Geographical scheduling methods
  upsertEmployeeLocation(location: InsertEmployeeLocation): Promise<EmployeeLocation>;
  getEmployeeLocationByName(employeeName: string): Promise<EmployeeLocation | undefined>;
  getEmployeeLocationById(id: string): Promise<EmployeeLocation | undefined>;
  getAllEmployeeLocations(): Promise<EmployeeLocation[]>;

  upsertClientLocation(location: InsertClientLocation): Promise<ClientLocation>;
  getClientLocationByName(clientName: string): Promise<ClientLocation | undefined>;
  getClientLocationById(id: string): Promise<ClientLocation | undefined>;
  getAllClientLocations(): Promise<ClientLocation[]>;



  getGeocode(key: string): Promise<GeocodeCache | undefined>;
  saveGeocode(geocode: InsertGeocode): Promise<GeocodeCache>;

  // Weekly schedule methods
  saveWeeklySchedule(schedule: InsertWeeklySchedule): Promise<WeeklySchedule>;
  getLatestWeeklySchedule(): Promise<WeeklySchedule | undefined>;
  getWeeklyScheduleByWeek(weekStartDate: string, weekEndDate: string): Promise<WeeklySchedule | undefined>;
  getAllWeeklySchedules(): Promise<WeeklySchedule[]>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private capacityAnalyses: Map<string, CapacityAnalysis>;
  private employeeLocations: Map<string, EmployeeLocation>;
  private clientLocations: Map<string, ClientLocation>;
  private geocodeCache: Map<string, GeocodeCache>;
  private weeklySchedules: Map<string, WeeklySchedule>;

  constructor() {
    this.users = new Map();
    this.capacityAnalyses = new Map();
    this.employeeLocations = new Map();
    this.clientLocations = new Map();
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

  async getCapacityAnalysesByDateRange(startDate: string, endDate: string): Promise<CapacityAnalysis[]> {
    return Array.from(this.capacityAnalyses.values()).filter(
      (analysis) => analysis.weekStartDate >= startDate && analysis.weekEndDate <= endDate
    );
  }


  async getAllCapacityAnalyses(): Promise<CapacityAnalysis[]> {
    return Array.from(this.capacityAnalyses.values()).sort(
      (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );
  }

  async getCapacityAnalyses(): Promise<CapacityAnalysis[]> {
    return this.getAllCapacityAnalyses();
  }

  async getLatestCapacityAnalysis(): Promise<CapacityAnalysis | undefined> {
    const analyses = await this.getAllCapacityAnalyses();
    return analyses[0];
  }

  async getLatestWeeksAnalyses(limit: number = 4): Promise<CapacityAnalysis[]> {
    // Group by week, then get the latest analysis per week, then take the latest N weeks
    const weekMap = new Map<string, CapacityAnalysis>();

    Array.from(this.capacityAnalyses.values()).forEach(analysis => {
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

  async enforceRetentionLatestWeeks(limit: number = 4): Promise<number> {
    // Group by week and keep only the latest N weeks
    const weekMap = new Map<string, CapacityAnalysis[]>();

    Array.from(this.capacityAnalyses.values()).forEach(analysis => {
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


  async cleanupOldAnalyses(monthsOld: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsOld);
    const cutoffString = cutoffDate.toISOString().split('T')[0];

    const oldAnalyses = Array.from(this.capacityAnalyses.values()).filter(
      analysis => new Date(analysis.uploadedAt).toISOString().split('T')[0] < cutoffString
    );

    oldAnalyses.forEach(analysis => {
      this.capacityAnalyses.delete(analysis.id);
    });

    return oldAnalyses.length;
  }

  // Geographical scheduling method implementations
  async upsertEmployeeLocation(insertLocation: InsertEmployeeLocation): Promise<EmployeeLocation> {
    // Check if employee already exists
    const existing = Array.from(this.employeeLocations.values()).find(
      loc => loc.employeeName === insertLocation.employeeName
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
        geocodedAt: insertLocation.homeLat && insertLocation.homeLng ? new Date() : null,
      };
      this.employeeLocations.set(id, location);
      return location;
    }
  }

  async getEmployeeLocationByName(employeeName: string): Promise<EmployeeLocation | undefined> {
    return Array.from(this.employeeLocations.values()).find(
      loc => loc.employeeName === employeeName
    );
  }

  async getEmployeeLocationById(id: string): Promise<EmployeeLocation | undefined> {
    return this.employeeLocations.get(id);
  }

  async getAllEmployeeLocations(): Promise<EmployeeLocation[]> {
    return Array.from(this.employeeLocations.values());
  }

  async upsertClientLocation(insertLocation: InsertClientLocation): Promise<ClientLocation> {
    // Check if client already exists
    const existing = Array.from(this.clientLocations.values()).find(
      loc => loc.clientName === insertLocation.clientName
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

  async getClientLocationByName(clientName: string): Promise<ClientLocation | undefined> {
    return Array.from(this.clientLocations.values()).find(
      loc => loc.clientName === clientName
    );
  }

  async getClientLocationById(id: string): Promise<ClientLocation | undefined> {
    return this.clientLocations.get(id);
  }

  async getAllClientLocations(): Promise<ClientLocation[]> {
    return Array.from(this.clientLocations.values());
  }



  async getGeocode(key: string): Promise<GeocodeCache | undefined> {
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



  // Weekly schedule methods
  async saveWeeklySchedule(insertSchedule: InsertWeeklySchedule): Promise<WeeklySchedule> {
    // Remove existing entry with same week dates for deduplication
    const existingEntry = Array.from(this.weeklySchedules.values()).find(
      schedule => schedule.weekStartDate === insertSchedule.weekStartDate &&
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

  async getLatestWeeklySchedule(): Promise<WeeklySchedule | undefined> {
    const schedules = Array.from(this.weeklySchedules.values()).sort(
      (a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
    );
    return schedules[0];
  }

  async getWeeklyScheduleByWeek(weekStartDate: string, weekEndDate: string): Promise<WeeklySchedule | undefined> {
    return Array.from(this.weeklySchedules.values()).find(
      schedule => schedule.weekStartDate === weekStartDate && schedule.weekEndDate === weekEndDate
    );
  }

  async getAllWeeklySchedules(): Promise<WeeklySchedule[]> {
    return Array.from(this.weeklySchedules.values()).sort(
      (a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
    );
  }
}

// Switch to database storage in production
import { db } from "./db";
import {
  users,
  capacityAnalyses,
  employeeLocations,
  clientLocations,
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

  async saveCapacityAnalysis(insertAnalysis: InsertCapacityAnalysis): Promise<CapacityAnalysis> {
    // Use upsert to replace existing week data with new data
    const [analysis] = await db
      .insert(capacityAnalyses)
      .values({
        ...insertAnalysis,
        employeeSummaryByDate: insertAnalysis.employeeSummaryByDate || {},
        warnings: insertAnalysis.warnings || [],
      })
      .onConflictDoUpdate({
        target: [capacityAnalyses.weekStartDate, capacityAnalyses.weekEndDate],
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
    await this.enforceSimpleRetention(3);

    return analysis;
  }

  async getCapacityAnalysesByDateRange(startDate: string, endDate: string): Promise<CapacityAnalysis[]> {
    return await db
      .select()
      .from(capacityAnalyses)
      .where(and(
        gte(capacityAnalyses.weekStartDate, startDate),
        lte(capacityAnalyses.weekEndDate, endDate)
      ))
      .orderBy(desc(capacityAnalyses.uploadedAt));
  }


  async getAllCapacityAnalyses(): Promise<CapacityAnalysis[]> {
    // Return deduplicated results using window function with proper column aliasing
    return await db.execute(sql`
      SELECT DISTINCT ON (week_start_date, week_end_date)
             id,
             week_start_date AS "weekStartDate",
             week_end_date AS "weekEndDate",
             uploaded_at AS "uploadedAt",
             kpis,
             daily_summary AS "dailySummary",
             employees_by_date AS "employeesByDate",
             employee_summary_by_date AS "employeeSummaryByDate",
             warnings
      FROM capacity_analyses
      ORDER BY week_start_date DESC, week_end_date DESC, uploaded_at DESC
    `).then(result => result.rows as CapacityAnalysis[]);
  }

  async getCapacityAnalyses(): Promise<CapacityAnalysis[]> {
    return this.getAllCapacityAnalyses();
  }

  async getLatestWeeksAnalyses(limit: number = 4): Promise<CapacityAnalysis[]> {
    // Get the latest record for each of the latest N weeks with proper column aliasing
    return await db.execute(sql`
      WITH latest_per_week AS (
        SELECT *,
               ROW_NUMBER() OVER (
                 PARTITION BY week_start_date, week_end_date
                 ORDER BY uploaded_at DESC
               ) as rn
        FROM capacity_analyses
      ),
      week_ranking AS (
        SELECT *,
               ROW_NUMBER() OVER (ORDER BY week_start_date DESC) as week_rank
        FROM latest_per_week
        WHERE rn = 1
      )
      SELECT id,
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

  async enforceRetentionLatestWeeks(limit: number = 4): Promise<number> {
    // Delete all but the latest record for each week, and keep only latest N weeks
    const result = await db.execute(sql`
      WITH week_ranks AS (
        SELECT DISTINCT week_start_date, week_end_date,
               ROW_NUMBER() OVER (ORDER BY week_start_date DESC) as week_rank
        FROM capacity_analyses
      ),
      records_to_keep AS (
        SELECT ca.id
        FROM capacity_analyses ca
        INNER JOIN week_ranks wr ON ca.week_start_date = wr.week_start_date
                                 AND ca.week_end_date = wr.week_end_date
        WHERE wr.week_rank <= ${limit}
          AND ca.id IN (
            SELECT id FROM (
              SELECT id,
                     ROW_NUMBER() OVER (
                       PARTITION BY week_start_date, week_end_date
                       ORDER BY uploaded_at DESC
                     ) as rn
              FROM capacity_analyses
            ) ranked WHERE rn = 1
          )
      )
      DELETE FROM capacity_analyses
      WHERE id NOT IN (SELECT id FROM records_to_keep)
    `);

    return result.rowCount || 0;
  }

  async enforceSimpleRetention(monthsToKeep: number = 3): Promise<number> {
    // Simple retention: keep all weeks for N months, removing duplicates (keep latest per week)
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
        WHERE week_start_date >= ${cutoffString}  -- Only keep weeks from last 3 months
      ),
      records_to_keep AS (
        SELECT id
        FROM latest_per_week
        WHERE rn = 1  -- Keep only latest per week
      )
      DELETE FROM capacity_analyses
      WHERE id NOT IN (SELECT id FROM records_to_keep)
    `);

    return result.rowCount || 0;
  }


  async getLatestCapacityAnalysis(): Promise<CapacityAnalysis | undefined> {
    const [analysis] = await db
      .select()
      .from(capacityAnalyses)
      .orderBy(desc(capacityAnalyses.uploadedAt))
      .limit(1);
    return analysis || undefined;
  }

  async cleanupOldAnalyses(monthsOld: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsOld);

    const result = await db
      .delete(capacityAnalyses)
      .where(lte(capacityAnalyses.uploadedAt, cutoffDate))
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
        geocodedAt: insertLocation.homeLat && insertLocation.homeLng ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: employeeLocations.employeeName,
        set: {
          homePostcode: insertLocation.homePostcode,
          homeLat: insertLocation.homeLat || null,
          homeLng: insertLocation.homeLng || null,
          transportMode: insertLocation.transportMode || "car",
          geocodedAt: insertLocation.homeLat && insertLocation.homeLng ? new Date() : null,
        },
      })
      .returning();
    return location;
  }

  async getEmployeeLocationByName(employeeName: string): Promise<EmployeeLocation | undefined> {
    const [location] = await db
      .select()
      .from(employeeLocations)
      .where(eq(employeeLocations.employeeName, employeeName));
    return location || undefined;
  }

  async getEmployeeLocationById(id: string): Promise<EmployeeLocation | undefined> {
    const [location] = await db
      .select()
      .from(employeeLocations)
      .where(eq(employeeLocations.id, id));
    return location || undefined;
  }

  async getAllEmployeeLocations(): Promise<EmployeeLocation[]> {
    return await db.select().from(employeeLocations);
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
        target: clientLocations.clientName,
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

  async getClientLocationByName(clientName: string): Promise<ClientLocation | undefined> {
    const [location] = await db
      .select()
      .from(clientLocations)
      .where(eq(clientLocations.clientName, clientName));
    return location || undefined;
  }

  async getClientLocationById(id: string): Promise<ClientLocation | undefined> {
    const [location] = await db
      .select()
      .from(clientLocations)
      .where(eq(clientLocations.id, id));
    return location || undefined;
  }

  async getAllClientLocations(): Promise<ClientLocation[]> {
    return await db.select().from(clientLocations);
  }



  async getGeocode(key: string): Promise<GeocodeCache | undefined> {
    const [geocode] = await db
      .select()
      .from(geocodeCache)
      .where(eq(geocodeCache.key, key));
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
      return (await this.getGeocode(insertGeocode.key))!;
    }

    return geocode;
  }



  // Weekly schedule methods
  async saveWeeklySchedule(insertSchedule: InsertWeeklySchedule): Promise<WeeklySchedule> {
    const [schedule] = await db
      .insert(weeklySchedules)
      .values({
        ...insertSchedule,
        unallocatedVisits: insertSchedule.unallocatedVisits || [],
      })
      .onConflictDoUpdate({
        target: [weeklySchedules.weekStartDate, weeklySchedules.weekEndDate],
        set: {
          scheduleData: insertSchedule.scheduleData,
          unallocatedVisits: insertSchedule.unallocatedVisits || [],
          metrics: insertSchedule.metrics,
          generatedAt: sql`now()`,
        },
      })
      .returning();

    return schedule;
  }

  async getLatestWeeklySchedule(): Promise<WeeklySchedule | undefined> {
    const [schedule] = await db
      .select()
      .from(weeklySchedules)
      .orderBy(desc(weeklySchedules.generatedAt))
      .limit(1);
    return schedule || undefined;
  }

  async getWeeklyScheduleByWeek(weekStartDate: string, weekEndDate: string): Promise<WeeklySchedule | undefined> {
    const [schedule] = await db
      .select()
      .from(weeklySchedules)
      .where(and(
        eq(weeklySchedules.weekStartDate, weekStartDate),
        eq(weeklySchedules.weekEndDate, weekEndDate)
      ));
    return schedule || undefined;
  }

  async getAllWeeklySchedules(): Promise<WeeklySchedule[]> {
    return await db
      .select()
      .from(weeklySchedules)
      .orderBy(desc(weeklySchedules.generatedAt));
  }
}

export const storage = process.env.DATABASE_URL ? new DatabaseStorage() : new MemStorage();