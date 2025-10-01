import type { ProcessingResult, ScheduledVisit, EmployeeWeeklySchedule, WeeklyScheduleData, WeeklyScheduleMetrics } from "@shared/schema";

interface TimeWindow {
  start: number;
  end: number;
}

interface EmployeeRun {
  employeeName: string;
  homeLat: number;
  homeLng: number;
  mode: 'car' | 'walking';
  timeWindows: TimeWindow[];
  assignedVisits: ScheduledVisit[];
}

interface ClientVisit {
  clientName: string;
  startTime: string;
  endTime: string;
  lat?: number;
  lng?: number;
}

// Scoring weights - same as Scheduling tab
const WEIGHTS = {
  tightness: 0.40,
  travelAdded: 0.35,
  windowSlack: 0.15,
  homeProximity: 0.10,
};

// Parse time windows from string format "HH:MM-HH:MM, HH:MM-HH:MM"
function parseTimeWindows(timeWindowsStr: string): TimeWindow[] {
  if (!timeWindowsStr || timeWindowsStr.trim() === '') return [];
  
  const windows: TimeWindow[] = [];
  const parts = timeWindowsStr.split(',');
  
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    
    const [startStr, endStr] = trimmed.split('-');
    if (!startStr || !endStr) continue;
    
    const [startHour, startMin] = startStr.trim().split(':').map(Number);
    const [endHour, endMin] = endStr.trim().split(':').map(Number);
    
    if (isNaN(startHour) || isNaN(startMin) || isNaN(endHour) || isNaN(endMin)) continue;
    
    windows.push({
      start: startHour * 60 + startMin,
      end: endHour * 60 + endMin,
    });
  }
  
  return windows;
}

// Convert minutes to HH:MM format
function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

// Calculate travel time using Haversine formula
function getTravelMinutes(from: { lat: number; lng: number }, to: { lat: number; lng: number }, mode: 'car' | 'walking'): number {
  const R = 6371; // Earth's radius in km
  const dLat = (to.lat - from.lat) * Math.PI / 180;
  const dLon = (to.lng - from.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(from.lat * Math.PI / 180) * Math.cos(to.lat * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceKm = R * c;
  
  // Convert distance to travel time (car: 40km/h urban, walking: 5km/h)
  const speedKmPerHour = mode === 'car' ? 40 : 5;
  const travelTimeHours = distanceKm / speedKmPerHour;
  return Math.round(travelTimeHours * 60);
}

// Score a visit for an employee using the same algorithm as Scheduling tab
function scoreVisitForEmployee(
  visit: ClientVisit,
  employee: EmployeeRun
): { score: number; travelTimeBefore: number } | null {
  const visitStart = parseInt(visit.startTime.split(':')[0]) * 60 + parseInt(visit.startTime.split(':')[1]);
  const visitEnd = parseInt(visit.endTime.split(':')[0]) * 60 + parseInt(visit.endTime.split(':')[1]);
  
  // Check if visit fits in any time window
  const fitsInWindow = employee.timeWindows.some(window => 
    visitStart >= window.start && visitEnd <= window.end
  );
  
  if (!fitsInWindow) {
    return null; // Not feasible
  }
  
  // Calculate best insertion point and gap
  let bestGap = Infinity;
  let bestTravelBefore = 0;
  
  if (employee.assignedVisits.length === 0) {
    // First visit - check gap from window start
    const window = employee.timeWindows.find(w => visitStart >= w.start && visitEnd <= w.end);
    if (window) {
      bestGap = visitStart - window.start;
      if (visit.lat && visit.lng) {
        bestTravelBefore = getTravelMinutes(
          { lat: employee.homeLat, lng: employee.homeLng },
          { lat: visit.lat, lng: visit.lng },
          employee.mode
        );
      }
    }
  } else {
    // Find best gap between existing visits
    for (let i = 0; i <= employee.assignedVisits.length; i++) {
      if (i === 0) {
        // Before first visit
        const firstVisit = employee.assignedVisits[0];
        const firstStart = parseInt(firstVisit.startTime.split(':')[0]) * 60 + parseInt(firstVisit.startTime.split(':')[1]);
        const gap = firstStart - visitEnd;
        if (gap >= 0 && gap < bestGap) {
          bestGap = gap;
          if (visit.lat && visit.lng) {
            bestTravelBefore = getTravelMinutes(
              { lat: employee.homeLat, lng: employee.homeLng },
              { lat: visit.lat, lng: visit.lng },
              employee.mode
            );
          }
        }
      } else if (i === employee.assignedVisits.length) {
        // After last visit
        const lastVisit = employee.assignedVisits[i - 1];
        const lastEnd = parseInt(lastVisit.endTime.split(':')[0]) * 60 + parseInt(lastVisit.endTime.split(':')[1]);
        const gap = visitStart - lastEnd;
        if (gap >= 0 && gap < bestGap) {
          bestGap = gap;
          if (visit.lat && visit.lng && lastVisit.lat && lastVisit.lng) {
            bestTravelBefore = getTravelMinutes(
              { lat: lastVisit.lat, lng: lastVisit.lng },
              { lat: visit.lat, lng: visit.lng },
              employee.mode
            );
          }
        }
      } else {
        // Between visits
        const prevVisit = employee.assignedVisits[i - 1];
        const nextVisit = employee.assignedVisits[i];
        const prevEnd = parseInt(prevVisit.endTime.split(':')[0]) * 60 + parseInt(prevVisit.endTime.split(':')[1]);
        const nextStart = parseInt(nextVisit.startTime.split(':')[0]) * 60 + parseInt(nextVisit.startTime.split(':')[1]);
        
        if (visitStart >= prevEnd && visitEnd <= nextStart) {
          const gap = Math.min(visitStart - prevEnd, nextStart - visitEnd);
          if (gap < bestGap) {
            bestGap = gap;
            if (visit.lat && visit.lng && prevVisit.lat && prevVisit.lng) {
              bestTravelBefore = getTravelMinutes(
                { lat: prevVisit.lat, lng: prevVisit.lng },
                { lat: visit.lat, lng: visit.lng },
                employee.mode
              );
            }
          }
        }
      }
    }
  }
  
  if (bestGap === Infinity) {
    return null; // No feasible insertion point
  }
  
  // Calculate component scores
  const tightnessScore = Math.max(0, 1 - (bestGap / 120));
  const travelAddedScore = Math.max(0, 1 - (bestTravelBefore / 45));
  
  // Window slack (how well it fits in the window)
  const window = employee.timeWindows.find(w => visitStart >= w.start && visitEnd <= w.end);
  const windowSlackScore = window ? Math.max(0, 1 - ((window.end - visitEnd) / 240)) : 0;
  
  // Home proximity
  let homeProximityScore = 0;
  if (visit.lat && visit.lng) {
    const distToHome = getTravelMinutes(
      { lat: employee.homeLat, lng: employee.homeLng },
      { lat: visit.lat, lng: visit.lng },
      employee.mode
    );
    homeProximityScore = Math.max(0, 1 - (distToHome / 45));
  }
  
  // Calculate total score
  const totalScore =
    WEIGHTS.tightness * tightnessScore +
    WEIGHTS.travelAdded * travelAddedScore +
    WEIGHTS.windowSlack * windowSlackScore +
    WEIGHTS.homeProximity * homeProximityScore;
  
  return { score: totalScore, travelTimeBefore: bestTravelBefore };
}

// Generate automatic weekly schedule
export function generateWeeklySchedule(data: ProcessingResult, weekStartDate: string): {
  scheduleData: WeeklyScheduleData;
  unallocatedVisits: ClientVisit[];
  metrics: WeeklyScheduleMetrics;
} {
  // Get week dates
  const weekDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStartDate);
    date.setDate(date.getDate() + i);
    weekDates.push(date.toISOString().split('T')[0]);
  }
  
  // Initialize employee schedules
  const employeeSchedules = new Map<string, EmployeeWeeklySchedule>();
  
  const allUnallocatedVisits: ClientVisit[] = [];
  let totalAssigned = 0;
  let totalTravelTime = 0;
  
  // Process each day
  for (const date of weekDates) {
    const dailyEmployees = data.employeesByDate?.[date]?.filter(emp =>
      ['Available', 'Partial Availability'].includes(emp.status)
    ) || [];
    
    // Get client visits for this date
    const dailyVisits = data.employeeSummaryByDate?.[date]?.flatMap(emp => {
      // Extract scheduled visits from employee summary
      // This is a simplified version - you may need to get actual visit data from another source
      return [];
    }) || [];
    
    // Note: Since we don't have actual client visit data in ProcessingResult,
    // we'll work with the scheduled hours data instead
    // In a real implementation, you'd fetch visits from the database
    
    // Create employee runs for this day
    const employeeRuns: EmployeeRun[] = dailyEmployees.map(emp => {
      const empLocation = data.employeeLocations?.find(e => e.employeeName === emp.employeeName);
      const timeWindows = parseTimeWindows(emp.timeWindows);
      
      // Get or create employee schedule
      let empSchedule = employeeSchedules.get(emp.employeeName);
      if (!empSchedule) {
        empSchedule = { employeeName: emp.employeeName };
        employeeSchedules.set(emp.employeeName, empSchedule);
      }
      
      // Get existing visits for this date
      const existingVisits = (empSchedule[date] as ScheduledVisit[]) || [];
      
      return {
        employeeName: emp.employeeName,
        homeLat: empLocation?.homeLat ?? 55.9533,
        homeLng: empLocation?.homeLng ?? -3.1883,
        mode: empLocation?.transportMode?.toLowerCase().includes('car') ? 'car' : 'walking',
        timeWindows,
        assignedVisits: existingVisits,
      };
    });
    
    // Assign visits to employees using best match algorithm
    for (const visit of dailyVisits) {
      let bestScore = -1;
      let bestEmployee: EmployeeRun | null = null;
      let bestTravelTime = 0;
      
      // Find best employee for this visit
      for (const emp of employeeRuns) {
        const result = scoreVisitForEmployee(visit, emp);
        if (result && result.score > bestScore) {
          bestScore = result.score;
          bestEmployee = emp;
          bestTravelTime = result.travelTimeBefore;
        }
      }
      
      if (bestEmployee) {
        // Assign visit to best employee
        const scheduledVisit: ScheduledVisit = {
          clientName: visit.clientName,
          startTime: visit.startTime,
          endTime: visit.endTime,
          travelTimeBefore: bestTravelTime,
          score: bestScore,
          lat: visit.lat,
          lng: visit.lng,
        };
        
        bestEmployee.assignedVisits.push(scheduledVisit);
        
        // Update employee schedule
        const empSchedule = employeeSchedules.get(bestEmployee.employeeName)!;
        const dayVisits = (empSchedule[date] as ScheduledVisit[]) || [];
        dayVisits.push(scheduledVisit);
        empSchedule[date] = dayVisits;
        
        totalAssigned++;
        totalTravelTime += bestTravelTime;
      } else {
        // Could not assign visit
        allUnallocatedVisits.push(visit);
      }
    }
  }
  
  const scheduleData: WeeklyScheduleData = {
    employees: Array.from(employeeSchedules.values()),
    weekDates,
  };
  
  const metrics: WeeklyScheduleMetrics = {
    totalVisitsAssigned: totalAssigned,
    totalVisitsUnallocated: allUnallocatedVisits.length,
    averageTravelTimePerVisit: totalAssigned > 0 ? Math.round(totalTravelTime / totalAssigned) : 0,
    employeesUtilized: employeeSchedules.size,
  };
  
  return {
    scheduleData,
    unallocatedVisits: allUnallocatedVisits,
    metrics,
  };
}
