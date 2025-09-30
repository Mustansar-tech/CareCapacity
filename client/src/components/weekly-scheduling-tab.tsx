import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Calendar, 
  Clock, 
  MapPin, 
  Users, 
  Zap, 
  TrendingUp, 
  AlertCircle,
  CheckCircle,
  Car,
  User,
  RotateCcw,
  Plus,
  X,
  Route
} from "lucide-react";
import { getGenderColorClass } from "@/utils/gender-colors";
import { minutesToTime, getTravelMinutes, parseTimeWindows } from "@/utils/scheduling-utils";
import type { ProcessingResult } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

interface WeeklySchedulingTabProps {
  data: ProcessingResult | null;
  selectedDate?: string | null;
}

interface Visit {
  id: string;
  clientName: string;
  startTime: number; // minutes since midnight
  endTime: number;
  durationMinutes: number;
  priority: number;
  serviceType: string;
  lat?: number;
  lng?: number;
}

interface AssignedVisit extends Visit {
  employeeName: string;
  actualStartTime: number;
  actualEndTime: number;
  travelTimeBefore: number;
  travelTimeAfter: number;
  score: number;
}

interface EmployeeSchedule {
  employeeName: string;
  homeLat: number;
  homeLng: number;
  transportMode: 'car' | 'walking';
  timeWindows: Array<{ start: number; end: number }>;
  contractedDailyHours: number;
  visits: AssignedVisit[];
  totalTravelTime: number;
  totalWorkTime: number;
  utilizationPercent: number;
  freeTimeSlots: Array<{ start: number; end: number }>;
}

interface DaySchedule {
  date: string;
  employees: EmployeeSchedule[];
  unassignedVisits: Visit[];
  metrics: {
    totalAssignedVisits: number;
    totalUnassignedVisits: number;
    averageUtilization: number;
    totalTravelTime: number;
    routeEfficiency: number;
  };
}

export function WeeklySchedulingTab({ data, selectedDate }: WeeklySchedulingTabProps) {
  const [weekStartDate, setWeekStartDate] = useState(() => {
    const date = selectedDate ? new Date(selectedDate) : new Date();
    // Get Monday of the week
    const monday = new Date(date);
    monday.setDate(date.getDate() - date.getDay() + (date.getDay() === 0 ? -6 : 1));
    return monday.toISOString().split('T')[0];
  });

  const [selectedEmployeeName, setSelectedEmployeeName] = useState<string | null>(null);
  const [weeklySchedules, setWeeklySchedules] = useState<Record<string, DaySchedule>>({});
  const [optimizationSettings, setOptimizationSettings] = useState({
    maxTravelPerVisit: 30, // minutes
    bufferTime: 5, // minutes between visits
    prioritizeTravel: true, // minimize travel vs maximize utilization
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Generate week dates
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStartDate);
    date.setDate(date.getDate() + i);
    return date.toISOString().split('T')[0];
  });

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Fetch visits for the week
  const { data: weeklyVisits = [], isLoading: isLoadingVisits } = useQuery({
    queryKey: ['/api/visits-range', weekStartDate],
    queryFn: async () => {
      const endDate = new Date(weekStartDate);
      endDate.setDate(endDate.getDate() + 6);
      const response = await fetch(`/api/visits?start=${weekStartDate}&end=${endDate.toISOString().split('T')[0]}`);
      return response.json();
    },
    enabled: !!weekStartDate,
  });

  // Auto-schedule mutation for route optimization
  const autoScheduleMutation = useMutation({
    mutationFn: async (params: { date: string; settings: typeof optimizationSettings }) => {
      const response = await fetch('/api/auto-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!response.ok) throw new Error('Auto-scheduling failed');
      return response.json();
    },
    onSuccess: (result, variables) => {
      setWeeklySchedules(prev => ({
        ...prev,
        [variables.date]: result
      }));
      toast({
        title: "Auto-Scheduling Complete",
        description: `Optimized ${result.metrics.totalAssignedVisits} visits with ${result.metrics.routeEfficiency}% route efficiency`,
      });
    },
    onError: (error) => {
      toast({
        title: "Auto-Scheduling Failed",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    },
  });

  // Manual visit assignment
  const assignVisitMutation = useMutation({
    mutationFn: async (params: { visitId: string; employeeName: string; date: string; insertionIndex: number }) => {
      // Calculate optimal insertion based on travel time and schedule gaps
      const daySchedule = weeklySchedules[params.date];
      if (!daySchedule) throw new Error('No schedule found for date');

      const employee = daySchedule.employees.find(e => e.employeeName === params.employeeName);
      if (!employee) throw new Error('Employee not found');

      const visit = daySchedule.unassignedVisits.find(v => v.id === params.visitId);
      if (!visit) throw new Error('Visit not found');

      // Calculate travel times and find best insertion point
      const newSchedule = await optimizeVisitInsertion(visit, employee, params.insertionIndex);
      return newSchedule;
    },
    onSuccess: (result, variables) => {
      setWeeklySchedules(prev => ({
        ...prev,
        [variables.date]: result
      }));
      toast({
        title: "Visit Assigned",
        description: `${variables.visitId} assigned to ${variables.employeeName}`,
      });
    },
  });

  // Initialize weekly schedules from data
  useEffect(() => {
    if (!data || !weeklyVisits.length) return;

    const schedules: Record<string, DaySchedule> = {};

    weekDates.forEach(date => {
      const dayVisits = weeklyVisits.filter((v: any) => v.date === date);
      const availableEmployees = data.employeesByDate?.[date]?.filter(emp => 
        ['Available', 'Partial Availability'].includes(emp.status)
      ) || [];

      // Transform to scheduling format
      const employees: EmployeeSchedule[] = availableEmployees.map(emp => {
        const empLocation = data.employeeLocations?.find(e => e.employeeName === emp.employeeName);
        const timeWindows = emp.timeWindows ? parseTimeWindows(emp.timeWindows) : [];

        return {
          employeeName: emp.employeeName,
          homeLat: empLocation?.homeLat ? Number(empLocation.homeLat) : 55.9533,
          homeLng: empLocation?.homeLng ? Number(empLocation.homeLng) : -3.1883,
          transportMode: empLocation?.transportMode?.toLowerCase().includes('car') ? 'car' : 'walking',
          timeWindows,
          contractedDailyHours: emp.contractedDailyHours,
          visits: [],
          totalTravelTime: 0,
          totalWorkTime: 0,
          utilizationPercent: 0,
          freeTimeSlots: timeWindows,
        };
      });

      // Transform visits
      const visits: Visit[] = dayVisits.map((v: any) => {
        const clientLocation = data.clientLocations?.find(c => c.clientName === v.clientName);

        // Safe time parsing with fallbacks
        const parseTime = (timeStr: string | undefined, defaultHour: number = 9): number => {
          if (!timeStr || typeof timeStr !== 'string') {
            return defaultHour * 60; // Default to specified hour
          }

          const parts = timeStr.split(':');
          if (parts.length !== 2) {
            return defaultHour * 60; // Default fallback
          }

          const hours = parseInt(parts[0]) || 0;
          const minutes = parseInt(parts[1]) || 0;
          return hours * 60 + minutes;
        };

        const startTime = parseTime(v.startTime, 9); // Default to 9:00
        const endTime = parseTime(v.endTime, 10); // Default to 10:00

        return {
          id: v.id || `${v.clientName}-${date}`,
          clientName: v.clientName,
          startTime,
          endTime,
          durationMinutes: v.durationMinutes || Math.max(60, endTime - startTime),
          priority: v.priority || 2,
          serviceType: v.serviceType || 'Personal Care',
          lat: clientLocation?.lat ? Number(clientLocation.lat) : undefined,
          lng: clientLocation?.lng ? Number(clientLocation.lng) : undefined,
        };
      });

      schedules[date] = {
        date,
        employees,
        unassignedVisits: visits,
        metrics: {
          totalAssignedVisits: 0,
          totalUnassignedVisits: visits.length,
          averageUtilization: 0,
          totalTravelTime: 0,
          routeEfficiency: 0,
        }
      };
    });

    setWeeklySchedules(schedules);
  }, [data, weeklyVisits, weekStartDate]);

  // Calculate optimal visit insertion
  const optimizeVisitInsertion = async (visit: Visit, employee: EmployeeSchedule, preferredIndex: number): Promise<DaySchedule> => {
    // This would implement the actual route optimization logic
    // For now, return a simplified version
    const updatedEmployee = { ...employee };

    // Calculate travel time from previous visit or home
    let travelTimeBefore = 0;
    if (preferredIndex === 0) {
      // Travel from home
      if (visit.lat && visit.lng) {
        travelTimeBefore = getTravelMinutes(
          { lat: employee.homeLat, lng: employee.homeLng },
          { lat: visit.lat, lng: visit.lng },
          employee.transportMode
        );
      }
    } else if (preferredIndex > 0 && employee.visits.length > 0) {
      const prevVisit = employee.visits[preferredIndex - 1];
      if (visit.lat && visit.lng && prevVisit.lat && prevVisit.lng) {
        travelTimeBefore = getTravelMinutes(
          { lat: prevVisit.lat, lng: prevVisit.lng },
          { lat: visit.lat, lng: visit.lng },
          employee.transportMode
        );
      }
    }

    // Calculate travel time to next visit
    let travelTimeAfter = 0;
    if (preferredIndex < employee.visits.length) {
      const nextVisit = employee.visits[preferredIndex];
      if (visit.lat && visit.lng && nextVisit.lat && nextVisit.lng) {
        travelTimeAfter = getTravelMinutes(
          { lat: visit.lat, lng: visit.lng },
          { lat: nextVisit.lat, lng: nextVisit.lng },
          employee.transportMode
        );
      }
    }

    // Create assigned visit
    const assignedVisit: AssignedVisit = {
      ...visit,
      employeeName: employee.employeeName,
      actualStartTime: visit.startTime,
      actualEndTime: visit.endTime,
      travelTimeBefore,
      travelTimeAfter,
      score: calculateVisitScore(visit, employee, travelTimeBefore, travelTimeAfter),
    };

    // Insert visit at preferred index
    updatedEmployee.visits.splice(preferredIndex, 0, assignedVisit);

    // Recalculate metrics
    updatedEmployee.totalTravelTime = updatedEmployee.visits.reduce(
      (sum, v) => sum + v.travelTimeBefore + v.travelTimeAfter, 0
    );
    updatedEmployee.totalWorkTime = updatedEmployee.visits.reduce(
      (sum, v) => sum + v.durationMinutes, 0
    );
    updatedEmployee.utilizationPercent = updatedEmployee.contractedDailyHours > 0 
      ? Math.round((updatedEmployee.totalWorkTime / 60) / updatedEmployee.contractedDailyHours * 100)
      : 0;

    // Return updated schedule (simplified)
    const currentSchedule = weeklySchedules[visit.id.split('-')[1]] || weeklySchedules[Object.keys(weeklySchedules)[0]];
    return {
      ...currentSchedule,
      employees: currentSchedule.employees.map(emp => 
        emp.employeeName === employee.employeeName ? updatedEmployee : emp
      ),
      unassignedVisits: currentSchedule.unassignedVisits.filter(v => v.id !== visit.id),
    };
  };

  // Calculate visit assignment score based on travel time and constraints
  const calculateVisitScore = (visit: Visit, employee: EmployeeSchedule, travelBefore: number, travelAfter: number): number => {
    let score = 1.0;

    // Travel time penalty (prefer shorter travel)
    const totalTravel = travelBefore + travelAfter;
    if (totalTravel > optimizationSettings.maxTravelPerVisit) {
      score *= 0.5; // Heavy penalty for excessive travel
    } else {
      score *= (1 - totalTravel / (optimizationSettings.maxTravelPerVisit * 2));
    }

    // Time window compatibility
    const fitsInWindow = employee.timeWindows.some(window => 
      visit.startTime >= window.start && visit.endTime <= window.end
    );
    if (!fitsInWindow) {
      score *= 0.1; // Heavy penalty for time conflicts
    }

    // Priority bonus
    score *= (4 - visit.priority) / 3; // Higher priority = higher score

    return Math.max(0, Math.min(1, score));
  };

  const handleAutoScheduleDay = (date: string) => {
    autoScheduleMutation.mutate({
      date,
      settings: optimizationSettings
    });
  };

  const handleAutoScheduleWeek = () => {
    weekDates.forEach(date => {
      setTimeout(() => handleAutoScheduleDay(date), weekDates.indexOf(date) * 1000);
    });
  };

  const navigateWeek = (direction: 'prev' | 'next') => {
    const currentDate = new Date(weekStartDate);
    currentDate.setDate(currentDate.getDate() + (direction === 'next' ? 7 : -7));
    setWeekStartDate(currentDate.toISOString().split('T')[0]);
  };

  // Get all employees across the week for selection
  const allEmployees = React.useMemo(() => {
    const employeeSet = new Set<string>();
    Object.values(weeklySchedules).forEach(day => {
      day.employees.forEach(emp => employeeSet.add(emp.employeeName));
    });
    return Array.from(employeeSet).sort();
  }, [weeklySchedules]);

  // Calculate week summary metrics
  const weekSummary = React.useMemo(() => {
    const days = Object.values(weeklySchedules);
    const totalAssigned = days.reduce((sum, day) => sum + day.metrics.totalAssignedVisits, 0);
    const totalUnassigned = days.reduce((sum, day) => sum + day.metrics.totalUnassignedVisits, 0);
    const avgUtilization = days.length > 0 
      ? Math.round(days.reduce((sum, day) => sum + day.metrics.averageUtilization, 0) / days.length)
      : 0;
    const totalTravelTime = days.reduce((sum, day) => sum + day.metrics.totalTravelTime, 0);
    const avgRouteEfficiency = days.length > 0
      ? Math.round(days.reduce((sum, day) => sum + day.metrics.routeEfficiency, 0) / days.length)
      : 0;

    return {
      totalAssigned,
      totalUnassigned,
      avgUtilization,
      totalTravelTime: Math.round(totalTravelTime),
      avgRouteEfficiency,
      assignmentRate: totalAssigned + totalUnassigned > 0 
        ? Math.round((totalAssigned / (totalAssigned + totalUnassigned)) * 100)
        : 0,
    };
  }, [weeklySchedules]);

  if (isLoadingVisits) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-muted-foreground">Loading weekly visits...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertCircle className="h-8 w-8 text-orange-500 mx-auto mb-2" />
          <p className="text-orange-600 font-medium">No processed data available</p>
          <p className="text-sm text-muted-foreground mt-1">
            Please process files first to enable weekly scheduling
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="weekly-scheduling-tab">
      {/* Header with Controls */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Route className="h-5 w-5" />
              <span className="bg-gradient-to-r from-emerald-600 to-blue-600 bg-clip-text text-transparent">
                Weekly Best Matches Scheduling
              </span>
              <p className="text-sm text-gray-600 dark:text-gray-300 font-normal mt-1">
                Future scheduling using the proven best matches algorithm from the scheduling tab
              </p>
            </CardTitle>

            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => navigateWeek('prev')}>
                ← Previous Week
              </Button>

              <Input
                type="date"
                value={weekStartDate}
                onChange={(e) => setWeekStartDate(e.target.value)}
                className="w-40"
              />

              <Button variant="outline" onClick={() => navigateWeek('next')}>
                Next Week →
              </Button>

              <Separator orientation="vertical" className="h-6" />

              <Button
                onClick={handleAutoScheduleWeek}
                disabled={autoScheduleMutation.isPending}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700"
              >
                {autoScheduleMutation.isPending ? (
                  <RotateCcw className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                Auto-Schedule Week
              </Button>
            </div>
          </div>
        </CardHeader>

        {/* Optimization Settings */}
        <CardContent>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="text-sm font-medium">Max Travel per Visit (min)</label>
              <Input
                type="number"
                value={optimizationSettings.maxTravelPerVisit}
                onChange={(e) => setOptimizationSettings(prev => ({
                  ...prev,
                  maxTravelPerVisit: parseInt(e.target.value) || 30
                }))}
                min="10"
                max="60"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Buffer Time (min)</label>
              <Input
                type="number"
                value={optimizationSettings.bufferTime}
                onChange={(e) => setOptimizationSettings(prev => ({
                  ...prev,
                  bufferTime: parseInt(e.target.value) || 5
                }))}
                min="0"
                max="30"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={optimizationSettings.prioritizeTravel}
                  onChange={(e) => setOptimizationSettings(prev => ({
                    ...prev,
                    prioritizeTravel: e.target.checked
                  }))}
                />
                Prioritize Travel Efficiency
              </label>
            </div>
          </div>

          {weekSummary && (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{weekSummary.totalAssigned}</div>
                <div className="text-sm text-muted-foreground">Assigned</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">{weekSummary.totalUnassigned}</div>
                <div className="text-sm text-muted-foreground">Unassigned</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{weekSummary.assignmentRate}%</div>
                <div className="text-sm text-muted-foreground">Assignment Rate</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">{weekSummary.avgUtilization}%</div>
                <div className="text-sm text-muted-foreground">Avg Utilization</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600">{Math.round(weekSummary.totalTravelTime / 60)}h</div>
                <div className="text-sm text-muted-foreground">Total Travel</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-teal-600">{weekSummary.avgRouteEfficiency}%</div>
                <div className="text-sm text-muted-foreground">Route Efficiency</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="grid" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="grid">Week Grid View</TabsTrigger>
          <TabsTrigger value="employee">Employee View</TabsTrigger>
          <TabsTrigger value="unassigned">Unassigned Visits</TabsTrigger>
        </TabsList>

        {/* Grid View - Shows all employees across all days */}
        <TabsContent value="grid">
          <Card>
            <CardHeader>
              <CardTitle>Weekly Schedule Grid - Route Optimized</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <div className="grid grid-cols-8 gap-2 min-w-max">
                  {/* Header row */}
                  <div className="font-semibold p-2">Employee</div>
                  {weekDates.map((date, index) => (
                    <div key={date} className="font-semibold p-2 text-center">
                      <div>{dayNames[index]}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(date).getDate()}/{new Date(date).getMonth() + 1}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAutoScheduleDay(date)}
                        className="mt-1 text-xs h-6"
                        disabled={autoScheduleMutation.isPending}
                      >
                        <Zap className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}

                  {/* Employee rows */}
                  {allEmployees.map(employeeName => {
                    const employeeInfo = data?.employeeLocations?.find(e => e.employeeName === employeeName);
                    const transportMode = employeeInfo?.transportMode?.toLowerCase().includes('car') ? 'car' : 'walking';

                    return (
                      <React.Fragment key={employeeName}>
                        <div className="p-2 border-r">
                          <div className="flex items-center gap-2">
                            <Badge className={getGenderColorClass('')}>
                              {employeeName.split(' ')[0]}
                            </Badge>
                            {transportMode === 'car' ? (
                              <Car className="h-4 w-4" />
                            ) : (
                              <User className="h-4 w-4" />
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 truncate">
                            {employeeName}
                          </div>
                        </div>

                        {weekDates.map(date => {
                          const daySchedule = weeklySchedules[date];
                          const employee = daySchedule?.employees.find(e => e.employeeName === employeeName);

                          return (
                            <div key={date} className="p-2 border min-h-[120px]">
                              {employee ? (
                                <div className="space-y-1">
                                  <div className="text-xs font-medium flex items-center justify-between">
                                    <span>{employee.visits.length} visits</span>
                                    <span className="text-blue-600">{employee.utilizationPercent}%</span>
                                  </div>

                                  {employee.visits.map((visit, idx) => (
                                    <div key={idx} className="text-xs p-1 bg-green-50 rounded border-l-2 border-green-500">
                                      <div className="font-medium truncate">{visit.clientName}</div>
                                      <div className="text-muted-foreground">
                                        {minutesToTime(visit.actualStartTime)}
                                        {visit.travelTimeBefore > 0 && (
                                          <span className="text-orange-600 ml-1">
                                            +{visit.travelTimeBefore}m
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-1 mt-1">
                                        <Badge variant="outline" className="text-xs h-4">
                                          {Math.round(visit.score * 100)}%
                                        </Badge>
                                        {visit.travelTimeBefore > optimizationSettings.maxTravelPerVisit && (
                                          <AlertCircle className="h-3 w-3 text-red-500" />
                                        )}
                                      </div>
                                    </div>
                                  ))}

                                  {employee.totalTravelTime > 0 && (
                                    <div className="text-xs text-orange-600 mt-1">
                                      Travel: {employee.totalTravelTime}m
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="text-xs text-muted-foreground text-center mt-8">
                                  Not available
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Employee View */}
        <TabsContent value="employee">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            {/* Employee Selector */}
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Select Employee
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  <div className="space-y-2">
                    {allEmployees.map(employeeName => {
                      const employeeInfo = data?.employeeLocations?.find(e => e.employeeName === employeeName);
                      const transportMode = employeeInfo?.transportMode?.toLowerCase().includes('car') ? 'car' : 'walking';

                      // Calculate weekly stats
                      const weeklyVisits = weekDates.reduce((total, date) => {
                        const daySchedule = weeklySchedules[date];
                        const employee = daySchedule?.employees.find(e => e.employeeName === employeeName);
                        return total + (employee?.visits.length || 0);
                      }, 0);

                      return (
                        <Button
                          key={employeeName}
                          variant={selectedEmployeeName === employeeName ? "default" : "outline"}
                          className="w-full justify-start"
                          onClick={() => setSelectedEmployeeName(employeeName)}
                        >
                          <div className="flex items-center gap-2 w-full">
                            <Badge className={getGenderColorClass('')}>
                              {employeeName.split(' ')[0]}
                            </Badge>
                            {transportMode === 'car' ? (
                              <Car className="h-4 w-4" />
                            ) : (
                              <User className="h-4 w-4" />
                            )}
                            <div className="flex-1 text-left">
                              <div className="text-sm truncate">{employeeName}</div>
                              <div className="text-xs text-muted-foreground">
                                {weeklyVisits} visits
                              </div>
                            </div>
                          </div>
                        </Button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Employee Weekly Detail */}
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>
                  {selectedEmployeeName ? `${selectedEmployeeName} - Weekly Routes` : 'Select an employee'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {selectedEmployeeName ? (
                  <div className="space-y-4">
                    {weekDates.map((date, index) => {
                      const daySchedule = weeklySchedules[date];
                      const employee = daySchedule?.employees.find(e => e.employeeName === selectedEmployeeName);

                      return (
                        <Card key={date} className="border-l-4 border-l-blue-500">
                          <CardHeader className="pb-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <h3 className="font-semibold">{dayNames[index]}</h3>
                                <Badge variant="outline">
                                  {new Date(date).toLocaleDateString()}
                                </Badge>
                              </div>

                              {employee && (
                                <div className="flex items-center gap-4 text-sm">
                                  <span className="flex items-center gap-1">
                                    <CheckCircle className="h-4 w-4 text-green-600" />
                                    {employee.visits.length} visits
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <Route className="h-4 w-4 text-blue-600" />
                                    {employee.totalTravelTime}m travel
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <TrendingUp className="h-4 w-4 text-purple-600" />
                                    {employee.utilizationPercent}% util
                                  </span>
                                </div>
                              )}
                            </div>
                          </CardHeader>

                          <CardContent>
                            {employee && employee.visits.length > 0 ? (
                              <div className="space-y-3">
                                {/* Route visualization */}
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <MapPin className="h-4 w-4" />
                                  <span>Start: Home</span>
                                  {employee.visits.map((visit, idx) => (
                                    <React.Fragment key={idx}>
                                      <span>→ {visit.travelTimeBefore}m →</span>
                                      <span className="font-medium text-foreground">{visit.clientName}</span>
                                    </React.Fragment>
                                  ))}
                                  <span>→ Home</span>
                                </div>

                                {employee.visits.map((visit, idx) => (
                                  <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                    <div className="flex-1">
                                      <div className="font-medium">{visit.clientName}</div>
                                      <div className="text-sm text-muted-foreground">
                                        {visit.serviceType}
                                      </div>
                                    </div>

                                    <div className="text-right">
                                      <div className="text-sm font-medium">
                                        {minutesToTime(visit.actualStartTime)} - {minutesToTime(visit.actualEndTime)}
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        {visit.durationMinutes}m visit
                                        {visit.travelTimeBefore > 0 && (
                                          <span className="text-orange-600"> • {visit.travelTimeBefore}m travel</span>
                                        )}
                                      </div>
                                    </div>

                                    <Badge 
                                      variant="outline"
                                      className={visit.score > 0.7 ? "border-green-500 text-green-700" : 
                                               visit.score > 0.4 ? "border-yellow-500 text-yellow-700" : 
                                               "border-red-500 text-red-700"}
                                    >
                                      {Math.round(visit.score * 100)}%
                                    </Badge>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-center py-8 text-muted-foreground">
                                <AlertCircle className="h-8 w-8 mx-auto mb-2" />
                                No visits scheduled for this day
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Users className="h-12 w-12 mx-auto mb-4" />
                    <p>Select an employee to view their weekly route optimization</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Unassigned Visits */}
        <TabsContent value="unassigned">
          <Card>
            <CardHeader>
              <CardTitle>Unassigned Visits - Manual Assignment</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {weekDates.map(date => {
                  const daySchedule = weeklySchedules[date];
                  const unassignedVisits = daySchedule?.unassignedVisits || [];

                  if (unassignedVisits.length === 0) return null;

                  return (
                    <Card key={date}>
                      <CardHeader>
                        <CardTitle className="text-lg">
                          {dayNames[weekDates.indexOf(date)]} - {new Date(date).toLocaleDateString()}
                          <Badge variant="outline" className="ml-2">
                            {unassignedVisits.length} unassigned
                          </Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {unassignedVisits.map(visit => (
                            <Card key={visit.id} className="border-orange-200">
                              <CardContent className="p-4">
                                <div className="flex items-start justify-between mb-2">
                                  <div>
                                    <h4 className="font-medium">{visit.clientName}</h4>
                                    <p className="text-sm text-muted-foreground">{visit.serviceType}</p>
                                  </div>
                                  <Badge variant="outline">
                                    Priority {visit.priority}
                                  </Badge>
                                </div>

                                <div className="text-sm text-muted-foreground mb-3">
                                  <div className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {minutesToTime(visit.startTime)} - {minutesToTime(visit.endTime)}
                                  </div>
                                  <div className="flex items-center gap-1 mt-1">
                                    <MapPin className="h-3 w-3" />
                                    {visit.lat && visit.lng ? 'Located' : 'Location unknown'}
                                  </div>
                                </div>

                                {/* Show best employee matches */}
                                <div className="space-y-1">
                                  <div className="text-xs font-medium">Best matches:</div>
                                  {daySchedule?.employees.slice(0, 3).map(emp => {
                                    const travelTime = visit.lat && visit.lng ? getTravelMinutes(
                                      { lat: emp.homeLat, lng: emp.homeLng },
                                      { lat: visit.lat, lng: visit.lng },
                                      emp.transportMode
                                    ) : 0;

                                    return (
                                      <div key={emp.employeeName} className="flex items-center justify-between text-xs">
                                        <span className="truncate">{emp.employeeName}</span>
                                        <div className="flex items-center gap-1">
                                          <span className="text-muted-foreground">{travelTime}m</span>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => assignVisitMutation.mutate({
                                              visitId: visit.id,
                                              employeeName: emp.employeeName,
                                              date,
                                              insertionIndex: emp.visits.length
                                            })}
                                            className="h-6 px-2 text-xs"
                                          >
                                            <Plus className="h-3 w-3" />
                                          </Button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}