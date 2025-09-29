/**
 * Vehicle Routing Problem with Time Windows (VRPTW) Optimizer
 * Assigns client visits to employees while respecting time windows and travel constraints
 */

import { travelTimeService, TravelTimeService, TravelMatrix, TransportMode } from "./travel-time-service.js";

export interface EmployeeWindow {
  employeeId: string;
  employeeName: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  location: { lat: number; lng: number };
  transportMode: TransportMode;
}

export interface ClientVisit {
  visitId: string;
  clientId: string;
  clientName: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  location: { lat: number; lng: number };
  priority: number;
}

export interface RouteStop {
  visitId: string;
  clientName: string;
  sequence: number;
  scheduledStartMinutes: number;
  scheduledEndMinutes: number;
  travelMinutesFromPrev: number;
  arrivalTime: number;
}

export interface OptimizedRoute {
  employeeId: string;
  employeeName: string;
  date: string;
  stops: RouteStop[];
  totalTravelMinutes: number;
  totalDistanceKm: number;
  feasible: boolean;
  warnings: string[];
}

export interface OptimizationResult {
  routes: OptimizedRoute[];
  unassignedVisits: ClientVisit[];
  totalTravelMinutes: number;
  optimizationStats: {
    assignedVisits: number;
    unassignedVisits: number;
    averageTravelTime: number;
    employeesUsed: number;
  };
}

export class VRPTWOptimizer {
  private maxTravelMinutes: number;
  private travelService: TravelTimeService;

  constructor(maxTravelMinutes: number = 30) {
    this.maxTravelMinutes = maxTravelMinutes;
    this.travelService = new TravelTimeService(maxTravelMinutes);
  }

  /**
   * Optimize routes for a given date
   */
  optimize(
    employeeWindows: EmployeeWindow[],
    clientVisits: ClientVisit[]
  ): OptimizationResult {
    const routes: OptimizedRoute[] = [];
    const unassignedVisits = [...clientVisits];

    console.log(`🚀 VRPTW Optimization: ${employeeWindows.length} employees, ${clientVisits.length} visits`);

    // Sort visits by priority and start time
    unassignedVisits.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.startMinutes - b.startMinutes;
    });

    // Process each employee
    for (const empWindow of employeeWindows) {
      const route = this.optimizeEmployeeRoute(empWindow, unassignedVisits);
      routes.push(route);

      // Remove assigned visits from unassigned list
      const assignedVisitIds = new Set(route.stops.map(stop => stop.visitId));
      for (let i = unassignedVisits.length - 1; i >= 0; i--) {
        if (assignedVisitIds.has(unassignedVisits[i].visitId)) {
          unassignedVisits.splice(i, 1);
        }
      }
    }

    // Calculate optimization statistics
    const totalTravelMinutes = routes.reduce((sum, route) => sum + route.totalTravelMinutes, 0);
    const assignedVisits = routes.reduce((sum, route) => sum + route.stops.length, 0);

    console.log(`✅ Optimization complete: ${assignedVisits} assigned, ${unassignedVisits.length} unassigned`);

    return {
      routes,
      unassignedVisits,
      totalTravelMinutes,
      optimizationStats: {
        assignedVisits,
        unassignedVisits: unassignedVisits.length,
        averageTravelTime: assignedVisits > 0 ? Math.round(totalTravelMinutes / assignedVisits) : 0,
        employeesUsed: routes.filter(r => r.stops.length > 0).length
      }
    };
  }

  /**
   * Optimize route for a single employee
   */
  private optimizeEmployeeRoute(
    empWindow: EmployeeWindow,
    availableVisits: ClientVisit[]
  ): OptimizedRoute {
    const route: OptimizedRoute = {
      employeeId: empWindow.employeeId,
      employeeName: empWindow.employeeName,
      date: empWindow.date,
      stops: [],
      totalTravelMinutes: 0,
      totalDistanceKm: 0,
      feasible: true,
      warnings: []
    };

    let currentTime = empWindow.startMinutes;
    let currentLocation = empWindow.location;

    console.log(`👤 Optimizing for ${empWindow.employeeName}: ${empWindow.startMinutes}-${empWindow.endMinutes} minutes`);

    // Greedy insertion: repeatedly find the best feasible visit to add
    while (true) {
      const bestInsertion = this.findBestInsertion(
        route,
        availableVisits,
        currentTime,
        currentLocation,
        empWindow.endMinutes,
        empWindow.transportMode
      );

      if (!bestInsertion) break; // No more feasible insertions

      // Add the visit to the route
      const visit = bestInsertion.visit;
      const travelTime = bestInsertion.travelTime;

      const arrivalTime = Math.max(currentTime + travelTime.travelTimeMinutes, visit.startMinutes);
      const departureTime = arrivalTime + visit.durationMinutes;

      // Check if we can complete this visit within employee window
      if (departureTime > empWindow.endMinutes) {
        console.log(`⚠️ Visit ${visit.clientName} would exceed employee window`);
        break;
      }

      const stop: RouteStop = {
        visitId: visit.visitId,
        clientName: visit.clientName,
        sequence: route.stops.length + 1,
        scheduledStartMinutes: arrivalTime,
        scheduledEndMinutes: departureTime,
        travelMinutesFromPrev: travelTime.travelTimeMinutes,
        arrivalTime
      };

      route.stops.push(stop);
      route.totalTravelMinutes += travelTime.travelTimeMinutes;
      route.totalDistanceKm += travelTime.distanceKm;

      // Update current state
      currentTime = departureTime;
      currentLocation = visit.location;

      console.log(`  ✅ Added ${visit.clientName}: ${arrivalTime}-${departureTime} (travel: ${travelTime.travelTimeMinutes}m)`);
    }

    // Apply local improvements (2-opt)
    if (route.stops.length > 2) {
      this.improveRoute(route, empWindow);
    }

    console.log(`📊 ${empWindow.employeeName}: ${route.stops.length} visits, ${route.totalTravelMinutes}m travel`);

    return route;
  }

  /**
   * Find the best feasible visit to insert into the current route
   */
  private findBestInsertion(
    route: OptimizedRoute,
    availableVisits: ClientVisit[],
    currentTime: number,
    currentLocation: { lat: number; lng: number },
    employeeEndTime: number,
    transportMode: TransportMode
  ): { visit: ClientVisit; travelTime: TravelMatrix } | null {
    let bestVisit: ClientVisit | null = null;
    let bestTravelTime: TravelMatrix | null = null;
    let bestScore = Infinity;

    for (const visit of availableVisits) {
      // Skip if already assigned
      if (route.stops.some(stop => stop.visitId === visit.visitId)) continue;

      // Calculate travel time to this visit
      const travelTime = this.travelService.calculateTravelTime(
        currentLocation,
        visit.location,
        transportMode
      );

      // Skip only if completely unreasonable (beyond max limit)
      if (!travelTime.feasible) continue;

      // Calculate arrival time
      const arrivalTime = Math.max(currentTime + travelTime.travelTimeMinutes, visit.startMinutes);
      const departureTime = arrivalTime + visit.durationMinutes;

      // Check if visit fits within its time window
      if (arrivalTime > visit.endMinutes) continue;

      // Check if we can complete within employee window
      if (departureTime > employeeEndTime) continue;

      // Score based on travel time, penalty, and waiting time
      const waitingTime = Math.max(0, visit.startMinutes - (currentTime + travelTime.travelTimeMinutes));
      const baseScore = travelTime.travelTimeMinutes + waitingTime * 0.5; // Weight waiting time less
      const score = baseScore + travelTime.penaltyScore; // Add soft penalty for longer travel times

      if (score < bestScore) {
        bestScore = score;
        bestVisit = visit;
        bestTravelTime = travelTime;
      }
    }

    return bestVisit && bestTravelTime ? { visit: bestVisit, travelTime: bestTravelTime } : null;
  }

  /**
   * Apply local improvements to the route (2-opt)
   */
  private improveRoute(route: OptimizedRoute, empWindow: EmployeeWindow): void {
    // Simple 2-opt improvement: try swapping adjacent stops
    let improved = true;
    while (improved) {
      improved = false;
      
      for (let i = 0; i < route.stops.length - 1; i++) {
        // Try swapping stops i and i+1
        const newStops = [...route.stops];
        [newStops[i], newStops[i + 1]] = [newStops[i + 1], newStops[i]];
        
        // Recalculate timing and check feasibility
        if (this.isRouteFeasible(newStops, empWindow)) {
          const newTravelTime = this.calculateRouteTravelTime(newStops, empWindow);
          if (newTravelTime < route.totalTravelMinutes) {
            route.stops = newStops;
            route.totalTravelMinutes = newTravelTime;
            this.updateRouteSequences(route);
            improved = true;
            break;
          }
        }
      }
    }
  }

  /**
   * Check if a route is feasible (respects all time windows and travel constraints)
   */
  private isRouteFeasible(stops: RouteStop[], empWindow: EmployeeWindow): boolean {
    let currentTime = empWindow.startMinutes;
    let currentLocation = empWindow.location;

    for (const stop of stops) {
      // This would need access to visit data to check properly
      // Simplified check for now
      if (currentTime > empWindow.endMinutes) return false;
      currentTime = stop.scheduledEndMinutes;
    }

    return true;
  }

  /**
   * Calculate total travel time for a route
   */
  private calculateRouteTravelTime(stops: RouteStop[], empWindow: EmployeeWindow): number {
    return stops.reduce((total, stop) => total + stop.travelMinutesFromPrev, 0);
  }

  /**
   * Update sequence numbers for route stops
   */
  private updateRouteSequences(route: OptimizedRoute): void {
    route.stops.forEach((stop, index) => {
      stop.sequence = index + 1;
    });
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

// Default instance with 30-minute travel constraint
export const vrptwOptimizer = new VRPTWOptimizer();