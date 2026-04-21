import { useMemo, useState } from "react";
import { clientLogger } from '@/lib/logger';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Upload, FileSpreadsheet, AlertTriangle, CheckCircle,
  TrendingUp, Users, Clock, Calendar, RefreshCw, Target, Bot
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { MetricCardSkeleton } from "@/components/loading-skeleton";
import type { ProcessingResult, CapacityAnalysisSummary } from "@shared/schema";
import { computeGhLoss, type GhLossResult } from "@/utils/dashboard-utils";

interface FilesState {
  availability: File | null;
  guaranteed: File | null;
  demand: File | null;
  cgData: File | null;
}

interface OverviewTabProps {
  processedData: ProcessingResult | null;
  filteredData: ProcessingResult | null;
  isProcessing: boolean;
  processMutation: { isPending: boolean };
  showUploadPanel: boolean;
  setShowUploadPanel: (show: boolean) => void;
  isLoadingLatest: boolean;
  latestDataError: unknown;
  files: FilesState;
  handleFileChange: (type: 'availability' | 'guaranteed' | 'demand' | 'cgData') => (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleProcessFiles: () => void;
  setProcessedData: (data: ProcessingResult | null) => void;
  setFilteredData: (data: ProcessingResult | null) => void;
  setSelectedDate: (date: string | null) => void;
  setFiles: (files: FilesState) => void;
  selectedWeekId: string | null;
  handleWeekChange: (value: string) => void;
  allHistoryData: CapacityAnalysisSummary[] | undefined;
  navigate: (path: string) => void;
}

export function OverviewTab({
  processedData,
  filteredData,
  isProcessing,
  processMutation,
  showUploadPanel,
  setShowUploadPanel,
  isLoadingLatest,
  latestDataError,
  files,
  handleFileChange,
  handleProcessFiles,
  setProcessedData,
  setFilteredData,
  setSelectedDate,
  setFiles,
  selectedWeekId,
  handleWeekChange,
  allHistoryData,
  navigate,
}: OverviewTabProps) {
  const { toast } = useToast();
  const [ghLossModalOpen, setGhLossModalOpen] = useState(false);
  const [sicknessModalOpen, setSicknessModalOpen] = useState(false);
  const [unavailModalOpen, setUnavailModalOpen] = useState(false);
  const [holidayModalOpen, setHolidayModalOpen] = useState(false);
  const [netCapacityModalOpen, setNetCapacityModalOpen] = useState(false);
  const [domiciliaryModalOpen, setDomiciliaryModalOpen] = useState(false);
  const [clientScheduledModalOpen, setClientScheduledModalOpen] = useState(false);
  const [otherScheduledModalOpen, setOtherScheduledModalOpen] = useState(false);
  const [capacityAfterModalOpen, setCapacityAfterModalOpen] = useState(false);
  const [desiredHoursModalOpen, setDesiredHoursModalOpen] = useState(false);
  const data = filteredData || processedData;
  const ghLossData = useMemo<GhLossResult>(() => {
    if (!data?.employeeSummaryByDate) return { totalLoss: 0, items: [] };
    return computeGhLoss(
      data.employeeSummaryByDate as Record<string, Array<{
        employeeName: string;
        scheduledHours: number;
        ghScheduledHours?: number;
        unavailability: number;
        availability?: number;
      }>>,
      (data as any).ghLossRawSummary ?? undefined,
    );
  }, [data]);

  const dayBreakdown = useMemo(() => {
    if (!data?.dailySummary) return { sickness: 0, unavailability: 0 };
    return data.dailySummary.reduce(
      (acc, day) => ({
        sickness: Math.round((acc.sickness + (day.sickness || 0)) * 100) / 100,
        unavailability: Math.round((acc.unavailability + (day.unavailability || 0)) * 100) / 100,
      }),
      { sickness: 0, unavailability: 0 },
    );
  }, [data]);

  const buildBreakdown = (statuses: string[]) => {
    if (!data?.employeesByDate) return [] as Array<{ name: string; hours: number; days: number }>;
    const map = new Map<string, { hours: number; days: Set<string> }>();
    Object.entries(data.employeesByDate).forEach(([date, employees]) => {
      employees.forEach((emp) => {
        if (!statuses.includes(emp.status)) return;
        const existing = map.get(emp.employeeName) ?? { hours: 0, days: new Set<string>() };
        const dailyCap = emp.contractedDailyHours > 0 ? emp.contractedDailyHours : (emp.hours || 0);
        existing.hours += Math.min(emp.hours || 0, dailyCap);
        existing.days.add(date);
        map.set(emp.employeeName, existing);
      });
    });
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, hours: Math.round(v.hours * 100) / 100, days: v.days.size }))
      .filter((i) => i.hours > 0 || i.days > 0)
      .sort((a, b) => b.hours - a.hours);
  };

  const sicknessBreakdown = useMemo(() => {
    const items = buildBreakdown(["Sick", "Partial Sick"]);
    return { total: dayBreakdown.sickness, items };
  }, [data, dayBreakdown.sickness]);
  const unavailBreakdown = useMemo(() => {
    const items = buildBreakdown([
      "Maternity/Paternity", "Compassionate Leave", "Other Unavailable",
      "Pre-Agreed Appointment", "Partial Maternity/Paternity",
      "Partial Compassionate Leave", "Partial Availability",
    ]);
    return { total: dayBreakdown.unavailability, items };
  }, [data, dayBreakdown.unavailability]);
  const holidayBreakdown = useMemo(() => {
    const items = buildBreakdown(["Holiday", "Partial Holiday"]);
    const total = Math.round((data?.kpis.holidaysSum ?? 0) * 100) / 100;
    return { total, items };
  }, [data]);

  const formatName = (name: string) =>
    name.includes(", ") ? name.split(", ").reverse().join(" ") : name;

  return (
    <>
      {/* Action bar */}
      <div className="flex flex-wrap gap-3 animate-fade-in">
        <Button
          onClick={() => setShowUploadPanel(!showUploadPanel)}
          variant="outline"
          className="glass-card hover:shadow-lg transition-all duration-200 h-9 px-4 text-sm"
          data-testid="toggle-upload-panel"
        >
          <Upload className="w-3.5 h-3.5 mr-2" />
          {showUploadPanel ? 'Hide Upload Panel' : 'Upload New Data'}
        </Button>
        <Button
          onClick={() => navigate('/app/people-planner')}
          variant="outline"
          className="glass-card hover:shadow-lg transition-all duration-200 h-9 px-4 text-sm border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950"
          title="Automatically download reports from People Planner"
        >
          <Bot className="w-3.5 h-3.5 mr-2" />
          Sync from People Planner
        </Button>
      </div>
      {/* File Upload Section */}
      {showUploadPanel && (
        <Card className="mb-6 glass hover-lift animate-slide-up" data-testid="upload-section-overview">
          <CardHeader className="gradient-card dark:gradient-card-dark rounded-t-lg">
            <CardTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg gradient-bg flex items-center justify-center">
                <Upload className="w-4 h-4 text-white" />
              </div>
              <span className="bg-gradient-to-r from-blue-600 to-emerald-600 bg-clip-text text-transparent">
                Upload Files
              </span>
              {isLoadingLatest && (
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
                  <span className="text-sm text-blue-600">Loading latest data...</span>
                </div>
              )}
              {!!latestDataError && (
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-orange-500" />
                  <span className="text-sm text-orange-600">No previous data found</span>
                </div>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              {/* Availability Export */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                    <Users className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                  </div>
                  <Label htmlFor="availability-file-overview" className="text-sm font-medium">
                    Availability Export.xlsx
                  </Label>
                </div>
                <Input
                  id="availability-file-overview"
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileChange('availability')}
                  className="file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 transition-all duration-200"
                  data-testid="input-availability-file-overview"
                />
                {files.availability && (
                  <div className="flex items-center gap-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <p className="text-sm text-green-600 dark:text-green-400" data-testid="text-availability-selected-overview">
                      {files.availability.name}
                    </p>
                  </div>
                )}
              </div>

              {/* Guaranteed Hours */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center">
                    <Clock className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <Label htmlFor="guaranteed-file-overview" className="text-sm font-medium">
                    Care Pro Guaranteed Hours.xlsx
                  </Label>
                </div>
                <Input
                  id="guaranteed-file-overview"
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileChange('guaranteed')}
                  className="file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 transition-all duration-200"
                  data-testid="input-guaranteed-file-overview"
                />
                {files.guaranteed && (
                  <div className="flex items-center gap-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <p className="text-sm text-green-600 dark:text-green-400" data-testid="text-guaranteed-selected-overview">
                      {files.guaranteed.name}
                    </p>
                  </div>
                )}
              </div>

              {/* CG Data Export */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-orange-100 dark:bg-orange-900 flex items-center justify-center">
                    <Target className="w-3 h-3 text-orange-600 dark:text-orange-400" />
                  </div>
                  <Label htmlFor="cgdata-file-overview" className="text-sm font-medium">
                    CG Data Export.xlsx
                    <span className="ml-2 px-1 py-0.5 text-[10px] bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 rounded">Master</span>
                  </Label>
                </div>
                <Input
                  id="cgdata-file-overview"
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileChange('cgData')}
                  className="file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100 transition-all duration-200"
                  data-testid="input-cgdata-file-overview"
                />
                {files.cgData && (
                  <div className="flex items-center gap-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <p className="text-sm text-green-600 dark:text-green-400" data-testid="text-cgdata-selected-overview">
                      {files.cgData.name}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-center gap-4">
              <Button
                onClick={handleProcessFiles}
                disabled={!files.availability || !files.guaranteed || !files.cgData || isProcessing || processMutation.isPending}
                className="bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-700 hover:to-emerald-700 text-white px-6 py-2 font-semibold shadow-lg disabled:opacity-50"
                data-testid="button-process-overview"
                aria-busy={isProcessing || processMutation.isPending}
              >
                {isProcessing || processMutation.isPending ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                    Processing Files...
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="w-4 h-4 mr-2" aria-hidden="true" />
                    Process Files
                  </>
                )}
              </Button>
              <Button
                onClick={() => {
                  setProcessedData(null);
                  setFilteredData(null);
                  setSelectedDate(null);
                  setFiles({
                    availability: null,
                    guaranteed: null,
                    demand: null,
                    cgData: null
                  });
                  const inputs = document.querySelectorAll('input[type="file"]') as NodeListOf<HTMLInputElement>;
                  inputs.forEach(input => { input.value = ''; });
                  toast({
                    title: "Data Cleared",
                    description: "Dashboard has been reset. Upload new files to process."
                  });
                }}
                variant="outline"
                className="flex items-center gap-2"
                data-testid="button-clear-overview"
              >
                <AlertTriangle className="w-4 h-4" />
                Clear Data
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {/* Data Period Information */}
      <Card className="mb-6 glass hover-lift animate-slide-up" data-testid="data-period-info-overview">
        <CardContent className="p-6 pt-[8px] pb-[8px]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg">
                  <Calendar className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1">
                  <div className="font-bold text-lg bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300 bg-clip-text text-transparent mb-2">
                    Select Week:
                  </div>
                  <Select
                    value={selectedWeekId || "latest"}
                    onValueChange={handleWeekChange}
                  >
                    <SelectTrigger className="w-80" data-testid="week-selector" aria-label="Select week">
                      <SelectValue placeholder="Select a week" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="latest">
                        Latest Week{(() => {
                          try {
                            if (!data?.dailySummary || data.dailySummary.length === 0) return '';
                            const startDate = new Date(data.dailySummary[0].date).toLocaleDateString('en-GB');
                            const endDate = new Date(data.dailySummary[data.dailySummary.length - 1].date).toLocaleDateString('en-GB');
                            return ` (${startDate} - ${endDate})`;
                          } catch (error) {
                            clientLogger.error('Error formatting latest week dates:', error);
                            return '';
                          }
                        })()}
                      </SelectItem>
                      {allHistoryData?.map((analysis) => {
                        try {
                          if (!analysis.weekStartDate || !analysis.weekEndDate) return null;
                          const startDate = new Date(analysis.weekStartDate).toLocaleDateString('en-GB');
                          const endDate = new Date(analysis.weekEndDate).toLocaleDateString('en-GB');
                          const monthYear = new Date(analysis.weekStartDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                          return (
                            <SelectItem key={analysis.id} value={analysis.id}>
                              Week of {startDate} - {endDate} ({monthYear})
                            </SelectItem>
                          );
                        } catch (error) {
                          clientLogger.error('Error rendering week option:', error);
                          return null;
                        }
                      }).filter(Boolean)}
                    </SelectContent>
                  </Select>
                  <div className="text-sm text-gray-600 dark:text-gray-400 font-medium mt-1">
                    {(() => {
                      try {
                        if (!data?.dailySummary || data.dailySummary.length === 0) return '';
                        const startDate = new Date(data.dailySummary[0].date);
                        return startDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                      } catch (error) {
                        clientLogger.error('Error formatting month year:', error);
                        return '';
                      }
                    })()}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="flex items-center gap-2 py-2 px-3 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm">
                  <Clock className="w-4 h-4" />
                  <span className="font-medium">{data?.dailySummary.length || 0} days</span>
                </Badge>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                aria-label="Refresh dashboard data"
                onClick={() => {
                  toast({
                    title: "Data Refreshed",
                    description: "Dashboard data has been updated."
                  });
                }}
                className="hover:bg-blue-50 dark:hover:bg-blue-900/20"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      {/* Metric Cards */}
      {isProcessing || processMutation.isPending ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
          {Array.from({ length: 10 }).map((_, i) => (
            <MetricCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
            {/* 1. Desired Hours */}
            <Card
              className="glass hover-lift animate-scale-in cursor-pointer"
              data-testid="card-desired-total"
              onDoubleClick={() => setDesiredHoursModalOpen(true)}
              title="Double-click to see details"
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-400 to-green-500 flex items-center justify-center">
                    <Clock className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-gray-700 dark:text-gray-300">Desired Hours</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold bg-gradient-to-r from-green-500 to-green-700 bg-clip-text text-transparent mb-1" data-testid="text-desired-sum">
                  {data?.kpis.totalDesiredHoursSum || 0}h
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Total weekly desired</div>
              </CardContent>
            </Card>

            {/* 2. Unavailability */}
            <Card
              className="glass hover-lift animate-scale-in cursor-pointer select-none"
              data-testid="card-unavailability"
              onDoubleClick={() => setUnavailModalOpen(true)}
              title="Double-click to see breakdown"
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center">
                    <AlertTriangle className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-gray-700 dark:text-gray-300">Unavailability</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold bg-gradient-to-r from-red-500 to-red-700 bg-clip-text text-transparent mb-1" data-testid="text-unavailability-sum">
                  {data?.kpis.unavailabilitySum}h
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {unavailBreakdown.items.length} CP{unavailBreakdown.items.length === 1 ? "" : "s"} unavailable
                </div>
              </CardContent>
            </Card>

            {/* 3. Sickness */}
            <Card
              className="glass hover-lift animate-scale-in cursor-pointer select-none"
              data-testid="card-sickness"
              onDoubleClick={() => setSicknessModalOpen(true)}
              title="Double-click to see breakdown"
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center">
                    <AlertTriangle className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-gray-700 dark:text-gray-300">Sickness</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold bg-gradient-to-r from-slate-500 to-slate-700 bg-clip-text text-transparent mb-1" data-testid="text-sickness-sum">
                  {data?.kpis.sicknessSum}h
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {sicknessBreakdown.items.length} CP{sicknessBreakdown.items.length === 1 ? "" : "s"} off sick
                </div>
              </CardContent>
            </Card>

            {/* 4. Holidays */}
            <Card
              className="glass hover-lift animate-scale-in cursor-pointer"
              data-testid="card-holidays"
              onDoubleClick={() => setHolidayModalOpen(true)}
              title="Double-click to see breakdown"
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center">
                    <Calendar className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-gray-700 dark:text-gray-300">Holidays</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold bg-gradient-to-r from-purple-500 to-purple-700 bg-clip-text text-transparent mb-1" data-testid="text-holidays-sum">
                  {data?.kpis.holidaysSum || 0}h
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {holidayBreakdown.items.length} CP{holidayBreakdown.items.length === 1 ? "" : "s"} on holiday
                </div>
              </CardContent>
            </Card>

            {/* 5. Net Capacity */}
            <Card
              className="glass hover-lift animate-scale-in cursor-pointer"
              data-testid="card-net-capacity"
              onDoubleClick={() => setNetCapacityModalOpen(true)}
              title="Double-click to see details"
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center">
                    <Users className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-gray-700 dark:text-gray-300">Net Capacity</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold bg-gradient-to-r from-amber-600 to-amber-800 bg-clip-text text-transparent mb-1" data-testid="text-net-capacity-sum">
                  {data?.kpis.netCapacitySum}h
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Total available hours</div>
              </CardContent>
            </Card>

            {/* 6. Client Required / Domiciliary Hours */}
            <Card
              className="glass hover-lift animate-scale-in cursor-pointer"
              data-testid="card-client-required"
              onDoubleClick={() => setDomiciliaryModalOpen(true)}
              title="Double-click to see details"
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
                    <Clock className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-gray-700 dark:text-gray-300">Domiciliary Hours</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold bg-gradient-to-r from-emerald-600 to-emerald-800 bg-clip-text text-transparent mb-1" data-testid="text-client-required-sum">
                  {data?.kpis.clientRequiredSum}h
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">client care Hours</div>
              </CardContent>
            </Card>

            {/* 6b. Client Scheduled Hours */}
            <Card
              className="glass hover-lift animate-scale-in cursor-pointer"
              data-testid="card-client-scheduled"
              onDoubleClick={() => setClientScheduledModalOpen(true)}
              title="Double-click to see details"
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center">
                    <Clock className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-gray-700 dark:text-gray-300">Client Scheduled</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold bg-gradient-to-r from-teal-600 to-teal-800 bg-clip-text text-transparent mb-1" data-testid="text-client-scheduled-sum">
                  {data?.kpis.clientScheduledHoursSum}h
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Hours scheduled to meet demand</div>
              </CardContent>
            </Card>

            {/* 7. Other Scheduled */}
            <Card
              className="glass hover-lift animate-scale-in cursor-pointer"
              data-testid="card-other-scheduled"
              onDoubleClick={() => setOtherScheduledModalOpen(true)}
              title="Double-click to see details"
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-200 dark:shadow-none">
                    <Clock className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-gray-700 dark:text-gray-300">Other Scheduled</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold bg-gradient-to-r from-indigo-500 to-indigo-700 bg-clip-text text-transparent mb-1" data-testid="text-other-scheduled-sum">
                  {data?.kpis.otherScheduledHoursSum}h
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Non-client hours</div>
              </CardContent>
            </Card>

            {/* 8. Capacity After Scheduling */}
            <Card
              className="glass hover-lift animate-scale-in cursor-pointer"
              data-testid="card-capacity-after-scheduling"
              onDoubleClick={() => setCapacityAfterModalOpen(true)}
              title="Double-click to see details"
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-gray-700 dark:text-gray-300">Capacity After Scheduling</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold bg-gradient-to-r from-green-600 to-green-800 bg-clip-text text-transparent mb-1" data-testid="text-capacity-after-scheduling-sum">
                  {(() => {
                    const sum = data?.dailySummary.reduce((acc, day) => {
                      const employees = data?.employeesByDate[day.date] || [];
                      const daySum = employees.reduce((acc, emp) => {
                        const val = emp.netCapacity - emp.scheduledHours;
                        return acc + (val >= 1 ? Math.floor(val) : 0);
                      }, 0);
                      return acc + daySum;
                    }, 0) || 0;
                    return sum;
                  })()}h
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Total remaining capacity</div>
              </CardContent>
            </Card>

            {/* 9. GH Loss */}
            <Card
              className="glass hover-lift animate-scale-in cursor-pointer select-none"
              data-testid="card-gh-loss"
              onDoubleClick={() => setGhLossModalOpen(true)}
              title="Double-click to see breakdown"
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500 to-rose-600 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4 text-white rotate-180" />
                  </div>
                  <span className="text-gray-700 dark:text-gray-300">GH Loss</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold bg-gradient-to-r from-rose-500 to-rose-700 bg-clip-text text-transparent mb-1" data-testid="text-gh-loss-total">
                  {ghLossData.totalLoss}h
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {ghLossData.items.length} staff with loss
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
      {/* Desired Hours Info Modal */}
      <Dialog open={desiredHoursModalOpen} onOpenChange={setDesiredHoursModalOpen}>
        <DialogContent className="max-w-sm w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-green-400 to-green-500 flex items-center justify-center">
                <Clock className="w-3.5 h-3.5 text-white" />
              </div>
              Desired Hours
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
            <p className="font-semibold">Total Desired hours across all Care Pros</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">The sum of each Care Pro's desired weekly hours from their availability schedule. This represents the maximum hours the branch workforce is desired to deliver before any deductions for sickness, holidays, or unavailability.</p>
            <div className="text-xs bg-gray-50 dark:bg-gray-800 rounded-lg p-3 font-mono">
              Desired Hours → Net Capacity after deductions
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {/* Net Capacity Info Modal */}
      <Dialog open={netCapacityModalOpen} onOpenChange={setNetCapacityModalOpen}>
        <DialogContent className="max-w-sm w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center">
                <Users className="w-3.5 h-3.5 text-white" />
              </div>
              Net Capacity
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
            <p className="font-semibold">Total available hours after exclusions</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Calculated as:</p>
            <div className="text-xs bg-gray-50 dark:bg-gray-800 rounded-lg p-3 font-mono">Desired Hours − (Sickness + Holidays + Unavailability)</div>
          </div>
        </DialogContent>
      </Dialog>
      {/* Domiciliary Hours Info Modal */}
      <Dialog open={domiciliaryModalOpen} onOpenChange={setDomiciliaryModalOpen}>
        <DialogContent className="max-w-sm w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
                <Clock className="w-3.5 h-3.5 text-white" />
              </div>
              Domiciliary Hours
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
            <p className="font-semibold">Total branch domiciliary care hours</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Excludes:</p>
            <ul className="text-xs space-y-1.5 list-disc list-inside text-gray-600 dark:text-gray-400">
              <li>Cancelled visits</li>
              <li>Secondary/multiple care</li>
              <li>Office hours &amp; training</li>
              <li>Sleep-in &amp; waking nights</li>
            </ul>
          </div>
        </DialogContent>
      </Dialog>
      {/* Client Scheduled Info Modal */}
      <Dialog open={clientScheduledModalOpen} onOpenChange={setClientScheduledModalOpen}>
        <DialogContent className="max-w-sm w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center">
                <Clock className="w-3.5 h-3.5 text-white" />
              </div>
              Client Scheduled
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
            <p className="font-semibold">Domiciliary hours scheduled</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Actual client hours scheduled</p>
            <div className="text-xs bg-gray-50 dark:bg-gray-800 rounded-lg p-3 font-mono">
              Gap = Required − Scheduled
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {/* Other Scheduled Info Modal */}
      <Dialog open={otherScheduledModalOpen} onOpenChange={setOtherScheduledModalOpen}>
        <DialogContent className="max-w-sm w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center">
                <Clock className="w-3.5 h-3.5 text-white" />
              </div>
              Other Scheduled
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
            <p className="font-semibold">Non-client hours scheduled</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Includes:</p>
            <ul className="text-xs space-y-1.5 list-disc list-inside text-gray-600 dark:text-gray-400">
              <li>Office hours &amp; admin work</li>
              <li>Training sessions</li>
              <li>Shadowing &amp; induction</li>
              <li>On-call duties</li>
            </ul>
          </div>
        </DialogContent>
      </Dialog>
      {/* Capacity After Scheduling Info Modal */}
      <Dialog open={capacityAfterModalOpen} onOpenChange={setCapacityAfterModalOpen}>
        <DialogContent className="max-w-sm w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center">
                <TrendingUp className="w-3.5 h-3.5 text-white" />
              </div>
              Capacity After Scheduling
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
            <p className="font-semibold">Available capacity remaining</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Calculated as:</p>
            <div className="text-xs bg-gray-50 dark:bg-gray-800 rounded-lg p-3 font-mono space-y-1">
              <p>Net Capacity − (Domiciliary + Other Scheduled)</p>
              <p className="text-gray-400 dark:text-gray-500">Values &lt; 1h are excluded (floored)</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {/* GH Loss Detail Modal */}
      <Dialog open={ghLossModalOpen} onOpenChange={setGhLossModalOpen}>
        <DialogContent className="max-w-lg w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-rose-500 to-rose-600 flex items-center justify-center">
                <TrendingUp className="w-3.5 h-3.5 text-white rotate-180" />
              </div>
              GH Loss Breakdown
            </DialogTitle>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              GH employees working fewer hours than their weekly contracted target
            </p>
          </DialogHeader>

          {ghLossData.items.length > 0 ? (
            <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-[60vh] overflow-y-auto -mx-6 px-6">
              {ghLossData.items.map((item) => (
                <div key={item.name} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
                      {item.name.includes(", ") ? item.name.split(", ").reverse().join(" ") : item.name}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex gap-3 flex-wrap">
                      <span>Contracted: <span className="font-medium text-gray-700 dark:text-gray-300">{item.ghHours}h</span></span>
                      {item.weeklyUnavailability > 0 && (
                        <span>Unavail: <span className="font-medium text-gray-700 dark:text-gray-300">{item.weeklyUnavailability}h</span></span>
                      )}
                      <span>Scheduled: <span className="font-medium text-gray-700 dark:text-gray-300">{item.weeklyScheduled}h</span></span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="inline-block px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-xs font-bold whitespace-nowrap">
                      {item.loss}h short
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center">
              <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">No GH loss detected this week.</p>
            </div>
          )}

          {ghLossData.items.length > 0 && (
            <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-800 mt-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">{ghLossData.items.length} staff affected</span>
              <span className="text-sm font-bold text-rose-600 dark:text-rose-400">Total: {ghLossData.totalLoss}h short</span>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* Sickness Detail Modal */}
      <Dialog open={sicknessModalOpen} onOpenChange={setSicknessModalOpen}>
        <DialogContent className="max-w-lg w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-slate-500 to-slate-600 flex items-center justify-center">
                <AlertTriangle className="w-3.5 h-3.5 text-white" />
              </div>
              Sickness Breakdown
            </DialogTitle>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Care Pros off sick this week
            </p>
          </DialogHeader>

          {sicknessBreakdown.items.length > 0 ? (
            <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-[60vh] overflow-y-auto -mx-6 px-6">
              {sicknessBreakdown.items.map((item) => (
                <div key={item.name} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
                      {formatName(item.name)}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {item.days} day{item.days === 1 ? "" : "s"} affected
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="inline-block px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold whitespace-nowrap">
                      {item.hours}h
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center">
              <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">No sickness recorded this week.</p>
            </div>
          )}

          {sicknessBreakdown.items.length > 0 && (
            <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-800 mt-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">{sicknessBreakdown.items.length} CP{sicknessBreakdown.items.length === 1 ? "" : "s"} off sick</span>
              <span className="text-sm font-bold text-slate-700 dark:text-slate-300">Total: {sicknessBreakdown.total}h</span>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* Unavailability Detail Modal */}
      <Dialog open={unavailModalOpen} onOpenChange={setUnavailModalOpen}>
        <DialogContent className="max-w-lg w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center">
                <AlertTriangle className="w-3.5 h-3.5 text-white" />
              </div>
              Unavailability Breakdown
            </DialogTitle>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Care Pros unavailable this week (excluding sickness &amp; holidays)
            </p>
          </DialogHeader>

          {unavailBreakdown.items.length > 0 ? (
            <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-[60vh] overflow-y-auto -mx-6 px-6">
              {unavailBreakdown.items.map((item) => (
                <div key={item.name} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
                      {formatName(item.name)}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {item.days} day{item.days === 1 ? "" : "s"} affected
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="inline-block px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-xs font-bold whitespace-nowrap">
                      {item.hours}h
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center">
              <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">No unavailability recorded this week.</p>
            </div>
          )}

          {unavailBreakdown.items.length > 0 && (
            <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-800 mt-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">{unavailBreakdown.items.length} CP{unavailBreakdown.items.length === 1 ? "" : "s"} unavailable</span>
              <span className="text-sm font-bold text-red-600 dark:text-red-400">Total: {unavailBreakdown.total}h</span>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* Holidays Detail Modal */}
      <Dialog open={holidayModalOpen} onOpenChange={setHolidayModalOpen}>
        <DialogContent className="max-w-lg w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center">
                <Calendar className="w-3.5 h-3.5 text-white" />
              </div>
              Holidays Breakdown
            </DialogTitle>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Care Pros on annual leave this week
            </p>
          </DialogHeader>

          {holidayBreakdown.items.length > 0 ? (
            <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-[60vh] overflow-y-auto -mx-6 px-6">
              {holidayBreakdown.items.map((item) => (
                <div key={item.name} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
                      {formatName(item.name)}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {item.days} day{item.days === 1 ? "" : "s"} on leave
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="inline-block px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-xs font-bold whitespace-nowrap">
                      {item.hours}h
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center">
              <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">No holidays recorded this week.</p>
            </div>
          )}

          {holidayBreakdown.items.length > 0 && (
            <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-800 mt-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">{holidayBreakdown.items.length} CP{holidayBreakdown.items.length === 1 ? "" : "s"} on holiday</span>
              <span className="text-sm font-bold text-purple-600 dark:text-purple-400">Total: {holidayBreakdown.total}h</span>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
