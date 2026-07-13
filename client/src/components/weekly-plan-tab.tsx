import { useState, useEffect, useRef } from "react";
import { clientLogger } from '@/lib/logger';
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Calendar, Zap, Loader2, Clock, Search, ChevronRight, Lock } from "lucide-react";
import { getGenderColorClass } from "@/utils/gender-colors";
import { timeToMinutes, getTravelMinutes, seedTravelCache, clearTravelCache } from "@/utils/scheduling-utils";
import type { ProcessingResult, ClientVisit, EmployeeLocation, ClientLocation, WeeklySchedule, EmployeeDailyDetail } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getCanonicalWeekBoundaries } from "@shared/schema";
import { generateWeeklySchedule } from "@/utils/scheduling-engine";

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
  serviceType?: string;
}

interface WeeklyScheduleData {
  assignments: Record<string, Record<string, AssignedVisit[]>>;
  unallocated: Array<ClientVisit & { unallocatedReason: string }>;
  metrics: {
    totalVisitsAssigned: number;
    totalVisitsUnallocated: number;
    averageTravelTimePerVisit: number;
    employeesUtilized: number;
  };
}

// ── Timeline constants ────────────────────────────────────────────────────────
const MINS_PER_PX = 2;          // 2 pixels per minute
const TIMELINE_WIDTH = 1440 * MINS_PER_PX; // 2880px total
const LEFT_PANEL_W = 244;       // Day View left panel (px)
const WEEK_LEFT_PANEL_W = 120;  // Week View day-label panel (px)
const ROW_HEIGHT = 80;          // Row height in px

function minsToPx(mins: number) { return mins * MINS_PER_PX; }

function formatHhMm(totalMinutes: number) {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

function getInitials(name: string): string {
  const stripped = name.replace(/\s*\(.*?\)\s*/g, '').trim();
  const parts = stripped.split(',').map(s => s.trim());
  if (parts.length >= 2) {
    const first = parts[1].split(' ')[0] || '';
    return (first[0] || parts[0][0] || '?').toUpperCase() + (parts[0][0] || '').toUpperCase();
  }
  return stripped.substring(0, 2).toUpperCase();
}

function isTrainingBlock(serviceType?: string, clientName?: string): boolean {
  const text = ((serviceType || '') + ' ' + (clientName || '')).toLowerCase();
  return text.includes('training') || text.includes('office') || text.includes('admin') ||
         text.includes('meeting') || text.includes('shadow') || text.includes('live in') ||
         text.includes('live-in');
}

function formatFullDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00.000Z');
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
  } catch { return dateStr; }
}

function formatShortDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00.000Z');
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
  } catch { return dateStr; }
}

function formatDayName(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00.000Z');
    return d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  } catch { return dateStr; }
}

function formatDayTab(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00.000Z');
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
  } catch { return dateStr; }
}

// ─── Main component ───────────────────────────────────────────────────────────

export function WeeklyPlanTab({ data, selectedDate }: WeeklyPlanTabProps) {
  const { toast } = useToast();
  const { canGenerate } = useAuth();
  const { selectedBranchId } = useBranch();
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [weeklySchedule, setWeeklySchedule] = useState<WeeklyScheduleData | null>(null);
  const [lastGeneratedAt, setLastGeneratedAt] = useState<Date | null>(null);
  const [travelSources, setTravelSources] = useState<Record<string, number> | null>(null);
  const [ganttViewDate, setGanttViewDate] = useState<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const currentWeek = selectedDate || new Date().toISOString().split('T')[0];
  const { weekStart, weekEnd } = getCanonicalWeekBoundaries(currentWeek);

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

  // Set initial gantt view date:
  //   1. selectedDate (the date the user navigated to), if it falls in this week
  //   2. today, if today falls in this week
  //   3. Monday of the week otherwise
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    if (selectedDate && weekDates.includes(selectedDate)) {
      setGanttViewDate(selectedDate);
    } else if (weekDates.includes(today)) {
      setGanttViewDate(today);
    } else {
      setGanttViewDate(weekDates[0] || today);
    }
  }, [weekStart, selectedDate]);

  // Auto-scroll timeline to 07:00 on view change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = minsToPx(7 * 60); // 840px = 07:00
    }
  }, [ganttViewDate, selectedEmployee, weeklySchedule]);

  // Reload last-generated stamp whenever branch or week changes
  useEffect(() => {
    if (!selectedBranchId || !weekStart) { setLastGeneratedAt(null); return; }
    try {
      const key = `scheduleLastGenerated_${selectedBranchId}_${weekStart}`;
      const stored = localStorage.getItem(key);
      setLastGeneratedAt(stored ? new Date(stored) : null);
    } catch { setLastGeneratedAt(null); }
  }, [selectedBranchId, weekStart]);

  // Fetch locations
  const { data: locationsData } = useQuery<{ employees: EmployeeLocation[]; clients: ClientLocation[] }>({
    queryKey: ['/api/locations'],
    enabled: !!data,
  });

  const employeeLocationMap = new Map(
    (locationsData?.employees || []).map(emp => [emp.employeeName, emp])
  );

  // Fetch all visits for the week
  const { data: weekVisitsData, isLoading: isLoadingVisits } = useQuery<ClientVisit[]>({
    queryKey: ['/api/visits/week', weekStart],
    enabled: !!data && !!weekStart,
  });

  const allWeekVisits = weekVisitsData || [];

  // ── Employee data aggregation ──────────────────────────────────────────────
  const employeeWeeklyHoursMap = new Map<string, number>();
  const employeeWeeklyNetCapacityMap = new Map<string, number>();
  const employeeGenderMap = new Map<string, string>();
  const employeeHolidaysMap = new Map<string, number>();
  const employeeUnavailabilityMap = new Map<string, number>();

  Object.values(data?.employeesByDate || {}).forEach(dayEmployees => {
    dayEmployees.forEach(emp => {
      if (emp.contractedDailyHours > 0) {
        const current = employeeWeeklyHoursMap.get(emp.employeeName) || 0;
        employeeWeeklyHoursMap.set(emp.employeeName, current + emp.contractedDailyHours);
      }
      if (emp.gender && !employeeGenderMap.has(emp.employeeName)) {
        employeeGenderMap.set(emp.employeeName, emp.gender);
      }
      const statusLower = (emp.status || '').toLowerCase();
      if (statusLower.includes('holiday') || statusLower.includes('annual leave')) {
        employeeHolidaysMap.set(emp.employeeName, (employeeHolidaysMap.get(emp.employeeName) || 0) + 1);
      } else if (statusLower.includes('unavailable') || statusLower.includes('sick') || statusLower.includes('off')) {
        employeeUnavailabilityMap.set(emp.employeeName, (employeeUnavailabilityMap.get(emp.employeeName) || 0) + 1);
      }
    });
  });

  Object.entries(data?.employeesByDate || {}).forEach(([, employees]) => {
    employees.forEach(emp => {
      const current = employeeWeeklyNetCapacityMap.get(emp.employeeName) || 0;
      employeeWeeklyNetCapacityMap.set(emp.employeeName, current + (emp.netCapacity || 0));
    });
  });

  const employeeMap = new Map<string, EmployeeDailyDetail>();
  const adHocEmployees = new Set<string>();

  Object.values(data?.employeesByDate || {}).flat().forEach(emp => {
    if (emp.status === 'Ad-hoc') adHocEmployees.add(emp.employeeName);
    if (emp.timeWindows && emp.timeWindows.trim() !== '' && emp.status !== 'Ad-hoc' && (employeeWeeklyHoursMap.get(emp.employeeName) || 0) > 0) {
      const existing = employeeMap.get(emp.employeeName);
      if (!existing || emp.contractedDailyHours > (existing.contractedDailyHours || 0)) {
        employeeMap.set(emp.employeeName, emp);
      }
    }
  });

  const availableEmployees = Array.from(employeeMap.values());

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

  const employeesWithAssignments = weeklySchedule
    ? Array.from(new Set(
        Object.values(weeklySchedule.assignments)
          .flatMap(dateAssignments => Object.keys(dateAssignments))
      ))
      .filter(n => !adHocEmployees.has(n) && (employeeWeeklyHoursMap.get(n) || 0) > 0)
      .sort()
    : [];

  const employeeNames = weeklySchedule
    ? Array.from(new Set([...employeesWithAssignments, ...availableEmployees.map(e => e.employeeName)])).sort()
    : availableEmployees.map(e => e.employeeName).sort();

  const filteredEmployees = employeeNames.filter(n =>
    n.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // ── Generate mutation ──────────────────────────────────────────────────────
  const generateMutation = useMutation({
    mutationFn: async () => {
      clientLogger.log(`📅 Generating weekly schedule for ${weekDates.length} days with ${allWeekVisits.length} visits`);

      const employeesWithLocations = Object.entries(data?.employeesByDate || {}).flatMap(([date, empList]) =>
        empList
          .filter(emp => (employeeWeeklyHoursMap.get(emp.employeeName) || 0) > 0)
          .map(emp => {
            const location = locationsData?.employees.find(loc => loc.employeeName === emp.employeeName);
            return {
              employeeName: emp.employeeName,
              date,
              timeWindows: emp.timeWindows,
              homeLat: location?.homeLat ? Number(location.homeLat) : undefined,
              homeLng: location?.homeLng ? Number(location.homeLng) : undefined,
              transportMode: location?.transportMode || undefined,
              weeklyContractedHours: employeeWeeklyHoursMap.get(emp.employeeName) || 0,
              gender: emp.gender || location?.gender || undefined,
            };
          })
      );

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

      try {
        clearTravelCache();
        const uniqueEmployeeMap = new Map<string, { lat: number; lng: number; mode: string }>();
        employeesWithLocations.forEach(emp => {
          if (emp.homeLat && emp.homeLng) {
            const key = `${emp.homeLat},${emp.homeLng},${emp.transportMode || 'car'}`;
            if (!uniqueEmployeeMap.has(key)) uniqueEmployeeMap.set(key, { lat: emp.homeLat, lng: emp.homeLng, mode: emp.transportMode || 'car' });
          }
        });
        const uniqueClientMap = new Map<string, { lat: number; lng: number }>();
        visitsWithLocations.forEach(visit => {
          if (visit.lat && visit.lng) {
            const key = `${visit.lat},${visit.lng}`;
            if (!uniqueClientMap.has(key)) uniqueClientMap.set(key, { lat: visit.lat, lng: visit.lng });
          }
        });
        const uniqueEmployees = Array.from(uniqueEmployeeMap.values());
        const uniqueClients = Array.from(uniqueClientMap.values());
        if (uniqueEmployees.length > 0 && uniqueClients.length > 0) {
          const allStartTimes = allWeekVisits.map(v => v.startTime).filter(Boolean).sort();
          const earliestStartTime = allStartTimes[0] || '08:00';
          const response = await apiRequest('POST', '/api/travel-times/batch', {
            employees: uniqueEmployees, clients: uniqueClients, weekStart, earliestStartTime,
          });
          const travelData = await response.json();
          if (travelData.results?.length > 0) {
            seedTravelCache(travelData.results);
          }
          if (travelData.travelSources) setTravelSources(travelData.travelSources);
        }
      } catch (travelError) {
        clientLogger.warn('⚠️ Real road travel pre-fetch failed - using Haversine fallback:', travelError);
      }

      const result = generateWeeklySchedule(visitsWithLocations, employeesWithLocations, weekDates);
      type EngineUnallocated = ClientVisit & { rejectionReason?: string; reason?: string; unallocatedReason?: string };
      const typedResult: WeeklyScheduleData = {
        assignments: result.assignments,
        unallocated: (result.unallocated as EngineUnallocated[]).map(v => ({
          ...v,
          unallocatedReason: v.rejectionReason || v.reason || v.unallocatedReason || "Not optimal for this run"
        })),
        metrics: result.metrics
      };
      return typedResult;
    },
    onSuccess: async (result) => {
      // Phase 1.5: Post-break home-departure correction (car employees)
      const correctedAssignments = { ...result.assignments };
      Object.entries(result.assignments).forEach(([date, dayAssignments]) => {
        Object.entries(dayAssignments).forEach(([empName, visits]) => {
          const empLoc = employeeLocationMap.get(empName);
          if (!empLoc?.homeLat || !empLoc?.homeLng) return;
          if ((empLoc.transportMode || 'car').toLowerCase() !== 'car') return;
          const homeLat = Number(empLoc.homeLat);
          const homeLng = Number(empLoc.homeLng);
          const correctedVisits = (visits as AssignedVisit[]).map((visit, vIdx) => {
            if (vIdx === 0 || !visit.lat || !visit.lng) return visit;
            const prev = (visits as AssignedVisit[])[vIdx - 1];
            const gapMin = timeToMinutes(visit.startTime) - timeToMinutes(prev.endTime);
            if (gapMin < 90) return visit;
            const homeToClient = getTravelMinutes({ lat: homeLat, lng: homeLng }, { lat: visit.lat, lng: visit.lng }, 'car');
            return { ...visit, travelTimeBefore: homeToClient };
          });
          if (!correctedAssignments[date]) correctedAssignments[date] = {};
          correctedAssignments[date][empName] = correctedVisits;
        });
      });
      const correctedResult = { ...result, assignments: correctedAssignments };
      setWeeklySchedule(correctedResult);
      const now = new Date();
      setLastGeneratedAt(now);
      try {
        localStorage.setItem(`scheduleLastGenerated_${selectedBranchId}_${weekStart}`, now.toISOString());
      } catch { /* ignore */ }

      // ── Phase 2: Walker/public route pair collection ──────────────────────
      // Pairs are deduplicated by {visitDate}-{from}-{to}-{mode}-{timeTag} so
      // different days (and different departure times on the same day) are kept
      // separate. Walker Haversine estimates remain in effect — the TravelTime
      // API refinement endpoint is not yet active.
      const walkerPairMap = new Map<string, { fromLat: number; fromLng: number; toLat: number; toLng: number; mode: string; arrivalTimeMinutes?: number; departureTimeMinutes?: number; visitDate: string }>();
      Object.entries(correctedResult.assignments).forEach(([date, dayAssignments]) => {
        Object.entries(dayAssignments).forEach(([empName, visits]) => {
          const empLoc = employeeLocationMap.get(empName);
          if (!empLoc?.homeLat || !empLoc?.homeLng) return;
          const rawMode = (empLoc.transportMode || 'car').toLowerCase();
          if (rawMode === 'car') return; // walkers/public handled here
          const mode = rawMode === 'public' ? 'public' : 'walking';
          const homeLat = Number(empLoc.homeLat);
          const homeLng = Number(empLoc.homeLng);
          const addPair = (fLat: number, fLng: number, tLat: number, tLng: number, arrivalTimeMinutes?: number, departureTimeMinutes?: number) => {
            const timeTag = departureTimeMinutes !== undefined ? `d${departureTimeMinutes}` : arrivalTimeMinutes !== undefined ? `a${arrivalTimeMinutes}` : 'anon';
            const k = `${date}-${fLat.toFixed(4)},${fLng.toFixed(4)}-${tLat.toFixed(4)},${tLng.toFixed(4)}-${mode}-${timeTag}`;
            if (!walkerPairMap.has(k)) walkerPairMap.set(k, { fromLat: fLat, fromLng: fLng, toLat: tLat, toLng: tLng, mode, arrivalTimeMinutes, departureTimeMinutes, visitDate: date });
          };
          (visits as AssignedVisit[]).forEach((visit, vIdx) => {
            if (!visit.lat || !visit.lng) return;
            if (vIdx === 0) addPair(homeLat, homeLng, visit.lat, visit.lng, timeToMinutes(visit.startTime));
            if (vIdx < visits.length - 1) {
              const next = (visits as AssignedVisit[])[vIdx + 1];
              if (next.lat && next.lng) {
                // 90+ min gap → worker returns home during break
                const gapMin = timeToMinutes(next.startTime) - timeToMinutes(visit.endTime);
                const fromLat = gapMin >= 90 ? homeLat : visit.lat;
                const fromLng = gapMin >= 90 ? homeLng : visit.lng;
                addPair(fromLat, fromLng, next.lat, next.lng, timeToMinutes(next.startTime));
                if (gapMin >= 90 && visit.lat && visit.lng) addPair(visit.lat, visit.lng, homeLat, homeLng, undefined, timeToMinutes(visit.endTime));
              }
            }
            if (vIdx === visits.length - 1) addPair(visit.lat, visit.lng, homeLat, homeLng, undefined, timeToMinutes(visit.endTime));
          });
        });
      });
      clientLogger.log(`🚶 Walker pairs collected: ${walkerPairMap.size} unique route segments`);

      // finalResult = correctedResult (car post-break fix applied above;
      // walker routes use Haversine estimates already baked in by the engine)
      const finalResult = correctedResult;

      try {
        await apiRequest('POST', '/api/weekly-schedule/save', {
          weekStartDate: weekStart, weekEndDate: weekEnd,
          scheduleData: finalResult.assignments,
          unallocatedVisits: finalResult.unallocated,
          metrics: finalResult.metrics,
        });
        queryClient.invalidateQueries({ queryKey: ['/api/weekly-schedule/latest'] });
        toast({ title: "Schedule Generated & Saved", description: `Assigned ${finalResult.metrics.totalVisitsAssigned} visits across ${finalResult.metrics.employeesUtilized} employees` });
      } catch (error) {
        clientLogger.error('Failed to save schedule:', error);
        toast({ title: "Schedule Generated", description: `Assigned ${correctedResult.metrics.totalVisitsAssigned} visits (save failed)`, variant: "destructive" });
      }
    },
  });

  const saveScheduleMutation = useMutation({
    mutationFn: async (schedule: WeeklyScheduleData) => {
      await apiRequest('POST', '/api/weekly-schedule/save', {
        weekStartDate: weekStart, weekEndDate: weekEnd,
        scheduleData: schedule.assignments, unallocatedVisits: schedule.unallocated, metrics: schedule.metrics,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/weekly-schedule', weekStart] });
    },
  });

  const { data: savedSchedule, isFetching: isFetchingSchedule } = useQuery<WeeklySchedule | null>({
    queryKey: ['/api/weekly-schedule', weekStart],
    enabled: !!data && !!weekStart,
  });

  useEffect(() => {
    clientLogger.log("🧹 Data or week changed - clearing local schedule state");
    setWeeklySchedule(null);
    setSelectedEmployee(null);
  }, [data, weekStart]);

  useEffect(() => {
    if (savedSchedule?.scheduleData) {
      clientLogger.log(`📅 Loading saved schedule for week ${weekStart}`);
      setWeeklySchedule({
        assignments: savedSchedule.scheduleData as Record<string, Record<string, AssignedVisit[]>>,
        unallocated: (savedSchedule.unallocatedVisits as (ClientVisit & { unallocatedReason: string })[]) || [],
        metrics: (savedSchedule.metrics as WeeklyScheduleData['metrics']) || { totalVisitsAssigned: 0, totalVisitsUnallocated: 0, averageTravelTimePerVisit: 0, employeesUtilized: 0 },
      });
    } else if (!isFetchingSchedule) {
      setWeeklySchedule(null);
    }
  }, [savedSchedule, weekStart, weekEnd, isFetchingSchedule]);

  // ── Early returns ─────────────────────────────────────────────────────────
  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Calendar className="h-8 w-8 text-orange-500 mx-auto mb-2" />
          <p className="text-orange-600 font-medium">No processed data available</p>
          <p className="text-sm text-muted-foreground mt-1">Please process files first to enable weekly planning</p>
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

  // ── Derived helpers ────────────────────────────────────────────────────────
  const todayStr = new Date().toISOString().split('T')[0];
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();

  const getEmployeeScheduledMinutes = (empName: string) => {
    if (!weeklySchedule) return 0;
    return Object.values(weeklySchedule.assignments).reduce((sum, dayAssignments) => {
      return sum + (dayAssignments[empName] || []).reduce((s, v) => s + (v.durationMinutes || 0), 0);
    }, 0);
  };

  const currentEmpIndex = selectedEmployee ? filteredEmployees.indexOf(selectedEmployee) : -1;
  const prevEmployee = currentEmpIndex > 0 ? filteredEmployees[currentEmpIndex - 1] : null;
  const nextEmployee = currentEmpIndex < filteredEmployees.length - 1 ? filteredEmployees[currentEmpIndex + 1] : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">

      {/* ── Header bar ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Schedule</h2>
          <p className="text-sm text-muted-foreground">
            {weekStart} → {weekEnd}
            {lastGeneratedAt && (
              <span className="ml-2 text-xs">
                · Last generated {lastGeneratedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search caregivers…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 w-48 h-9"
            />
          </div>
          <Button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending || allWeekVisits.length === 0 || !canGenerate}
            title={!canGenerate ? "Only Schedulers and Admins can generate schedules" : ""}
            className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 h-9"
            data-testid="button-generate-weekly"
          >
            {generateMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating…</>
            ) : !canGenerate ? (
              <><Lock className="h-4 w-4 mr-2" />View Only</>
            ) : (
              <><Zap className="h-4 w-4 mr-2" />Generate Schedule</>
            )}
          </Button>
        </div>
      </div>

      {/* ── Metrics strip ─────────────────────────────────────────────────── */}
      {weeklySchedule && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Assigned', value: weeklySchedule.metrics.totalVisitsAssigned, color: 'text-green-600', border: 'border-green-200 dark:border-green-800' },
            { label: 'Unallocated', value: weeklySchedule.metrics.totalVisitsUnallocated, color: 'text-red-600', border: 'border-red-200 dark:border-red-800' },
            { label: 'Avg Travel', value: `${weeklySchedule.metrics.averageTravelTimePerVisit}m`, color: 'text-blue-600', border: 'border-blue-200 dark:border-blue-800' },
            { label: 'Staff Used', value: weeklySchedule.metrics.employeesUtilized, color: 'text-purple-600', border: 'border-purple-200 dark:border-purple-800' },
          ].map(m => (
            <div key={m.label} className={`bg-white dark:bg-gray-800 rounded-lg p-3 border ${m.border}`}>
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p className={`text-2xl font-bold ${m.color}`}>{m.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Gantt block ───────────────────────────────────────────────────── */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900 shadow-sm">

        {selectedEmployee ? (
          /* ════════════════════════════════════════════════════════════════
             WEEK VIEW — one caregiver, all 7 days
             ════════════════════════════════════════════════════════════════ */
          <>
            {/* Week View header bar */}
            <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex-wrap gap-y-1">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => prevEmployee && setSelectedEmployee(prevEmployee)}
                  disabled={!prevEmployee}
                  className="text-xs px-2.5 py-1 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
                >
                  Prev
                </button>
                <button
                  onClick={() => setSelectedEmployee(null)}
                  className="text-xs px-2.5 py-1 rounded border border-blue-400 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors font-medium"
                >
                  All
                </button>
                <button
                  onClick={() => nextEmployee && setSelectedEmployee(nextEmployee)}
                  disabled={!nextEmployee}
                  className="text-xs px-2.5 py-1 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
                >
                  Next
                </button>
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-sm text-gray-900 dark:text-white">{selectedEmployee}</span>
                <span className="text-muted-foreground text-xs ml-3">
                  {formatFullDate(weekDates[0])} to {formatShortDate(weekDates[6] || weekDates[0])}
                </span>
              </div>
              <div className="text-xs text-muted-foreground whitespace-nowrap">
                CAREGiver Hours:&nbsp;
                <strong className="text-gray-700 dark:text-gray-300">
                  {formatHhMm((employeeWeeklyHoursMap.get(selectedEmployee) || 0) * 60)}
                </strong>
                &nbsp;&nbsp;Scheduled Hours:&nbsp;
                <strong className="text-gray-700 dark:text-gray-300">
                  {formatHhMm(getEmployeeScheduledMinutes(selectedEmployee))}
                </strong>
              </div>
            </div>

            {/* Week View scrollable grid */}
            <div ref={scrollRef} className="overflow-x-auto" style={{ maxHeight: '70vh' }}>
              <div style={{ minWidth: WEEK_LEFT_PANEL_W + TIMELINE_WIDTH }}>
                {/* Hour labels header */}
                <div className="flex sticky top-0 z-20 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                  <div
                    className="flex-shrink-0 sticky left-0 z-30 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 h-7"
                    style={{ width: WEEK_LEFT_PANEL_W }}
                  />
                  <div className="relative h-7 bg-gray-50 dark:bg-gray-800" style={{ width: TIMELINE_WIDTH }}>
                    {Array.from({ length: 24 }, (_, h) => (
                      <div key={h} className="absolute top-0 bottom-0 flex flex-col" style={{ left: minsToPx(h * 60) }}>
                        <span className="text-[10px] text-muted-foreground pl-1 leading-none mt-1">{h.toString().padStart(2, '0')}:00</span>
                        <div className="flex-1 border-l border-gray-200 dark:border-gray-700 mt-px" />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Day rows */}
                {weekDates.map(date => {
                  const visits: AssignedVisit[] = weeklySchedule?.assignments[date]?.[selectedEmployee] || [];
                  const empForDate = data?.employeesByDate[date]?.find(e => e.employeeName === selectedEmployee);
                  const hasAvailability = !!(empForDate?.timeWindows?.trim());
                  const isToday = date === todayStr;

                  return (
                    <div key={date} className="flex border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50/40 dark:hover:bg-gray-800/20 transition-colors">
                      {/* Day label */}
                      <div
                        className="sticky left-0 z-10 flex flex-col justify-center px-3 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex-shrink-0"
                        style={{ width: WEEK_LEFT_PANEL_W, minWidth: WEEK_LEFT_PANEL_W, height: ROW_HEIGHT }}
                      >
                        <span className={`text-xs font-semibold ${hasAvailability ? 'text-gray-900 dark:text-gray-100' : 'text-muted-foreground'}`}>
                          {formatDayName(date)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{formatShortDate(date)}</span>
                        {visits.length > 0 && (
                          <span className="text-[10px] text-green-600 dark:text-green-400 mt-0.5">{visits.length} visits</span>
                        )}
                      </div>

                      {/* Timeline */}
                      <div className="relative" style={{ width: TIMELINE_WIDTH, height: ROW_HEIGHT }}>
                        {/* Hour grid lines */}
                        {Array.from({ length: 24 }, (_, h) => (
                          <div key={h} className="absolute top-0 bottom-0 border-l border-gray-100 dark:border-gray-800" style={{ left: minsToPx(h * 60) }} />
                        ))}
                        {/* Visit blocks */}
                        {visits.map((visit, i) => {
                          const startMins = timeToMinutes(visit.startTime);
                          const dur = visit.durationMinutes || Math.max(1, timeToMinutes(visit.endTime) - startMins);
                          const leftPx = minsToPx(startMins);
                          const widthPx = Math.max(minsToPx(dur), 20);
                          const isTraining = isTrainingBlock(visit.serviceType, visit.clientName);
                          return (
                            <div
                              key={i}
                              className={`absolute top-2 bottom-2 rounded text-white overflow-hidden select-none
                                ${isTraining ? 'bg-amber-500 hover:bg-amber-600' : 'bg-green-600 hover:bg-green-700'}
                                transition-colors cursor-pointer`}
                              style={{ left: leftPx, width: widthPx }}
                              title={`${visit.clientName}\n${visit.startTime}–${visit.endTime}`}
                            >
                              <div className="px-1.5 py-1 h-full flex flex-col justify-center overflow-hidden">
                                <div className="text-[10px] font-semibold truncate leading-tight">{visit.clientName}</div>
                                {widthPx > 80 && (
                                  <div className="text-[9px] opacity-85 truncate leading-tight">{visit.startTime}–{visit.endTime}</div>
                                )}
                                {widthPx > 150 && visit.serviceType && (
                                  <div className="text-[9px] opacity-70 truncate leading-tight">{visit.serviceType}</div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        {/* Now indicator */}
                        {isToday && (
                          <div className="absolute top-0 bottom-0 w-0.5 bg-green-500 z-20 pointer-events-none" style={{ left: minsToPx(nowMinutes) }} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          /* ════════════════════════════════════════════════════════════════
             DAY VIEW — all caregivers, one selected date
             ════════════════════════════════════════════════════════════════ */
          <>
            {/* Day tab selector */}
            <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 overflow-x-auto">
              {weekDates.map(date => (
                <button
                  key={date}
                  onClick={() => setGanttViewDate(date)}
                  className={`px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-colors
                    ${ganttViewDate === date
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                >
                  {formatDayTab(date)}
                  {date === todayStr && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />}
                </button>
              ))}
              <div className="ml-auto pl-3 text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                {formatFullDate(ganttViewDate || weekDates[0])}
              </div>
            </div>

            {/* Day View scrollable grid */}
            <div ref={scrollRef} className="overflow-x-auto" style={{ maxHeight: '72vh' }}>
              <div style={{ minWidth: LEFT_PANEL_W + TIMELINE_WIDTH }}>
                {/* Sticky hour labels header */}
                <div className="flex sticky top-0 z-20 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                  <div
                    className="flex-shrink-0 sticky left-0 z-30 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex items-end px-3 pb-1 h-9"
                    style={{ width: LEFT_PANEL_W }}
                  >
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">CAREGivers</span>
                  </div>
                  <div className="relative h-9 bg-gray-50 dark:bg-gray-800" style={{ width: TIMELINE_WIDTH }}>
                    {Array.from({ length: 24 }, (_, h) => (
                      <div key={h} className="absolute top-0 bottom-0 flex flex-col" style={{ left: minsToPx(h * 60) }}>
                        <span className="text-[10px] text-muted-foreground pl-1 leading-none mt-1.5">{h.toString().padStart(2, '0')}:00</span>
                        <div className="flex-1 border-l border-gray-200 dark:border-gray-700 mt-px" />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Caregiver rows */}
                {filteredEmployees.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                    {weeklySchedule ? 'No caregivers match your search' : 'Generate a schedule to see assignments'}
                  </div>
                ) : (
                  filteredEmployees.map(empName => {
                    const visits: AssignedVisit[] = weeklySchedule?.assignments[ganttViewDate]?.[empName] || [];
                    const gender = employeeGenderMap.get(empName) || '';
                    const ghMinutes = (employeeWeeklyHoursMap.get(empName) || 0) * 60;
                    const scheduledMinutes = getEmployeeScheduledMinutes(empName);
                    const location = employeeLocationMap.get(empName);
                    const initials = getInitials(empName);
                    const isFemale = gender.toLowerCase() === 'female';
                    const isMale = gender.toLowerCase() === 'male';
                    const isToday = ganttViewDate === todayStr;

                    return (
                      <div
                        key={empName}
                        className="flex border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50/30 dark:hover:bg-gray-800/20 transition-colors"
                      >
                        {/* Left panel */}
                        <div
                          className="sticky left-0 z-10 flex items-center gap-2.5 px-2.5 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex-shrink-0"
                          style={{ width: LEFT_PANEL_W, minWidth: LEFT_PANEL_W, height: ROW_HEIGHT }}
                          onClick={() => setSelectedEmployee(empName)}
                          data-testid={`select-employee-${empName}`}
                        >
                          {/* Avatar */}
                          <div
                            className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold text-white select-none
                              ${isFemale ? 'bg-pink-500' : isMale ? 'bg-blue-500' : 'bg-gray-400'}`}
                          >
                            {initials}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1">
                              <span
                                className={`text-xs font-semibold truncate leading-tight ${getGenderColorClass(gender)}`}
                                title={empName}
                              >
                                {empName}
                              </span>
                              <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            </div>
                            <div className="text-[10px] text-muted-foreground leading-tight">CAREGiver</div>
                            {location?.homePostcode && (
                              <div className="text-[10px] text-muted-foreground truncate leading-tight">{location.homePostcode}</div>
                            )}
                            <div className="text-[10px] text-muted-foreground leading-tight">
                              CAREGiver Hours: <span className="font-medium">{formatHhMm(ghMinutes)}</span>
                            </div>
                            <div className="text-[10px] text-muted-foreground leading-tight">
                              Scheduled Hours: <span className="font-medium text-green-700 dark:text-green-400">{formatHhMm(scheduledMinutes)}</span>
                            </div>
                          </div>
                        </div>

                        {/* Timeline */}
                        <div className="relative flex-shrink-0" style={{ width: TIMELINE_WIDTH, height: ROW_HEIGHT }}>
                          {/* Hour grid lines */}
                          {Array.from({ length: 24 }, (_, h) => (
                            <div key={h} className="absolute top-0 bottom-0 border-l border-gray-100 dark:border-gray-800" style={{ left: minsToPx(h * 60) }} />
                          ))}

                          {/* Visit blocks */}
                          {visits.map((visit, i) => {
                            const startMins = timeToMinutes(visit.startTime);
                            const dur = visit.durationMinutes || Math.max(1, timeToMinutes(visit.endTime) - startMins);
                            const leftPx = minsToPx(startMins);
                            const widthPx = Math.max(minsToPx(dur), 20);
                            const isTraining = isTrainingBlock(visit.serviceType, visit.clientName);
                            return (
                              <div
                                key={i}
                                className={`absolute top-2 bottom-2 rounded overflow-hidden text-white select-none
                                  ${isTraining ? 'bg-amber-500 hover:bg-amber-600' : 'bg-green-600 hover:bg-green-700'}
                                  transition-colors cursor-pointer`}
                                style={{ left: leftPx, width: widthPx }}
                                title={`${visit.clientName}\n${visit.startTime}–${visit.endTime}`}
                              >
                                <div className="px-1.5 py-1 h-full flex flex-col justify-center overflow-hidden">
                                  <div className="text-[10px] font-semibold truncate leading-tight">{visit.clientName}</div>
                                  {widthPx > 80 && (
                                    <div className="text-[9px] opacity-85 truncate leading-tight">{visit.startTime}–{visit.endTime}</div>
                                  )}
                                  {widthPx > 150 && visit.serviceType && (
                                    <div className="text-[9px] opacity-70 truncate leading-tight">{visit.serviceType}</div>
                                  )}
                                </div>
                              </div>
                            );
                          })}

                          {/* Now indicator */}
                          {isToday && (
                            <div className="absolute top-0 bottom-0 w-0.5 bg-green-500 z-20 pointer-events-none" style={{ left: minsToPx(nowMinutes) }} />
                          )}
                        </div>
                      </div>
                    );
                  })
                )}

                {/* Absent employees section */}
                {absentGhEmployees.filter(e => e.name.toLowerCase().includes(searchTerm.toLowerCase())).length > 0 && (
                  <>
                    <div className="border-t border-dashed border-gray-300 dark:border-gray-600 px-3 py-1.5 bg-gray-50 dark:bg-gray-800">
                      <span className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider">Absent this week</span>
                    </div>
                    {absentGhEmployees
                      .filter(e => e.name.toLowerCase().includes(searchTerm.toLowerCase()))
                      .map(emp => {
                        const gender = employeeGenderMap.get(emp.name) || '';
                        const isHoliday = emp.status.toLowerCase().includes('holiday') || emp.status.toLowerCase().includes('annual');
                        const isSick = emp.status.toLowerCase().includes('sick');
                        return (
                          <div key={emp.name} className="flex border-t border-gray-100 dark:border-gray-800 opacity-50">
                            <div
                              className="sticky left-0 z-10 flex items-center gap-2.5 px-2.5 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex-shrink-0"
                              style={{ width: LEFT_PANEL_W, minWidth: LEFT_PANEL_W, height: ROW_HEIGHT }}
                            >
                              <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                                {getInitials(emp.name)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className={`text-xs font-semibold truncate leading-tight ${getGenderColorClass(gender)}`}>{emp.name}</div>
                                <div className="text-[10px] text-muted-foreground">CAREGiver</div>
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] mt-0.5 ${isHoliday ? 'text-amber-600 border-amber-400' : isSick ? 'text-red-600 border-red-400' : 'text-orange-600 border-orange-400'}`}
                                >
                                  {isHoliday ? 'Holiday' : isSick ? 'Sick' : emp.status}
                                </Badge>
                              </div>
                            </div>
                            <div className="relative flex-shrink-0 bg-gray-50/30 dark:bg-gray-800/10" style={{ width: TIMELINE_WIDTH, height: ROW_HEIGHT }}>
                              {Array.from({ length: 24 }, (_, h) => (
                                <div key={h} className="absolute top-0 bottom-0 border-l border-gray-100 dark:border-gray-800" style={{ left: minsToPx(h * 60) }} />
                              ))}
                            </div>
                          </div>
                        );
                      })}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Unallocated Visits ────────────────────────────────────────────── */}
      {weeklySchedule && weeklySchedule.unallocated.length > 0 && (
        <div className="border border-red-200 dark:border-red-800 rounded-lg overflow-hidden bg-white dark:bg-gray-900 shadow-sm">
          <div className="flex items-center justify-between px-4 py-2.5 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-800">
            <span className="font-semibold text-red-700 dark:text-red-400 text-sm">
              Unallocated Visits ({weeklySchedule.unallocated.length})
            </span>
            <Badge variant="destructive" className="text-xs">
              {((weeklySchedule.unallocated.length / (weeklySchedule.metrics.totalVisitsAssigned + weeklySchedule.unallocated.length)) * 100).toFixed(1)}% unallocated
            </Badge>
          </div>
          <div className="p-4 max-h-[400px] overflow-y-auto">
            <div className="space-y-4">
              {weekDates.map((date, dayIndex) => {
                const dayUnallocated = weeklySchedule.unallocated.filter(v => v.date === date);
                if (dayUnallocated.length === 0) return null;
                return (
                  <div key={date} className="border border-red-200 dark:border-red-700 rounded-lg p-3 bg-red-50/50 dark:bg-red-950/10">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-red-700 dark:text-red-400 text-sm flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        {dayNames[dayIndex]} — {date.split('-').slice(1).join('/')}
                      </h3>
                      <Badge variant="destructive" className="text-xs">{dayUnallocated.length}</Badge>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                      {dayUnallocated.map((visit, index) => (
                        <div
                          key={`${visit.id}-${index}`}
                          className="bg-white dark:bg-gray-800 border border-red-300 dark:border-red-700 rounded-lg p-2"
                          title={visit.unallocatedReason}
                        >
                          <p className="font-semibold text-xs text-gray-900 dark:text-gray-100 truncate">{visit.clientName}</p>
                          <div className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                            <Clock className="h-3 w-3" />{visit.startTime}–{visit.endTime}
                          </div>
                          <Badge variant="outline" className="text-[10px] text-red-700 dark:text-red-400 border-red-300 bg-red-50 dark:bg-red-950 mt-1 max-w-full break-words whitespace-normal">
                            {visit.unallocatedReason || "Not optimal"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
