import React, { useState } from "react";
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
import { getTopMatches, scoreVisitMatch } from "@/utils/scheduling-scoring";
import type { AssignedVisit, EmployeeRun } from "@/utils/scheduling-scoring";
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
  location?: { lat: string; lng: string }; // Added for potential location data
}

export function SimpleSchedulingTab({ data, selectedDate }: SimpleSchedulingTabProps) {
  const [date, setDate] = useState(selectedDate || new Date().toISOString().split('T')[0]);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [assignedVisits, setAssignedVisits] = useState<Record<string, AssignedVisit[]>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();

  // Fetch client visits for the selected date
  const { data: visits = [], refetch: refetchVisits } = useQuery<ClientVisit[]>({
    queryKey: ['/api/visits', date],
    enabled: !!date,
  });

  // Refetch visits when date changes
  React.useEffect(() => {
    if (date) {
      refetchVisits();
    }
  }, [date, refetchVisits]);

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
  const employeeRun: EmployeeRun | null = selectedEmp && selectedEmployee ? (() => {
    // Get employee location data from ProcessingResult
    const empLocation = data?.employeeLocations?.find(e => e.employeeName === selectedEmployee);
    const empLat = empLocation?.homeLat ?? 55.9533; // Default to Edinburgh if not geocoded
    const empLng = empLocation?.homeLng ?? -3.1883;

    // Determine transport mode from location data or employee summary
    const transportMode = empLocation?.transportMode?.toLowerCase().includes('car') ? 'car' : 
                         empLocation?.transportMode?.toLowerCase().includes('walk') ? 'walking' :
                         selectedEmpSummary?.transportMode?.toLowerCase().includes('car') ? 'car' : 
                         selectedEmpSummary?.transportMode?.toLowerCase().includes('walk') ? 'walking' : 'walking';

    if (empLocation?.homeLat && empLocation?.homeLng) {
      console.log(`✅ Using geocoded location for ${selectedEmployee}: ${empLat}, ${empLng}`);
    } else {
      console.warn(`⚠️ Missing location data for ${selectedEmployee}, using default coordinates`);
    }

    return {
      visits: assignedVisits[selectedEmployee] || [],
      homeLat: empLat,
      homeLng: empLng,
      mode: transportMode as 'car' | 'walking' | 'public',
    };
  })() : null;

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
        unallocatedVisits.map(v => {
          // Get client location data from ProcessingResult
          const clientLocation = data?.clientLocations?.find(c => c.clientName === v.clientName);
          const clientLat = clientLocation?.lat ?? 55.9533; // Default to Edinburgh if not geocoded
          const clientLng = clientLocation?.lng ?? -3.1883;

          if (!clientLocation?.lat || !clientLocation?.lng) {
            console.warn(`Missing location data for ${v.clientName} or ${selectedEmployee}`);
          }

          return {
            clientName: v.clientName,
            start: parseInt(v.startTime.split(':')[0]) * 60 + parseInt(v.startTime.split(':')[1]),
            end: parseInt(v.endTime.split(':')[0]) * 60 + parseInt(v.endTime.split(':')[1]),
            lat: clientLat,
            lng: clientLng,
          };
        }),
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

    // Get client location data from ProcessingResult
    const clientLocation = data?.clientLocations?.find(c => c.clientName === visit.clientName);
    const clientLat = clientLocation?.lat ?? 55.9533; // Default to Edinburgh if not geocoded
    const clientLng = clientLocation?.lng ?? -3.1883;

    const visitData: AssignedVisit = {
      clientName: visit.clientName,
      start: parseInt(visit.startTime.split(':')[0]) * 60 + parseInt(visit.startTime.split(':')[1]),
      end: parseInt(visit.endTime.split(':')[0]) * 60 + parseInt(visit.endTime.split(':')[1]),
      lat: clientLat,
      lng: clientLng,
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

  // Filter visits that have coordinates for the current employee
  const employeeWithCoords = data?.employeeLocations?.find(e => e.employeeName === selectedEmployee);
  const filteredVisits = visits.filter(v => {
    const clientLocation = data?.clientLocations?.find(c => c.clientName === v.clientName);
    return clientLocation?.lat && clientLocation?.lng;
  });

  // Display error message if no visits have coordinates
  if (filteredVisits.length === 0 && selectedEmployee) {
    return (
      <div className="p-6 text-center">
        <div className="text-muted-foreground mb-2">
          No visits with location data found for {date}.
        </div>
        <div className="text-sm text-yellow-600 dark:text-yellow-500">
          💡 Tip: Upload Guaranteed Hours via Data Management first to geocode client locations, then return to scheduling.
        </div>
      </div>
    );
  }


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
                      {topMatches.map((match, idx) => {
                        const visit = match.visit; // Alias for clarity

                        // Get employee coordinates from employeeLocations data
                        let empLat = 0;
                        let empLng = 0;
                        let transportMode = 'car';

                        // Get employee location from the main employeeLocations array
                        const empLocationData = data?.employeeLocations?.find(
                          (emp: any) => emp.employeeName === selectedEmployee
                        );

                        if (empLocationData?.homeLat && empLocationData?.homeLng) {
                          empLat = parseFloat(empLocationData.homeLat);
                          empLng = parseFloat(empLocationData.homeLng);
                          transportMode = empLocationData.transportMode?.toLowerCase() || 'car';
                        } else {
                          // Fallback to employee summary data
                          const selectedEmpSummary = employeeSummary.find(
                            (emp: any) => emp.employeeName === selectedEmployee
                          );

                          if (selectedEmpSummary) {
                            empLat = parseFloat(selectedEmpSummary.homeLat || '0');
                            empLng = parseFloat(selectedEmpSummary.homeLng || '0');
                            transportMode = selectedEmpSummary.transportMode?.toLowerCase() || 'car';
                          }
                        }

                        // Get client coordinates from clientLocations data
                        let clientLat = 0;
                        let clientLng = 0;

                        // Get client location from the main clientLocations array
                        const clientLocationData = data?.clientLocations?.find(
                          (client: any) => client.clientName === visit.clientName
                        );

                        if (clientLocationData?.lat && clientLocationData?.lng) {
                          clientLat = parseFloat(clientLocationData.lat);
                          clientLng = parseFloat(clientLocationData.lng);
                        }

                        // Validate coordinates are valid numbers and not zero
                        if (!Number.isFinite(empLat) || !Number.isFinite(empLng) || 
                            !Number.isFinite(clientLat) || !Number.isFinite(clientLng) ||
                            (empLat === 0 && empLng === 0) || (clientLat === 0 && clientLng === 0)) {

                          console.warn(`Missing location data for ${visit.clientName} or ${selectedEmployee}`);
                          console.warn(`  Employee coords: ${empLat}, ${empLng} (from ${empLocationData ? 'employeeLocations' : 'employeeSummary'})`);
                          console.warn(`  Client coords: ${clientLat}, ${clientLng} (from ${clientLocationData ? 'clientLocations' : 'not found'})`);

                          // Show placeholder with "No location data" message
                          return (
                            <Card key={idx}>
                              <CardContent className="p-3">
                                <div className="flex justify-between items-start">
                                  <div className="flex-1">
                                    <p className="font-medium">{visit.clientName}</p>
                                    <p className="text-sm text-muted-foreground">
                                      {minutesToTime(visit.start)} - {minutesToTime(visit.end)}
                                    </p>
                                    <div className="flex gap-2 mt-2">
                                      <Badge variant="outline" className="text-xs">
                                        Score: {(match.score * 100).toFixed(0)}%
                                      </Badge>
                                      <Badge variant="outline" className="text-xs text-red-500">
                                        No location data
                                      </Badge>
                                      <Badge variant="outline" className="text-xs">
                                        Gap: {match.gap}m
                                      </Badge>
                                    </div>
                                  </div>
                                  <Button
                                    size="sm"
                                    onClick={() => assignVisit(
                                      visit.clientName,
                                      minutesToTime(visit.start),
                                      minutesToTime(visit.end)
                                    )}
                                    data-testid={`button-assign-visit-${visit.clientName.replace(/\s+/g, '-')}`}
                                  >
                                    <Plus className="h-4 w-4" />
                                  </Button>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        }

                        const empLocation = { lat: empLat, lng: empLng };
                        const clientLocationCoords = { lat: clientLat, lng: clientLng };

                        // Normalize transport mode
                        const normalizedTransportMode = transportMode.includes('car') ? 'car' : 
                                                      transportMode.includes('walk') ? 'walking' : 'car';

                        const travelMinutes = getTravelMinutes(
                            empLocation,
                            clientLocationCoords,
                            normalizedTransportMode as 'car' | 'walking' | 'public'
                          );

                          console.log(`🔍 Frontend travel calc: ${selectedEmployee} -> ${visit.clientName}: ${travelMinutes}min`);
                          console.log(`  Emp coords: ${empLocation.lat}, ${empLocation.lng}`);
                          console.log(`  Client coords: ${clientLocationCoords.lat}, ${clientLocationCoords.lng}`);
                          console.log(`  Transport mode: ${transportMode}`);

                        return (
                          <Card key={idx}>
                            <CardContent className="p-3">
                              <div className="flex justify-between items-start">
                                <div className="flex-1">
                                  <p className="font-medium">{visit.clientName}</p>
                                  <p className="text-sm text-muted-foreground">
                                    {minutesToTime(visit.start)} - {minutesToTime(visit.end)}
                                  </p>
                                  <div className="flex gap-2 mt-2">
                                    <Badge variant="outline" className="text-xs">
                                      Score: {(match.score * 100).toFixed(0)}%
                                    </Badge>
                                    {/* Use the calculated travelMinutes */}
                                    <Badge variant="outline" className="text-xs">
                                      Travel: +{travelMinutes}m 
                                    </Badge>
                                    <Badge variant="outline" className="text-xs">
                                      Gap: {match.gap}m
                                    </Badge>
                                  </div>
                                </div>
                                <Button
                                  size="sm"
                                  onClick={() => assignVisit(
                                    visit.clientName,
                                    minutesToTime(visit.start),
                                    minutesToTime(visit.end)
                                  )}
                                  data-testid={`button-assign-visit-${visit.clientName.replace(/\s+/g, '-')}`}
                                >
                                  <Plus className="h-4 w-4" />
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
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
}