import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Clock, Users, Calendar, CheckCircle, AlertTriangle, MapPin, 
  UserIcon, RefreshCw, Plus, XCircle, Target, BarChart3
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { ProcessingResult } from "@shared/schema";
import { format, addDays, startOfWeek } from "date-fns";

interface SchedulingTabProps {
  data: ProcessingResult | null;
  selectedDate?: string | null;
  onDateChange?: (date: string) => void;
}

interface EmployeeWindow {
  employeeName: string;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  postcodeDistrict: string;
  status: string;
  transportMode?: string;
}

interface ClientWindow {
  clientName: string;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  postcodeDistrict: string;
  serviceType?: string;
}

interface TimeWindowAssignment {
  id: string;
  employeeName: string;
  clientName: string;
  date: string;
  block: string;
  postcodeDistrict: string;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  assignedAt: Date;
  assignedBy: string | null;
}

interface TimeWindowMatching {
  date: string;
  blocks: string[];
  employeesByBlockAndDistrict: Record<string, Record<string, EmployeeWindow[]>>;
  clientsByBlockAndDistrict: Record<string, Record<string, ClientWindow[]>>;
  assignments: TimeWindowAssignment[];
  unmatched: {
    employees: EmployeeWindow[];
    clients: ClientWindow[];
  };
}

const VISIT_BLOCKS = {
  morning: { label: "Morning", range: "07:00-12:00", color: "bg-blue-100 dark:bg-blue-900" },
  afternoon: { label: "Afternoon", range: "12:00-17:00", color: "bg-green-100 dark:bg-green-900" },
  evening: { label: "Evening", range: "17:00-22:00", color: "bg-purple-100 dark:bg-purple-900" }
};

function formatMinutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

function QuickAssignCard({ 
  block, 
  district, 
  employees, 
  clients, 
  assignments,
  onAssign,
  onDeleteAssignment
}: {
  block: string;
  district: string;
  employees: EmployeeWindow[];
  clients: ClientWindow[];
  assignments: TimeWindowAssignment[];
  onAssign: (employeeName: string, clientName: string) => void;
  onDeleteAssignment: (assignmentId: string) => void;
}) {
  const [selectedEmployee, setSelectedEmployee] = useState<string>("");
  const [selectedClient, setSelectedClient] = useState<string>("");

  const assignedInThisCell = assignments.filter(a => 
    a.block === block && a.postcodeDistrict === district
  );

  const availableEmployees = employees.filter(emp => 
    !assignments.some(a => a.employeeName === emp.employeeName)
  );

  const availableClients = clients.filter(client => 
    !assignments.some(a => a.clientName === client.clientName)
  );

  const handleAssign = () => {
    if (selectedEmployee && selectedClient) {
      onAssign(selectedEmployee, selectedClient);
      setSelectedEmployee("");
      setSelectedClient("");
    }
  };

  return (
    <Card className="min-h-[300px]">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Clock className="h-4 w-4" />
          {VISIT_BLOCKS[block as keyof typeof VISIT_BLOCKS]?.label} - {district}
        </CardTitle>
        <div className="text-xs text-muted-foreground">
          {VISIT_BLOCKS[block as keyof typeof VISIT_BLOCKS]?.range}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Existing Assignments */}
        {assignedInThisCell.length > 0 && (
          <div>
            <div className="text-xs font-medium text-green-600 dark:text-green-400 mb-2">
              Current Assignments:
            </div>
            <div className="space-y-2">
              {assignedInThisCell.map(assignment => (
                <div key={assignment.id} className="flex items-center justify-between p-2 bg-green-50 dark:bg-green-900/20 rounded">
                  <div className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <span className="font-medium">{assignment.employeeName}</span>
                    <span className="text-muted-foreground">→</span>
                    <span>{assignment.clientName}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onDeleteAssignment(assignment.id)}
                    className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                    data-testid={`button-delete-${assignment.id}`}
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* New Assignment Interface */}
        {availableEmployees.length > 0 && availableClients.length > 0 && (
          <div className="space-y-3">
            <div className="text-xs font-medium text-blue-600 dark:text-blue-400">
              Create New Assignment:
            </div>
            
            <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
              <SelectTrigger className="text-sm" data-testid={`select-employee-${block}-${district}`}>
                <SelectValue placeholder="Select employee" />
              </SelectTrigger>
              <SelectContent>
                {availableEmployees.map(emp => (
                  <SelectItem key={emp.employeeName} value={emp.employeeName}>
                    <div className="flex items-center gap-2">
                      <Users className="h-3 w-3" />
                      <span>{emp.employeeName}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatMinutesToTime(emp.startMinutes)}-{formatMinutesToTime(emp.endMinutes)}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedClient} onValueChange={setSelectedClient}>
              <SelectTrigger className="text-sm" data-testid={`select-client-${block}-${district}`}>
                <SelectValue placeholder="Select client" />
              </SelectTrigger>
              <SelectContent>
                {availableClients.map(client => (
                  <SelectItem key={client.clientName} value={client.clientName}>
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3 w-3" />
                      <span>{client.clientName}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatMinutesToTime(client.startMinutes)}-{formatMinutesToTime(client.endMinutes)}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button 
              size="sm" 
              className="w-full"
              onClick={handleAssign}
              disabled={!selectedEmployee || !selectedClient}
              data-testid={`button-assign-${block}-${district}`}
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Assignment
            </Button>
          </div>
        )}

        {/* Summary */}
        <div className="flex flex-wrap gap-2 pt-2 border-t">
          <Badge variant="outline" className="text-xs">
            {availableEmployees.length} available staff
          </Badge>
          <Badge variant="outline" className="text-xs">
            {availableClients.length} available clients
          </Badge>
          <Badge variant="outline" className="text-xs">
            {assignedInThisCell.length} assignments
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

export function SchedulingTab({ data, selectedDate, onDateChange }: SchedulingTabProps) {
  const [currentDate, setCurrentDate] = useState(() => {
    return selectedDate || format(new Date(), 'yyyy-MM-dd');
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Update current date when selectedDate changes
  useEffect(() => {
    if (selectedDate) {
      setCurrentDate(selectedDate);
    }
  }, [selectedDate]);

  // Fetch time window data for selected date
  const { data: timeWindowData, isLoading: isLoadingTimeWindows, refetch } = useQuery<TimeWindowMatching>({
    queryKey: ['/api/time-windows', currentDate],
    enabled: !!currentDate
  });

  // Assignment mutation
  const assignmentMutation = useMutation({
    mutationFn: async ({ employeeName, clientName }: { employeeName: string; clientName: string }) => {
      if (!timeWindowData) throw new Error('No time window data available');

      // Find the employee and client to get their details
      const allEmployees = Object.values(timeWindowData.employeesByBlockAndDistrict)
        .flatMap(districts => Object.values(districts).flat());
      const allClients = Object.values(timeWindowData.clientsByBlockAndDistrict)
        .flatMap(districts => Object.values(districts).flat());

      const employee = allEmployees.find(emp => emp.employeeName === employeeName);
      const client = allClients.find(cl => cl.clientName === clientName);

      if (!employee || !client) {
        throw new Error('Employee or client not found');
      }

      // Determine which block and district they match in
      let matchBlock = '';
      let matchDistrict = '';

      Object.entries(timeWindowData.employeesByBlockAndDistrict).forEach(([block, districts]) => {
        Object.entries(districts).forEach(([district, emps]) => {
          if (emps.some(emp => emp.employeeName === employeeName)) {
            matchBlock = block;
            matchDistrict = district;
          }
        });
      });

      const assignmentData = {
        date: currentDate,
        employeeName,
        clientName,
        block: matchBlock,
        postcodeDistrict: matchDistrict,
        startMinutes: Math.max(employee.startMinutes, client.startMinutes),
        endMinutes: Math.min(employee.endMinutes, client.endMinutes),
        durationMinutes: Math.min(employee.durationMinutes, client.durationMinutes),
        assignedBy: 'scheduling_tab'
      };

      const response = await apiRequest('POST', '/api/scheduling/assignments', assignmentData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/time-windows', currentDate] });
      toast({
        title: "Assignment Created",
        description: "Employee successfully matched to client."
      });
    },
    onError: (error) => {
      toast({
        title: "Assignment Failed",
        description: error instanceof Error ? error.message : "Failed to create assignment",
        variant: "destructive"
      });
    }
  });

  // Delete assignment mutation
  const deleteAssignmentMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      const response = await apiRequest('DELETE', `/api/scheduling/assignments/${assignmentId}`, null);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/time-windows', currentDate] });
      toast({
        title: "Assignment Deleted",
        description: "Assignment has been removed."
      });
    },
    onError: (error) => {
      toast({
        title: "Delete Failed",
        description: error instanceof Error ? error.message : "Failed to delete assignment",
        variant: "destructive"
      });
    }
  });

  const handleAssignment = (employeeName: string, clientName: string) => {
    assignmentMutation.mutate({ employeeName, clientName });
  };

  const handleDeleteAssignment = (assignmentId: string) => {
    deleteAssignmentMutation.mutate(assignmentId);
  };

  const handleDateChange = (newDate: string) => {
    setCurrentDate(newDate);
    onDateChange?.(newDate);
  };

  // Generate week dates for quick selection
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(startOfWeek(new Date()), i);
    return {
      date: format(date, 'yyyy-MM-dd'),
      label: format(date, 'EEE dd/MM')
    };
  });

  if (!data) {
    return (
      <div className="space-y-4" data-testid="scheduling-tab-no-data">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            No processed data available. Please upload Excel files to begin scheduling.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoadingTimeWindows) {
    return (
      <div className="space-y-4" data-testid="scheduling-tab-loading">
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="h-8 w-8 animate-spin" />
          <span className="ml-2">Loading scheduling data...</span>
        </div>
      </div>
    );
  }

  if (!timeWindowData) {
    return (
      <div className="space-y-4" data-testid="scheduling-tab-no-time-data">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            No time window data available for the selected date. Please ensure data has been processed for {currentDate}.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Get all unique districts
  const allDistricts = new Set<string>();
  Object.values(timeWindowData.employeesByBlockAndDistrict).forEach(districts =>
    Object.keys(districts).forEach(district => allDistricts.add(district))
  );
  Object.values(timeWindowData.clientsByBlockAndDistrict).forEach(districts =>
    Object.keys(districts).forEach(district => allDistricts.add(district))
  );
  const districts = Array.from(allDistricts).sort();

  return (
    <div className="space-y-6" data-testid="scheduling-tab">
      {/* Header with Date Selection */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-xl font-semibold" data-testid="text-scheduling-title">
            Time Window Scheduling
          </h3>
          <p className="text-sm text-muted-foreground" data-testid="text-scheduling-description">
            Match employees to clients based on time availability and postcode districts
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex gap-1 flex-wrap">
            {weekDates.map(({ date, label }) => (
              <Button
                key={date}
                variant={currentDate === date ? "default" : "outline"}
                size="sm"
                onClick={() => handleDateChange(date)}
                data-testid={`button-date-${date}`}
              >
                {label}
              </Button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoadingTimeWindows}
            data-testid="button-refresh-data"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoadingTimeWindows ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Statistics */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold" data-testid="text-total-assignments">
              {timeWindowData.assignments.length}
            </div>
            <p className="text-xs text-muted-foreground">Total Assignments</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold" data-testid="text-unmatched-employees">
              {timeWindowData.unmatched.employees.length}
            </div>
            <p className="text-xs text-muted-foreground">Unmatched Staff</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold" data-testid="text-unmatched-clients">
              {timeWindowData.unmatched.clients.length}
            </div>
            <p className="text-xs text-muted-foreground">Unmatched Clients</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold" data-testid="text-districts-count">
              {districts.length}
            </div>
            <p className="text-xs text-muted-foreground">Postcode Districts</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="matrix" className="space-y-4">
        <TabsList>
          <TabsTrigger value="matrix" data-testid="tab-matrix">
            <Target className="h-4 w-4 mr-2" />
            Scheduling Matrix
          </TabsTrigger>
          <TabsTrigger value="assignments" data-testid="tab-assignments">
            <CheckCircle className="h-4 w-4 mr-2" />
            Current Assignments
          </TabsTrigger>
          <TabsTrigger value="unmatched" data-testid="tab-unmatched">
            <AlertTriangle className="h-4 w-4 mr-2" />
            Unmatched Items
          </TabsTrigger>
        </TabsList>

        {/* Matrix View */}
        <TabsContent value="matrix" className="space-y-4">
          {timeWindowData.blocks.map(block => (
            <div key={block} className="space-y-3">
              <div className={`flex items-center gap-2 p-3 rounded-lg ${VISIT_BLOCKS[block as keyof typeof VISIT_BLOCKS]?.color}`}>
                <Clock className="h-5 w-5" />
                <div className="font-medium">
                  {VISIT_BLOCKS[block as keyof typeof VISIT_BLOCKS]?.label}
                </div>
                <Badge variant="secondary" className="text-xs">
                  {VISIT_BLOCKS[block as keyof typeof VISIT_BLOCKS]?.range}
                </Badge>
              </div>
              
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {districts.map(district => {
                  const employees = timeWindowData.employeesByBlockAndDistrict[block]?.[district] || [];
                  const clients = timeWindowData.clientsByBlockAndDistrict[block]?.[district] || [];
                  
                  if (employees.length === 0 && clients.length === 0) {
                    return null;
                  }

                  return (
                    <QuickAssignCard
                      key={`${block}-${district}`}
                      block={block}
                      district={district}
                      employees={employees}
                      clients={clients}
                      assignments={timeWindowData.assignments}
                      onAssign={handleAssignment}
                      onDeleteAssignment={handleDeleteAssignment}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </TabsContent>

        {/* Assignments List */}
        <TabsContent value="assignments">
          <Card>
            <CardHeader>
              <CardTitle>Current Assignments for {format(new Date(currentDate), 'EEEE, MMMM do, yyyy')}</CardTitle>
            </CardHeader>
            <CardContent>
              {timeWindowData.assignments.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No assignments created yet. Use the Matrix tab to create assignments.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Time Block</TableHead>
                      <TableHead>Postcode District</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Assigned</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {timeWindowData.assignments.map(assignment => (
                      <TableRow key={assignment.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4" />
                            {assignment.employeeName}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4" />
                            {assignment.clientName}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {assignment.block} ({formatMinutesToTime(assignment.startMinutes)}-{formatMinutesToTime(assignment.endMinutes)})
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{assignment.postcodeDistrict}</Badge>
                        </TableCell>
                        <TableCell>{assignment.durationMinutes} mins</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {format(new Date(assignment.assignedAt), 'HH:mm')}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteAssignment(assignment.id)}
                            className="text-red-500 hover:text-red-700"
                            data-testid={`button-delete-assignment-${assignment.id}`}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Unmatched Items */}
        <TabsContent value="unmatched">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Unmatched Employees ({timeWindowData.unmatched.employees.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {timeWindowData.unmatched.employees.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground">
                    All employees have been matched!
                  </div>
                ) : (
                  <div className="space-y-2">
                    {timeWindowData.unmatched.employees.map((emp, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2 bg-orange-50 dark:bg-orange-900/20 rounded">
                        <div className="flex items-center gap-2">
                          <UserIcon className="h-4 w-4" />
                          <span className="font-medium">{emp.employeeName}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span>{formatMinutesToTime(emp.startMinutes)}-{formatMinutesToTime(emp.endMinutes)}</span>
                          <Badge variant="outline" className="text-xs">{emp.postcodeDistrict}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  Unmatched Clients ({timeWindowData.unmatched.clients.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {timeWindowData.unmatched.clients.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground">
                    All clients have been matched!
                  </div>
                ) : (
                  <div className="space-y-2">
                    {timeWindowData.unmatched.clients.map((client, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2 bg-orange-50 dark:bg-orange-900/20 rounded">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4" />
                          <span className="font-medium">{client.clientName}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span>{formatMinutesToTime(client.startMinutes)}-{formatMinutesToTime(client.endMinutes)}</span>
                          <Badge variant="outline" className="text-xs">{client.postcodeDistrict}</Badge>
                        </div>
                      </div>
                    ))}
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