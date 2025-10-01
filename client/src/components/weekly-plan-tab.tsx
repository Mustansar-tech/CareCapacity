import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Clock, MapPin, Users, Zap, Car, User as UserIcon, X, Plus } from "lucide-react";
import { getGenderColorClass } from "@/utils/gender-colors";
import { minutesToTime, getTravelMinutes, parseTimeWindows, getTopMatches } from "@/utils/scheduling-utils";
import type { ProcessingResult, ScheduledVisit } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

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

interface DailyAssignment {
  [employeeName: string]: ScheduledVisit[];
}

interface WeeklyAssignments {
  [date: string]: DailyAssignment;
}

export function WeeklyPlanTab({ data, selectedDate }: WeeklyPlanTabProps) {
  const { toast } = useToast();
  
  // Initialize week start date (Monday of the selected week)
  const [weekStartDate] = useState(() => {
    const date = selectedDate ? new Date(selectedDate) : new Date();
    const monday = new Date(date);
    monday.setDate(date.getDate() - date.getDay() + (date.getDay() === 0 ? -6 : 1));
    return monday.toISOString().split('T')[0];
  });

  // Generate week dates
  const weekDates = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(weekStartDate);
      date.setDate(date.getDate() + i);
      return date.toISOString().split('T')[0];
    });
  }, [weekStartDate]);

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

  // Get all visits across the week (from employeeSummaryByDate)
  const allWeekVisits = useMemo(() => {
    if (!data) return [];
    
    const visits: Array<{ date: string; clientName: string; startTime: string; endTime: string }> = [];
    
    weekDates.forEach(date => {
      const employeesOnDate = data.employeesByDate?.[date] || [];
      employeesOnDate.forEach(emp => {
        // Parse timeWindows to extract scheduled visits (this is a simplified version)
        // In reality, you'd need actual visit data
        const timeWindows = parseTimeWindows(emp.timeWindows);
        // For now, we'll create placeholder visits based on scheduled hours
        if (emp.scheduledHours > 0) {
          timeWindows.forEach((window, idx) => {
            if (idx < emp.scheduledHours / 2) { // Rough estimate
              visits.push({
                date,
                clientName: `Client ${idx + 1} for ${emp.employeeName}`,
                startTime: minutesToTime(window.start),
                endTime: minutesToTime(Math.min(window.start + 60, window.end)),
              });
            }
          });
        }
      });
    });
    
    return visits;
  }, [data, weekDates]);

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

  // Auto-generate schedule mutation
  const generateScheduleMutation = useMutation({
    mutationFn: async () => {
      // Auto-assign visits to employees using best match algorithm
      const newAssignments: WeeklyAssignments = {};
      
      weekDates.forEach(date => {
        newAssignments[date] = {};
        
        const employeesOnDate = data?.employeesByDate?.[date]?.filter(emp =>
          ['Available', 'Partial Availability'].includes(emp.status)
        ) || [];
        
        const visitsOnDate = allWeekVisits.filter(v => v.date === date);
        
        // Create employee runs
        const employeeRuns = employeesOnDate.map(emp => {
          const empLocation = data?.employeeLocations?.find(e => e.employeeName === emp.employeeName);
          const timeWindows = parseTimeWindows(emp.timeWindows);
          
          return {
            employeeName: emp.employeeName,
            homeLat: empLocation?.homeLat ?? 55.9533,
            homeLng: empLocation?.homeLng ?? -3.1883,
            mode: empLocation?.transportMode?.toLowerCase().includes('car') ? 'car' : 'walking' as const,
            timeWindows,
          };
        });
        
        // Assign each visit to best employee
        visitsOnDate.forEach(visit => {
          const clientLocation = data?.clientLocations?.find(c => c.clientName === visit.clientName);
          const visitData: AssignedVisit = {
            clientName: visit.clientName,
            start: parseInt(visit.startTime.split(':')[0]) * 60 + parseInt(visit.startTime.split(':')[1]),
            end: parseInt(visit.endTime.split(':')[0]) * 60 + parseInt(visit.endTime.split(':')[1]),
            lat: clientLocation?.lat ?? 55.9533,
            lng: clientLocation?.lng ?? -3.1883,
          };
          
          // Find best employee for this visit
          let bestEmployee: EmployeeRun | null = null;
          let bestScore = -1;
          
          employeeRuns.forEach(emp => {
            const currentVisits = newAssignments[date][emp.employeeName] || [];
            const matches = getTopMatches([visitData], emp, parseTimeWindows(emp.timeWindows.map(w => `${minutesToTime(w.start)}-${minutesToTime(w.end)}`).join(', ')), 1);
            
            if (matches.length > 0 && matches[0].score > bestScore) {
              bestScore = matches[0].score;
              bestEmployee = emp;
            }
          });
          
          if (bestEmployee) {
            if (!newAssignments[date][bestEmployee.employeeName]) {
              newAssignments[date][bestEmployee.employeeName] = [];
            }
            
            newAssignments[date][bestEmployee.employeeName].push({
              clientName: visit.clientName,
              startTime: visit.startTime,
              endTime: visit.endTime,
              travelTimeBefore: 0,
              score: bestScore,
              lat: clientLocation?.lat,
              lng: clientLocation?.lng,
            });
          }
        });
      });
      
      return newAssignments;
    },
    onSuccess: async (newAssignments) => {
      setWeeklyAssignments(newAssignments);
      
      // Calculate metrics
      let totalAssigned = 0;
      let totalUnallocated = 0;
      
      Object.values(newAssignments).forEach(dayAssignments => {
        Object.values(dayAssignments).forEach(visits => {
          totalAssigned += visits.length;
        });
      });
      
      totalUnallocated = allWeekVisits.length - totalAssigned;
      
      // Save to database
      await apiRequest('/api/weekly-schedule/save', {
        method: 'POST',
        body: JSON.stringify({
          weekStartDate,
          weekEndDate: weekDates[6],
          scheduleData: { employees: [], weekDates }, // Simplified
          unallocatedVisits: [],
          metrics: {
            totalVisitsAssigned: totalAssigned,
            totalVisitsUnallocated: totalUnallocated,
            averageTravelTimePerVisit: 0,
            employeesUtilized: Object.keys(newAssignments).length,
          },
        }),
      });
      
      toast({
        title: "Schedule Generated",
        description: `Assigned ${totalAssigned} visits across the week`,
      });
    },
  });

  // Load latest schedule on mount
  useQuery({
    queryKey: ['/api/weekly-schedule/latest'],
    queryFn: async () => {
      const response = await fetch('/api/weekly-schedule/latest');
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error('Failed to load schedule');
      }
      return response.json();
    },
    onSuccess: (schedule) => {
      if (schedule?.scheduleData) {
        // Populate weeklyAssignments from loaded schedule
        // This is simplified - adjust based on your actual data structure
      }
    },
  });

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

  return (
    <div className="space-y-4" data-testid="weekly-plan-tab">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              <span className="bg-gradient-to-r from-emerald-600 to-blue-600 bg-clip-text text-transparent">
                Automatic Weekly Schedule
              </span>
            </CardTitle>
            
            <Button
              onClick={() => generateScheduleMutation.mutate()}
              disabled={generateScheduleMutation.isPending}
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
              {availableEmployees.map(empName => (
                <SelectItem key={empName} value={empName} data-testid={`employee-option-${empName}`}>
                  {empName}
                </SelectItem>
              ))}
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
                      <div className="text-xs text-muted-foreground">{date.split('-')[2]}</div>
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
              <p className="text-center text-muted-foreground">All visits have been allocated</p>
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
