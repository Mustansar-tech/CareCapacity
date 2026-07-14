import { useState, useEffect, useCallback, useMemo } from "react";
import { clientLogger } from '@/lib/logger';
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Calendar, Zap, Loader2, Car, User, MapPin, Clock, Search, Plus, Home, ArrowRight, Info, Lock, ChevronLeft, ChevronRight, X, Star } from "lucide-react";
import { getGenderColorClass } from "@/utils/gender-colors";
import { minutesToTime, timeToMinutes, getTravelMinutes, seedTravelCache, clearTravelCache, haversineDistance, calculateTravelTime, parseTimeWindows } from "@/utils/scheduling-utils";
import type { ProcessingResult, ClientVisit, EmployeeLocation, ClientLocation, WeeklySchedule, EmployeeDailyDetail } from "@shared/schema";
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

import type { ReactNode } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, closestCenter,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';

// ── Drop zone: wraps one employee row ─────────────────────────────────────
function DroppableEmpRow({ empName, validDrop, ghostBlock, children }: {
  empName: string;
  validDrop: boolean | null;
  ghostBlock?: { xLeft: number; width: number; infoWidth: number } | null;
  children: ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `emp-row-${empName}` });
  const ghostColor = validDrop === false
    ? { bg: 'rgba(239,68,68,.20)', border: '#EF4444' }
    : validDrop === true
      ? { bg: 'rgba(34,197,94,.20)', border: '#22C55E' }
      : { bg: 'rgba(37,99,235,.14)', border: '#2563EB' };
  return (
    <div ref={setNodeRef} style={{ position: 'relative' }}>
      {/* Row-border hover overlay */}
      {isOver && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 12, pointerEvents: 'none',
          border: `2px dashed ${validDrop === false ? '#EF4444' : '#22C55E'}`,
          background: validDrop === false ? 'rgba(239,68,68,.06)' : 'rgba(34,197,94,.06)',
          borderRadius: 3,
        }} />
      )}
      {/* Time-position ghost: shows the visit's time slot on this row while dragging */}
      {ghostBlock && (
        <div style={{
          position: 'absolute',
          top: 10,
          left: ghostBlock.infoWidth + ghostBlock.xLeft,
          width: ghostBlock.width,
          bottom: 10,
          zIndex: 11,
          pointerEvents: 'none',
          borderRadius: 7,
          background: ghostColor.bg,
          border: `1.5px dashed ${ghostColor.border}`,
          transition: 'background .12s, border-color .12s',
        }} />
      )}
      {children}
    </div>
  );
}

// ── Draggable: unallocated visit card in the side panel ───────────────────
function DraggableUnallocCard({ visit, isSelected, priColor, onClick, children }: {
  visit: any; isSelected: boolean; priColor: string; onClick: () => void; children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `unalloc-${visit.id}-${visit.date}`,
    data: { type: 'unallocated', visit },
  });
  return (
    <div
      ref={setNodeRef} onClick={onClick} {...attributes}
      style={{
        background: 'white', border: `1px solid ${isSelected ? '#93C5FD' : '#E5E9F2'}`,
        borderLeft: `4px solid ${priColor}`, borderRadius: 12, padding: 12, marginBottom: 10,
        cursor: isDragging ? 'grabbing' : 'pointer', transition: isDragging ? 'none' : 'all .15s',
        opacity: isDragging ? 0.45 : 1, boxShadow: isSelected ? '0 6px 18px rgba(37,99,235,.12)' : 'none',
        position: 'relative',
      }}
    >
      <div
        {...listeners} onClick={e => e.stopPropagation()}
        title="Drag onto a carer row to assign"
        style={{ position: 'absolute', top: 10, right: 10, width: 18, height: 18, cursor: 'grab', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.35, fontSize: 14, touchAction: 'none', userSelect: 'none' }}
      >⠿</div>
      {children}
    </div>
  );
}

// ── Draggable: visit card already placed on the timeline ──────────────────
function DraggableTimelineVisit({ visit, empName, xLeft, wPx, grad, isSelected, onSelect, onUnallocate }: {
  visit: { id: string; clientName: string; startTime: string; endTime: string; serviceType?: string };
  empName: string; xLeft: number; wPx: number; grad: string;
  isSelected: boolean; onSelect: () => void; onUnallocate: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `assigned-${empName}-${visit.id}`,
    data: { type: 'assigned', visit, fromEmp: empName },
  });
  const cW = Math.max(44, wPx - 3);
  return (
    <div
      ref={setNodeRef} onClick={onSelect} {...attributes}
      style={{
        position: 'absolute', top: 12, left: xLeft, width: cW, height: 50,
        borderRadius: 8, padding: '5px 8px 5px 18px', background: grad, color: '#0F172A',
        cursor: isDragging ? 'grabbing' : 'pointer', overflow: 'hidden',
        boxShadow: isSelected ? '0 0 0 2px white, 0 0 0 4px #2563EB' : '0 2px 8px rgba(15,23,42,.14)',
        zIndex: isSelected ? 5 : 3, fontSize: 11, fontWeight: 600,
        opacity: isDragging ? 0.3 : 1, filter: 'brightness(1.05)',
        transition: isDragging ? 'none' : 'transform .12s, box-shadow .12s',
      }}
      title={`${visit.clientName} · ${visit.startTime}–${visit.endTime}${visit.serviceType ? ' · ' + visit.serviceType : ''} — drag to reassign`}
    >
      {/* Grip handle */}
      <div {...listeners} onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 14, cursor: 'grab', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, fontSize: 9, touchAction: 'none', userSelect: 'none' }}>⠿</div>
      {cW >= 44 && <div style={{ fontSize: cW < 70 ? 10 : 12, fontWeight: 800, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 1, color: '#0F172A' }}>{visit.clientName}</div>}
      {cW >= 54 && <div style={{ fontSize: cW < 80 ? 9 : 10, fontWeight: 600, color: '#1E293B', marginBottom: 1 }}>{visit.startTime}–{visit.endTime}</div>}
      {cW >= 80 && visit.serviceType && <div style={{ fontSize: 9, fontWeight: 500, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.75 }}>{visit.serviceType}</div>}
      {isSelected && (
        <button onClick={e => { e.stopPropagation(); onUnallocate(); }} style={{ position: 'absolute', bottom: 3, right: 4, background: 'rgba(0,0,0,.15)', border: 'none', borderRadius: 4, color: '#0F172A', fontSize: 9, fontWeight: 700, padding: '1px 5px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          ↩ unallocate
        </button>
      )}
    </div>
  );
}

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
  const { selectedBranchId } = useBranch();
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [weeklySchedule, setWeeklySchedule] = useState<WeeklyScheduleData | null>(null);
  const [lastGeneratedAt, setLastGeneratedAt] = useState<Date | null>(null);
  const [travelSources, setTravelSources] = useState<Record<string, number> | null>(null);
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [selectedVisit, setSelectedVisit] = useState<(ClientVisit & { unallocatedReason: string }) | null>(null);
  const [leftFilter, setLeftFilter] = useState<string>('all');
  const [leftSearch, setLeftSearch] = useState('');
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [selectedTimelineVisit, setSelectedTimelineVisit] = useState<{empName: string; visit: AssignedVisit} | null>(null);

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

  // Reload the correct "last generated" stamp whenever branch or week changes
  useEffect(() => {
    if (!selectedBranchId || !weekStart) { setLastGeneratedAt(null); return; }
    try {
      const key = `scheduleLastGenerated_${selectedBranchId}_${weekStart}`;
      const stored = localStorage.getItem(key);
      setLastGeneratedAt(stored ? new Date(stored) : null);
    } catch { setLastGeneratedAt(null); }
  }, [selectedBranchId, weekStart]);

  // Default selected day to today if today is within the viewed week
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    const idx = weekDates.indexOf(today);
    setSelectedDayIndex(idx >= 0 ? idx : 0);
    setViewMode('day');
  }, [weekStart]);

  // Fetch locations
  const { data: locationsData } = useQuery<{ employees: EmployeeLocation[]; clients: ClientLocation[] }>({
    queryKey: ['/api/locations'],
    enabled: !!data,
  });

  // Create a map of employee locations for quick lookup
  const employeeLocationMap = new Map(
    (locationsData?.employees || []).map(emp => [emp.employeeName, emp])
  );

  // Fetch all visits for the week in a single DB query (replaces 7× /api/visits/:date)
  const { data: weekVisitsData, isLoading: isLoadingVisits } = useQuery<ClientVisit[]>({
    queryKey: ['/api/visits/week', weekStart],
    enabled: !!data && !!weekStart,
  });

  const allWeekVisits = weekVisitsData || [];

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
  const employeeMap = new Map<string, EmployeeDailyDetail>();
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
              gender: emp.gender || location?.gender || undefined,
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
      // This seeds the in-memory travel cache with ORS distances so the
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
      const now = new Date();
      setLastGeneratedAt(now);
      try {
        const key = `scheduleLastGenerated_${selectedBranchId}_${weekStart}`;
        localStorage.setItem(key, now.toISOString());
      } catch { /* ignore */ }

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

      const finalResult = correctedResult;

      // Save the schedule to the database
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
        weekStartDate: weekStart,
        weekEndDate: weekEnd,
        scheduleData: schedule.assignments,
        unallocatedVisits: schedule.unallocated,
        metrics: schedule.metrics,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/weekly-schedule', weekStart] });
    },
  });

  // Load schedule for the current week being viewed
  const { data: savedSchedule, isFetching: isFetchingSchedule } = useQuery<WeeklySchedule | null>({
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
        unallocated: (savedSchedule.unallocatedVisits as (ClientVisit & { unallocatedReason: string })[]) || [],
        metrics: (savedSchedule.metrics as { totalVisitsAssigned: number; totalVisitsUnallocated: number; averageTravelTimePerVisit: number; employeesUtilized: number }) || {
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

  // ── Drag-and-drop state (must be before any early returns) ───────────────
  const [activeDragData, setActiveDragData] = useState<{
    type: 'unallocated' | 'assigned';
    visit: any;
    fromEmp?: string;
  } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

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

  // ── Shared run-flow renderer ────────────────────────────────────────────────
  // Used in both the daily view (one row per employee) and the weekly view.
  const renderRunFlow = (empNameParam: string, _dateParam: string, dayVisits: AssignedVisit[]) => {
    if (dayVisits.length === 0) {
      return (
        <div className="text-center py-3 text-sm text-muted-foreground bg-gray-50 dark:bg-gray-800/50 rounded-lg">
          No visits assigned for this day
        </div>
      );
    }

    const ttMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

    return (
      <div className="flex flex-wrap items-center gap-2">
        {/* Home Start */}
        <div className="flex flex-col items-center gap-1">
          <Home className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">Start</span>
        </div>

        {/* First arrow */}
        {(() => {
          const empLoc = employeeLocationMap.get(empNameParam);
          const firstVisit = dayVisits[0];
          let displayMin = firstVisit.travelTimeBefore;
          if (displayMin >= 999 && empLoc?.homeLat && empLoc?.homeLng && firstVisit.lat && firstVisit.lng) {
            const mode: 'car' | 'walking' | 'public' = (empLoc.transportMode?.toLowerCase() || '').includes('car') ? 'car' : 'walking';
            const dist = haversineDistance({ lat: Number(empLoc.homeLat), lng: Number(empLoc.homeLng) }, { lat: firstVisit.lat, lng: firstVisit.lng });
            displayMin = calculateTravelTime(dist, mode);
          }
          return (
            <div className="flex flex-col items-center">
              <span className="text-xs text-gray-500 dark:text-gray-400 mb-1">{displayMin}min</span>
              <ArrowRight className="h-5 w-5 text-gray-400" />
            </div>
          );
        })()}

        {/* Visits with inter-visit arrows */}
        {dayVisits.map((visit, vIndex) => (
          <div key={vIndex} className="flex items-center gap-2">
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2 hover:shadow-md transition-shadow">
              <div className="space-y-1">
                <p className="font-medium text-xs truncate max-w-[120px]" title={visit.clientName}>{visit.clientName}</p>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {visit.startTime} - {visit.endTime}
                </div>
              </div>
            </div>

            {vIndex < dayVisits.length - 1 && (() => {
              const currentVisit = dayVisits[vIndex];
              const nextVisit = dayVisits[vIndex + 1];
              const currentEndMin = ttMin(currentVisit.endTime);
              const nextStartMin = ttMin(nextVisit.startTime);
              const gapMinutes = nextStartMin - currentEndMin;

              if (gapMinutes >= 90) {
                const empLocation = employeeLocationMap.get(empNameParam);
                let travelToHome = 0;
                let travelFromHome = 0;

                const displayTravelMinutes = (
                  from: { lat: number; lng: number },
                  to: { lat: number; lng: number },
                  mode: 'car' | 'walking' | 'public',
                  timeMin: number
                ): number => {
                  const api = getTravelMinutes(from, to, mode, timeMin);
                  if (api >= 999) { const dist = haversineDistance(from, to); return calculateTravelTime(dist, mode, timeMin); }
                  return api;
                };

                if (empLocation?.homeLat && empLocation?.homeLng) {
                  const transportMode = empLocation.transportMode?.toLowerCase() || '';
                  const mode: 'car' | 'walking' | 'public' = transportMode.includes('car') ? 'car' : 'walking';
                  if (currentVisit.travelTimeAfter !== undefined) {
                    travelToHome = currentVisit.travelTimeAfter;
                  } else if (currentVisit.lat && currentVisit.lng) {
                    travelToHome = displayTravelMinutes(
                      { lat: currentVisit.lat, lng: currentVisit.lng },
                      { lat: Number(empLocation.homeLat), lng: Number(empLocation.homeLng) },
                      mode, currentEndMin
                    );
                  }
                  travelFromHome = nextVisit.travelTimeBefore ?? 0;
                }

                const breakTime = Math.max(0, gapMinutes - travelToHome - travelFromHome);
                return (
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col items-center">
                      <span className="text-xs text-gray-500 dark:text-gray-400 mb-1">{travelToHome}min</span>
                      <ArrowRight className="h-5 w-5 text-gray-400" />
                    </div>
                    <div className="flex flex-col items-center px-3 py-2 rounded-lg bg-orange-100 dark:bg-orange-900/30 border-2 border-orange-300 dark:border-orange-700">
                      <Home className="h-6 w-6 text-orange-600 dark:text-orange-400 mb-1" />
                      <span className="text-xs font-semibold text-orange-700 dark:text-orange-300">Break</span>
                      <span className="text-xs text-orange-600 dark:text-orange-400">{breakTime}min</span>
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="text-xs text-gray-500 dark:text-gray-400 mb-1">{travelFromHome}min</span>
                      <ArrowRight className="h-5 w-5 text-gray-400" />
                    </div>
                  </div>
                );
              }

              let interDisplayMin = nextVisit.travelTimeBefore;
              if (interDisplayMin >= 999 && currentVisit.lat && currentVisit.lng && nextVisit.lat && nextVisit.lng) {
                const empLocInter = employeeLocationMap.get(empNameParam);
                const modeInter: 'car' | 'walking' | 'public' = (empLocInter?.transportMode?.toLowerCase() || '').includes('car') ? 'car' : 'walking';
                const distInter = haversineDistance({ lat: currentVisit.lat, lng: currentVisit.lng }, { lat: nextVisit.lat, lng: nextVisit.lng });
                interDisplayMin = calculateTravelTime(distInter, modeInter);
              }
              return (
                <div className="flex flex-col items-center">
                  <span className="text-xs text-gray-500 dark:text-gray-400 mb-1">{interDisplayMin}min</span>
                  <ArrowRight className="h-5 w-5 text-gray-400" />
                </div>
              );
            })()}
          </div>
        ))}

        {/* Last arrow + Home End */}
        {(() => {
          const lastVisit = dayVisits[dayVisits.length - 1];
          const empLocation = employeeLocationMap.get(empNameParam);
          let travelToHome = 0;
          if (empLocation?.homeLat && empLocation?.homeLng && lastVisit.lat && lastVisit.lng) {
            const transportMode = empLocation.transportMode?.toLowerCase() || '';
            const mode: 'car' | 'walking' | 'public' = transportMode.includes('car') ? 'car' : 'walking';
            const lastVisitEndMin = ttMin(lastVisit.endTime);
            if (lastVisit.travelTimeAfter !== undefined) {
              travelToHome = lastVisit.travelTimeAfter;
            } else {
              travelToHome = getTravelMinutes(
                { lat: lastVisit.lat, lng: lastVisit.lng },
                { lat: Number(empLocation.homeLat), lng: Number(empLocation.homeLng) },
                mode, lastVisitEndMin
              );
              if (travelToHome >= 999) {
                const dist = haversineDistance({ lat: lastVisit.lat, lng: lastVisit.lng }, { lat: Number(empLocation.homeLat), lng: Number(empLocation.homeLng) });
                travelToHome = calculateTravelTime(dist, mode, lastVisitEndMin);
              }
            }
          }
          return (
            <>
              <div className="flex flex-col items-center">
                <span className="text-xs text-gray-500 dark:text-gray-400 mb-1">{travelToHome}min</span>
                <ArrowRight className="h-5 w-5 text-gray-400" />
              </div>
              <div className="flex flex-col items-center gap-1">
                <Home className="h-6 w-6 text-green-600 dark:text-green-400" />
                <span className="text-xs text-green-600 dark:text-green-400 font-medium">End</span>
              </div>
            </>
          );
        })()}
      </div>
    );
  };

  // ── Suggested carer scoring + assign / unallocate ────────────────────────
  const scoreSuggestedCarers = (visit: ClientVisit & { unallocatedReason: string }) => {
    const allTodayEmps = data?.employeesByDate[dayDate] || [];
    const results: { empName: string; score: number; travelMin: number; notes: string[] }[] = [];
    allTodayEmps
      .filter(emp => emp.timeWindows && emp.status !== 'Ad-hoc' && (employeeWeeklyHoursMap.get(emp.employeeName) || 0) > 0)
      .forEach(emp => {
        const windows = parseTimeWindows(emp.timeWindows || '');
        const visitStart = timeToMinutes(visit.startTime);
        const visitEnd   = timeToMinutes(visit.endTime);
        const fits = windows.some(w => visitStart >= w.start && visitEnd <= w.end);
        if (!fits) return;
        const empVisits = (dayAssign[emp.employeeName] || []) as AssignedVisit[];
        const hasConflict = empVisits.some(ev => {
          const es = timeToMinutes(ev.startTime);
          const ee = timeToMinutes(ev.endTime);
          return !(visitEnd + 5 <= es || visitStart >= ee + 5);
        });
        if (hasConflict) return;
        let score = 50;
        const notes: string[] = [];
        if (empVisits.length === 0) { score += 15; notes.push('No visits yet today'); }
        else score += Math.max(0, 10 - empVisits.length * 2);
        const loc = employeeLocationMap.get(emp.employeeName);
        let travelMin = 15;
        if (loc?.homeLat && loc?.homeLng && visit.lat && visit.lng) {
          const mode: 'car' | 'walking' = (loc.transportMode || '').toLowerCase().includes('car') ? 'car' : 'walking';
          const dist = haversineDistance({ lat: Number(loc.homeLat), lng: Number(loc.homeLng) }, { lat: visit.lat, lng: visit.lng });
          travelMin = calculateTravelTime(dist, mode);
          score += Math.max(0, 20 - travelMin);
        }
        const prevVisit = [...empVisits].filter(v => timeToMinutes(v.endTime) <= visitStart).pop();
        const nextVisit = empVisits.find(v => timeToMinutes(v.startTime) >= visitEnd);
        if (prevVisit) {
          const gap = visitStart - timeToMinutes(prevVisit.endTime);
          notes.push(`${gap}m gap after ${prevVisit.clientName.split(',')[0]}`);
          score += gap >= 60 ? 15 : gap >= 30 ? 5 : 0;
        }
        if (nextVisit) notes.push(`Next: ${nextVisit.clientName.split(',')[0]} at ${nextVisit.startTime}`);
        notes.push(`Available ${emp.timeWindows}`);
        if (travelMin < 30) notes.push(`~${travelMin}m travel`);
        results.push({ empName: emp.employeeName, score: Math.min(100, Math.round(score)), travelMin, notes });
      });
    return results.sort((a, b) => b.score - a.score).slice(0, 3);
  };

  const assignVisit = (visit: ClientVisit & { unallocatedReason: string }, empName: string) => {
    if (!weeklySchedule) return;
    const empVisits = [...((weeklySchedule.assignments[visit.date]?.[empName] || []) as AssignedVisit[])];
    const newVisit: AssignedVisit = {
      id: visit.id,
      clientName: visit.clientName,
      startTime: visit.startTime,
      endTime: visit.endTime,
      durationMinutes: visit.durationMinutes,
      lat: visit.lat,
      lng: visit.lng,
      travelTimeBefore: 0,
      score: 0,
      serviceType: visit.serviceType,
    };
    const insertIdx = empVisits.findIndex(v => v.startTime > visit.startTime);
    if (insertIdx === -1) empVisits.push(newVisit);
    else empVisits.splice(insertIdx, 0, newVisit);
    setWeeklySchedule(prev => prev ? {
      ...prev,
      assignments: { ...prev.assignments, [visit.date]: { ...(prev.assignments[visit.date] || {}), [empName]: empVisits } },
      unallocated: prev.unallocated.filter(v => !(v.id === visit.id && v.date === visit.date)),
      metrics: { ...prev.metrics, totalVisitsAssigned: prev.metrics.totalVisitsAssigned + 1, totalVisitsUnallocated: prev.metrics.totalVisitsUnallocated - 1 },
    } : prev);
    setSelectedVisit(null);
    toast({ title: '✓ Assigned', description: `${visit.clientName} → ${empName}` });
  };

  const unallocateVisit = (empName: string, visit: AssignedVisit) => {
    if (!weeklySchedule) return;
    const empVisits = ((weeklySchedule.assignments[dayDate]?.[empName] || []) as AssignedVisit[]).filter(v => v.id !== visit.id);
    const newDayAssignments = { ...(weeklySchedule.assignments[dayDate] || {}), [empName]: empVisits };
    if (empVisits.length === 0) delete newDayAssignments[empName];
    const unallocEntry = {
      id: visit.id, clientName: visit.clientName, startTime: visit.startTime, endTime: visit.endTime,
      durationMinutes: visit.durationMinutes, date: dayDate, lat: visit.lat, lng: visit.lng,
      serviceType: visit.serviceType, unallocatedReason: 'Manually unallocated',
    } as ClientVisit & { unallocatedReason: string };
    setWeeklySchedule(prev => prev ? {
      ...prev,
      assignments: { ...prev.assignments, [dayDate]: newDayAssignments },
      unallocated: [...prev.unallocated, unallocEntry],
      metrics: { ...prev.metrics, totalVisitsAssigned: prev.metrics.totalVisitsAssigned - 1, totalVisitsUnallocated: prev.metrics.totalVisitsUnallocated + 1 },
    } : prev);
    setSelectedTimelineVisit(null);
    toast({ title: 'Visit unallocated', description: `${visit.clientName} moved to unallocated` });
  };

  // ── Timeline layout constants ─────────────────────────────────────────────
  const TIMELINE_START = 6;
  const TIMELINE_END   = 22;
  const HOUR_WIDTH     = 100;
  const INFO_WIDTH     = 230;
  const TIMELINE_HOURS = Array.from({ length: TIMELINE_END - TIMELINE_START }, (_, i) => TIMELINE_START + i);

  const AVATAR_GRADIENTS = [
    'linear-gradient(135deg,#2563EB,#4F46E5)',
    'linear-gradient(135deg,#EC4899,#F43F5E)',
    'linear-gradient(135deg,#10B981,#059669)',
    'linear-gradient(135deg,#F59E0B,#EA580C)',
    'linear-gradient(135deg,#8B5CF6,#7C3AED)',
    'linear-gradient(135deg,#06B6D4,#0891B2)',
  ];
  const avatarGradient = (name: string) => {
    let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
    return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
  };
  const avatarInitials = (name: string) =>
    name.trim().split(/\s+/).map(n => n[0]).slice(0, 2).join('').toUpperCase();

  const genderColor = (name: string) => {
    const g = (employeeGenderMap.get(name) || '').toLowerCase();
    return g === 'female' ? '#DB2777' : g === 'male' ? '#2563EB' : '#0F172A';
  };

  const visitGradient = (visit: AssignedVisit) => {
    const s = (visit.serviceType || '').toLowerCase();
    if (s.includes('complex') || s.includes('dementia') || s.includes('medic'))
      return 'linear-gradient(135deg,#8B5CF6,#7C3AED)';
    if (s.includes('companion')) return 'linear-gradient(135deg,#2563EB,#1D4ED8)';
    if (s.includes('double'))    return 'linear-gradient(135deg,#F59E0B,#D97706)';
    return 'linear-gradient(135deg,#10B981,#059669)';
  };

  const timeToX = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return Math.max(0, ((h + m / 60) - TIMELINE_START) * HOUR_WIDTH);
  };
  const durationToW = (start: string, end: string) => {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    return Math.max(48, ((eh + em / 60) - (sh + sm / 60)) * HOUR_WIDTH);
  };

  // ── Absence colour helper ─────────────────────────────────────────────────
  const getAbsenceStyle = (status: string): { bg: string; border: string; text: string; label: string; icon: string } => {
    const s = (status || '').toLowerCase();
    if (s.includes('holiday') || s.includes('annual leave'))
      return { bg: '#FAF5FF', border: '#A855F7', text: '#7E22CE', label: 'Holiday', icon: '🏖️' };
    if (s.includes('sick') || s.includes('sickness'))
      return { bg: '#FFF5F5', border: '#EF4444', text: '#B91C1C', label: 'Sickness', icon: '🤒' };
    if (s.includes('absent') || s.includes('unavailable'))
      return { bg: '#F8FAFC', border: '#94A3B8', text: '#475569', label: 'Absent', icon: '🚫' };
    if (s.includes('partial') || s.includes('meeting') || s.includes('training'))
      return { bg: '#FFFBEB', border: '#F59E0B', text: '#B45309', label: 'Partial', icon: '⚠️' };
    return { bg: '#F8FAFC', border: '#CBD5E1', text: '#64748B', label: status || 'Unavailable', icon: '⭕' };
  };

  // ── Current day data ─────────────────────────────────────────────────────
  const dayDate   = weekDates[selectedDayIndex];
  const dayLabel  = `${dayNames[selectedDayIndex]}${dayDate ? ', ' + dayDate.split('-').slice(1).reverse().join('/') : ''}`;
  const dayAssign = (weeklySchedule?.assignments[dayDate] || {}) as Record<string, AssignedVisit[]>;

  const assignedEmpNames = Object.keys(dayAssign).sort();
  const assignedEmpSet   = new Set(assignedEmpNames);
  const availableTodayNoVisit = (data?.employeesByDate[dayDate] || []).filter(e =>
    e.timeWindows && e.timeWindows.trim() !== '' &&
    e.status !== 'Ad-hoc' &&
    (employeeWeeklyHoursMap.get(e.employeeName) || 0) > 0 &&
    !assignedEmpSet.has(e.employeeName) &&
    e.employeeName.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const ABSENCE_STATUSES = ['holiday', 'annual leave', 'sick', 'sickness', 'absent', 'unavailable', 'partial', 'meeting', 'training'];

  // Employees who are absent/holiday/sick today — shown in timeline with coloured overlay
  const alreadyInTimeline = new Set([...assignedEmpNames, ...availableTodayNoVisit.map(e => e.employeeName)]);
  const absentTodayEmployees = (data?.employeesByDate[dayDate] || []).filter(e => {
    const statusLower = (e.status || '').toLowerCase();
    const hasAbsenceStatus = ABSENCE_STATUSES.some(s => statusLower.includes(s));
    return (
      (employeeWeeklyHoursMap.get(e.employeeName) || 0) > 0 &&
      e.status !== 'Ad-hoc' &&
      hasAbsenceStatus &&
      !alreadyInTimeline.has(e.employeeName) &&
      e.employeeName.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }).sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  const timelineEmpNames = [
    ...assignedEmpNames.filter(n => n.toLowerCase().includes(searchTerm.toLowerCase())),
    ...availableTodayNoVisit.map(e => e.employeeName),
    ...absentTodayEmployees.map(e => e.employeeName),
  ];

  // ── DnD: validate whether a visit can be dropped on an employee row ────────
  const validateDrop = (
    visit: { startTime: string; endTime: string; id?: string },
    empName: string,
    excludeVisitId?: string
  ): { valid: boolean; reason: string } => {
    const empForDay = data?.employeesByDate[dayDate]?.find(e => e.employeeName === empName);
    if (!empForDay?.timeWindows || empForDay.timeWindows.trim() === '')
      return { valid: false, reason: 'No availability today' };
    const windows = parseTimeWindows(empForDay.timeWindows);
    const visitStart = timeToMinutes(visit.startTime);
    const visitEnd   = timeToMinutes(visit.endTime);
    if (!windows.some(w => visitStart >= w.start && visitEnd <= w.end))
      return { valid: false, reason: 'Outside availability window' };
    const existing = ((weeklySchedule?.assignments[dayDate]?.[empName] || []) as AssignedVisit[])
      .filter(v => excludeVisitId ? v.id !== excludeVisitId : true);
    if (existing.some(ev => {
      const es = timeToMinutes(ev.startTime); const ee = timeToMinutes(ev.endTime);
      return !(visitEnd + 5 <= es || visitStart >= ee + 5);
    })) return { valid: false, reason: 'Time conflict with existing visit' };
    return { valid: true, reason: '' };
  };

  // Pre-compute valid/invalid targets for all rows while a drag is in progress (plain value, not a hook)
  const validDropEmps = (() => {
    if (!activeDragData) return null;
    const { visit, type, fromEmp } = activeDragData;
    const excludeId = type === 'assigned' ? (visit as AssignedVisit).id : undefined;
    const map = new Map<string, boolean>();
    timelineEmpNames.forEach(name => {
      map.set(name, type === 'assigned' && name === fromEmp ? false : validateDrop(visit, name, excludeId).valid);
    });
    return map;
  })();

  const reassignVisit = (visit: AssignedVisit, fromEmp: string, toEmp: string) => {
    if (!weeklySchedule) return;
    const srcVisits = ((weeklySchedule.assignments[dayDate]?.[fromEmp] || []) as AssignedVisit[]).filter(v => v.id !== visit.id);
    const dstVisits = [...((weeklySchedule.assignments[dayDate]?.[toEmp] || []) as AssignedVisit[])];
    const idx = dstVisits.findIndex(v => v.startTime > visit.startTime);
    if (idx === -1) dstVisits.push(visit); else dstVisits.splice(idx, 0, visit);
    const nd: Record<string, AssignedVisit[]> = { ...(weeklySchedule.assignments[dayDate] || {}), [fromEmp]: srcVisits, [toEmp]: dstVisits };
    if (srcVisits.length === 0) delete nd[fromEmp];
    setWeeklySchedule(prev => prev ? { ...prev, assignments: { ...prev.assignments, [dayDate]: nd } } : prev);
    setSelectedTimelineVisit(null);
    toast({ title: '✓ Reassigned', description: `${visit.clientName} → ${toEmp.split(' ')[0]}` });
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveDragData(active.data.current as any);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveDragData(null);
    if (!over) return;
    const toEmp = over.id.toString().replace('emp-row-', '');
    const dd = active.data.current as { type: 'unallocated' | 'assigned'; visit: any; fromEmp?: string };
    if (!dd) return;
    const excludeId = dd.type === 'assigned' ? dd.visit.id : undefined;
    const { valid, reason } = validateDrop(dd.visit, toEmp, excludeId);
    if (!valid) {
      toast({ title: 'Cannot assign here', description: reason, variant: 'destructive' });
      return;
    }
    if (dd.type === 'unallocated') {
      assignVisit(dd.visit, toEmp);
    } else if (dd.type === 'assigned' && dd.fromEmp !== toEmp) {
      reassignVisit(dd.visit, dd.fromEmp!, toEmp);
    }
  };

  const todayUnallocated = (weeklySchedule?.unallocated || []).filter(v => v.date === dayDate);
  const filteredUnallocated = todayUnallocated.filter(v => {
    const ms = leftSearch === '' || v.clientName.toLowerCase().includes(leftSearch.toLowerCase());
    const mf = leftFilter === 'all' ||
      (leftFilter === 'urgent'   && (v.priority != null && v.priority >= 3)) ||
      (leftFilter === 'morning'  && v.startTime < '12:00') ||
      (leftFilter === 'complex'  && (v.serviceType || '').toLowerCase().includes('complex')) ||
      (leftFilter === 'double'   && (v.serviceType || '').toLowerCase().includes('double'));
    return ms && mf;
  });

  const totalAssigned = weeklySchedule?.metrics.totalVisitsAssigned ?? 0;
  const totalUnalloc  = weeklySchedule?.metrics.totalVisitsUnallocated ?? 0;
  const totalVisitsW  = totalAssigned + totalUnalloc;
  const avgTravel     = weeklySchedule?.metrics.averageTravelTimePerVisit ?? 0;
  const empsUsed      = weeklySchedule?.metrics.employeesUtilized ?? 0;
  const allocPct      = totalVisitsW > 0 ? Math.round((totalAssigned / totalVisitsW) * 100) : 0;

  // ── Weekly run view (early return) ───────────────────────────────────────
  if (viewMode === 'week' && selectedEmployee && weeklySchedule) {
    const totalVCnt = weekDates.reduce(
      (s, d) => s + (weeklySchedule.assignments[d]?.[selectedEmployee]?.length || 0), 0
    );
    return (
      <div style={{ background: '#F4F6FB', height: '100%', overflow: 'auto' }}>
        <div style={{ background: 'white', borderBottom: '1px solid #E5E9F2', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, position: 'sticky', top: 0, zIndex: 10 }}>
          <button
            onClick={() => setViewMode('day')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#2563EB', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 8 }}
            className="hover:bg-blue-50 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" /> Day View
          </button>
          <div style={{ width: 1, height: 20, background: '#E5E9F2' }} />
          <div style={{ width: 36, height: 36, borderRadius: 10, background: avatarGradient(selectedEmployee), display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 12, flexShrink: 0 }}>
            {avatarInitials(selectedEmployee)}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#0F172A' }}>{selectedEmployee}</div>
            <div style={{ fontSize: 11, color: '#64748B' }}>Weekly Run · {totalVCnt} visits</div>
          </div>
        </div>
        <div style={{ padding: '16px 20px' }} className="space-y-3">
          {weekDates.map((date, index) => {
            const dv = (weeklySchedule.assignments[date]?.[selectedEmployee] || []) as AssignedVisit[];
            const empForDate = data?.employeesByDate[date]?.find(e => e.employeeName === selectedEmployee);
            // No record at all = carer doesn't work this day → skip
            if (!empForDate) return null;
            if (empForDate.status === 'Ad-hoc') return null;
            // Show absent/holiday/sick days with a coloured indicator (only if there IS a record but no timeWindows)
            if (!empForDate.timeWindows || empForDate.timeWindows.trim() === '') {
              const absStyle = getAbsenceStyle(empForDate?.status || 'Unavailable');
              return (
                <div key={date} style={{ background: absStyle.bg, border: `1px solid ${absStyle.border}`, borderRadius: 12, overflow: 'hidden', opacity: 0.85 }}>
                  <div style={{ borderBottom: `1px solid ${absStyle.border}20`, padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: '#0F172A' }}>{dayNames[index]}</span>
                      <span style={{ fontSize: 12, color: '#64748B' }}>{date.split('-').slice(1).reverse().join('/')}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: absStyle.text }}>{absStyle.icon} {absStyle.label}</span>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: `${absStyle.border}18`, color: absStyle.text }}>
                      Not available
                    </span>
                  </div>
                  <div style={{ padding: '10px 16px' }}>
                    <span style={{ fontSize: 12, color: absStyle.text, fontStyle: 'italic' }}>
                      {empForDate?.status ? `Status: ${empForDate.status}` : 'No availability recorded for this day'}
                    </span>
                  </div>
                </div>
              );
            }
            return (
              <div key={date} style={{ background: 'white', border: '1px solid #E5E9F2', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ background: '#F8FAFC', borderBottom: '1px solid #E5E9F2', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: '#0F172A' }}>{dayNames[index]}</span>
                    <span style={{ fontSize: 12, color: '#64748B' }}>{date.split('-').slice(1).reverse().join('/')}</span>
                    <span style={{ fontSize: 11, color: '#64748B' }}><Clock className="h-3 w-3 inline mr-1" />{empForDate.timeWindows}</span>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: dv.length > 0 ? '#DBEAFE' : '#F1F5F9', color: dv.length > 0 ? '#1D4ED8' : '#64748B' }}>
                    {dv.length} visits
                  </span>
                </div>
                <div style={{ padding: '12px 16px', overflowX: 'auto' }}>
                  {renderRunFlow(selectedEmployee, date, dv)}
                </div>
              </div>
            );
          }).filter(Boolean)}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#F4F6FB] dark:bg-gray-900" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── Action bar ─────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 dark:border-gray-700" style={{ height: 56, borderBottom: '1px solid #E5E9F2', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 10, flexShrink: 0, boxShadow: '0 1px 3px rgba(15,23,42,.03)' }}>

        {/* Day tabs */}
        <div style={{ display: 'flex', gap: 2, background: '#F1F5F9', padding: 4, borderRadius: 10, flexShrink: 0 }}>
          {weekDates.map((date, idx) => {
            const dCount = weeklySchedule
              ? Object.values(weeklySchedule.assignments[date] || {}).reduce((s, v) => s + v.length, 0) : 0;
            const isToday = date === new Date().toISOString().split('T')[0];
            const active = selectedDayIndex === idx;
            return (
              <button
                key={date}
                onClick={() => setSelectedDayIndex(idx)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  padding: '5px 10px', borderRadius: 7, border: 'none', cursor: 'pointer',
                  minWidth: 52, transition: 'all .15s',
                  background: active ? 'white' : 'transparent',
                  color: active ? '#2563EB' : '#64748B',
                  boxShadow: active ? '0 2px 5px rgba(0,0,0,.06)' : 'none',
                  outline: isToday && !active ? '2px solid #BFDBFE' : 'none',
                  outlineOffset: 1,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, lineHeight: 1 }}>{dayNames[idx].slice(0, 3)}</span>
                <span style={{ fontSize: 10, opacity: .75, marginTop: 2 }}>{date.split('-').slice(1).reverse().join('/')}</span>
                {dCount > 0 && (
                  <span style={{ fontSize: 9, marginTop: 2, padding: '1px 5px', borderRadius: 10, fontWeight: 700, background: active ? 'rgba(37,99,235,.12)' : '#DBEAFE', color: '#1D4ED8' }}>
                    {dCount}v
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Employee search */}
        <div style={{ position: 'relative', width: 170, flexShrink: 0 }}>
          <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 13, height: 13, color: '#94A3B8' }} />
          <input
            placeholder="Search carers..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{ width: '100%', height: 34, paddingLeft: 28, paddingRight: 8, borderRadius: 8, border: '1px solid #E5E9F2', fontSize: 12, outline: 'none', background: 'white', color: '#334155' }}
            data-testid="input-search-employee"
          />
        </div>

        <div style={{ flex: 1 }} />

        {lastGeneratedAt && (
          <span style={{ fontSize: 11, color: '#94A3B8', whiteSpace: 'nowrap', flexShrink: 0 }}>
            Auto-saved · {lastGeneratedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}

        <Button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending || allWeekVisits.length === 0 || !canGenerate}
          title={!canGenerate ? 'Only Schedulers and Admins can generate schedules' : ''}
          style={{ height: 38, padding: '0 16px', background: 'linear-gradient(135deg,#2563EB,#4F46E5)', color: 'white', border: 'none', borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: (generateMutation.isPending || !canGenerate) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 4px 14px rgba(37,99,235,.3)', whiteSpace: 'nowrap', flexShrink: 0, opacity: (generateMutation.isPending || !canGenerate) ? .7 : 1 }}
          data-testid="button-generate-weekly"
        >
          {generateMutation.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…</>
            : !canGenerate      ? <><Lock className="h-3.5 w-3.5" /> View Only</>
            : <><Zap className="h-3.5 w-3.5" /> Generate Schedule</>}
        </Button>
      </div>

      {/* ── Main 3-column layout ─────────────────────────────────────── */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div style={{ display: 'grid', gridTemplateColumns: `${rightPanelOpen ? '300px' : '44px'} 1fr ${leftPanelOpen ? '280px' : '44px'}`, flex: 1, overflow: 'hidden', minHeight: 0, transition: 'grid-template-columns .2s' }}>

        {/* ── RIGHT: Unallocated visits ──────────────────────────────── */}
        <div className="bg-white dark:bg-gray-800 dark:border-gray-700" style={{ order: 3, borderLeft: '1px solid #E5E9F2', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!leftPanelOpen ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '14px 0', gap: 10, flex: 1 }}>
              <button onClick={() => setLeftPanelOpen(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 4 }} title="Show unallocated">
                <ChevronLeft style={{ width: 16, height: 16 }} />
              </button>
              {todayUnallocated.length > 0 && (
                <span style={{ background: '#EF4444', color: 'white', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 8 }}>
                  {todayUnallocated.length}
                </span>
              )}
            </div>
          ) : (<>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #E5E9F2', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8 }}>
                Unallocated Visits
                {todayUnallocated.length > 0 && (
                  <span style={{ background: 'linear-gradient(135deg,#EF4444,#F87171)', color: 'white', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, boxShadow: '0 3px 8px rgba(239,68,68,.28)' }}>
                    {todayUnallocated.length}
                  </span>
                )}
              </h3>
              <button onClick={() => setLeftPanelOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 4, borderRadius: 6 }} title="Hide panel">
                <ChevronRight style={{ width: 14, height: 14 }} />
              </button>
            </div>
            <div style={{ background: '#F8FAFC', border: '1px solid #E5E9F2', borderRadius: 10, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Search style={{ width: 13, height: 13, color: '#94A3B8', flexShrink: 0 }} />
              <input
                placeholder="Search client, care type..."
                value={leftSearch}
                onChange={e => setLeftSearch(e.target.value)}
                style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, fontSize: 12, color: '#334155' }}
              />
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 12, scrollbarWidth: 'thin', scrollbarColor: '#CBD5E1 transparent' }}>
            {filteredUnallocated.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '36px 16px', color: '#94A3B8' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
                <p style={{ fontSize: 13, fontWeight: 600, margin: 0, color: '#64748B' }}>
                  {weeklySchedule ? 'All visits allocated today' : 'Generate a schedule to see unallocated visits'}
                </p>
              </div>
            ) : (
              filteredUnallocated.map((visit, idx) => {
                const isSelected = selectedVisit?.id === visit.id;
                const svcLower = (visit.serviceType || '').toLowerCase();
                const priColor = (visit.priority != null && visit.priority >= 3) ? '#EF4444'
                  : svcLower.includes('complex') || svcLower.includes('dementia') || svcLower.includes('medic') ? '#8B5CF6'
                  : svcLower.includes('double') ? '#F59E0B'
                  : '#06B6D4';
                const svcType = (visit.serviceType || 'Personal care').split('/')[0].trim();
                return (
                  <DraggableUnallocCard
                    key={`${visit.id}-${idx}`}
                    visit={visit}
                    isSelected={isSelected}
                    priColor={priColor}
                    onClick={() => setSelectedVisit(isSelected ? null : visit)}
                  >
                    <div style={{ marginBottom: 4 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#0F172A', marginBottom: 3 }}>{visit.clientName}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#2563EB' }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        {visit.startTime} – {visit.endTime}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: '#64748B', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <MapPin style={{ width: 11, height: 11 }} />
                      {svcType} · {visit.durationMinutes}min
                    </div>
                    {visit.unallocatedReason && (
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 6, background: '#FEF2F2', color: '#DC2626', display: 'inline-block' }}>
                        {visit.unallocatedReason.slice(0, 45)}{visit.unallocatedReason.length > 45 ? '…' : ''}
                      </span>
                    )}
                  </DraggableUnallocCard>
                );
              })
            )}

            {/* Other-day unallocated summary */}
            {weeklySchedule && weeklySchedule.unallocated.filter(v => v.date !== dayDate).length > 0 && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed #E2E8F0' }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                  Other days · {weeklySchedule.unallocated.filter(v => v.date !== dayDate).length} visits
                </p>
                {weekDates.map((d, di) => {
                  const dv = weeklySchedule.unallocated.filter(v => v.date === d && d !== dayDate);
                  if (dv.length === 0) return null;
                  return (
                    <div key={d} style={{ marginBottom: 8 }}>
                      <p style={{ fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 4 }}>
                        {dayNames[di].slice(0, 3)} · {dv.length} unallocated
                      </p>
                      {dv.map((v, i) => (
                        <div key={i} style={{ fontSize: 11, color: '#94A3B8', padding: '3px 8px', background: '#F8FAFC', borderRadius: 6, marginBottom: 2 }}>
                          {v.clientName} · {v.startTime}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          </>)}
        </div>

        {/* ── CENTER: Timeline ──────────────────────────────────────── */}
        <div className="bg-white dark:bg-gray-800 dark:border-gray-700" style={{ order: 2, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid #E5E9F2' }}>
          {/* Timeline sub-header */}
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #E5E9F2', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#0F172A' }}>
              Carer Schedule — {dayLabel}
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: '#64748B', flexWrap: 'wrap' }}>
              {[
                { color: '#10B981', label: 'Standard' },
                { color: '#2563EB', label: 'Companion' },
                { color: '#8B5CF6', label: 'Complex' },
                { color: '#F59E0B', label: 'Double-up' },
              ].map(({ color, label }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: color, display: 'inline-block' }} />
                  {label}
                </div>
              ))}
              <div style={{ width: 1, height: 14, background: '#E5E9F2', margin: '0 2px' }} />
              {[
                { color: '#A855F7', label: 'Holiday' },
                { color: '#EF4444', label: 'Sick' },
                { color: '#F59E0B', label: 'Partial' },
                { color: '#94A3B8', label: 'Absent' },
              ].map(({ color, label }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: color, opacity: 0.55, display: 'inline-block' }} />
                  {label}
                </div>
              ))}
            </div>
          </div>

          {/* Scrollable timeline */}
          <div style={{ flex: 1, overflow: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#CBD5E1 transparent' }}>
            {/* Hours header */}
            <div style={{ display: 'grid', gridTemplateColumns: `${INFO_WIDTH}px repeat(${TIMELINE_HOURS.length}, ${HOUR_WIDTH}px)`, position: 'sticky', top: 0, background: 'white', zIndex: 5, borderBottom: '1px solid #E5E9F2' }}>
              <div style={{ padding: '10px 14px', fontSize: 12, fontWeight: 700, color: '#0F172A', background: '#F8FAFC', borderRight: '1px solid #E5E9F2' }}>
                CAREGivers ({timelineEmpNames.length})
              </div>
              {TIMELINE_HOURS.map(h => {
                const isNow = h === new Date().getHours() && dayDate === new Date().toISOString().split('T')[0];
                return (
                  <div key={h} style={{ padding: '10px 4px', fontSize: 11, fontWeight: 600, color: isNow ? '#2563EB' : '#64748B', textAlign: 'center', borderLeft: '1px solid #E5E9F2', background: isNow ? '#EFF6FF' : '#F8FAFC' }}>
                    {String(h).padStart(2, '0')}:00
                  </div>
                );
              })}
            </div>

            {timelineEmpNames.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#94A3B8', flexDirection: 'column', gap: 8 }}>
                <Calendar style={{ width: 32, height: 32, opacity: .35 }} />
                <p style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>
                  {weeklySchedule ? 'No employees available today' : 'Generate a schedule to see assignments'}
                </p>
              </div>
            ) : (
              timelineEmpNames.map((empName) => {
                const visits = (dayAssign[empName] || []) as AssignedVisit[];
                const location = employeeLocationMap.get(empName);
                const isWalker = !(location?.transportMode?.toLowerCase() || '').includes('car');
                const weeklyHours = employeeWeeklyHoursMap.get(empName) || 0;
                const empForDay = data?.employeesByDate[dayDate]?.find(e => e.employeeName === empName);
                const timeWindows = empForDay?.timeWindows || '';
                const hasVisits = visits.length > 0;
                const totalVisitMins = visits.reduce((sum, v) => {
                  const [sh, sm] = v.startTime.split(':').map(Number);
                  const [eh, em] = v.endTime.split(':').map(Number);
                  return sum + Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
                }, 0);
                const totalVisitHrs = totalVisitMins > 0
                  ? (totalVisitMins % 60 === 0 ? `${totalVisitMins / 60}h` : `${(totalVisitMins / 60).toFixed(1)}h`)
                  : null;
                const utilPct = Math.min(100, (visits.length / Math.max(1, Math.ceil(weeklyHours / 5 / 1.5))) * 100);
                const utilColor = utilPct >= 80 ? '#EF4444' : utilPct >= 50 ? '#F59E0B' : '#10B981';

                // Absence detection for this employee
                const empStatusLower = (empForDay?.status || '').toLowerCase();
                const empHasAbsence = ABSENCE_STATUSES.some(s => empStatusLower.includes(s));
                const absStyle = empHasAbsence ? getAbsenceStyle(empForDay?.status ?? '') : null;
                const isFullAbsence = absStyle !== null && (!timeWindows || timeWindows.trim() === '');
                const isPartialAbsence = absStyle !== null && timeWindows && timeWindows.trim() !== '';

                // Now-line position for today
                const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
                const nowX = ((nowMinutes / 60) - TIMELINE_START) * HOUR_WIDTH;
                const showNow = dayDate === new Date().toISOString().split('T')[0] && nowX >= 0 && nowX <= (TIMELINE_END - TIMELINE_START) * HOUR_WIDTH;

                const ghostBlock = activeDragData ? {
                  xLeft: timeToX(activeDragData.visit.startTime),
                  width: durationToW(activeDragData.visit.startTime, activeDragData.visit.endTime),
                  infoWidth: INFO_WIDTH,
                } : null;
                return (
                  <DroppableEmpRow key={empName} empName={empName} validDrop={validDropEmps?.get(empName) ?? null} ghostBlock={ghostBlock}>
                  <div
                    style={{ display: 'grid', gridTemplateColumns: `${INFO_WIDTH}px repeat(${TIMELINE_HOURS.length}, ${HOUR_WIDTH}px)`, borderBottom: `1px solid ${isFullAbsence ? absStyle!.border + '30' : '#F1F5F9'}`, minHeight: 96, position: 'relative', background: isFullAbsence ? absStyle!.bg : 'transparent' }}
                  >
                    {/* Carer info cell — sticky left */}
                    <div
                      style={{ padding: '8px 10px', background: isFullAbsence ? absStyle!.bg : '#F8FAFC', borderRight: `${isFullAbsence ? '2px' : '1px'} solid ${isFullAbsence ? absStyle!.border : '#E5E9F2'}`, display: 'flex', alignItems: 'center', gap: 8, position: 'sticky', left: 0, zIndex: 2, cursor: 'pointer' }}
                      onClick={() => { setSelectedEmployee(empName); setViewMode('week'); }}
                      title="Click to view weekly run"
                    >
                      {/* Icon chip: absence emoji for absent, transport for active */}
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: isFullAbsence ? `${absStyle!.border}22` : isWalker ? '#ECFDF5' : '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: `1.5px solid ${isFullAbsence ? absStyle!.border + '55' : isWalker ? '#A7F3D0' : '#BFDBFE'}`, fontSize: 14 }}>
                        {isFullAbsence
                          ? absStyle!.icon
                          : isWalker
                            ? <User style={{ width: 15, height: 15, color: '#059669' }} />
                            : <Car style={{ width: 15, height: 15, color: '#2563EB' }} />}
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: isFullAbsence ? '#334155' : genderColor(empName), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{empName}</div>
                        <div style={{ fontSize: 10, color: isFullAbsence ? absStyle!.text : '#64748B', marginTop: 1, display: 'flex', alignItems: 'center', gap: 4, fontWeight: isFullAbsence ? 600 : 400 }}>
                          {isFullAbsence ? absStyle!.label : `${weeklyHours.toFixed(0)}h/wk`}
                          {!isFullAbsence && totalVisitHrs && <span style={{ color: '#94A3B8' }}>· {totalVisitHrs}</span>}
                          {isPartialAbsence && <span style={{ color: absStyle!.text, fontWeight: 600 }}>· {absStyle!.label}</span>}
                        </div>
                        {!isFullAbsence && timeWindows && (
                          <div style={{ fontSize: 9, color: '#94A3B8', marginTop: 2, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{timeWindows}</div>
                        )}
                      </div>
                      {/* Donut — hide for fully absent employees */}
                      {!isFullAbsence && (
                        <svg width="34" height="34" viewBox="0 0 36 36" style={{ flexShrink: 0 }}>
                          <circle cx="18" cy="18" r="13" fill="none" stroke="#E2E8F0" strokeWidth="3.5" />
                          <circle cx="18" cy="18" r="13" fill="none" stroke={utilColor} strokeWidth="3.5"
                            strokeDasharray={`${2 * Math.PI * 13 * utilPct / 100} ${2 * Math.PI * 13}`}
                            strokeLinecap="round" transform="rotate(-90 18 18)" />
                          <text x="18" y="22" textAnchor="middle" fontSize="8" fontWeight="800" fill={utilColor}>{Math.round(utilPct)}%</text>
                        </svg>
                      )}
                      {isFullAbsence && (
                        <div style={{ fontSize: 9, color: '#94A3B8', textAlign: 'right', flexShrink: 0 }}>{weeklyHours.toFixed(0)}h/wk</div>
                      )}
                    </div>

                    {/* Hour grid cells */}
                    {TIMELINE_HOURS.map(h => {
                      const isNowH = h === new Date().getHours() && dayDate === new Date().toISOString().split('T')[0];
                      return (
                        <div key={h} style={{ borderLeft: `1px solid ${isFullAbsence ? absStyle!.border + '20' : '#F1F5F9'}`, background: isNowH ? 'rgba(37,99,235,.02)' : 'transparent' }} />
                      );
                    })}

                    {/* Overlay: absence background + availability band + visit blocks + travel labels */}
                    <div style={{ position: 'absolute', top: 0, left: INFO_WIDTH, right: 0, bottom: 0, pointerEvents: 'none', zIndex: 3 }}>

                      {/* Full absence — colour the entire timeline strip */}
                      {isFullAbsence && (
                        <div style={{ position: 'absolute', inset: 0, background: `${absStyle!.border}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: absStyle!.text, background: `${absStyle!.border}25`, padding: '3px 14px', borderRadius: 99, border: `1px solid ${absStyle!.border}45`, whiteSpace: 'nowrap' }}>
                            {absStyle!.icon} {empForDay?.status || absStyle!.label}
                          </span>
                        </div>
                      )}

                      {/* Partial absence — colour the GAP regions outside time windows */}
                      {isPartialAbsence && (() => {
                        const windows = parseTimeWindows(timeWindows);
                        const totalStart = TIMELINE_START * 60; // in minutes
                        const totalEnd   = TIMELINE_END   * 60;
                        const gaps: { s: number; e: number }[] = [];
                        if (windows.length === 0) {
                          gaps.push({ s: totalStart, e: totalEnd });
                        } else {
                          if (windows[0].start > totalStart) gaps.push({ s: totalStart, e: windows[0].start });
                          for (let i = 0; i < windows.length - 1; i++) {
                            if (windows[i + 1].start > windows[i].end) gaps.push({ s: windows[i].end, e: windows[i + 1].start });
                          }
                          if (windows[windows.length - 1].end < totalEnd) gaps.push({ s: windows[windows.length - 1].end, e: totalEnd });
                        }
                        return gaps.map((g, gi) => {
                          const xL = Math.max(0, (g.s / 60 - TIMELINE_START) * HOUR_WIDTH);
                          const xR = Math.min((TIMELINE_END - TIMELINE_START) * HOUR_WIDTH, (g.e / 60 - TIMELINE_START) * HOUR_WIDTH);
                          const w  = Math.max(0, xR - xL);
                          if (w <= 0) return null;
                          return (
                            <div key={gi} style={{ position: 'absolute', top: 0, bottom: 0, left: xL, width: w, background: `${absStyle!.border}18`, borderLeft: gi === 0 ? 'none' : `1px dashed ${absStyle!.border}50`, zIndex: 1 }} />
                          );
                        });
                      })()}

                      {/* Availability window bands — thin strip at bottom of row */}
                      {parseTimeWindows(timeWindows).map((w, wi) => {
                        const xL = Math.max(0, (w.start / 60 - TIMELINE_START) * HOUR_WIDTH);
                        const xR = Math.min((TIMELINE_END - TIMELINE_START) * HOUR_WIDTH, (w.end / 60 - TIMELINE_START) * HOUR_WIDTH);
                        const barW = Math.max(0, xR - xL);
                        if (barW <= 0) return null;
                        return (
                          <div key={wi} style={{
                            position: 'absolute', bottom: 5, left: xL, width: barW, height: 5,
                            borderRadius: 3,
                            background: isWalker ? 'rgba(16,185,129,.22)' : 'rgba(37,99,235,.18)',
                            border: `1px solid ${isWalker ? 'rgba(16,185,129,.45)' : 'rgba(37,99,235,.38)'}`,
                          }} />
                        );
                      })}

                      {visits.map((visit, vi) => {
                        const xLeft  = timeToX(visit.startTime);
                        const wPx    = durationToW(visit.startTime, visit.endTime);
                        const grad   = visitGradient(visit);
                        const travel = visit.travelTimeBefore;
                        const showTravel = travel > 0 && travel < 999;
                        const travelIcon = vi === 0 ? '🏠' : isWalker ? '🚶' : '🚗';
                        const isSelected = selectedTimelineVisit?.empName === empName && selectedTimelineVisit?.visit.id === visit.id;
                        return (
                          <div key={vi} style={{ pointerEvents: 'auto' }}>
                            {showTravel && (
                              <div style={{
                                position: 'absolute', top: 64, left: Math.max(2, xLeft - (vi === 0 ? 52 : 42)), height: 20, padding: '0 6px',
                                borderRadius: 999, display: 'flex', alignItems: 'center', gap: 3,
                                fontSize: 10, fontWeight: 800, zIndex: 6, whiteSpace: 'nowrap',
                                background: travel > 30 ? '#FEF2F2' : travel > 20 ? '#FFFBEB' : '#ECFDF5',
                                color:      travel > 30 ? '#DC2626' : travel > 20 ? '#B45309' : '#047857',
                                border: `1px solid ${travel > 30 ? '#FCA5A5' : travel > 20 ? '#FCD34D' : '#A7F3D0'}`,
                                boxShadow: '0 2px 6px rgba(15,23,42,.08)',
                              }}>
                                {travelIcon} {travel}m
                              </div>
                            )}
                            <DraggableTimelineVisit
                              visit={visit}
                              empName={empName}
                              xLeft={xLeft}
                              wPx={wPx}
                              grad={grad}
                              isSelected={isSelected}
                              onSelect={() => setSelectedTimelineVisit(isSelected ? null : { empName, visit })}
                              onUnallocate={() => unallocateVisit(empName, visit)}
                            />

                            {/* Break block — shown when gap to next visit is ≥ 90 min (carer goes home) */}
                            {vi < visits.length - 1 && (() => {
                              const nextV = visits[vi + 1];
                              const currentEndMin = timeToMinutes(visit.endTime);
                              const nextStartMin  = timeToMinutes(nextV.startTime);
                              const gapMinutes    = nextStartMin - currentEndMin;
                              if (gapMinutes < 90) return null;

                              const empLoc = employeeLocationMap.get(empName);
                              let travelToHome   = 0;
                              let travelFromHome = (nextV.travelTimeBefore != null && nextV.travelTimeBefore < 999) ? nextV.travelTimeBefore : 0;

                              if (empLoc?.homeLat && empLoc?.homeLng) {
                                if (visit.travelTimeAfter != null && visit.travelTimeAfter < 999) {
                                  travelToHome = visit.travelTimeAfter;
                                } else if (visit.lat && visit.lng) {
                                  const mode: 'car' | 'walking' = isWalker ? 'walking' : 'car';
                                  const dist = haversineDistance(
                                    { lat: visit.lat, lng: visit.lng },
                                    { lat: Number(empLoc.homeLat), lng: Number(empLoc.homeLng) }
                                  );
                                  travelToHome = calculateTravelTime(dist, mode);
                                }
                              }

                              const breakTime = Math.max(0, gapMinutes - travelToHome - travelFromHome);

                              const breakStartMin = currentEndMin + travelToHome;
                              const breakEndMin   = nextStartMin  - travelFromHome;
                              const breakStartStr = minutesToTime(breakStartMin);
                              const breakEndStr   = minutesToTime(breakEndMin);
                              const xLeft  = timeToX(breakStartStr);
                              const breakW = Math.max(40, durationToW(breakStartStr, breakEndStr));

                              const xVisitEnd = timeToX(visit.endTime);

                              return (
                                <>
                                  {/* Travel pill: last visit → home */}
                                  {travelToHome > 0 && (
                                    <div style={{
                                      position: 'absolute', top: 64, left: xVisitEnd + 4, height: 20, padding: '0 6px',
                                      borderRadius: 999, display: 'flex', alignItems: 'center', gap: 3,
                                      fontSize: 10, fontWeight: 800, zIndex: 6, whiteSpace: 'nowrap',
                                      background: travelToHome > 30 ? '#FEF2F2' : travelToHome > 20 ? '#FFFBEB' : '#ECFDF5',
                                      color:      travelToHome > 30 ? '#DC2626' : travelToHome > 20 ? '#B45309' : '#047857',
                                      border: `1px solid ${travelToHome > 30 ? '#FCA5A5' : travelToHome > 20 ? '#FCD34D' : '#A7F3D0'}`,
                                      boxShadow: '0 2px 6px rgba(15,23,42,.08)',
                                      pointerEvents: 'none',
                                    }}>
                                      {isWalker ? '🚶' : '🚗'} {travelToHome}m
                                    </div>
                                  )}

                                  {/* Break block */}
                                  <div
                                    style={{
                                      position: 'absolute', top: 12, left: xLeft, width: breakW, height: 50,
                                      borderRadius: 8, padding: '4px 6px',
                                      background: 'rgba(251,146,60,.12)',
                                      border: '1.5px dashed #F97316',
                                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                      zIndex: 3, overflow: 'hidden', pointerEvents: 'none',
                                    }}
                                    title={`Break at home · ${breakTime}min rest · ${travelToHome}min to home + ${travelFromHome}min to next visit`}
                                  >
                                    <span style={{ fontSize: 13, lineHeight: 1 }}>🏠</span>
                                    <span style={{ fontSize: 8, fontWeight: 700, color: '#9A3412', lineHeight: 1.3, marginTop: 1 }}>Break</span>
                                    <span style={{ fontSize: 8, fontWeight: 600, color: '#C2410C', lineHeight: 1.2 }}>{breakTime}m</span>
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                        );
                      })}

                      {/* Back-home travel pill after the last visit */}
                      {visits.length > 0 && (() => {
                        const lastV = visits[visits.length - 1];
                        const empLoc = employeeLocationMap.get(empName);
                        let travelHome = lastV.travelTimeAfter;
                        if ((travelHome === undefined || travelHome >= 999) && empLoc?.homeLat && empLoc?.homeLng && lastV.lat && lastV.lng) {
                          const mode: 'car' | 'walking' = isWalker ? 'walking' : 'car';
                          const dist = haversineDistance({ lat: lastV.lat, lng: lastV.lng }, { lat: Number(empLoc.homeLat), lng: Number(empLoc.homeLng) });
                          travelHome = calculateTravelTime(dist, mode);
                        }
                        if (!travelHome || travelHome >= 999) return null;
                        const xEnd = timeToX(lastV.endTime);
                        return (
                          <div style={{
                            position: 'absolute', top: 64, left: xEnd + 4, height: 20, padding: '0 6px',
                            borderRadius: 999, display: 'flex', alignItems: 'center', gap: 3,
                            fontSize: 10, fontWeight: 800, zIndex: 6, whiteSpace: 'nowrap',
                            background: '#F0FDF4', color: '#15803D', border: '1px solid #BBF7D0',
                            boxShadow: '0 2px 6px rgba(15,23,42,.08)',
                          }}>
                            🏠 {travelHome}m
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                  </DroppableEmpRow>
                );
              })
            )}

          </div>
        </div>

        {/* ── LEFT: Info panel ──────────────────────────────────────── */}
        <div className="bg-white dark:bg-gray-800" style={{ order: 1, borderRight: '1px solid #E5E9F2', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!rightPanelOpen ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '14px 0', gap: 10, flex: 1 }}>
              <button onClick={() => setRightPanelOpen(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 4 }} title="Show schedule info">
                <ChevronRight style={{ width: 16, height: 16 }} />
              </button>
              <Zap style={{ width: 14, height: 14, color: '#F59E0B' }} />
            </div>
          ) : (<>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E5E9F2', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Zap style={{ width: 14, height: 14, color: '#F59E0B' }} /> Schedule Info
            </h3>
            <button onClick={() => setRightPanelOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 4, borderRadius: 6 }} title="Hide panel">
              <ChevronLeft style={{ width: 14, height: 14 }} />
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 14, scrollbarWidth: 'thin', scrollbarColor: '#CBD5E1 transparent' }}>

            {selectedVisit ? (
              /* ── Selected visit panel ── */
              <div>
                <div style={{ background: 'linear-gradient(135deg,#1E1B4B,#312E81)', color: 'white', borderRadius: 14, padding: 16, marginBottom: 14, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: '-30%', right: '-20%', width: 160, height: 160, background: 'radial-gradient(circle,rgba(139,92,246,.4),transparent 70%)', pointerEvents: 'none' }} />
                  <div style={{ fontSize: 10, opacity: .7, textTransform: 'uppercase', letterSpacing: '.5px', position: 'relative' }}>Selected Visit</div>
                  <div style={{ fontSize: 14, fontWeight: 700, margin: '4px 0 10px', position: 'relative' }}>
                    {selectedVisit.clientName}
                    <span style={{ display: 'block', fontWeight: 400, opacity: .75, fontSize: 12, marginTop: 3 }}>
                      {selectedVisit.startTime}–{selectedVisit.endTime} · {selectedVisit.durationMinutes}min
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', position: 'relative' }}>
                    {selectedVisit.serviceType && (
                      <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, background: 'rgba(255,255,255,.15)' }}>{selectedVisit.serviceType}</span>
                    )}
                    {selectedVisit.priority && (
                      <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, background: 'rgba(255,255,255,.15)' }}>{selectedVisit.priority} priority</span>
                    )}
                  </div>
                </div>

                <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 10, padding: '10px 12px', marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#DC2626', marginBottom: 4 }}>Why unallocated</div>
                  <div style={{ fontSize: 12, color: '#7F1D1D' }}>{selectedVisit.unallocatedReason || 'Not optimal for this run'}</div>
                </div>

                {/* Suggested carers with assign */}
                {(() => {
                  const suggested = scoreSuggestedCarers(selectedVisit);
                  return (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#334155', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                        Top {suggested.length} Suggested Carers
                      </div>
                      {suggested.length === 0 ? (
                        <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 10, padding: '12px 14px', fontSize: 12, color: '#92400E' }}>
                          No available carers with a free slot for this visit time today.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {suggested.map((s, si) => (
                            <div key={s.empName} style={{ background: si === 0 ? 'linear-gradient(135deg,#EFF6FF,#F5F3FF)' : '#F8FAFC', border: `1px solid ${si === 0 ? '#BFDBFE' : '#E5E9F2'}`, borderRadius: 12, padding: '12px 12px 10px', position: 'relative' }}>
                              {si === 0 && (
                                <span style={{ position: 'absolute', top: -8, right: 10, background: 'linear-gradient(135deg,#10B981,#059669)', color: 'white', fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 10 }}>
                                  BEST MATCH
                                </span>
                              )}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                <div style={{ width: 32, height: 32, borderRadius: 9, background: avatarGradient(s.empName), display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 11, flexShrink: 0 }}>
                                  {avatarInitials(s.empName)}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.empName}</div>
                                </div>
                                <span style={{ fontSize: 18, fontWeight: 800, color: s.score >= 70 ? '#059669' : s.score >= 50 ? '#B45309' : '#DC2626' }}>{s.score}</span>
                              </div>
                              <div style={{ marginBottom: 8 }}>
                                {s.notes.map((n, ni) => (
                                  <div key={ni} style={{ fontSize: 11, color: '#475569', display: 'flex', alignItems: 'flex-start', gap: 4, marginBottom: 2 }}>
                                    <span style={{ color: '#10B981', fontSize: 12, lineHeight: 1.2 }}>✓</span> {n}
                                  </div>
                                ))}
                              </div>
                              <button
                                onClick={() => assignVisit(selectedVisit, s.empName)}
                                style={{ width: '100%', padding: '7px', background: 'linear-gradient(135deg,#2563EB,#4F46E5)', color: 'white', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                              >
                                Assign →
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}

                <button
                  onClick={() => setSelectedVisit(null)}
                  style={{ width: '100%', marginTop: 14, padding: '8px', borderRadius: 8, border: '1px solid #E5E9F2', background: 'white', fontSize: 12, fontWeight: 600, color: '#64748B', cursor: 'pointer' }}
                >
                  Clear selection
                </button>
              </div>
            ) : weeklySchedule ? (
              /* ── Summary panel ── */
              <>
                <div style={{ background: 'linear-gradient(135deg,#EFF6FF,#F5F3FF)', borderRadius: 12, padding: 14, marginBottom: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>Week Summary</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {[
                      { label: 'Assigned', value: totalAssigned, color: '#059669' },
                      { label: 'Unallocated', value: totalUnalloc, color: totalUnalloc > 0 ? '#DC2626' : '#059669' },
                      { label: 'Avg Travel', value: `${avgTravel}m`, color: '#2563EB' },
                      { label: 'Carers used', value: empsUsed, color: '#7C3AED' },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ background: 'white', borderRadius: 8, padding: '10px 12px' }}>
                        <div style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600, marginBottom: 2 }}>{label}</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 8 }}>Today · {dayLabel}</div>
                {(() => {
                  const todayAss  = Object.values(dayAssign).reduce((s, v) => s + v.length, 0);
                  const todayEmps = Object.keys(dayAssign).length;
                  return (
                    <div style={{ background: '#F8FAFC', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
                      {[
                        { label: 'Visits', value: todayAss },
                        { label: 'Carers active', value: todayEmps },
                        { label: 'Unallocated today', value: todayUnallocated.length, color: todayUnallocated.length > 0 ? '#DC2626' : '#059669' },
                      ].map(({ label, value, color }) => (
                        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{ fontSize: 12, color: '#64748B' }}>{label}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: color || '#0F172A' }}>{value}</span>
                        </div>
                      ))}
                      <div style={{ marginTop: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600 }}>Allocation rate</span>
                          <span style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600 }}>{allocPct}%</span>
                        </div>
                        <div style={{ height: 6, background: '#E2E8F0', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${allocPct}%`, height: '100%', background: allocPct >= 90 ? '#10B981' : allocPct >= 70 ? '#F59E0B' : '#EF4444', borderRadius: 3, transition: 'width .5s' }} />
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div style={{ background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#7C3AED', marginBottom: 4 }}>💡 Tip</div>
                  <div style={{ fontSize: 11, color: '#5B21B6', lineHeight: 1.5 }}>
                    Click a carer row to view their full weekly run. Click an unallocated visit (left panel) to see available carers.
                  </div>
                </div>
              </>
            ) : (
              /* ── No schedule yet ── */
              <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94A3B8' }}>
                <Zap style={{ width: 32, height: 32, margin: '0 auto 12px', opacity: .28 }} />
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#64748B' }}>No schedule generated</p>
                <p style={{ margin: '6px 0 0', fontSize: 11, lineHeight: 1.5 }}>Click Generate Schedule to optimise visit assignments using VRPTW</p>
              </div>
            )}
          </div>
          </>)}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {activeDragData ? (
          <div style={{ background: 'white', border: '2px solid #2563EB', borderRadius: 10, padding: '8px 12px', boxShadow: '0 8px 24px rgba(37,99,235,.25)', fontSize: 12, fontWeight: 700, color: '#0F172A', minWidth: 100, maxWidth: 180, pointerEvents: 'none' }}>
            <div style={{ marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeDragData.visit.clientName}</div>
            <div style={{ fontSize: 10, opacity: 0.7 }}>{activeDragData.visit.startTime}–{activeDragData.visit.endTime}</div>
            {activeDragData.type === 'assigned' && activeDragData.fromEmp && (
              <div style={{ fontSize: 9, opacity: 0.5, marginTop: 1 }}>from {activeDragData.fromEmp.split(' ')[0]}</div>
            )}
          </div>
        ) : null}
      </DragOverlay>
      </DndContext>

      {/* ── Bottom metrics bar ───────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 dark:border-gray-700" style={{ height: 44, borderTop: '1px solid #E5E9F2', display: 'flex', alignItems: 'center', padding: '0 22px', gap: 24, fontSize: 12, flexShrink: 0, color: '#64748B' }}>
        {[
          { label: 'Allocated: ', value: `${totalAssigned}/${totalVisitsW}`, dot: allocPct >= 90 ? '#10B981' : '#F59E0B' },
          { label: 'Unallocated: ', value: totalUnalloc, dot: totalUnalloc > 0 ? '#EF4444' : '#10B981' },
          { label: 'Avg travel: ', value: `${avgTravel} min`, dot: '#94A3B8' },
          { label: 'Carers used: ', value: empsUsed, dot: '#94A3B8' },
        ].map(({ label, value, dot }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, display: 'inline-block', flexShrink: 0 }} />
            {label}<strong style={{ color: '#0F172A', fontWeight: 700 }}>{value}</strong>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        {lastGeneratedAt && (
          <span style={{ color: '#94A3B8' }}>
            Auto-saved · {lastGeneratedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
    </div>
  );
}
