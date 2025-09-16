import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CalendarDays, Users } from "lucide-react";
import type { CapacityAnalysis, EmployeeSummaryRecord } from "@shared/schema";

interface EmployeeWeeklyData {
  employeeName: string;
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

  // Color intensity based on free hours (0-8+ hours)
  const getColorIntensity = (hours: number) => {
    if (hours === 0) return "bg-gray-100 dark:bg-gray-800 text-gray-400";
    if (hours <= 2) return "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300";
    if (hours <= 4) return "bg-emerald-200 dark:bg-emerald-800/60 text-emerald-800 dark:text-emerald-200";
    if (hours <= 6) return "bg-emerald-300 dark:bg-emerald-700/80 text-emerald-900 dark:text-emerald-100";
    return "bg-emerald-400 dark:bg-emerald-600 text-white dark:text-white";
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
      {freeWindows && freeWindows !== "None" && freeWindows !== "—" && (
        <div>
          <div className="text-sm font-medium text-blue-600 dark:text-blue-400 mb-1">Free Times:</div>
          <div className="text-xs font-mono bg-blue-50 dark:bg-blue-900/30 p-2 rounded border">
            {freeWindows}
          </div>
        </div>
      )}
      {cancelledVisits && cancelledVisits !== "None" && cancelledVisits !== "—" && (
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
            relative h-16 w-full rounded-lg border border-gray-200 dark:border-gray-700 
            cursor-pointer transition-all duration-200 hover:scale-105 hover:shadow-md
            flex flex-col items-center justify-center p-1
            ${getColorIntensity(freeHours)}
          `}
          data-testid={`heatmap-cell-${employeeName}-${dayName}`}
        >
          <div className="text-sm font-bold">
            {freeHours > 0 ? `${freeHours.toFixed(1)}h` : "—"}
          </div>
          {windowCount > 0 && (
            <Badge 
              variant="secondary" 
              className="text-xs h-4 px-1 mt-1 bg-white/70 dark:bg-gray-800/70 text-gray-700 dark:text-gray-300"
            >
              {windowCount}
            </Badge>
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
            className="grid grid-cols-8 gap-4 items-center p-4 bg-white dark:bg-gray-800/30 rounded-lg border border-gray-200 dark:border-gray-700"
          >
            <div className="font-medium text-gray-900 dark:text-gray-100 truncate pr-2">
              {employee.employeeName}
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