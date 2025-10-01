import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Zap, Loader2, Car, User, MapPin, Clock, Search } from "lucide-react";
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

  // Get all unique employees for the week
  const allEmployees = Object.values(data?.employeesByDate || {})
    .flat()
    .filter((emp, index, self) => 
      self.findIndex(e => e.employeeName === emp.employeeName) === index
    );

  // Filter employees by search term
  const filteredEmployees = allEmployees.filter(emp =>
    emp.employeeName.toLowerCase().includes(searchTerm.toLowerCase())
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

      {/* Employee Picker */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Select Employee
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
            <Select value={selectedEmployee || ''} onValueChange={setSelectedEmployee}>
              <SelectTrigger data-testid="select-employee">
                <SelectValue placeholder="Choose an employee to view their weekly run" />
              </SelectTrigger>
              <SelectContent>
                {filteredEmployees.map(emp => {
                  const location = locationsData?.employees.find(loc => loc.employeeName === emp.employeeName);
                  const transportIcon = location?.transportMode?.toLowerCase().includes('car') 
                    ? <Car className="h-3 w-3" /> 
                    : null;
                  
                  return (
                    <SelectItem key={emp.employeeName} value={emp.employeeName} data-testid={`select-employee-${emp.employeeName}`}>
                      <div className="flex items-center gap-2">
                        <span className={getGenderColorClass(emp.employeeName)}>{emp.employeeName}</span>
                        {transportIcon}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Weekly Run View */}
      {selectedEmployee && weeklySchedule && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Weekly Run: {selectedEmployee}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-2">
              {weekDates.map((date, index) => {
                const dayVisits = employeeWeeklyRun[index]?.visits || [];
                const dayName = dayNames[index];
                
                return (
                  <div key={date} className="space-y-2">
                    <div className="text-center">
                      <p className="font-semibold text-sm">{dayName}</p>
                      <p className="text-xs text-muted-foreground">{date.split('-').slice(1).join('/')}</p>
                      <Badge variant={dayVisits.length > 0 ? "default" : "outline"} className="mt-1">
                        {dayVisits.length} visits
                      </Badge>
                    </div>
                    <ScrollArea className="h-96">
                      <div className="space-y-2">
                        {dayVisits.map((visit, vIndex) => (
                          <Card 
                            key={vIndex} 
                            className="p-2 bg-white dark:bg-gray-800 border-l-4 border-l-blue-500"
                            data-testid={`card-visit-${date}-${vIndex}`}
                          >
                            <div className="space-y-1">
                              <p className="font-medium text-sm">{visit.clientName}</p>
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
                          </Card>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Unallocated Visits */}
      {weeklySchedule && weeklySchedule.unallocated.length > 0 && (
        <Card className="glass-card border-red-200 dark:border-red-800">
          <CardHeader>
            <CardTitle className="text-red-600">Unallocated Visits ({weeklySchedule.unallocated.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              <div className="space-y-2">
                {weeklySchedule.unallocated.map((visit, index) => (
                  <Card key={index} className="p-3 bg-red-50 dark:bg-red-950/20" data-testid={`card-unallocated-${index}`}>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <p className="font-medium">{visit.clientName}</p>
                        <Badge variant="destructive" className="text-xs">{visit.date}</Badge>
                      </div>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {visit.startTime} - {visit.endTime} ({visit.durationMinutes} min)
                      </div>
                      <p className="text-xs text-red-600 dark:text-red-400">Reason: {visit.reason}</p>
                    </div>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
