import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Filter, Eye, XCircle, Users, Calendar, Clock } from "lucide-react";
import { getGenderColorClass, getGenderBgColorClass } from "@/utils/gender-colors";
import { TransportModeIcon } from "./TransportModeIcon";
import {
  COMPANY_TIME_BLOCKS,
  getStatusIcon,
  formatDateForDisplay,
  getDayOfWeek,
  type BDMatrixCell,
  type EmployeeAvailabilityInfo,
} from "@/utils/bd-matrix-utils";

interface BDMatrixTableProps {
  dates: string[];
  matrix: Record<string, Record<string, BDMatrixCell>>;
  filteredMatrixData: { dates: string[]; filteredMatrix: Record<string, BDMatrixCell> } | null;
  selectedTimeBlocks: Set<string>;
  handleTimeBlockToggle: (label: string, checked: boolean) => void;
  handleSelectAll: () => void;
  handleSelectNone: () => void;
}

function EmployeeCard({ employee }: { employee: EmployeeAvailabilityInfo }) {
  return (
    <Card className="p-4 border border-gray-200 dark:border-gray-700">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1">
          <div className={`w-3 h-3 rounded-full mt-1 ${getGenderBgColorClass(employee.gender)}`} />
          <div className="flex-1">
            <h4 className={`font-medium ${getGenderColorClass(employee.gender)}`}>
              {employee.name}
            </h4>
            <div className="text-sm mt-1 flex flex-wrap items-center gap-1">
              {employee.scheduledHours !== undefined && (
                <span className="text-blue-600 dark:text-blue-400">
                  {employee.scheduledHours.toFixed(1)}h scheduled
                </span>
              )}
              {employee.scheduledHours !== undefined && employee.freeWindows && employee.freeWindows !== '-' && (
                <span className="text-gray-500">•</span>
              )}
              {employee.freeWindows && employee.freeWindows !== '-' && (
                <span className="text-green-600 dark:text-green-400">
                  Free: {employee.freeWindows}
                </span>
              )}
              {(employee.scheduledHours !== undefined || (employee.freeWindows && employee.freeWindows !== '-')) &&
                employee.cancelledVisits && employee.cancelledVisits.trim() !== '' &&
                employee.cancelledVisits !== '-' && employee.cancelledVisits !== 'None' && employee.cancelledVisits !== '—' && (
                <span className="text-gray-500">•</span>
              )}
              {employee.cancelledVisits && employee.cancelledVisits.trim() !== '' &&
                employee.cancelledVisits !== '-' && employee.cancelledVisits !== 'None' && employee.cancelledVisits !== '—' && (
                <span className="text-red-600 dark:text-red-400">
                  Cancelled: {employee.cancelledVisits}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-3">
          <TransportModeIcon transportMode={employee.transportMode} />
          <Badge variant="outline" className="text-xs">Available</Badge>
        </div>
      </div>
    </Card>
  );
}

function CellDialog({
  cell,
  date,
  title,
  description,
  isFiltered = false,
}: {
  cell: BDMatrixCell;
  date: string;
  title: string;
  description: string;
  isFiltered?: boolean;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`${isFiltered ? 'h-16' : 'h-14'} w-full justify-center transition-all hover:scale-105 ${cell.colorClass} ${cell.count > 0 ? 'hover:shadow-md cursor-pointer' : 'cursor-default'} ${isFiltered ? 'border-2 border-blue-300 dark:border-blue-600' : ''}`}
          disabled={cell.count === 0}
        >
          <div className="flex flex-col items-center gap-1">
            {getStatusIcon(cell.count)}
            <span className="text-lg font-bold">{cell.count}</span>
            {cell.count > 0 && <Eye className="w-3 h-3 opacity-60" />}
          </div>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {isFiltered ? <Filter className="w-5 h-5" /> : <Users className="w-5 h-5" />}
            {title}
          </DialogTitle>
          <DialogDescription className="text-sm text-gray-600 dark:text-gray-400">
            {description}
          </DialogDescription>
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
                <EmployeeCard key={index} employee={employee} />
              ))
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export function BDMatrixTable({
  dates,
  matrix,
  filteredMatrixData,
  selectedTimeBlocks,
  handleTimeBlockToggle,
  handleSelectAll,
  handleSelectNone,
}: BDMatrixTableProps) {
  return (
    <Card className="backdrop-blur-sm bg-white/70 dark:bg-gray-900/70 border-0 shadow-xl flex-1 min-h-0 flex flex-col overflow-hidden">
      <CardContent className="p-0 flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto w-full">
          <div className="min-w-[1000px]">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-20">
                <tr className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-700">
                  <th className="p-3 text-left font-semibold text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600 sticky left-0 bg-gray-50 dark:bg-gray-800 z-10 min-w-[180px]">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Filter className="w-4 h-4" />
                        Filter & Time Blocks
                      </div>
                      <div className="flex items-center gap-2">
                        <Button onClick={handleSelectAll} variant="outline" size="sm" className="text-xs h-6 px-2">All</Button>
                        <Button onClick={handleSelectNone} variant="outline" size="sm" className="text-xs h-6 px-2">None</Button>
                        <span className="text-xs text-gray-500">{selectedTimeBlocks.size} selected</span>
                      </div>
                    </div>
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
                {/* Filtered View Row */}
                {selectedTimeBlocks.size > 0 && filteredMatrixData && (
                  <tr className="bg-blue-50/50 dark:bg-blue-900/20 border-2 border-blue-200 dark:border-blue-700">
                    <td className="p-3 font-medium text-blue-700 dark:text-blue-300 border-r border-gray-200 dark:border-gray-600 sticky left-0 bg-blue-50/90 dark:bg-blue-900/40 z-10">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <Filter className="w-4 h-4 text-blue-500" />
                          <span className="font-semibold text-sm">Available in ALL Selected</span>
                        </div>
                        <div className="text-xs space-y-1 max-h-32 overflow-y-auto">
                          {Array.from(selectedTimeBlocks).slice(0, 3).map(block => (
                            <div key={block} className="bg-blue-100 dark:bg-blue-800/30 px-1 py-0.5 rounded text-xs">
                              {block}
                            </div>
                          ))}
                          {selectedTimeBlocks.size > 3 && (
                            <div className="text-xs text-blue-600">+{selectedTimeBlocks.size - 3} more</div>
                          )}
                        </div>
                      </div>
                    </td>
                    {filteredMatrixData.dates.map(date => {
                      const cell = filteredMatrixData.filteredMatrix[date];
                      return (
                        <td key={`filtered-${date}`} className="p-1 border border-blue-200 dark:border-blue-600 text-center">
                          <CellDialog
                            cell={cell}
                            date={date}
                            isFiltered
                            title="Employees Available in ALL Selected Blocks"
                            description={`${formatDateForDisplay(date)} (${getDayOfWeek(date)}) • ${cell.count} employees available in all ${selectedTimeBlocks.size} selected time blocks`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                )}

                {/* Individual Time Block Rows */}
                {COMPANY_TIME_BLOCKS.map((timeBlock, blockIndex) => (
                  <tr key={timeBlock.label} className={blockIndex % 2 === 0 ? 'bg-white/50 dark:bg-gray-900/50' : 'bg-gray-50/50 dark:bg-gray-800/50'}>
                    <td className="p-3 border-r border-gray-200 dark:border-gray-600 sticky left-0 bg-white/90 dark:bg-gray-900/90 z-10">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`timeblock-${timeBlock.label}`}
                          checked={selectedTimeBlocks.has(timeBlock.label)}
                          onCheckedChange={(checked) => handleTimeBlockToggle(timeBlock.label, checked as boolean)}
                        />
                        <label htmlFor={`timeblock-${timeBlock.label}`} className="font-medium text-gray-700 dark:text-gray-300 cursor-pointer flex items-center gap-2 text-sm">
                          <Clock className="w-4 h-4 text-gray-500" />
                          {timeBlock.label}
                        </label>
                      </div>
                    </td>
                    {dates.map(date => {
                      const cell = matrix[date][timeBlock.label];
                      return (
                        <td key={`${date}-${timeBlock.label}`} className="p-1 border border-gray-200 dark:border-gray-600 text-center">
                          <CellDialog
                            cell={cell}
                            date={date}
                            title={`Available Employees - ${timeBlock.label}`}
                            description={`${formatDateForDisplay(date)} (${getDayOfWeek(date)}) • ${cell.count} employees fully available`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
