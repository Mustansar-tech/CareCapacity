import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CalendarDays, Users, Car, PersonStanding } from "lucide-react";
import type { CapacityAnalysis, EmployeeSummaryRecord } from "@shared/schema";

interface EmployeeWeeklyData {
  employeeName: string;
  transportMode?: string;
  weekData: {
    [dayOfWeek: string]: {
      freeHours: number;
      windowCount: number;
      freeWindows: string;
      cancelledVisits: string;
    };
  };
}

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_ABBREVIATIONS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function TransportModeIcon({ transportMode }: { transportMode?: string }) {
  if (!transportMode || transportMode.trim() === '') return null;
  
  const mode = transportMode.toLowerCase();
  
  if (mode.includes('car') || mode.includes('driver') || mode.includes('vehicle')) {
    return (
      <div 
        title="Driver" 
        aria-label="Transport mode: driver" 
        className="inline-flex items-center justify-center w-6 h-6 bg-gradient-to-br from-blue-500 to-blue-700 dark:from-blue-400 dark:to-blue-600 rounded-full shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-110"
      >
        <Car className="w-3 h-3 text-white" />
      </div>
    );
  } else if (mode.includes('walk') || mode.includes('walker')) {
    return (
      <div 
        title="Walker" 
        aria-label="Transport mode: walker" 
        className="inline-flex items-center justify-center w-6 h-6 bg-gradient-to-br from-emerald-500 to-green-600 dark:from-emerald-400 dark:to-green-500 rounded-full shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-110"
      >
        <PersonStanding className="w-3 h-3 text-white" />
      </div>
    );
  }
  
  return null;
}

function HeatmapCell({ 
  dayData, 
  employeeName, 
  dayName 
}: { 
  dayData: EmployeeWeeklyData['weekData'][string];
  employeeName: string;
  dayName: string;
}) {
  const freeHours = dayData?.freeHours || 0;
  const windowCount = dayData?.windowCount || 0;
  const freeWindows = dayData?.freeWindows || '';
  const cancelledVisits = dayData?.cancelledVisits || '';

  // Color intensity based on free hours (0-8+ hours) with beautiful gradients
  const getColorIntensity = (hours: number) => {
    if (hours === 0) return "bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800/40 dark:to-gray-900/60 text-gray-500 dark:text-gray-400 shadow-inner";
    if (hours <= 2) return "bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/30 dark:to-emerald-800/50 text-emerald-700 dark:text-emerald-300 shadow-sm";
    if (hours <= 4) return "bg-gradient-to-br from-emerald-100 to-emerald-200 dark:from-emerald-800/50 dark:to-emerald-700/70 text-emerald-800 dark:text-emerald-200 shadow-md";
    if (hours <= 6) return "bg-gradient-to-br from-emerald-200 to-emerald-300 dark:from-emerald-700/70 dark:to-emerald-600/90 text-emerald-900 dark:text-emerald-100 shadow-lg";
    return "bg-gradient-to-br from-emerald-400 to-emerald-500 dark:from-emerald-600 dark:to-emerald-500 text-white dark:text-white shadow-xl shadow-emerald-200/50 dark:shadow-emerald-900/30";
  };

  const tooltipContent = (
    <div className="space-y-2 max-w-xs">
      <div className="font-semibold">{employeeName} - {dayName}</div>
      <div>
        <div className="text-sm text-gray-600 dark:text-gray-300">
          Free Hours: <span className="font-medium">{freeHours.toFixed(1)}h</span>
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-300">
          Windows: <span className="font-medium">{windowCount}</span>
        </div>
      </div>
      <div>
        <div className="text-sm font-medium text-blue-600 dark:text-blue-400 mb-1">Free Times:</div>
        <div className="text-xs font-mono bg-blue-50 dark:bg-blue-900/30 p-2 rounded border">
          {(freeWindows && freeWindows !== "None" && freeWindows !== "—" && freeWindows.trim() !== "") 
            ? freeWindows 
            : "No availability"}
        </div>
      </div>
      {cancelledVisits && cancelledVisits !== "None" && cancelledVisits !== "—" && cancelledVisits.trim() !== "" && (
        <div>
          <div className="text-sm font-medium text-red-600 dark:text-red-400 mb-1">Cancelled:</div>
          <div className="text-xs font-mono bg-red-50 dark:bg-red-900/30 p-2 rounded border">
            {cancelledVisits}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div 
          className={`
            relative h-20 w-full rounded-xl border border-white/20 dark:border-gray-600/30 
            cursor-pointer transition-all duration-300 hover:scale-105 hover:shadow-2xl
            flex flex-col items-center justify-center p-3 backdrop-blur-sm
            transform hover:-translate-y-1
            ${getColorIntensity(freeHours)}
          `}
          data-testid={`heatmap-cell-${employeeName}-${dayName}`}
        >
          {freeHours > 0 ? (
            <div className="text-center w-full">
              <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 mb-1">
                Free Hours: {freeHours.toFixed(1)}h
              </div>
              <div className="text-xs font-mono leading-tight mb-1 text-blue-600 dark:text-blue-400">
                {(freeWindows && freeWindows !== "None" && freeWindows !== "—" && freeWindows.trim() !== "") ? (
                  freeWindows.replace(/[;,]/g, '\n').split('\n').map((window, idx) => (
                    <div key={idx} className="truncate">
                      {window.trim()}
                    </div>
                  ))
                ) : (
                  <div className="text-gray-500 dark:text-gray-400 italic">No availability</div>
                )}
              </div>
              {cancelledVisits && cancelledVisits !== "None" && cancelledVisits !== "—" && cancelledVisits.trim() !== "" && (
                <div className="text-xs text-red-600 dark:text-red-400 font-mono leading-tight">
                  <div className="font-semibold">Cancelled:</div>
                  <div className="truncate">
                    {cancelledVisits}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm font-bold text-gray-400">
              —
            </div>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="z-50">
        {tooltipContent}
      </TooltipContent>
    </Tooltip>
  );
}

function WeeklyHeatmap({ weeklyData }: { weeklyData: EmployeeWeeklyData[] }) {
  // Calculate column totals (team capacity by day)
  const columnTotals = DAYS_OF_WEEK.map(day => {
    const totalHours = weeklyData.reduce((sum, employee) => {
      return sum + (employee.weekData[day]?.freeHours || 0);
    }, 0);
    const totalWindows = weeklyData.reduce((sum, employee) => {
      return sum + (employee.weekData[day]?.windowCount || 0);
    }, 0);
    return { day, totalHours, totalWindows };
  });

  return (
    <div className="space-y-4">
      {/* Header with column totals */}
      <div className="sticky top-20 z-40 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="grid grid-cols-8 gap-4">
          <div className="font-semibold text-gray-600 dark:text-gray-300 flex items-center gap-2">
            <Users className="w-4 h-4" />
            Team Capacity
          </div>
          {columnTotals.map((total, index) => (
            <div key={total.day} className="text-center">
              <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                {DAY_ABBREVIATIONS[index]}
              </div>
              <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                {total.totalHours.toFixed(1)}h
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {total.totalWindows} windows
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Employee heatmap grid */}
      <div className="space-y-2">
        {/* Column headers */}
        <div className="grid grid-cols-8 gap-4 px-4 py-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
          <div className="font-semibold text-gray-700 dark:text-gray-300">Employee</div>
          {DAY_ABBREVIATIONS.map(day => (
            <div key={day} className="text-center font-medium text-gray-600 dark:text-gray-400">
              {day}
            </div>
          ))}
        </div>

        {/* Employee rows */}
        {weeklyData.map((employee) => (
          <div 
            key={employee.employeeName} 
            className="grid grid-cols-8 gap-4 items-center p-5 bg-gradient-to-r from-white to-gray-50 dark:from-gray-800/40 dark:to-gray-800/60 rounded-xl border border-gray-200/60 dark:border-gray-700/60 shadow-sm hover:shadow-md transition-all duration-300 backdrop-blur-sm"
          >
            <div className="font-medium text-gray-900 dark:text-gray-100 pr-2 flex flex-col items-start gap-2 min-w-0">
              <span className="truncate w-full text-sm font-semibold" data-testid={`text-employee-${employee.employeeName.replace(/\s+/g, '-').toLowerCase()}`}>
                {employee.employeeName}
              </span>
              <div className="h-6 flex items-center" data-testid={`icon-transport-${employee.employeeName.replace(/\s+/g, '-').toLowerCase()}`}>
                <TransportModeIcon transportMode={employee.transportMode} />
              </div>
            </div>
            {DAYS_OF_WEEK.map((day, index) => (
              <HeatmapCell
                key={day}
                dayData={employee.weekData[day]}
                employeeName={employee.employeeName}
                dayName={DAY_ABBREVIATIONS[index]}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WeeklyOverview() {
  const { data: latestData, isLoading, error } = useQuery<CapacityAnalysis>({
    queryKey: ['/api/history/latest'],
    enabled: true,
  });

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3 mb-6">
          <CalendarDays className="w-8 h-8 text-blue-600" />
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-emerald-600 bg-clip-text text-transparent">
            Weekly Overview
          </h1>
        </div>
        
        <Card>
          <CardHeader>
            <CardTitle>Employee Availability Heatmap</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Skeleton className="h-16 w-full" />
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !latestData) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center gap-3 mb-6">
          <CalendarDays className="w-8 h-8 text-blue-600" />
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-emerald-600 bg-clip-text text-transparent">
            Weekly Overview
          </h1>
        </div>
        
        <Card className="border-red-200 dark:border-red-800">
          <CardContent className="pt-6">
            <div className="text-center py-12">
              <div className="text-red-500 dark:text-red-400 text-lg font-medium mb-2">
                No Data Available
              </div>
              <p className="text-gray-600 dark:text-gray-400">
                Please upload and process Excel files in the Dashboard to view the weekly overview.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Transform the data into weekly format
  const weeklyData: EmployeeWeeklyData[] = [];
  
  if (latestData?.employeeSummaryByDate) {
    // Group all employee data by name across all dates
    const employeeDataMap = new Map<string, EmployeeWeeklyData>();
    
    // Cast the JSONB data to the proper type
    const employeeSummaryByDate = latestData.employeeSummaryByDate as Record<string, EmployeeSummaryRecord[]>;
    
    Object.entries(employeeSummaryByDate).forEach(([dateStr, employees]) => {
      const date = new Date(dateStr);
      const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' });
      
      employees.forEach((employee) => {
        if (!employeeDataMap.has(employee.employeeName)) {
          employeeDataMap.set(employee.employeeName, {
            employeeName: employee.employeeName,
            transportMode: employee.transportMode,
            weekData: {}
          });
        }
        
        const employeeWeekData = employeeDataMap.get(employee.employeeName)!;
        
        // Calculate free hours from difference (positive difference = free capacity)
        const freeHours = Math.max(0, employee.difference || 0);
        
        // Count windows from freeWindows string with robust parsing
        const freeWindowsStr = employee.freeWindows?.trim() || '';
        const windowCount = freeWindowsStr && 
                           !/^(none|—|-)$/i.test(freeWindowsStr)
          ? (freeWindowsStr.match(/\b\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2}\b/g)?.length || 
             freeWindowsStr.split(/[;,]/).map(s => s.trim()).filter(Boolean).length)
          : 0;
        
        employeeWeekData.weekData[dayOfWeek] = {
          freeHours,
          windowCount,
          freeWindows: employee.freeWindows || '—',
          cancelledVisits: employee.cancelledVisits || '—'
        };
      });
    });
    
    // Filter out employees who have no free windows across the entire week
    const allEmployees = Array.from(employeeDataMap.values());
    const employeesWithFreeWindows = allEmployees.filter(employee => {
      // Check if employee has any windows across any day of the week
      const totalWindows = DAYS_OF_WEEK.reduce((acc, day) => {
        const dayData = employee.weekData[day];
        return acc + (dayData?.windowCount || 0);
      }, 0);
      
      // Include employee only if they have windows
      return totalWindows > 0;
    });
    
    // Convert filtered employees to array and sort by employee name
    weeklyData.push(...employeesWithFreeWindows.sort((a, b) => 
      a.employeeName.localeCompare(b.employeeName)
    ));
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <CalendarDays className="w-8 h-8 text-blue-600" />
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-emerald-600 bg-clip-text text-transparent">
            Weekly Overview
          </h1>
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Business Development View
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Employee Availability Heatmap
          </CardTitle>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Visual overview of team availability and free capacity across the week
          </p>
        </CardHeader>
        <CardContent>
          {weeklyData.length > 0 ? (
            <WeeklyHeatmap weeklyData={weeklyData} />
          ) : (
            <div className="text-center py-12">
              <div className="text-gray-500 dark:text-gray-400 text-lg font-medium mb-2">
                Processing Weekly Data...
              </div>
              <p className="text-gray-400 dark:text-gray-500">
                Weekly overview will appear here once data is processed.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}