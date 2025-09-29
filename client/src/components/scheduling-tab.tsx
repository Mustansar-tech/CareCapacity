import React, { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { 
  MapPin, Route, Clock, Car, Navigation, AlertTriangle, CheckCircle, 
  RefreshCw, Zap, Target, Users, Calendar, ArrowRight, Settings, Sliders,
  AlertCircle, Info, XCircle, TrendingUp, BarChart3
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { ProcessingResult } from "@shared/schema";
import { getGenderColorClass } from "@/utils/gender-colors";

interface SchedulingTabProps {
  data: ProcessingResult | null;
  selectedDate?: string | null;
  onDateChange?: (date: string) => void;
}

// Enhanced backend-processed interfaces with diagnostics
interface TravelOptimization {
  date: string;
  totalAvailableEmployees: number;
  employees: EmployeeSchedule[];
  diagnostics?: DiagnosticData;
}

interface DiagnosticData {
  employeeIssues: EmployeeIssue[];
  clientIssues: ClientIssue[];
  dataQuality: DataQualityMetrics;
}

interface EmployeeIssue {
  employeeName: string;
  reason: 'status_unavailable' | 'no_time_windows' | 'no_postcode' | 'geocoding_failed' | 'geocoding_error';
  detail: string;
  severity: 'info' | 'warning' | 'error';
}

interface ClientIssue {
  clientName: string;
  reason: 'geocoding_failed' | 'geocoding_error';
  detail: string;
  severity: 'error';
}

interface DataQualityMetrics {
  totalEmployees: number;
  availableEmployees: number;
  employeesWithoutGeocode: number;
  employeesWithoutPostcode: number;
  employeesWithoutTimeWindows: number;
  totalClients: number;
  clientsWithoutGeocode: number;
  geocodingAttempts: number;
  geocodingSuccesses: number;
}

interface EmployeeSchedule {
  employeeName: string;
  timeWindows?: any; // Time windows from Daily Capacity Summary - flexible format
  postcode: string;
  bestClientMatches: ClientMatch[];
  rejectedClients?: RejectedClient[];
  totalRejectedClients?: number;
}

interface RejectedClient {
  clientName: string;
  travelTimeMinutes: number;
  reason: string;
}

interface ClientMatch {
  clientName: string;
  travelTimeMinutes: number;
}

interface EmployeeLocation {
  id: string;
  employeeName: string;
  homePostcode: string;
  homeLat: string | null;
  homeLng: string | null;
  transportMode: "car" | "walking" | "public" | null;
  geocodedAt: Date | null;
}

interface ClientLocation {
  id: string;
  clientName: string;
  addressLine: string;
  postcode: string;
  lat: string | null;
  lng: string | null;
  geocodedAt: Date | null;
}

// Backend API response interfaces
interface RoutePlansResponse {
  date: string;
  routePlans: RoutePlan[];
}

interface RoutePlan {
  routePlanId: string;
  employeeName: string;
  status: "optimized" | "manual" | "infeasible";
  totalDistanceKm: string;
  totalTravelMinutes: number;
  warnings: unknown;
  stops: RouteStop[];
}

interface RouteStop {
  sequence: number;
  visitId: string;
  clientName: string;
  scheduledStart: string;
  scheduledEnd: string;
  travelMinutesFromPrev: number;
  distanceKmFromPrev: string;
}

export function SchedulingTab({ data, selectedDate, onDateChange }: SchedulingTabProps) {
  const [optimizationDate, setOptimizationDate] = useState<string>(
    selectedDate || new Date().toISOString().split('T')[0]
  );
  
  // Travel constraint settings
  const [travelTimeLimit, setTravelTimeLimit] = useState<number>(30);
  const [useSoftConstraints, setUseSoftConstraints] = useState<boolean>(true);
  const [maxTravelTime, setMaxTravelTime] = useState<number>(45);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState<boolean>(false);
  
  const { toast } = useToast();

  // Update optimization date when selectedDate changes
  useEffect(() => {
    if (selectedDate) {
      setOptimizationDate(selectedDate);
    }
  }, [selectedDate]);

  // Query employee locations
  const { data: employeeLocations, isLoading: isLoadingEmployees } = useQuery<EmployeeLocation[]>({
    queryKey: ['/api/geographical/employees'],
  });

  // Query client locations
  const { data: clientLocations, isLoading: isLoadingClients } = useQuery<ClientLocation[]>({
    queryKey: ['/api/geographical/clients'],
  });

  // Query route plans for selected date
  const { data: routePlansResponse, isLoading: isLoadingRoutes, refetch: refetchRoutes } = useQuery<RoutePlansResponse>({
    queryKey: ['/api/routing/plans', optimizationDate],
    queryFn: () => fetch(`/api/routing/plans?date=${optimizationDate}`).then(res => res.json()),
  });

  // Extract route plans from response
  const routePlans = routePlansResponse?.routePlans || [];

  // Query travel optimization for selected date
  const { data: travelOptimization, isLoading: isLoadingOptimization, refetch: refetchOptimization } = useQuery<TravelOptimization>({
    queryKey: ['/api/travel-optimization', optimizationDate],
    queryFn: () => fetch(`/api/travel-optimization/${optimizationDate}`).then(res => res.json()),
  });

  // Geocoding mutation
  const geocodeMutation = useMutation({
    mutationFn: async (postcodes: string[]) => {
      const response = await apiRequest('POST', '/api/geo/geocode-batch', { postcodes, addresses: [] });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Geocoding Complete",
        description: "Location coordinates have been updated."
      });
      queryClient.invalidateQueries({ queryKey: ['/api/geographical/employees'] });
      queryClient.invalidateQueries({ queryKey: ['/api/geographical/clients'] });
    },
    onError: (error) => {
      toast({
        title: "Geocoding Failed",
        description: "Unable to geocode postcodes. Please try again.",
        variant: "destructive"
      });
    }
  });

  // Route optimization mutation
  const optimizeMutation = useMutation({
    mutationFn: async ({ date, travelTimeLimit, useSoftConstraints, maxTravelTime }: { 
      date: string; 
      travelTimeLimit?: number; 
      useSoftConstraints?: boolean; 
      maxTravelTime?: number; 
    }) => {
      const response = await apiRequest('POST', '/api/routing/optimize', { 
        date, 
        travelTimeLimit, 
        useSoftConstraints, 
        maxTravelTime 
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Route Optimization Complete",
        description: "Routes have been optimized for the selected date."
      });
      refetchRoutes();
    },
    onError: (error) => {
      toast({
        title: "Route Optimization Failed",
        description: "Unable to optimize routes. Please try again.",
        variant: "destructive"
      });
    }
  });

  // Handle geocoding
  const handleGeocode = () => {
    const postcodes = new Set<string>();
    
    // Collect employee postcodes that need geocoding
    employeeLocations?.forEach(emp => {
      if (emp.homePostcode && (!emp.homeLat || !emp.homeLng)) {
        postcodes.add(emp.homePostcode);
      }
    });
    
    // Collect client postcodes that need geocoding
    clientLocations?.forEach(client => {
      if (client.postcode && (!client.lat || !client.lng)) {
        postcodes.add(client.postcode);
      }
    });

    if (postcodes.size > 0) {
      geocodeMutation.mutate(Array.from(postcodes));
    } else {
      toast({
        title: "No Geocoding Needed",
        description: "All locations already have coordinates."
      });
    }
  };

  // Handle route optimization
  const handleOptimizeRoutes = () => {
    const geocodedEmployees = employeeLocations?.filter(emp => 
      emp.homeLat && emp.homeLng
    ) || [];
    
    if (geocodedEmployees.length === 0) {
      toast({
        title: "No Geocoded Employees",
        description: "Please geocode employee locations first.",
        variant: "destructive"
      });
      return;
    }

    optimizeMutation.mutate({
      date: optimizationDate,
      travelTimeLimit,
      useSoftConstraints,
      maxTravelTime: useSoftConstraints ? maxTravelTime : travelTimeLimit
    });
  };

  // Calculate statistics
  const employeeStats = {
    total: employeeLocations?.length || 0,
    geocoded: employeeLocations?.filter(emp => emp.homeLat && emp.homeLng).length || 0,
    withCar: employeeLocations?.filter(emp => emp.transportMode === "car").length || 0,
    walking: employeeLocations?.filter(emp => emp.transportMode === "walking").length || 0,
  };

  const clientStats = {
    total: clientLocations?.length || 0,
    geocoded: clientLocations?.filter(client => client.lat && client.lng).length || 0,
  };

  const routeStats = {
    total: routePlans.length,
    optimized: routePlans.filter(plan => plan.status === "optimized").length,
    infeasible: routePlans.filter(plan => plan.status === "infeasible").length,
  };

  // Available dates from data
  const availableDates = data?.dailySummary?.map(day => day.date) || [];

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card className="glass">
        <CardHeader className="gradient-card dark:gradient-card-dark rounded-t-lg">
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-blue-500 flex items-center justify-center shadow-lg">
                <MapPin className="w-5 h-5 text-white" />
              </div>
              <div>
                <span className="bg-gradient-to-r from-emerald-600 to-blue-600 bg-clip-text text-transparent">
                  Route Scheduling Optimization
                </span>
                <p className="text-sm text-gray-600 dark:text-gray-300 font-normal mt-1">
                  Optimize employee routes with configurable travel constraints and geographical proximity
                </p>
              </div>
            </div>
            <Badge variant="outline" className="text-xs bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm">
              <Calendar className="w-3 h-3 mr-1" />
              {optimizationDate}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          {/* Data Quality and Diagnostics Section */}
          {travelOptimization?.diagnostics && (
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center">
                  <BarChart3 className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Data Quality Analysis</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    Issues that may affect scheduling optimization
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {/* Employee Data Quality */}
                <Card className="glass">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-medium text-gray-900 dark:text-white">Employee Data</h4>
                      <Users className="w-4 h-4 text-blue-500" />
                    </div>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span>Total:</span>
                        <Badge variant="outline">{travelOptimization.diagnostics.dataQuality.totalEmployees}</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span>Available:</span>
                        <Badge variant="default">{travelOptimization.diagnostics.dataQuality.availableEmployees}</Badge>
                      </div>
                      {travelOptimization.diagnostics.dataQuality.employeesWithoutPostcode > 0 && (
                        <div className="flex justify-between">
                          <span>No postcode:</span>
                          <Badge variant="destructive">{travelOptimization.diagnostics.dataQuality.employeesWithoutPostcode}</Badge>
                        </div>
                      )}
                      {travelOptimization.diagnostics.dataQuality.employeesWithoutTimeWindows > 0 && (
                        <div className="flex justify-between">
                          <span>No time windows:</span>
                          <Badge variant="secondary">{travelOptimization.diagnostics.dataQuality.employeesWithoutTimeWindows}</Badge>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Client Data Quality */}
                <Card className="glass">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-medium text-gray-900 dark:text-white">Client Data</h4>
                      <MapPin className="w-4 h-4 text-emerald-500" />
                    </div>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span>Total:</span>
                        <Badge variant="outline">{travelOptimization.diagnostics.dataQuality.totalClients}</Badge>
                      </div>
                      {travelOptimization.diagnostics.dataQuality.clientsWithoutGeocode > 0 && (
                        <div className="flex justify-between">
                          <span>No geocode:</span>
                          <Badge variant="destructive">{travelOptimization.diagnostics.dataQuality.clientsWithoutGeocode}</Badge>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Assignment Issues */}
                <Card className="glass">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-medium text-gray-900 dark:text-white">Issues Found</h4>
                      <AlertTriangle className="w-4 h-4 text-yellow-500" />
                    </div>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span>Employee issues:</span>
                        <Badge variant="secondary">{travelOptimization.diagnostics.employeeIssues.length}</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span>Client issues:</span>
                        <Badge variant="secondary">{travelOptimization.diagnostics.clientIssues.length}</Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Detailed Issues */}
              {(travelOptimization.diagnostics.employeeIssues.length > 0 || travelOptimization.diagnostics.clientIssues.length > 0) && (
                <Card className="glass">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" />
                      Detailed Issues
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Employee Issues */}
                      {travelOptimization.diagnostics.employeeIssues.length > 0 && (
                        <div>
                          <h5 className="font-medium text-sm mb-2 text-gray-700 dark:text-gray-300">Employee Issues</h5>
                          <div className="space-y-2">
                            {travelOptimization.diagnostics.employeeIssues.slice(0, 5).map((issue, index) => (
                              <div key={index} className="p-2 rounded border text-xs">
                                <div className="flex items-center gap-2 mb-1">
                                  {issue.severity === 'error' && <XCircle className="w-3 h-3 text-red-500" />}
                                  {issue.severity === 'warning' && <AlertTriangle className="w-3 h-3 text-yellow-500" />}
                                  {issue.severity === 'info' && <Info className="w-3 h-3 text-blue-500" />}
                                  <span className="font-medium">{issue.employeeName}</span>
                                </div>
                                <p className="text-gray-600 dark:text-gray-400">{issue.detail}</p>
                              </div>
                            ))}
                            {travelOptimization.diagnostics.employeeIssues.length > 5 && (
                              <p className="text-xs text-gray-500">
                                +{travelOptimization.diagnostics.employeeIssues.length - 5} more issues...
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Client Issues */}
                      {travelOptimization.diagnostics.clientIssues.length > 0 && (
                        <div>
                          <h5 className="font-medium text-sm mb-2 text-gray-700 dark:text-gray-300">Client Issues</h5>
                          <div className="space-y-2">
                            {travelOptimization.diagnostics.clientIssues.slice(0, 5).map((issue, index) => (
                              <div key={index} className="p-2 rounded border text-xs">
                                <div className="flex items-center gap-2 mb-1">
                                  <XCircle className="w-3 h-3 text-red-500" />
                                  <span className="font-medium">{issue.clientName}</span>
                                </div>
                                <p className="text-gray-600 dark:text-gray-400">{issue.detail}</p>
                              </div>
                            ))}
                            {travelOptimization.diagnostics.clientIssues.length > 5 && (
                              <p className="text-xs text-gray-500">
                                +{travelOptimization.diagnostics.clientIssues.length - 5} more issues...
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Employee-Client Matching Results */}
          {travelOptimization && travelOptimization.employees?.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Available Employees for {optimizationDate}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    From Daily Capacity Summary - Employee availability with best client matches
                  </p>
                </div>
                <Badge variant="outline" className="bg-green-50 dark:bg-green-900/20">
                  <Users className="w-3 h-3 mr-1" />
                  {travelOptimization.totalAvailableEmployees} available employees
                </Badge>
              </div>

              <div className="grid gap-4">
                {travelOptimization.employees.map((emp, index) => (
                  <Card key={emp.employeeName} className="glass">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${getGenderColorClass(emp.employeeName)}`}>
                            {emp.employeeName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <h4 className={`font-medium ${getGenderColorClass(emp.employeeName)}`}>
                              {emp.employeeName}
                            </h4>
                            <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                              <MapPin className="w-3 h-3" />
                              <span>{emp.postcode}</span>
                            </div>
                            {emp.timeWindows && emp.timeWindows !== "No time windows" && (
                              <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 mt-1">
                                <Clock className="w-3 h-3" />
                                <span>Time Window(s): {typeof emp.timeWindows === 'string' ? emp.timeWindows : (Array.isArray(emp.timeWindows) ? emp.timeWindows.join(', ') : String(emp.timeWindows))}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <Badge variant="outline" className="bg-blue-50 dark:bg-blue-900/20">
                          Available Today
                        </Badge>
                      </div>

                      <div className="space-y-4">
                        {/* Best Client Matches */}
                        <div>
                          <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            Best Client Matches (within {travelTimeLimit} minutes):
                          </h5>
                          <div className="grid gap-2 mt-2">
                            {emp.bestClientMatches.length > 0 ? (
                              emp.bestClientMatches.map((client, clientIndex) => (
                                <div 
                                  key={`${client.clientName}-${clientIndex}`} 
                                  className="flex items-center justify-between p-2 rounded-lg border bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                                >
                                  <span className="font-medium text-sm">{client.clientName}</span>
                                  <Badge variant="outline" className="text-xs bg-green-100 dark:bg-green-800">
                                    <Clock className="w-3 h-3 mr-1" />
                                    {client.travelTimeMinutes}m
                                  </Badge>
                                </div>
                              ))
                            ) : (
                              <div className="text-xs text-gray-600 dark:text-gray-300 p-2 border rounded-lg">
                                No clients within {travelTimeLimit}-minute travel time
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Rejected Clients (Travel Time Too Long) */}
                        {emp.rejectedClients && emp.rejectedClients.length > 0 && (
                          <div>
                            <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                              <AlertTriangle className="w-3 h-3 text-orange-500" />
                              Clients Beyond Travel Limit ({emp.totalRejectedClients} total):
                            </h5>
                            <div className="grid gap-2 mt-2">
                              {emp.rejectedClients.slice(0, 3).map((client, clientIndex) => (
                                <div 
                                  key={`rejected-${client.clientName}-${clientIndex}`} 
                                  className="flex items-center justify-between p-2 rounded-lg border bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800"
                                >
                                  <span className="text-sm text-gray-700 dark:text-gray-300">{client.clientName}</span>
                                  <Badge variant="outline" className="text-xs bg-orange-100 dark:bg-orange-800">
                                    <Clock className="w-3 h-3 mr-1" />
                                    {client.travelTimeMinutes}m
                                  </Badge>
                                </div>
                              ))}
                              {emp.totalRejectedClients! > 3 && (
                                <div className="text-xs text-gray-500 p-2">
                                  +{emp.totalRejectedClients! - 3} more clients exceed {travelTimeLimit}min limit...
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {isLoadingOptimization && (
            <div className="mb-8">
              <Card className="glass">
                <CardContent className="p-6 text-center">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                  <p className="text-gray-600 dark:text-gray-300">Loading travel optimization...</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Travel Constraint Controls */}
          <Card className="glass mb-6">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  Travel Constraints
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                  className="text-xs"
                  data-testid="button-toggle-advanced"
                >
                  <Sliders className="w-3 h-3 mr-1" />
                  {showAdvancedSettings ? 'Hide' : 'Show'} Advanced
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Travel Time Limit */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Preferred Travel Time Limit: {travelTimeLimit} minutes
                  </Label>
                  <Input
                    type="range"
                    value={travelTimeLimit}
                    onChange={(e) => setTravelTimeLimit(parseInt(e.target.value))}
                    max={60}
                    min={5}
                    step={5}
                    className="w-full"
                    data-testid="slider-travel-time"
                  />
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>5 min</span>
                    <span>60 min</span>
                  </div>
                </div>

                {/* Constraint Flexibility */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Constraint Mode</Label>
                    <div className="flex items-center space-x-2">
                      <Label className="text-xs text-gray-500">Hard</Label>
                      <Checkbox
                        checked={useSoftConstraints}
                        onCheckedChange={(checked) => setUseSoftConstraints(checked === true)}
                        data-testid="switch-soft-constraints"
                      />
                      <Label className="text-xs text-gray-500">Soft</Label>
                    </div>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {useSoftConstraints 
                      ? "Allow longer travel times with penalties (more flexible)"
                      : "Strictly reject assignments exceeding travel limit (stricter)"
                    }
                  </p>
                </div>
              </div>

              {/* Advanced Settings */}
              {showAdvancedSettings && (
                <div className="border-t pt-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Maximum Travel Time (for soft constraints) */}
                    {useSoftConstraints && (
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">
                          Maximum Travel Time: {maxTravelTime} minutes
                        </Label>
                        <Input
                          type="range"
                          value={maxTravelTime}
                          onChange={(e) => setMaxTravelTime(parseInt(e.target.value))}
                          max={120}
                          min={travelTimeLimit}
                          step={5}
                          className="w-full"
                          data-testid="slider-max-travel"
                        />
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          Hard cutoff for soft constraints (beyond this time, assignments are rejected)
                        </p>
                      </div>
                    )}

                    {/* Constraint Summary */}
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Current Settings</Label>
                      <div className="text-xs space-y-1 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <div>• Preferred limit: <strong>{travelTimeLimit} minutes</strong></div>
                        <div>• Mode: <strong>{useSoftConstraints ? 'Soft penalties' : 'Hard cutoff'}</strong></div>
                        {useSoftConstraints && (
                          <div>• Maximum allowed: <strong>{maxTravelTime} minutes</strong></div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                Select Date for Route Optimization
              </label>
              <Select value={optimizationDate} onValueChange={setOptimizationDate}>
                <SelectTrigger className="w-full" data-testid="select-optimization-date">
                  <SelectValue placeholder="Select date" />
                </SelectTrigger>
                <SelectContent>
                  {availableDates.map((date) => (
                    <SelectItem key={date} value={date}>
                      {new Date(date).toLocaleDateString('en-GB', { 
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
            <div className="flex gap-2 sm:items-end">
              <Button
                onClick={handleGeocode}
                disabled={geocodeMutation.isPending}
                variant="outline"
                className="flex items-center gap-2"
                data-testid="button-geocode"
              >
                {geocodeMutation.isPending ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Target className="w-4 h-4" />
                )}
                Geocode Locations
              </Button>
              <Button
                onClick={handleOptimizeRoutes}
                disabled={optimizeMutation.isPending || employeeStats.geocoded === 0}
                className="bg-gradient-to-r from-emerald-600 to-blue-600 hover:from-emerald-700 hover:to-blue-700 text-white"
                data-testid="button-optimize"
              >
                {optimizeMutation.isPending ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Route className="w-4 h-4 mr-2" />
                )}
                Optimize Routes
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Employee Locations Stats */}
        <Card className="glass hover-lift">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                <Users className="w-4 h-4 text-white" />
              </div>
              <span className="text-gray-700 dark:text-gray-300">Employee Locations</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">Total Employees</span>
                <Badge variant="outline" data-testid="stat-total-employees">{employeeStats.total}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">Geocoded</span>
                <Badge 
                  variant={employeeStats.geocoded === employeeStats.total ? "default" : "secondary"}
                  data-testid="stat-geocoded-employees"
                >
                  {employeeStats.geocoded}/{employeeStats.total}
                </Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-1">
                  <Car className="w-3 h-3" />
                  Car Access
                </span>
                <Badge variant="outline" data-testid="stat-car-employees">{employeeStats.withCar}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Client Locations Stats */}
        <Card className="glass hover-lift">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
                <MapPin className="w-4 h-4 text-white" />
              </div>
              <span className="text-gray-700 dark:text-gray-300">Client Locations</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">Total Clients</span>
                <Badge variant="outline" data-testid="stat-total-clients">{clientStats.total}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">Geocoded</span>
                <Badge 
                  variant={clientStats.geocoded === clientStats.total ? "default" : "secondary"}
                  data-testid="stat-geocoded-clients"
                >
                  {clientStats.geocoded}/{clientStats.total}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Route Plans Stats */}
        <Card className="glass hover-lift">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center">
                <Route className="w-4 h-4 text-white" />
              </div>
              <span className="text-gray-700 dark:text-gray-300">Route Plans</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">Total Routes</span>
                <Badge variant="outline" data-testid="stat-total-routes">{routeStats.total}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">Optimized</span>
                <Badge variant="default" data-testid="stat-optimized-routes">{routeStats.optimized}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">Infeasible</span>
                <Badge variant="destructive" data-testid="stat-infeasible-routes">{routeStats.infeasible}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Employee Locations Table */}
      <Card className="glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Employee Locations ({employeeStats.total})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingEmployees ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee Name</TableHead>
                  <TableHead>Postcode</TableHead>
                  <TableHead>Transport</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Coordinates</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employeeLocations?.map((employee) => (
                  <TableRow key={employee.id}>
                    <TableCell>
                      <span className={getGenderColorClass(employee.employeeName)}>
                        {employee.employeeName}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{employee.homePostcode}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="flex items-center gap-1 w-fit">
                        {employee.transportMode === "car" ? (
                          <Car className="w-3 h-3" />
                        ) : (
                          <Users className="w-3 h-3" />
                        )}
                        {employee.transportMode || "car"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {employee.homeLat && employee.homeLng ? (
                        <Badge variant="default" className="bg-green-600">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Geocoded
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          Pending
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-gray-500">
                      {employee.homeLat && employee.homeLng 
                        ? `${parseFloat(employee.homeLat).toFixed(4)}, ${parseFloat(employee.homeLng).toFixed(4)}`
                        : "—"
                      }
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Route Plans Table */}
      {routePlans && routePlans.length > 0 && (
        <Card className="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Route className="w-5 h-5" />
              Route Plans for {new Date(optimizationDate).toLocaleDateString('en-GB', { 
                weekday: 'long', 
                day: 'numeric', 
                month: 'long' 
              })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingRoutes ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Distance</TableHead>
                    <TableHead>Travel Time</TableHead>
                    <TableHead>Stops</TableHead>
                    <TableHead>Warnings</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {routePlans.map((plan: RoutePlan) => (
                    <TableRow key={plan.routePlanId}>
                      <TableCell>
                        <span className={getGenderColorClass(plan.employeeName)}>
                          {plan.employeeName}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant={
                            plan.status === "optimized" ? "default" :
                            plan.status === "infeasible" ? "destructive" : "secondary"
                          }
                        >
                          {plan.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {plan.totalDistanceKm ? `${parseFloat(plan.totalDistanceKm).toFixed(1)} km` : "—"}
                      </TableCell>
                      <TableCell>
                        {plan.totalTravelMinutes ? `${plan.totalTravelMinutes} min` : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {plan.stops.length} stops
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {Array.isArray(plan.warnings) && plan.warnings.length > 0 ? (
                          <Badge variant="destructive" className="text-xs">
                            <AlertTriangle className="w-3 h-3 mr-1" />
                            {plan.warnings.length} warnings
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Detailed Route Stops Display */}
      {routePlans && routePlans.length > 0 && routePlans.some(plan => plan.stops.length > 0) && (
        <Card className="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Navigation className="w-5 h-5" />
              Multi-Stop Route Details for {new Date(optimizationDate).toLocaleDateString('en-GB', { 
                weekday: 'long', 
                day: 'numeric', 
                month: 'long' 
              })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {routePlans
                .filter(plan => plan.stops.length > 0)
                .map((plan: RoutePlan) => (
                  <div key={plan.routePlanId} className="border rounded-lg p-4 bg-gradient-to-r from-blue-50 to-green-50 dark:from-blue-900/20 dark:to-green-900/20">
                    {/* Route Header */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white ${getGenderColorClass(plan.employeeName)}`}>
                          {plan.employeeName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <h4 className={`font-semibold text-lg ${getGenderColorClass(plan.employeeName)}`}>
                            {plan.employeeName}
                          </h4>
                          <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-300">
                            <div className="flex items-center gap-1">
                              <Route className="w-4 h-4" />
                              <span>{plan.stops.length} stops</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Clock className="w-4 h-4" />
                              <span>{plan.totalTravelMinutes} min travel</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <MapPin className="w-4 h-4" />
                              <span>{parseFloat(plan.totalDistanceKm).toFixed(1)} km total</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <Badge 
                        variant={plan.status === "optimized" ? "default" : "destructive"}
                        className="text-sm"
                      >
                        {plan.status}
                      </Badge>
                    </div>

                    {/* Route Timeline */}
                    <div className="space-y-3">
                      {plan.stops
                        .sort((a, b) => a.sequence - b.sequence)
                        .map((stop, index) => (
                          <div key={stop.visitId} className="flex items-center gap-4">
                            {/* Sequence Number */}
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">
                              {stop.sequence}
                            </div>
                            
                            {/* Stop Details */}
                            <div className="flex-1 bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                              <div className="flex items-center justify-between">
                                <div>
                                  <h5 className="font-medium text-gray-900 dark:text-white">
                                    {stop.clientName}
                                  </h5>
                                  <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-300 mt-1">
                                    <div className="flex items-center gap-1">
                                      <Clock className="w-3 h-3" />
                                      <span>{stop.scheduledStart} - {stop.scheduledEnd}</span>
                                    </div>
                                    {index > 0 && (
                                      <div className="flex items-center gap-1">
                                        <Car className="w-3 h-3" />
                                        <span>{stop.travelMinutesFromPrev} min from previous</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="text-right">
                                  <Badge variant="outline" className="text-xs">
                                    Visit {stop.sequence}
                                  </Badge>
                                </div>
                              </div>
                            </div>

                            {/* Travel Arrow (except for last stop) */}
                            {index < plan.stops.length - 1 && (
                              <div className="flex-shrink-0 w-6 h-6 text-gray-400">
                                <ArrowRight className="w-full h-full" />
                              </div>
                            )}
                          </div>
                        ))}
                    </div>

                    {/* Route Summary */}
                    <div className="mt-4 p-3 bg-white/50 dark:bg-gray-800/50 rounded-lg border">
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                          <div className="text-lg font-semibold text-blue-600 dark:text-blue-400">
                            {plan.stops.length}
                          </div>
                          <div className="text-xs text-gray-600 dark:text-gray-300">Total Visits</div>
                        </div>
                        <div>
                          <div className="text-lg font-semibold text-green-600 dark:text-green-400">
                            {plan.totalTravelMinutes}m
                          </div>
                          <div className="text-xs text-gray-600 dark:text-gray-300">Travel Time</div>
                        </div>
                        <div>
                          <div className="text-lg font-semibold text-purple-600 dark:text-purple-400">
                            {parseFloat(plan.totalDistanceKm).toFixed(1)}km
                          </div>
                          <div className="text-xs text-gray-600 dark:text-gray-300">Total Distance</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info Alert */}
      <Alert>
        <Navigation className="h-4 w-4" />
        <AlertDescription>
          <strong>Route Optimization Process:</strong> First geocode all employee and client locations, 
          then run route optimization to create efficient schedules with 15-minute travel constraints. 
          The system minimizes total travel time while ensuring feasible routes.
        </AlertDescription>
      </Alert>
    </div>
  );
}