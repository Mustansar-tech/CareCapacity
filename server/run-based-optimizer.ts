/**
 * Run-Based Scheduling Optimizer
 * Implements true client-to-client chaining with advanced scoring
 */

export interface TimeWindow {
  start: number; // minutes since midnight
  end: number;
}

export interface Location {
  lat: number;
  lng: number;
}

export interface EmployeeRunState {
  employeeId: string;
  employeeName: string;
  homeLocation: Location;
  currentLocation: Location;
  transportMode: 'car' | 'walking' | 'public';
  timeWindows: TimeWindow[];
  bookedVisits: BookedVisit[];
  careMinutesTotal: number;
  travelMinutesTotal: number;
  availableSlots: TimeSlot[];
}

export interface BookedVisit {
  visitId: string;
  clientName: string;
  location: Location;
  startTime: number;
  endTime: number;
  duration: number;
  sequence: number;
}

export interface TimeSlot {
  start: number;
  end: number;
  afterVisitId?: string;
  beforeVisitId?: string;
}

export interface VisitCandidate {
  visitId: string;
  clientId: string;
  clientName: string;
  location: Location;
  requiredStart: number;
  requiredEnd: number;
  duration: number;
  priority: number;
  feasibleEmployees: EmployeeMatch[];
  // Add debug info for UI display
  timeWindow: string;
  originalStartTime: string | undefined;
  originalEndTime: string | undefined;
}

export interface EmployeeMatch {
  employeeId: string;
  employeeName: string;
  feasible: boolean;
  arriveTime: number;
  addedTravelMin: number;
  gapBeforeMin: number;
  gapAfterMin: number;
  leftSlackMin: number;
  rightSlackMin: number;
  careMinutesAfter: number;
  travelMinutesAfter: number;
  score: number;
  scoreBreakdown: {
    runTightness: number;
    travel: number;
    windowSlack: number;
    homeEnd: number;
  };
  insertionPoint: {
    afterVisitId?: string;
    beforeVisitId?: string;
    slotIndex: number;
  };
  badges: string[];
}

export interface RunOptimizationSettings {
  maxCareMinutes: number;
  bufferMinutes: number;
  maxTravelBetweenVisits: number;
}

export class RunBasedOptimizer {
  private settings: RunOptimizationSettings;

  constructor(settings: RunOptimizationSettings) {
    this.settings = settings;
  }

  /**
   * Calculate travel time between two locations
   */
  private calculateTravelTime(from: Location, to: Location, mode: 'car' | 'walking' | 'public'): number {
    // Haversine distance formula
    const R = 6371; // Earth's radius in km
    const dLat = (to.lat - from.lat) * Math.PI / 180;
    const dLon = (to.lng - from.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(from.lat * Math.PI / 180) * Math.cos(to.lat * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;

    // Convert to travel time based on mode
    const speedMap = {
      car: 30, // km/h average in urban areas
      walking: 5, // km/h
      public: 15 // km/h including waiting times
    };

    return Math.round((distance / speedMap[mode]) * 60); // minutes
  }

  /**
   * Find feasible insertion points for a visit in an employee's run
   */
  private findInsertionPoints(
    employee: EmployeeRunState,
    visit: VisitCandidate
  ): EmployeeMatch[] {
    const matches: EmployeeMatch[] = [];

    // Check each available slot
    for (let slotIndex = 0; slotIndex < employee.availableSlots.length; slotIndex++) {
      const slot = employee.availableSlots[slotIndex];

      // Calculate insertion details
      const match = this.calculateInsertionMatch(employee, visit, slot, slotIndex);

      if (match.feasible) {
        matches.push(match);
      }
    }

    return matches.sort((a, b) => b.score - a.score);
  }

  /**
   * Calculate detailed insertion match for a specific slot
   */
  private calculateInsertionMatch(
    employee: EmployeeRunState,
    visit: VisitCandidate,
    slot: TimeSlot,
    slotIndex: number
  ): EmployeeMatch {
    // Determine previous and next visits
    const prevVisit = slot.afterVisitId 
      ? employee.bookedVisits.find(v => v.visitId === slot.afterVisitId)
      : null;
    const nextVisit = slot.beforeVisitId
      ? employee.bookedVisits.find(v => v.visitId === slot.beforeVisitId)
      : null;

    // Calculate current location for travel calculation
    const currentLocation = prevVisit ? prevVisit.location : employee.homeLocation;

    // Calculate travel time to this visit
    const travelToVisit = this.calculateTravelTime(
      currentLocation,
      visit.location,
      employee.transportMode
    );

    // Calculate arrival time
    const earliestStart = prevVisit 
      ? prevVisit.endTime + this.settings.bufferMinutes + travelToVisit
      : slot.start + travelToVisit;

    const arriveTime = Math.max(earliestStart, visit.requiredStart);
    const departTime = arriveTime + visit.duration;

    // Calculate travel to next visit (if any)
    const travelToNext = nextVisit 
      ? this.calculateTravelTime(visit.location, nextVisit.location, employee.transportMode)
      : 0;

    // Check feasibility
    let feasible = true;
    const reasons: string[] = [];

    // Check care cap
    const careAfter = employee.careMinutesTotal + visit.duration;
    if (careAfter > this.settings.maxCareMinutes) {
      feasible = false;
      reasons.push('Care cap exceeded');
    }

    // Check time window fit
    if (arriveTime > visit.requiredEnd || departTime > slot.end) {
      feasible = false;
      reasons.push('Time window conflict');
    }

    // Check travel constraint
    if (travelToVisit > this.settings.maxTravelBetweenVisits) {
      feasible = false;
      reasons.push('Travel time too long');
    }

    // Check next visit constraint
    if (nextVisit && (departTime + this.settings.bufferMinutes + travelToNext > nextVisit.startTime)) {
      feasible = false;
      reasons.push('Conflicts with next visit');
    }

    // Calculate gaps and slack
    const gapBefore = Math.max(0, arriveTime - earliestStart);
    const gapAfter = nextVisit 
      ? Math.max(0, nextVisit.startTime - (departTime + this.settings.bufferMinutes + travelToNext))
      : 0;

    const leftSlack = arriveTime - Math.max(
      slot.start,
      visit.requiredStart,
      earliestStart
    );

    const rightSlack = Math.min(
      slot.end,
      visit.requiredEnd,
      nextVisit ? nextVisit.startTime - travelToNext - this.settings.bufferMinutes : Infinity
    ) - departTime;

    // Calculate score components (0-1 scale)
    const runTightness = this.calculateRunTightness(gapBefore, gapAfter);
    const travelScore = this.calculateTravelScore(travelToVisit, prevVisit, nextVisit, visit.location, employee);
    const windowSlack = this.calculateWindowSlack(leftSlack, rightSlack);
    const homeEnd = this.calculateHomeEndScore(visit.location, employee.homeLocation, nextVisit === null);

    // Combined score (weighted)
    const score = feasible ? (
      0.40 * runTightness +
      0.35 * travelScore +
      0.15 * windowSlack +
      0.10 * homeEnd
    ) : 0;

    // Generate badges
    const badges: string[] = [];
    if (feasible) {
      if (gapBefore + gapAfter <= 10) badges.push('✅ Tight fit');
      if (homeEnd > 0.8 && nextVisit === null) badges.push('🏠 Ends near home');
      if (employee.transportMode === 'car') badges.push('🚗 Car');
      else if (employee.transportMode === 'walking') badges.push('🚶 Walking');
    }

    return {
      employeeId: employee.employeeId,
      employeeName: employee.employeeName,
      feasible,
      arriveTime,
      addedTravelMin: travelToVisit,
      gapBeforeMin: gapBefore,
      gapAfterMin: gapAfter,
      leftSlackMin: Math.max(0, leftSlack),
      rightSlackMin: Math.max(0, rightSlack),
      careMinutesAfter: careAfter,
      travelMinutesAfter: employee.travelMinutesTotal + travelToVisit,
      score,
      scoreBreakdown: {
        runTightness,
        travel: travelScore,
        windowSlack,
        homeEnd
      },
      insertionPoint: {
        afterVisitId: slot.afterVisitId,
        beforeVisitId: slot.beforeVisitId,
        slotIndex
      },
      badges
    };
  }

  /**
   * Calculate run tightness score (0-1, higher = tighter)
   */
  private calculateRunTightness(gapBefore: number, gapAfter: number): number {
    const totalGap = gapBefore + gapAfter;
    return Math.max(0, 1 - totalGap / 60); // Penalize >60m total gaps
  }

  /**
   * Calculate travel score (0-1, higher = less travel)
   */
  private calculateTravelScore(
    travelToVisit: number,
    prevVisit: BookedVisit | null,
    nextVisit: BookedVisit | null,
    visitLocation: Location,
    employee: EmployeeRunState
  ): number {
    if (prevVisit && nextVisit) {
      // Insertion case: compare added travel vs direct travel
      const directTravel = this.calculateTravelTime(
        prevVisit.location,
        nextVisit.location,
        employee.transportMode
      );
      const newTravel = travelToVisit + this.calculateTravelTime(
        visitLocation,
        nextVisit.location,
        employee.transportMode
      );
      const addedTravel = newTravel - directTravel;
      return Math.max(0, 1 - addedTravel / 30);
    } else {
      // Append case: just penalize long travel
      return Math.max(0, 1 - travelToVisit / 30);
    }
  }

  /**
   * Calculate window slack score (0-1, higher = more robust)
   */
  private calculateWindowSlack(leftSlack: number, rightSlack: number): number {
    const minSlack = Math.min(leftSlack, rightSlack);
    return Math.min(1, Math.max(0, minSlack / 30));
  }

  /**
   * Calculate home end score (0-1, higher = closer to home at end)
   */
  private calculateHomeEndScore(visitLocation: Location, homeLocation: Location, isLastVisit: boolean): number {
    if (!isLastVisit) return 0.5; // Neutral if not last

    const homeTravel = this.calculateTravelTime(visitLocation, homeLocation, 'car');
    return Math.max(0, 1 - homeTravel / 30);
  }

  /**
   * Generate available time slots for an employee
   */
  private generateAvailableSlots(employee: EmployeeRunState): TimeSlot[] {
    const slots: TimeSlot[] = [];

    // Sort booked visits by start time
    const sortedVisits = [...employee.bookedVisits].sort((a, b) => a.startTime - b.startTime);

    for (const timeWindow of employee.timeWindows) {
      let currentTime = timeWindow.start;

      // Process each visit in this time window
      for (let i = 0; i < sortedVisits.length; i++) {
        const visit = sortedVisits[i];

        // Skip visits outside this time window
        if (visit.startTime < timeWindow.start || visit.endTime > timeWindow.end) {
          continue;
        }

        // Add slot before this visit
        if (currentTime < visit.startTime) {
          slots.push({
            start: currentTime,
            end: visit.startTime,
            beforeVisitId: visit.visitId,
            afterVisitId: i > 0 ? sortedVisits[i-1].visitId : undefined
          });
        }

        currentTime = visit.endTime;
      }

      // Add slot after last visit in window
      if (currentTime < timeWindow.end) {
        slots.push({
          start: currentTime,
          end: timeWindow.end,
          afterVisitId: sortedVisits.length > 0 ? sortedVisits[sortedVisits.length-1].visitId : undefined
        });
      }
    }

    return slots.filter(slot => slot.end - slot.start >= 30); // Minimum 30-minute slots
  }

  /**
   * Main optimization method
   */
  public optimizeRuns(
    employees: EmployeeRunState[],
    visitCandidates: VisitCandidate[]
  ): {
    employees: EmployeeRunState[];
    visitCandidates: VisitCandidate[];
    stats: {
      totalVisits: number;
      assignedVisits: number;
      unassignedVisits: number;
      averageScore: number;
      employeesUtilized: number;
      totalTravelMinutes: number;
    };
  } {
    // Generate available slots for each employee
    employees.forEach(emp => {
      emp.availableSlots = this.generateAvailableSlots(emp);
    });

    // Calculate feasible matches for each visit
    visitCandidates.forEach(visit => {
      visit.feasibleEmployees = [];

      employees.forEach(emp => {
        const matches = this.findInsertionPoints(emp, visit);
        visit.feasibleEmployees.push(...matches);
      });

      // Sort by score
      visit.feasibleEmployees.sort((a, b) => b.score - a.score);
    });

    // Calculate statistics
    const assignedVisits = visitCandidates.filter(v => v.feasibleEmployees.some(e => e.feasible)).length;
    const totalVisits = visitCandidates.length;
    const employeesUtilized = employees.filter(e => e.bookedVisits.length > 0).length;
    const totalTravelMinutes = employees.reduce((sum, e) => sum + e.travelMinutesTotal, 0);

    const allScores = visitCandidates.flatMap(v => 
      v.feasibleEmployees.filter(e => e.feasible).map(e => e.score)
    );
    const averageScore = allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;

    return {
      employees,
      visitCandidates,
      stats: {
        totalVisits,
        assignedVisits,
        unassignedVisits: totalVisits - assignedVisits,
        averageScore,
        employeesUtilized,
        totalTravelMinutes
      }
    };
  }

  /**
   * Convert time string (HH:MM) to minutes since midnight
   */
  static timeToMinutes(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  }

  /**
   * Convert minutes since midnight to time string (HH:MM)
   */
  static minutesToTime(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }
}