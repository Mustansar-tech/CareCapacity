import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Calendar, Users, Clock, Car, PersonStanding, 
  Eye, CheckCircle, AlertTriangle, XCircle 
} from "lucide-react";
import type { ProcessingResult } from "@shared/schema";
import { getGenderColorClass, getGenderBgColorClass } from "@/utils/gender-colors";

// Company's 11 standardized time blocks
const COMPANY_TIME_BLOCKS = [
  { start: '08:00', end: '09:00', label: '08:00-09:00' },
  { start: '09:15', end: '10:15', label: '09:15-10:15' },
  { start: '10:30', end: '11:30', label: '10:30-11:30' },
  { start: '11:45', end: '12:45', label: '11:45-12:45' },
  { start: '13:00', end: '14:00', label: '13:00-14:00' },
  { start: '14:15', end: '15:15', label: '14:15-15:15' },
  { start: '15:30', end: '16:30', label: '15:30-16:30' },
  { start: '16:45', end: '17:45', label: '16:45-17:45' },
  { start: '18:00', end: '19:00', label: '18:00-19:00' },
  { start: '19:15', end: '20:15', label: '19:15-20:15' },
  { start: '20:30', end: '21:30', label: '20:30-21:30' },
];

interface TimeBlock {
  start: string;
  end: string;
  label: string;
}

interface EmployeeAvailabilityInfo {
  name: string;
  gender?: string;
  transportMode?: string;
  freeWindows: string;
}

interface BDMatrixCell {
  count: number;
  employees: EmployeeAvailabilityInfo[];
  colorClass: string;
}

interface BDMatrixProps {
  data: ProcessingResult | null;
}

// Processing functions (inline for now)
function timeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

function isFullyAvailableInTimeBlock(freeWindows: string, timeBlock: TimeBlock): boolean {
  if (!freeWindows || freeWindows === '-' || freeWindows === '') {
    return false;
  }

  const blockStart = timeToMinutes(timeBlock.start);
  const blockEnd = timeToMinutes(timeBlock.end);

  const windows = freeWindows.split(',').map(w => w.trim()).filter(w => w);
  
  for (const window of windows) {
    if (window.includes('-')) {
      const [startStr, endStr] = window.split('-').map(s => s.trim());
      const windowStart = timeToMinutes(startStr);
      const windowEnd = timeToMinutes(endStr);
      
      if (windowStart <= blockStart && windowEnd >= blockEnd) {
        return true;
      }
    }
  }
  
  return false;
}

function getColorClass(count: number): string {
  if (count <= 1) return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 border-red-200 dark:border-red-800/50';
  if (count <= 3) return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800/50';
  return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border-green-200 dark:border-green-800/50';
}

function getStatusIcon(count: number) {
  if (count === 0) return <XCircle className="w-4 h-4" />;
  if (count === 1) return <AlertTriangle className="w-4 h-4" />;
  if (count <= 3) return <CheckCircle className="w-4 h-4" />;
  return <Users className="w-4 h-4" />;
}

function TransportModeIcon({ transportMode }: { transportMode?: string }) {
  if (!transportMode || transportMode.trim() === '') return null;
  
  const mode = transportMode.toLowerCase();
  
  if (mode.includes('car') || mode.includes('driver')) {
    return (
      <div title="Car" aria-label="Transport mode: car" className="inline-block">
        <Car className="w-4 h-4 text-blue-600 dark:text-blue-400" />
      </div>
    );
  } else if (mode.includes('walk')) {
    return (
      <div title="Walking" aria-label="Transport mode: walking" className="inline-block">
        <PersonStanding className="w-4 h-4 text-green-600 dark:text-green-400" />
      </div>
    );
  }
  
  return null;
}

function formatDateForDisplay(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T00:00:00.000Z');
    return date.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: '2-digit' });
  } catch (error) {
    return dateStr;
  }
}

function getDayOfWeek(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T00:00:00.000Z');
    return date.toLocaleDateString('en-GB', { weekday: 'long' });
  } catch (error) {
    return 'Unknown';
  }
}

export default function BDMatrix({ data }: BDMatrixProps) {
  const [selectedCell, setSelectedCell] = useState<{
    date: string;
    timeBlock: string;
    employees: EmployeeAvailabilityInfo[];
  } | null>(null);

  const matrixData = useMemo(() => {
    if (!data?.employeeSummaryByDate) return null;

    const dates = Object.keys(data.employeeSummaryByDate).sort();
    const matrix: Record<string, Record<string, BDMatrixCell>> = {};

    // Initialize matrix structure
    for (const date of dates) {
      matrix[date] = {};
      for (const timeBlock of COMPANY_TIME_BLOCKS) {
        matrix[date][timeBlock.label] = {
          count: 0,
          employees: [],
          colorClass: getColorClass(0)
        };
      }
    }

    // Process each date's employee data
    for (const date of dates) {
      const employees = data.employeeSummaryByDate[date] || [];
      
      for (const employee of employees) {
        for (const timeBlock of COMPANY_TIME_BLOCKS) {
          if (isFullyAvailableInTimeBlock(employee.freeWindows, timeBlock)) {
            const cell = matrix[date][timeBlock.label];
            cell.count++;
            cell.employees.push({
              name: employee.employeeName,
              gender: employee.gender,
              transportMode: employee.transportMode,
              freeWindows: employee.freeWindows
            });
            cell.colorClass = getColorClass(cell.count);
          }
        }
      }
    }

    return { dates, matrix };
  }, [data]);

  if (!data) {
    return (
      <div className="p-8 text-center">
        <Users className="w-16 h-16 mx-auto text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-500 mb-2">No Data Available</h3>
        <p className="text-gray-400">Upload and process your Excel files to see the BD availability matrix.</p>
      </div>
    );
  }

  if (!matrixData) {
    return (
      <div className="p-8 text-center">
        <Users className="w-16 h-16 mx-auto text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-500 mb-2">Processing Data</h3>
        <p className="text-gray-400">Please wait while we process your availability data...</p>
      </div>
    );
  }

  const { dates, matrix } = matrixData;

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="backdrop-blur-sm bg-white/70 dark:bg-gray-900/70 border-0 shadow-xl">
        <CardHeader className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/50 dark:to-purple-950/50 rounded-t-lg">
          <CardTitle className="text-xl font-semibold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent flex items-center gap-3">
            <Users className="w-6 h-6 text-blue-600" />
            BD Availability Matrix
          </CardTitle>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Quick view of staff availability across standard time blocks for business development decisions
          </p>
        </CardHeader>
        <CardContent className="p-4">
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Legend:</span>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800/50"></div>
              <span className="text-sm text-gray-600 dark:text-gray-400">0-1 employees</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800/50"></div>
              <span className="text-sm text-gray-600 dark:text-gray-400">2-3 employees</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-green-100 dark:bg-green-900/30 border border-green-200 dark:border-green-800/50"></div>
              <span className="text-sm text-gray-600 dark:text-gray-400">4+ employees</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* BD Matrix Grid */}
      <Card className="backdrop-blur-sm bg-white/70 dark:bg-gray-900/70 border-0 shadow-xl">
        <CardContent className="p-0">
          <ScrollArea className="w-full">
            <div className="min-w-[800px]">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-700">
                    <th className="p-3 text-left font-semibold text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600 sticky left-0 bg-gray-50 dark:bg-gray-800 z-10 min-w-[120px]">
                      <Clock className="w-4 h-4 inline mr-2" />
                      Time Block
                    </th>
                    {dates.map(date => (
                      <th key={date} className="p-3 text-center font-semibold text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600 min-w-[100px]">
                        <div className="flex flex-col items-center gap-1">
                          <Calendar className="w-4 h-4" />
                          <span className="text-xs">{formatDateForDisplay(date)}</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">{getDayOfWeek(date)}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPANY_TIME_BLOCKS.map((timeBlock, blockIndex) => (
                    <tr key={timeBlock.label} className={blockIndex % 2 === 0 ? 'bg-white/50 dark:bg-gray-900/50' : 'bg-gray-50/50 dark:bg-gray-800/50'}>
                      <td className="p-3 font-medium text-gray-700 dark:text-gray-300 border-r border-gray-200 dark:border-gray-600 sticky left-0 bg-white/90 dark:bg-gray-900/90 z-10">
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-gray-500" />
                          {timeBlock.label}
                        </div>
                      </td>
                      {dates.map(date => {
                        const cell = matrix[date][timeBlock.label];
                        return (
                          <td key={`${date}-${timeBlock.label}`} className="p-2 border-r border-gray-200 dark:border-gray-600 text-center">
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  className={`w-full h-16 rounded-lg border-2 transition-all duration-200 hover:scale-105 hover:shadow-md ${cell.colorClass}`}
                                  onClick={() => setSelectedCell({
                                    date,
                                    timeBlock: timeBlock.label,
                                    employees: cell.employees
                                  })}
                                  data-testid={`bd-matrix-cell-${date}-${timeBlock.label}`}
                                >
                                  <div className="flex flex-col items-center gap-1">
                                    {getStatusIcon(cell.count)}
                                    <span className="text-lg font-bold">{cell.count}</span>
                                    {cell.count > 0 && (
                                      <Eye className="w-3 h-3 opacity-60" />
                                    )}
                                  </div>
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-2xl max-h-[80vh]">
                                <DialogHeader>
                                  <DialogTitle className="flex items-center gap-3">
                                    <Users className="w-5 h-5" />
                                    Available Employees - {timeBlock.label}
                                  </DialogTitle>
                                  <div className="text-sm text-gray-600 dark:text-gray-400">
                                    {formatDateForDisplay(date)} ({getDayOfWeek(date)}) • {cell.count} employees fully available
                                  </div>
                                </DialogHeader>
                                <ScrollArea className="max-h-[60vh]">
                                  <div className="space-y-3">
                                    {cell.employees.length === 0 ? (
                                      <div className="text-center py-8 text-gray-500">
                                        <XCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
                                        <p>No employees fully available during this time block</p>
                                      </div>
                                    ) : (
                                      cell.employees.map((employee, index) => (
                                        <Card key={index} className="p-4 border border-gray-200 dark:border-gray-700">
                                          <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                              <div className={`w-3 h-3 rounded-full ${getGenderBgColorClass(employee.gender)}`}></div>
                                              <div>
                                                <h4 className="font-medium text-gray-900 dark:text-gray-100">
                                                  {employee.name}
                                                </h4>
                                                {employee.freeWindows && (
                                                  <p className="text-sm text-gray-600 dark:text-gray-400">
                                                    Free: {employee.freeWindows}
                                                  </p>
                                                )}
                                              </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <TransportModeIcon transportMode={employee.transportMode} />
                                              <Badge variant="outline" className="text-xs">
                                                Available
                                              </Badge>
                                            </div>
                                          </div>
                                        </Card>
                                      ))
                                    )}
                                  </div>
                                </ScrollArea>
                              </DialogContent>
                            </Dialog>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Summary Statistics */}
      <Card className="backdrop-blur-sm bg-white/70 dark:bg-gray-900/70 border-0 shadow-xl">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Quick Statistics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {dates.length}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Days</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {COMPANY_TIME_BLOCKS.length}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Time Blocks</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                {Object.values(matrix).reduce((total, dayMatrix) => 
                  total + Object.values(dayMatrix).reduce((dayTotal, cell) => 
                    dayTotal + (cell.count >= 4 ? 1 : 0), 0), 0)}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">High Capacity Slots</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                {Object.values(matrix).reduce((total, dayMatrix) => 
                  total + Object.values(dayMatrix).reduce((dayTotal, cell) => 
                    dayTotal + (cell.count <= 1 ? 1 : 0), 0), 0)}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Low Capacity Slots</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}