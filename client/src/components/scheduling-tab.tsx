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
  AlertCircle, Info, XCircle, TrendingUp, BarChart3, Home, Play, Square
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest, toAbsoluteUrl } from "@/lib/queryClient";
import type { ProcessingResult } from "@shared/schema";
import { getGenderColorClass } from "@/utils/gender-colors";
import { DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface SchedulingTabProps {
  data: ProcessingResult | null;
  selectedDate?: string | null;
  onDateChange?: (date: string) => void;
}

// Enhanced run-based optimization interfaces
interface RunOptimization {
  date: string;
  availableEmployees: EmployeeRunState[];
  visitCandidates: VisitCandidate[];
  optimizationStats: OptimizationStats;
}

interface EmployeeRunState {
  employeeId: string;
  employeeName: string;
  homeLocation: { lat: number; lng: number };
  currentLocation: { lat: number; lng: number };
  transportMode: 'car' | 'walking' | 'public';
  timeWindows: TimeWindow[];
  bookedVisits: BookedVisit[];
  careMinutesTotal: number;
  travelMinutesTotal: number;
  availableSlots: TimeSlot[];
}

interface TimeWindow {
  start: number; // minutes since midnight
  end: number;
}

interface BookedVisit {
  visitId: string;
  clientName: string;
  location: { lat: number; lng: number };
  startTime: number;
  endTime: number;
  duration: number;
  sequence: number;
}

interface TimeSlot {
  start: number;
  end: number;
  afterVisitId?: string;
  beforeVisitId?: string;
}

interface VisitCandidate {
  visitId: string;
  clientId: string;
  clientName: string;
  location: { lat: number; lng: number };
  requiredStart: number;
  requiredEnd: number;
  duration: number;
  priority: number;
  feasibleEmployees: EmployeeMatch[];
}

interface EmployeeMatch {
  employeeId: string;
  employeeName: string;
  feasible: boolean;
  arriveTime: number;
  addedTravelMin: number;
  gapBeforeMin: number;
  gapAfterMin: number;
  leftSlackMin: number;
  rightSlackMin: number;
  careMinutesAfter: number;
  travelMinutesAfter: number;
  score: number;
  scoreBreakdown: {
    runTightness: number;
    travel: number;
    windowSlack: number;
    homeEnd: number;
  };
  insertionPoint: {
    afterVisitId?: string;
    beforeVisitId?: string;
    slotIndex: number;
  };
  badges: string[];
}

interface OptimizationStats {
  totalVisits: number;
  assignedVisits: number;
  unassignedVisits: number;
  averageScore: number;
  employeesUtilized: number;
  totalTravelMinutes: number;
}

export function SchedulingTab({ data, selectedDate, onDateChange }: SchedulingTabProps) {
  const [optimizationDate, setOptimizationDate] = useState<string>(
    selectedDate || new Date().toISOString().split('T')[0]
  );

  // Run optimization settings
  const [maxCareMinutes, setMaxCareMinutes] = useState<number>(540); // 9 hours
  const [bufferMinutes, setBufferMinutes] = useState<number>(5);
  const [maxTravelBetweenVisits, setMaxTravelBetweenVisits] = useState<number>(30);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState<boolean>(false);

  const { toast } = useToast();

  // Update optimization date when selectedDate changes
  useEffect(() => {
    if (selectedDate) {
      setOptimizationDate(selectedDate);
    }
  }, [selectedDate]);

  // Query run optimization for selected date
  const { data: runOptimization, isLoading: isLoadingOptimization, refetch: refetchOptimization } = useQuery<RunOptimization>({
    queryKey: ['/api/run-optimization', optimizationDate],
    queryFn: () => fetch(toAbsoluteUrl(`/api/run-optimization/${optimizationDate}`), { credentials: "include" }).then(res => res.json()),
  });

  // Run optimization mutation
  const optimizeMutation = useMutation({
    mutationFn: async ({ date, settings }: { 
      date: string; 
      settings: {
        maxCareMinutes: number;
        bufferMinutes: number;
        maxTravelBetweenVisits: number;
      }
    }) => {
      const response = await apiRequest('POST', '/api/run-optimization/optimize', { 
        date, 
        ...settings 
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Run Optimization Complete",
        description: "Employee runs have been optimized with chaining logic."
      });
      refetchOptimization();
    },
    onError: (error) => {
      toast({
        title: "Run Optimization Failed",
        description: "Unable to optimize runs. Please try again.",
        variant: "destructive"
      });
    }
  });

  // Assign visit mutation
  const assignVisitMutation = useMutation({
    mutationFn: async ({ visitId, employeeId, insertionPoint }: {
      visitId: string;
      employeeId: string;
      insertionPoint: any;
    }) => {
      const response = await apiRequest('POST', '/api/run-optimization/assign', {
        visitId,
        employeeId,
        insertionPoint
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Visit Assigned",
        description: "Visit has been assigned to employee run."
      });
      refetchOptimization();
    },
    onError: (error) => {
      toast({
        title: "Assignment Failed",
        description: "Unable to assign visit. Please try again.",
        variant: "destructive"
      });
    }
  });

  // Helper functions
  const timeToMinutes = (timeStr: string): number => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  };

  const minutesToTime = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  };

  const handleOptimizeRuns = () => {
    optimizeMutation.mutate({
      date: optimizationDate,
      settings: {
        maxCareMinutes,
        bufferMinutes,
        maxTravelBetweenVisits
      }
    });
  };

  const handleAssignVisit = (visitId: string, employeeMatch: EmployeeMatch) => {
    assignVisitMutation.mutate({
      visitId,
      employeeId: employeeMatch.employeeId,
      insertionPoint: employeeMatch.insertionPoint
    });
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
                <Route className="w-5 h-5 text-white" />
              </div>
              <div>
                <span className="bg-gradient-to-r from-emerald-600 to-blue-600 bg-clip-text text-transparent">
                  Run-Based Scheduling Optimization
                </span>
                <p className="text-sm text-gray-600 dark:text-gray-300 font-normal mt-1">
                  Optimize employee runs with client-to-client chaining and tight scheduling
                </p>
              </div>
            </div>
            <Badge variant="outline" className="text-xs bg-white dark:bg-gray-800">
              <Calendar className="w-3 h-3 mr-1" />
              {optimizationDate}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          {/* Run Optimization Settings */}
          <Card className="glass mb-6">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  Run Optimization Settings
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                  className="text-xs"
                >
                  <Sliders className="w-3 h-3 mr-1" />
                  {showAdvancedSettings ? 'Hide' : 'Show'} Advanced
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Max Care Hours */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Max Care Hours: {Math.floor(maxCareMinutes / 60)}h {maxCareMinutes % 60}m
                  </Label>
                  <Input
                    type="range"
                    value={maxCareMinutes}
                    onChange={(e) => setMaxCareMinutes(parseInt(e.target.value))}
                    max={600}
                    min={300}
                    step={30}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>5h</span>
                    <span>10h</span>
                  </div>
                </div>

                {/* Buffer Time */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Handover Buffer: {bufferMinutes} minutes
                  </Label>
                  <Input
                    type="range"
                    value={bufferMinutes}
                    onChange={(e) => setBufferMinutes(parseInt(e.target.value))}
                    max={15}
                    min={0}
                    step={1}
                    className="w-full"
                  />
                </div>

                {/* Max Travel Between Visits */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Max Travel (Client→Client): {maxTravelBetweenVisits}m
                  </Label>
                  <Input
                    type="range"
                    value={maxTravelBetweenVisits}
                    onChange={(e) => setMaxTravelBetweenVisits(parseInt(e.target.value))}
                    max={60}
                    min={10}
                    step={5}
                    className="w-full"
                  />
                </div>
              </div>

              {/* Advanced Settings */}
              {showAdvancedSettings && (
                <div className="border-t pt-4 space-y-2">
                  <div className="text-xs space-y-1 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <div><strong>Run Logic:</strong> Start from home → chain client-to-client visits → optional return home</div>
                    <div><strong>Scoring:</strong> 40% run tightness + 35% travel + 15% window slack + 10% home proximity</div>
                    <div><strong>Feasibility:</strong> Care cap + time windows + travel constraints</div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                Select Date for Run Optimization
              </label>
              <Select value={optimizationDate} onValueChange={setOptimizationDate}>
                <SelectTrigger className="w-full">
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
                onClick={handleOptimizeRuns}
                disabled={optimizeMutation.isPending}
                className="bg-gradient-to-r from-emerald-600 to-blue-600 hover:from-emerald-700 hover:to-blue-700 text-white"
              >
                {optimizeMutation.isPending ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4 mr-2" />
                )}
                Optimize Runs
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Optimization Results */}
      {runOptimization && (
        <>
          {/* Statistics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="glass hover-lift">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Total Visits</p>
                    <p className="text-2xl font-bold text-blue-600">{runOptimization.optimizationStats.totalVisits}</p>
                  </div>
                  <Calendar className="w-8 h-8 text-blue-500" />
                </div>
              </CardContent>
            </Card>

            <Card className="glass hover-lift">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Assigned</p>
                    <p className="text-2xl font-bold text-green-600">{runOptimization.optimizationStats.assignedVisits}</p>
                  </div>
                  <CheckCircle className="w-8 h-8 text-green-500" />
                </div>
              </CardContent>
            </Card>

            <Card className="glass hover-lift">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Employees Used</p>
                    <p className="text-2xl font-bold text-purple-600">{runOptimization.optimizationStats.employeesUtilized}</p>
                  </div>
                  <Users className="w-8 h-8 text-purple-500" />
                </div>
              </CardContent>
            </Card>

            <Card className="glass hover-lift">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Avg Score</p>
                    <p className="text-2xl font-bold text-orange-600">{runOptimization.optimizationStats.averageScore.toFixed(1)}</p>
                  </div>
                  <TrendingUp className="w-8 h-8 text-orange-500" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Employee Run States */}
          <Card className="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Employee Run States ({runOptimization.availableEmployees.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4">
                {runOptimization.availableEmployees.map((employee) => (
                  <Card key={employee.employeeId} className="border border-gray-200 dark:border-gray-700">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white ${getGenderColorClass(employee.employeeName)}`}>
                            {employee.employeeName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <h4 className={`font-semibold ${getGenderColorClass(employee.employeeName)}`}>
                              {employee.employeeName}
                            </h4>
                            <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-300">
                              <div className="flex items-center gap-1">
                                {employee.transportMode === 'car' ? <Car className="w-3 h-3" /> : <Users className="w-3 h-3" />}
                                <span>{employee.transportMode}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                <span>{Math.floor(employee.careMinutesTotal / 60)}h {employee.careMinutesTotal % 60}m care</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Route className="w-3 h-3" />
                                <span>{employee.travelMinutesTotal}m travel</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        <Badge variant={employee.bookedVisits.length > 0 ? "default" : "outline"}>
                          {employee.bookedVisits.length} visits
                        </Badge>
                      </div>

                      {/* Run Timeline */}
                      {employee.bookedVisits.length > 0 && (
                        <div className="space-y-2 mb-4">
                          <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300">Today's Run:</h5>
                          <div className="flex items-center gap-2 text-xs">
                            <div className="flex items-center gap-1 px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/20">
                              <Home className="w-3 h-3" />
                              <span>Start</span>
                            </div>
                            {employee.bookedVisits
                              .sort((a, b) => a.sequence - b.sequence)
                              .map((visit, index) => (
                                <React.Fragment key={visit.visitId}>
                                  <ArrowRight className="w-3 h-3 text-gray-400" />
                                  <div className="flex items-center gap-1 px-2 py-1 rounded bg-green-100 dark:bg-green-900/20">
                                    <span>{visit.clientName}</span>
                                    <span className="text-gray-500">
                                      {minutesToTime(visit.startTime)}-{minutesToTime(visit.endTime)}
                                    </span>
                                  </div>
                                </React.Fragment>
                              ))}
                            <ArrowRight className="w-3 h-3 text-gray-400" />
                            <div className="flex items-center gap-1 px-2 py-1 rounded bg-gray-100 dark:bg-gray-900/20">
                              <Home className="w-3 h-3" />
                              <span>End</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Available Slots */}
                      {employee.availableSlots.length > 0 && (
                        <div>
                          <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Available Slots:</h5>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            {employee.availableSlots.map((slot, index) => (
                              <div key={index} className="px-2 py-1 rounded border border-dashed border-gray-300 dark:border-gray-600 text-xs">
                                {minutesToTime(slot.start)} - {minutesToTime(slot.end)}
                                {slot.afterVisitId && (
                                  <span className="text-gray-500 ml-1">(after visit)</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Visit Candidates with Employee Matches */}
          {runOptimization.visitCandidates.length > 0 && (
            <Card className="glass">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="w-5 h-5" />
                  Visit Assignment Candidates ({runOptimization.visitCandidates.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {runOptimization.visitCandidates.map((visit) => (
                    <Card key={visit.visitId} className="border border-orange-200 dark:border-orange-800">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h4 className="font-semibold text-lg">{visit.clientName}</h4>
                            <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-300">
                              <div className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                <span>{minutesToTime(visit.requiredStart)} - {minutesToTime(visit.requiredEnd)}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Users className="w-3 h-3" />
                                <span>{visit.duration}m duration</span>
                              </div>
                              <Badge variant="outline">Priority {visit.priority}</Badge>
                            </div>
                          </div>
                          <Badge variant={visit.feasibleEmployees.length > 0 ? "default" : "destructive"}>
                            {visit.feasibleEmployees.length} feasible matches
                          </Badge>
                        </div>

                        {/* Employee Matches */}
                        {visit.feasibleEmployees.length > 0 ? (
                          <div className="grid gap-3">
                            <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                              Best Employee Matches (sorted by score):
                            </h5>
                            {visit.feasibleEmployees
                              .filter(emp => emp.feasible)
                              .sort((a, b) => b.score - a.score)
                              .slice(0, 3)
                              .map((empMatch) => (
                                <div key={empMatch.employeeId} className="p-3 rounded-lg border bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <span className={`font-medium ${getGenderColorClass(empMatch.employeeName)}`}>
                                        {empMatch.employeeName}
                                      </span>
                                      <Badge variant="outline" className="text-xs">
                                        Score: {empMatch.score.toFixed(1)}
                                      </Badge>
                                    </div>
                                    <Button
                                      size="sm"
                                      onClick={() => handleAssignVisit(visit.visitId, empMatch)}
                                      disabled={assignVisitMutation.isPending}
                                      className="bg-green-600 hover:bg-green-700 text-white"
                                    >
                                      {assignVisitMutation.isPending ? (
                                        <RefreshCw className="w-3 h-3 animate-spin" />
                                      ) : (
                                        <Play className="w-3 h-3" />
                                      )}
                                      Assign
                                    </Button>
                                  </div>

                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                                    <div>
                                      <span className="text-gray-500">Arrive:</span>
                                      <span className="ml-1 font-medium">{minutesToTime(empMatch.arriveTime)}</span>
                                    </div>
                                    <div>
                                      <span className="text-gray-500">Travel:</span>
                                      <span className="ml-1 font-medium">+{empMatch.addedTravelMin}m</span>
                                    </div>
                                    <div>
                                      <span className="text-gray-500">Slack:</span>
                                      <span className="ml-1 font-medium">L:{empMatch.leftSlackMin}m R:{empMatch.rightSlackMin}m</span>
                                    </div>
                                    <div>
                                      <span className="text-gray-500">Care after:</span>
                                      <span className="ml-1 font-medium">{Math.floor(empMatch.careMinutesAfter / 60)}h{empMatch.careMinutesAfter % 60}m</span>
                                    </div>
                                  </div>

                                  {/* Badges */}
                                  {empMatch.badges.length > 0 && (
                                    <div className="flex gap-1 mt-2">
                                      {empMatch.badges.map((badge, index) => (
                                        <Badge key={index} variant="secondary" className="text-xs">
                                          {badge}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                          </div>
                        ) : (
                          <div className="p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
                            <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                              <AlertTriangle className="w-4 h-4" />
                              <span className="text-sm">No feasible employee matches found for this visit</span>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {isLoadingOptimization && (
        <Card className="glass">
          <CardContent className="p-6 text-center">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
            <p className="text-gray-600 dark:text-gray-300">Loading run optimization...</p>
          </CardContent>
        </Card>
      )}

      {/* Info Alert */}
      <Alert>
        <Route className="h-4 w-4" />
        <AlertDescription>
          <strong>Run-Based Chaining:</strong> Employees start from home, chain visits client-to-client without returning home between visits, 
          optimizing for tight schedules with minimal travel time and maximum care efficiency.
        </AlertDescription>
      </Alert>
    </div>
  );
}