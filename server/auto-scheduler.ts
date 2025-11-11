import { storage } from "./storage";
import { TravelTimeService } from "./travel-time-service";

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
    console.log(`📋 Parsed "${windows}" into ${parsed.length} time windows`);
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
    this.travelService = new TravelTimeService(20, 15); // 20min max, 15min soft limit
  }

  /**
   * Automatically schedule visits for a given date
   */
  async scheduleDay(date: string): Promise<WeeklySchedule> {
    console.log(`🤖 Starting automatic scheduling for ${date}`);

    // Get employees available for this date
    const employees = await this.getAvailableEmployees(date);
    console.log(`👥 Found ${employees.length} available employees`);

    // Get unassigned visits for this date
    const visits = await this.getUnassignedVisits(date);
    console.log(`📋 Found ${visits.length} visits to schedule`);

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

    // Sort visits by priority and time constraints
    const prioritizedVisits = this.prioritizeVisits(visits);

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

    // First pass: Assign visits using standard constraints
    for (const visit of prioritizedVisits) {
      const bestAssignment = this.findBestEmployeeForVisit(visit, employeeSchedules);

      if (bestAssignment) {
        const schedule = employeeSchedules.get(bestAssignment.employeeName)!;
        const scheduledVisit = this.assignVisitToEmployee(visit, bestAssignment, schedule);
        schedule.visits.push(scheduledVisit);

        // Update employee's current location and time
        schedule.currentLocation = { lat: visit.clientLat, lng: visit.clientLng };
        schedule.lastVisitEndTime = scheduledVisit.actualEndTime;

        console.log(`✅ Assigned ${visit.clientName} to ${bestAssignment.employeeName} (score: ${bestAssignment.score.toFixed(2)})`);
      } else {
        unassignedVisits.push(visit);
        console.log(`❌ Could not assign ${visit.clientName} - no suitable employee found`);
      }
    }

    // Second pass: Try to assign remaining visits with relaxed travel constraints (+5 minutes)
    if (unassignedVisits.length > 0) {
      console.log(`🔄 Second pass: attempting to allocate ${unassignedVisits.length} unassigned visits with relaxed constraints`);

      const secondPassUnassigned: SchedulingVisit[] = [];

      for (const visit of unassignedVisits) {
        // Temporarily increase travel limits by 5 minutes for second pass
        Array.from(employeeSchedules.values()).forEach(schedule => {
          schedule.employee.maxTravelPerVisit += 5;
        });

        const bestAssignment = this.findBestEmployeeForVisit(visit, employeeSchedules);

        // Restore original limits
        Array.from(employeeSchedules.values()).forEach(schedule => {
          schedule.employee.maxTravelPerVisit -= 5;
        });

        if (bestAssignment) {
          const schedule = employeeSchedules.get(bestAssignment.employeeName)!;
          const scheduledVisit = this.assignVisitToEmployee(visit, bestAssignment, schedule);
          schedule.visits.push(scheduledVisit);
          schedule.currentLocation = { lat: visit.clientLat, lng: visit.clientLng };
          schedule.lastVisitEndTime = scheduledVisit.actualEndTime;
          console.log(`✅ [Second pass] Assigned ${visit.clientName} to ${bestAssignment.employeeName}`);
        } else {
          secondPassUnassigned.push(visit);
        }
      }

      unassignedVisits = secondPassUnassigned;
      console.log(`📊 Second pass results: ${unassignedVisits.length} still unassigned`);
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

    console.log(`📊 Scheduling complete: ${totalAssigned} assigned, ${unassignedVisits.length} unassigned`);

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
  async scheduleWeek(startDate: string): Promise<Record<string, WeeklySchedule>> {
    const weekSchedule: Record<string, WeeklySchedule> = {};

    // Schedule each day of the week
    for (let i = 0; i < 7; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];

      weekSchedule[dateStr] = await this.scheduleDay(dateStr);
    }

    return weekSchedule;
  }

  private async getAvailableEmployees(date: string): Promise<SchedulingEmployee[]> {
    try {
      // Get employee locations and availability data
      const [employeeLocations, availabilityData] = await Promise.all([
        storage.getAllEmployeeLocations(),
        // You'll need to implement this method to get availability for specific date
        this.getEmployeeAvailability(date)
      ]);

      const employees: SchedulingEmployee[] = [];

      for (const emp of employeeLocations) {
        const availability = availabilityData.find(a => a.employeeName === emp.employeeName);

        if (!availability || !availability.isAvailable) continue;

        if (!emp.homeLat || !emp.homeLng) {
          console.warn(`⚠️ Missing location data for ${emp.employeeName}`);
          continue;
        }

        const availabilityWindows = parseTimeWindows(availability.timeWindows || "");

        const transportMode = (emp.transportMode?.toLowerCase().includes('car') ? 'car' : 
                              emp.transportMode?.toLowerCase().includes('walk') ? 'walking' : 'car') as any;

        // Set travel limits based on transport mode for better allocation
        const maxTravel = transportMode === 'car' ? 25 : 20; // 25min for car, 20min for others

        // Get gender from employee location (from Title in CG Data)
        const employeeGender = emp.gender || availability.gender || undefined;
        
        console.log(`👤 ${emp.employeeName}: Location gender="${emp.gender || 'NONE'}", Availability gender="${availability.gender || 'NONE'}", Using="${employeeGender || 'NONE'}"`);
        
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
        
        console.log(`✅ Adding employee to scheduler: ${emp.employeeName}, gender="${finalEmployee.gender || 'MISSING'}"`);
        employees.push(finalEmployee);
      }

      return employees;
    } catch (error) {
      console.error('Error getting available employees:', error);
      return [];
    }
  }

  private async getEmployeeAvailability(date: string): Promise<Array<{
    employeeName: string;
    isAvailable: boolean;
    timeWindows: string;
    contractedDailyHours: number;
    scheduledHours: number;
    gender?: string;
  }>> {
    try {
      // Get the latest capacity analysis from storage
      const analyses = await storage.getCapacityAnalyses();
      if (analyses.length === 0) return [];

      const latestAnalysis = analyses[0]; // Most recent analysis

      // Access JSONB fields - these are already parsed objects from PostgreSQL
      const employeesByDate = (latestAnalysis.employeesByDate as any) || {};
      const employeeSummaryByDate = (latestAnalysis.employeeSummaryByDate as any) || {};

      const dateEmployees: any[] = employeesByDate[date] || [];
      const dateSummary: any[] = employeeSummaryByDate[date] || [];

      console.log(`\n🔍 AUTO-SCHEDULER GENDER DEBUG for ${date}:`);
      console.log(`  Total employees on date: ${dateEmployees.length}`);
      console.log(`  Total employees in summary: ${dateSummary.length}`);

      // Debug: Show actual gender data in employeesByDate
      if (dateEmployees.length > 0) {
        console.log(`\n  📊 FIRST 5 EMPLOYEE DATA FROM DATABASE:`);
        dateEmployees.slice(0, 5).forEach((sample, idx) => {
          console.log(`    ${idx + 1}. Name: ${sample.employeeName}`);
          console.log(`       Gender field: "${sample.gender || 'MISSING'}"`);
          console.log(`       Status: ${sample.status}`);
        });
      }
      if (dateSummary.length > 0) {
        console.log(`\n  📊 FIRST 5 SUMMARY DATA FROM DATABASE:`);
        dateSummary.slice(0, 5).forEach((sample, idx) => {
          console.log(`    ${idx + 1}. Name: ${sample.employeeName}`);
          console.log(`       Gender field: "${sample.gender || 'MISSING'}"`);
        });
      }

      // Count how many have gender before processing
      const employeesWithGender = dateEmployees.filter((e: any) => e.gender && e.gender.trim() !== '').length;
      const summaryWithGender = dateSummary.filter((e: any) => e.gender && e.gender.trim() !== '').length;
      console.log(`\n  📊 GENDER DATA AVAILABILITY:`);
      console.log(`     employeesByDate: ${employeesWithGender}/${dateEmployees.length} employees have gender`);
      console.log(`     employeeSummaryByDate: ${summaryWithGender}/${dateSummary.length} employees have gender`);

      const result = dateEmployees.map(emp => {
        const isAvailable = ['Available', 'Partial Availability', 'Ad-hoc'].includes(emp.status);
        const summary = dateSummary.find((s: any) => s.employeeName === emp.employeeName);

        // CRITICAL FIX: Extract gender from multiple sources with priority
        let gender: string | undefined = undefined;

        // Priority 1: Direct gender field from employeesByDate JSONB
        if (emp.gender && typeof emp.gender === 'string' && emp.gender.trim() !== '') {
          gender = emp.gender.trim().toLowerCase();
          console.log(`✅ ${emp.employeeName}: Found gender in employeesByDate = "${gender}"`);
        }
        // Priority 2: Summary data (employeeSummaryByDate)
        else if (summary?.gender && typeof summary.gender === 'string' && summary.gender.trim() !== '') {
          gender = summary.gender.trim().toLowerCase();
          console.log(`🔄 ${emp.employeeName}: Using gender from employeeSummaryByDate = "${gender}"`);
        }
        // Priority 3: Parse title from employee name
        else {
          const empNameLower = emp.employeeName.toLowerCase();
          
          if (empNameLower.includes('mr ') || empNameLower.includes('mr. ')) {
            gender = 'male';
            console.log(`🔄 ${emp.employeeName}: Parsed gender from name (Mr) = "male"`);
          } else if (empNameLower.includes('mrs ') || empNameLower.includes('mrs. ') || 
                     empNameLower.includes('miss ') || empNameLower.includes('ms ') || 
                     empNameLower.includes('ms. ')) {
            gender = 'female';
            console.log(`🔄 ${emp.employeeName}: Parsed gender from name (Mrs/Miss/Ms) = "female"`);
          } else {
            console.log(`❌ ${emp.employeeName}: NO GENDER FOUND (emp.gender='${emp.gender}', summary?.gender='${summary?.gender}', name parsing failed)`);
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

      // Final stats on returned data
      const resultWithGender = result.filter(r => r.gender && r.gender.trim() !== '').length;
      console.log(`\n  ✅ FINAL RESULT: ${resultWithGender}/${result.length} employees will have gender data for scheduling\n`);

      return result;
    } catch (error) {
      console.error('Error getting employee availability:', error);
      return [];
    }
  }

  private async getUnassignedVisits(date: string, branchId?: string): Promise<SchedulingVisit[]> {
    try {
      // Import the visit extractor and buffer getter
      const { extractClientVisitsFromGHExcel } = await import('./excel-visit-extractor');
      const { getLatestGuaranteedBuffer } = await import('./routes');
      
      // Get the buffer
      const ghBuffer = getLatestGuaranteedBuffer();
      
      if (!ghBuffer) {
        console.warn(`⚠️ No Guaranteed Hours buffer available for visit extraction - please upload files first`);
        return [];
      }

      // Extract visits from Excel buffer for this date
      const parsedDate = new Date(date + 'T00:00:00.000Z');
      const visits = extractClientVisitsFromGHExcel(ghBuffer, parsedDate);
      
      console.log(`📋 Extracted ${visits.length} visits from GH Excel for ${date}`);

      const clientLocations = await storage.getAllClientLocations(branchId);
      const clientLocationMap = new Map(clientLocations.map(c => [c.clientName, c]));

      return visits
        .filter(visit => visit.clientName) // Filter out visits without client names
        .map(visit => {
          const client = clientLocationMap.get(visit.clientName);

          if (!client || !client.lat || !client.lng) {
            console.warn(`⚠️ Missing location data for client ${visit.clientName}`);
            return null;
          }

          return {
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
          };
        })
        .filter((visit): visit is SchedulingVisit => visit !== null);
    } catch (error) {
      console.error('Error getting unassigned visits:', error);
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
      console.log(`⚠️ STRICT: Employee has no gender data - cannot serve ${clientName} (requires ${preference})`);
      return false; // STRICT: Reject when employee gender is unknown but client has preference
    }

    const empGenderLower = employeeGender.toLowerCase().trim();
    const matches = empGenderLower === preference || empGenderLower.includes(preference);

    if (!matches) {
      console.log(`⚠️ Gender mismatch: Employee gender="${empGenderLower}" cannot serve ${clientName} (requires ${preference})`);
    } else {
      console.log(`✅ Gender match: Employee gender="${empGenderLower}" can serve ${clientName} (requires ${preference})`);
    }

    return matches;
  }

  private prioritizeVisits(visits: SchedulingVisit[]): SchedulingVisit[] {
    return visits.sort((a, b) => {
      // Sort by priority first (1=highest), then by preferred start time
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.startTime - b.startTime;
    });
  }

  private findBestEmployeeForVisit(
    visit: SchedulingVisit, 
    employeeSchedules: Map<string, any>
  ): { employeeName: string; score: number; insertionIndex: number } | null {
    let bestMatch: { employeeName: string; score: number; insertionIndex: number } | null = null;
    let bestScore = -1;

    // Log client gender requirement
    const clientGenderPref = this.getClientGenderPreference(visit.clientName);
    if (clientGenderPref) {
      console.log(`\n👤 Client "${visit.clientName}" requires gender: ${clientGenderPref}`);
      console.log(`   Checking ${employeeSchedules.size} employees...`);
    }

    for (const [empName, schedule] of employeeSchedules) {
      const employee = schedule.employee;

      // Check gender preference match
      if (!this.isGenderMatch(employee.gender, visit.clientName)) {
        if (clientGenderPref) {
          console.log(`   ❌ ${empName}: gender="${employee.gender || 'UNDEFINED'}" does not match required "${clientGenderPref}"`);
        }
        continue; // Skip this employee - gender doesn't match client preference
      }

      // CRITICAL: Check if employee already has a visit at this exact time
      const hasTimeConflict = schedule.visits.some((v: any) => {
        // Check for any time overlap
        return (visit.startTime < v.actualEndTime && visit.endTime > v.actualStartTime);
      });

      if (hasTimeConflict) {
        console.log(`   ❌ ${empName}: TIME CONFLICT - already has visit at ${visit.startTime}-${visit.endTime}`);
        continue; // Skip - employee already busy at this time
      }

      if (clientGenderPref) {
        console.log(`   ✅ ${empName}: gender="${employee.gender}" MATCHES required "${clientGenderPref}" - checking availability...`);
      }

      // Calculate travel time for scoring (no hard limit)
      const travelTime = this.travelService.calculateTravelTime(
        { lat: employee.homeLat, lng: employee.homeLng },
        { lat: visit.clientLat, lng: visit.clientLng },
        employee.transportMode
      );

      // Find best insertion point and calculate score
      const insertion = this.findBestInsertionPoint(visit, schedule);

      if (insertion && insertion.score > bestScore) {
        bestScore = insertion.score;
        bestMatch = {
          employeeName: empName,
          score: insertion.score,
          insertionIndex: insertion.index,
        };
      }
    }

    return bestMatch;
  }

  private findBestInsertionPoint(visit: SchedulingVisit, schedule: any): { index: number; score: number } | null {
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

      const travelToPrev = this.travelService.calculateTravelTime(
        prevLocation,
        { lat: visit.clientLat, lng: visit.clientLng },
        employee.transportMode
      ).travelTimeMinutes;

      const travelToNext = nextVisit 
        ? this.travelService.calculateTravelTime(
          { lat: visit.clientLat, lng: visit.clientLng },
          { lat: nextVisit.clientLat, lng: nextVisit.clientLng },
          employee.transportMode
        ).travelTimeMinutes
        : 0;

      // Check if insertion is feasible with scheduling buffer
      const BUFFER = 10;
      const earliestStart = prevVisit ? prevVisit.actualEndTime + travelToPrev : visit.startTime;
      const latestEnd = nextVisit ? nextVisit.actualStartTime - travelToNext : visit.endTime + BUFFER;

      if (earliestStart + visit.durationMinutes <= latestEnd) {
        // Calculate score based on multiple factors
        const score = this.calculateInsertionScore(visit, employee, travelToPrev, travelToNext, i, visits.length);

        if (score > bestScore) {
          bestScore = score;
          bestInsertion = { index: i, score };
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

    // Factor 1: Minimize travel time (35% weight) - score based, not constraint
    // Use 40 minutes as reference for total travel (20 min each direction)
    const totalTravel = travelToPrev + travelToNext;
    const travelScore = Math.max(0, 1 - totalTravel / 40);
    score += travelScore * 0.35;

    // Factor 2: Time window preference (30% weight)
    // Remove time-of-day penalties - evening visits are just as valid
    // This ensures GH employees can be scheduled for evening visits
    const timePreferenceScore = visit.preferredStartTime 
      ? Math.max(0, 1 - Math.abs(visit.startTime - visit.preferredStartTime) / 180) // 3-hour tolerance for flexibility
      : 0.7; // Default higher score - all times are acceptable
    score += timePreferenceScore * 0.3;

    // Factor 3: Employee utilization (30% weight) - prioritize those with more weekly capacity remaining
    const weeklyContracted = employee.contractedDailyHours * 5; // Assume 5-day week
    const weeklyRemaining = Math.max(0, weeklyContracted - employee.scheduledHours);
    const dailyRemaining = Math.max(0, employee.contractedDailyHours - (employee.scheduledHours % employee.contractedDailyHours));

    // Score based on available capacity (both daily and weekly)
    const capacityScore = weeklyRemaining > 0 && dailyRemaining > 0 ? 
      Math.min(weeklyRemaining / weeklyContracted, dailyRemaining / employee.contractedDailyHours) : 0;

    score += capacityScore * 0.3;

    // Factor 4: Route efficiency - prefer middle insertions over start/end (10% weight)
    const routeEfficiencyScore = totalVisits > 0 
      ? 1 - Math.abs((insertionIndex / totalVisits) - 0.5) * 2
      : 1;
    score += routeEfficiencyScore * 0.1;

    return score;
  }

  private assignVisitToEmployee(
    visit: SchedulingVisit,
    assignment: { employeeName: string; score: number; insertionIndex: number },
    schedule: any
  ): ScheduledVisit {
    const prevVisit = assignment.insertionIndex > 0 ? schedule.visits[assignment.insertionIndex - 1] : null;

    const travelTimeBefore = prevVisit 
      ? this.travelService.calculateTravelTime(
          { lat: prevVisit.clientLat, lng: prevVisit.clientLng },
          { lat: visit.clientLat, lng: visit.clientLng },
          schedule.employee.transportMode
        ).travelTimeMinutes
      : 0;

    const actualStartTime = prevVisit 
      ? prevVisit.actualEndTime + travelTimeBefore
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