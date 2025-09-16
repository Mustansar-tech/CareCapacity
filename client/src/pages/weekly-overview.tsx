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
      <div title="Driver" aria-label="Transport mode: driver" className="inline-block">
        <Car className="w-4 h-4 text-blue-600 dark:text-blue-400" />
      </div>
    );
  } else if (mode.includes('walk') || mode.includes('walker')) {
    return (
      <div title="Walker" aria-label="Transport mode: walker" className="inline-block">
        <PersonStanding className="w-4 h-4 text-green-600 dark:text-green-400" />
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

  // Color intensity based on free hours with more intuitive colors
  const getColorIntensity = (hours: number) => {
    if (hours === 0) return {
      bg: "bg-gray-50 dark:bg-gray-900/50",
      text: "text-gray-500 dark:text-gray-500",
      border: "border-gray-200 dark:border-gray-700",
      label: "No availability"
    };
    if (hours <= 1.5) return {
      bg: "bg-amber-50 dark:bg-amber-900/20", 
      text: "text-amber-700 dark:text-amber-300",
      border: "border-amber-200 dark:border-amber-700",
      label: "Limited availability"
    };
    if (hours <= 3) return {
      bg: "bg-blue-50 dark:bg-blue-900/30",
      text: "text-blue-700 dark:text-blue-300", 
      border: "border-blue-200 dark:border-blue-600",
      label: "Moderate availability"
    };
    if (hours <= 5) return {
      bg: "bg-emerald-50 dark:bg-emerald-900/40",
      text: "text-emerald-700 dark:text-emerald-300",
      border: "border-emerald-200 dark:border-emerald-600", 
      label: "Good availability"
    };
    return {
      bg: "bg-green-100 dark:bg-green-800/50",
      text: "text-green-800 dark:text-green-200",
      border: "border-green-300 dark:border-green-500",
      label: "High availability"
    };
  };

  const colorInfo = getColorIntensity(freeHours);
  
  const tooltipContent = (
    <div className="space-y-3 max-w-sm">
      <div className="border-b border-gray-200 dark:border-gray-600 pb-2">
        <div className="font-semibold text-lg">{employeeName}</div>
        <div className="text-sm text-gray-600 dark:text-gray-400">{dayName}</div>
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        <div className="text-center p-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Free Hours</div>
          <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{freeHours.toFixed(1)}h</div>
        </div>
        <div className="text-center p-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Time Slots</div>
          <div className="text-lg font-bold text-blue-600 dark:text-blue-400">{windowCount}</div>
        </div>
      </div>
      
      <div className="text-xs text-center px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
        {colorInfo.label}
      </div>
      
      {freeWindows && freeWindows !== "None" && freeWindows !== "—" && freeWindows.trim() !== "" && (
        <div>
          <div className="text-sm font-medium text-blue-600 dark:text-blue-400 mb-2 flex items-center gap-1">
            <span>🕐</span> Available Times
          </div>
          <div className="text-xs font-mono bg-blue-50 dark:bg-blue-900/30 p-3 rounded-lg border border-blue-200 dark:border-blue-700 leading-relaxed">
            {freeWindows.replace(/[;,]/g, '\n').split('\n').map(window => window.trim()).filter(Boolean).join('\n')}
          </div>
        </div>
      )}
      
      {cancelledVisits && cancelledVisits !== "None" && cancelledVisits !== "—" && cancelledVisits.trim() !== "" && (
        <div>
          <div className="text-sm font-medium text-red-600 dark:text-red-400 mb-2 flex items-center gap-1">
            <span>❌</span> Cancelled Visits
          </div>
          <div className="text-xs font-mono bg-red-50 dark:bg-red-900/30 p-3 rounded-lg border border-red-200 dark:border-red-700 leading-relaxed">
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
            relative h-24 w-full rounded-xl border-2 transition-all duration-300 
            cursor-pointer hover:scale-105 hover:shadow-lg hover:shadow-black/10 dark:hover:shadow-white/5
            flex flex-col items-center justify-center p-3 group
            ${colorInfo.bg} ${colorInfo.border}
          `}
          data-testid={`heatmap-cell-${employeeName}-${dayName}`}
        >
          {freeHours > 0 ? (
            <div className="text-center w-full space-y-1">
              <div className={`text-lg font-bold ${colorInfo.text}`}>
                {freeHours.toFixed(1)}h
              </div>
              <div className="text-xs opacity-75 uppercase tracking-wide font-medium">
                {windowCount} {windowCount === 1 ? 'slot' : 'slots'}
              </div>
              {windowCount > 0 && (
                <div className="w-full bg-white/50 dark:bg-gray-900/30 h-1 rounded-full mt-2">
                  <div 
                    className={`h-full rounded-full ${colorInfo.text.replace('text-', 'bg-')} opacity-60`}
                    style={{ width: `${Math.min(100, (windowCount / 4) * 100)}%` }}
                  />
                </div>
              )}
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
            <div className="text-center w-full space-y-1">
              <div className={`text-sm font-medium ${colorInfo.text}`}>
                Not available
              </div>
              <div className="text-xs opacity-60 uppercase tracking-wide">
                No slots
              </div>
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

  // Legend data for color coding
  const legendItems = [
    { hours: 0, label: "No availability", description: "Employee not available" },
    { hours: 1, label: "Limited availability", description: "1-1.5 hours available" },
    { hours: 2.5, label: "Moderate availability", description: "1.5-3 hours available" },
    { hours: 4, label: "Good availability", description: "3-5 hours available" },
    { hours: 6, label: "High availability", description: "5+ hours available" }
  ];

  return (
    <div className="space-y-6">
      {/* Color Legend */}
      <div className="bg-gradient-to-r from-blue-50 to-emerald-50 dark:from-blue-900/20 dark:to-emerald-900/20 rounded-xl p-4 border border-blue-200 dark:border-blue-700">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-3 h-3 bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full"></div>
          <h3 className="font-semibold text-gray-800 dark:text-gray-200">Availability Legend</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {legendItems.map((item, index) => {
            const colorInfo = {
              bg: "bg-gray-50 dark:bg-gray-900/50",
              text: "text-gray-500 dark:text-gray-500",
              border: "border-gray-200 dark:border-gray-700",
              label: "No availability"
            };
            
            if (item.hours === 0) {
              colorInfo.bg = "bg-gray-50 dark:bg-gray-900/50";
              colorInfo.text = "text-gray-500 dark:text-gray-500";
              colorInfo.border = "border-gray-200 dark:border-gray-700";
            } else if (item.hours <= 1.5) {
              colorInfo.bg = "bg-amber-50 dark:bg-amber-900/20";
              colorInfo.text = "text-amber-700 dark:text-amber-300";
              colorInfo.border = "border-amber-200 dark:border-amber-700";
            } else if (item.hours <= 3) {
              colorInfo.bg = "bg-blue-50 dark:bg-blue-900/30";
              colorInfo.text = "text-blue-700 dark:text-blue-300";
              colorInfo.border = "border-blue-200 dark:border-blue-600";
            } else if (item.hours <= 5) {
              colorInfo.bg = "bg-emerald-50 dark:bg-emerald-900/40";
              colorInfo.text = "text-emerald-700 dark:text-emerald-300";
              colorInfo.border = "border-emerald-200 dark:border-emerald-600";
            } else {
              colorInfo.bg = "bg-green-100 dark:bg-green-800/50";
              colorInfo.text = "text-green-800 dark:text-green-200";
              colorInfo.border = "border-green-300 dark:border-green-500";
            }
            
            return (
              <div key={index} className="flex items-center gap-2">
                <div 
                  className={`w-4 h-4 rounded border-2 ${colorInfo.bg} ${colorInfo.border}`}
                  title={item.description}
                />
                <div className="flex flex-col min-w-0">
                  <div className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                    {item.label}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-500 truncate">
                    {item.description}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

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
            <div className="font-medium text-gray-900 dark:text-gray-100 pr-2 flex flex-col items-start gap-1 min-w-0">
              <span className="truncate w-full" data-testid={`text-employee-${employee.employeeName.replace(/\s+/g, '-').toLowerCase()}`}>
                {employee.employeeName}
              </span>
              <div className="h-4" data-testid={`icon-transport-${employee.employeeName.replace(/\s+/g, '-').toLowerCase()}`}>
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