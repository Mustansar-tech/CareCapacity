import { useState, useEffect, useCallback } from "react";
import { clientLogger } from '@/lib/logger';
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Calendar, Zap, Loader2, Car, User, MapPin, Clock, Search, Plus, Home, ArrowRight, Info, Lock } from "lucide-react";
import { getGenderColorClass } from "@/utils/gender-colors";
import { minutesToTime, timeToMinutes, getTravelMinutes, seedTravelCache, clearTravelCache, haversineDistance, calculateTravelTime, parseTimeWindows } from "@/utils/scheduling-utils";
import type { ProcessingResult, ClientVisit, EmployeeLocation, ClientLocation } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getCanonicalWeekBoundaries } from "@shared/schema";
import { generateWeeklySchedule } from "@/utils/scheduling-engine";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface WeeklyPlanTabProps {
  data: ProcessingResult | null;
  selectedDate?: string | null;
}

interface AssignedVisit {
  id: string;
  clientName: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  lat?: number;
  lng?: number;
  travelTimeBefore: number;
  travelTimeAfter?: number;
  score: number;
}

interface WeeklyScheduleData {
  assignments: Record<string, Record<string, AssignedVisit[]>>; // date -> employee -> visits
  unallocated: Array<ClientVisit & { unallocatedReason: string }>; // Updated property name
  metrics: {
    totalVisitsAssigned: number;
    totalVisitsUnallocated: number;
    averageTravelTimePerVisit: number;
    employeesUtilized: number;
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

export function WeeklyPlanTab({ data, selectedDate }: WeeklyPlanTabProps) {
  const { toast } = useToast();
  const { canGenerate } = useAuth();
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [weeklySchedule, setWeeklySchedule] = useState<WeeklyScheduleData | null>(null);
  const [travelSources, setTravelSources] = useState<Record<string, number> | null>(null);
  const [isRefiningWalkers, setIsRefiningWalkers] = useState(false);

  // Get week boundaries - default to current week if no date selected
  const currentWeek = selectedDate || new Date().toISOString().split('T')[0];
  const { weekStart, weekEnd } = getCanonicalWeekBoundaries(currentWeek);

  // Generate week dates array (Mon-Sun)
  const weekDates = (() => {
    const dates: string[] = [];
    const start = new Date(weekStart + 'T00:00:00.000Z');
    for (let i = 0; i < 7; i++) {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + i);
      dates.push(date.toISOString().split('T')[0]);
    }
    return dates;
  })();

  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  // Fetch locations
  const { data: locationsData } = useQuery<{ employees: EmployeeLocation[]; clients: ClientLocation[] }>({
    queryKey: ['/api/locations'],
    enabled: !!data,
  });

  // Create a map of employee locations for quick lookup
  const employeeLocationMap = new Map(
    (locationsData?.employees || []).map(emp => [emp.employeeName, emp])
  );

  // Fetch visits for each day of the week
  const visitQueries = weekDates.map(date => 
    useQuery<ClientVisit[]>({
      queryKey: ['/api/visits', date],
      enabled: !!data && weekDates.length > 0,
    })
  );

  const isLoadingVisits = visitQueries.some(q => q.isLoading);
  const allWeekVisits = visitQueries.flatMap(q => q.data || []);

  // Calculate weekly hours and net capacity from daily availability across all days employee appears
  const employeeWeeklyHoursMap = new Map<string, number>();
  const employeeWeeklyNetCapacityMap = new Map<string, number>();
  const employeeGenderMap = new Map<string, string>();

  // Track holidays and unavailability per employee
  const employeeHolidaysMap = new Map<string, number>();
  const employeeUnavailabilityMap = new Map<string, number>();

  // Calculate guaranteed hours (GH) from contracted daily hours
  Object.values(data?.employeesByDate || {}).forEach(dayEmployees => {
    dayEmployees.forEach(emp => {
      if (emp.contractedDailyHours > 0) {
        const current = employeeWeeklyHoursMap.get(emp.employeeName) || 0;
        employeeWeeklyHoursMap.set(emp.employeeName, current + emp.contractedDailyHours);
      }
      // Store gender info
      if (emp.gender && !employeeGenderMap.has(emp.employeeName)) {
        employeeGenderMap.set(emp.employeeName, emp.gender);
      }
      // Track holidays and unavailability from status
      const statusLower = (emp.status || '').toLowerCase();
      if (statusLower.includes('holiday') || statusLower.includes('annual leave')) {
        const current = employeeHolidaysMap.get(emp.employeeName) || 0;
        employeeHolidaysMap.set(emp.employeeName, current + 1);
      } else if (statusLower.includes('unavailable') || statusLower.includes('sick') || statusLower.includes('off')) {
        const current = employeeUnavailabilityMap.get(emp.employeeName) || 0;
        employeeUnavailabilityMap.set(emp.employeeName, current + 1);
      }
    });
  });

  // Calculate net capacity from employee details data (netCapacity column)
  Object.entries(data?.employeesByDate || {}).forEach(([date, employees]) => {
    employees.forEach(emp => {
      // Use the netCapacity field directly from Employee Details
      const dayNetCapacity = emp.netCapacity || 0;
      const current = employeeWeeklyNetCapacityMap.get(emp.employeeName) || 0;
      employeeWeeklyNetCapacityMap.set(emp.employeeName, current + dayNetCapacity);
    });
  });

  // Get all unique employees who have real availability in the week (exclude ad-hoc)
  // Use a Map to deduplicate by employee name and prefer records with more data
  const employeeMap = new Map<string, any>();
  const adHocEmployees = new Set<string>();

  Object.values(data?.employeesByDate || {}).flat().forEach(emp => {
    // Track ad-hoc employees to exclude them from picker
    if (emp.status === 'Ad-hoc') {
      adHocEmployees.add(emp.employeeName);
    }

    // Only include employees with real availability (not ad-hoc), time windows, and guaranteed hours > 0
    if (emp.timeWindows && emp.timeWindows.trim() !== '' && emp.status !== 'Ad-hoc' && (employeeWeeklyHoursMap.get(emp.employeeName) || 0) > 0) {
      const existing = employeeMap.get(emp.employeeName);
      // Keep the entry with more contracted hours (prefer non-ad-hoc entries)
      if (!existing || emp.contractedDailyHours > (existing.contractedDailyHours || 0)) {
        employeeMap.set(emp.employeeName, emp);
      }
    }
  });

  const availableEmployees = Array.from(employeeMap.values());

  // Build the list of GH employees who are fully absent this week (no time windows on any day)
  // These are shown greyed-out at the bottom of the sidebar for awareness.
  const absentGhEmployeeMap = new Map<string, { gh: number; status: string }>();
  Object.values(data?.employeesByDate || {}).flat().forEach(emp => {
    if (
      (employeeWeeklyHoursMap.get(emp.employeeName) || 0) > 0 &&
      emp.status !== 'Ad-hoc' &&
      !employeeMap.has(emp.employeeName) &&
      !absentGhEmployeeMap.has(emp.employeeName)
    ) {
      absentGhEmployeeMap.set(emp.employeeName, {
        gh: employeeWeeklyHoursMap.get(emp.employeeName) || 0,
        status: emp.status || 'Unavailable',
      });
    }
  });
  const absentGhEmployees = Array.from(absentGhEmployeeMap.entries())
    .map(([name, info]) => ({ name, ...info }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Get employees with assignments from the weekly schedule (exclude ad-hoc and 0-GH)
  const employeesWithAssignments = weeklySchedule 
    ? Array.from(new Set(
        Object.values(weeklySchedule.assignments)
          .flatMap(dateAssignments => Object.keys(dateAssignments))
      ))
      .filter(empName => !adHocEmployees.has(empName) && (employeeWeeklyHoursMap.get(empName) || 0) > 0)
      .sort()
    : [];

  // Combine and deduplicate employee names (already filtered for non-ad-hoc)
  const employeeNames = weeklySchedule 
    ? Array.from(new Set([...employeesWithAssignments, ...availableEmployees.map(e => e.employeeName)])).sort()
    : availableEmployees.map(e => e.employeeName).sort();

  const filteredEmployees = employeeNames.filter(empName =>
    empName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Generate weekly schedule mutation
  const generateMutation = useMutation({
    mutationFn: async () => {
      clientLogger.log(`📅 Generating weekly schedule for ${weekDates.length} days with ${allWeekVisits.length} visits`);

      // Prepare employee data with locations and weekly hours
      // Employees with 0 GH (guaranteed hours) are excluded — they have no contracted capacity
      const employeesWithLocations = Object.entries(data?.employeesByDate || {}).flatMap(([date, empList]) => 
        empList
          .filter(emp => (employeeWeeklyHoursMap.get(emp.employeeName) || 0) > 0)
          .map(emp => {
            const location = locationsData?.employees.find(loc => loc.employeeName === emp.employeeName);
            const weeklyHours = employeeWeeklyHoursMap.get(emp.employeeName) || 0;
            return {
              employeeName: emp.employeeName,
              date,
              timeWindows: emp.timeWindows,
              homeLat: location?.homeLat ? Number(location.homeLat) : undefined,
              homeLng: location?.homeLng ? Number(location.homeLng) : undefined,
              transportMode: location?.transportMode || undefined,
              weeklyContractedHours: weeklyHours,
              gender: emp.gender || (location ? location.gender : undefined),
            };
          })
      );

      // Add location data to visits
      const visitsWithLocations: ClientVisit[] = allWeekVisits.map((visit, index) => {
        const clientLocation = locationsData?.clients.find(loc => loc.clientName === visit.clientName);
        return {
          id: visit.id || `${visit.clientName}-${visit.startTime}-${visit.endTime}-${index}`,
          clientName: visit.clientName,
          startTime: visit.startTime,
          endTime: visit.endTime,
          durationMinutes: visit.durationMinutes,
          date: visit.date,
          lat: clientLocation?.lat ? Number(clientLocation.lat) : undefined,
          lng: clientLocation?.lng ? Number(clientLocation.lng) : undefined,
          serviceType: visit.serviceType,
          priority: visit.priority,
        };
      });

      clientLogger.log(`📊 Processing ${visitsWithLocations.length} visits with ${employeesWithLocations.length} employee-day combinations`);

      // Log gender data for debugging purposes
      employeesWithLocations.forEach(emp => {
        if (!emp.gender) {
          clientLogger.warn(`⚠️ Missing gender for ${emp.employeeName} on ${emp.date} - Check employee data and location data.`);
        }
      });

      // Pre-fetch real road travel times from backend before scheduling.
      // This seeds the in-memory travel cache with ORS/OSRM distances so the
      // scheduler uses real road times instead of straight-line Haversine estimates.
      try {
        clearTravelCache();

        // Collect unique employee home locations (one entry per unique lat/lng/mode)
        const uniqueEmployeeMap = new Map<string, { lat: number; lng: number; mode: string }>();
        employeesWithLocations.forEach(emp => {
          if (emp.homeLat && emp.homeLng) {
            const key = `${emp.homeLat},${emp.homeLng},${emp.transportMode || 'car'}`;
            if (!uniqueEmployeeMap.has(key)) {
              uniqueEmployeeMap.set(key, { lat: emp.homeLat, lng: emp.homeLng, mode: emp.transportMode || 'car' });
            }
          }
        });

        // Collect unique client locations (one entry per unique lat/lng)
        const uniqueClientMap = new Map<string, { lat: number; lng: number }>();
        visitsWithLocations.forEach(visit => {
          if (visit.lat && visit.lng) {
            const key = `${visit.lat},${visit.lng}`;
            if (!uniqueClientMap.has(key)) {
              uniqueClientMap.set(key, { lat: visit.lat, lng: visit.lng });
            }
          }
        });

        const uniqueEmployees = Array.from(uniqueEmployeeMap.values());
        const uniqueClients = Array.from(uniqueClientMap.values());

        if (uniqueEmployees.length > 0 && uniqueClients.length > 0) {
          // Find earliest visit start time across all visits for this week
          const allStartTimes = allWeekVisits.map(v => v.startTime).filter(Boolean).sort();
          const earliestStartTime = allStartTimes[0] || '08:00';
          clientLogger.log(`🗺️ Pre-fetching real road travel times: ${uniqueEmployees.length} employees × ${uniqueClients.length} clients. Arrival deadline: ${weekStart}T${earliestStartTime}`);
          const response = await apiRequest('POST', '/api/travel-times/batch', {
            employees: uniqueEmployees,
            clients: uniqueClients,
            weekStart,
            earliestStartTime,
          });
          const travelData = await response.json();
          if (travelData.results?.length > 0) {
            seedTravelCache(travelData.results);
            clientLogger.log(`✅ Real road travel cache seeded with ${travelData.results.length} entries`);
          }
          if (travelData.travelSources) {
            setTravelSources(travelData.travelSources);
          }
        }
      } catch (travelError) {
        clientLogger.warn('⚠️ Real road travel pre-fetch failed - using Haversine fallback:', travelError);
      }

      const result = generateWeeklySchedule(visitsWithLocations, employeesWithLocations, weekDates);

      clientLogger.log(`✅ Generated schedule: ${result.metrics.totalVisitsAssigned} assigned, ${result.metrics.totalVisitsUnallocated} unallocated`);

      // Ensure reason is mapped to unallocatedReason to satisfy type safety
      const typedResult: WeeklyScheduleData = {
        assignments: result.assignments,
        unallocated: result.unallocated.map((v: any) => ({
          ...v,
          unallocatedReason: v.rejectionReason || v.reason || v.unallocatedReason || "Not optimal for this run"
        })),
        metrics: result.metrics
      };

      return typedResult;
    },
    onSuccess: async (result) => {
      // ── Phase 1.5: Post-break home-departure correction (car employees) ──
      // The scheduling engine always uses prev_client → current_client for travelTimeBefore.
      // For visits separated by more than 90 minutes (a break where the worker goes home),
      // the realistic journey is home → current_client. The ORS Matrix already has this pair
      // in the client-side travel cache — so no extra API calls are needed.
      const correctedAssignments = { ...result.assignments };
      Object.entries(result.assignments).forEach(([date, dayAssignments]) => {
        Object.entries(dayAssignments).forEach(([empName, visits]) => {
          const empLoc = employeeLocationMap.get(empName);
          if (!empLoc?.homeLat || !empLoc?.homeLng) return;
          const rawMode = (empLoc.transportMode || 'car').toLowerCase();
          if (rawMode !== 'car') return; // walkers handled in Phase 2
          const homeLat = Number(empLoc.homeLat);
          const homeLng = Number(empLoc.homeLng);

          const correctedVisits = (visits as AssignedVisit[]).map((visit, vIdx) => {
            if (vIdx === 0 || !visit.lat || !visit.lng) return visit;
            const prev = (visits as AssignedVisit[])[vIdx - 1];
            const gapMin = timeToMinutes(visit.startTime) - timeToMinutes(prev.endTime);
            if (gapMin < 90) return visit;
            // Gap >= 90 min → worker returns home → use home→client ORS time
            const homeToClient = getTravelMinutes({ lat: homeLat, lng: homeLng }, { lat: visit.lat, lng: visit.lng }, 'car');
            return { ...visit, travelTimeBefore: homeToClient };
          });

          if (!correctedAssignments[date]) correctedAssignments[date] = {};
          correctedAssignments[date][empName] = correctedVisits;
        });
      });
      const correctedResult = { ...result, assignments: correctedAssignments };

      // Show the schedule immediately (car routes already corrected, walker Haversine estimates pending)
      setWeeklySchedule(correctedResult);

      // ── Phase 2: Apply Haversine heuristic to walker/public routes ──
      // Collect only the routes that were actually assigned to walker/public employees.
      // Key includes the visit date so Monday and Saturday pairs are kept separate.
      const walkerPairMap = new Map<string, { fromLat: number; fromLng: number; toLat: number; toLng: number; mode: string; arrivalTimeMinutes?: number; departureTimeMinutes?: number; visitDate: string }>();

      Object.entries(correctedResult.assignments).forEach(([date, dayAssignments]) => {
        Object.entries(dayAssignments).forEach(([empName, visits]) => {
          const empLoc = employeeLocationMap.get(empName);
          if (!empLoc?.homeLat || !empLoc?.homeLng) return;
          const rawMode = (empLoc.transportMode || 'car').toLowerCase();
          if (rawMode === 'car') return;
          const mode = rawMode === 'public' ? 'public' : 'walking';

          const homeLat = Number(empLoc.homeLat);
          const homeLng = Number(empLoc.homeLng);

          (visits as AssignedVisit[]).forEach((visit, vIdx) => {
            if (!visit.lat || !visit.lng) return;

            const addPair = (fLat: number, fLng: number, tLat: number, tLng: number, arrivalTimeMinutes?: number, departureTimeMinutes?: number) => {
              // Include date AND time in key: same route at different departure/arrival times on
              // the same day must be separate API calls (e.g., break home at 11:30 vs 17:45).
              const timeTag = departureTimeMinutes !== undefined
                ? `d${departureTimeMinutes}`
                : arrivalTimeMinutes !== undefined
                  ? `a${arrivalTimeMinutes}`
                  : 'anon';
              const k = `${date}-${fLat.toFixed(4)},${fLng.toFixed(4)}-${tLat.toFixed(4)},${tLng.toFixed(4)}-${mode}-${timeTag}`;
              if (!walkerPairMap.has(k)) {
                walkerPairMap.set(k, {
                  fromLat: fLat,
                  fromLng: fLng,
                  toLat: tLat,
                  toLng: tLng,
                  mode,
                  arrivalTimeMinutes,
                  departureTimeMinutes,
                  visitDate: date,
                });
              }
            };

            if (vIdx === 0) addPair(homeLat, homeLng, visit.lat, visit.lng, timeToMinutes(visit.startTime));
            if (vIdx < visits.length - 1) {
              const next = (visits as AssignedVisit[])[vIdx + 1];
              if (next.lat && next.lng) {
                // If the gap between visits is 90 minutes or more the worker returns home
                // during the break — use the home address as the departure point, not the
                // previous client's address. Threshold matches scheduling-engine.ts (>= 90).
                const gapMin = timeToMinutes(next.startTime) - timeToMinutes(visit.endTime);
                const fromLat = gapMin >= 90 ? homeLat : visit.lat;
                const fromLng = gapMin >= 90 ? homeLng : visit.lng;
                addPair(fromLat, fromLng, next.lat, next.lng, timeToMinutes(next.startTime));
                // When there's a 90+ min break, the worker travels from the current visit back
                // home — depart_by = visit end time (the worker leaves as soon as the visit ends).
                if (gapMin >= 90 && visit.lat && visit.lng) {
                  addPair(visit.lat, visit.lng, homeLat, homeLng, undefined, timeToMinutes(visit.endTime));
                }
              }
            }
            // Return home at end of day — depart_by = last visit end time.
            if (vIdx === visits.length - 1) addPair(visit.lat, visit.lng, homeLat, homeLng, undefined, timeToMinutes(visit.endTime));
          });
        });
      });

      let finalResult = correctedResult;

      if (walkerPairMap.size > 0) {
        setIsRefiningWalkers(true);
        const pairs = Array.from(walkerPairMap.values());
        clientLogger.log(`🚶 Applying Haversine heuristic to ${pairs.length} unique walker/public routes`);

        try {
          const refineResponse = await apiRequest('POST', '/api/travel-times/refine-walker', { pairs });
          const refineData = await refineResponse.json();

          if (refineData.results?.length > 0) {
            // Build a date-keyed lookup map so Monday and Saturday values are kept separate.
            // Key format matches what the endpoint returns: "${visitDate}-${fromLat},${fromLng}-${toLat},${toLng}-${mode}-${timeTag}"
            // timeTag = `a${arrivalMin}` for arrival pairs, `d${departureMin}` for departure pairs.
            const refinedMap = new Map<string, number>();
            (refineData.results as Array<{ key: string; durationMinutes: number }>).forEach(r => {
              refinedMap.set(r.key, r.durationMinutes);
            });

            // Seed Haversine results into the shared travel cache so all display arrows
            // (break-leg, return-home) show consistent values.
            // Cache key is route+mode without date — if Sat/Sun differ for the same pair
            // the last-written value wins, which is fine for display purposes since
            // scheduling validity already uses the per-date travelTimeBefore on each visit.
            seedTravelCache(refineData.results as Array<{ fromLat: number; fromLng: number; toLat: number; toLng: number; mode: string; durationMinutes: number }>);

            clientLogger.log(`✅ Walker/public routes: ${refineData.stats?.heuristic || 0} pairs via Haversine heuristic`);

            // Merge walker/public stats into the travel source badge so it
            // reflects ALL sources used (car ORS + walker Haversine), not just car routes.
            const ttAdded = refineData.stats?.traveltime || 0;
            const hAdded  = refineData.stats?.heuristic  || 0;
            if (ttAdded + hAdded > 0) {
              setTravelSources(prev => {
                const base = prev ?? { total: 0 };
                return {
                  ...base,
                  traveltime: ((base['traveltime'] as number) || 0) + ttAdded,
                  ...(hAdded > 0 ? { heuristic: ((base['heuristic'] as number) || 0) + hAdded } : {}),
                  total: (base.total || 0) + ttAdded + hAdded,
                };
              });
            }

            // Recompute travelTimeBefore for each walker/public visit using the date-keyed refined results.
            // Any visit whose real travel time exceeds the 60-min walker cap is moved to unallocated.
            // Start from correctedResult so car employee break corrections (Phase 1.5) are preserved.
            const WALKER_TRAVEL_CAP = 60;
            const refinedAssignments: typeof result.assignments = {};
            let newlyUnallocated: Array<ClientVisit & { unallocatedReason: string }> = [];

            Object.entries(correctedResult.assignments).forEach(([date, dayAssignments]) => {
              refinedAssignments[date] = {};
              Object.entries(dayAssignments).forEach(([empName, visits]) => {
                const empLoc = employeeLocationMap.get(empName);
                if (!empLoc?.homeLat || !empLoc?.homeLng) {
                  refinedAssignments[date][empName] = visits;
                  return;
                }
                const rawMode = (empLoc.transportMode || 'car').toLowerCase();
                if (rawMode === 'car') {
                  refinedAssignments[date][empName] = visits;
                  return;
                }
                const mode = (rawMode === 'public' ? 'public' : 'walking') as 'walking' | 'public';
                const homeLat = Number(empLoc.homeLat);
                const homeLng = Number(empLoc.homeLng);

                // Arrival leg lookup: key uses `a${arrivalMin}`
                const lookupRefined = (fLat: number, fLng: number, tLat: number, tLng: number, arrivalMin: number): number | undefined => {
                  const k = `${date}-${fLat.toFixed(4)},${fLng.toFixed(4)}-${tLat.toFixed(4)},${tLng.toFixed(4)}-${mode}-a${arrivalMin}`;
                  return refinedMap.get(k);
                };
                // Departure leg lookup (visit→home for break or end-of-day): key uses `d${departureMin}`
                const lookupRefinedDeparture = (fLat: number, fLng: number, tLat: number, tLng: number, departureMin: number): number | undefined => {
                  const k = `${date}-${fLat.toFixed(4)},${fLng.toFixed(4)}-${tLat.toFixed(4)},${tLng.toFixed(4)}-${mode}-d${departureMin}`;
                  return refinedMap.get(k);
                };

                const kept: AssignedVisit[] = [];
                (visits as AssignedVisit[]).forEach((visit, vIdx) => {
                  if (!visit.lat || !visit.lng) { kept.push(visit); return; }
                  const visitStartMin = timeToMinutes(visit.startTime);
                  const visitEndMin = timeToMinutes(visit.endTime);

                  let newTravelTime: number;
                  if (vIdx === 0) {
                    newTravelTime = lookupRefined(homeLat, homeLng, visit.lat, visit.lng, visitStartMin)
                      ?? getTravelMinutes({ lat: homeLat, lng: homeLng }, { lat: visit.lat, lng: visit.lng }, mode);
                  } else {
                    const prev = (visits as AssignedVisit[])[vIdx - 1];
                    // If the gap is 90 minutes or more the worker has returned home —
                    // look up home→current (matches addPair threshold above), not prev→current.
                    const gapMin = visitStartMin - timeToMinutes(prev.endTime);
                    const fromLat = gapMin >= 90 ? homeLat : (prev.lat ?? homeLat);
                    const fromLng = gapMin >= 90 ? homeLng : (prev.lng ?? homeLng);
                    newTravelTime = lookupRefined(fromLat, fromLng, visit.lat, visit.lng, visitStartMin)
                      ?? getTravelMinutes({ lat: fromLat, lng: fromLng }, { lat: visit.lat, lng: visit.lng }, mode);
                  }

                  // Move to unallocated if real travel time exceeds the 60-min walker cap.
                  if (newTravelTime > WALKER_TRAVEL_CAP) {
                    newlyUnallocated.push({
                      id: visit.id,
                      clientName: visit.clientName,
                      startTime: visit.startTime,
                      endTime: visit.endTime,
                      durationMinutes: visit.durationMinutes,
                      date,
                      lat: visit.lat,
                      lng: visit.lng,
                      unallocatedReason: `Walker/public travel ${newTravelTime}min exceeds 60-min cap`,
                    });
                    return;
                  }

                  // Compute travelTimeAfter for departure legs (visit→home).
                  // Used by the break and end-of-day display so each day shows its own
                  // real time instead of a date-less cache value shared across all days.
                  let travelTimeAfter: number | undefined;
                  const isLastVisit = vIdx === visits.length - 1;
                  if (isLastVisit) {
                    travelTimeAfter = lookupRefinedDeparture(visit.lat, visit.lng, homeLat, homeLng, visitEndMin);
                  } else {
                    const next = (visits as AssignedVisit[])[vIdx + 1];
                    const gapToNext = timeToMinutes(next.startTime) - visitEndMin;
                    if (gapToNext >= 90) {
                      travelTimeAfter = lookupRefinedDeparture(visit.lat, visit.lng, homeLat, homeLng, visitEndMin);
                    }
                  }

                  // Also unallocate if the departure leg (visit→home for break or end-of-day) exceeds cap.
                  if (travelTimeAfter !== undefined && travelTimeAfter > WALKER_TRAVEL_CAP) {
                    newlyUnallocated.push({
                      id: visit.id,
                      clientName: visit.clientName,
                      startTime: visit.startTime,
                      endTime: visit.endTime,
                      durationMinutes: visit.durationMinutes,
                      date,
                      lat: visit.lat,
                      lng: visit.lng,
                      unallocatedReason: `Walker/public return travel ${travelTimeAfter}min exceeds 60-min cap`,
                    });
                    return;
                  }

                  kept.push({ ...visit, travelTimeBefore: newTravelTime, travelTimeAfter });
                });

                refinedAssignments[date][empName] = kept;
              });
            });

            // ── Car-employee rescue pass ──────────────────────────────────────────────────
            // Visits just moved to unallocated (walker travel > 60min) may fit into a car
            // employee's existing schedule. The ORS matrix is already in the client-side
            // cache — no extra API calls needed. For each unallocated visit, find the car
            // employee with the smallest travel overhead who has a feasible gap.
            if (newlyUnallocated.length > 0) {
              const rescuedIds = new Set<string>();

              for (const visit of newlyUnallocated) {
                if (!visit.lat || !visit.lng || !visit.date) continue;
                const visitStartMin = timeToMinutes(visit.startTime);
                const visitEndMin   = timeToMinutes(visit.endTime);

                let bestEmp: string | null = null;
                let bestIdx = -1;
                let bestTravelBefore = 0;
                let bestTravelTotal  = Infinity;

                for (const [empName, empVisits] of Object.entries(refinedAssignments[visit.date] || {}) as [string, AssignedVisit[]][]) {
                  const empLoc = employeeLocationMap.get(empName);
                  if (empLoc?.transportMode !== 'car') continue;
                  if (!empLoc.homeLat || !empLoc.homeLng) continue;

                  const sorted = [...empVisits].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

                  for (let i = 0; i <= sorted.length; i++) {
                    const prev = i > 0 ? sorted[i - 1] : null;
                    const next = i < sorted.length ? sorted[i] : null;

                    const prevEndMin = prev ? timeToMinutes(prev.endTime) : 0;
                    const fromLat   = prev?.lat  ?? Number(empLoc.homeLat);
                    const fromLng   = prev?.lng  ?? Number(empLoc.homeLng);

                    const tBefore = getTravelMinutes({ lat: fromLat, lng: fromLng }, { lat: visit.lat!, lng: visit.lng! }, 'car');
                    if (tBefore >= 9999) continue;
                    if (prevEndMin + tBefore > visitStartMin) continue;

                    let tAfter = 0;
                    if (next) {
                      tAfter = getTravelMinutes({ lat: visit.lat!, lng: visit.lng! }, { lat: next.lat!, lng: next.lng! }, 'car');
                      if (tAfter >= 9999) continue;
                      if (visitEndMin + tAfter > timeToMinutes(next.startTime)) continue;
                    }

                    const totalTravel = tBefore + tAfter;
                    if (totalTravel < bestTravelTotal) {
                      bestTravelTotal  = totalTravel;
                      bestTravelBefore = tBefore;
                      bestEmp          = empName;
                      bestIdx          = i;
                    }
                  }
                }

                if (bestEmp !== null) {
                  const rescuedVisit: AssignedVisit = {
                    id:              visit.id,
                    clientName:      visit.clientName,
                    startTime:       visit.startTime,
                    endTime:         visit.endTime,
                    durationMinutes: visit.durationMinutes,
                    lat:             visit.lat,
                    lng:             visit.lng,
                    travelTimeBefore: bestTravelBefore,
                    score:            0,
                  };
                  const sorted = [...(refinedAssignments[visit.date][bestEmp] || [])].sort(
                    (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime)
                  );
                  sorted.splice(bestIdx, 0, rescuedVisit);
                  refinedAssignments[visit.date][bestEmp] = sorted;
                  rescuedIds.add(visit.id);
                  clientLogger.log(`🚗 Rescued ${visit.clientName} (${visit.date} ${visit.startTime}) → ${bestEmp}`);
                }
              }

              if (rescuedIds.size > 0) {
                newlyUnallocated = newlyUnallocated.filter(v => !rescuedIds.has(v.id));
                clientLogger.log(`🚗 Car rescue: ${rescuedIds.size} visit(s) reassigned to car employees`);
              }
            }
            // ─────────────────────────────────────────────────────────────────────────────

            const unallocatedCount = newlyUnallocated.length;
            finalResult = {
              ...correctedResult,
              assignments: refinedAssignments,
              unallocated: [...correctedResult.unallocated, ...newlyUnallocated],
            };
            setWeeklySchedule(finalResult);

            toast({
              title: "Walker Routes Verified",
              description: `${refineData.stats?.traveltime || 0} routes via TravelTime${unallocatedCount > 0 ? `, ${unallocatedCount} still unallocated` : ''}`,
            });
          }
        } catch (refineError) {
          clientLogger.warn('⚠️ Walker refinement failed — schedule kept with Haversine estimates:', refineError);
        }

        setIsRefiningWalkers(false);
      }

      // Save the (potentially refined) schedule to the database
      try {
        await apiRequest('POST', '/api/weekly-schedule/save', {
          weekStartDate: weekStart,
          weekEndDate: weekEnd,
          scheduleData: finalResult.assignments,
          unallocatedVisits: finalResult.unallocated,
          metrics: finalResult.metrics,
        });

        queryClient.invalidateQueries({ queryKey: ['/api/weekly-schedule/latest'] });

        toast({
          title: "Schedule Generated & Saved",
          description: `Assigned ${finalResult.metrics.totalVisitsAssigned} visits across ${finalResult.metrics.employeesUtilized} employees`,
        });
      } catch (error) {
        clientLogger.error('Failed to save schedule:', error);
        toast({
          title: "Schedule Generated",
          description: `Assigned ${finalResult.metrics.totalVisitsAssigned} visits (save failed)`,
          variant: "destructive",
        });
      }
    },
  });

  // Lightweight save mutation for drag-drop auto-save
  const saveScheduleMutation = useMutation({
    mutationFn: async (schedule: WeeklyScheduleData) => {
      await apiRequest('POST', '/api/weekly-schedule/save', {
        branchId: (data as any)?.branchId,
        weekStart,
        weekEnd,
        scheduleData: schedule.assignments,
        unallocatedVisits: schedule.unallocated,
        metrics: schedule.metrics,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/weekly-schedule', weekStart] });
    },
  });

  // Load schedule for the current week being viewed
  const { data: savedSchedule, isFetching: isFetchingSchedule } = useQuery<any>({
    queryKey: ['/api/weekly-schedule', weekStart], // branchId is added by default fetcher
    enabled: !!data && !!weekStart,
  });

  // Clear state when data/branch changes or week changes
  useEffect(() => {
    clientLogger.log("🧹 Data or week changed - clearing local schedule state");
    setWeeklySchedule(null);
    setSelectedEmployee(null);
  }, [data, weekStart]);

  useEffect(() => {
    if (savedSchedule?.scheduleData) {
      // Reconstruct weekly schedule from saved data for this specific week
      clientLogger.log(`📅 Loading saved schedule for week ${weekStart} to ${weekEnd}`);
      setWeeklySchedule({
        assignments: savedSchedule.scheduleData as Record<string, Record<string, AssignedVisit[]>>,
        unallocated: savedSchedule.unallocatedVisits || [],
        metrics: savedSchedule.metrics || {
          totalVisitsAssigned: 0,
          totalVisitsUnallocated: 0,
          averageTravelTimePerVisit: 0,
          employeesUtilized: 0,
        },
      });
    } else if (!isFetchingSchedule) {
      // No saved schedule for this week - clear the state
      clientLogger.log(`📅 No saved schedule found for week ${weekStart} to ${weekEnd}`);
      setWeeklySchedule(null);
    }
  }, [savedSchedule, weekStart, weekEnd, isFetchingSchedule]);


  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Calendar className="h-8 w-8 text-orange-500 mx-auto mb-2" />
          <p className="text-orange-600 font-medium">No processed data available</p>
          <p className="text-sm text-muted-foreground mt-1">
            Please process files first to enable weekly planning
          </p>
        </div>
      </div>
    );
  }

  if (isLoadingVisits) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Loader2 className="h-8 w-8 text-blue-500 mx-auto mb-2 animate-spin" />
          <p className="text-blue-600 font-medium">Loading visit data...</p>
        </div>
      </div>
    );
  }

  // Get employee weekly run (all dates combined)
  const employeeWeeklyRun = selectedEmployee && weeklySchedule 
    ? weekDates.map(date => ({
        date,
        visits: weeklySchedule.assignments[date]?.[selectedEmployee] || []
      }))
    : [];

  // Get total visit count for selected employee
  const totalVisitCount = employeeWeeklyRun.reduce((sum, day) => sum + day.visits.length, 0);

  return (
    <div className="space-y-6">
      {/* Header with Generate Button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Weekly Schedule Generator</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Automatically assign visits to employees for the entire week using VRPTW optimization
          </p>
        </div>
        <Button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending || allWeekVisits.length === 0 || !canGenerate}
          title={!canGenerate ? "Only Schedulers and Admins can generate schedules" : ""}
          className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
          data-testid="button-generate-weekly"
        >
          {generateMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Generating...
            </>
          ) : !canGenerate ? (
            <>
              <Lock className="h-4 w-4 mr-2" />
              View Only
            </>
          ) : (
            <>
              <Zap className="h-4 w-4 mr-2" />
              Generate Weekly Schedule
            </>
          )}
        </Button>
      </div>

      {/* Metrics Card */}
      {weeklySchedule && !isRefiningWalkers && (
        <Card className="glass-card border-blue-200 dark:border-blue-800">
          <CardHeader>
            <CardTitle className="text-lg">Schedule Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Visits Assigned</p>
                <p className="text-2xl font-bold text-green-600">{weeklySchedule.metrics.totalVisitsAssigned}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Unallocated</p>
                <p className="text-2xl font-bold text-red-600">{weeklySchedule.metrics.totalVisitsUnallocated}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Avg Travel Time</p>
                <p className="text-2xl font-bold text-blue-600">{weeklySchedule.metrics.averageTravelTimePerVisit} min</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Employees Used</p>
                <p className="text-2xl font-bold text-purple-600">{weeklySchedule.metrics.employeesUtilized}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Layout: Employee Picker (Left) + Weekly Run (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Employee Picker - Narrower width, increased height */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Employee Picker
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search employees..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-employee"
                />
              </div>
              <ScrollArea className="h-[600px]">
                <div className="space-y-2">
                  {filteredEmployees.length > 0 ? (
                    filteredEmployees.map(empName => {
                      const location = employeeLocationMap.get(empName);

                      // Determine transport mode icon
                      const transportMode = location?.transportMode?.toLowerCase() || '';
                      const isWalker = !transportMode.includes('car');
                      const TransportIcon = isWalker ? User : Car;

                      // Get gender from employee gender map
                      const gender = employeeGenderMap.get(empName) || '';

                      // Calculate total visit hours across all days
                      const totalVisitHours = weeklySchedule 
                        ? Object.values(weeklySchedule.assignments).reduce((sum, dateAssignments) => {
                            const empVisits = dateAssignments[empName] || [];
                            const dayHours = empVisits.reduce((daySum, visit) => 
                              daySum + (visit.durationMinutes / 60), 0);
                            return sum + dayHours;
                          }, 0)
                        : 0;

                      // Get weekly hours (GH) and holidays/unavailability
                      const weeklyHours = employeeWeeklyHoursMap.get(empName) || 0;
                      const holidayDays = employeeHolidaysMap.get(empName) || 0;
                      const unavailDays = employeeUnavailabilityMap.get(empName) || 0;

                      const isSelected = selectedEmployee === empName;

                      return (
                        <div
                          key={empName}
                          onClick={() => setSelectedEmployee(empName)}
                          className={`flex items-center gap-2 p-3 rounded-lg cursor-pointer transition-all ${
                            isSelected 
                              ? 'bg-blue-100 dark:bg-blue-900/20 border-2 border-blue-500' 
                              : 'bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border-2 border-transparent'
                          }`}
                          data-testid={`select-employee-${empName}`}
                        >
                          <TransportIcon className="h-4 w-4 flex-shrink-0" />
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className={`${getGenderColorClass(gender)} font-medium text-sm truncate`} title={empName}>
                              {empName}
                            </span>
                            <div className="flex items-center gap-2 flex-wrap">
                              {weeklyHours > 0 && (
                                <span className="text-xs text-muted-foreground">
                                  {weeklyHours.toFixed(1)}h / week
                                </span>
                              )}
                              {holidayDays > 0 && (
                                <Badge variant="outline" className="text-xs text-amber-600 border-amber-400">
                                  {holidayDays}d holiday
                                </Badge>
                              )}
                              {unavailDays > 0 && (
                                <Badge variant="outline" className="text-xs text-red-600 border-red-400">
                                  {unavailDays}d off
                                </Badge>
                              )}
                              {totalVisitHours > 0 && (
                                <Badge variant={isSelected ? "default" : "secondary"} className="text-xs">
                                  {totalVisitHours.toFixed(1)}h visits
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-4 text-sm text-muted-foreground">
                      No employees found matching "{searchTerm}"
                    </div>
                  )}

                  {/* Absent GH employees — greyed out, non-clickable */}
                  {absentGhEmployees.filter(e =>
                    e.name.toLowerCase().includes(searchTerm.toLowerCase())
                  ).length > 0 && (
                    <div className="mt-3 pt-3 border-t border-dashed border-muted-foreground/30">
                      <p className="text-xs text-muted-foreground mb-2 px-1 font-medium uppercase tracking-wide">
                        Absent this week
                      </p>
                      {absentGhEmployees
                        .filter(e => e.name.toLowerCase().includes(searchTerm.toLowerCase()))
                        .map(emp => {
                          const gender = employeeGenderMap.get(emp.name) || '';
                          const isHoliday = emp.status.toLowerCase().includes('holiday') || emp.status.toLowerCase().includes('annual');
                          const isSick = emp.status.toLowerCase().includes('sick');
                          const badgeClass = isHoliday
                            ? 'text-amber-600 border-amber-400'
                            : isSick
                              ? 'text-red-600 border-red-400'
                              : 'text-orange-600 border-orange-400';
                          const badgeLabel = isHoliday ? 'Holiday' : isSick ? 'Sick' : 'Unavailable';
                          return (
                            <div
                              key={emp.name}
                              className="flex items-center gap-2 p-3 rounded-lg opacity-50 bg-gray-50 dark:bg-gray-800 border-2 border-transparent cursor-default"
                            >
                              <User className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                              <div className="flex flex-col min-w-0 flex-1">
                                <span className={`${getGenderColorClass(gender)} font-medium text-sm truncate`} title={emp.name}>
                                  {emp.name}
                                </span>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs text-muted-foreground">
                                    {emp.gh.toFixed(1)}h / week
                                  </span>
                                  <Badge variant="outline" className={`text-xs ${badgeClass}`}>
                                    {badgeLabel}
                                  </Badge>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </CardContent>
        </Card>

        {/* Weekly Run View - Increased width */}
        <div className="lg:col-span-3">
          {selectedEmployee && weeklySchedule ? (
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>{selectedEmployee} - Weekly Run</span>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    Total: {totalVisitCount} visits
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[600px]">
                  <div className="space-y-3">
                    {weekDates.map((date, index) => {
                      const dayVisits = employeeWeeklyRun[index]?.visits || [];
                      const dayName = dayNames[index];

                      // Get employee availability windows for this day
                      const employeeForDate = data?.employeesByDate[date]?.find(e => e.employeeName === selectedEmployee);
                      const timeWindows = employeeForDate?.timeWindows || '';
                      const status = employeeForDate?.status || '';

                      // Only show days with real availability (has time windows and not ad-hoc)
                      if (!timeWindows || timeWindows.trim() === '' || status === 'Ad-hoc') {
                        return null;
                      }

                      return (
                        <div key={date} className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/20 dark:to-purple-950/20 border-2 border-blue-200 dark:border-blue-800 rounded-lg p-4">
                          {/* Day Header */}
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <h3 className="text-lg font-semibold">{dayName}</h3>
                              <span className="text-sm text-muted-foreground">{date.split('-').slice(1).reverse().join('/')}</span>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Clock className="h-3 w-3" />
                                {timeWindows}
                              </div>
                            </div>
                            <Badge variant={dayVisits.length > 0 ? "default" : "outline"} className="text-sm">
                              {dayVisits.length} visits
                            </Badge>
                          </div>

                          {/* Visits Flow - Linear Layout with Arrows */}
                          {dayVisits.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-2">
                              {/* Home Start Icon (Blue) */}
                              <div className="flex flex-col items-center gap-1">
                                <Home className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                                <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">Start</span>
                              </div>

                              {/* First Arrow with Travel Time */}
                              {dayVisits.length > 0 && (() => {
                                const empLoc = employeeLocationMap.get(selectedEmployee || '');
                                const firstVisit = dayVisits[0];
                                let displayMin = firstVisit.travelTimeBefore;
                                if (displayMin >= 999 && empLoc?.homeLat && empLoc?.homeLng && firstVisit.lat && firstVisit.lng) {
                                  const mode: 'car' | 'walking' | 'public' = (empLoc.transportMode?.toLowerCase() || '').includes('car') ? 'car' : 'walking';
                                  const dist = haversineDistance({ lat: Number(empLoc.homeLat), lng: Number(empLoc.homeLng) }, { lat: firstVisit.lat, lng: firstVisit.lng });
                                  displayMin = calculateTravelTime(dist, mode);
                                }
                                return (
                                  <div className="flex flex-col items-center">
                                    <span className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                                      {displayMin}min
                                    </span>
                                    <ArrowRight className="h-5 w-5 text-gray-400" />
                                  </div>
                                );
                              })()}

                              {/* Visits with Arrows */}
                              {dayVisits.map((visit, vIndex) => (
                                <div key={vIndex} className="flex items-center gap-2">
                                  {/* Visit Card - Compact Size */}
                                  <div 
                                    className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2 hover:shadow-md transition-shadow"
                                    data-testid={`card-visit-${date}-${vIndex}`}
                                  >
                                    <div className="space-y-1">
                                      <p className="font-medium text-xs truncate max-w-[120px]" title={visit.clientName}>
                                        {visit.clientName}
                                      </p>
                                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                        <Clock className="h-3 w-3" />
                                        {visit.startTime} - {visit.endTime}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Arrow with Travel Time (if not last visit) */}
                                  {vIndex < dayVisits.length - 1 && (() => {
                                    const currentVisit = dayVisits[vIndex];
                                    const nextVisit = dayVisits[vIndex + 1];

                                    // Calculate gap between visits
                                    const timeToMinutes = (timeStr: string) => {
                                      const [hours, minutes] = timeStr.split(':').map(Number);
                                      return hours * 60 + minutes;
                                    };

                                    const currentEndMin = timeToMinutes(currentVisit.endTime);
                                    const nextStartMin = timeToMinutes(nextVisit.startTime);
                                    const gapMinutes = nextStartMin - currentEndMin;

                                    // If gap is 90 minutes or more, show home break
                                    if (gapMinutes >= 90) {
                                      const empLocation = employeeLocationMap.get(selectedEmployee || '');

                                      let travelToHome = 0;
                                      let travelFromHome = 0;

                                      // Display-level helper: try API cache first, fall back to haversine for display only
                                      const displayTravelMinutes = (
                                        from: { lat: number; lng: number },
                                        to: { lat: number; lng: number },
                                        mode: 'car' | 'walking' | 'public',
                                        timeMin: number
                                      ): number => {
                                        const api = getTravelMinutes(from, to, mode, timeMin);
                                        if (api >= 999) {
                                          const dist = haversineDistance(from, to);
                                          return calculateTravelTime(dist, mode, timeMin);
                                        }
                                        return api;
                                      };

                                      if (empLocation?.homeLat && empLocation?.homeLng) {
                                        const transportMode = empLocation.transportMode?.toLowerCase() || '';
                                        // Use 'walking' for non-drivers (no peak time rules), 'car' for drivers
                                        const mode: 'car' | 'walking' | 'public' = transportMode.includes('car') ? 'car' : 'walking';
                                        const currentEndMin = timeToMinutes(currentVisit.endTime);
                                        const nextStartMin = timeToMinutes(nextVisit.startTime);

                                        // Travel from current visit to home.
                                        // Prefer the per-date refined value stored on the visit object —
                                        // it is date-specific so Tuesday and Saturday show different times.
                                        if (currentVisit.travelTimeAfter !== undefined) {
                                          travelToHome = currentVisit.travelTimeAfter;
                                        } else if (currentVisit.lat && currentVisit.lng) {
                                          travelToHome = displayTravelMinutes(
                                            { lat: currentVisit.lat, lng: currentVisit.lng },
                                            { lat: Number(empLocation.homeLat), lng: Number(empLocation.homeLng) },
                                            mode,
                                            currentEndMin
                                          );
                                        }

                                        // Travel from home to next visit — use the TravelTime-refined
                                        // travelTimeBefore already stored on the next visit object.
                                        // This is always set by the walker refinement phase (Home→nextVisit pair).
                                        travelFromHome = nextVisit.travelTimeBefore ?? 0;
                                      }

                                      const breakTime = Math.max(0, gapMinutes - travelToHome - travelFromHome);

                                      return (
                                        <div className="flex items-center gap-2">
                                          {/* Travel to home */}
                                          <div className="flex flex-col items-center">
                                            <span className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                                              {travelToHome}min
                                            </span>
                                            <ArrowRight className="h-5 w-5 text-gray-400" />
                                          </div>

                                          {/* Home break */}
                                          <div className="flex flex-col items-center px-3 py-2 rounded-lg bg-orange-100 dark:bg-orange-900/30 border-2 border-orange-300 dark:border-orange-700">
                                            <Home className="h-6 w-6 text-orange-600 dark:text-orange-400 mb-1" />
                                            <span className="text-xs font-semibold text-orange-700 dark:text-orange-300">
                                              Break
                                            </span>
                                            <span className="text-xs text-orange-600 dark:text-orange-400">
                                              {breakTime}min
                                            </span>
                                          </div>

                                          {/* Travel from home */}
                                          <div className="flex flex-col items-center">
                                            <span className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                                              {travelFromHome}min
                                            </span>
                                            <ArrowRight className="h-5 w-5 text-gray-400" />
                                          </div>
                                        </div>
                                      );
                                    }

                                    // Normal travel between visits (gap < 90 minutes)
                                    let interDisplayMin = nextVisit.travelTimeBefore;
                                    if (interDisplayMin >= 999 && currentVisit.lat && currentVisit.lng && nextVisit.lat && nextVisit.lng) {
                                      const empLocInter = employeeLocationMap.get(selectedEmployee || '');
                                      const modeInter: 'car' | 'walking' | 'public' = (empLocInter?.transportMode?.toLowerCase() || '').includes('car') ? 'car' : 'walking';
                                      const distInter = haversineDistance({ lat: currentVisit.lat, lng: currentVisit.lng }, { lat: nextVisit.lat, lng: nextVisit.lng });
                                      interDisplayMin = calculateTravelTime(distInter, modeInter);
                                    }
                                    return (
                                      <div className="flex flex-col items-center">
                                        <span className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                                          {interDisplayMin}min
                                        </span>
                                        <ArrowRight className="h-5 w-5 text-gray-400" />
                                      </div>
                                    );
                                  })()}
                                </div>
                              ))}

                              {/* Last Arrow with Travel Time to Home */}
                              {dayVisits.length > 0 && (() => {
                                const lastVisit = dayVisits[dayVisits.length - 1];
                                const empLocation = employeeLocationMap.get(selectedEmployee);

                                // Calculate travel time from last visit to home
                                let travelToHome = 0;
                                if (empLocation?.homeLat && empLocation?.homeLng && lastVisit.lat && lastVisit.lng) {
                                  const transportMode = empLocation.transportMode?.toLowerCase() || '';
                                  // Use 'walking' for non-drivers (no peak time rules), 'car' for drivers
                                  const mode: 'car' | 'walking' | 'public' = transportMode.includes('car') ? 'car' : 'walking';
                                  const lastVisitEndMin = timeToMinutes(lastVisit.endTime);

                                  // Prefer the per-date refined value — avoids the date-less cache
                                  // where Saturday and Sunday would overwrite each other.
                                  if (lastVisit.travelTimeAfter !== undefined) {
                                    travelToHome = lastVisit.travelTimeAfter;
                                  } else {
                                    travelToHome = getTravelMinutes(
                                      { lat: lastVisit.lat, lng: lastVisit.lng },
                                      { lat: Number(empLocation.homeLat), lng: Number(empLocation.homeLng) },
                                      mode,
                                      lastVisitEndMin
                                    );
                                    // Fallback to haversine for display if API cache is empty
                                    if (travelToHome >= 999) {
                                      const dist = haversineDistance({ lat: lastVisit.lat, lng: lastVisit.lng }, { lat: Number(empLocation.homeLat), lng: Number(empLocation.homeLng) });
                                      travelToHome = calculateTravelTime(dist, mode, lastVisitEndMin);
                                    }
                                  }
                                }

                                return (
                                  <>
                                    <div className="flex flex-col items-center">
                                      <span className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                                        {travelToHome}min
                                      </span>
                                      <ArrowRight className="h-5 w-5 text-gray-400" />
                                    </div>

                                    {/* Home End Icon (Green) */}
                                    <div className="flex flex-col items-center gap-1">
                                      <Home className="h-6 w-6 text-green-600 dark:text-green-400" />
                                      <span className="text-xs text-green-600 dark:text-green-400 font-medium">End</span>
                                    </div>
                                  </>
                                );
                              })()}
                            </div>
                          ) : (
                            <div className="text-center py-4 text-sm text-muted-foreground bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                              No visits assigned for this day
                            </div>
                          )}
                        </div>
                      );
                    }).filter(Boolean)}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          ) : (
            <Card className="glass-card">
              <CardContent className="flex items-center justify-center h-[600px]">
                <div className="text-center">
                  <User className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-gray-500 font-medium">Select an employee to view their weekly run</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Choose from the employee list on the left
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Unallocated Visits - Organized by Day */}
      {weeklySchedule && weeklySchedule.unallocated.length > 0 && (
        <Card className="glass-card border-red-200 dark:border-red-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-red-600 flex items-center justify-between text-lg">
              <span>Unallocated Visits ({weeklySchedule.unallocated.length})</span>
              <Badge variant="destructive" className="text-sm">
                {((weeklySchedule.unallocated.length / (weeklySchedule.metrics.totalVisitsAssigned + weeklySchedule.unallocated.length)) * 100).toFixed(1)}% unallocated
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              <div className="space-y-4">
                {weekDates.map((date, dayIndex) => {
                  // Filter unallocated visits for this specific day
                  const dayUnallocated = weeklySchedule.unallocated.filter(v => v.date === date);

                  if (dayUnallocated.length === 0) return null;

                  const dayName = dayNames[dayIndex];

                  return (
                    <div key={date} className="border border-red-200 dark:border-red-700 rounded-lg p-3 bg-red-50/50 dark:bg-red-950/10">
                      {/* Day Header */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <Calendar className="h-4 w-4 text-red-600" />
                          <h3 className="font-semibold text-red-700 dark:text-red-400">
                            {dayName} - {date.split('-').slice(1).join('/')}
                          </h3>
                        </div>
                        <Badge variant="destructive" className="text-xs">
                          {dayUnallocated.length} unallocated
                        </Badge>
                      </div>

                      {/* Day's Unallocated Visits Grid — read-only cards */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2">
                        {dayUnallocated.map((visit, index) => (
                          <div
                            key={`${visit.id}-${index}`}
                            className="bg-white dark:bg-gray-800 border border-red-300 dark:border-red-700 rounded-lg p-2"
                            title={visit.unallocatedReason}
                          >
                            <div className="space-y-1">
                              <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate" title={visit.clientName}>
                                {visit.clientName}
                              </p>
                              <div className="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-300">
                                <Clock className="h-3 w-3" />
                                {visit.startTime}-{visit.endTime}
                              </div>
                              <div className="flex items-start gap-1 mt-1">
                                <Badge variant="outline" className="text-[10px] text-red-700 dark:text-red-400 border-red-300 bg-red-50 dark:bg-red-950 shrink-0 max-w-full break-words whitespace-normal">
                                  {visit.unallocatedReason || "Not optimal"}
                                </Badge>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}