import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Zap, Loader2 } from "lucide-react";
import { getGenderColorClass } from "@/utils/gender-colors";
import { minutesToTime, getTravelMinutes, parseTimeWindows } from "@/utils/scheduling-utils";
import { scoreVisitMatch } from "@/utils/scheduling-scoring";
import type { ProcessingResult, ScheduledVisit } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getCanonicalWeekBoundaries } from "@shared/schema";

interface WeeklyPlanTabProps {
  data: ProcessingResult | null;
  selectedDate?: string | null;
}

interface EmployeeRun {
  employeeName: string;
  homeLat: number;
  homeLng: number;
  mode: 'car' | 'walking';
  timeWindows: Array<{ start: number; end: number }>;
}

interface AssignedVisit {
  clientName: string;
  start: number;
  end: number;
  lat: number;
  lng: number;
}

interface WeeklyAssignments {
  [date: string]: {
    [employeeName: string]: ScheduledVisit[];
  };
}

interface ClientVisit {
  clientName: string;
  startTime: string;
  endTime: string;
  lat?: number;
  lng?: number;
}

export function WeeklyPlanTab({ data, selectedDate }: WeeklyPlanTabProps) {
  const { toast } = useToast();
  
  // Get week boundaries
  const weekBoundaries = useMemo(() => {
    const date = selectedDate || new Date().toISOString().split('T')[0];
    return getCanonicalWeekBoundaries(date);
  }, [selectedDate]);

  const weekDates = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(weekBoundaries.weekStart);
      date.setDate(date.getDate() + i);
      return date.toISOString().split('T')[0];
    });
  }, [weekBoundaries]);

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [weeklyAssignments, setWeeklyAssignments] = useState<WeeklyAssignments>({});

  // Get all available employees across the week
  const availableEmployees = useMemo(() => {
    if (!data) return [];
    
    const employeeSet = new Set<string>();
    weekDates.forEach(date => {
      data.employeesByDate?.[date]?.forEach(emp => {
        if (['Available', 'Partial Availability'].includes(emp.status)) {
          employeeSet.add(emp.employeeName);
        }
      });
    });
    
    return Array.from(employeeSet).sort();
  }, [data, weekDates]);

  // Fetch real client visits from the API for the entire week
  const { data: weeklyVisitsData, isLoading: isLoadingVisits } = useQuery<Record<string, ClientVisit[]>>({
    queryKey: ['/api/visits', weekBoundaries.weekStart, weekBoundaries.weekEnd],
    queryFn: async () => {
      const visitsPerDay: Record<string, ClientVisit[]> = {};
      
      // Fetch visits for each day of the week
      await Promise.all(
        weekDates.map(async (date) => {
          try {
            const response = await fetch(`/api/visits/${date}`);
            if (response.ok) {
              const visits = await response.json();
              visitsPerDay[date] = visits;
            } else {
              visitsPerDay[date] = [];
            }
          } catch (error) {
            console.error(`Error fetching visits for ${date}:`, error);
            visitsPerDay[date] = [];
          }
        })
      );
      
      return visitsPerDay;
    },
    enabled: !!data && weekDates.length > 0,
  });

  // Flatten all week visits with date information
  const allWeekVisits = useMemo(() => {
    if (!weeklyVisitsData) return [];
    
    const visits: Array<ClientVisit & { date: string }> = [];
    
    Object.entries(weeklyVisitsData).forEach(([date, dayVisits]) => {
      dayVisits.forEach(visit => {
        visits.push({ ...visit, date });
      });
    });
    
    return visits;
  }, [weeklyVisitsData]);

  // Calculate unallocated visits
  const unallocatedVisits = useMemo(() => {
    const allocatedSet = new Set<string>();
    
    Object.entries(weeklyAssignments).forEach(([date, assignments]) => {
      Object.values(assignments).forEach(visits => {
        visits.forEach(visit => {
          allocatedSet.add(`${date}-${visit.clientName}-${visit.startTime}`);
        });
      });
    });
    
    return allWeekVisits.filter(visit => 
      !allocatedSet.has(`${visit.date}-${visit.clientName}-${visit.startTime}`)
    );
  }, [allWeekVisits, weeklyAssignments]);

  // Auto-generate schedule using same algorithm as Scheduling tab
  const generateScheduleMutation = useMutation({
    mutationFn: async () => {
      if (!data) throw new Error('No data available');
      if (!weeklyVisitsData) throw new Error('No visits data available');
      
      const newAssignments: WeeklyAssignments = {};
      let totalTravelTime = 0;
      let totalVisitsAssigned = 0;
      
      weekDates.forEach(date => {
        newAssignments[date] = {};
        
        const employeesOnDate = data.employeesByDate?.[date]?.filter(emp =>
          ['Available', 'Partial Availability'].includes(emp.status)
        ) || [];
        
        const visitsOnDate = weeklyVisitsData[date] || [];
        const remainingVisits = [...visitsOnDate];
        
        // Create employee runs
        employeesOnDate.forEach(emp => {
          const empLocation = data.employeeLocations?.find(e => e.employeeName === emp.employeeName);
          const timeWindows = parseTimeWindows(emp.timeWindows);
          
          newAssignments[date][emp.employeeName] = [];
          
          const employeeRun: EmployeeRun = {
            employeeName: emp.employeeName,
            homeLat: empLocation?.homeLat ?? 55.9533,
            homeLng: empLocation?.homeLng ?? -3.1883,
            mode: empLocation?.transportMode?.toLowerCase().includes('car') ? 'car' : 'walking',
            timeWindows,
          };
          
          // Assign visits one by one using scoring algorithm
          const currentVisits: AssignedVisit[] = [];
          
          for (const visit of [...remainingVisits]) {
            const [startHour, startMin] = visit.startTime.split(':').map(Number);
            const [endHour, endMin] = visit.endTime.split(':').map(Number);
            
            const visitData: AssignedVisit = {
              clientName: visit.clientName,
              start: startHour * 60 + startMin,
              end: endHour * 60 + endMin,
              lat: visit.lat ?? 55.9533,
              lng: visit.lng ?? -3.1883,
            };
            
            const scoreResult = scoreVisitMatch(visitData, employeeRun, timeWindows);
            
            if (scoreResult && scoreResult.score > 0.3) { // Threshold for assignment
              currentVisits.push(visitData);
              
              newAssignments[date][emp.employeeName].push({
                clientName: visit.clientName,
                startTime: visit.startTime,
                endTime: visit.endTime,
                travelTimeBefore: scoreResult.travelFromPrev || 0,
                score: scoreResult.score,
                lat: visit.lat,
                lng: visit.lng,
              });
              
              totalTravelTime += scoreResult.travelFromPrev || 0;
              totalVisitsAssigned++;
              
              // Remove from remaining visits
              const idx = remainingVisits.findIndex(v => 
                v.clientName === visit.clientName && v.startTime === visit.startTime
              );
              if (idx !== -1) remainingVisits.splice(idx, 1);
            }
          }
        });
      });
      
      // Calculate metrics
      const employeesUtilized = new Set<string>();
      Object.values(newAssignments).forEach(dayAssignments => {
        Object.entries(dayAssignments).forEach(([empName, visits]) => {
          if (visits.length > 0) employeesUtilized.add(empName);
        });
      });
      
      return {
        assignments: newAssignments,
        metrics: {
          totalVisitsAssigned,
          totalVisitsUnallocated: allWeekVisits.length - totalVisitsAssigned,
          averageTravelTimePerVisit: totalVisitsAssigned > 0 ? Math.round(totalTravelTime / totalVisitsAssigned) : 0,
          employeesUtilized: employeesUtilized.size,
        },
      };
    },
    onSuccess: async (result) => {
      setWeeklyAssignments(result.assignments);
      
      // Convert assignments to schema format
      const scheduleData = {
        employees: availableEmployees.map(empName => ({
          employeeName: empName,
          ...weekDates.reduce((acc, date) => ({
            ...acc,
            [date]: result.assignments[date]?.[empName] || []
          }), {})
        })),
        weekDates,
      };
      
      // Save to database
      try {
        await apiRequest('/api/weekly-schedule/save', {
          method: 'POST',
          body: JSON.stringify({
            weekStartDate: weekBoundaries.weekStart,
            weekEndDate: weekBoundaries.weekEnd,
            scheduleData,
            unallocatedVisits: unallocatedVisits.map(v => ({
              clientName: v.clientName,
              startTime: v.startTime,
              endTime: v.endTime,
            })),
            metrics: result.metrics,
          }),
        });
        
        queryClient.invalidateQueries({ queryKey: ['/api/weekly-schedule/latest'] });
        
        toast({
          title: "Schedule Generated & Saved",
          description: `Assigned ${result.metrics.totalVisitsAssigned} visits across ${result.metrics.employeesUtilized} employees`,
        });
      } catch (error) {
        console.error('Failed to save schedule:', error);
        toast({
          title: "Schedule Generated",
          description: `Assigned ${result.metrics.totalVisitsAssigned} visits (save failed)`,
          variant: "destructive",
        });
      }
    },
  });

  // Load latest schedule on mount
  const { data: savedSchedule } = useQuery({
    queryKey: ['/api/weekly-schedule/latest'],
    enabled: !!data,
  });

  useEffect(() => {
    if (savedSchedule?.scheduleData) {
      // Reconstruct weeklyAssignments from saved data
      const assignments: WeeklyAssignments = {};
      
      weekDates.forEach(date => {
        assignments[date] = {};
        savedSchedule.scheduleData.employees?.forEach((emp: any) => {
          if (emp[date]) {
            assignments[date][emp.employeeName] = emp[date];
          }
        });
      });
      
      setWeeklyAssignments(assignments);
    }
  }, [savedSchedule, weekDates]);

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

  return (
    <div className="space-y-4" data-testid="weekly-plan-tab">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                <span className="bg-gradient-to-r from-emerald-600 to-blue-600 bg-clip-text text-transparent">
                  Automatic Weekly Schedule
                </span>
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Week of {weekBoundaries.weekStart} to {weekBoundaries.weekEnd}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {allWeekVisits.length} real client visits loaded
              </p>
            </div>
            
            <Button
              onClick={() => generateScheduleMutation.mutate()}
              disabled={generateScheduleMutation.isPending || allWeekVisits.length === 0}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700"
              data-testid="button-generate-schedule"
            >
              <Zap className="h-4 w-4" />
              {generateScheduleMutation.isPending ? 'Generating...' : 'Generate Weekly Schedule'}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Employee Picker */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Select Employee</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedEmployee || undefined} onValueChange={setSelectedEmployee}>
            <SelectTrigger data-testid="select-employee">
              <SelectValue placeholder="Choose an employee to view their weekly schedule" />
            </SelectTrigger>
            <SelectContent>
              {availableEmployees.map(empName => {
                const empSummary = data.employeeSummaryByDate?.[weekDates[0]]?.find(e => e.employeeName === empName);
                const genderClass = getGenderColorClass(empSummary?.gender);
                
                return (
                  <SelectItem key={empName} value={empName} data-testid={`employee-option-${empName}`}>
                    <span className={genderClass}>{empName}</span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Employee Weekly Schedule */}
      {selectedEmployee && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Weekly Schedule for {selectedEmployee}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-2">
              {weekDates.map((date, idx) => {
                const assignments = weeklyAssignments[date]?.[selectedEmployee] || [];
                
                return (
                  <div key={date} className="border rounded-lg p-2">
                    <div className="text-center mb-2">
                      <div className="font-semibold text-sm">{dayNames[idx]}</div>
                      <div className="text-xs text-muted-foreground">{date.split('-')[2]}/{date.split('-')[1]}</div>
                    </div>
                    <Separator className="mb-2" />
                    <ScrollArea className="h-40">
                      {assignments.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center">No visits</p>
                      ) : (
                        <div className="space-y-1">
                          {assignments.map((visit, vidx) => (
                            <div key={vidx} className="text-xs p-1 bg-blue-50 dark:bg-blue-900/20 rounded">
                              <div className="font-medium truncate">{visit.clientName}</div>
                              <div className="text-muted-foreground">
                                {visit.startTime} - {visit.endTime}
                              </div>
                              {visit.travelTimeBefore > 0 && (
                                <div className="text-xs text-blue-600">
                                  🚗 {visit.travelTimeBefore}min travel
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Unallocated Visits */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Unallocated Visits</span>
            <Badge variant={unallocatedVisits.length > 0 ? "destructive" : "secondary"}>
              {unallocatedVisits.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-60">
            {unallocatedVisits.length === 0 ? (
              <p className="text-center text-muted-foreground">
                {allWeekVisits.length === 0 
                  ? 'No visits available for this week'
                  : 'All visits have been allocated'}
              </p>
            ) : (
              <div className="space-y-2">
                {unallocatedVisits.map((visit, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 border rounded-lg">
                    <div className="flex-1">
                      <div className="font-medium">{visit.clientName}</div>
                      <div className="text-sm text-muted-foreground">
                        {visit.date} • {visit.startTime} - {visit.endTime}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
