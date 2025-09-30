
<old_str>import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Car, User, MapPin, Clock, Plus, X, Calendar } from "lucide-react";
import { getGenderColorClass } from "@/utils/gender-colors";
import { parseTimeWindows, getTravelMinutes, isInsertionFeasible, minutesToTime } from "@/utils/scheduling-utils";
import { getTopMatches, scoreVisitMatch, type AssignedVisit, type EmployeeRun } from "@/utils/scheduling-scoring";
import type { ProcessingResult } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

interface SimpleSchedulingTabProps {
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

export function SimpleSchedulingTab({ data, selectedDate }: SimpleSchedulingTabProps) {
  const [date, setDate] = useState(selectedDate || new Date().toISOString().split('T')[0]);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [assignedVisits, setAssignedVisits] = useState<Record<string, AssignedVisit[]>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();

  // Fetch client visits for the selected date
  const { data: visits = [] } = useQuery<ClientVisit[]>({
    queryKey: ['/api/visits', date],
    enabled: !!date,
  });

  // Get employees for the selected date
  const employees = data?.employeesByDate?.[date] || [];
  const employeeSummary = data?.employeeSummaryByDate?.[date] || [];

  // Filter employees by search term
  const filteredEmployees = employees.filter(emp =>
    emp.employeeName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Get selected employee details
  const selectedEmp = employees.find(e => e.employeeName === selectedEmployee);
  const selectedEmpSummary = employeeSummary.find(e => e.employeeName === selectedEmployee);
  
  // Build employee run for selected employee
  const employeeRun: EmployeeRun | null = selectedEmp && selectedEmployee ? {
    visits: assignedVisits[selectedEmployee] || [],
    homeLat: 55.9533, // Default Glasgow coordinates (would geocode from postcode in production)
    homeLng: -3.1883,
    mode: selectedEmpSummary?.transportMode?.toLowerCase().includes('car') ? 'car' : 'walking',
  } : null;

  // Parse time windows for selected employee
  const timeWindows = selectedEmp ? parseTimeWindows(selectedEmp.timeWindows) : [];

  // Get unallocated visits (not assigned to any employee)
  // Use unique key: clientName-startMinutes-endMinutes to support multiple daily visits per client
  const allAssignedVisitKeys = new Set(
    Object.values(assignedVisits).flat().map(v => `${v.clientName}-${v.start}-${v.end}`)
  );
  const unallocatedVisits = visits.filter(v => {
    const startMin = parseInt(v.startTime.split(':')[0]) * 60 + parseInt(v.startTime.split(':')[1]);
    const endMin = parseInt(v.endTime.split(':')[0]) * 60 + parseInt(v.endTime.split(':')[1]);
    return !allAssignedVisitKeys.has(`${v.clientName}-${startMin}-${endMin}`);
  });

  // Get top matches for selected employee
  const topMatches = employeeRun && unallocatedVisits.length > 0
    ? getTopMatches(
        unallocatedVisits.map(v => ({
          clientName: v.clientName,
          start: parseInt(v.startTime.split(':')[0]) * 60 + parseInt(v.startTime.split(':')[1]),
          end: parseInt(v.endTime.split(':')[0]) * 60 + parseInt(v.endTime.split(':')[1]),
          lat: 55.9533, // Would geocode from postcode in production
          lng: -3.1883,
        })),
        employeeRun,
        timeWindows,
        5
      )
    : [];

  // Assign visit to employee
  const assignVisit = (clientName: string, startTime: string, endTime: string) => {
    if (!selectedEmployee || !selectedEmp || !employeeRun) return;
    
    const visit = visits.find(v => 
      v.clientName === clientName && v.startTime === startTime && v.endTime === endTime
    );
    if (!visit) return;

    const visitData: AssignedVisit = {
      clientName: visit.clientName,
      start: parseInt(visit.startTime.split(':')[0]) * 60 + parseInt(visit.startTime.split(':')[1]),
      end: parseInt(visit.endTime.split(':')[0]) * 60 + parseInt(visit.endTime.split(':')[1]),
      lat: 55.9533,
      lng: -3.1883,
    };

    // Check feasibility using scoreVisitMatch (which includes feasibility validation)
    const matchScore = scoreVisitMatch(visitData, employeeRun, timeWindows);
    
    if (!matchScore) {
      toast({
        title: "Cannot Assign Visit",
        description: "This visit does not fit within the employee's availability windows or conflicts with travel time constraints.",
        variant: "destructive",
      });
      return;
    }

    // Insert at the correct position (matchScore.insertionIndex)
    const currentVisits = assignedVisits[selectedEmployee] || [];
    const newVisits = [
      ...currentVisits.slice(0, matchScore.insertionIndex),
      visitData,
      ...currentVisits.slice(matchScore.insertionIndex),
    ];

    setAssignedVisits(prev => ({
      ...prev,
      [selectedEmployee]: newVisits
    }));

    toast({
      title: "Visit Assigned",
      description: `${visit.clientName} assigned to ${selectedEmployee}`,
    });
  };

  // Remove visit from employee
  const removeVisit = (employeeName: string, visit: AssignedVisit) => {
    setAssignedVisits(prev => ({
      ...prev,
      [employeeName]: (prev[employeeName] || []).filter(v => 
        !(v.clientName === visit.clientName && v.start === visit.start && v.end === visit.end)
      )
    }));
  };

  return (
    <div className="space-y-4" data-testid="simple-scheduling-tab">
      {/* Date Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Scheduling for {date}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            data-testid="input-schedule-date"
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Employee Picker (Left Pane) */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Employee Picker</CardTitle>
            <Input
              placeholder="Search employees..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              data-testid="input-search-employee"
            />
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px]">
              <div className="space-y-2">
                {filteredEmployees.map((emp) => {
                  const summary = employeeSummary.find(s => s.employeeName === emp.employeeName);
                  const isAvailable = emp.status === 'Available' || emp.status === 'Partial Available';
                  
                  return (
                    <Button
                      key={emp.employeeName}
                      variant={selectedEmployee === emp.employeeName ? "default" : "outline"}
                      className="w-full justify-start"
                      onClick={() => setSelectedEmployee(emp.employeeName)}
                      disabled={!isAvailable}
                      data-testid={`button-select-employee-${emp.employeeName.replace(/\s+/g, '-')}`}
                    >
                      <div className="flex items-center gap-2 w-full">
                        <Badge className={getGenderColorClass(summary?.gender || '')}>
                          {emp.employeeName.split(' ')[0]}
                        </Badge>
                        {summary?.transportMode?.toLowerCase().includes('car') ? (
                          <Car className="h-4 w-4" />
                        ) : (
                          <User className="h-4 w-4" />
                        )}
                        <span className="text-xs truncate flex-1">{emp.employeeName}</span>
                      </div>
                    </Button>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Main Pane - Employee Run & Best Matches */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>
              {selectedEmployee ? `${selectedEmployee} - Daily Run` : 'Select an employee'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedEmp ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Employee Run (Left) */}
                <div className="space-y-3">
                  <h3 className="font-semibold">Assigned Visits</h3>
                  
                  {/* Availability Windows */}
                  <div className="text-sm text-muted-foreground">
                    <Clock className="h-4 w-4 inline mr-1" />
                    Available: {selectedEmp.timeWindows}
                  </div>

                  {/* Assigned Visits */}
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-2">
                      {selectedEmployee && (assignedVisits[selectedEmployee] || []).map((visit: AssignedVisit, idx: number) => (
                        <Card key={idx}>
                          <CardContent className="p-3">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-medium">{visit.clientName}</p>
                                <p className="text-sm text-muted-foreground">
                                  {minutesToTime(visit.start)} - {minutesToTime(visit.end)}
                                </p>
                                {visit.travelFromPrev && visit.travelFromPrev > 0 && (
                                  <p className="text-xs text-blue-600">
                                    Travel: {visit.travelFromPrev} min
                                  </p>
                                )}
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => removeVisit(selectedEmployee!, visit)}
                                data-testid={`button-remove-visit-${visit.clientName.replace(/\s+/g, '-')}`}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </ScrollArea>
                </div>

                {/* Best Matches (Right) */}
                <div className="space-y-3">
                  <h3 className="font-semibold">Best Matches (Top 5)</h3>
                  <ScrollArea className="h-[450px]">
                    <div className="space-y-2">
                      {topMatches.map((match, idx) => (
                        <Card key={idx}>
                          <CardContent className="p-3">
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <p className="font-medium">{match.visit.clientName}</p>
                                <p className="text-sm text-muted-foreground">
                                  {minutesToTime(match.visit.start)} - {minutesToTime(match.visit.end)}
                                </p>
                                <div className="flex gap-2 mt-2">
                                  <Badge variant="outline" className="text-xs">
                                    Score: {(match.score * 100).toFixed(0)}%
                                  </Badge>
                                  <Badge variant="outline" className="text-xs">
                                    Travel: +{match.travelFromPrev + match.travelToNext}m
                                  </Badge>
                                  <Badge variant="outline" className="text-xs">
                                    Gap: {match.gap}m
                                  </Badge>
                                </div>
                              </div>
                              <Button
                                size="sm"
                                onClick={() => assignVisit(
                                  match.visit.clientName,
                                  minutesToTime(match.visit.start),
                                  minutesToTime(match.visit.end)
                                )}
                                data-testid={`button-assign-visit-${match.visit.clientName.replace(/\s+/g, '-')}`}
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                      {topMatches.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-8">
                          No feasible matches found
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-8">
                Select an employee to view their run and best matches
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Unallocated Visits (Bottom) */}
      <Card>
        <CardHeader>
          <CardTitle>Unallocated Visits ({unallocatedVisits.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[200px]">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {unallocatedVisits.map((visit, idx) => (
                <Card key={idx}>
                  <CardContent className="p-3">
                    <p className="font-medium text-sm">{visit.clientName}</p>
                    <p className="text-xs text-muted-foreground">
                      {visit.startTime} - {visit.endTime}
                    </p>
                    {visit.address && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                        <MapPin className="h-3 w-3" />
                        {visit.postcode || 'N/A'}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}</old_str>
<new_str>import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Car, User, MapPin, Clock, Plus, X, Calendar, Users } from "lucide-react";
import { getGenderColorClass } from "@/utils/gender-colors";
import type { ProcessingResult } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

interface SimpleSchedulingTabProps {
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

interface AssignedVisit {
  clientName: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
}

export function SimpleSchedulingTab({ data, selectedDate }: SimpleSchedulingTabProps) {
  const [date, setDate] = useState(selectedDate || new Date().toISOString().split('T')[0]);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [assignedVisits, setAssignedVisits] = useState<Record<string, AssignedVisit[]>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();

  // Fetch client visits for the selected date
  const { data: visits = [], isLoading: isLoadingVisits, error: visitsError } = useQuery<ClientVisit[]>({
    queryKey: ['/api/visits', date],
    enabled: !!date,
  });

  // Get available dates
  const availableDates = data?.dailySummary?.map(day => day.date) || [];

  // Get employees for the selected date
  const employees = data?.employeesByDate?.[date] || [];
  const employeeSummary = data?.employeeSummaryByDate?.[date] || [];

  // Filter employees by search term and only show available ones
  const filteredEmployees = employees.filter(emp => {
    const isAvailable = ['Available', 'Partial Availability', 'Ad-hoc'].includes(emp.status);
    const matchesSearch = emp.employeeName.toLowerCase().includes(searchTerm.toLowerCase());
    return isAvailable && matchesSearch;
  });

  // Get selected employee details
  const selectedEmp = employees.find(e => e.employeeName === selectedEmployee);
  const selectedEmpSummary = employeeSummary.find(e => e.employeeName === selectedEmployee);

  // Get unallocated visits (not assigned to any employee)
  const allAssignedVisitKeys = new Set(
    Object.values(assignedVisits).flat().map(v => `${v.clientName}-${v.startTime}-${v.endTime}`)
  );
  const unallocatedVisits = visits.filter(v => 
    !allAssignedVisitKeys.has(`${v.clientName}-${v.startTime}-${v.endTime}`)
  );

  // Simple feasibility check for time windows
  const canAssignVisit = (visit: ClientVisit, employee: any): boolean => {
    if (!employee.timeWindows || employee.timeWindows === '-') return false;
    
    // Parse time windows (format: "09:00-12:00, 14:00-17:00")
    const windows = employee.timeWindows.split(',').map((w: string) => {
      const [start, end] = w.trim().split('-');
      return { start: start.trim(), end: end.trim() };
    });

    // Check if visit time fits in any window
    return windows.some((window: any) => {
      return visit.startTime >= window.start && visit.endTime <= window.end;
    });
  };

  // Get feasible visits for selected employee
  const feasibleVisits = selectedEmp 
    ? unallocatedVisits.filter(visit => canAssignVisit(visit, selectedEmp))
    : [];

  // Assign visit to employee
  const assignVisit = (visit: ClientVisit) => {
    if (!selectedEmployee || !selectedEmp) return;
    
    if (!canAssignVisit(visit, selectedEmp)) {
      toast({
        title: "Cannot Assign Visit",
        description: "This visit does not fit within the employee's availability windows.",
        variant: "destructive",
      });
      return;
    }

    const assignedVisit: AssignedVisit = {
      clientName: visit.clientName,
      startTime: visit.startTime,
      endTime: visit.endTime,
      durationMinutes: visit.durationMinutes,
    };

    setAssignedVisits(prev => ({
      ...prev,
      [selectedEmployee]: [...(prev[selectedEmployee] || []), assignedVisit]
    }));

    toast({
      title: "Visit Assigned",
      description: `${visit.clientName} assigned to ${selectedEmployee}`,
    });
  };

  // Remove visit from employee
  const removeVisit = (employeeName: string, visit: AssignedVisit) => {
    setAssignedVisits(prev => ({
      ...prev,
      [employeeName]: (prev[employeeName] || []).filter(v => 
        !(v.clientName === visit.clientName && v.startTime === visit.startTime && v.endTime === visit.endTime)
      )
    }));
  };

  // Calculate total assigned hours for employee
  const getTotalAssignedHours = (employeeName: string): number => {
    const visits = assignedVisits[employeeName] || [];
    return visits.reduce((total, visit) => total + (visit.durationMinutes / 60), 0);
  };

  return (
    <div className="space-y-4" data-testid="simple-scheduling-tab">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Simple Scheduling
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium">Select Date</label>
              <Select value={date} onValueChange={setDate}>
                <SelectTrigger>
                  <SelectValue placeholder="Select date" />
                </SelectTrigger>
                <SelectContent>
                  {availableDates.map((d) => (
                    <SelectItem key={d} value={d}>
                      {new Date(d).toLocaleDateString('en-GB', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <label className="text-sm font-medium">Search Employees</label>
              <Input
                placeholder="Search available employees..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                data-testid="input-search-employee"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Employee List */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Available Employees ({filteredEmployees.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px]">
              <div className="space-y-2">
                {filteredEmployees.map((emp) => {
                  const summary = employeeSummary.find(s => s.employeeName === emp.employeeName);
                  const assignedHours = getTotalAssignedHours(emp.employeeName);
                  
                  return (
                    <Button
                      key={emp.employeeName}
                      variant={selectedEmployee === emp.employeeName ? "default" : "outline"}
                      className="w-full justify-start p-3 h-auto"
                      onClick={() => setSelectedEmployee(emp.employeeName)}
                      data-testid={`button-select-employee-${emp.employeeName.replace(/\s+/g, '-')}`}
                    >
                      <div className="flex flex-col items-start gap-1 w-full">
                        <div className="flex items-center gap-2 w-full">
                          <Badge className={getGenderColorClass(summary?.gender || '')}>
                            {emp.employeeName.split(' ')[0]}
                          </Badge>
                          {summary?.transportMode?.toLowerCase().includes('car') ? (
                            <Car className="h-4 w-4" />
                          ) : (
                            <User className="h-4 w-4" />
                          )}
                          <span className="text-xs truncate flex-1">{emp.employeeName}</span>
                        </div>
                        <div className="text-xs text-muted-foreground w-full text-left">
                          {emp.timeWindows}
                        </div>
                        {assignedHours > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            {assignedHours.toFixed(1)}h assigned
                          </Badge>
                        )}
                      </div>
                    </Button>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Employee Details & Assignment */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>
              {selectedEmployee ? `${selectedEmployee} - Schedule` : 'Select an employee to start scheduling'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedEmp ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Assigned Visits */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">Assigned Visits</h3>
                    <Badge variant="outline">
                      {getTotalAssignedHours(selectedEmployee!).toFixed(1)}h / {selectedEmp.contractedDailyHours}h
                    </Badge>
                  </div>
                  
                  <div className="text-sm text-muted-foreground p-2 bg-muted rounded">
                    <Clock className="h-4 w-4 inline mr-1" />
                    Available: {selectedEmp.timeWindows}
                  </div>

                  <ScrollArea className="h-[400px]">
                    <div className="space-y-2">
                      {(assignedVisits[selectedEmployee!] || []).map((visit, idx) => (
                        <Card key={idx}>
                          <CardContent className="p-3">
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <p className="font-medium">{visit.clientName}</p>
                                <p className="text-sm text-muted-foreground">
                                  {visit.startTime} - {visit.endTime}
                                </p>
                                <Badge variant="outline" className="text-xs mt-1">
                                  {(visit.durationMinutes / 60).toFixed(1)}h
                                </Badge>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => removeVisit(selectedEmployee!, visit)}
                                data-testid={`button-remove-visit-${visit.clientName.replace(/\s+/g, '-')}`}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                      {(assignedVisits[selectedEmployee!] || []).length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-8">
                          No visits assigned yet
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                </div>

                {/* Available Visits */}
                <div className="space-y-3">
                  <h3 className="font-semibold">
                    Feasible Visits ({feasibleVisits.length})
                  </h3>
                  
                  {isLoadingVisits && (
                    <p className="text-sm text-muted-foreground">Loading visits...</p>
                  )}
                  
                  {visitsError && (
                    <p className="text-sm text-red-600">Error loading visits</p>
                  )}

                  <ScrollArea className="h-[450px]">
                    <div className="space-y-2">
                      {feasibleVisits.map((visit, idx) => (
                        <Card key={idx}>
                          <CardContent className="p-3">
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <p className="font-medium">{visit.clientName}</p>
                                <p className="text-sm text-muted-foreground">
                                  {visit.startTime} - {visit.endTime}
                                </p>
                                <div className="flex gap-2 mt-1">
                                  <Badge variant="outline" className="text-xs">
                                    {(visit.durationMinutes / 60).toFixed(1)}h
                                  </Badge>
                                  {visit.postcode && (
                                    <Badge variant="outline" className="text-xs">
                                      {visit.postcode}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              <Button
                                size="sm"
                                onClick={() => assignVisit(visit)}
                                data-testid={`button-assign-visit-${visit.clientName.replace(/\s+/g, '-')}`}
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                      {feasibleVisits.length === 0 && !isLoadingVisits && (
                        <p className="text-sm text-muted-foreground text-center py-8">
                          No feasible visits found for this employee's time windows
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-8">
                Select an employee to view their availability and assign visits
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Today's Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {Object.keys(assignedVisits).length}
              </div>
              <div className="text-sm text-muted-foreground">Employees with assignments</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {Object.values(assignedVisits).flat().length}
              </div>
              <div className="text-sm text-muted-foreground">Total visits assigned</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">
                {unallocatedVisits.length}
              </div>
              <div className="text-sm text-muted-foreground">Unallocated visits</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}</new_str>
