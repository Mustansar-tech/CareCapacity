
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Calendar, Zap, Loader2, Car, User, MapPin, Clock, Search, Plus } from "lucide-react";
import { getGenderColorClass } from "@/utils/gender-colors";
import { minutesToTime } from "@/utils/scheduling-utils";
import type { ProcessingResult, ClientVisit, EmployeeLocation, ClientLocation } from "@shared/schema";
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
  score: number;
}

interface WeeklyScheduleData {
  assignments: Record<string, Record<string, AssignedVisit[]>>; // date -> employee -> visits
  unallocated: Array<ClientVisit & { reason: string }>;
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

  // Fetch visits for each day of the week
  const visitQueries = weekDates.map(date => 
    useQuery<ClientVisit[]>({
      queryKey: ['/api/visits', date],
      enabled: !!data && weekDates.length > 0,
    })
  );

  const isLoadingVisits = visitQueries.some(q => q.isLoading);
  const allWeekVisits = visitQueries.flatMap(q => q.data || []);

  // Get employees who actually have availability in the week (have time windows)
  const availableEmployees = Object.values(data?.employeesByDate || {})
    .flat()
    .filter(emp => emp.timeWindows && emp.timeWindows.trim() !== '') // Only employees with time windows
    .filter((emp, index, self) => 
      self.findIndex(e => e.employeeName === emp.employeeName) === index
    );

  // Get employees with assignments from the weekly schedule
  const employeesWithAssignments = weeklySchedule 
    ? Array.from(new Set(
        Object.values(weeklySchedule.assignments)
          .flatMap(dateAssignments => Object.keys(dateAssignments))
      )).sort()
    : [];

  // Filter employees by search term - prioritize those with assignments, but also show available employees
  const employeeNames = weeklySchedule 
    ? Array.from(new Set([...employeesWithAssignments, ...availableEmployees.map(e => e.employeeName)])).sort()
    : availableEmployees.map(e => e.employeeName);
  
  const filteredEmployees = employeeNames.filter(empName =>
    empName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Generate weekly schedule mutation
  const generateMutation = useMutation({
    mutationFn: async () => {
      console.log(`📅 Generating weekly schedule for ${weekDates.length} days with ${allWeekVisits.length} visits`);
      
      // Prepare employee data with locations
      const employeesWithLocations = Object.entries(data?.employeesByDate || {}).flatMap(([date, empList]) => 
        empList.map(emp => {
          const location = locationsData?.employees.find(loc => loc.employeeName === emp.employeeName);
          return {
            employeeName: emp.employeeName,
            date,
            timeWindows: emp.timeWindows,
            homeLat: location?.homeLat ? Number(location.homeLat) : undefined,
            homeLng: location?.homeLng ? Number(location.homeLng) : undefined,
            transportMode: location?.transportMode || undefined,
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

      console.log(`📊 Processing ${visitsWithLocations.length} visits with ${employeesWithLocations.length} employee-day combinations`);
      
      const result = generateWeeklySchedule(visitsWithLocations, employeesWithLocations, weekDates);
      
      console.log(`✅ Generated schedule: ${result.metrics.totalVisitsAssigned} assigned, ${result.metrics.totalVisitsUnallocated} unallocated`);
      
      return result;
    },
    onSuccess: async (result) => {
      setWeeklySchedule(result);
      
      // Save to database
      try {
        await apiRequest('POST', '/api/weekly-schedule/save', {
          weekStartDate: weekStart,
          weekEndDate: weekEnd,
          scheduleData: result.assignments,
          unallocatedVisits: result.unallocated,
          metrics: result.metrics,
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
  const { data: savedSchedule } = useQuery<any>({
    queryKey: ['/api/weekly-schedule/latest'],
    enabled: !!data,
  });

  useEffect(() => {
    if (savedSchedule?.scheduleData) {
      // Reconstruct weekly schedule from saved data
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
    }
  }, [savedSchedule]);

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
                      const location = locationsData?.employees.find(loc => loc.employeeName === empName);
                      const transportIcon = location?.transportMode?.toLowerCase().includes('car') 
                        ? <Car className="h-3 w-3" /> 
                        : null;
                      
                      // Get visit count across all days
                      const visitCount = weeklySchedule 
                        ? Object.values(weeklySchedule.assignments).reduce((sum, dateAssignments) => 
                            sum + (dateAssignments[empName]?.length || 0), 0)
                        : 0;
                      
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
                          <div className="flex items-center gap-2 flex-1">
                            <User className="h-4 w-4" />
                            <span className={`${getGenderColorClass(empName)} font-medium text-sm`}>{empName}</span>
                            {transportIcon}
                          </div>
                          {visitCount > 0 && (
                            <Badge variant={isSelected ? "default" : "secondary"} className="text-xs">
                              {visitCount}
                            </Badge>
                          )}
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
                      
                      // Only show days with availability (has time windows)
                      if (!timeWindows || timeWindows.trim() === '') {
                        return null;
                      }
                      
                      return (
                        <div key={date} className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/20 dark:to-purple-950/20 border-2 border-blue-200 dark:border-blue-800 rounded-lg p-4">
                          {/* Day Header */}
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <h3 className="text-lg font-semibold">{dayName}</h3>
                              <span className="text-sm text-muted-foreground">{date.split('-').slice(1).join('/')}</span>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Clock className="h-3 w-3" />
                                {timeWindows}
                              </div>
                            </div>
                            <Badge variant={dayVisits.length > 0 ? "default" : "outline"} className="text-sm">
                              {dayVisits.length} visits
                            </Badge>
                          </div>
                          
                          {/* Visits Grid - Wrapped Layout */}
                          {dayVisits.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                              {dayVisits.map((visit, vIndex) => (
                                <div 
                                  key={vIndex} 
                                  className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 hover:shadow-md transition-shadow"
                                  data-testid={`card-visit-${date}-${vIndex}`}
                                >
                                  <div className="space-y-1">
                                    <p className="font-medium text-sm truncate" title={visit.clientName}>
                                      {visit.clientName}
                                    </p>
                                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                      <Clock className="h-3 w-3" />
                                      {visit.startTime} - {visit.endTime}
                                    </div>
                                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                      <MapPin className="h-3 w-3" />
                                      Travel: {visit.travelTimeBefore}min
                                    </div>
                                    <Badge variant="secondary" className="text-xs">
                                      Score: {(visit.score * 100).toFixed(0)}%
                                    </Badge>
                                  </div>
                                </div>
                              ))}
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
                              <p className="text-xs text-red-600 dark:text-red-400 line-clamp-2" title={visit.reason}>
                                {visit.reason}
                              </p>
                              <Button 
                                size="sm" 
                                variant="outline" 
                                className="w-full h-6 text-xs border-blue-200 hover:bg-blue-50 dark:hover:bg-blue-950"
                              >
                                <Plus className="h-3 w-3 mr-1" />
                                Assign
                              </Button>
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
