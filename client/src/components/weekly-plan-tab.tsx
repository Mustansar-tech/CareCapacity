import { useState, useEffect, useRef } from "react";
import { clientLogger } from '@/lib/logger';
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Calendar, Zap, Loader2, Clock, Search, ChevronRight, Lock,
  Car, Bus, Footprints, Home, ArrowRight, Coffee, X,
} from "lucide-react";
import {
  DndContext, DragOverlay,
  useDraggable, useDroppable,
  PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { getGenderColorClass } from "@/utils/gender-colors";
import {
  timeToMinutes, getTravelMinutes, seedTravelCache, clearTravelCache,
  fitsInWindow, MAX_TRAVEL_TIME_MINUTES, MAX_TRAVEL_TIME_MINUTES_WALKER,
} from "@/utils/scheduling-utils";
import type { TimeWindow } from "@/utils/scheduling-utils";
import type {
  ProcessingResult, ClientVisit, EmployeeLocation, ClientLocation,
  WeeklySchedule, EmployeeDailyDetail,
} from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getCanonicalWeekBoundaries } from "@shared/schema";
import { generateWeeklySchedule } from "@/utils/scheduling-engine";

// ── Interfaces ────────────────────────────────────────────────────────────────

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

type DragItem =
  | { type: 'assignedVisit'; empName: string; visitDate: string; visitIndex: number; visit: AssignedVisit }
  | { type: 'unallocatedVisit'; visit: ClientVisit & { unallocatedReason: string } };

type DropTarget =
  | { type: 'empRow'; empName: string }
  | { type: 'unallocatedPanel' };

// ── Timeline constants ────────────────────────────────────────────────────────
const MINS_PER_PX = 2;
const TIMELINE_WIDTH = 1440 * MINS_PER_PX; // 2880px
const LEFT_PANEL_W = 256;
const WEEK_LEFT_PANEL_W = 130;
const ROW_HEIGHT = 88;

function minsToPx(mins: number) { return mins * MINS_PER_PX; }

// ── Module-level helpers ──────────────────────────────────────────────────────

function fmtHhMm(mins: number) {
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

function fmtHh(mins: number) {
  const h = (mins / 60);
  return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`;
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

function isTrainingBlock(serviceType?: string, clientName?: string) {
  const t = ((serviceType || '') + ' ' + (clientName || '')).toLowerCase();
  return t.includes('training') || t.includes('office') || t.includes('admin') ||
    t.includes('meeting') || t.includes('shadow') || t.includes('live in') || t.includes('live-in');
}

function fmtFullDate(d: string) {
  try {
    return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', {
      weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
    });
  } catch { return d; }
}

function fmtShortDate(d: string) {
  try {
    return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
    });
  } catch { return d; }
}

function fmtDayName(d: string) {
  try {
    return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  } catch { return d; }
}

function fmtDayTab(d: string) {
  try {
    return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
  } catch { return d; }
}

/** Parse "HH:MM-HH:MM; ..." without logging */
function silentParseTimeWindows(tw: string): TimeWindow[] {
  if (!tw?.trim()) return [];
  return tw.split(/[;,]/).map(s => s.trim()).filter(Boolean).flatMap(w => {
    const m = w.match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
    if (!m) return [];
    const start = timeToMinutes(m[1]);
    const endH = parseInt(m[2].split(':')[0]);
    const end = timeToMinutes(m[2], endH < 6);
    return [{ start, end }];
  });
}

function TransportIcon({ mode }: { mode?: string | null }) {
  const m = (mode || 'car').toLowerCase();
  if (m === 'walking') return <Footprints className="h-3.5 w-3.5 text-green-600 dark:text-green-400 flex-shrink-0" />;
  if (m === 'public') return <Bus className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400 flex-shrink-0" />;
  return <Car className="h-3.5 w-3.5 text-gray-500 dark:text-gray-400 flex-shrink-0" />;
}

// ── DnD sub-components (must be outside WeeklyPlanTab for stable hook calls) ──

function DraggableVisitItem({
  dragId, dragData, disabled, style, className, children,
}: {
  dragId: string; dragData: DragItem; disabled?: boolean;
  style?: React.CSSProperties; className?: string; children?: React.ReactNode;
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: dragId, data: dragData, disabled,
  });
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${className || ''} ${isDragging ? 'opacity-30 !z-0' : ''} cursor-grab active:cursor-grabbing`}
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  );
}

function DroppableTimelineRow({
  dropId, dropData, style, className, children, dragAcceptance,
}: {
  dropId: string; dropData: DropTarget;
  style?: React.CSSProperties; className?: string; children: React.ReactNode;
  dragAcceptance?: { accepts: boolean } | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId, data: dropData });
  let hoverCls: string;
  if (dragAcceptance != null) {
    if (dragAcceptance.accepts) {
      hoverCls = isOver
        ? 'bg-green-100 dark:bg-green-900/50'
        : 'bg-green-50/40 dark:bg-green-900/20';
    } else {
      hoverCls = 'bg-red-50/30 dark:bg-red-900/15';
    }
  } else {
    hoverCls = isOver ? 'bg-blue-50 dark:bg-blue-900/25' : '';
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${className || ''} transition-colors duration-100 ${hoverCls}`}
    >
      {children}
    </div>
  );
}

function DroppableUnallocatedPanel({
  children, className,
}: { children: React.ReactNode; className?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'unallocated-panel', data: { type: 'unallocatedPanel' } as DropTarget });
  return (
    <div
      ref={setNodeRef}
      className={`${className || ''} transition-colors duration-100 ${isOver ? 'ring-2 ring-red-400 ring-inset' : ''}`}
    >
      {children}
    </div>
  );
}

function DraggableUnallocatedCard({
  dragId, dragData, disabled, className, children,
}: {
  dragId: string; dragData: DragItem; disabled?: boolean;
  className?: string; children: React.ReactNode;
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: dragId, data: dragData, disabled,
  });
  return (
    <div
      ref={setNodeRef}
      className={`${className || ''} ${isDragging ? 'opacity-40' : ''} cursor-grab active:cursor-grabbing`}
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  );
}

function DragOverlayContent({ item }: { item: DragItem }) {
  if (item.type === 'assignedVisit') {
    const { visit } = item;
    const training = isTrainingBlock(visit.serviceType, visit.clientName);
    return (
      <div className={`rounded-lg shadow-2xl text-white px-3 py-2 text-xs font-semibold border border-white/20 select-none
        ${training ? 'bg-amber-500' : 'bg-green-600'}`}>
        <div className="truncate max-w-[180px]">{visit.clientName}</div>
        <div className="text-[10px] opacity-85 mt-0.5">{visit.startTime}–{visit.endTime}</div>
      </div>
    );
  }
  const { visit } = item;
  return (
    <div className="rounded-lg shadow-2xl bg-red-600 text-white px-3 py-2 text-xs font-semibold border border-white/20 select-none">
      <div className="truncate max-w-[180px]">{visit.clientName}</div>
      <div className="text-[10px] opacity-85 mt-0.5">{visit.startTime}–{visit.endTime}</div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface WeeklyPlanTabProps {
  data: ProcessingResult | null;
  selectedDate?: string | null;
}

export function WeeklyPlanTab({ data, selectedDate }: WeeklyPlanTabProps) {
  const { toast } = useToast();
  const { canGenerate } = useAuth();
  const { selectedBranchId } = useBranch();

  // ── State ──────────────────────────────────────────────────────────────────
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [weeklySchedule, setWeeklySchedule] = useState<WeeklyScheduleData | null>(null);
  const [lastGeneratedAt, setLastGeneratedAt] = useState<Date | null>(null);
  const [travelSources, setTravelSources] = useState<Record<string, number> | null>(null);
  const [ganttViewDate, setGanttViewDate] = useState<string>('');
  const [selectedUnallocatedId, setSelectedUnallocatedId] = useState<string | null>(null);
  const [acceptanceMap, setAcceptanceMap] = useState<Map<string, { accepts: boolean; reason: string }> | null>(null);
  const [activeDragItem, setActiveDragItem] = useState<DragItem | null>(null);
  const [dragValidationMap, setDragValidationMap] = useState<Map<string, { accepts: boolean; reason: string }> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ganttWrapperRef = useRef<HTMLDivElement>(null);

  const currentWeek = selectedDate || new Date().toISOString().split('T')[0];
  const { weekStart, weekEnd } = getCanonicalWeekBoundaries(currentWeek);

  const weekDates = (() => {
    const dates: string[] = [];
    const start = new Date(weekStart + 'T00:00:00.000Z');
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
  })();

  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    if (selectedDate && weekDates.includes(selectedDate)) setGanttViewDate(selectedDate);
    else if (weekDates.includes(today)) setGanttViewDate(today);
    else setGanttViewDate(weekDates[0] || today);
  }, [weekStart, selectedDate]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = minsToPx(7 * 60);
  }, [ganttViewDate, selectedEmployee, weeklySchedule]);

  useEffect(() => {
    if (!selectedBranchId || !weekStart) { setLastGeneratedAt(null); return; }
    try {
      const stored = localStorage.getItem(`scheduleLastGenerated_${selectedBranchId}_${weekStart}`);
      setLastGeneratedAt(stored ? new Date(stored) : null);
    } catch { setLastGeneratedAt(null); }
  }, [selectedBranchId, weekStart]);

  // Clear unallocated selection when pressing Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedUnallocatedId) {
        setSelectedUnallocatedId(null);
        setAcceptanceMap(null);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectedUnallocatedId]);

  // Clear unallocated selection when clicking outside the schedule panel
  useEffect(() => {
    if (!selectedUnallocatedId) return;
    const handler = (e: MouseEvent) => {
      if (ganttWrapperRef.current && !ganttWrapperRef.current.contains(e.target as Node)) {
        setSelectedUnallocatedId(null);
        setAcceptanceMap(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [selectedUnallocatedId]);

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: locationsData } = useQuery<{ employees: EmployeeLocation[]; clients: ClientLocation[] }>({
    queryKey: ['/api/locations'],
    enabled: !!data,
  });

  const employeeLocationMap = new Map(
    (locationsData?.employees || []).map(emp => [emp.employeeName, emp])
  );

  const { data: weekVisitsData } = useQuery<ClientVisit[]>({
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

  Object.values(data?.employeesByDate || {}).forEach(dayEmps => {
    dayEmps.forEach(emp => {
      if (emp.contractedDailyHours > 0) {
        employeeWeeklyHoursMap.set(emp.employeeName, (employeeWeeklyHoursMap.get(emp.employeeName) || 0) + emp.contractedDailyHours);
      }
      if (emp.gender && !employeeGenderMap.has(emp.employeeName)) employeeGenderMap.set(emp.employeeName, emp.gender);
      const sl = (emp.status || '').toLowerCase();
      if (sl.includes('holiday') || sl.includes('annual leave')) {
        employeeHolidaysMap.set(emp.employeeName, (employeeHolidaysMap.get(emp.employeeName) || 0) + 1);
      } else if (sl.includes('unavailable') || sl.includes('sick') || sl.includes('off')) {
        employeeUnavailabilityMap.set(emp.employeeName, (employeeUnavailabilityMap.get(emp.employeeName) || 0) + 1);
      }
    });
  });

  Object.values(data?.employeesByDate || {}).forEach(emps =>
    emps.forEach(emp => {
      employeeWeeklyNetCapacityMap.set(emp.employeeName, (employeeWeeklyNetCapacityMap.get(emp.employeeName) || 0) + (emp.netCapacity || 0));
    })
  );

  const employeeMap = new Map<string, EmployeeDailyDetail>();
  const adHocEmployees = new Set<string>();

  Object.values(data?.employeesByDate || {}).flat().forEach(emp => {
    if (emp.status === 'Ad-hoc') adHocEmployees.add(emp.employeeName);
    if (emp.timeWindows?.trim() && emp.status !== 'Ad-hoc' && (employeeWeeklyHoursMap.get(emp.employeeName) || 0) > 0) {
      const ex = employeeMap.get(emp.employeeName);
      if (!ex || emp.contractedDailyHours > (ex.contractedDailyHours || 0)) employeeMap.set(emp.employeeName, emp);
    }
  });

  const availableEmployees = Array.from(employeeMap.values());

  const absentGhEmployeeMap = new Map<string, { gh: number; status: string }>();
  Object.values(data?.employeesByDate || {}).flat().forEach(emp => {
    if ((employeeWeeklyHoursMap.get(emp.employeeName) || 0) > 0 && emp.status !== 'Ad-hoc' &&
      !employeeMap.has(emp.employeeName) && !absentGhEmployeeMap.has(emp.employeeName)) {
      absentGhEmployeeMap.set(emp.employeeName, { gh: employeeWeeklyHoursMap.get(emp.employeeName) || 0, status: emp.status || 'Unavailable' });
    }
  });
  const absentGhEmployees = Array.from(absentGhEmployeeMap.entries())
    .map(([name, info]) => ({ name, ...info })).sort((a, b) => a.name.localeCompare(b.name));

  const employeesWithAssignments = weeklySchedule
    ? Array.from(new Set(Object.values(weeklySchedule.assignments).flatMap(da => Object.keys(da))))
      .filter(n => !adHocEmployees.has(n) && (employeeWeeklyHoursMap.get(n) || 0) > 0).sort()
    : [];

  const employeeNames = weeklySchedule
    ? Array.from(new Set([...employeesWithAssignments, ...availableEmployees.map(e => e.employeeName)])).sort()
    : availableEmployees.map(e => e.employeeName).sort();

  const filteredEmployees = employeeNames.filter(n => n.toLowerCase().includes(searchTerm.toLowerCase()));

  // ── Generate mutation ──────────────────────────────────────────────────────

  const generateMutation = useMutation({
    mutationFn: async () => {
      clientLogger.log(`📅 Generating schedule: ${weekDates.length} days, ${allWeekVisits.length} visits`);

      const employeesWithLocations = Object.entries(data?.employeesByDate || {}).flatMap(([date, empList]) =>
        empList.filter(emp => (employeeWeeklyHoursMap.get(emp.employeeName) || 0) > 0).map(emp => {
          const loc = locationsData?.employees.find(l => l.employeeName === emp.employeeName);
          return {
            employeeName: emp.employeeName, date,
            timeWindows: emp.timeWindows,
            homeLat: loc?.homeLat ? Number(loc.homeLat) : undefined,
            homeLng: loc?.homeLng ? Number(loc.homeLng) : undefined,
            transportMode: loc?.transportMode || undefined,
            weeklyContractedHours: employeeWeeklyHoursMap.get(emp.employeeName) || 0,
            gender: emp.gender || loc?.gender || undefined,
          };
        })
      );

      const visitsWithLocations: ClientVisit[] = allWeekVisits.map((v, i) => {
        const cl = locationsData?.clients.find(c => c.clientName === v.clientName);
        return {
          id: v.id || `${v.clientName}-${v.startTime}-${v.endTime}-${i}`,
          clientName: v.clientName, startTime: v.startTime, endTime: v.endTime,
          durationMinutes: v.durationMinutes, date: v.date,
          lat: cl?.lat ? Number(cl.lat) : undefined,
          lng: cl?.lng ? Number(cl.lng) : undefined,
          serviceType: v.serviceType, priority: v.priority,
        };
      });

      try {
        clearTravelCache();
        const uniqueEmpMap = new Map<string, { lat: number; lng: number; mode: string }>();
        const uniqueClientMap = new Map<string, { lat: number; lng: number }>();
        employeesWithLocations.forEach(e => {
          if (e.homeLat && e.homeLng) {
            const k = `${e.homeLat},${e.homeLng},${e.transportMode || 'car'}`;
            if (!uniqueEmpMap.has(k)) uniqueEmpMap.set(k, { lat: e.homeLat, lng: e.homeLng, mode: e.transportMode || 'car' });
          }
        });
        visitsWithLocations.forEach(v => {
          if (v.lat && v.lng) {
            const k = `${v.lat},${v.lng}`;
            if (!uniqueClientMap.has(k)) uniqueClientMap.set(k, { lat: v.lat, lng: v.lng });
          }
        });
        const uEmps = Array.from(uniqueEmpMap.values());
        const uClients = Array.from(uniqueClientMap.values());
        if (uEmps.length && uClients.length) {
          const earliest = [...allWeekVisits.map(v => v.startTime).filter(Boolean)].sort()[0] || '08:00';
          const resp = await apiRequest('POST', '/api/travel-times/batch', {
            employees: uEmps, clients: uClients, weekStart, earliestStartTime: earliest,
          });
          const td = await resp.json();
          if (td.results?.length) seedTravelCache(td.results);
          if (td.travelSources) setTravelSources(td.travelSources);
        }
      } catch (e) {
        clientLogger.warn('⚠️ Travel pre-fetch failed - using Haversine fallback:', e);
      }

      const result = generateWeeklySchedule(visitsWithLocations, employeesWithLocations, weekDates);
      type EngineUnallocated = ClientVisit & { rejectionReason?: string; reason?: string; unallocatedReason?: string };
      return {
        assignments: result.assignments,
        unallocated: (result.unallocated as EngineUnallocated[]).map(v => ({
          ...v,
          unallocatedReason: v.rejectionReason || v.reason || v.unallocatedReason || "Not optimal for this run",
        })),
        metrics: result.metrics,
      } as WeeklyScheduleData;
    },
    onSuccess: async (result) => {
      // Phase 1.5: Post-break home-departure correction (car employees)
      const correctedAssignments = { ...result.assignments };
      Object.entries(result.assignments).forEach(([date, da]) => {
        Object.entries(da).forEach(([empName, visits]) => {
          const empLoc = employeeLocationMap.get(empName);
          if (!empLoc?.homeLat || !empLoc?.homeLng) return;
          if ((empLoc.transportMode || 'car').toLowerCase() !== 'car') return;
          const hLat = Number(empLoc.homeLat), hLng = Number(empLoc.homeLng);
          const corrected = (visits as AssignedVisit[]).map((v, i) => {
            if (i === 0 || !v.lat || !v.lng) return v;
            const prev = (visits as AssignedVisit[])[i - 1];
            if (timeToMinutes(v.startTime) - timeToMinutes(prev.endTime) < 90) return v;
            return { ...v, travelTimeBefore: getTravelMinutes({ lat: hLat, lng: hLng }, { lat: v.lat, lng: v.lng }, 'car') };
          });
          if (!correctedAssignments[date]) correctedAssignments[date] = {};
          correctedAssignments[date][empName] = corrected;
        });
      });
      const correctedResult = { ...result, assignments: correctedAssignments };
      setWeeklySchedule(correctedResult);
      const now = new Date();
      setLastGeneratedAt(now);
      try { localStorage.setItem(`scheduleLastGenerated_${selectedBranchId}_${weekStart}`, now.toISOString()); } catch { /* ignore */ }

      // ── Phase 2: Walker/public route pair collection ──────────────────
      // Pairs deduplicated by {date}-{from}-{to}-{mode}-{timeTag}. Haversine
      // estimates remain in effect; TravelTime API refinement not yet active.
      const walkerPairMap = new Map<string, { fromLat: number; fromLng: number; toLat: number; toLng: number; mode: string; arrivalTimeMinutes?: number; departureTimeMinutes?: number; visitDate: string }>();
      Object.entries(correctedResult.assignments).forEach(([date, da]) => {
        Object.entries(da).forEach(([empName, visits]) => {
          const empLoc = employeeLocationMap.get(empName);
          if (!empLoc?.homeLat || !empLoc?.homeLng) return;
          const rawMode = (empLoc.transportMode || 'car').toLowerCase();
          if (rawMode === 'car') return;
          const mode = rawMode === 'public' ? 'public' : 'walking';
          const hLat = Number(empLoc.homeLat), hLng = Number(empLoc.homeLng);
          const addPair = (fLat: number, fLng: number, tLat: number, tLng: number, arr?: number, dep?: number) => {
            const tt = dep !== undefined ? `d${dep}` : arr !== undefined ? `a${arr}` : 'anon';
            const k = `${date}-${fLat.toFixed(4)},${fLng.toFixed(4)}-${tLat.toFixed(4)},${tLng.toFixed(4)}-${mode}-${tt}`;
            if (!walkerPairMap.has(k)) walkerPairMap.set(k, { fromLat: fLat, fromLng: fLng, toLat: tLat, toLng: tLng, mode, arrivalTimeMinutes: arr, departureTimeMinutes: dep, visitDate: date });
          };
          (visits as AssignedVisit[]).forEach((v, i) => {
            if (!v.lat || !v.lng) return;
            if (i === 0) addPair(hLat, hLng, v.lat, v.lng, timeToMinutes(v.startTime));
            if (i < visits.length - 1) {
              const nx = (visits as AssignedVisit[])[i + 1];
              if (nx.lat && nx.lng) {
                const gap = timeToMinutes(nx.startTime) - timeToMinutes(v.endTime);
                addPair(gap >= 90 ? hLat : v.lat, gap >= 90 ? hLng : v.lng, nx.lat, nx.lng, timeToMinutes(nx.startTime));
                if (gap >= 90) addPair(v.lat, v.lng, hLat, hLng, undefined, timeToMinutes(v.endTime));
              }
            }
            if (i === visits.length - 1) addPair(v.lat, v.lng, hLat, hLng, undefined, timeToMinutes(v.endTime));
          });
        });
      });
      clientLogger.log(`🚶 Walker pairs collected: ${walkerPairMap.size}`);
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
      } catch (err) {
        clientLogger.error('Failed to save schedule:', err);
        toast({ title: "Schedule Generated", description: `Assigned ${finalResult.metrics.totalVisitsAssigned} visits (save failed)`, variant: "destructive" });
      }
    },
  });

  const saveScheduleMutation = useMutation({
    mutationFn: async (schedule: WeeklyScheduleData) => {
      await apiRequest('POST', '/api/weekly-schedule/save', {
        weekStartDate: weekStart, weekEndDate: weekEnd,
        scheduleData: schedule.assignments,
        unallocatedVisits: schedule.unallocated,
        metrics: schedule.metrics,
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
    setSelectedUnallocatedId(null);
    setAcceptanceMap(null);
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
  }, [savedSchedule, weekStart, isFetchingSchedule]);

  // ── Early return ───────────────────────────────────────────────────────────

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Calendar className="h-8 w-8 text-orange-500 mx-auto mb-2" />
          <p className="text-orange-600 font-medium">No processed data available</p>
          <p className="text-sm text-muted-foreground mt-1">Upload files to get started</p>
        </div>
      </div>
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  const todayStr = new Date().toISOString().split('T')[0];
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();

  const getEmployeeScheduledMinutes = (empName: string) => {
    if (!weeklySchedule) return 0;
    return Object.values(weeklySchedule.assignments).reduce((sum, da) =>
      sum + (da[empName] || []).reduce((s, v) => s + (v.durationMinutes || 0), 0), 0);
  };

  const getEmployeeDayVisitHours = (empName: string, date: string) => {
    const visits = weeklySchedule?.assignments[date]?.[empName] || [];
    return visits.reduce((s, v) => s + (v.durationMinutes || 0), 0) / 60;
  };

  const currentEmpIndex = selectedEmployee ? filteredEmployees.indexOf(selectedEmployee) : -1;
  const prevEmployee = currentEmpIndex > 0 ? filteredEmployees[currentEmpIndex - 1] : null;
  const nextEmployee = currentEmpIndex < filteredEmployees.length - 1 ? filteredEmployees[currentEmpIndex + 1] : null;

  /** Recalculate travelTimeBefore for every visit in an employee's day after a manual move */
  function recalcTravelForDay(empName: string, visits: AssignedVisit[]): AssignedVisit[] {
    const empLoc = employeeLocationMap.get(empName);
    if (!empLoc?.homeLat || !empLoc?.homeLng) return visits;
    const mode = ((empLoc.transportMode || 'car') as 'car' | 'walking' | 'public');
    const hLat = Number(empLoc.homeLat), hLng = Number(empLoc.homeLng);
    return visits.map((v, i) => {
      if (!v.lat || !v.lng) return v;
      const prev = visits[i - 1];
      const gapFromPrev = prev ? timeToMinutes(v.startTime) - timeToMinutes(prev.endTime) : Infinity;
      const fromLoc = (i === 0 || !prev?.lat || !prev?.lng || gapFromPrev >= 90)
        ? { lat: hLat, lng: hLng }
        : { lat: Number(prev.lat), lng: Number(prev.lng) };
      return { ...v, travelTimeBefore: Math.round(getTravelMinutes(fromLoc, { lat: Number(v.lat), lng: Number(v.lng) }, mode)) };
    });
  }

  /** Recompute schedule metrics after a manual move */
  function recomputeMetrics(
    assignments: Record<string, Record<string, AssignedVisit[]>>,
    unallocated: Array<ClientVisit & { unallocatedReason: string }>,
  ): WeeklyScheduleData['metrics'] {
    let totalAssigned = 0, totalTravel = 0;
    const empsUsed = new Set<string>();
    Object.values(assignments).forEach(dayMap =>
      Object.entries(dayMap).forEach(([emp, visits]) => {
        if (!visits.length) return;
        empsUsed.add(emp);
        totalAssigned += visits.length;
        totalTravel += visits.reduce((s, v) => s + (v.travelTimeBefore || 0), 0);
      })
    );
    return {
      totalVisitsAssigned: totalAssigned,
      totalVisitsUnallocated: unallocated.length,
      averageTravelTimePerVisit: totalAssigned > 0 ? Math.round(totalTravel / totalAssigned) : 0,
      employeesUtilized: empsUsed.size,
    };
  }

  /** Check if an employee can accept a visit on a given date */
  function computeEmpAcceptance(
    visit: { startTime: string; endTime: string; durationMinutes: number; lat?: number | null; lng?: number | null },
    empName: string,
    date: string,
  ): { accepts: boolean; reason: string } {
    const empDay = data?.employeesByDate[date]?.find(e => e.employeeName === empName);
    if (!empDay) return { accepts: false, reason: 'No availability data' };
    const windows = silentParseTimeWindows(empDay.timeWindows || '');
    if (!windows.length) return { accepts: false, reason: 'No availability window' };

    const visitStart = timeToMinutes(visit.startTime);
    const visitEnd = timeToMinutes(visit.endTime);

    if (!fitsInWindow(visitStart, visitEnd, windows))
      return { accepts: false, reason: 'Outside availability window' };

    const dayVisits = weeklySchedule?.assignments[date]?.[empName] || [];
    for (const ex of dayVisits) {
      const eS = timeToMinutes(ex.startTime), eE = timeToMinutes(ex.endTime);
      if (visitStart < eE && visitEnd > eS)
        return { accepts: false, reason: `Conflicts with ${ex.clientName} (${ex.startTime}–${ex.endTime})` };
    }

    const empLoc = employeeLocationMap.get(empName);
    if (empLoc?.homeLat && empLoc?.homeLng && visit.lat && visit.lng) {
      const mode = ((empLoc.transportMode || 'car') as 'car' | 'walking' | 'public');
      const cap = mode === 'car' ? MAX_TRAVEL_TIME_MINUTES : MAX_TRAVEL_TIME_MINUTES_WALKER;
      const sorted = [...dayVisits].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
      const prev = sorted.filter(v => timeToMinutes(v.endTime) <= visitStart).at(-1);
      const next = sorted.find(v => timeToMinutes(v.startTime) >= visitEnd);
      const fromLoc = (prev?.lat && prev?.lng)
        ? { lat: Number(prev.lat), lng: Number(prev.lng) }
        : { lat: Number(empLoc.homeLat), lng: Number(empLoc.homeLng) };
      const toThis = getTravelMinutes(fromLoc, { lat: Number(visit.lat), lng: Number(visit.lng) }, mode);
      if (toThis > cap) return { accepts: false, reason: `Too far (${Math.round(toThis)} min travel)` };
      if (prev && timeToMinutes(prev.endTime) + toThis > visitStart + 5)
        return { accepts: false, reason: `Not enough time after ${prev.clientName}` };
      if (next?.lat && next?.lng) {
        const toNext = getTravelMinutes({ lat: Number(visit.lat), lng: Number(visit.lng) }, { lat: Number(next.lat), lng: Number(next.lng) }, mode);
        if (toNext > cap) return { accepts: false, reason: `Too far to ${next.clientName} (${Math.round(toNext)} min)` };
        if (visitEnd + toNext > timeToMinutes(next.startTime) + 5)
          return { accepts: false, reason: `Not enough gap before ${next.clientName}` };
      }
    }
    return { accepts: true, reason: 'Available' };
  }

  function handleSelectUnallocated(visit: ClientVisit & { unallocatedReason: string }) {
    if (selectedUnallocatedId === visit.id) {
      setSelectedUnallocatedId(null);
      setAcceptanceMap(null);
      return;
    }
    setSelectedUnallocatedId(visit.id);
    setSelectedEmployee(null); // make sure we're in Day View
    setGanttViewDate(visit.date); // switch to the visit's day
    const map = new Map<string, { accepts: boolean; reason: string }>();
    filteredEmployees.forEach(n => map.set(n, computeEmpAcceptance(visit, n, visit.date)));
    setAcceptanceMap(map);
  }

  // ── DnD handlers ───────────────────────────────────────────────────────────

  function handleDragStart(event: DragStartEvent) {
    const item = (event.active.data.current as DragItem) || null;
    setActiveDragItem(item);
    if (!item) return;
    const map = new Map<string, { accepts: boolean; reason: string }>();
    if (item.type === 'unallocatedVisit') {
      filteredEmployees.forEach(n => map.set(n, computeEmpAcceptance(item.visit, n, item.visit.date)));
    } else if (item.type === 'assignedVisit') {
      filteredEmployees.forEach(n => map.set(n, computeEmpAcceptance(item.visit, n, item.visitDate)));
    }
    setDragValidationMap(map.size ? map : null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragItem(null);
    setDragValidationMap(null);
    const { active, over } = event;
    if (!over || !weeklySchedule) return;
    const drag = active.data.current as DragItem;
    const drop = over.data.current as DropTarget;

    if (drag.type === 'assignedVisit' && drop.type === 'empRow') {
      const { empName: fromEmp, visitDate, visitIndex, visit } = drag;
      const toEmp = drop.empName;
      if (fromEmp === toEmp) return;
      const acceptance = computeEmpAcceptance(visit, toEmp, visitDate);
      if (!acceptance.accepts) {
        toast({ title: "Can't reassign", description: acceptance.reason, variant: "destructive" });
        return;
      }
      const newA = JSON.parse(JSON.stringify(weeklySchedule.assignments)) as typeof weeklySchedule.assignments;
      newA[visitDate][fromEmp].splice(visitIndex, 1);
      newA[visitDate][fromEmp] = recalcTravelForDay(fromEmp, newA[visitDate][fromEmp]);
      if (!newA[visitDate]) newA[visitDate] = {};
      if (!newA[visitDate][toEmp]) newA[visitDate][toEmp] = [];
      newA[visitDate][toEmp] = recalcTravelForDay(toEmp,
        [...newA[visitDate][toEmp], visit].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))
      );
      const newSched = { ...weeklySchedule, assignments: newA, metrics: recomputeMetrics(newA, weeklySchedule.unallocated) };
      setWeeklySchedule(newSched);
      saveScheduleMutation.mutate(newSched);
      toast({ title: "Visit reassigned", description: `${visit.clientName} → ${toEmp}` });
    }

    if (drag.type === 'assignedVisit' && drop.type === 'unallocatedPanel') {
      const { empName, visitDate, visitIndex, visit } = drag;
      const newA = JSON.parse(JSON.stringify(weeklySchedule.assignments)) as typeof weeklySchedule.assignments;
      newA[visitDate][empName].splice(visitIndex, 1);
      newA[visitDate][empName] = recalcTravelForDay(empName, newA[visitDate][empName]);
      const unallocated: ClientVisit & { unallocatedReason: string } = {
        id: visit.id, clientName: visit.clientName, startTime: visit.startTime, endTime: visit.endTime,
        durationMinutes: visit.durationMinutes, date: visitDate, lat: visit.lat, lng: visit.lng,
        serviceType: visit.serviceType, unallocatedReason: 'Manually unallocated',
      };
      const newUnalloc = [...weeklySchedule.unallocated, unallocated];
      const newSched = { ...weeklySchedule, assignments: newA, unallocated: newUnalloc, metrics: recomputeMetrics(newA, newUnalloc) };
      setWeeklySchedule(newSched);
      saveScheduleMutation.mutate(newSched);
      toast({ title: "Visit unallocated", description: `${visit.clientName} moved to unallocated` });
    }

    if (drag.type === 'unallocatedVisit' && drop.type === 'empRow') {
      const { visit } = drag;
      const { empName } = drop;
      const acceptance = computeEmpAcceptance(visit, empName, visit.date);
      if (!acceptance.accepts) {
        toast({ title: "Can't assign", description: acceptance.reason, variant: "destructive" });
        return;
      }
      const seedVisit: AssignedVisit = {
        id: visit.id, clientName: visit.clientName, startTime: visit.startTime, endTime: visit.endTime,
        durationMinutes: visit.durationMinutes, lat: visit.lat, lng: visit.lng,
        travelTimeBefore: 0, score: 0, serviceType: visit.serviceType,
      };
      const newA = JSON.parse(JSON.stringify(weeklySchedule.assignments)) as typeof weeklySchedule.assignments;
      if (!newA[visit.date]) newA[visit.date] = {};
      if (!newA[visit.date][empName]) newA[visit.date][empName] = [];
      newA[visit.date][empName] = recalcTravelForDay(empName,
        [...newA[visit.date][empName], seedVisit].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))
      );
      const newUnalloc = weeklySchedule.unallocated.filter(u => u.id !== visit.id);
      const newSched = { ...weeklySchedule, assignments: newA, unallocated: newUnalloc, metrics: recomputeMetrics(newA, newUnalloc) };
      setWeeklySchedule(newSched);
      saveScheduleMutation.mutate(newSched);
      setSelectedUnallocatedId(null);
      setAcceptanceMap(null);
      toast({ title: "Visit assigned", description: `${visit.clientName} → ${empName}` });
    }
  }

  /** Assign an unallocated visit to a caregiver via click (when row is highlighted green) */
  function handleClickAssign(empName: string) {
    if (!selectedUnallocatedId || !weeklySchedule) return;
    const visit = weeklySchedule.unallocated.find(u => u.id === selectedUnallocatedId);
    if (!visit) return;
    const acceptance = computeEmpAcceptance(visit, empName, visit.date);
    if (!acceptance.accepts) {
      toast({ title: "Can't assign", description: acceptance.reason, variant: "destructive" });
      return;
    }
    const seedVisit: AssignedVisit = {
      id: visit.id, clientName: visit.clientName, startTime: visit.startTime, endTime: visit.endTime,
      durationMinutes: visit.durationMinutes, lat: visit.lat, lng: visit.lng,
      travelTimeBefore: 0, score: 0, serviceType: visit.serviceType,
    };
    const newA = JSON.parse(JSON.stringify(weeklySchedule.assignments)) as typeof weeklySchedule.assignments;
    if (!newA[visit.date]) newA[visit.date] = {};
    if (!newA[visit.date][empName]) newA[visit.date][empName] = [];
    newA[visit.date][empName] = recalcTravelForDay(empName,
      [...newA[visit.date][empName], seedVisit].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))
    );
    const newUnalloc = weeklySchedule.unallocated.filter(u => u.id !== visit.id);
    const newSched = { ...weeklySchedule, assignments: newA, unallocated: newUnalloc, metrics: recomputeMetrics(newA, newUnalloc) };
    setWeeklySchedule(newSched);
    saveScheduleMutation.mutate(newSched);
    setSelectedUnallocatedId(null);
    setAcceptanceMap(null);
    toast({ title: "Visit assigned", description: `${visit.clientName} → ${empName}` });
  }

  const isPending = generateMutation.isPending || saveScheduleMutation.isPending;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div ref={ganttWrapperRef} className="flex flex-col gap-4">

        {/* ── Header bar ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">Schedule</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {weekStart} → {weekEnd}
              {lastGeneratedAt && (
                <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                  · Last generated {lastGeneratedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search caregivers…"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="pl-9 w-44 h-9 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 rounded-lg text-sm placeholder:text-gray-400"
              />
            </div>
            <Button
              onClick={() => generateMutation.mutate()}
              disabled={isPending || allWeekVisits.length === 0 || !canGenerate}
              title={!canGenerate ? "Only Schedulers and Admins can generate schedules" : ""}
              className="bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-700 text-white h-9 rounded-lg font-semibold shadow-sm"
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

        {/* ── Metrics strip ───────────────────────────────────────────────── */}
        {weeklySchedule && (
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Assigned', value: weeklySchedule.metrics.totalVisitsAssigned, accent: 'bg-emerald-500', num: 'text-emerald-600 dark:text-emerald-400', sub: 'text-emerald-500/70' },
              { label: 'Unallocated', value: weeklySchedule.metrics.totalVisitsUnallocated, accent: 'bg-rose-500', num: 'text-rose-600 dark:text-rose-400', sub: 'text-rose-500/70' },
              { label: 'Avg Travel', value: `${weeklySchedule.metrics.averageTravelTimePerVisit}m`, accent: 'bg-sky-500', num: 'text-sky-600 dark:text-sky-400', sub: 'text-sky-500/70' },
              { label: 'Staff Used', value: weeklySchedule.metrics.employeesUtilized, accent: 'bg-violet-500', num: 'text-violet-600 dark:text-violet-400', sub: 'text-violet-500/70' },
            ].map(m => (
              <div key={m.label} className="relative bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 px-4 py-3 overflow-hidden shadow-sm">
                <div className={`absolute left-0 top-0 bottom-0 w-1 ${m.accent} rounded-l-xl`} />
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">{m.label}</p>
                <p className={`text-2xl font-bold tabular-nums ${m.num}`}>{m.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Gantt / Schedule block ───────────────────────────────────────── */}
        <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden bg-white dark:bg-gray-900 shadow-sm">

          {selectedEmployee ? (
            /* ══════════════════════════════════════════════════════════════
               WEEK VIEW — full run flow layout for one caregiver
               ══════════════════════════════════════════════════════════════ */
            <>
              {/* Week View header */}
              <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex-wrap">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => prevEmployee && setSelectedEmployee(prevEmployee)}
                    disabled={!prevEmployee}
                    className="text-xs px-2.5 py-1 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
                  >Prev</button>
                  <button
                    onClick={() => setSelectedEmployee(null)}
                    className="text-xs px-2.5 py-1 rounded border border-blue-400 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors font-medium"
                  >All</button>
                  <button
                    onClick={() => nextEmployee && setSelectedEmployee(nextEmployee)}
                    disabled={!nextEmployee}
                    className="text-xs px-2.5 py-1 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
                  >Next</button>
                </div>

                {/* Avatar + name */}
                {(() => {
                  const gender = employeeGenderMap.get(selectedEmployee) || '';
                  const loc = employeeLocationMap.get(selectedEmployee);
                  const isFemale = gender.toLowerCase() === 'female';
                  const isMale = gender.toLowerCase() === 'male';
                  return (
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white
                        ${isFemale ? 'bg-pink-500' : isMale ? 'bg-blue-500' : 'bg-gray-400'}`}>
                        {getInitials(selectedEmployee)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <TransportIcon mode={loc?.transportMode} />
                          <span className={`font-semibold text-sm truncate ${getGenderColorClass(gender)}`}>{selectedEmployee}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {fmtFullDate(weekDates[0])} – {fmtShortDate(weekDates[6] || weekDates[0])}
                        </span>
                      </div>
                    </div>
                  );
                })()}

                <div className="text-xs text-muted-foreground whitespace-nowrap">
                  CAREGiver Hours: <strong className="text-gray-700 dark:text-gray-300">{fmtHhMm((employeeWeeklyHoursMap.get(selectedEmployee) || 0) * 60)}</strong>
                  &nbsp;&nbsp;Scheduled: <strong className="text-green-700 dark:text-green-400">{fmtHhMm(getEmployeeScheduledMinutes(selectedEmployee))}</strong>
                </div>
              </div>

              {/* Week View full run cards */}
              <div className="overflow-y-auto" style={{ maxHeight: '70vh' }}>
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {weekDates.map((date, dayIdx) => {
                    const visits: AssignedVisit[] = weeklySchedule?.assignments[date]?.[selectedEmployee] || [];
                    const empForDate = data?.employeesByDate[date]?.find(e => e.employeeName === selectedEmployee);
                    const hasAvail = !!(empForDate?.timeWindows?.trim());
                    const isToday = date === todayStr;
                    const visitCount = visits.length;

                    return (
                      <div key={date} className={`p-4 ${!hasAvail ? 'opacity-60' : ''}`}>
                        {/* Day header */}
                        <div className="flex items-center gap-3 mb-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`font-semibold text-sm ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-white'}`}>
                                {dayNames[dayIdx]} {date.split('-').slice(1).join('/')}
                                {isToday && <span className="ml-1 text-[10px] bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 rounded px-1">Today</span>}
                              </span>
                              {visitCount > 0 && (
                                <Badge className="bg-blue-600 text-white text-[10px] px-1.5 py-0">{visitCount} visit{visitCount > 1 ? 's' : ''}</Badge>
                              )}
                            </div>
                            {empForDate?.timeWindows && (
                              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {empForDate.timeWindows}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Flow */}
                        {visitCount === 0 ? (
                          <div className="text-xs text-muted-foreground italic pl-1">
                            {hasAvail ? 'No visits scheduled' : 'Not working this day'}
                          </div>
                        ) : (
                          <div className="flex items-center gap-0 overflow-x-auto pb-2">
                            {/* Home start */}
                            <div className="flex-shrink-0 flex flex-col items-center justify-center gap-0.5 px-2">
                              <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/50 border-2 border-blue-300 dark:border-blue-600 flex items-center justify-center">
                                <Home className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                              </div>
                              <div className="text-[9px] text-blue-600 dark:text-blue-400 font-medium">Start</div>
                            </div>

                            {/* First travel arrow */}
                            {visits[0].travelTimeBefore > 0 && (
                              <div className="flex-shrink-0 flex flex-col items-center justify-center px-1 min-w-[36px]">
                                <span className="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap font-medium">{visits[0].travelTimeBefore}m</span>
                                <ArrowRight className="h-3.5 w-3.5 text-gray-400" />
                              </div>
                            )}
                            {visits[0].travelTimeBefore === 0 && (
                              <div className="flex-shrink-0 px-1">
                                <ArrowRight className="h-3.5 w-3.5 text-gray-300" />
                              </div>
                            )}

                            {/* Visit blocks with travel + break connectors */}
                            {visits.map((visit, i) => {
                              const nextVisit = i < visits.length - 1 ? visits[i + 1] : null;
                              const gapMins = nextVisit
                                ? timeToMinutes(nextVisit.startTime) - timeToMinutes(visit.endTime)
                                : 0;
                              const breakMins = nextVisit ? Math.max(0, gapMins - (nextVisit.travelTimeBefore || 0)) : 0;
                              const isTraining = isTrainingBlock(visit.serviceType, visit.clientName);
                              return (
                                <div key={i} className="flex items-center flex-shrink-0">
                                  {/* Visit block */}
                                  <div className={`flex-shrink-0 rounded-xl border shadow-sm px-3 py-2 min-w-[110px] max-w-[160px]
                                    ${isTraining
                                      ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700'
                                      : 'bg-green-50 dark:bg-green-950/30 border-green-300 dark:border-green-700'
                                    }`}>
                                    <div className={`flex items-center gap-1 font-semibold text-xs truncate
                                      ${isTraining ? 'text-amber-800 dark:text-amber-300' : 'text-green-800 dark:text-green-300'}`}>
                                      <Clock className="h-3 w-3 flex-shrink-0" />
                                      <span className="truncate">{visit.clientName}</span>
                                    </div>
                                    <div className={`text-[10px] mt-0.5 ${isTraining ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
                                      {visit.startTime}–{visit.endTime}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground">{visit.durationMinutes}min</div>
                                  </div>

                                  {/* After-visit connector */}
                                  {nextVisit && (
                                    <>
                                      {breakMins >= 15 ? (
                                        /* Big gap: travel → break → travel */
                                        <>
                                          <div className="flex-shrink-0 flex flex-col items-center justify-center px-1 min-w-[32px]">
                                            <span className="text-[10px] text-gray-500 whitespace-nowrap">{nextVisit.travelTimeBefore}m</span>
                                            <ArrowRight className="h-3 w-3 text-gray-400" />
                                          </div>
                                          <div className="flex-shrink-0 rounded-xl border border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/30 px-3 py-2 min-w-[80px] shadow-sm">
                                            <div className="flex flex-col items-center gap-0.5">
                                              <Coffee className="h-4 w-4 text-orange-500 dark:text-orange-400" />
                                              <div className="text-[10px] font-semibold text-orange-700 dark:text-orange-300">Break</div>
                                              <div className="text-[10px] text-orange-600 dark:text-orange-400">{breakMins}min</div>
                                            </div>
                                          </div>
                                          <div className="flex-shrink-0 flex flex-col items-center justify-center px-1 min-w-[32px]">
                                            <ArrowRight className="h-3 w-3 text-gray-400" />
                                          </div>
                                        </>
                                      ) : (
                                        /* Small gap: just travel arrow */
                                        <div className="flex-shrink-0 flex flex-col items-center justify-center px-1 min-w-[36px]">
                                          <span className="text-[10px] text-gray-500 whitespace-nowrap font-medium">{nextVisit.travelTimeBefore}m</span>
                                          <ArrowRight className="h-3.5 w-3.5 text-gray-400" />
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>
                              );
                            })}

                            {/* Home end */}
                            <div className="flex-shrink-0 flex flex-col items-center justify-center gap-0.5 px-2">
                              <div className="w-9 h-9 rounded-full bg-green-100 dark:bg-green-900/50 border-2 border-green-300 dark:border-green-600 flex items-center justify-center">
                                <Home className="h-4 w-4 text-green-600 dark:text-green-400" />
                              </div>
                              <div className="text-[9px] text-green-600 dark:text-green-400 font-medium">End</div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            /* ══════════════════════════════════════════════════════════════
               DAY VIEW — all caregivers, one selected date
               ══════════════════════════════════════════════════════════════ */
            <>
              {/* Day tab selector */}
              <div className="flex items-center gap-1 px-3 py-2.5 border-b border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-800/60 overflow-x-auto">
                {weekDates.map(date => (
                  <button
                    key={date}
                    onClick={() => { setGanttViewDate(date); setSelectedUnallocatedId(null); setAcceptanceMap(null); }}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-150
                      ${ganttViewDate === date
                        ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 shadow'
                        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200'
                      }`}
                  >
                    {fmtDayTab(date)}
                    {date === todayStr && <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block align-middle" />}
                  </button>
                ))}
                <div className="ml-auto pl-4 text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {fmtFullDate(ganttViewDate || weekDates[0])}
                </div>
              </div>

              {/* Hint bar when unallocated visit is selected */}
              {selectedUnallocatedId && (
                <div className="flex items-center justify-between px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-700/60 text-xs text-amber-800 dark:text-amber-300">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block flex-shrink-0" />
                    <strong>Availability mode</strong> — green rows can accept this visit. Click a row or drag the card to assign.
                  </span>
                  <button
                    onClick={() => { setSelectedUnallocatedId(null); setAcceptanceMap(null); }}
                    className="ml-3 p-1 rounded-full hover:bg-amber-200 dark:hover:bg-amber-800 transition-colors"
                  ><X className="h-3 w-3" /></button>
                </div>
              )}

              {/* Day View scrollable grid */}
              <div ref={scrollRef} className="overflow-x-auto" style={{ maxHeight: '72vh' }}>
                <div style={{ minWidth: LEFT_PANEL_W + TIMELINE_WIDTH }}>

                  {/* Sticky hour labels */}
                  <div className="flex sticky top-0 z-20 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                    <div
                      className="flex-shrink-0 sticky left-0 z-30 bg-gray-50/80 dark:bg-gray-800/80 backdrop-blur-sm border-r border-gray-200 dark:border-gray-800 flex items-end px-3 pb-1.5 h-9"
                      style={{ width: LEFT_PANEL_W }}
                    >
                      <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Caregivers</span>
                    </div>
                    <div className="relative h-9 bg-gray-50/80 dark:bg-gray-800/80 backdrop-blur-sm" style={{ width: TIMELINE_WIDTH }}>
                      {Array.from({ length: 24 }, (_, h) => (
                        <div key={h} className="absolute top-0 bottom-0 flex flex-col" style={{ left: minsToPx(h * 60) }}>
                          <span className="text-[10px] text-gray-400 dark:text-gray-500 pl-1.5 leading-none mt-2 font-medium">{h.toString().padStart(2, '0')}:00</span>
                          <div className="flex-1 border-l border-gray-200 dark:border-gray-700/60 mt-px" />
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
                      const loc = employeeLocationMap.get(empName);
                      const initials = getInitials(empName);
                      const isFemale = gender.toLowerCase() === 'female';
                      const isMale = gender.toLowerCase() === 'male';
                      const isToday = ganttViewDate === todayStr;
                      const holidayDays = employeeHolidaysMap.get(empName) || 0;
                      const dayVisitHours = getEmployeeDayVisitHours(empName, ganttViewDate);

                      // Availability bar
                      const empDayData = data?.employeesByDate[ganttViewDate]?.find(e => e.employeeName === empName);
                      const availWindows = silentParseTimeWindows(empDayData?.timeWindows || '');

                      // Acceptance highlight from unallocated selection
                      const acceptance = selectedUnallocatedId ? acceptanceMap?.get(empName) : null;
                      const acceptanceClass = acceptance?.accepts === true
                        ? 'ring-2 ring-inset ring-green-500 bg-green-50/20 dark:bg-green-950/20'
                        : acceptance?.accepts === false
                          ? 'ring-1 ring-inset ring-red-300 bg-red-50/10 dark:bg-red-950/10'
                          : '';
                      const canClickAssign = acceptance?.accepts === true;

                      return (
                        <div
                          key={empName}
                          className="flex border-t border-gray-100 dark:border-gray-800/60 hover:bg-gray-50/40 dark:hover:bg-gray-800/20 transition-colors"
                        >
                          {/* Left panel */}
                          <div
                            className={`sticky left-0 z-10 flex items-center gap-2 px-2.5 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex-shrink-0 transition-colors
                              ${canClickAssign ? 'cursor-pointer bg-emerald-50/60 dark:bg-emerald-950/20 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 ring-2 ring-inset ring-emerald-500' : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60'}`}
                            style={{ width: LEFT_PANEL_W, minWidth: LEFT_PANEL_W, height: ROW_HEIGHT }}
                            onClick={() => {
                              if (canClickAssign) { handleClickAssign(empName); }
                              else if (!selectedUnallocatedId) { setSelectedEmployee(empName); }
                            }}
                            data-testid={`select-employee-${empName}`}
                            title={acceptance?.reason}
                          >
                            {/* Avatar */}
                            <div
                              className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white select-none shadow-sm
                                ${isFemale ? 'bg-pink-500' : isMale ? 'bg-blue-500' : 'bg-gray-400'}`}
                            >
                              {initials}
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              {/* Name row with transport icon */}
                              <div className="flex items-center gap-1">
                                <TransportIcon mode={loc?.transportMode} />
                                <span
                                  className={`text-[11px] font-semibold truncate leading-tight ${getGenderColorClass(gender)}`}
                                  title={empName}
                                >{empName}</span>
                                {!canClickAssign && !selectedUnallocatedId && (
                                  <ChevronRight className="h-3 w-3 text-gray-300 dark:text-gray-600 flex-shrink-0 ml-auto" />
                                )}
                                {canClickAssign && (
                                  <span className="ml-auto text-[9px] font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap bg-emerald-50 dark:bg-emerald-950/40 px-1 py-0.5 rounded">✓ Assign</span>
                                )}
                              </div>
                              {/* Hours */}
                              <div className="text-[10px] text-gray-400 dark:text-gray-500 leading-tight mt-0.5">
                                {fmtHh(ghMinutes)} / week
                              </div>
                              {/* Badges */}
                              <div className="flex items-center gap-1 mt-1 flex-wrap">
                                {holidayDays > 0 && (
                                  <span className="text-[9px] px-1.5 py-0 rounded-full border border-amber-300 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 font-medium leading-4">
                                    {holidayDays}d holiday
                                  </span>
                                )}
                                {dayVisitHours > 0 && (
                                  <span className="text-[9px] px-1.5 py-0 rounded-full bg-emerald-600 text-white font-medium leading-4">
                                    {dayVisitHours.toFixed(1)}h
                                  </span>
                                )}
                                {acceptance?.accepts === false && (
                                  <span className="text-[9px] px-1 py-0 rounded-full border border-red-200 text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/30 leading-4 truncate max-w-[130px]" title={acceptance.reason}>
                                    {acceptance.reason}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Timeline row */}
                          <DroppableTimelineRow
                            dropId={`emp-row-${empName}`}
                            dropData={{ type: 'empRow', empName }}
                            style={{ width: TIMELINE_WIDTH, height: ROW_HEIGHT }}
                            className={`relative flex-shrink-0 ${acceptanceClass}`}
                            dragAcceptance={activeDragItem ? (dragValidationMap?.get(empName) ?? null) : null}
                          >
                            {/* Hour grid lines */}
                            {Array.from({ length: 24 }, (_, h) => (
                              <div key={h} className="absolute top-0 bottom-0 border-l border-gray-100 dark:border-gray-800" style={{ left: minsToPx(h * 60) }} />
                            ))}

                            {/* Availability window background */}
                            {availWindows.map((w, wi) => (
                              <div
                                key={wi}
                                className="absolute top-0 bottom-0 bg-blue-50/40 dark:bg-blue-900/10 pointer-events-none"
                                style={{ left: minsToPx(w.start), width: minsToPx(w.end - w.start) }}
                              />
                            ))}

                            {/* Travel connectors between visits */}
                            {visits.map((visit, i) => {
                              if (i === visits.length - 1) return null;
                              const next = visits[i + 1];
                              const gapStartPx = minsToPx(timeToMinutes(visit.endTime));
                              const gapEndPx = minsToPx(timeToMinutes(next.startTime));
                              const gapW = gapEndPx - gapStartPx;
                              if (gapW < 32 || !next.travelTimeBefore) return null;
                              return (
                                <div
                                  key={`conn-${i}`}
                                  className="absolute flex items-center justify-center pointer-events-none z-10"
                                  style={{ left: gapStartPx + 2, width: gapW - 4, top: '50%', transform: 'translateY(-50%)', height: 18 }}
                                >
                                  <div className="flex items-center gap-0.5 text-[9px] text-gray-500 dark:text-gray-400 bg-white/90 dark:bg-gray-900/90 px-1 rounded border border-gray-200 dark:border-gray-700 shadow-sm">
                                    <span>{next.travelTimeBefore}m</span>
                                    <ArrowRight className="h-2.5 w-2.5" />
                                  </div>
                                </div>
                              );
                            })}

                            {/* Visit blocks (draggable) */}
                            {visits.map((visit, i) => {
                              const startMins = timeToMinutes(visit.startTime);
                              const dur = visit.durationMinutes || Math.max(1, timeToMinutes(visit.endTime) - startMins);
                              const leftPx = minsToPx(startMins);
                              const widthPx = Math.max(minsToPx(dur), 22);
                              const training = isTrainingBlock(visit.serviceType, visit.clientName);
                              return (
                                <DraggableVisitItem
                                  key={`${ganttViewDate}-${empName}-${i}`}
                                  dragId={`${ganttViewDate}-${empName}-${i}`}
                                  dragData={{ type: 'assignedVisit', empName, visitDate: ganttViewDate, visitIndex: i, visit }}
                                  disabled={isPending}
                                  style={{ position: 'absolute', left: leftPx, width: widthPx, top: 8, bottom: 8 }}
                                  className={`rounded-md overflow-hidden text-white select-none z-10
                                    ${training ? 'bg-amber-500 hover:bg-amber-400' : 'bg-emerald-600 hover:bg-emerald-500'}
                                    transition-colors shadow-sm`}
                                >
                                  <div className="px-2 py-1 h-full flex flex-col justify-center overflow-hidden">
                                    <div className="text-[10px] font-semibold truncate leading-tight">{visit.clientName}</div>
                                    {widthPx > 80 && (
                                      <div className="text-[9px] opacity-80 truncate leading-tight">{visit.startTime}–{visit.endTime}</div>
                                    )}
                                    {widthPx > 150 && visit.serviceType && (
                                      <div className="text-[9px] opacity-65 truncate leading-tight">{visit.serviceType}</div>
                                    )}
                                  </div>
                                </DraggableVisitItem>
                              );
                            })}

                            {/* Now indicator */}
                            {isToday && (
                              <div className="absolute top-0 bottom-0 w-0.5 bg-green-500 z-20 pointer-events-none" style={{ left: minsToPx(nowMinutes) }} />
                            )}
                          </DroppableTimelineRow>
                        </div>
                      );
                    })
                  )}

                  {/* Absent employees */}
                  {absentGhEmployees.filter(e => e.name.toLowerCase().includes(searchTerm.toLowerCase())).length > 0 && (
                    <>
                      <div className="border-t border-dashed border-gray-300 dark:border-gray-600 px-3 py-1.5 bg-gray-50 dark:bg-gray-800">
                        <span className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider">Absent this week</span>
                      </div>
                      {absentGhEmployees
                        .filter(e => e.name.toLowerCase().includes(searchTerm.toLowerCase()))
                        .map(emp => {
                          const gender = employeeGenderMap.get(emp.name) || '';
                          const loc = employeeLocationMap.get(emp.name);
                          const isHoliday = emp.status.toLowerCase().includes('holiday') || emp.status.toLowerCase().includes('annual');
                          const isSick = emp.status.toLowerCase().includes('sick');
                          return (
                            <div key={emp.name} className="flex border-t border-gray-100 dark:border-gray-800 opacity-50">
                              <div
                                className="sticky left-0 z-10 flex items-center gap-2 px-2.5 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex-shrink-0"
                                style={{ width: LEFT_PANEL_W, minWidth: LEFT_PANEL_W, height: ROW_HEIGHT }}
                              >
                                <div className="w-9 h-9 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                                  {getInitials(emp.name)}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1">
                                    <TransportIcon mode={loc?.transportMode} />
                                    <span className={`text-xs font-semibold truncate leading-tight ${getGenderColorClass(gender)}`}>{emp.name}</span>
                                  </div>
                                  <div className="text-[10px] text-muted-foreground">{fmtHh(emp.gh * 60)} / week</div>
                                  <Badge
                                    variant="outline"
                                    className={`text-[9px] mt-0.5 px-1 py-0 ${isHoliday ? 'text-amber-600 border-amber-400' : isSick ? 'text-red-600 border-red-400' : 'text-orange-600 border-orange-400'}`}
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

        {/* ── Unallocated Visits ───────────────────────────────────────────── */}
        {weeklySchedule && weeklySchedule.unallocated.length > 0 && (
          <DroppableUnallocatedPanel className="rounded-xl overflow-hidden bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-rose-500" />
                  <span className="font-semibold text-gray-900 dark:text-white text-sm">
                    Unallocated Visits
                  </span>
                </div>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-400">
                  {weeklySchedule.unallocated.length} · {((weeklySchedule.unallocated.length / (weeklySchedule.metrics.totalVisitsAssigned + weeklySchedule.unallocated.length)) * 100).toFixed(1)}%
                </span>
              </div>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 hidden sm:block">
                Click a visit to highlight available caregivers · drag to assign
              </p>
            </div>

            <div className="p-4 max-h-[400px] overflow-y-auto">
              <div className="space-y-5">
                {weekDates.map((date, dayIndex) => {
                  const dayUnalloc = weeklySchedule.unallocated.filter(v => v.date === date);
                  if (!dayUnalloc.length) return null;
                  return (
                    <div key={date}>
                      {/* Day label */}
                      <div className="flex items-center gap-2 mb-2">
                        <Calendar className="h-3.5 w-3.5 text-gray-400" />
                        <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                          {dayNames[dayIndex]} · {date.split('-').slice(1).join('/')}
                        </span>
                        <span className="text-[10px] font-bold text-rose-500 bg-rose-50 dark:bg-rose-950/40 px-1.5 py-0.5 rounded-full">
                          {dayUnalloc.length}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                        {dayUnalloc.map((visit, idx) => {
                          const isSelected = selectedUnallocatedId === visit.id;
                          return (
                            <DraggableUnallocatedCard
                              key={`${visit.id}-${idx}`}
                              dragId={`unalloc-${visit.id}-${idx}`}
                              dragData={{ type: 'unallocatedVisit', visit }}
                              disabled={isPending}
                              className={`rounded-lg border transition-all select-none
                                ${isSelected
                                  ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/30 ring-2 ring-amber-400 shadow-md'
                                  : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:border-rose-300 dark:hover:border-rose-700 hover:shadow-sm'
                                }`}
                            >
                              <div onClick={() => handleSelectUnallocated(visit)} className="cursor-pointer p-2.5">
                                {/* Left accent + name */}
                                <div className={`-mx-2.5 -mt-2.5 mb-2 px-2.5 pt-2 pb-1.5 rounded-t-lg ${isSelected ? 'bg-amber-100/60 dark:bg-amber-900/20' : 'bg-white dark:bg-gray-900'}`}>
                                  <p className="font-semibold text-[11px] text-gray-900 dark:text-gray-100 truncate leading-tight">{visit.clientName}</p>
                                </div>
                                <div className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                                  <Clock className="h-3 w-3 flex-shrink-0" />
                                  <span className="font-medium">{visit.startTime}–{visit.endTime}</span>
                                </div>
                                <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                                  {visit.durationMinutes}m
                                </div>
                                <div className={`text-[9px] mt-1.5 px-1.5 py-0.5 rounded-full inline-block font-medium
                                  ${isSelected
                                    ? 'bg-amber-200 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300'
                                    : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800'
                                  }`}>
                                  {visit.unallocatedReason || "Not optimal"}
                                </div>
                                {isSelected && (
                                  <div className="text-[9px] text-amber-700 dark:text-amber-400 mt-1.5 font-semibold flex items-center gap-1">
                                    <span>↑</span> Showing availability
                                  </div>
                                )}
                              </div>
                            </DraggableUnallocatedCard>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </DroppableUnallocatedPanel>
        )}
      </div>

      {/* Drag overlay */}
      <DragOverlay dropAnimation={null}>
        {activeDragItem ? <DragOverlayContent item={activeDragItem} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
