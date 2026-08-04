import { db } from '../infrastructure/db';
import {
  employeeLocations, clientLocations, geocodeCache,
  visits, routePlans, routeStops, travelTimeCache,
} from '@shared/schema';
import type {
  EmployeeLocation, InsertEmployeeLocation,
  ClientLocation, InsertClientLocation,
  GeocodeCache, InsertGeocode,
  Visit, InsertVisit,
  RoutePlan, InsertRoutePlan,
  RouteStop, InsertRouteStop,
  TravelTimeCache, InsertTravelTimeCache,
} from '@shared/schema';
import { eq, and, gte, lte, desc, sql, notInArray, inArray } from 'drizzle-orm';

export async function upsertEmployeeLocation(location: InsertEmployeeLocation): Promise<EmployeeLocation> {
  const [result] = await db
    .insert(employeeLocations)
    .values(location)
    .onConflictDoUpdate({
      target: [employeeLocations.branchId, employeeLocations.employeeName],
      set: {
        homePostcode: location.homePostcode,
        homeLat: location.homeLat,
        homeLng: location.homeLng,
        transportMode: location.transportMode,
        gender: location.gender,
        geocodedAt: location.homeLat && location.homeLng ? new Date() : null,
      },
    })
    .returning();
  return result;
}

export async function getEmployeeLocationByName(branchId: string, employeeName: string): Promise<EmployeeLocation | undefined> {
  const [location] = await db
    .select()
    .from(employeeLocations)
    .where(and(eq(employeeLocations.branchId, branchId), eq(employeeLocations.employeeName, employeeName)));
  return location;
}

export async function getEmployeeLocationById(id: string): Promise<EmployeeLocation | undefined> {
  const [location] = await db.select().from(employeeLocations).where(eq(employeeLocations.id, id));
  return location;
}

export async function getAllEmployeeLocations(branchId: string): Promise<EmployeeLocation[]> {
  return db.select().from(employeeLocations).where(eq(employeeLocations.branchId, branchId));
}

export async function clearEmployeeLocations(branchId: string): Promise<number> {
  const result = await db.delete(employeeLocations).where(eq(employeeLocations.branchId, branchId));
  return result.rowCount ?? 0;
}

export async function deleteEmployeeLocationsNotIn(branchId: string, activeEmployeeNames: string[]): Promise<number> {
  if (activeEmployeeNames.length === 0) return 0;

  // Find the IDs of stale employee location rows first
  const stale = await db
    .select({ id: employeeLocations.id })
    .from(employeeLocations)
    .where(
      and(
        eq(employeeLocations.branchId, branchId),
        notInArray(employeeLocations.employeeName, activeEmployeeNames),
      ),
    );

  if (stale.length === 0) return 0;

  const staleIds = stale.map(r => r.id);

  // route_plans.employee_id → employee_locations.id (ON DELETE no action)
  // route_stops cascade from route_plans automatically
  await db.delete(routePlans).where(inArray(routePlans.employeeId, staleIds));

  const result = await db
    .delete(employeeLocations)
    .where(inArray(employeeLocations.id, staleIds));

  return result.rowCount ?? 0;
}

export async function upsertClientLocation(location: InsertClientLocation): Promise<ClientLocation> {
  const [result] = await db
    .insert(clientLocations)
    .values(location)
    .onConflictDoUpdate({
      target: [clientLocations.branchId, clientLocations.clientName],
      set: {
        addressLine: location.addressLine,
        postcode: location.postcode,
        lat: location.lat,
        lng: location.lng,
        geocodedAt: location.lat && location.lng ? new Date() : null,
      },
    })
    .returning();
  return result;
}

export async function getClientLocationByName(branchId: string, clientName: string): Promise<ClientLocation | undefined> {
  const [location] = await db
    .select()
    .from(clientLocations)
    .where(and(eq(clientLocations.branchId, branchId), eq(clientLocations.clientName, clientName)));
  return location;
}

export async function getClientLocationById(id: string): Promise<ClientLocation | undefined> {
  const [location] = await db.select().from(clientLocations).where(eq(clientLocations.id, id));
  return location;
}

export async function getAllClientLocations(branchId: string): Promise<ClientLocation[]> {
  return db.select().from(clientLocations).where(eq(clientLocations.branchId, branchId));
}

export async function clearClientLocations(branchId: string): Promise<number> {
  const result = await db.delete(clientLocations).where(eq(clientLocations.branchId, branchId));
  return result.rowCount ?? 0;
}

export async function deleteClientLocationsNotIn(branchId: string, activeClientNames: string[]): Promise<number> {
  if (activeClientNames.length === 0) return 0;

  // Find the IDs of stale client location rows first
  const stale = await db
    .select({ id: clientLocations.id })
    .from(clientLocations)
    .where(
      and(
        eq(clientLocations.branchId, branchId),
        notInArray(clientLocations.clientName, activeClientNames),
      ),
    );

  if (stale.length === 0) return 0;

  const staleIds = stale.map(r => r.id);

  // visits.client_id → client_locations.id (ON DELETE no action)
  await db.delete(visits).where(inArray(visits.clientId, staleIds));

  const result = await db
    .delete(clientLocations)
    .where(inArray(clientLocations.id, staleIds));

  return result.rowCount ?? 0;
}

export async function saveVisit(visit: InsertVisit): Promise<Visit> {
  const [result] = await db.insert(visits).values(visit).returning();
  return result;
}

export async function getVisitById(id: string): Promise<Visit | undefined> {
  const [visit] = await db.select().from(visits).where(eq(visits.id, id));
  return visit;
}

export async function getVisitsByDate(branchId: string, date: string): Promise<Visit[]> {
  return db.select().from(visits).where(and(eq(visits.branchId, branchId), eq(visits.date, date)));
}

export async function getVisitsByClientAndDate(clientId: string, date: string): Promise<Visit[]> {
  return db.select().from(visits).where(and(eq(visits.clientId, clientId), eq(visits.date, date)));
}

export async function listVisitsBetween(branchId: string, startDate: string | null, endDate: string | null): Promise<Visit[]> {
  let q = db.select().from(visits).where(eq(visits.branchId, branchId)).$dynamic();
  if (startDate) q = q.where(gte(visits.date, startDate));
  if (endDate) q = q.where(lte(visits.date, endDate));
  return q;
}

export async function clearAllVisits(branchId: string): Promise<any> {
  return db.delete(visits).where(eq(visits.branchId, branchId));
}

/**
 * Delete existing visit rows for a branch on a specific set of dates.
 * Used before re-inserting freshly-extracted visits for those dates so that
 * repeated processing of the same upload doesn't accumulate duplicate rows
 * indefinitely (this was previously unbounded and grew the `visits` table
 * to hundreds of thousands of rows).
 */
export async function clearVisitsForDates(branchId: string, dates: string[]): Promise<number> {
  if (dates.length === 0) return 0;
  const result = await db
    .delete(visits)
    .where(and(eq(visits.branchId, branchId), inArray(visits.date, dates)));
  return result.rowCount ?? 0;
}

export async function clearAllRoutePlans(branchId: string): Promise<number> {
  const result = await db.delete(routePlans).where(eq(routePlans.branchId, branchId));
  return result.rowCount ?? 0;
}

export async function saveRoutePlan(plan: InsertRoutePlan): Promise<RoutePlan> {
  const [result] = await db.insert(routePlans).values(plan).returning();
  return result;
}

export async function getRoutePlansByDate(branchId: string, date: string): Promise<RoutePlan[]> {
  return db.select().from(routePlans).where(and(eq(routePlans.branchId, branchId), eq(routePlans.date, date)));
}

export async function getRoutePlanByEmployeeAndDate(employeeId: string, date: string): Promise<RoutePlan | undefined> {
  const [plan] = await db
    .select()
    .from(routePlans)
    .where(and(eq(routePlans.employeeId, employeeId), eq(routePlans.date, date)));
  return plan;
}

export async function saveRouteStop(stop: InsertRouteStop): Promise<RouteStop> {
  const [result] = await db.insert(routeStops).values(stop).returning();
  return result;
}

export async function getRouteStopsByPlan(routePlanId: string): Promise<RouteStop[]> {
  return db.select().from(routeStops).where(eq(routeStops.routePlanId, routePlanId)).orderBy(routeStops.sequence);
}

export async function getGeocode(branchId: string, key: string): Promise<GeocodeCache | undefined> {
  const [result] = await db
    .select()
    .from(geocodeCache)
    .where(and(eq(geocodeCache.branchId, branchId), eq(geocodeCache.key, key)));
  return result;
}

export async function saveGeocode(geocode: InsertGeocode): Promise<GeocodeCache> {
  const [result] = await db
    .insert(geocodeCache)
    .values(geocode)
    .onConflictDoUpdate({
      target: [geocodeCache.branchId, geocodeCache.key],
      set: { lat: geocode.lat, lng: geocode.lng, source: geocode.source, cachedAt: new Date() },
    })
    .returning();
  return result;
}

export async function clearRoutesAndVisits(branchId: string): Promise<{ routePlansDeleted: number; routeStopsDeleted: number; visitsDeleted: number }> {
  const routePlansToDelete = await db.select({ id: routePlans.id }).from(routePlans).where(eq(routePlans.branchId, branchId));
  const routePlanIds = routePlansToDelete.map(p => p.id);
  let routeStopsDeleted = 0;
  if (routePlanIds.length > 0) {
    const stopsResult = await db.delete(routeStops).where(sql`${routeStops.routePlanId} IN ${routePlanIds}`);
    routeStopsDeleted = stopsResult.rowCount ?? 0;
  }
  const plansResult = await db.delete(routePlans).where(eq(routePlans.branchId, branchId));
  const visitsResult = await db.delete(visits).where(eq(visits.branchId, branchId));
  return {
    routePlansDeleted: plansResult.rowCount ?? 0,
    routeStopsDeleted,
    visitsDeleted: visitsResult.rowCount ?? 0,
  };
}

type TransportMode = 'car' | 'walking' | 'public';

export async function getTravelTime(branchId: string, fromLat: string, fromLng: string, toLat: string, toLng: string, mode: TransportMode | string): Promise<TravelTimeCache | undefined> {
  const [result] = await db.select().from(travelTimeCache).where(
    and(
      eq(travelTimeCache.branchId, branchId),
      eq(travelTimeCache.fromLat, fromLat),
      eq(travelTimeCache.fromLng, fromLng),
      eq(travelTimeCache.toLat, toLat),
      eq(travelTimeCache.toLng, toLng),
      eq(travelTimeCache.transportMode, mode as TransportMode),
    ),
  );
  return result;
}

export async function saveTravelTime(insertTravelTime: InsertTravelTimeCache): Promise<TravelTimeCache> {
  const [result] = await db.insert(travelTimeCache).values(insertTravelTime)
    .onConflictDoUpdate({
      target: [travelTimeCache.branchId, travelTimeCache.fromLat, travelTimeCache.fromLng, travelTimeCache.toLat, travelTimeCache.toLng, travelTimeCache.transportMode],
      set: {
        durationMinutes: insertTravelTime.durationMinutes,
        distanceMeters: insertTravelTime.distanceMeters,
        source: insertTravelTime.source,
        cachedAt: new Date(),
      },
    })
    .returning();
  return result;
}
