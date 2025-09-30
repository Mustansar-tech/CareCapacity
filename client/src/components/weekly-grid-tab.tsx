
import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Car, User, MapPin, Clock, Calendar, Grid3X3, Target, RefreshCw } from "lucide-react";
import { getGenderColorClass } from "@/utils/gender-colors";
import { parseTimeWindows, getTravelMinutes, minutesToTime } from "@/utils/scheduling-utils";
import { getTopMatches, scoreVisitMatch } from "@/utils/scheduling-scoring";
import type { AssignedVisit, EmployeeRun } from "@/utils/scheduling-scoring";
import type { ProcessingResult } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

interface WeeklyGridTabProps {
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

interface DayAssignment {
  date: string;
  dayName: string;
  assignments: Array<{
    employeeName: string;
    visits: AssignedVisit[];
    totalHours: number;
    travelTime: number;
    efficiency: number;
  }>;
}

export function WeeklyGridTab({ data, selectedDate }: WeeklyGridTabProps) {
  const [weekStartDate, setWeekStartDate] = useState(selectedDate || new Date().toISOString().split('T')[0]);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [weeklyAssignments, setWeeklyAssignments] = useState<DayAssignment[]>([]);
  const [autoAssignInProgress, setAutoAssignInProgress] = useState(false);
  const { toast } = useToast();

  // Generate week dates from start date
  const weekDates = React.useMemo(() => {
    const start = new Date(weekStartDate);
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      dates.push({
        date: date.toISOString().split('T')[0],
        dayName: date.toLocaleDateString('en-US', { weekday: 'short' })
      });
    }
    return dates;
  }, [weekStartDate]);

  // Fetch visits for all days in the week
  const visitQueries = weekDates.map(({ date }) => 
    useQuery<ClientVisit[]>({
      queryKey: ['/api/visits', date],
      enabled: !!date,
    })
  );

  // Get all available employees for the week
  const allEmployees = React.useMemo(() => {
    const employeeSet = new Set<string>();
    weekDates.forEach(({ date }) => {
      const dayEmployees = data?.employeesByDate?.[date] || [];
      dayEmployees.forEach(emp => {
        if (emp.status === 'Available' || emp.status === 'Partial Availability') {
          employeeSet.add(emp.employeeName);
        }
      });
    });
    return Array.from(employeeSet).sort();
  }, [data, weekDates]);

  // Auto-assign best matches for the entire week
  const autoAssignWeek = React.useCallback(async () => {
    if (!data) return;
    
    setAutoAssignInProgress(true);
    const newAssignments: DayAssignment[] = [];

    try {
      for (let dayIndex = 0; dayIndex < weekDates.length; dayIndex++) {
        const { date, dayName } = weekDates[dayIndex];
        const visits = visitQueries[dayIndex]?.data || [];
        const employees = data.employeesByDate?.[date] || [];
        const employeeSummary = data.employeeSummaryByDate?.[date] || [];

        if (visits.length === 0) {
          newAssignments.push({
            date,
            dayName,
            assignments: []
          });
          continue;
        }

        // Get available employees for this day
        const availableEmployees = employees.filter(emp => 
          emp.status === 'Available' || emp.status === 'Partial Availability'
        );

        // Track assignments for this day
        const dayAssignments = new Map<string, AssignedVisit[]>();
        const assignedVisitKeys = new Set<string>();

        // Initialize employee assignments
        availableEmployees.forEach(emp => {
          dayAssignments.set(emp.employeeName, []);
        });

        // Convert visits to scoring format
        const scoringVisits = visits.map(v => {
          const clientData = data.clientLocations?.find(c => c.name === v.clientName);
          return {
            clientName: v.clientName,
            start: parseInt(v.startTime.split(':')[0]) * 60 + parseInt(v.startTime.split(':')[1]),
            end: parseInt(v.endTime.split(':')[0]) * 60 + parseInt(v.endTime.split(':')[1]),
            lat: clientData?.lat || 55.9533,
            lng: clientData?.lng || -3.1883,
          };
        });

        // Assign visits to employees using greedy algorithm
        const unassignedVisits = [...scoringVisits];

        while (unassignedVisits.length > 0 && dayAssignments.size > 0) {
          let bestMatch: {
            employeeName: string;
            visit: any;
            score: number;
            insertionIndex: number;
          } | null = null;

          // Find the best employee-visit match across all remaining combinations
          for (const emp of availableEmployees) {
            const empSummary = employeeSummary.find(s => s.employeeName === emp.employeeName);
            const currentAssignments = dayAssignments.get(emp.employeeName) || [];
            
            // Skip if employee is full
            if (currentAssignments.length >= 8) continue;

            // Build employee run
            const employeeRun: EmployeeRun = {
              visits: currentAssignments,
              homeLat: data.employeeLocations?.find(e => e.name === emp.employeeName)?.lat || 55.9533,
              homeLng: data.employeeLocations?.find(e => e.name === emp.employeeName)?.lng || -3.1883,
              mode: empSummary?.transportMode?.toLowerCase().includes('car') ? 'car' : 'walking',
            };

            const timeWindows = parseTimeWindows(emp.timeWindows);

            // Try each unassigned visit
            for (const visit of unassignedVisits) {
              const matchScore = scoreVisitMatch(visit, employeeRun, timeWindows);
              
              if (matchScore && matchScore.score > 0) {
                if (!bestMatch || matchScore.score > bestMatch.score) {
                  bestMatch = {
                    employeeName: emp.employeeName,
                    visit,
                    score: matchScore.score,
                    insertionIndex: matchScore.insertionIndex
                  };
                }
              }
            }
          }

          // Assign the best match
          if (bestMatch) {
            const currentAssignments = dayAssignments.get(bestMatch.employeeName) || [];
            const newAssignments = [
              ...currentAssignments.slice(0, bestMatch.insertionIndex),
              bestMatch.visit,
              ...currentAssignments.slice(bestMatch.insertionIndex)
            ];
            dayAssignments.set(bestMatch.employeeName, newAssignments);
            
            // Remove from unassigned
            const visitIndex = unassignedVisits.findIndex(v => 
              v.clientName === bestMatch!.visit.clientName && 
              v.start === bestMatch!.visit.start && 
              v.end === bestMatch!.visit.end
            );
            if (visitIndex >= 0) {
              unassignedVisits.splice(visitIndex, 1);
            }
          } else {
            // No feasible assignments left
            break;
          }
        }

        // Build final assignments with metrics
        const finalAssignments = Array.from(dayAssignments.entries())
          .filter(([, visits]) => visits.length > 0)
          .map(([employeeName, visits]) => {
            const totalMinutes = visits.reduce((sum, v) => sum + (v.end - v.start), 0);
            const totalHours = Math.round(totalMinutes / 60 * 100) / 100;
            
            // Calculate total travel time
            let totalTravel = 0;
            for (let i = 0; i < visits.length - 1; i++) {
              totalTravel += getTravelMinutes(
                { lat: visits[i].lat, lng: visits[i].lng },
                { lat: visits[i + 1].lat, lng: visits[i + 1].lng },
                'car'
              );
            }
            
            const efficiency = totalHours > 0 ? Math.round((totalHours / (totalHours + totalTravel / 60)) * 100) : 0;

            return {
              employeeName,
              visits,
              totalHours,
              travelTime: totalTravel,
              efficiency
            };
          })
          .sort((a, b) => b.totalHours - a.totalHours);

        newAssignments.push({
          date,
          dayName,
          assignments: finalAssignments
        });
      }

      setWeeklyAssignments(newAssignments);
      
      const totalVisits = newAssignments.reduce((sum, day) => 
        sum + day.assignments.reduce((daySum, emp) => daySum + emp.visits.length, 0), 0
      );
      
      toast({
        title: "Auto-Assignment Complete",
        description: `Assigned ${totalVisits} visits across the week using optimal matching.`
      });

    } catch (error) {
      console.error('Auto-assignment error:', error);
      toast({
        title: "Assignment Error",
        description: "Failed to auto-assign visits. Please try again.",
        variant: "destructive"
      });
    } finally {
      setAutoAssignInProgress(false);
    }
  }, [data, weekDates, visitQueries, toast]);

  // Auto-assign when data is loaded
  useEffect(() => {
    if (data && visitQueries.every(q => q.data !== undefined) && weeklyAssignments.length === 0) {
      autoAssignWeek();
    }
  }, [data, visitQueries, autoAssignWeek, weeklyAssignments.length]);

  return (
    <div className="space-y-4" data-testid="weekly-grid-tab">
      {/* Header Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Grid3X3 className="h-5 w-5" />
            Weekly Assignment Grid
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="text-sm font-medium">Week Starting</label>
              <Input
                type="date"
                value={weekStartDate}
                onChange={(e) => setWeekStartDate(e.target.value)}
                data-testid="input-week-start"
              />
            </div>
            <div className="flex-1">
              <label className="text-sm font-medium">Employee Focus</label>
              <Select value={selectedEmployee || "all"} onValueChange={(value) => setSelectedEmployee(value === "all" ? null : value)}>
                <SelectTrigger>
                  <SelectValue placeholder="All employees" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All employees</SelectItem>
                  {allEmployees.map(emp => (
                    <SelectItem key={emp} value={emp}>{emp}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button 
              onClick={autoAssignWeek} 
              disabled={autoAssignInProgress}
              className="bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-700 hover:to-emerald-700"
            >
              {autoAssignInProgress ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Assigning...
                </>
              ) : (
                <>
                  <Target className="h-4 w-4 mr-2" />
                  Auto-Assign Week
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Weekly Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-7 gap-4">
        {weeklyAssignments.map((day) => {
          const filteredAssignments = selectedEmployee 
            ? day.assignments.filter(a => a.employeeName === selectedEmployee)
            : day.assignments;

          return (
            <Card key={day.date} className="min-h-[400px]">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      {day.dayName}
                    </div>
                    <div className="text-xs text-muted-foreground font-normal">
                      {new Date(day.date).toLocaleDateString()}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {filteredAssignments.length} employees
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[320px]">
                  <div className="space-y-3">
                    {filteredAssignments.length > 0 ? (
                      filteredAssignments.map((assignment, idx) => {
                        const empSummary = data?.employeeSummaryByDate?.[day.date]?.find(
                          s => s.employeeName === assignment.employeeName
                        );
                        
                        return (
                          <Card key={idx} className="border-l-4 border-l-blue-500">
                            <CardContent className="p-3">
                              <div className="space-y-2">
                                {/* Employee Header */}
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Badge className={getGenderColorClass(empSummary?.gender || '')}>
                                      {assignment.employeeName.split(' ')[0]}
                                    </Badge>
                                    {empSummary?.transportMode?.toLowerCase().includes('car') ? (
                                      <Car className="h-3 w-3" />
                                    ) : (
                                      <User className="h-3 w-3" />
                                    )}
                                  </div>
                                  <Badge variant="secondary" className="text-xs">
                                    {assignment.efficiency}% eff
                                  </Badge>
                                </div>

                                {/* Summary Stats */}
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                  <div>
                                    <span className="text-muted-foreground">Hours:</span>
                                    <span className="ml-1 font-medium">{assignment.totalHours}h</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Travel:</span>
                                    <span className="ml-1 font-medium">{assignment.travelTime}m</span>
                                  </div>
                                </div>

                                {/* Visits */}
                                <div className="space-y-1">
                                  {assignment.visits.map((visit, visitIdx) => (
                                    <div key={visitIdx} className="p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs">
                                      <div className="font-medium truncate">{visit.clientName}</div>
                                      <div className="text-muted-foreground flex items-center gap-1">
                                        <Clock className="h-3 w-3" />
                                        {minutesToTime(visit.start)} - {minutesToTime(visit.end)}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <Target className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No assignments for this day</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Selected Employee Detail View */}
      {selectedEmployee && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              {selectedEmployee} - Weekly Schedule
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-7 gap-4">
              {weeklyAssignments.map((day) => {
                const empAssignment = day.assignments.find(a => a.employeeName === selectedEmployee);
                
                return (
                  <div key={day.date} className="space-y-2">
                    <h4 className="font-medium text-sm">{day.dayName}</h4>
                    {empAssignment ? (
                      <div className="space-y-1">
                        {empAssignment.visits.map((visit, idx) => (
                          <div key={idx} className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded text-xs">
                            <div className="font-medium truncate">{visit.clientName}</div>
                            <div className="text-muted-foreground">
                              {minutesToTime(visit.start)}-{minutesToTime(visit.end)}
                            </div>
                          </div>
                        ))}
                        <div className="text-xs text-muted-foreground pt-1 border-t">
                          {empAssignment.totalHours}h • {empAssignment.travelTime}m travel
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">No assignments</div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
