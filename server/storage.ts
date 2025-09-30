import { eq, desc, gte, lte, and, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "./db";
import {
  capacityAnalyses,
  type CapacityAnalysis,
  type InsertCapacityAnalysis,
} from "@shared/schema";

export interface IStorage {
  // Capacity Analysis methods
  saveCapacityAnalysis(analysis: InsertCapacityAnalysis): Promise<CapacityAnalysis>;
  getCapacityAnalysis(id: string): Promise<CapacityAnalysis | undefined>;
  getCapacityAnalysesByDateRange(startDate: string, endDate: string): Promise<CapacityAnalysis[]>;
  getAllCapacityAnalyses(): Promise<CapacityAnalysis[]>;
  getLatestCapacityAnalysis(): Promise<CapacityAnalysis | undefined>;
  getLatestWeeksAnalyses(limit?: number): Promise<CapacityAnalysis[]>;
  enforceRetentionLatestWeeks(limit?: number): Promise<number>;
  cleanupOldAnalyses(monthsOld: number): Promise<number>;
}

export class MemStorage implements IStorage {
  private capacityAnalyses: Map<string, CapacityAnalysis>;

  constructor() {
    this.capacityAnalyses = new Map();
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
      id,
      ...insertAnalysis,
      employeeSummaryByDate: insertAnalysis.employeeSummaryByDate || {},
      warnings: insertAnalysis.warnings || [],
      uploadedAt: new Date(),
    };
    this.capacityAnalyses.set(id, analysis);
    return analysis;
  }

  async getCapacityAnalysis(id: string): Promise<CapacityAnalysis | undefined> {
    return this.capacityAnalyses.get(id);
  }

  async getCapacityAnalysesByDateRange(startDate: string, endDate: string): Promise<CapacityAnalysis[]> {
    return Array.from(this.capacityAnalyses.values()).filter(
      analysis => analysis.weekStartDate >= startDate && analysis.weekEndDate <= endDate
    ).sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  }

  async getAllCapacityAnalyses(): Promise<CapacityAnalysis[]> {
    return Array.from(this.capacityAnalyses.values()).sort((a, b) => 
      new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );
  }

  async getLatestCapacityAnalysis(): Promise<CapacityAnalysis | undefined> {
    const analyses = Array.from(this.capacityAnalyses.values());
    if (analyses.length === 0) return undefined;
    
    return analyses.sort((a, b) => 
      new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    )[0];
  }

  async getLatestWeeksAnalyses(limit: number = 8): Promise<CapacityAnalysis[]> {
    return Array.from(this.capacityAnalyses.values())
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
      .slice(0, limit);
  }

  async enforceRetentionLatestWeeks(limit: number = 12): Promise<number> {
    const allAnalyses = await this.getAllCapacityAnalyses();
    
    if (allAnalyses.length <= limit) {
      return 0;
    }

    const toDelete = allAnalyses.slice(limit);
    
    for (const analysis of toDelete) {
      this.capacityAnalyses.delete(analysis.id);
    }
    
    return toDelete.length;
  }

  async cleanupOldAnalyses(monthsOld: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsOld);
    
    const allAnalyses = Array.from(this.capacityAnalyses.values());
    const toDelete = allAnalyses.filter(analysis => 
      new Date(analysis.uploadedAt) < cutoffDate
    );
    
    for (const analysis of toDelete) {
      this.capacityAnalyses.delete(analysis.id);
    }
    
    return toDelete.length;
  }
}

export class DbStorage implements IStorage {
  async saveCapacityAnalysis(insertAnalysis: InsertCapacityAnalysis): Promise<CapacityAnalysis> {
    const [analysis] = await db
      .insert(capacityAnalyses)
      .values(insertAnalysis)
      .onConflictDoUpdate({
        target: [capacityAnalyses.weekStartDate, capacityAnalyses.weekEndDate],
        set: {
          kpis: insertAnalysis.kpis,
          dailySummary: insertAnalysis.dailySummary,
          employeesByDate: insertAnalysis.employeesByDate,
          employeeSummaryByDate: insertAnalysis.employeeSummaryByDate,
          warnings: insertAnalysis.warnings,
          uploadedAt: sql`NOW()`,
        },
      })
      .returning();
    return analysis;
  }

  async getCapacityAnalysis(id: string): Promise<CapacityAnalysis | undefined> {
    const [analysis] = await db
      .select()
      .from(capacityAnalyses)
      .where(eq(capacityAnalyses.id, id));
    return analysis;
  }

  async getCapacityAnalysesByDateRange(startDate: string, endDate: string): Promise<CapacityAnalysis[]> {
    return await db
      .select()
      .from(capacityAnalyses)
      .where(
        and(
          gte(capacityAnalyses.weekStartDate, startDate),
          lte(capacityAnalyses.weekEndDate, endDate)
        )
      )
      .orderBy(desc(capacityAnalyses.uploadedAt));
  }

  async getAllCapacityAnalyses(): Promise<CapacityAnalysis[]> {
    return await db.select().from(capacityAnalyses).orderBy(desc(capacityAnalyses.uploadedAt));
  }

  async getLatestCapacityAnalysis(): Promise<CapacityAnalysis | undefined> {
    const [analysis] = await db
      .select()
      .from(capacityAnalyses)
      .orderBy(desc(capacityAnalyses.uploadedAt))
      .limit(1);
    return analysis;
  }

  async getLatestWeeksAnalyses(limit: number = 8): Promise<CapacityAnalysis[]> {
    return await db
      .select()
      .from(capacityAnalyses)
      .orderBy(desc(capacityAnalyses.uploadedAt))
      .limit(limit);
  }

  async enforceRetentionLatestWeeks(limit: number = 12): Promise<number> {
    const latestAnalyses = await db
      .select()
      .from(capacityAnalyses)
      .orderBy(desc(capacityAnalyses.uploadedAt))
      .limit(limit);

    if (latestAnalyses.length === 0) {
      return 0;
    }

    const oldestKeptDate = latestAnalyses[latestAnalyses.length - 1].uploadedAt;
    
    const deleted = await db
      .delete(capacityAnalyses)
      .where(sql`${capacityAnalyses.uploadedAt} < ${oldestKeptDate}`)
      .returning({ id: capacityAnalyses.id });

    return deleted.length;
  }

  async cleanupOldAnalyses(monthsOld: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsOld);
    
    const deleted = await db
      .delete(capacityAnalyses)
      .where(sql`${capacityAnalyses.uploadedAt} < ${cutoffDate}`)
      .returning({ id: capacityAnalyses.id });
    
    return deleted.length;
  }
}

export const storage = new DbStorage();
