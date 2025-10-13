
import { storage } from "./storage";
import { TravelTimeService } from "./travel-time-service";

// Parse time windows from string format "HH:MM-HH:MM" or array of such strings
interface TimeWindow {
  start: number; // minutes since midnight
  end: number;   // minutes since midnight
}

function parseTimeWindows(windows: string | string[]): TimeWindow[] {
  const windowArray = Array.isArray(windows) ? windows : [windows];

  return windowArray
    .filter(w => w && typeof w === 'string')
    .map(w => {
      const match = w.match(/(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/);
      if (!match) return null;
      
      const timeToMinutes = (time: string): number => {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
      };

      return {
        start: timeToMinutes(match[1]),
        end: timeToMinutes(match[2]),
      };
    })
    .filter((w): w is TimeWindow => w !== null);
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

    const unassignedVisits: SchedulingVisit[] = [];

    // Assign visits using greedy algorithm with optimization
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
        
        employees.push({
          employeeName: emp.employeeName,
          homeLat: parseFloat(emp.homeLat),
          homeLng: parseFloat(emp.homeLng),
          transportMode: (emp.transportMode?.toLowerCase().includes('car') ? 'car' : 
                        emp.transportMode?.toLowerCase().includes('walk') ? 'walking' : 'car') as any,
          availabilityWindows: availabilityWindows.map(w => ({ start: w.start, end: w.end })),
          contractedDailyHours: availability.contractedDailyHours || 8,
          scheduledHours: availability.scheduledHours || 0,
          maxTravelPerVisit: 20, // Strict 20-minute limit for all transport modes
        });
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
  }>> {
    try {
      // Get the latest capacity analysis from storage
      const analyses = await storage.getCapacityAnalyses();
      if (analyses.length === 0) return [];

      const latestAnalysis = analyses[0]; // Most recent analysis
      const employeesByDate = latestAnalysis.employeesByDate || {};
      const employeeSummaryByDate = latestAnalysis.employeeSummaryByDate || {};

      const dateEmployees = employeesByDate[date] || [];
      const dateSummary = employeeSummaryByDate[date] || [];

      return dateEmployees.map(emp => {
        const summary = dateSummary.find(s => s.employeeName === emp.employeeName);
        const isAvailable = ['Available', 'Partial Availability', 'Ad-hoc'].includes(emp.status);

        return {
          employeeName: emp.employeeName,
          isAvailable,
          timeWindows: emp.timeWindows || '',
          contractedDailyHours: emp.contractedDailyHours || 8,
          scheduledHours: summary?.scheduledHours || emp.scheduledHours || 0,
        };
      });
    } catch (error) {
      console.error('Error getting employee availability:', error);
      return [];
    }
  }

  private async getUnassignedVisits(date: string): Promise<SchedulingVisit[]> {
    try {
      const [visits, clientLocations] = await Promise.all([
        storage.listVisitsBetween(date, date),
        storage.getAllClientLocations()
      ]);

      const clientLocationMap = new Map(clientLocations.map(c => [c.clientName, c]));

      return visits
        .filter(visit => visit.date === date && visit.clientName) // Filter out visits without client names
        .map(visit => {
          const client = clientLocationMap.get(visit.clientName);
          
          if (!client || !client.lat || !client.lng) {
            console.warn(`⚠️ Missing location data for client ${visit.clientName}`);
            return null;
          }

          return {
            id: visit.id || `${visit.clientName}-${visit.date}`,
            clientName: visit.clientName,
            clientLat: parseFloat(client.lat),
            clientLng: parseFloat(client.lng),
            startTime: this.timeStringToMinutes(visit.preferredStartTime || '09:00'),
            endTime: this.timeStringToMinutes(visit.preferredEndTime || '10:00'),
            durationMinutes: visit.durationMinutes || 60,
            priority: visit.priority || 2,
            serviceType: visit.serviceType || '',
            preferredStartTime: this.timeStringToMinutes(visit.preferredStartTime || ''),
            preferredEndTime: this.timeStringToMinutes(visit.preferredEndTime || ''),
          };
        })
        .filter((visit): visit is SchedulingVisit => visit !== null);
    } catch (error) {
      console.error('Error getting unassigned visits:', error);
      return [];
    }
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

    for (const [empName, schedule] of employeeSchedules) {
      const employee = schedule.employee;
      
      // Check if employee can reach this client within travel limits
      const travelTime = this.travelService.calculateTravelTime(
        { lat: employee.homeLat, lng: employee.homeLng },
        { lat: visit.clientLat, lng: visit.clientLng },
        employee.transportMode
      );

      if (travelTime.travelTimeMinutes > employee.maxTravelPerVisit) {
        continue; // Too far to travel
      }

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

      // Check if insertion is feasible
      const earliestStart = prevVisit ? prevVisit.actualEndTime + travelToPrev : visit.startTime;
      const latestEnd = nextVisit ? nextVisit.actualStartTime - travelToNext : visit.endTime;

      if (earliestStart + visit.durationMinutes <= latestEnd) {
        // Calculate score based on multiple factors
        const score = this.calculateInsertionScore(visit, employee, travelToPrev, travelToNext, i, visits.length);
        
        if (score > 0) {
          return { index: i, score };
        }
      }
    }

    return null;
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

    // Factor 1: Minimize travel time (40% weight)
    const maxTravelTime = 45; // minutes
    const totalTravel = travelToPrev + travelToNext;
    const travelScore = Math.max(0, 1 - totalTravel / maxTravelTime);
    score += travelScore * 0.4;

    // Factor 2: Time window preference (30% weight)
    const timePreferenceScore = visit.preferredStartTime 
      ? Math.max(0, 1 - Math.abs(visit.startTime - visit.preferredStartTime) / 120) // 2-hour tolerance
      : 0.5;
    score += timePreferenceScore * 0.3;

    // Factor 3: Employee utilization (20% weight)
    const currentUtilization = employee.scheduledHours / employee.contractedDailyHours;
    const utilizationScore = currentUtilization < 0.8 ? 1 : Math.max(0, 1 - (currentUtilization - 0.8) / 0.2);
    score += utilizationScore * 0.2;

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
