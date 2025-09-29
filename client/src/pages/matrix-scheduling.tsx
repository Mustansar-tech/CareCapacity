import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { LoaderIcon, UserIcon, MapPinIcon, ClockIcon, CheckIcon, XIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { format, addDays, startOfWeek } from "date-fns";

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

function MatrixCell({ 
  block, 
  district, 
  employees, 
  clients, 
  assignments,
  onAssign
}: {
  block: string;
  district: string;
  employees: EmployeeWindow[];
  clients: ClientWindow[];
  assignments: TimeWindowAssignment[];
  onAssign: (employeeName: string, clientName: string) => void;
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
    <div className="min-h-[200px] p-2 border rounded-lg bg-white dark:bg-gray-800">
      <div className="text-xs font-medium mb-2 text-gray-600 dark:text-gray-400">
        {VISIT_BLOCKS[block as keyof typeof VISIT_BLOCKS]?.label} - {district}
      </div>

      {/* Existing Assignments */}
      {assignedInThisCell.length > 0 && (
        <div className="mb-3">
          <div className="text-xs text-green-600 dark:text-green-400 mb-1">Assigned:</div>
          {assignedInThisCell.map(assignment => (
            <div key={assignment.id} className="flex items-center gap-1 text-xs bg-green-50 dark:bg-green-900/20 p-1 rounded mb-1">
              <CheckIcon className="h-3 w-3 text-green-600" />
              <span className="font-medium">{assignment.employeeName}</span>
              <span className="text-gray-500">→</span>
              <span>{assignment.clientName}</span>
            </div>
          ))}
        </div>
      )}

      {/* Available Matching */}
      {availableEmployees.length > 0 && availableClients.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-blue-600 dark:text-blue-400">New Match:</div>
          
          <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
            <SelectTrigger className="h-8 text-xs" data-testid={`select-employee-${block}-${district}`}>
              <SelectValue placeholder="Select employee" />
            </SelectTrigger>
            <SelectContent>
              {availableEmployees.map(emp => (
                <SelectItem key={emp.employeeName} value={emp.employeeName}>
                  <div className="flex items-center gap-2">
                    <UserIcon className="h-3 w-3" />
                    <span>{emp.employeeName}</span>
                    <span className="text-xs text-gray-500">
                      {formatMinutesToTime(emp.startMinutes)}-{formatMinutesToTime(emp.endMinutes)}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedClient} onValueChange={setSelectedClient}>
            <SelectTrigger className="h-8 text-xs" data-testid={`select-client-${block}-${district}`}>
              <SelectValue placeholder="Select client" />
            </SelectTrigger>
            <SelectContent>
              {availableClients.map(client => (
                <SelectItem key={client.clientName} value={client.clientName}>
                  <div className="flex items-center gap-2">
                    <MapPinIcon className="h-3 w-3" />
                    <span>{client.clientName}</span>
                    <span className="text-xs text-gray-500">
                      {formatMinutesToTime(client.startMinutes)}-{formatMinutesToTime(client.endMinutes)}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button 
            size="sm" 
            className="w-full h-8 text-xs"
            onClick={handleAssign}
            disabled={!selectedEmployee || !selectedClient}
            data-testid={`button-assign-${block}-${district}`}
          >
            Assign
          </Button>
        </div>
      )}

      {/* Summary badges */}
      <div className="flex gap-1 mt-2">
        {availableEmployees.length > 0 && (
          <Badge variant="outline" className="text-xs">
            {availableEmployees.length} staff
          </Badge>
        )}
        {availableClients.length > 0 && (
          <Badge variant="outline" className="text-xs">
            {availableClients.length} clients
          </Badge>
        )}
      </div>
    </div>
  );
}

export default function MatrixScheduling() {
  const [selectedDate, setSelectedDate] = useState(() => {
    // Default to today
    return format(new Date(), 'yyyy-MM-dd');
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch time window data for selected date
  const { data: timeWindowData, isLoading } = useQuery<TimeWindowMatching>({
    queryKey: ['/api/time-windows', selectedDate],
    enabled: !!selectedDate
  });

  // Assignment mutation
  const assignmentMutation = useMutation({
    mutationFn: async ({ employeeName, clientName }: { employeeName: string; clientName: string }) => {
      // Find the employee and client to get their details
      const allEmployees = Object.values(timeWindowData?.employeesByBlockAndDistrict || {})
        .flatMap(districts => Object.values(districts).flat());
      const allClients = Object.values(timeWindowData?.clientsByBlockAndDistrict || {})
        .flatMap(districts => Object.values(districts).flat());

      const employee = allEmployees.find(emp => emp.employeeName === employeeName);
      const client = allClients.find(cl => cl.clientName === clientName);

      if (!employee || !client) {
        throw new Error('Employee or client not found');
      }

      // Determine which block and district they match in
      let matchBlock = '';
      let matchDistrict = '';

      Object.entries(timeWindowData?.employeesByBlockAndDistrict || {}).forEach(([block, districts]) => {
        Object.entries(districts).forEach(([district, emps]) => {
          if (emps.some(emp => emp.employeeName === employeeName)) {
            matchBlock = block;
            matchDistrict = district;
          }
        });
      });

      const assignmentData = {
        date: selectedDate,
        employeeName,
        clientName,
        block: matchBlock,
        postcodeDistrict: matchDistrict,
        startMinutes: Math.max(employee.startMinutes, client.startMinutes),
        endMinutes: Math.min(employee.endMinutes, client.endMinutes),
        durationMinutes: Math.min(employee.durationMinutes, client.durationMinutes),
        assignedBy: 'manual'
      };

      return apiRequest('POST', '/api/scheduling/assignments', assignmentData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/time-windows', selectedDate] });
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

  const handleAssignment = (employeeName: string, clientName: string) => {
    assignmentMutation.mutate({ employeeName, clientName });
  };

  // Generate week dates for quick selection
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(startOfWeek(new Date()), i);
    return {
      date: format(date, 'yyyy-MM-dd'),
      label: format(date, 'EEE dd/MM')
    };
  });

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6" data-testid="matrix-scheduling-loading">
        <div className="flex items-center justify-center h-64">
          <LoaderIcon className="h-8 w-8 animate-spin" />
          <span className="ml-2">Loading scheduling matrix...</span>
        </div>
      </div>
    );
  }

  if (!timeWindowData) {
    return (
      <div className="container mx-auto p-6 space-y-6" data-testid="matrix-scheduling-no-data">
        <Card>
          <CardHeader>
            <CardTitle>No Data Available</CardTitle>
            <CardDescription>
              Please upload Excel files on the main dashboard to begin scheduling.
            </CardDescription>
          </CardHeader>
        </Card>
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
    <div className="container mx-auto p-6 space-y-6" data-testid="matrix-scheduling-page">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">
            Matrix Scheduling
          </h1>
          <p className="text-muted-foreground" data-testid="text-page-description">
            Match employees to clients using time windows and postcode districts
          </p>
        </div>

        {/* Date Selection */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex gap-1 flex-wrap">
            {weekDates.map(({ date, label }) => (
              <Button
                key={date}
                variant={selectedDate === date ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedDate(date)}
                data-testid={`button-date-${date}`}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary Stats */}
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
            <div className="text-2xl font-bold" data-testid="text-total-districts">
              {districts.length}
            </div>
            <p className="text-xs text-muted-foreground">Postcode Districts</p>
          </CardContent>
        </Card>
      </div>

      {/* Matrix Grid */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClockIcon className="h-5 w-5" />
            Scheduling Matrix for {format(new Date(selectedDate), 'EEEE, MMMM do, yyyy')}
          </CardTitle>
          <CardDescription>
            Drag and drop or select to match employees with clients in the same time blocks and districts
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {timeWindowData.blocks.map(block => (
              <div key={block} className="space-y-2">
                <div className={`flex items-center gap-2 p-2 rounded-lg ${VISIT_BLOCKS[block as keyof typeof VISIT_BLOCKS]?.color}`}>
                  <div className="font-medium">
                    {VISIT_BLOCKS[block as keyof typeof VISIT_BLOCKS]?.label}
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {VISIT_BLOCKS[block as keyof typeof VISIT_BLOCKS]?.range}
                  </Badge>
                </div>
                
                <div className="grid gap-2 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {districts.map(district => {
                    const employees = timeWindowData.employeesByBlockAndDistrict[block]?.[district] || [];
                    const clients = timeWindowData.clientsByBlockAndDistrict[block]?.[district] || [];
                    
                    if (employees.length === 0 && clients.length === 0) {
                      return null;
                    }

                    return (
                      <MatrixCell
                        key={`${block}-${district}`}
                        block={block}
                        district={district}
                        employees={employees}
                        clients={clients}
                        assignments={timeWindowData.assignments}
                        onAssign={handleAssignment}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Unmatched Items */}
      {(timeWindowData.unmatched.employees.length > 0 || timeWindowData.unmatched.clients.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <XIcon className="h-5 w-5 text-orange-500" />
              Unmatched Items
            </CardTitle>
            <CardDescription>
              Employees and clients that couldn't be matched in any time window
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              {timeWindowData.unmatched.employees.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2">Unmatched Employees</h4>
                  <div className="space-y-1">
                    {timeWindowData.unmatched.employees.map((emp, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm p-2 bg-orange-50 dark:bg-orange-900/20 rounded">
                        <UserIcon className="h-4 w-4" />
                        <span className="font-medium">{emp.employeeName}</span>
                        <span className="text-gray-500">
                          {formatMinutesToTime(emp.startMinutes)}-{formatMinutesToTime(emp.endMinutes)}
                        </span>
                        <Badge variant="outline" className="text-xs">{emp.postcodeDistrict}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {timeWindowData.unmatched.clients.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2">Unmatched Clients</h4>
                  <div className="space-y-1">
                    {timeWindowData.unmatched.clients.map((client, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm p-2 bg-orange-50 dark:bg-orange-900/20 rounded">
                        <MapPinIcon className="h-4 w-4" />
                        <span className="font-medium">{client.clientName}</span>
                        <span className="text-gray-500">
                          {formatMinutesToTime(client.startMinutes)}-{formatMinutesToTime(client.endMinutes)}
                        </span>
                        <Badge variant="outline" className="text-xs">{client.postcodeDistrict}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}