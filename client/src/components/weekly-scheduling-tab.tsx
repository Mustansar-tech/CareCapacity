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
import { getTopMatches, scoreVisitMatch } from "@/utils/scheduling-scoring";
import type { AssignedVisit, EmployeeRun } from "@/utils/scheduling-scoring";
import type { ProcessingResult } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

interface WeeklySchedulingTabProps {
  data: ProcessingResult | null;
  selectedDate?: string | null;
}

interface ClientVisit {
  clientName: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  address?: string;
  postcode?: string;
}

interface DaySchedule {
  date: string;
  employees: Array<{
    employeeName: string;
    visits: AssignedVisit[];
    totalTravelTime: number;
    totalWorkTime: number;
    utilizationPercent: number;
    availabilityWindows: string;
    contractedDailyHours: number;
  }>;
  unassignedVisits: ClientVisit[];
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
  const [assignedVisits, setAssignedVisits] = useState<Record<string, Record<string, AssignedVisit[]>>>({});

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Generate week dates
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStartDate);
    date.setDate(date.getDate() + i);
    return date.toISOString().split('T')[0];
  });

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Fetch visits for each day of the week
  const visitQueries = weekDates.map(date => 
    useQuery<ClientVisit[]>({
      queryKey: ['/api/visits', date],
      enabled: !!date,
    })
  );

  // Auto-schedule using the proven algorithm from simple scheduling tab
  const autoScheduleDay = (date: string) => {
    const employees = data?.employeesByDate?.[date] || [];
    const employeeSummary = data?.employeeSummaryByDate?.[date] || [];
    const visitQueryIndex = weekDates.indexOf(date);
    const visits = visitQueries[visitQueryIndex]?.data || [];

    if (!employees.length || !visits.length) {
      toast({
        title: "No Data Available",
        description: `No employees or visits found for ${date}`,
        variant: "destructive",
      });
      return;
    }

    // Get current assignments for this day
    const dayAssignments = assignedVisits[date] || {};

    // Use the same logic as simple scheduling tab
    let newAssignments: Record<string, AssignedVisit[]> = {};
    let totalAssigned = 0;

    for (const emp of employees.filter(e => e.status === 'Available' || e.status === 'Partial Available')) {
      const empSummary = employeeSummary.find(s => s.employeeName === emp.employeeName);
      const empLocation = data?.employeeLocations?.find(e => e.employeeName === emp.employeeName);

      if (!empLocation?.homeLat || !empLocation?.homeLng) {
        console.warn(`Missing location data for ${emp.employeeName}`);
        continue;
      }

      // Build employee run
      const employeeRun: EmployeeRun = {
        visits: dayAssignments[emp.employeeName] || [],
        homeLat: parseFloat(empLocation.homeLat),
        homeLng: parseFloat(empLocation.homeLng),
        mode: empLocation.transportMode?.toLowerCase().includes('car') ? 'car' : 'walking',
      };

      // Parse time windows
      const timeWindows = parseTimeWindows(emp.timeWindows);

      // Get unallocated visits for this employee
      const allAssignedVisitKeys = new Set(
        Object.values(dayAssignments).flat().map(v => `${v.clientName}-${v.start}-${v.end}`)
      );

      const unallocatedVisits = visits.filter(v => {
        const startMin = parseInt(v.startTime.split(':')[0]) * 60 + parseInt(v.startTime.split(':')[1]);
        const endMin = parseInt(v.endTime.split(':')[0]) * 60 + parseInt(v.endTime.split(':')[1]);
        return !allAssignedVisitKeys.has(`${v.clientName}-${startMin}-${endMin}`);
      });

      // Get top matches using the proven algorithm
      const topMatches = getTopMatches(
        unallocatedVisits.map(v => {
          const clientLocation = data?.clientLocations?.find(c => c.clientName === v.clientName);
          return {
            clientName: v.clientName,
            start: parseInt(v.startTime.split(':')[0]) * 60 + parseInt(v.startTime.split(':')[1]),
            end: parseInt(v.endTime.split(':')[0]) * 60 + parseInt(v.endTime.split(':')[1]),
            lat: clientLocation?.lat ? parseFloat(clientLocation.lat) : 55.9533,
            lng: clientLocation?.lng ? parseFloat(clientLocation.lng) : -3.1883,
          };
        }),
        employeeRun,
        timeWindows,
        3 // Auto-assign top 3 matches
      );

      // Assign the top matches
      const currentVisits = [...(dayAssignments[emp.employeeName] || [])];

      for (const match of topMatches.slice(0, 2)) { // Auto-assign top 2 to avoid over-scheduling
        const visit = match.visit;
        currentVisits.splice(match.insertionIndex || currentVisits.length, 0, visit);
        totalAssigned++;
      }

      newAssignments[emp.employeeName] = currentVisits;
    }

    // Update assignments
    setAssignedVisits(prev => ({
      ...prev,
      [date]: newAssignments
    }));

    toast({
      title: "Auto-Scheduling Complete",
      description: `Assigned ${totalAssigned} visits for ${date}`,
    });
  };

  const autoScheduleWeek = () => {
    weekDates.forEach((date, index) => {
      setTimeout(() => autoScheduleDay(date), index * 500);
    });
  };

  // Calculate day schedule from assignments
  const getDaySchedule = (date: string): DaySchedule => {
    const employees = data?.employeesByDate?.[date] || [];
    const employeeSummary = data?.employeeSummaryByDate?.[date] || [];
    const visitQueryIndex = weekDates.indexOf(date);
    const visits = visitQueries[visitQueryIndex]?.data || [];
    const dayAssignments = assignedVisits[date] || {};

    const employeeSchedules = employees
      .filter(emp => emp.status === 'Available' || emp.status === 'Partial Available')
      .map(emp => {
        const empSummary = employeeSummary.find(s => s.employeeName === emp.employeeName);
        const empLocation = data?.employeeLocations?.find(e => e.employeeName === emp.employeeName);
        const assignedEmpVisits = dayAssignments[emp.employeeName] || [];

        // Calculate metrics
        const totalWorkTime = assignedEmpVisits.reduce((sum, v) => sum + (v.end - v.start), 0);
        let totalTravelTime = 0;

        if (assignedEmpVisits.length > 0 && empLocation?.homeLat && empLocation?.homeLng) {
          const homeLoc = { lat: parseFloat(empLocation.homeLat), lng: parseFloat(empLocation.homeLng) };
          const mode = empLocation.transportMode?.toLowerCase().includes('car') ? 'car' : 'walking';

          // Travel from home to first visit
          if (assignedEmpVisits[0]) {
            totalTravelTime += getTravelMinutes(homeLoc, { lat: assignedEmpVisits[0].lat, lng: assignedEmpVisits[0].lng }, mode);
          }

          // Travel between visits
          for (let i = 1; i < assignedEmpVisits.length; i++) {
            const from = { lat: assignedEmpVisits[i-1].lat, lng: assignedEmpVisits[i-1].lng };
            const to = { lat: assignedEmpVisits[i].lat, lng: assignedEmpVisits[i].lng };
            totalTravelTime += getTravelMinutes(from, to, mode);
          }

          // Travel from last visit to home
          if (assignedEmpVisits.length > 0) {
            const lastVisit = assignedEmpVisits[assignedEmpVisits.length - 1];
            totalTravelTime += getTravelMinutes({ lat: lastVisit.lat, lng: lastVisit.lng }, homeLoc, mode);
          }
        }

        const utilizationPercent = emp.contractedDailyHours > 0 
          ? Math.round((totalWorkTime / 60) / emp.contractedDailyHours * 100)
          : 0;

        return {
          employeeName: emp.employeeName,
          visits: assignedEmpVisits,
          totalTravelTime,
          totalWorkTime,
          utilizationPercent,
          availabilityWindows: emp.timeWindows,
          contractedDailyHours: emp.contractedDailyHours,
        };
      });

    // Get unassigned visits
    const allAssignedVisitKeys = new Set(
      Object.values(dayAssignments).flat().map(v => `${v.clientName}-${v.start}-${v.end}`)
    );

    const unassignedVisits = visits.filter(v => {
      const startMin = parseInt(v.startTime.split(':')[0]) * 60 + parseInt(v.startTime.split(':')[1]);
      const endMin = parseInt(v.endTime.split(':')[0]) * 60 + parseInt(v.endTime.split(':')[1]);
      return !allAssignedVisitKeys.has(`${v.clientName}-${startMin}-${endMin}`);
    });

    const totalAssigned = employeeSchedules.reduce((sum, emp) => sum + emp.visits.length, 0);
    const avgUtilization = employeeSchedules.length > 0 
      ? Math.round(employeeSchedules.reduce((sum, emp) => sum + emp.utilizationPercent, 0) / employeeSchedules.length)
      : 0;
    const totalTravelTime = employeeSchedules.reduce((sum, emp) => sum + emp.totalTravelTime, 0);

    return {
      date,
      employees: employeeSchedules,
      unassignedVisits,
      metrics: {
        totalAssignedVisits: totalAssigned,
        totalUnassignedVisits: unassignedVisits.length,
        averageUtilization: avgUtilization,
        totalTravelTime,
        routeEfficiency: totalAssigned > 0 ? Math.round((totalAssigned / (totalAssigned + unassignedVisits.length)) * 100) : 0,
      }
    };
  };

  // Assign visit to employee
  const assignVisit = (clientName: string, startTime: string, endTime: string, employeeName: string, date: string) => {
    const visitQueryIndex = weekDates.indexOf(date);
    const visits = visitQueries[visitQueryIndex]?.data || [];

    const visit = visits.find(v => 
      v.clientName === clientName && v.startTime === startTime && v.endTime === endTime
    );

    if (!visit) return;

    const clientLocation = data?.clientLocations?.find(c => c.clientName === visit.clientName);
    const visitData: AssignedVisit = {
      clientName: visit.clientName,
      start: parseInt(visit.startTime.split(':')[0]) * 60 + parseInt(visit.startTime.split(':')[1]),
      end: parseInt(visit.endTime.split(':')[0]) * 60 + parseInt(visit.endTime.split(':')[1]),
      lat: clientLocation?.lat ? parseFloat(clientLocation.lat) : 55.9533,
      lng: clientLocation?.lng ? parseFloat(clientLocation.lng) : -3.1883,
    };

    setAssignedVisits(prev => ({
      ...prev,
      [date]: {
        ...prev[date],
        [employeeName]: [...(prev[date]?.[employeeName] || []), visitData]
      }
    }));

    toast({
      title: "Visit Assigned",
      description: `${visit.clientName} assigned to ${employeeName}`,
    });
  };

  // Remove visit from employee
  const removeVisit = (employeeName: string, visit: AssignedVisit, date: string) => {
    setAssignedVisits(prev => ({
      ...prev,
      [date]: {
        ...prev[date],
        [employeeName]: (prev[date]?.[employeeName] || []).filter(v => 
          !(v.clientName === visit.clientName && v.start === visit.start && v.end === visit.end)
        )
      }
    }));

    toast({
      title: "Visit Unassigned",
      description: `${visit.clientName} unassigned from ${employeeName}`,
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
    weekDates.forEach(date => {
      const employees = data?.employeesByDate?.[date] || [];
      employees.forEach(emp => {
        if (emp.status === 'Available' || emp.status === 'Partial Available') {
          employeeSet.add(emp.employeeName);
        }
      });
    });
    return Array.from(employeeSet).sort();
  }, [data, weekDates]);

  // Calculate week summary metrics
  const weekSummary = React.useMemo(() => {
    const daySchedules = weekDates.map(date => getDaySchedule(date));
    const totalAssigned = daySchedules.reduce((sum, day) => sum + day.metrics.totalAssignedVisits, 0);
    const totalUnassigned = daySchedules.reduce((sum, day) => sum + day.metrics.totalUnassignedVisits, 0);
    const avgUtilization = daySchedules.length > 0
      ? Math.round(daySchedules.reduce((sum, day) => sum + day.metrics.averageUtilization, 0) / daySchedules.length)
      : 0;
    const totalTravelTime = daySchedules.reduce((sum, day) => sum + day.metrics.totalTravelTime, 0);
    const avgRouteEfficiency = daySchedules.length > 0
      ? Math.round(daySchedules.reduce((sum, day) => sum + day.metrics.routeEfficiency, 0) / daySchedules.length)
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
  }, [weekDates, assignedVisits, data]);

  const isLoadingVisits = visitQueries.some(query => query.isLoading);

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
                onClick={autoScheduleWeek}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700"
              >
                <Zap className="h-4 w-4" />
                Auto-Schedule Week
              </Button>
            </div>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Future scheduling using the proven best matches algorithm from the scheduling tab
          </p>
        </CardHeader>

        {weekSummary && (
          <CardContent>
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
          </CardContent>
        )}
      </Card>

      <Tabs defaultValue="grid" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="grid">Week Grid View</TabsTrigger>
          <TabsTrigger value="employee">Employee View</TabsTrigger>
          <TabsTrigger value="unassigned">Unassigned Visits</TabsTrigger>
        </TabsList>

        {/* Grid View */}
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
                        onClick={() => autoScheduleDay(date)}
                        className="mt-1 text-xs h-6"
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
                          const daySchedule = getDaySchedule(date);
                          const employee = daySchedule.employees.find(e => e.employeeName === employeeName);
                          const assignedToEmployee = assignedVisits[date]?.[employeeName] || [];

                          return (
                            <div key={date} className="p-2 border min-h-[120px]">
                              {employee ? (
                                <div className="space-y-1">
                                  <div className="text-xs font-medium flex items-center justify-between">
                                    <span>{assignedToEmployee.length} visits</span>
                                    <span className="text-blue-600">
                                      {employee.utilizationPercent}%
                                    </span>
                                  </div>

                                  {assignedToEmployee.map((visit, idx) => (
                                    <div key={idx} className="text-xs p-1 bg-green-50 rounded border-l-2 border-green-500">
                                      <div className="font-medium truncate">{visit.clientName}</div>
                                      <div className="text-muted-foreground">
                                        {minutesToTime(visit.start)} - {minutesToTime(visit.end)}
                                      </div>
                                      <div className="flex items-center justify-between mt-1">
                                        <Badge variant="outline" className="text-xs h-4">
                                          {visit.end - visit.start}min
                                        </Badge>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => removeVisit(employeeName, visit, date)}
                                          className="h-4 px-1 text-xs"
                                        >
                                          <X className="h-3 w-3" />
                                        </Button>
                                      </div>
                                    </div>
                                  ))}
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

                      const weeklyVisits = weekDates.reduce((total, date) => {
                        return total + (assignedVisits[date]?.[employeeName]?.length || 0);
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
                      const daySchedule = getDaySchedule(date);
                      const employee = daySchedule.employees.find(e => e.employeeName === selectedEmployeeName);
                      const assignedVisits_day = assignedVisits[date]?.[selectedEmployeeName] || [];

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
                                    {assignedVisits_day.length} visits
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
                            {employee && assignedVisits_day.length > 0 ? (
                              <div className="space-y-3">
                                {assignedVisits_day.map((visit, idx) => (
                                  <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                    <div className="flex-1">
                                      <div className="font-medium">{visit.clientName}</div>
                                      <div className="text-sm text-muted-foreground">
                                        {minutesToTime(visit.start)} - {minutesToTime(visit.end)}
                                      </div>
                                    </div>

                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => removeVisit(selectedEmployeeName!, visit, date)}
                                      className="ml-2"
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
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
                  const daySchedule = getDaySchedule(date);
                  const unassignedVisits = daySchedule.unassignedVisits;

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
                          {unassignedVisits.map((visit, idx) => (
                            <Card key={idx} className="border-orange-200">
                              <CardContent className="p-4">
                                <div className="flex items-start justify-between mb-2">
                                  <div>
                                    <h4 className="font-medium">{visit.clientName}</h4>
                                    <p className="text-sm text-muted-foreground">
                                      {visit.startTime} - {visit.endTime}
                                    </p>
                                  </div>
                                </div>

                                {/* Show available employees for this day */}
                                <div className="space-y-1">
                                  <div className="text-xs font-medium">Available employees:</div>
                                  {daySchedule.employees.slice(0, 3).map(emp => (
                                    <div key={emp.employeeName} className="flex items-center justify-between text-xs">
                                      <span className="truncate">{emp.employeeName}</span>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => assignVisit(visit.clientName, visit.startTime, visit.endTime, emp.employeeName, date)}
                                        className="h-6 px-2 text-xs"
                                      >
                                        <Plus className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  ))}
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