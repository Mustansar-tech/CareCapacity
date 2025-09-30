import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Car, User, Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { getGenderColorClass, getGenderBgColorClass } from "@/utils/gender-colors";
import type { ProcessingResult } from "@shared/schema";

interface WeeklyScheduleGridProps {
  data: ProcessingResult | null;
  selectedDate?: string | null;
}

interface DayAssignment {
  date: string;
  dayName: string;
  status: string;
  contractedHours: number;
  scheduledHours: number;
  timeWindows?: string;
}

// Get the Monday of a week containing the given date
function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

// Format date as YYYY-MM-DD
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

// Get day name from date
function getDayName(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}

export function WeeklyScheduleGrid({ data, selectedDate }: WeeklyScheduleGridProps) {
  const initialDate = selectedDate ? new Date(selectedDate) : new Date();
  const [currentMonday, setCurrentMonday] = useState(getMonday(initialDate));

  // Generate the week dates (Mon-Sun)
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(currentMonday);
    date.setDate(currentMonday.getDate() + i);
    return {
      date: formatDate(date),
      dayName: getDayName(date),
      fullDate: date,
    };
  });

  // Get all unique employees across the week
  const allEmployees = new Set<string>();
  weekDates.forEach(({ date }) => {
    const employees = data?.employeesByDate?.[date] || [];
    employees.forEach(emp => allEmployees.add(emp.employeeName));
  });
  const employeeList = Array.from(allEmployees).sort();

  // Build grid data structure: Record<employeeName, Record<date, DayAssignment>>
  const gridData: Record<string, Record<string, DayAssignment>> = {};
  employeeList.forEach(empName => {
    gridData[empName] = {};
    weekDates.forEach(({ date, dayName }) => {
      const empData = data?.employeesByDate?.[date]?.find(e => e.employeeName === empName);
      const empSummary = data?.employeeSummaryByDate?.[date]?.find(e => e.employeeName === empName);
      
      gridData[empName][date] = {
        date,
        dayName,
        status: empData?.status || 'N/A',
        contractedHours: empSummary?.availability || 0,
        scheduledHours: empSummary?.scheduledHours || 0,
        timeWindows: empData?.timeWindows,
      };
    });
  });

  // Get employee summary for transport mode and gender (use first available date)
  const getEmployeeInfo = (empName: string) => {
    for (const { date } of weekDates) {
      const summary = data?.employeeSummaryByDate?.[date]?.find(e => e.employeeName === empName);
      if (summary) {
        return summary;
      }
    }
    return null;
  };

  // Navigate weeks
  const previousWeek = () => {
    const newMonday = new Date(currentMonday);
    newMonday.setDate(currentMonday.getDate() - 7);
    setCurrentMonday(newMonday);
  };

  const nextWeek = () => {
    const newMonday = new Date(currentMonday);
    newMonday.setDate(currentMonday.getDate() + 7);
    setCurrentMonday(newMonday);
  };

  const goToToday = () => {
    setCurrentMonday(getMonday(new Date()));
  };

  // Get status color class
  const getStatusColor = (status: string) => {
    if (status === 'Available' || status === 'Partial Available') {
      return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300';
    } else if (status === 'Holiday' || status === 'Sick') {
      return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300';
    } else if (status === 'Other Unavailable' || status === 'Pre-Agreed Appointment') {
      return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300';
    } else {
      return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400';
    }
  };

  return (
    <div className="space-y-4" data-testid="weekly-schedule-grid">
      {/* Week Navigator */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Weekly Schedule Grid
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={previousWeek}
                data-testid="button-previous-week"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={goToToday}
                data-testid="button-today"
              >
                Today
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={nextWeek}
                data-testid="button-next-week"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Week of {weekDates[0].fullDate.toLocaleDateString('en-GB', { 
              day: 'numeric', 
              month: 'short', 
              year: 'numeric' 
            })}
          </p>
        </CardHeader>
      </Card>

      {/* Grid */}
      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[600px]">
            <div className="min-w-[1200px]">
              {/* Header Row */}
              <div className="grid grid-cols-8 border-b sticky top-0 bg-background z-10">
                <div className="p-3 font-semibold border-r">Employee</div>
                {weekDates.map(({ date, dayName, fullDate }) => (
                  <div 
                    key={date} 
                    className="p-3 font-semibold text-center border-r last:border-r-0"
                  >
                    <div>{dayName}</div>
                    <div className="text-xs text-muted-foreground">
                      {fullDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Employee Rows */}
              {employeeList.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  No employee data available for this week
                </div>
              ) : (
                employeeList.map((empName) => {
                  const empInfo = getEmployeeInfo(empName);
                  const isCar = empInfo?.transportMode?.toLowerCase().includes('car');
                  
                  return (
                    <div 
                      key={empName} 
                      className="grid grid-cols-8 border-b hover:bg-muted/50"
                      data-testid={`row-employee-${empName.replace(/\s+/g, '-')}`}
                    >
                      {/* Employee Name Cell */}
                      <div className="p-3 border-r flex items-center gap-2">
                        <div 
                          className={`w-3 h-3 rounded-full ${getGenderBgColorClass(empInfo?.gender)}`}
                        />
                        {isCar ? (
                          <Car className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <User className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className={`text-sm font-medium truncate ${getGenderColorClass(empInfo?.gender)}`}>
                          {empName}
                        </span>
                      </div>

                      {/* Day Cells */}
                      {weekDates.map(({ date }) => {
                        const dayData = gridData[empName][date];
                        const isAvailable = dayData.status === 'Available' || dayData.status === 'Partial Available';
                        
                        return (
                          <div 
                            key={date} 
                            className={`p-2 border-r last:border-r-0 ${getStatusColor(dayData.status)}`}
                            data-testid={`cell-${empName.replace(/\s+/g, '-')}-${date}`}
                          >
                            <div className="space-y-1">
                              <Badge 
                                variant="outline" 
                                className="text-xs w-full justify-center"
                              >
                                {dayData.status}
                              </Badge>
                              
                              {isAvailable && dayData.timeWindows && (
                                <div className="text-xs text-center truncate" title={dayData.timeWindows}>
                                  {dayData.timeWindows}
                                </div>
                              )}
                              
                              {isAvailable && (
                                <div className="text-xs text-center text-muted-foreground">
                                  {dayData.contractedHours}h / {dayData.scheduledHours}h
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Legend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Legend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-green-100 dark:bg-green-900/30 rounded" />
              <span>Available / Partial Available</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-red-100 dark:bg-red-900/30 rounded" />
              <span>Holiday / Sick</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-yellow-100 dark:bg-yellow-900/30 rounded" />
              <span>Other Unavailable</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-blue-500 rounded-full" />
              <span>Male</span>
              <div className="w-3 h-3 bg-pink-500 rounded-full ml-2" />
              <span>Female</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
