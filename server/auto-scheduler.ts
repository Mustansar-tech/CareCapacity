import { storage } from "./storage";

// This module is kept for potential future auto-scheduling features
// Current scheduling is handled by the frontend VRPTW engine in weekly-plan-tab

export class AutoScheduler {
  constructor() {
    console.log('⚠️ AutoScheduler initialized but disabled - scheduling now handled by frontend VRPTW engine');
  }

  /**
   * Placeholder for future automatic scheduling features
   * Currently, all scheduling is done in the frontend using the VRPTW algorithm
   */
  async scheduleDay(date: string): Promise<any> {
    console.warn('⚠️ AutoScheduler.scheduleDay called but auto-scheduling is disabled');
    console.warn('📋 Use the "Generate Weekly Schedule" button in the Weekly Plan tab instead');

    return {
      date,
      employees: [],
      unassignedVisits: [],
      metrics: {
        totalAssignedVisits: 0,
        totalUnassignedVisits: 0,
        averageUtilization: 0,
        totalTravelTime: 0,
      }
    };
  }

  /**
   * Placeholder for future week scheduling
   */
  async scheduleWeek(startDate: string): Promise<Record<string, any>> {
    console.warn('⚠️ AutoScheduler.scheduleWeek called but auto-scheduling is disabled');
    return {};
  }
}

// Export singleton instance
export const autoScheduler = new AutoScheduler();