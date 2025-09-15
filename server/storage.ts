import { type User, type InsertUser, type CapacityAnalysis, type InsertCapacityAnalysis } from "@shared/schema";
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
  getCapacityAnalysesByMonth(year: number, month: number): Promise<CapacityAnalysis[]>;
  getAllCapacityAnalyses(): Promise<CapacityAnalysis[]>;
  getLatestCapacityAnalysis(): Promise<CapacityAnalysis | undefined>;
  getLatestWeeksAnalyses(limit?: number): Promise<CapacityAnalysis[]>;
  enforceRetentionLatestWeeks(limit?: number): Promise<number>;
  enforceRetentionByMonth(weeksPerMonth?: number, monthsToKeep?: number): Promise<number>;
  cleanupOldAnalyses(monthsOld: number): Promise<number>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private capacityAnalyses: Map<string, CapacityAnalysis>;

  constructor() {
    this.users = new Map();
    this.capacityAnalyses = new Map();
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
    
    // Automatically enforce retention after saving
    await this.enforceRetentionLatestWeeks(4);
    
    return analysis;
  }

  async getCapacityAnalysesByDateRange(startDate: string, endDate: string): Promise<CapacityAnalysis[]> {
    return Array.from(this.capacityAnalyses.values()).filter(
      (analysis) => analysis.weekStartDate >= startDate && analysis.weekEndDate <= endDate
    );
  }

  async getCapacityAnalysesByMonth(year: number, month: number): Promise<CapacityAnalysis[]> {
    const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
    const endDate = new Date(year, month, 0).toISOString().split('T')[0]; // Last day of month
    const allAnalyses = await this.getCapacityAnalysesByDateRange(startDate, endDate);
    
    // Return only the latest 4 weeks to prevent showing too many results
    const sortedAnalyses = allAnalyses.sort(
      (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );
    return sortedAnalyses.slice(0, 4);
  }

  async getAllCapacityAnalyses(): Promise<CapacityAnalysis[]> {
    return Array.from(this.capacityAnalyses.values()).sort(
      (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );
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
    sortedWeeks.slice(limit).forEach(([weekKey, analyses]) => {
      analyses.forEach(analysis => {
        this.capacityAnalyses.delete(analysis.id);
        deletedCount++;
      });
    });
    
    // For remaining weeks, keep only the latest analysis per week
    sortedWeeks.slice(0, limit).forEach(([weekKey, analyses]) => {
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

  async enforceRetentionByMonth(weeksPerMonth: number = 4, monthsToKeep: number = 3): Promise<number> {
    // Group analyses by month-year, handling cross-month weeks
    const monthMap = new Map<string, CapacityAnalysis[]>();
    
    Array.from(this.capacityAnalyses.values()).forEach(analysis => {
      const weekStartDate = new Date(analysis.weekStartDate);
      const weekEndDate = new Date(analysis.weekEndDate);
      
      // Add week to all months it touches (start and end month)
      const startMonthKey = `${weekStartDate.getFullYear()}-${String(weekStartDate.getMonth() + 1).padStart(2, '0')}`;
      const endMonthKey = `${weekEndDate.getFullYear()}-${String(weekEndDate.getMonth() + 1).padStart(2, '0')}`;
      
      // Add to start month
      if (!monthMap.has(startMonthKey)) {
        monthMap.set(startMonthKey, []);
      }
      monthMap.get(startMonthKey)!.push(analysis);
      
      // Add to end month if different (cross-month week)
      if (startMonthKey !== endMonthKey) {
        if (!monthMap.has(endMonthKey)) {
          monthMap.set(endMonthKey, []);
        }
        monthMap.get(endMonthKey)!.push(analysis);
      }
    });
    
    // Sort months by date descending (keep latest N months)
    const sortedMonths = Array.from(monthMap.entries())
      .sort(([a], [b]) => b.localeCompare(a)); // String comparison works for YYYY-MM format
    
    let deletedCount = 0;
    
    // Get months to keep (latest N months)
    const monthsToKeepSet = new Set(sortedMonths.slice(0, monthsToKeep).map(([monthKey]) => monthKey));
    
    // Delete analyses that don't touch any of the months we're keeping
    Array.from(this.capacityAnalyses.values()).forEach(analysis => {
      const weekStartDate = new Date(analysis.weekStartDate);
      const weekEndDate = new Date(analysis.weekEndDate);
      
      const startMonthKey = `${weekStartDate.getFullYear()}-${String(weekStartDate.getMonth() + 1).padStart(2, '0')}`;
      const endMonthKey = `${weekEndDate.getFullYear()}-${String(weekEndDate.getMonth() + 1).padStart(2, '0')}`;
      
      // Keep week if it touches any month we're keeping
      const shouldKeep = monthsToKeepSet.has(startMonthKey) || monthsToKeepSet.has(endMonthKey);
      
      if (!shouldKeep) {
        this.capacityAnalyses.delete(analysis.id);
        deletedCount++;
      }
    });
    
    // Now handle within-month week limits and deduplication for remaining data
    const remainingAnalyses = Array.from(this.capacityAnalyses.values());
    
    // Group remaining weeks by their primary month (month with more days)
    const primaryMonthMap = new Map<string, CapacityAnalysis[]>();
    
    remainingAnalyses.forEach(analysis => {
      const weekStartDate = new Date(analysis.weekStartDate);
      const weekEndDate = new Date(analysis.weekEndDate);
      
      // Determine primary month (where most days fall)
      const startMonth = weekStartDate.getMonth();
      const endMonth = weekEndDate.getMonth();
      
      let primaryMonthKey: string;
      if (startMonth === endMonth) {
        // Week within single month
        primaryMonthKey = `${weekStartDate.getFullYear()}-${String(startMonth + 1).padStart(2, '0')}`;
      } else {
        // Cross-month week - assign to month with more days
        const startDaysInMonth = new Date(weekStartDate.getFullYear(), startMonth + 1, 0).getDate();
        const startDay = weekStartDate.getDate();
        const daysInStartMonth = startDaysInMonth - startDay + 1;
        const daysInEndMonth = weekEndDate.getDate();
        
        if (daysInStartMonth >= daysInEndMonth) {
          primaryMonthKey = `${weekStartDate.getFullYear()}-${String(startMonth + 1).padStart(2, '0')}`;
        } else {
          primaryMonthKey = `${weekEndDate.getFullYear()}-${String(endMonth + 1).padStart(2, '0')}`;
        }
      }
      
      if (!primaryMonthMap.has(primaryMonthKey)) {
        primaryMonthMap.set(primaryMonthKey, []);
      }
      primaryMonthMap.get(primaryMonthKey)!.push(analysis);
    });
    
    // For each month, keep only latest N weeks and deduplicate
    primaryMonthMap.forEach((analyses, monthKey) => {
      // Group by week within this month
      const weekMap = new Map<string, CapacityAnalysis[]>();
      
      analyses.forEach(analysis => {
        const weekKey = `${analysis.weekStartDate}-${analysis.weekEndDate}`;
        if (!weekMap.has(weekKey)) {
          weekMap.set(weekKey, []);
        }
        weekMap.get(weekKey)!.push(analysis);
      });
      
      // Sort weeks within month by start date descending
      const sortedWeeks = Array.from(weekMap.entries())
        .sort(([, analysesA], [, analysesB]) => {
          const dateA = new Date(analysesA[0].weekStartDate);
          const dateB = new Date(analysesB[0].weekStartDate);
          return dateB.getTime() - dateA.getTime();
        });
      
      // Delete weeks beyond the limit for this month
      sortedWeeks.slice(weeksPerMonth).forEach(([weekKey, weekAnalyses]) => {
        weekAnalyses.forEach(analysis => {
          if (this.capacityAnalyses.has(analysis.id)) {
            this.capacityAnalyses.delete(analysis.id);
            deletedCount++;
          }
        });
      });
      
      // For remaining weeks, keep only the latest analysis per week
      sortedWeeks.slice(0, weeksPerMonth).forEach(([weekKey, weekAnalyses]) => {
        if (weekAnalyses.length > 1) {
          const sortedAnalyses = weekAnalyses.sort((a, b) => 
            new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
          );
          // Delete all but the latest
          sortedAnalyses.slice(1).forEach(analysis => {
            if (this.capacityAnalyses.has(analysis.id)) {
              this.capacityAnalyses.delete(analysis.id);
              deletedCount++;
            }
          });
        }
      });
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
}

// Switch to database storage in production
import { db } from "./db";
import { users, capacityAnalyses } from "@shared/schema";
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
    
    // Automatically enforce retention after saving - keep latest 4 weeks per month for 3 months
    await this.enforceRetentionByMonth(4, 3);
    
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

  async getCapacityAnalysesByMonth(year: number, month: number): Promise<CapacityAnalysis[]> {
    const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
    const endDate = new Date(year, month, 0).toISOString().split('T')[0]; // Last day of month
    const allAnalyses = await this.getCapacityAnalysesByDateRange(startDate, endDate);
    
    // Return only the latest 4 weeks to prevent showing too many results
    return allAnalyses.slice(0, 4);
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

  async enforceRetentionByMonth(weeksPerMonth: number = 4, monthsToKeep: number = 3): Promise<number> {
    // Handle cross-month weeks properly - keep weeks that touch any of the retained months
    const result = await db.execute(sql`
      WITH month_bounds AS (
        -- Get the latest N months that have any weeks
        SELECT DISTINCT 
               DATE_TRUNC('month', week_start_date::date) AS month_start
        FROM capacity_analyses
        UNION
        SELECT DISTINCT 
               DATE_TRUNC('month', week_end_date::date) AS month_start
        FROM capacity_analyses
        ORDER BY month_start DESC
        LIMIT ${monthsToKeep}
      ),
      weeks_touching_kept_months AS (
        -- Keep weeks that touch any of the months we're keeping
        SELECT DISTINCT ca.*
        FROM capacity_analyses ca
        WHERE DATE_TRUNC('month', ca.week_start_date::date) IN (SELECT month_start FROM month_bounds)
           OR DATE_TRUNC('month', ca.week_end_date::date) IN (SELECT month_start FROM month_bounds)
      ),
      primary_month_assignment AS (
        -- Assign each week to its primary month (where most days fall)
        SELECT *,
               CASE 
                 WHEN DATE_TRUNC('month', week_start_date::date) = DATE_TRUNC('month', week_end_date::date) 
                 THEN DATE_TRUNC('month', week_start_date::date)
                 ELSE 
                   CASE 
                     WHEN (DATE_TRUNC('month', week_start_date::date) + INTERVAL '1 month' - week_start_date::date) 
                          >= (week_end_date::date - DATE_TRUNC('month', week_end_date::date))
                     THEN DATE_TRUNC('month', week_start_date::date)
                     ELSE DATE_TRUNC('month', week_end_date::date)
                   END
               END AS primary_month
        FROM weeks_touching_kept_months
      ),
      week_ranks_per_primary_month AS (
        SELECT *,
               ROW_NUMBER() OVER (
                 PARTITION BY week_start_date, week_end_date
                 ORDER BY uploaded_at DESC
               ) as week_duplicate_rank,
               ROW_NUMBER() OVER (
                 PARTITION BY primary_month
                 ORDER BY week_start_date DESC
               ) as week_rank_in_month
        FROM primary_month_assignment
      ),
      records_to_keep AS (
        SELECT id 
        FROM week_ranks_per_primary_month
        WHERE week_duplicate_rank = 1  -- Keep only latest per week
          AND week_rank_in_month <= ${weeksPerMonth}  -- Keep only latest N weeks per primary month
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
}

export const storage = process.env.DATABASE_URL ? new DatabaseStorage() : new MemStorage();
