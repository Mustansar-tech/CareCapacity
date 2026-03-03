import { useState, useEffect } from "react";
import { clientLogger } from '@/lib/logger';
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Calendar, Zap, Loader2, Car, User, MapPin, Clock, Search, Plus, Home, ArrowRight, Info } from "lucide-react";
import { getGenderColorClass } from "@/utils/gender-colors";
import { minutesToTime, timeToMinutes, getTravelMinutes, seedTravelCache, clearTravelCache, haversineDistance, calculateTravelTime } from "@/utils/scheduling-utils";
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
  score: number;
  travelWarning?: boolean;
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

export function WeeklyPlanTab({ data, selectedDate }: WeeklyPlanTabProps) {
  const { toast } = useToast();
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

    // Only include employees with real availability (not ad-hoc) and time windows
    if (emp.timeWindows && emp.timeWindows.trim() !== '' && emp.status !== 'Ad-hoc') {
      const existing = employeeMap.get(emp.employeeName);
      // Keep the entry with more contracted hours (prefer non-ad-hoc entries)
      if (!existing || emp.contractedDailyHours > (existing.contractedDailyHours || 0)) {
        employeeMap.set(emp.employeeName, emp);
      }
    }
  });

  const availableEmployees = Array.from(employeeMap.values());

  // Get employees with assignments from the weekly schedule (exclude ad-hoc)
  const employeesWithAssignments = weeklySchedule 
    ? Array.from(new Set(
        Object.values(weeklySchedule.assignments)
          .flatMap(dateAssignments => Object.keys(dateAssignments))
      ))
      .filter(empName => !adHocEmployees.has(empName))
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
      const employeesWithLocations = Object.entries(data?.employeesByDate || {}).flatMap(([date, empList]) => 
        empList.map(emp => {
          const location = locationsData?.employees.find(loc => loc.employeeName === emp.employeeName);
          // Get weekly contracted hours from the employee weekly hours map
          const weeklyHours = employeeWeeklyHoursMap.get(emp.employeeName) || 0;
          return {
            employeeName: emp.employeeName,
            date,
            timeWindows: emp.timeWindows,
            homeLat: location?.homeLat ? Number(location.homeLat) : undefined,
            homeLng: location?.homeLng ? Number(location.homeLng) : undefined,
            transportMode: location?.transportMode || undefined,
            weeklyContractedHours: weeklyHours,
            // Include gender for client matching
            gender: emp.gender || (location ? location.gender : undefined), // Use gender from emp (preferred) or location (fallback)
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
          unallocatedReason: v.reason || v.unallocatedReason || "Not optimal for this run"
        })),
        metrics: result.metrics
      };

      return typedResult;
    },
    onSuccess: async (result) => {
      // Show the schedule immediately with Haversine estimates while walker routes are refined
      setWeeklySchedule(result);

      // ── Phase 2: Refine walker/public routes with real TravelTime API ──
      // Collect only the routes that were actually assigned to walker/public employees.
      // This replaces the old "pre-warm everything" approach with targeted calls.
      // Key includes the visit date so Monday and Saturday pairs are kept separate —
      // weekend bus timetables differ from weekday ones and must not be deduplicated together.
      const walkerPairMap = new Map<string, { fromLat: number; fromLng: number; toLat: number; toLng: number; mode: string; arrivalTimeMinutes?: number; visitDate: string }>();

      Object.entries(result.assignments).forEach(([date, dayAssignments]) => {
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

            const addPair = (fLat: number, fLng: number, tLat: number, tLng: number, arrivalTimeMinutes?: number) => {
              // Include date in key: same locations on different days = separate API calls
              const k = `${date}-${fLat.toFixed(4)},${fLng.toFixed(4)}-${tLat.toFixed(4)},${tLng.toFixed(4)}-${mode}`;
              if (!walkerPairMap.has(k)) walkerPairMap.set(k, { fromLat: fLat, fromLng: fLng, toLat: tLat, toLng: tLng, mode, arrivalTimeMinutes, visitDate: date });
            };

            if (vIdx === 0) addPair(homeLat, homeLng, visit.lat, visit.lng, timeToMinutes(visit.startTime));
            if (vIdx < visits.length - 1) {
              const next = (visits as AssignedVisit[])[vIdx + 1];
              if (next.lat && next.lng) addPair(visit.lat, visit.lng, next.lat, next.lng, timeToMinutes(next.startTime));
            }
            if (vIdx === visits.length - 1) addPair(visit.lat, visit.lng, homeLat, homeLng, undefined); // no arrival deadline for return home
          });
        });
      });

      let finalResult = result;

      if (walkerPairMap.size > 0) {
        setIsRefiningWalkers(true);
        const pairs = Array.from(walkerPairMap.values());
        clientLogger.log(`🚶 Refining ${pairs.length} unique walker/public routes with TravelTime API`);

        try {
          const refineResponse = await apiRequest('POST', '/api/travel-times/refine-walker', { pairs });
          const refineData = await refineResponse.json();

          if (refineData.results?.length > 0) {
            // Build a date-keyed lookup map so Monday and Saturday values are kept separate.
            // Key format matches what the endpoint returns: "${visitDate}-${fromLat},${fromLng}-${toLat},${toLng}-${mode}"
            const refinedMap = new Map<string, number>();
            (refineData.results as Array<{ key: string; durationMinutes: number }>).forEach(r => {
              refinedMap.set(r.key, r.durationMinutes);
            });
            clientLogger.log(`✅ Walker refinement: ${refineData.stats?.traveltime || 0} via TravelTime, ${refineData.stats?.heuristic || 0} via heuristic`);

            // Recompute travelTimeBefore for each walker/public visit using the date-keyed refined results.
            // Falls back to getTravelMinutes (Haversine) if a pair was not in the refine response.
            const refinedAssignments: typeof result.assignments = {};
            let warningCount = 0;

            Object.entries(result.assignments).forEach(([date, dayAssignments]) => {
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

                const lookupRefined = (fLat: number, fLng: number, tLat: number, tLng: number): number | undefined => {
                  const k = `${date}-${fLat.toFixed(4)},${fLng.toFixed(4)}-${tLat.toFixed(4)},${tLng.toFixed(4)}-${mode}`;
                  return refinedMap.get(k);
                };

                refinedAssignments[date][empName] = (visits as AssignedVisit[]).map((visit, vIdx) => {
                  if (!visit.lat || !visit.lng) return visit;
                  let newTravelTime: number;
                  if (vIdx === 0) {
                    newTravelTime = lookupRefined(homeLat, homeLng, visit.lat, visit.lng)
                      ?? getTravelMinutes({ lat: homeLat, lng: homeLng }, { lat: visit.lat, lng: visit.lng }, mode);
                  } else {
                    const prev = (visits as AssignedVisit[])[vIdx - 1];
                    newTravelTime = (prev.lat && prev.lng)
                      ? (lookupRefined(prev.lat, prev.lng, visit.lat, visit.lng)
                        ?? getTravelMinutes({ lat: prev.lat, lng: prev.lng }, { lat: visit.lat, lng: visit.lng }, mode))
                      : visit.travelTimeBefore;
                  }
                  const travelWarning = newTravelTime > 60; // 60-min cap for walker/public
                  if (travelWarning) warningCount++;
                  return { ...visit, travelTimeBefore: newTravelTime, travelWarning };
                });
              });
            });

            finalResult = { ...result, assignments: refinedAssignments };
            setWeeklySchedule(finalResult);

            toast({
              title: "Walker Routes Verified",
              description: `${refineData.stats?.traveltime || 0} routes via TravelTime${warningCount > 0 ? `, ${warningCount} flagged as slow` : ''}`,
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

  // Load schedule for the current week being viewed
  const { data: savedSchedule, isFetching: isFetchingSchedule } = useQuery<any>({
    queryKey: ['/api/weekly-schedule', weekStart, (data as any)?.branchId], // Access branchId safely
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
          disabled={generateMutation.isPending || allWeekVisits.length === 0}
          className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
          data-testid="button-generate-weekly"
        >
          {generateMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Zap className="h-4 w-4 mr-2" />
              Generate Weekly Schedule
            </>
          )}
        </Button>
      </div>

      {/* Walker refinement indicator */}
      {isRefiningWalkers && (
        <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Verifying walker travel times with TravelTime API…
        </div>
      )}

      {/* Metrics Card */}
      {weeklySchedule && (
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

      {/* Travel Data Sources panel */}
      {travelSources && travelSources.total > 0 && (() => {
        const sourceLabels: Record<string, { label: string; color: string }> = {
          'ors':              { label: 'OpenRouteService',    color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
          'ors-matrix':       { label: 'ORS Matrix',         color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
          'osrm':             { label: 'OSRM (OpenStreetMap)', color: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300' },
          'traveltime':       { label: 'TravelTime API',     color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' },
          'traveltime-matrix':{ label: 'TravelTime Matrix',  color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' },
          'heuristic':        { label: 'Heuristic Estimate', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
          'unreachable':      { label: 'No Route (unreachable)', color: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
        };
        const activeSources = Object.entries(travelSources).filter(([k, v]) => k !== 'total' && v > 0);
        return (
          <Card className="glass-card border-dashed">
            <CardContent className="py-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground shrink-0">
                  <Info className="h-4 w-4" />
                  <span>Travel data source ({travelSources.total} routes):</span>
                </div>
                {activeSources.map(([key, count]) => {
                  const meta = sourceLabels[key] || { label: key, color: 'bg-gray-100 text-gray-800' };
                  const pct = Math.round((count / travelSources.total) * 100);
                  return (
                    <span key={key} className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${meta.color}`}>
                      {meta.label}
                      <span className="opacity-70">({count} · {pct}%)</span>
                    </span>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })()}

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
                                    className={`bg-white dark:bg-gray-800 border rounded-lg p-2 hover:shadow-md transition-shadow ${visit.travelWarning ? 'border-amber-400 dark:border-amber-600' : 'border-gray-200 dark:border-gray-700'}`}
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
                                      {visit.travelWarning && (
                                        <div className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                                          ⚠ Long travel
                                        </div>
                                      )}
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

                                        // Travel from current visit to home
                                        if (currentVisit.lat && currentVisit.lng) {
                                          travelToHome = displayTravelMinutes(
                                            { lat: currentVisit.lat, lng: currentVisit.lng },
                                            { lat: Number(empLocation.homeLat), lng: Number(empLocation.homeLng) },
                                            mode,
                                            currentEndMin
                                          );
                                        }

                                        // Travel from home to next visit
                                        if (nextVisit.lat && nextVisit.lng) {
                                          travelFromHome = displayTravelMinutes(
                                            { lat: Number(empLocation.homeLat), lng: Number(empLocation.homeLng) },
                                            { lat: nextVisit.lat, lng: nextVisit.lng },
                                            mode,
                                            nextStartMin
                                          );
                                        }
                                      }

                                      const breakTime = gapMinutes - travelToHome - travelFromHome;

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

                      {/* Day's Unallocated Visits Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2">
                        {dayUnallocated.map((visit, index) => (
                          <div 
                            key={index} 
                            className="bg-white dark:bg-gray-800 border border-red-300 dark:border-red-700 rounded-lg p-2 hover:shadow-md transition-shadow"
                            data-testid={`card-unallocated-${date}-${index}`}
                          >
                            <div className="space-y-1">
                              <p className="font-medium text-xs truncate" title={visit.clientName}>
                                {visit.clientName}
                              </p>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Clock className="h-3 w-3" />
                                {visit.startTime}-{visit.endTime}
                              </div>
                              <div className="flex items-start gap-1 mt-1">
                                <Badge variant="outline" className="text-[10px] text-red-600 border-red-200 bg-red-50 shrink-0">
                                  Not optimal
                                </Badge>
                                <p className="text-[10px] text-muted-foreground italic line-clamp-2" title={visit.unallocatedReason}>
                                  {visit.unallocatedReason}
                                </p>
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