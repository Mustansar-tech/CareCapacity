
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
  RotateCcw
} from "lucide-react";
import { getGenderColorClass } from "@/utils/gender-colors";
import { minutesToTime } from "@/utils/scheduling-utils";
import type { ProcessingResult } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

interface WeeklySchedulingTabProps {
  data: ProcessingResult | null;
  selectedDate?: string | null;
}

interface ScheduledVisit {
  id: string;
  clientName: string;
  actualStartTime: number;
  actualEndTime: number;
  durationMinutes: number;
  serviceType: string;
  travelTimeBefore: number;
  travelTimeAfter: number;
  assignmentScore: number;
}

interface EmployeeWeeklySchedule {
  employeeName: string;
  visits: ScheduledVisit[];
  totalTravelTime: number;
  totalWorkTime: number;
  utilizationPercent: number;
  freeTimeSlots: Array<{ start: number; end: number }>;
}

interface DaySchedule {
  date: string;
  employees: EmployeeWeeklySchedule[];
  unassignedVisits: any[];
  metrics: {
    totalAssignedVisits: number;
    totalUnassignedVisits: number;
    averageUtilization: number;
    totalTravelTime: number;
  };
}

interface WeeklyData {
  [date: string]: DaySchedule;
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
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Generate week dates
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStartDate);
    date.setDate(date.getDate() + i);
    return date.toISOString().split('T')[0];
  });

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Fetch weekly schedule data
  const { data: weeklyData, isLoading, refetch } = useQuery<WeeklyData>({
    queryKey: ['/api/schedule/week', weekStartDate],
    enabled: !!weekStartDate,
    staleTime: 30000, // 30 seconds
  });

  // Auto-schedule mutation
  const scheduleWeekMutation = useMutation({
    mutationFn: async (startDate: string) => {
      const response = await fetch('/api/schedule/auto-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to auto-schedule week');
      }
      
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Auto-Scheduling Complete",
        description: "Weekly schedule has been automatically generated based on distance and time factors.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/schedule/week'] });
      refetch();
    },
    onError: (error) => {
      toast({
        title: "Auto-Scheduling Failed",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    },
  });

  // Get all employees across the week
  const allEmployees = React.useMemo(() => {
    if (!weeklyData) return [];
    
    const employeeSet = new Set<string>();
    Object.values(weeklyData).forEach(day => {
      day.employees.forEach(emp => employeeSet.add(emp.employeeName));
    });
    
    return Array.from(employeeSet).sort();
  }, [weeklyData]);

  // Calculate week summary metrics
  const weekSummary = React.useMemo(() => {
    if (!weeklyData) return null;
    
    const days = Object.values(weeklyData);
    const totalAssigned = days.reduce((sum, day) => sum + day.metrics.totalAssignedVisits, 0);
    const totalUnassigned = days.reduce((sum, day) => sum + day.metrics.totalUnassignedVisits, 0);
    const avgUtilization = days.length > 0 
      ? Math.round(days.reduce((sum, day) => sum + day.metrics.averageUtilization, 0) / days.length)
      : 0;
    const totalTravelTime = days.reduce((sum, day) => sum + day.metrics.totalTravelTime, 0);
    
    return {
      totalAssigned,
      totalUnassigned,
      avgUtilization,
      totalTravelTime: Math.round(totalTravelTime),
      assignmentRate: totalAssigned + totalUnassigned > 0 
        ? Math.round((totalAssigned / (totalAssigned + totalUnassigned)) * 100)
        : 0,
    };
  }, [weeklyData]);

  const handleAutoSchedule = () => {
    scheduleWeekMutation.mutate(weekStartDate);
  };

  const navigateWeek = (direction: 'prev' | 'next') => {
    const currentDate = new Date(weekStartDate);
    currentDate.setDate(currentDate.getDate() + (direction === 'next' ? 7 : -7));
    setWeekStartDate(currentDate.toISOString().split('T')[0]);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-muted-foreground">Loading weekly schedule...</p>
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
              <Calendar className="h-5 w-5" />
              Weekly Employee-Centered Scheduling
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
                onClick={handleAutoSchedule}
                disabled={scheduleWeekMutation.isPending}
                className="flex items-center gap-2"
              >
                {scheduleWeekMutation.isPending ? (
                  <RotateCcw className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                Auto-Schedule Week
              </Button>
            </div>
          </div>
        </CardHeader>
        
        {weekSummary && (
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{weekSummary.totalAssigned}</div>
                <div className="text-sm text-muted-foreground">Assigned Visits</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">{weekSummary.totalUnassigned}</div>
                <div className="text-sm text-muted-foreground">Unassigned Visits</div>
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
            </div>
          </CardContent>
        )}
      </Card>

      <Tabs defaultValue="grid" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="grid">Week Grid View</TabsTrigger>
          <TabsTrigger value="employee">Employee View</TabsTrigger>
        </TabsList>
        
        {/* Grid View - Shows all employees across all days */}
        <TabsContent value="grid">
          <Card>
            <CardHeader>
              <CardTitle>Weekly Schedule Grid</CardTitle>
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
                    </div>
                  ))}
                  
                  {/* Employee rows */}
                  {allEmployees.map(employeeName => {
                    // Get employee info from data for transport mode and gender
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
                          const dayData = weeklyData?.[date];
                          const employeeDay = dayData?.employees.find(e => e.employeeName === employeeName);
                          
                          return (
                            <div key={date} className="p-2 border min-h-[100px]">
                              {employeeDay ? (
                                <div className="space-y-1">
                                  <div className="text-xs font-medium">
                                    {employeeDay.visits.length} visits • {employeeDay.utilizationPercent}%
                                  </div>
                                  {employeeDay.visits.slice(0, 3).map((visit, idx) => (
                                    <div key={idx} className="text-xs p-1 bg-blue-50 rounded">
                                      <div className="font-medium truncate">{visit.clientName}</div>
                                      <div className="text-muted-foreground">
                                        {minutesToTime(visit.actualStartTime)} 
                                        {visit.travelTimeBefore > 0 && (
                                          <span className="text-orange-600"> (+{visit.travelTimeBefore}m)</span>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                  {employeeDay.visits.length > 3 && (
                                    <div className="text-xs text-muted-foreground">
                                      +{employeeDay.visits.length - 3} more...
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="text-xs text-muted-foreground text-center mt-8">
                                  No schedule
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
        
        {/* Employee View - Detailed view for selected employee */}
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
                      
                      // Calculate weekly stats for this employee
                      const weeklyVisits = weekDates.reduce((total, date) => {
                        const dayData = weeklyData?.[date];
                        const employeeDay = dayData?.employees.find(e => e.employeeName === employeeName);
                        return total + (employeeDay?.visits.length || 0);
                      }, 0);
                      
                      const avgUtilization = weekDates.reduce((total, date) => {
                        const dayData = weeklyData?.[date];
                        const employeeDay = dayData?.employees.find(e => e.employeeName === employeeName);
                        return total + (employeeDay?.utilizationPercent || 0);
                      }, 0) / 7;

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
                                {weeklyVisits} visits • {Math.round(avgUtilization)}%
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
                  {selectedEmployeeName ? `${selectedEmployeeName} - Weekly Schedule` : 'Select an employee'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {selectedEmployeeName ? (
                  <div className="space-y-4">
                    {weekDates.map((date, index) => {
                      const dayData = weeklyData?.[date];
                      const employeeDay = dayData?.employees.find(e => e.employeeName === selectedEmployeeName);
                      
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
                              
                              {employeeDay && (
                                <div className="flex items-center gap-4 text-sm">
                                  <span className="flex items-center gap-1">
                                    <CheckCircle className="h-4 w-4 text-green-600" />
                                    {employeeDay.visits.length} visits
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <TrendingUp className="h-4 w-4 text-blue-600" />
                                    {employeeDay.utilizationPercent}% utilization
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <Car className="h-4 w-4 text-orange-600" />
                                    {Math.round(employeeDay.totalTravelTime)}m travel
                                  </span>
                                </div>
                              )}
                            </div>
                          </CardHeader>
                          
                          <CardContent>
                            {employeeDay && employeeDay.visits.length > 0 ? (
                              <div className="space-y-3">
                                {employeeDay.visits.map((visit, idx) => (
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
                                      className={visit.assignmentScore > 0.7 ? "border-green-500 text-green-700" : 
                                               visit.assignmentScore > 0.4 ? "border-yellow-500 text-yellow-700" : 
                                               "border-red-500 text-red-700"}
                                    >
                                      {Math.round(visit.assignmentScore * 100)}%
                                    </Badge>
                                  </div>
                                ))}
                                
                                {/* Free time slots */}
                                {employeeDay.freeTimeSlots.length > 0 && (
                                  <div className="mt-4 pt-3 border-t">
                                    <h4 className="text-sm font-medium text-green-700 mb-2">Available Time Slots:</h4>
                                    <div className="flex flex-wrap gap-2">
                                      {employeeDay.freeTimeSlots.map((slot, idx) => (
                                        <Badge key={idx} variant="outline" className="border-green-500 text-green-700">
                                          {minutesToTime(slot.start)} - {minutesToTime(slot.end)}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}
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
                    <p>Select an employee from the left panel to view their weekly schedule</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
