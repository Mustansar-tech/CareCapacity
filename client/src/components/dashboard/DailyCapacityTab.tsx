import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Check, ChevronDown, Calendar, Search, X } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FlexibleTimeWindow } from "@/components/flexible-time-window";
import { getGenderColorClass } from "@/utils/gender-colors";
import { TableSkeleton } from "@/components/loading-skeleton";
import { fmtH, renderStatusBadge } from "@/utils/dashboard-utils";
import type { ProcessingResult, EmployeeDailyDetail } from "@shared/schema";

interface DailyCapacityTabProps {
  processedData: ProcessingResult | null;
  filteredData: ProcessingResult | null;
  isProcessing: boolean;
  selectedDate: string | null;
  setSelectedDate: (date: string | null) => void;
  selectedDayDetails: EmployeeDailyDetail[];
  selectedDayDetailsRaw: EmployeeDailyDetail[];
  availableStatuses: string[];
  statusFilter: string[];
  setStatusFilter: React.Dispatch<React.SetStateAction<string[]>>;
}

export function DailyCapacityTab({
  processedData,
  filteredData,
  isProcessing,
  selectedDate,
  setSelectedDate,
  selectedDayDetails,
  selectedDayDetailsRaw,
  availableStatuses,
  statusFilter,
  setStatusFilter,
}: DailyCapacityTabProps) {
  const data = filteredData || processedData;

  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState<string[]>([]);

  const allEmployeeNames = Array.from(
    new Set(selectedDayDetailsRaw.map(e => e.employeeName))
  ).sort();

  const searchedNames = employeeSearch.trim()
    ? allEmployeeNames.filter(n => n.toLowerCase().includes(employeeSearch.toLowerCase()))
    : allEmployeeNames;

  const displayedEmployees = selectedDayDetails.filter(emp =>
    employeeFilter.length === 0 || employeeFilter.includes(emp.employeeName)
  );

  return (
    <Card className="glass">
      <CardHeader className="gradient-card dark:gradient-card-dark rounded-t-lg">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg gradient-bg flex items-center justify-center">
              <Calendar className="w-5 h-5 text-white" />
            </div>
            <span className="bg-gradient-to-r from-blue-600 to-emerald-600 bg-clip-text text-transparent">
              Daily Capacity Summary
            </span>
          </div>
          <Badge variant="outline" className="text-xs bg-white dark:bg-gray-800">
            {(() => {
              if (!data?.dailySummary || data.dailySummary.length === 0) return 'No data';
              const startDate = new Date(data.dailySummary[0].date);
              const endDate = new Date(data.dailySummary[data.dailySummary.length - 1].date);
              const monthStart = startDate.toLocaleDateString('en-US', { month: 'short' });
              const monthEnd = endDate.toLocaleDateString('en-US', { month: 'short' });
              const year = startDate.getFullYear();
              return monthStart === monthEnd ? `${monthStart} ${year}` : `${monthStart} - ${monthEnd} ${year}`;
            })()}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isProcessing ? (
          <TableSkeleton rows={7} />
        ) : (
          <div className="w-full overflow-x-auto scroll-modern">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]"></TableHead>
                  <TableHead data-testid="header-date" className="w-[120px]">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger className="cursor-help">Date</TooltipTrigger>
                        <TooltipContent>Date of the capacity summary</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                  <TableHead data-testid="header-desired-hours" className="text-right">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger className="cursor-help">Desired Hours</TooltipTrigger>
                        <TooltipContent>Total hours employees want to work based on availability</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                  <TableHead data-testid="header-unavailability" className="text-right">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger className="cursor-help">Unavailability</TooltipTrigger>
                        <TooltipContent>Hours lost due to appointments, meetings, etc.</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                  <TableHead data-testid="header-sickness" className="text-right">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger className="cursor-help">Sickness</TooltipTrigger>
                        <TooltipContent>Hours lost due to reported sickness</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                  <TableHead data-testid="header-holidays" className="text-right">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger className="cursor-help">Holidays</TooltipTrigger>
                        <TooltipContent>Hours lost due to annual leave</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                  <TableHead data-testid="header-net-capacity" className="text-right">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger className="cursor-help">Net Capacity</TooltipTrigger>
                        <TooltipContent>Total guaranteed hours minus unavailability, sickness and holidays</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                  <TableHead data-testid="header-client-required" className="text-right">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger className="cursor-help">Client Required</TooltipTrigger>
                        <TooltipContent>Total hours required by clients (demand)</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                  <TableHead data-testid="header-client-scheduled" className="text-right">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger className="cursor-help">Client Scheduled</TooltipTrigger>
                        <TooltipContent>Domiciliary hours actually scheduled to meet client demand</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                  <TableHead data-testid="header-other-scheduled" className="text-right">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger className="cursor-help">Other Scheduled</TooltipTrigger>
                        <TooltipContent>Non-client hours scheduled (e.g. admin, training)</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                  <TableHead data-testid="header-capacity-after-scheduling" className="text-right">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger className="cursor-help">Capacity After Scheduling</TooltipTrigger>
                        <TooltipContent>Net Capacity minus Client Scheduled hours</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.dailySummary?.map((day, index) => (
                  <TableRow
                    key={day.date}
                    className={`cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all duration-200 interactive ${
                      selectedDate === day.date
                        ? "bg-gradient-to-r from-blue-50 to-emerald-50 dark:from-blue-900/30 dark:to-emerald-900/30 border-l-4 border-gradient-to-b border-blue-500"
                        : ""
                    }`}
                    onClick={() => setSelectedDate(day.date)}
                    data-testid={`row-daily-summary-${index}`}
                  >
                    <TableCell className="font-medium" data-testid={`cell-date-${index}`}>
                      {(() => {
                        const d = new Date(day.date);
                        const weekday = d.toLocaleDateString("en-GB", { weekday: 'short' });
                        const dateStr = d.toLocaleDateString("en-GB", { day: '2-digit', month: '2-digit' });
                        return `${weekday} ${dateStr}`;
                      })()}
                    </TableCell>

                    <TableCell className="text-right" data-testid={`cell-desired-hours-${index}`}>
                      <Badge variant="secondary" className="bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400 border-green-100">
                        {fmtH(day.availableHours ?? 0)}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-right" data-testid={`cell-unavailability-${index}`}>
                      <Badge variant="secondary" className="bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400 border-red-200">
                        {fmtH(day.unavailability ?? 0)}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-right" data-testid={`cell-sickness-${index}`}>
                      <Badge variant="secondary" className="bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300">
                        {fmtH(day.sickness ?? 0)}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-right" data-testid={`cell-holidays-${index}`}>
                      <Badge variant="secondary" className="bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300 border-purple-200">
                        {fmtH(day.holidays ?? 0)}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-right" data-testid={`cell-net-capacity-${index}`}>
                      <Badge variant="secondary" className="bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border-amber-100">
                        {fmtH(day.netCapacity)}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-right" data-testid={`cell-client-required-${index}`}>
                      <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border-emerald-100">
                        {fmtH(day.clientRequired)}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-right" data-testid={`cell-client-scheduled-${index}`}>
                      <Badge variant="secondary" className="bg-teal-50 text-teal-700 dark:bg-teal-950/30 dark:text-teal-400 border-teal-100">
                        {fmtH(day.clientScheduledHours)}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-right" data-testid={`cell-other-scheduled-${index}`}>
                      <Badge variant="secondary" className="bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300 border-indigo-200">
                        {fmtH(day.otherScheduledHours ?? 0)}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-right" data-testid={`cell-capacity-after-scheduling-${index}`}>
                      {(() => {
                        const employees = data?.employeesByDate[day.date] || [];
                        const sum = employees.reduce((acc, emp) => {
                          const val = emp.netCapacity - emp.scheduledHours;
                          return acc + (val >= 1 ? Math.floor(val) : 0);
                        }, 0);
                        return (
                          <Badge
                            variant="secondary"
                            className={
                              sum === 0
                                ? "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300"
                                : sum > 0
                                  ? "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300"
                                  : "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300"
                            }
                          >
                            {fmtH(sum)}
                          </Badge>
                        );
                      })()}
                    </TableCell>
                  </TableRow>
                )) || []}
                {data?.dailySummary && data.dailySummary.length > 0 && (() => {
                  const totals = data.dailySummary.reduce(
                    (acc, day) => {
                      const employees = data?.employeesByDate[day.date] || [];
                      const cas = employees.reduce((s, emp) => {
                        const val = emp.netCapacity - emp.scheduledHours;
                        return s + (val >= 1 ? Math.floor(val) : 0);
                      }, 0);
                      return {
                        availableHours: acc.availableHours + (day.availableHours ?? 0),
                        unavailability: acc.unavailability + (day.unavailability ?? 0),
                        sickness: acc.sickness + (day.sickness ?? 0),
                        holidays: acc.holidays + (day.holidays ?? 0),
                        netCapacity: acc.netCapacity + day.netCapacity,
                        clientRequired: acc.clientRequired + day.clientRequired,
                        clientScheduledHours: acc.clientScheduledHours + day.clientScheduledHours,
                        otherScheduledHours: acc.otherScheduledHours + (day.otherScheduledHours ?? 0),
                        capacityAfterScheduling: acc.capacityAfterScheduling + cas,
                      };
                    },
                    { availableHours: 0, unavailability: 0, sickness: 0, holidays: 0, netCapacity: 0, clientRequired: 0, clientScheduledHours: 0, otherScheduledHours: 0, capacityAfterScheduling: 0 }
                  );
                  return (
                    <TableRow className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800/60 font-bold">
                      <TableCell />
                      <TableCell className="font-bold text-gray-700 dark:text-gray-200 text-sm">Weekly Total</TableCell>
                      <TableCell className="text-right">
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/60 dark:text-green-300 border border-green-200 dark:border-green-700 font-bold">
                          {fmtH(totals.availableHours)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge className="bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-300 border border-red-200 dark:border-red-700 font-bold">
                          {fmtH(totals.unavailability)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge className="bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 font-bold">
                          {fmtH(totals.sickness)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge className="bg-purple-100 text-purple-900 dark:bg-purple-900/60 dark:text-purple-300 border border-purple-200 dark:border-purple-700 font-bold">
                          {fmtH(totals.holidays)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300 border border-amber-200 dark:border-amber-700 font-bold">
                          {fmtH(totals.netCapacity)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700 font-bold">
                          {fmtH(totals.clientRequired)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right" colSpan={2}>
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          <Badge className="bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-300 border border-teal-200 dark:border-teal-700 font-bold">
                            {fmtH(totals.clientScheduledHours)}
                          </Badge>
                          <span className="text-xs text-muted-foreground">+</span>
                          <Badge className="bg-indigo-100 text-indigo-900 dark:bg-indigo-900/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 font-bold">
                            {fmtH(totals.otherScheduledHours)}
                          </Badge>
                          <span className="text-xs text-muted-foreground">=</span>
                          <Badge className="bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 font-bold">
                            {fmtH(totals.clientScheduledHours + totals.otherScheduledHours)}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          className={
                            totals.capacityAfterScheduling === 0
                              ? "bg-orange-100 text-orange-800 dark:bg-orange-900/60 dark:text-orange-300 border border-orange-200 dark:border-orange-700 font-bold"
                              : totals.capacityAfterScheduling > 0
                                ? "bg-green-100 text-green-800 dark:bg-green-900/60 dark:text-green-300 border border-green-200 dark:border-green-700 font-bold"
                                : "bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-300 border border-red-200 dark:border-red-700 font-bold"
                          }
                        >
                          {fmtH(totals.capacityAfterScheduling)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })()}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Drilldown Table */}
        {selectedDate && (
          <div className="mt-6" data-testid="drilldown-section">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2" data-testid="drilldown-title">
                <Calendar className="h-5 w-5" />
                Employee Details for {new Date(selectedDate).toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
                <Badge variant="outline" className="ml-2">
                  {displayedEmployees.length} of {selectedDayDetailsRaw.length} employees
                </Badge>
              </h3>
              <div className="flex gap-2">
                {employeeFilter.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setEmployeeFilter([]); setEmployeeSearch(""); }}
                    className="text-xs"
                  >
                    Clear CP Filter
                  </Button>
                )}
                {statusFilter.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setStatusFilter([])}
                    className="text-xs"
                  >
                    Clear Status Filter
                  </Button>
                )}
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden max-h-[600px] overflow-y-auto relative scroll-modern">
              <Table>
                <TableHeader className="sticky top-0 z-30 bg-gray-50 dark:bg-gray-800 shadow-md">
                  <TableRow className="hover:bg-transparent border-b-2">
                    <TableHead data-testid="drilldown-header-employee" className="font-semibold h-14 bg-gray-50 dark:bg-gray-800 sticky top-0">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 w-[220px] justify-between border-dashed bg-white dark:bg-gray-900"
                          >
                            <span className="truncate">
                              {employeeFilter.length === 0
                                ? `All CPs (${selectedDayDetailsRaw.length})`
                                : `${employeeFilter.length} CP${employeeFilter.length > 1 ? "s" : ""} selected`}
                            </span>
                            <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[240px] p-2" align="start">
                          <div className="relative mb-2">
                            <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                              placeholder="Search CP name..."
                              value={employeeSearch}
                              onChange={e => setEmployeeSearch(e.target.value)}
                              className="h-8 pl-7 pr-7 text-xs"
                            />
                            {employeeSearch && (
                              <button
                                onClick={() => setEmployeeSearch("")}
                                className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start mb-1 text-xs"
                            onClick={() => { setEmployeeFilter([]); setEmployeeSearch(""); }}
                          >
                            All CPs ({selectedDayDetailsRaw.length})
                          </Button>
                          <div className="max-h-56 overflow-y-auto space-y-0.5">
                            {searchedNames.map(name => {
                              const isSelected = employeeFilter.includes(name);
                              return (
                                <Button
                                  key={name}
                                  variant="ghost"
                                  size="sm"
                                  className="w-full justify-start gap-2 text-xs h-7"
                                  onClick={() => {
                                    setEmployeeFilter(prev =>
                                      prev.includes(name)
                                        ? prev.filter(n => n !== name)
                                        : [...prev, name]
                                    );
                                  }}
                                >
                                  <span className={`h-4 w-4 flex items-center justify-center rounded-sm border shrink-0 ${isSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/40'}`}>
                                    {isSelected && <Check className="h-3 w-3" />}
                                  </span>
                                  <span className="flex-1 text-left truncate">{name}</span>
                                </Button>
                              );
                            })}
                            {searchedNames.length === 0 && (
                              <p className="text-xs text-muted-foreground text-center py-2">No CPs match</p>
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </TableHead>
                    <TableHead data-testid="drilldown-header-status" className="font-semibold h-14 bg-gray-50 dark:bg-gray-800 sticky top-0">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 w-[220px] justify-between border-dashed bg-white dark:bg-gray-900"
                          >
                            <span className="truncate">
                              {statusFilter.length === 0
                                ? `All Statuses (${selectedDayDetailsRaw.length})`
                                : `${statusFilter.length} status${statusFilter.length > 1 ? "es" : ""} selected`}
                            </span>
                            <ChevronDown className="h-4 w-4 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[220px] p-2" align="start">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start mb-1"
                            onClick={() => setStatusFilter([])}
                          >
                            All Statuses ({selectedDayDetailsRaw.length})
                          </Button>
                          <div className="max-h-64 overflow-y-auto space-y-1">
                            {availableStatuses.map(status => {
                              const count = selectedDayDetailsRaw.filter(emp => emp.status === status).length;
                              const isSelected = statusFilter.includes(status);
                              return (
                                <Button
                                  key={status}
                                  variant="ghost"
                                  size="sm"
                                  className="w-full justify-start gap-2"
                                  onClick={() => {
                                    setStatusFilter(prev =>
                                      prev.includes(status)
                                        ? prev.filter(s => s !== status)
                                        : [...prev, status]
                                    );
                                  }}
                                >
                                  <span className={`h-4 w-4 flex items-center justify-center rounded-sm border ${isSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/40'}`}>
                                    {isSelected && <Check className="h-3 w-3" />}
                                  </span>
                                  <span className="flex-1 text-left">
                                    {status} ({count})
                                  </span>
                                </Button>
                              );
                            })}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </TableHead>
                    <TableHead data-testid="drilldown-header-time-window" className="font-semibold h-14 bg-gray-50 dark:bg-gray-800 sticky top-0">Time Window(s)</TableHead>
                    <TableHead data-testid="drilldown-header-contracted-daily" className="text-center font-semibold h-14 bg-gray-50 dark:bg-gray-800 sticky top-0">Desired Hours</TableHead>
                    <TableHead data-testid="drilldown-header-net-capacity" className="text-center font-semibold h-14 bg-gray-50 dark:bg-gray-800 sticky top-0">Net Capacity</TableHead>
                    <TableHead data-testid="drilldown-header-scheduled-hours" className="text-center font-semibold h-14 bg-gray-50 dark:bg-gray-800 sticky top-0">Scheduled Hours</TableHead>
                    <TableHead data-testid="drilldown-header-capacity-after-scheduling" className="text-center font-semibold h-14 bg-gray-50 dark:bg-gray-800 sticky top-0">Capacity After Scheduling</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedEmployees.length > 0 ? displayedEmployees.map((emp, index) => (
                    <TableRow
                      key={`${emp.employeeName}-${index}`}
                      data-testid={`row-drilldown-${index}`}
                      className={index % 2 === 0 ? "bg-gray-50/50 dark:bg-gray-800/30" : "bg-white dark:bg-gray-900/30"}
                    >
                      <TableCell className="font-medium" data-testid={`drilldown-employee-${index}`}>
                        <span className={getGenderColorClass(emp.gender)}>
                          {emp.employeeName}
                        </span>
                      </TableCell>
                      <TableCell data-testid={`drilldown-status-${index}`}>
                        {renderStatusBadge(emp.status)}
                      </TableCell>
                      <TableCell data-testid={`drilldown-time-windows-${index}`}>
                        <FlexibleTimeWindow
                          timeWindows={emp.timeWindows || '-'}
                          compact={true}
                          editable={false}
                        />
                      </TableCell>
                      <TableCell className="text-center" data-testid={`drilldown-contracted-daily-${index}`}>
                        <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300">
                          {emp.contractedDailyHours}h
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center" data-testid={`drilldown-net-capacity-${index}`}>
                        <Badge variant="secondary" className="bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border-amber-100 dark:border-amber-900">
                          {emp.netCapacity}h
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center" data-testid={`drilldown-scheduled-hours-${index}`}>
                        <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300">
                          {emp.scheduledHours}h
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center" data-testid={`drilldown-capacity-after-scheduling-${index}`}>
                        <Badge
                          variant="secondary"
                          className={
                            (emp.netCapacity - emp.scheduledHours) === 0
                              ? "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300"
                              : (emp.netCapacity - emp.scheduledHours) > 0
                                ? "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300"
                                : "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300"
                          }
                        >
                          {Math.round((emp.netCapacity - emp.scheduledHours) * 100) / 100}h
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No employee data available for this date
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
