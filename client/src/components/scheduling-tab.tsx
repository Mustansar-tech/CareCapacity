import React, { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  MapPin, Route, Clock, Car, Navigation, AlertTriangle, CheckCircle, 
  RefreshCw, Zap, Target, Users, Calendar, ArrowRight
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

// Simplified backend-processed interfaces
interface TravelOptimization {
  date: string;
  totalAvailableEmployees: number;
  employees: EmployeeSchedule[];
}

interface EmployeeSchedule {
  employeeName: string;
  postcode: string;
  bestClientMatches: ClientMatch[];
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

interface RoutePlan {
  id: string;
  date: string;
  employeeId: string;
  status: "optimized" | "manual" | "infeasible" | null;
  totalDistanceKm: string | null;
  totalTravelMinutes: number | null;
  warnings: unknown;
  stops?: RouteStop[];
}

interface RouteStop {
  id: string;
  routePlanId: string;
  visitId: string;
  sequence: number;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  travelMinutesFromPrev: number | null;
  distanceKmFromPrev: string | null;
}

export function SchedulingTab({ data, selectedDate, onDateChange }: SchedulingTabProps) {
  const [optimizationDate, setOptimizationDate] = useState<string>(
    selectedDate || new Date().toISOString().split('T')[0]
  );
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
  const { data: routePlans, isLoading: isLoadingRoutes, refetch: refetchRoutes } = useQuery<RoutePlan[]>({
    queryKey: ['/api/routing/plans', optimizationDate],
    queryFn: () => fetch(`/api/routing/plans?date=${optimizationDate}`).then(res => res.json()),
  });

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
    mutationFn: async ({ date, employeeIds }: { date: string; employeeIds: string[] }) => {
      const response = await apiRequest('POST', '/api/routing/optimize', { date, employeeIds });
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
      employeeIds: geocodedEmployees.map(emp => emp.employeeName)
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
    total: routePlans?.length || 0,
    optimized: routePlans?.filter((plan: RoutePlan) => plan.status === "optimized").length || 0,
    infeasible: routePlans?.filter((plan: RoutePlan) => plan.status === "infeasible").length || 0,
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
                  Optimize employee routes with 15-minute travel constraints and geographical proximity
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
          {/* Simplified Employee-Client Matching Results */}
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
                            <h4 className={`font-medium ${getGenderColorClass(emp.employeeName, true)}`}>
                              {emp.employeeName}
                            </h4>
                            <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                              <MapPin className="w-3 h-3" />
                              <span>{emp.postcode}</span>
                            </div>
                          </div>
                        </div>
                        <Badge variant="outline" className="bg-blue-50 dark:bg-blue-900/20">
                          Available Today
                        </Badge>
                      </div>

                      <div className="space-y-2">
                        <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          Best Client Matches (within 15 minutes):
                        </h5>
                        <div className="grid gap-2">
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
                              No clients within 15-minute travel time
                            </div>
                          )}
                        </div>
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
                  {routePlans?.map((plan: RoutePlan) => {
                    const employee = employeeLocations?.find(emp => emp.id === plan.employeeId);
                    return (
                      <TableRow key={plan.id}>
                        <TableCell>
                          <span className={employee ? getGenderColorClass(employee.employeeName) : ""}>
                            {employee?.employeeName || plan.employeeId}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant={
                              plan.status === "optimized" ? "default" :
                              plan.status === "infeasible" ? "destructive" : "secondary"
                            }
                          >
                            {plan.status || "unknown"}
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
                            {plan.stops?.length || 0} stops
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
                    );
                  })}
                </TableBody>
              </Table>
            )}
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