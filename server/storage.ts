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
    const id = randomUUID();
    const analysis: CapacityAnalysis = {
      ...insertAnalysis,
      id,
      uploadedAt: new Date(),
      employeeSummaryByDate: insertAnalysis.employeeSummaryByDate || {},
      warnings: insertAnalysis.warnings || [],
    };
    this.capacityAnalyses.set(id, analysis);
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
    return this.getCapacityAnalysesByDateRange(startDate, endDate);
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
import { eq, and, gte, lte, desc } from "drizzle-orm";

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
    const [analysis] = await db
      .insert(capacityAnalyses)
      .values(insertAnalysis)
      .returning();
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
    return this.getCapacityAnalysesByDateRange(startDate, endDate);
  }

  async getAllCapacityAnalyses(): Promise<CapacityAnalysis[]> {
    return await db
      .select()
      .from(capacityAnalyses)
      .orderBy(desc(capacityAnalyses.uploadedAt));
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
