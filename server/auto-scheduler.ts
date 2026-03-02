import { storage } from "./storage";
import { TravelTimeService } from "./travel-time-service";
import { logger } from './logger';

// Parse time windows from string format "HH:MM-HH:MM" or array of such strings
// Handles formats like "09:15-10:30; 12:30-16:15" or ["09:15-10:30", "12:30-16:15"]
interface TimeWindow {
  start: number; // minutes since midnight
  end: number;   // minutes since midnight
}

function parseTimeWindows(windows: string | string[]): TimeWindow[] {
  let windowArray: string[];

  if (Array.isArray(windows)) {
    windowArray = windows;
  } else if (typeof windows === 'string') {
    // Split by semicolon or comma to handle multiple windows in one string
    windowArray = windows.split(/[;,]/).map(w => w.trim()).filter(w => w);
  } else {
    return [];
  }

  const timeToMinutes = (time: string): number => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  };

  const parsed = windowArray
    .filter(w => w && typeof w === 'string')
    .map(w => {
      const match = w.match(/(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/);
      if (!match) return null;

      return {
        start: timeToMinutes(match[1]),
        end: timeToMinutes(match[2]),
      };
    })
    .filter((w): w is TimeWindow => w !== null);

  if (parsed.length > 0) {
    logger.debug(`Parsed "${windows}" into ${parsed.length} time windows`);
  }

  return parsed;
}

interface SchedulingEmployee {
  employeeName: string;
  homeLat: number;
  homeLng: number;
  transportMode: 'car' | 'walking' | 'public';
  availabilityWindows: Array<{ start: number; end: number }>; // minutes since midnight
  contractedDailyHours: number;
  scheduledHours: number;
  maxTravelPerVisit: number; // max minutes willing to travel
  gender?: string; // Gender for matching client preferences
}

interface SchedulingVisit {
  id: string;
  clientName: string;
  clientLat: number;
  clientLng: number;
  startTime: number; // minutes since midnight
  endTime: number;
  durationMinutes: number;
  priority: number; // 1=high, 2=medium, 3=low
  serviceType: string;
  preferredStartTime?: number;
  preferredEndTime?: number;
}

interface ScheduledVisit extends SchedulingVisit {
  employeeName: string;
  actualStartTime: number;
  actualEndTime: number;
  travelTimeBefore: number;
  travelTimeAfter: number;
  assignmentScore: number;
}

interface WeeklySchedule {
  date: string;
  employees: Array<{
    employeeName: string;
    visits: ScheduledVisit[];
    totalTravelTime: number;
    totalWorkTime: number;
    utilizationPercent: number;
    freeTimeSlots: Array<{ start: number; end: number }>;
  }>;
  unassignedVisits: SchedulingVisit[];
  metrics: {
    totalAssignedVisits: number;
    totalUnassignedVisits: number;
    averageUtilization: number;
    totalTravelTime: number;
  };
}

export class AutoScheduler {
  private travelService: TravelTimeService;

  constructor() {
    this.travelService = new TravelTimeService(45, 35);
    this.bufferTime = 12;
    this.maxTravelCapMinutes = 45;
  }

  private bufferTime: number;
  private maxTravelCapMinutes: number;

  /**
   * Automatically schedule visits for a given date
   */
  async scheduleDay(date: string, branchId: string): Promise<WeeklySchedule> {
    logger.debug(`\n====== AUTO-SCHEDULER scheduleDay CALLED ======`);
    logger.debug(`   Date: ${date}`);
    logger.debug(`   BranchId: ${branchId}`);
    logger.debug(`================================================\n`);

    if (!branchId) {
      throw new Error('scheduleDay requires branchId parameter - cannot schedule without branch context');
    }

    // Get employees available for this date
    const employees = await this.getAvailableEmployees(date, branchId);
    logger.debug(`Found ${employees.length} available employees`);

    // Get unassigned visits for this date
    const visits = await this.getUnassignedVisits(date, branchId);
    logger.debug(`Found ${visits.length} visits to schedule`);

    if (employees.length === 0 || visits.length === 0) {
      return {
        date,
        employees: [],
        unassignedVisits: visits,
        metrics: {
          totalAssignedVisits: 0,
          totalUnassignedVisits: visits.length,
          averageUtilization: 0,
          totalTravelTime: 0,
        }
      };
    }

    // Pre-warm the travel time cache using ORS Matrix API (batch) before scheduling starts.
    // This converts potentially thousands of individual ORS calls into a few batch requests,
    // avoiding rate limits and ensuring the scheduler loop always hits the cache.
    await this.travelService.prewarmTravelCache(
      branchId,
      employees.map(e => ({ id: e.employeeName, lat: e.homeLat, lng: e.homeLng, transportMode: TravelTimeService.normalizeMode(e.transportMode) })),
      visits.map(v => ({ id: v.clientName, lat: v.clientLat, lng: v.clientLng }))
    );

    // Sort visits by priority, then cluster by geography for better route efficiency
    const prioritizedVisits = this.clusterVisitsByGeography(this.prioritizeVisits(visits));
    logger.debug(`Clustered ${prioritizedVisits.length} visits by geographic proximity`);

    // Load care continuity data (employee-client pairings from previous day)
    const continuityMap = await this.loadCareContinuityMap(date, branchId);

    // Initialize employee schedules
    const employeeSchedules = new Map<string, {
      employee: SchedulingEmployee;
      visits: ScheduledVisit[];
      currentLocation: { lat: number; lng: number };
      lastVisitEndTime: number;
    }>();

    employees.forEach(emp => {
      employeeSchedules.set(emp.employeeName, {
        employee: emp,
        visits: [],
        currentLocation: { lat: emp.homeLat, lng: emp.homeLng },
        lastVisitEndTime: 0,
      });
    });

    let unassignedVisits: SchedulingVisit[] = [];

    // Separate employees by GH status and gender
    const maleGhEmployeeSchedules = new Map<string, any>();
    const femaleOtherGhEmployeeSchedules = new Map<string, any>();
    const nonGhEmployeeSchedules = new Map<string, any>();
    
    for (const [empName, schedule] of Array.from(employeeSchedules.entries())) {
      const isGh = schedule.employee.contractedDailyHours > 0;
      const isMale = schedule.employee.gender?.toLowerCase() === 'male';

      if (isGh && isMale) {
        maleGhEmployeeSchedules.set(empName, schedule);
      } else if (isGh) {
        femaleOtherGhEmployeeSchedules.set(empName, schedule);
      } else {
        nonGhEmployeeSchedules.set(empName, schedule);
      }
    }
    
    logger.debug(`\nGH PRIORITY MODE (MALE FIRST):`);
    logger.debug(`   Male GH employees: ${maleGhEmployeeSchedules.size}`);
    logger.debug(`   Other GH employees: ${femaleOtherGhEmployeeSchedules.size}`);
    logger.debug(`   Non-GH (ad-hoc) employees: ${nonGhEmployeeSchedules.size}`);

    // PHASE 1: Assign visits to Male GH employees FIRST
    logger.debug(`\nPHASE 1: Filling MALE GH employees first...`);
    for (const visit of prioritizedVisits) {
      const bestAssignment = await this.findBestEmployeeForVisit(visit, maleGhEmployeeSchedules, continuityMap);

      if (bestAssignment) {
        const schedule = maleGhEmployeeSchedules.get(bestAssignment.employeeName)!;
        const scheduledVisit = this.assignVisitToEmployee(visit, bestAssignment, schedule);
        schedule.visits.push(scheduledVisit);

        schedule.currentLocation = { lat: visit.clientLat, lng: visit.clientLng };
        schedule.lastVisitEndTime = scheduledVisit.actualEndTime;

        employeeSchedules.set(bestAssignment.employeeName, schedule);
        // Removed debug log for better privacy in production
      } else {
        unassignedVisits.push(visit);
      }
    }

    // PHASE 1.5: Assign remaining visits to other GH employees
    if (unassignedVisits.length > 0) {
      logger.debug(`\nPHASE 1.5: Filling OTHER GH employees...`);
      const phase1_5Unassigned: SchedulingVisit[] = [];
      
      for (const visit of unassignedVisits) {
        const bestAssignment = await this.findBestEmployeeForVisit(visit, femaleOtherGhEmployeeSchedules, continuityMap);

        if (bestAssignment) {
          const schedule = femaleOtherGhEmployeeSchedules.get(bestAssignment.employeeName)!;
          const scheduledVisit = this.assignVisitToEmployee(visit, bestAssignment, schedule);
          schedule.visits.push(scheduledVisit);

          schedule.currentLocation = { lat: visit.clientLat, lng: visit.clientLng };
          schedule.lastVisitEndTime = scheduledVisit.actualEndTime;

          employeeSchedules.set(bestAssignment.employeeName, schedule);
        } else {
          phase1_5Unassigned.push(visit);
        }
      }
      unassignedVisits = phase1_5Unassigned;
    }
    
    logger.debug(`GH Phases results: ${unassignedVisits.length} remaining after all GH priority`);

    // PHASE 2: Try to assign remaining visits to non-GH employees
    if (unassignedVisits.length > 0 && nonGhEmployeeSchedules.size > 0) {
      logger.debug(`\nPHASE 2: Filling non-GH employees with ${unassignedVisits.length} remaining visits...`);

      const phase2Unassigned: SchedulingVisit[] = [];

      for (const visit of unassignedVisits) {
        const bestAssignment = await this.findBestEmployeeForVisit(visit, nonGhEmployeeSchedules, continuityMap);

        if (bestAssignment) {
          const schedule = nonGhEmployeeSchedules.get(bestAssignment.employeeName)!;
          const scheduledVisit = this.assignVisitToEmployee(visit, bestAssignment, schedule);
          schedule.visits.push(scheduledVisit);
          schedule.currentLocation = { lat: visit.clientLat, lng: visit.clientLng };
          schedule.lastVisitEndTime = scheduledVisit.actualEndTime;
          
          // Also update in main schedules map
          employeeSchedules.set(bestAssignment.employeeName, schedule);
          
        } else {
          phase2Unassigned.push(visit);
        }
      }

      unassignedVisits = phase2Unassigned;
      logger.debug(`Phase 2 results: ${unassignedVisits.length} still unassigned`);
    }

    // ALLOWANCE: "Travel Compression" (Extra 15 mins)
    // If travel time exceeds the gap by up to 15 minutes, we "compress" it
    const TRAVEL_EXTRA_ALLOWANCE = 15; 

    // Phase 4: Final attempt for remaining unallocated visits (still respecting 45-min travel cap)
    if (unassignedVisits.length > 0) {
      logger.debug(`\nPHASE 4: FINAL ATTEMPT for ${unassignedVisits.length} remaining visits (45-min travel cap enforced)...`);
      const phase4Unassigned: SchedulingVisit[] = [];
      for (const visit of unassignedVisits) {
        const bestAssignment = await this.findBestEmployeeForVisit(visit, employeeSchedules, continuityMap);
        if (bestAssignment) {
          const schedule = employeeSchedules.get(bestAssignment.employeeName)!;
          const scheduledVisit = this.assignVisitToEmployee(visit, bestAssignment, schedule);
          schedule.visits.push(scheduledVisit);
        } else {
          phase4Unassigned.push(visit);
        }
      }
      unassignedVisits = phase4Unassigned;
    }

    // Build final schedule
    const finalEmployees = Array.from(employeeSchedules.values()).map(schedule => {
      const totalTravelTime = schedule.visits.reduce((sum, v) => sum + v.travelTimeBefore + v.travelTimeAfter, 0);
      const totalWorkTime = schedule.visits.reduce((sum, v) => sum + v.durationMinutes, 0);
      const utilizationPercent = schedule.employee.contractedDailyHours > 0 
        ? Math.round((totalWorkTime / 60) / schedule.employee.contractedDailyHours * 100)
        : 0;

      return {
        employeeName: schedule.employee.employeeName,
        visits: schedule.visits.sort((a, b) => a.actualStartTime - b.actualStartTime),
        totalTravelTime,
        totalWorkTime,
        utilizationPercent,
        freeTimeSlots: this.calculateFreeTimeSlots(schedule),
      };
    });

    const totalAssigned = finalEmployees.reduce((sum, emp) => sum + emp.visits.length, 0);
    const totalTravelTime = finalEmployees.reduce((sum, emp) => sum + emp.totalTravelTime, 0);
    const avgUtilization = finalEmployees.length > 0 
      ? Math.round(finalEmployees.reduce((sum, emp) => sum + emp.utilizationPercent, 0) / finalEmployees.length)
      : 0;

    logger.debug(`Scheduling complete: ${totalAssigned} assigned, ${unassignedVisits.length} unassigned`);

    return {
      date,
      employees: finalEmployees,
      unassignedVisits,
      metrics: {
        totalAssignedVisits: totalAssigned,
        totalUnassignedVisits: unassignedVisits.length,
        averageUtilization: avgUtilization,
        totalTravelTime,
      }
    };
  }

  /**
   * Schedule entire week
   */
  async scheduleWeek(startDate: string, branchId: string): Promise<Record<string, WeeklySchedule>> {
    if (!branchId) {
      throw new Error('scheduleWeek requires branchId parameter - cannot schedule without branch context');
    }

    const weekSchedule: Record<string, WeeklySchedule> = {};

    // Schedule each day of the week
    for (let i = 0; i < 7; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];

      weekSchedule[dateStr] = await this.scheduleDay(dateStr, branchId);
    }

    return weekSchedule;
  }

  /**
   * Get week schedule (retrieves or generates)
   */
  async getWeekSchedule(startDate: string, branchId: string): Promise<Record<string, WeeklySchedule>> {
    if (!branchId) {
      throw new Error('getWeekSchedule requires branchId parameter - cannot schedule without branch context');
    }
    return this.scheduleWeek(startDate, branchId);
  }

  private async getAvailableEmployees(date: string, branchId?: string): Promise<SchedulingEmployee[]> {
    try {
      // Validate branchId - scheduling requires branch-specific data
      if (!branchId) {
        logger.warn(`getAvailableEmployees called without branchId - returning empty list`);
        return [];
      }
      
      // Get employee locations and availability data for this branch
      const [employeeLocations, availabilityData] = await Promise.all([
        storage.getAllEmployeeLocations(branchId),
        this.getEmployeeAvailability(date, branchId)
      ]);

      const employees: SchedulingEmployee[] = [];

      for (const emp of employeeLocations) {
        const availability = availabilityData.find(a => a.employeeName === emp.employeeName);

        if (!availability || !availability.isAvailable) continue;

        if (!emp.homeLat || !emp.homeLng) {
          logger.warn(`Missing location data for ${emp.employeeName}`);
          continue;
        }

        const availabilityWindows = parseTimeWindows(availability.timeWindows || "");

        const transportMode = (emp.transportMode?.toLowerCase().includes('car') ? 'car' : 
                              emp.transportMode?.toLowerCase().includes('walk') ? 'public' : 'car') as any;

        const maxTravel = this.maxTravelCapMinutes;

        // Get gender from employee location (from Title in CG Data)
        const employeeGender = emp.gender || availability.gender || undefined;
        
        const finalEmployee = {
          employeeName: emp.employeeName,
          homeLat: parseFloat(emp.homeLat),
          homeLng: parseFloat(emp.homeLng),
          transportMode: transportMode,
          availabilityWindows: availabilityWindows.map(w => ({ start: w.start, end: w.end })),
          contractedDailyHours: availability.contractedDailyHours || 8,
          scheduledHours: availability.scheduledHours || 0,
          maxTravelPerVisit: maxTravel,
          gender: employeeGender, // Use gender from employee location (Title) or availability
        };
        
        employees.push(finalEmployee);
      }

      return employees;
    } catch (error) {
      logger.error('Error getting available employees:', error);
      return [];
    }
  }

  private async getEmployeeAvailability(date: string, branchId?: string): Promise<Array<{
    employeeName: string;
    isAvailable: boolean;
    timeWindows: string;
    contractedDailyHours: number;
    scheduledHours: number;
    gender?: string;
  }>> {
    try {
      // Validate branchId - availability data is branch-specific
      if (!branchId) {
        logger.warn(`getEmployeeAvailability called without branchId - returning empty list`);
        return [];
      }
      
      // Get the latest capacity analysis from storage for this branch
      const analyses = await storage.getCapacityAnalyses(branchId);
      if (analyses.length === 0) return [];

      const latestAnalysis = analyses[0]; // Most recent analysis

      // Access JSONB fields - these are already parsed objects from PostgreSQL
      const employeesByDate = (latestAnalysis.employeesByDate as any) || {};
      const employeeSummaryByDate = (latestAnalysis.employeeSummaryByDate as any) || {};

      const dateEmployees: any[] = employeesByDate[date] || [];
      const dateSummary: any[] = employeeSummaryByDate[date] || [];

      const result = dateEmployees.map(emp => {
        const isAvailable = ['Available', 'Partial Availability', 'Ad-hoc'].includes(emp.status);
        const summary = dateSummary.find((s: any) => s.employeeName === emp.employeeName);

        // CRITICAL FIX: Extract gender from multiple sources with priority
        let gender: string | undefined = undefined;

        // Priority 1: Direct gender field from employeesByDate JSONB
        if (emp.gender && typeof emp.gender === 'string' && emp.gender.trim() !== '') {
          gender = emp.gender.trim().toLowerCase();
        }
        // Priority 2: Summary data (employeeSummaryByDate)
        else if (summary?.gender && typeof summary.gender === 'string' && summary.gender.trim() !== '') {
          gender = summary.gender.trim().toLowerCase();
        }
        // Priority 3: Parse title from employee name
        else {
          const empNameLower = emp.employeeName.toLowerCase();
          
          if (empNameLower.includes('mr ') || empNameLower.includes('mr. ')) {
            gender = 'male';
          } else if (empNameLower.includes('mrs ') || empNameLower.includes('mrs. ') || 
                     empNameLower.includes('miss ') || empNameLower.includes('ms ') || 
                     empNameLower.includes('ms. ')) {
            gender = 'female';
          }
        }

        return {
          employeeName: emp.employeeName,
          isAvailable,
          timeWindows: emp.timeWindows || '',
          contractedDailyHours: emp.contractedDailyHours || 8,
          scheduledHours: summary?.scheduledHours || emp.scheduledHours || 0,
          gender: gender,
        };
      });

      return result;
    } catch (error) {
      logger.error('Error getting employee availability:', error);
      return [];
    }
  }

  private async getUnassignedVisits(date: string, branchId?: string): Promise<SchedulingVisit[]> {
    try {
      logger.debug(`\nAUTO-SCHEDULER: getUnassignedVisits called for date=${date}, branchId=${branchId || 'UNDEFINED'}`);
      
      // Import the visit extractor and buffer getter
      const { extractClientVisitsFromGHExcel } = await import('./excel-visit-extractor');
      const { getLatestGuaranteedBuffer } = await import('./routes');
      
      // Get the buffer for this specific branch
      if (!branchId) {
        logger.warn(`AUTO-SCHEDULER: No branchId provided for visit extraction`);
        return [];
      }
      
      logger.debug(`AUTO-SCHEDULER: Calling getLatestGuaranteedBuffer('${branchId}')...`);
      const ghBuffer = await getLatestGuaranteedBuffer(branchId);
      
      if (!ghBuffer) {
        logger.warn(`AUTO-SCHEDULER: No Guaranteed Hours buffer available for branch ${branchId} - please upload files first`);
        return [];
      }
      
      logger.debug(`AUTO-SCHEDULER: Found GH buffer for branch ${branchId} (${ghBuffer.length} bytes)`);

      // Extract visits from Excel buffer for this date
      const parsedDate = new Date(date + 'T00:00:00.000Z');
      const visits = await extractClientVisitsFromGHExcel(ghBuffer, parsedDate, branchId, storage);
      
      logger.debug(`Extracted ${visits.length} visits from GH Excel for ${date}`);

      const clientLocations = await storage.getAllClientLocations(branchId);
      const clientLocationMap = new Map(clientLocations.map(c => [c.clientName, c]));

      const schedulingVisits: SchedulingVisit[] = [];
      
      for (const visit of visits) {
        if (!visit.clientName) continue;
        
        const client = clientLocationMap.get(visit.clientName);
        if (!client || !client.lat || !client.lng) {
          logger.warn(`Missing location data for client ${visit.clientName}`);
          continue;
        }

        schedulingVisits.push({
          id: `${visit.clientName}-${date}-${visit.startTime}`,
          clientName: visit.clientName,
          clientLat: parseFloat(client.lat),
          clientLng: parseFloat(client.lng),
          startTime: this.timeStringToMinutes(visit.startTime),
          endTime: this.timeStringToMinutes(visit.endTime),
          durationMinutes: visit.durationMinutes,
          priority: visit.priority || 2,
          serviceType: visit.serviceType || '',
          preferredStartTime: this.timeStringToMinutes(visit.startTime),
          preferredEndTime: this.timeStringToMinutes(visit.endTime),
        });
      }
      
      return schedulingVisits;
    } catch (error) {
      logger.error('Error getting unassigned visits:', error);
      return [];
    }
  }

  // Check if client requires specific gender (e.g., "Mullen, Eileen (F)" requires female)
  private getClientGenderPreference(clientName: string): string | null {
    const upperName = clientName.toUpperCase();
    if (upperName.includes('(F)') || upperName.endsWith(' F')) {
      return 'female';
    }
    if (upperName.includes('(M)') || upperName.endsWith(' M')) {
      return 'male';
    }
    return null; // No preference
  }

  // Check if employee gender matches client preference
  private isGenderMatch(employeeGender: string | undefined, clientName: string): boolean {
    const preference = this.getClientGenderPreference(clientName);
    if (!preference) return true; // No preference, any gender is OK

    if (!employeeGender || employeeGender.trim() === '') {
      logger.debug(`STRICT: Employee has no gender data - cannot serve ${clientName} (requires ${preference})`);
      return false; // STRICT: Reject when employee gender is unknown but client has preference
    }

    const empGenderLower = employeeGender.toLowerCase().trim();
    const matches = empGenderLower === preference || empGenderLower.includes(preference);

    if (!matches) {
      logger.debug(`Gender mismatch: Employee gender="${empGenderLower}" cannot serve ${clientName} (requires ${preference})`);
    } else {
      logger.debug(`Gender match: Employee gender="${empGenderLower}" can serve ${clientName} (requires ${preference})`);
    }

    return matches;
  }

  private prioritizeVisits(visits: SchedulingVisit[]): SchedulingVisit[] {
    return visits.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.startTime - b.startTime;
    });
  }

  private clusterVisitsByGeography(visits: SchedulingVisit[]): SchedulingVisit[] {
    if (visits.length <= 1) return visits;

    const GRID_SIZE = 0.02; // ~2km grid cells
    const withGrid = visits.map(v => ({
      visit: v,
      gridX: Math.floor(v.clientLat / GRID_SIZE),
      gridY: Math.floor(v.clientLng / GRID_SIZE),
    }));

    withGrid.sort((a, b) => {
      if (a.visit.priority !== b.visit.priority) return a.visit.priority - b.visit.priority;
      if (a.gridX !== b.gridX) return a.gridX - b.gridX;
      if (a.gridY !== b.gridY) return a.gridY - b.gridY;
      return a.visit.startTime - b.visit.startTime;
    });

    return withGrid.map(w => w.visit);
  }

  private async loadCareContinuityMap(date: string, branchId: string): Promise<Map<string, Set<string>>> {
    const continuityMap = new Map<string, Set<string>>();
    try {
      const prevDate = new Date(date);
      prevDate.setDate(prevDate.getDate() - 1);
      const prevDateStr = prevDate.toISOString().split('T')[0];

      const analyses = await storage.getCapacityAnalyses(branchId);
      if (analyses.length === 0) return continuityMap;

      const latestAnalysis = analyses[0];
      const employeesByDate = (latestAnalysis.employeesByDate as any) || {};
      const prevDayEmployees: any[] = employeesByDate[prevDateStr] || [];

      for (const emp of prevDayEmployees) {
        if (emp.clients && Array.isArray(emp.clients)) {
          for (const clientName of emp.clients) {
            if (!continuityMap.has(emp.employeeName)) {
              continuityMap.set(emp.employeeName, new Set());
            }
            continuityMap.get(emp.employeeName)!.add(clientName.toLowerCase().trim());
          }
        }
      }
      logger.debug(`Care continuity: loaded ${continuityMap.size} employee-client pairings from ${prevDateStr}`);
    } catch (error) {
      logger.debug(`Care continuity map not available (non-critical): ${(error as any)?.message}`);
    }
    return continuityMap;
  }

  private getCareContinuityBonus(employeeName: string, clientName: string, continuityMap: Map<string, Set<string>>): number {
    const clientSet = continuityMap.get(employeeName);
    if (!clientSet) return 0;
    const normalizedClient = clientName.toLowerCase().trim();
    if (clientSet.has(normalizedClient)) {
      return 0.15;
    }
    const clientArray = Array.from(clientSet);
    for (const prevClient of clientArray) {
      if (normalizedClient.includes(prevClient) || prevClient.includes(normalizedClient)) {
        return 0.10;
      }
    }
    return 0;
  }

  private needsRestBreak(schedule: any): { needed: boolean; afterMinutes: number } {
    const REST_BREAK_THRESHOLD = 300; // 5 hours in minutes (company rule)
    const REST_BREAK_DURATION = 30; // 30-minute break required
    const visits = schedule.visits;
    if (visits.length === 0) return { needed: false, afterMinutes: 0 };

    const sortedVisits = [...visits].sort((a: any, b: any) => a.actualStartTime - b.actualStartTime);
    let cumulativeCareMinutes = 0;

    for (let i = 0; i < sortedVisits.length; i++) {
      const visit = sortedVisits[i];
      cumulativeCareMinutes += visit.durationMinutes;

      // Check if gap between visits provides a genuine 30-min rest (excluding travel)
      if (i < sortedVisits.length - 1) {
        const nextVisit = sortedVisits[i + 1];
        const rawGap = nextVisit.actualStartTime - visit.actualEndTime;
        const travelInGap = nextVisit.travelTimeBefore || 0;
        const pureRest = rawGap - travelInGap;

        if (pureRest >= REST_BREAK_DURATION) {
          cumulativeCareMinutes = 0; // Break taken, reset counter
        }
      }

      if (cumulativeCareMinutes >= REST_BREAK_THRESHOLD) {
        return { needed: true, afterMinutes: visit.actualEndTime };
      }
    }
    return { needed: false, afterMinutes: 0 };
  }

  private calculateShiftCompactness(schedule: any, visit: SchedulingVisit): number {
    const visits = schedule.visits;
    if (visits.length === 0) return 0.5;

    const sortedVisits = [...visits].sort((a: any, b: any) => a.actualStartTime - b.actualStartTime);
    const firstStart = sortedVisits[0].actualStartTime;
    const lastEnd = sortedVisits[sortedVisits.length - 1].actualEndTime;

    const visitWouldExtendBefore = visit.startTime < firstStart;
    const visitWouldExtendAfter = visit.endTime > lastEnd;
    const visitWithinBlock = visit.startTime >= firstStart && visit.endTime <= lastEnd;

    if (visitWithinBlock) return 1.0;

    const existingSpan = lastEnd - firstStart;
    const newStart = Math.min(firstStart, visit.startTime);
    const newEnd = Math.max(lastEnd, visit.endTime);
    const newSpan = newEnd - newStart;

    if (existingSpan <= 0) return 0.5;
    const compactness = existingSpan / newSpan;
    return Math.max(0, compactness);
  }

  private async findBestEmployeeForVisit(
    visit: SchedulingVisit, 
    employeeSchedules: Map<string, any>,
    continuityMap?: Map<string, Set<string>>
  ): Promise<{ employeeName: string; score: number; insertionIndex: number } | null> {
    let bestMatch: { employeeName: string; score: number; insertionIndex: number } | null = null;
    let bestScore = -1;

    for (const [empName, schedule] of Array.from(employeeSchedules.entries())) {
      const employee = schedule.employee;

      if (!this.isGenderMatch(employee.gender, visit.clientName)) {
        continue;
      }

      const hasTimeConflict = schedule.visits.some((v: any) => {
        const vStart = v.actualStartTime;
        const vEnd = v.actualEndTime;
        const visitStart = visit.startTime;
        const visitEnd = visit.endTime;
        return (visitStart < vEnd && visitEnd > vStart);
      });

      if (hasTimeConflict) {
        continue;
      }

      // Rest break check: if employee needs a statutory break, only allow visits after break window
      const restBreakStatus = this.needsRestBreak(schedule);
      if (restBreakStatus.needed) {
        const REST_BREAK_DURATION = 20;
        const breakEndTime = restBreakStatus.afterMinutes + REST_BREAK_DURATION;
        if (visit.startTime < breakEndTime && visit.startTime >= restBreakStatus.afterMinutes) {
          logger.debug(`   ${empName}: Visit at ${visit.startTime}min blocked by statutory rest break (${restBreakStatus.afterMinutes}-${breakEndTime}min)`);
          continue;
        }
      }

      const travelTime = await (this as any).calculateTravelTime(
        "default",
        employee.employeeName,
        visit.clientName,
        employee.transportMode
      );

      if (travelTime > this.maxTravelCapMinutes && schedule.visits.length === 0) {
        logger.debug(`   ${empName}: REJECTED - home-to-visit travel (${travelTime.toFixed(0)} min) exceeds ${this.maxTravelCapMinutes} min cap`);
        continue;
      }

      const insertion = await this.findBestInsertionPoint(visit, schedule);

      if (insertion) {
        let adjustedScore = insertion.score;

        // Care continuity bonus
        if (continuityMap) {
          const continuityBonus = this.getCareContinuityBonus(empName, visit.clientName, continuityMap);
          if (continuityBonus > 0) {
            adjustedScore += continuityBonus;
            logger.debug(`   ${empName}: +${(continuityBonus * 100).toFixed(0)}% care continuity bonus for ${visit.clientName}`);
          }
        }

        // Shift stability bonus (prefer compact schedules)
        const compactness = this.calculateShiftCompactness(schedule, visit);
        adjustedScore += compactness * 0.10;

        if (adjustedScore > bestScore) {
          bestScore = adjustedScore;
          bestMatch = {
            employeeName: empName,
            score: adjustedScore,
            insertionIndex: insertion.index,
          };
        }
      }
    }

    return bestMatch;
  }

  private async findBestInsertionPoint(visit: SchedulingVisit, schedule: any): Promise<{ index: number; score: number } | null> {
    const employee = schedule.employee;
    const visits = schedule.visits;

    let bestInsertion: { index: number; score: number } | null = null;
    let bestScore = -1;

    // Try inserting at each possible position
    for (let i = 0; i <= visits.length; i++) {
      const prevVisit = i > 0 ? visits[i - 1] : null;
      const nextVisit = i < visits.length ? visits[i] : null;

      // Calculate travel times
      const prevLocation = prevVisit 
        ? { lat: prevVisit.clientLat, lng: prevVisit.clientLng }
        : { lat: employee.homeLat, lng: employee.homeLng };

      const travelToPrev = await (this as any).calculateTravelTime(
        "default",
        employee.employeeName,
        visit.clientName,
        employee.transportMode
      );

      const travelToNext = nextVisit 
        ? await (this as any).calculateTravelTime(
          "default",
          visit.clientName,
          nextVisit.clientName,
          employee.transportMode
        )
        : 0;

      // HARD 45-MINUTE TRAVEL CAP: reject any leg exceeding the cap
      if (travelToPrev > this.maxTravelCapMinutes) {
        logger.debug(`   Insertion ${i}: REJECTED - travel from previous (${travelToPrev.toFixed(0)} min) exceeds ${this.maxTravelCapMinutes} min cap`);
        continue;
      }
      if (travelToNext > this.maxTravelCapMinutes) {
        logger.debug(`   Insertion ${i}: REJECTED - travel to next (${travelToNext.toFixed(0)} min) exceeds ${this.maxTravelCapMinutes} min cap`);
        continue;
      }

      // Also check return-home travel if this would be the last visit
      if (!nextVisit) {
        const travelHome = await (this as any).calculateTravelTime(
          "default",
          visit.clientName,
          employee.employeeName,
          employee.transportMode
        );
        if (travelHome > this.maxTravelCapMinutes) {
          logger.debug(`   Insertion ${i}: REJECTED - return home travel (${travelHome.toFixed(0)} min) exceeds ${this.maxTravelCapMinutes} min cap`);
          continue;
        }
      }

      const buffer = this.bufferTime;
      const earliestStart = prevVisit ? prevVisit.actualEndTime + travelToPrev + buffer : visit.startTime;
      const latestEnd = nextVisit ? nextVisit.actualStartTime - travelToNext - buffer : visit.endTime + 10;

      const maxCompression = 15; 
      if (earliestStart + visit.durationMinutes <= latestEnd + maxCompression) {
        // Calculate score based on multiple factors
        const score = this.calculateInsertionScore(visit, employee, travelToPrev, travelToNext, i, visits.length);

        if (score > bestScore) {
          bestScore = score;
          bestInsertion = { index: i, score, travelTimeBefore: travelToPrev } as any;
        }
      }
    }

    return bestInsertion;
  }

  private calculateInsertionScore(
    visit: SchedulingVisit,
    employee: SchedulingEmployee,
    travelToPrev: number,
    travelToNext: number,
    insertionIndex: number,
    totalVisits: number
  ): number {
    let score = 0;

    // PRIORITY 1: GH (Guaranteed Hours) employees get TOP priority (70% weight)
    // GH employees have contractedDailyHours > 0, non-GH (ad-hoc) have 0
    const isGHEmployee = employee.contractedDailyHours > 0;
    const isMale = employee.gender?.toLowerCase() === 'male';
    
    // EXTREME weight for Male GH to ensure they are picked first for every visit they can do
    let ghPriorityScore = 0;
    if (isGHEmployee) {
      ghPriorityScore = isMale ? 1.0 : 0.4; // Male GH gets absolute top score, Female GH significantly lower
    }
    
    score += ghPriorityScore * 0.70; // Increased weight from 0.50 to 0.70

    // Factor 2: Minimize travel time (10% weight) - reduced weight to maximize coverage
    // Use 120 minutes as reference for total travel (very lenient)
    const totalTravel = travelToPrev + travelToNext;
    const travelScore = Math.max(0, 1 - totalTravel / 120);
    score += travelScore * 0.10;

    // Factor 3: Time window preference (5% weight)
    const timePreferenceScore = visit.preferredStartTime 
      ? Math.max(0, 1 - Math.abs(visit.startTime - visit.preferredStartTime) / 180)
      : 0.7;
    score += timePreferenceScore * 0.05; // Reduced from 0.10 to 0.05

    // Factor 4: Employee utilization (15% weight) - for GH employees, prioritize filling their hours
    const weeklyContracted = employee.contractedDailyHours * 5; // Assume 5-day week
    const weeklyRemaining = Math.max(0, weeklyContracted - employee.scheduledHours);
    const dailyRemaining = Math.max(0, employee.contractedDailyHours - (employee.scheduledHours % employee.contractedDailyHours));

    // Score based on available capacity (both daily and weekly)
    const capacityScore = weeklyRemaining > 0 && dailyRemaining > 0 ? 
      Math.min(weeklyRemaining / weeklyContracted, dailyRemaining / employee.contractedDailyHours) : 0;

    score += capacityScore * 0.15;

    // Factor 5: Route efficiency - prefer middle insertions over start/end (5% weight)
    const routeEfficiencyScore = totalVisits > 0 
      ? 1 - Math.abs((insertionIndex / totalVisits) - 0.5) * 2
      : 1;
    score += routeEfficiencyScore * 0.05;

    return score;
  }

  private async calculateTravelTime(
    branchId: string,
    employeeName: string,
    clientName: string,
    transportMode: 'car' | 'walking' | 'public' = 'car'
  ): Promise<number> {
    const { calculateTravelTime: travelFunc } = require('./travel-time-service');
    return await travelFunc(branchId, employeeName, clientName, transportMode);
  }

  private assignVisitToEmployee(
    visit: SchedulingVisit,
    assignment: { employeeName: string; score: number; insertionIndex: number },
    schedule: any
  ): ScheduledVisit {
    const prevVisit = assignment.insertionIndex > 0 ? schedule.visits[assignment.insertionIndex - 1] : null;

    const travelTimeBefore = assignment.score > 0 ? (assignment as any).travelTimeBefore || 0 : 0;

    const actualStartTime = prevVisit 
      ? Math.max(visit.startTime, prevVisit.actualEndTime + travelTimeBefore + this.bufferTime)
      : visit.startTime;

    return {
      ...visit,
      employeeName: assignment.employeeName,
      actualStartTime,
      actualEndTime: actualStartTime + visit.durationMinutes,
      travelTimeBefore,
      travelTimeAfter: 0, // Will be calculated when next visit is assigned
      assignmentScore: assignment.score,
    };
  }

  private calculateFreeTimeSlots(schedule: any): Array<{ start: number; end: number }> {
    const freeSlots: Array<{ start: number; end: number }> = [];
    const availabilityWindows = schedule.employee.availabilityWindows;
    const visits = schedule.visits.sort((a: any, b: any) => a.actualStartTime - b.actualStartTime);

    for (const window of availabilityWindows) {
      let currentTime = window.start;

      for (const visit of visits) {
        if (visit.actualStartTime >= window.start && visit.actualStartTime < window.end) {
          if (currentTime < visit.actualStartTime) {
            freeSlots.push({ start: currentTime, end: visit.actualStartTime });
          }
          currentTime = visit.actualEndTime;
        }
      }

      // Add remaining time in window
      if (currentTime < window.end) {
        freeSlots.push({ start: currentTime, end: window.end });
      }
    }

    return freeSlots.filter(slot => slot.end - slot.start >= 15); // Minimum 15-minute slots
  }

  private timeStringToMinutes(timeStr: string): number {
    if (!timeStr) return 0;

    // Handle both "HH:MM" and ISO datetime formats
    let time = timeStr;
    if (timeStr.includes('T')) {
      time = timeStr.split('T')[1].split(':').slice(0, 2).join(':');
    }

    const [hours, minutes] = time.split(':').map(Number);
    return (hours || 0) * 60 + (minutes || 0);
  }
}

// Export singleton instance
export const autoScheduler = new AutoScheduler();