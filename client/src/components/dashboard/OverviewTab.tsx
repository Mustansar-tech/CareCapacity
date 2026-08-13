import { useMemo, useState } from "react";
import { InsightCharts } from "./InsightCharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Upload, FileSpreadsheet, AlertTriangle, CheckCircle,
  TrendingUp, Users, Clock, Calendar, RefreshCw, Target,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { MetricCardSkeleton } from "@/components/loading-skeleton";
import type { ProcessingResult, CapacityAnalysisSummary } from "@shared/schema";
import { computeGhLoss, type GhLossResult, type CrossBranchGhHours } from "@/utils/dashboard-utils";
import { useQuery } from "@tanstack/react-query";

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
  allHistoryData?: CapacityAnalysisSummary[];
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
  allHistoryData,
}: OverviewTabProps) {
  const { toast } = useToast();
  const [ghLossModalOpen, setGhLossModalOpen] = useState(false);

  const data = filteredData || processedData;

  const [sicknessModalOpen, setSicknessModalOpen] = useState(false);
  const [unavailModalOpen, setUnavailModalOpen] = useState(false);
  const [holidayModalOpen, setHolidayModalOpen] = useState(false);
  const [netCapacityModalOpen, setNetCapacityModalOpen] = useState(false);
  const [domiciliaryModalOpen, setDomiciliaryModalOpen] = useState(false);
  const [clientScheduledModalOpen, setClientScheduledModalOpen] = useState(false);
  const [otherScheduledModalOpen, setOtherScheduledModalOpen] = useState(false);
  const [capacityAfterModalOpen, setCapacityAfterModalOpen] = useState(false);
  const [desiredHoursModalOpen, setDesiredHoursModalOpen] = useState(false);
  // Cross-branch cover: hours a GH carer works in OTHER branches this week.
  // Credited back to her home branch so GH loss isn't overstated.
  const weekDates = useMemo(() => {
    if (!data?.employeeSummaryByDate) return [];
    return Object.keys(data.employeeSummaryByDate).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  }, [data]);

  const { data: crossBranchData } = useQuery<{ extraScheduled: CrossBranchGhHours; foreignCarers?: string[] }>({
    queryKey: [`/api/gh-loss/cross-branch?dates=${weekDates.join(',')}`],
    enabled: weekDates.length > 0,
    staleTime: 5 * 60 * 1000,
  });

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
      crossBranchData?.extraScheduled,
      crossBranchData?.foreignCarers,
    );
  }, [data, crossBranchData]);

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
    <div className="flex flex-col h-full">
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
      {/* ── KPI strip ── */}
      {isProcessing || processMutation.isPending ? (
        <div className="px-6 pb-3">
          <div className="grid grid-cols-5 xl:grid-cols-10 gap-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <MetricCardSkeleton key={i} />
            ))}
          </div>
        </div>
      ) : data ? (
        <div className="px-6 pb-3">
          <div className="grid grid-cols-5 xl:grid-cols-10 gap-3">

            {/* 1. Desired Hours */}
            <button
              data-testid="card-desired-total"
              onDoubleClick={() => setDesiredHoursModalOpen(true)}
              title="Double-click to see details"
              className="text-left bg-card border border-border rounded-xl px-3.5 py-3.5 hover:bg-muted/50 hover:border-green-200 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-green-400 to-green-500 flex items-center justify-center shrink-0">
                  <Clock className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="text-xs font-semibold text-muted-foreground">Desired</span>
              </div>
              <div className="text-lg font-bold bg-gradient-to-r from-green-500 to-green-700 bg-clip-text text-transparent leading-none" data-testid="text-desired-sum">
                {data.kpis.totalDesiredHoursSum || 0}h
              </div>
              <div className="text-xs text-muted-foreground mt-1">weekly target</div>
            </button>

            {/* 2. Unavailability */}
            <button
              data-testid="card-unavailability"
              onDoubleClick={() => setUnavailModalOpen(true)}
              title="Double-click to see breakdown"
              className="text-left bg-card border border-border rounded-xl px-3.5 py-3.5 hover:bg-muted/50 hover:border-red-200 transition-colors cursor-pointer select-none"
            >
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="text-xs font-semibold text-muted-foreground">Unavailable</span>
              </div>
              <div className="text-lg font-bold bg-gradient-to-r from-red-500 to-red-700 bg-clip-text text-transparent leading-none" data-testid="text-unavailability-sum">
                {data.kpis.unavailabilitySum}h
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {unavailBreakdown.items.length} CP{unavailBreakdown.items.length === 1 ? "" : "s"}
              </div>
            </button>

            {/* 3. Sickness */}
            <button
              data-testid="card-sickness"
              onDoubleClick={() => setSicknessModalOpen(true)}
              title="Double-click to see breakdown"
              className="text-left bg-card border border-border rounded-xl px-3.5 py-3.5 hover:bg-muted/50 hover:border-slate-300 transition-colors cursor-pointer select-none"
            >
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="text-xs font-semibold text-muted-foreground">Sickness</span>
              </div>
              <div className="text-lg font-bold bg-gradient-to-r from-slate-500 to-slate-700 bg-clip-text text-transparent leading-none" data-testid="text-sickness-sum">
                {data.kpis.sicknessSum}h
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {sicknessBreakdown.items.length} CP{sicknessBreakdown.items.length === 1 ? "" : "s"} sick
              </div>
            </button>

            {/* 4. Holidays */}
            <button
              data-testid="card-holidays"
              onDoubleClick={() => setHolidayModalOpen(true)}
              title="Double-click to see breakdown"
              className="text-left bg-card border border-border rounded-xl px-3.5 py-3.5 hover:bg-muted/50 hover:border-purple-200 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center shrink-0">
                  <Calendar className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="text-xs font-semibold text-muted-foreground">Holidays</span>
              </div>
              <div className="text-lg font-bold bg-gradient-to-r from-purple-500 to-purple-700 bg-clip-text text-transparent leading-none" data-testid="text-holidays-sum">
                {data.kpis.holidaysSum || 0}h
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {holidayBreakdown.items.length} CP{holidayBreakdown.items.length === 1 ? "" : "s"} off
              </div>
            </button>

            {/* 5. Net Capacity */}
            <button
              data-testid="card-net-capacity"
              onDoubleClick={() => setNetCapacityModalOpen(true)}
              title="Double-click to see details"
              className="text-left bg-card border border-border rounded-xl px-3.5 py-3.5 hover:bg-muted/50 hover:border-amber-200 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center shrink-0">
                  <Users className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="text-xs font-semibold text-muted-foreground">Net Capacity</span>
              </div>
              <div className="text-lg font-bold bg-gradient-to-r from-amber-600 to-amber-800 bg-clip-text text-transparent leading-none" data-testid="text-net-capacity-sum">
                {data.kpis.netCapacitySum}h
              </div>
              <div className="text-xs text-muted-foreground mt-1">available hours</div>
            </button>

            {/* 6. Domiciliary / Client Required */}
            <button
              data-testid="card-client-required"
              onDoubleClick={() => setDomiciliaryModalOpen(true)}
              title="Double-click to see details"
              className="text-left bg-card border border-border rounded-xl px-3.5 py-3.5 hover:bg-muted/50 hover:border-emerald-200 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shrink-0">
                  <Clock className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="text-xs font-semibold text-muted-foreground">Dom. Hours</span>
              </div>
              <div className="text-lg font-bold bg-gradient-to-r from-emerald-600 to-emerald-800 bg-clip-text text-transparent leading-none" data-testid="text-client-required-sum">
                {data.kpis.clientRequiredSum}h
              </div>
              <div className="text-xs text-muted-foreground mt-1">client care</div>
            </button>

            {/* 7. Client Scheduled */}
            <button
              data-testid="card-client-scheduled"
              onDoubleClick={() => setClientScheduledModalOpen(true)}
              title="Double-click to see details"
              className="text-left bg-card border border-border rounded-xl px-3.5 py-3.5 hover:bg-muted/50 hover:border-teal-200 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center shrink-0">
                  <Clock className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="text-xs font-semibold text-muted-foreground">Scheduled</span>
              </div>
              <div className="text-lg font-bold bg-gradient-to-r from-teal-600 to-teal-800 bg-clip-text text-transparent leading-none" data-testid="text-client-scheduled-sum">
                {data.kpis.clientScheduledHoursSum}h
              </div>
              <div className="text-xs text-muted-foreground mt-1">client hours</div>
            </button>

            {/* 8. Other Scheduled */}
            <button
              data-testid="card-other-scheduled"
              onDoubleClick={() => setOtherScheduledModalOpen(true)}
              title="Double-click to see details"
              className="text-left bg-card border border-border rounded-xl px-3.5 py-3.5 hover:bg-muted/50 hover:border-sky-200 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center shrink-0">
                  <Clock className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="text-xs font-semibold text-muted-foreground">Other Sched.</span>
              </div>
              <div className="text-lg font-bold bg-gradient-to-r from-sky-500 to-sky-700 bg-clip-text text-transparent leading-none" data-testid="text-other-scheduled-sum">
                {data.kpis.otherScheduledHoursSum}h
              </div>
              <div className="text-xs text-muted-foreground mt-1">non-client</div>
            </button>

            {/* 9. Capacity After Scheduling */}
            <button
              data-testid="card-capacity-after-scheduling"
              onDoubleClick={() => setCapacityAfterModalOpen(true)}
              title="Double-click to see details"
              className="text-left bg-card border border-border rounded-xl px-3.5 py-3.5 hover:bg-muted/50 hover:border-green-200 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center shrink-0">
                  <TrendingUp className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="text-xs font-semibold text-muted-foreground">After Sched.</span>
              </div>
              <div className="text-lg font-bold bg-gradient-to-r from-green-600 to-green-800 bg-clip-text text-transparent leading-none" data-testid="text-capacity-after-scheduling-sum">
                {(() => {
                  const sum = data.dailySummary.reduce((acc, day) => {
                    const employees = data.employeesByDate[day.date] || [];
                    const daySum = employees.reduce((acc, emp) => {
                      const val = emp.netCapacity - emp.scheduledHours;
                      return acc + (val >= 1 ? Math.floor(val) : 0);
                    }, 0);
                    return acc + daySum;
                  }, 0) || 0;
                  return sum;
                })()}h
              </div>
              <div className="text-xs text-muted-foreground mt-1">remaining</div>
            </button>

            {/* 10. GH Loss */}
            <button
              data-testid="card-gh-loss"
              onDoubleClick={() => setGhLossModalOpen(true)}
              title="Double-click to see breakdown"
              className="text-left bg-card border border-border rounded-xl px-3.5 py-3.5 hover:bg-muted/50 hover:border-rose-200 transition-colors cursor-pointer select-none"
            >
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-rose-500 to-rose-600 flex items-center justify-center shrink-0">
                  <TrendingUp className="w-3.5 h-3.5 text-white rotate-180" />
                </div>
                <span className="text-xs font-semibold text-muted-foreground">GH Loss</span>
              </div>
              <div className="text-lg font-bold bg-gradient-to-r from-rose-500 to-rose-700 bg-clip-text text-transparent leading-none" data-testid="text-gh-loss-total">
                {ghLossData.totalLoss}h
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {ghLossData.items.length} staff
              </div>
            </button>

          </div>
        </div>
      ) : null}

      {/* ── Intelligence View: charts below the KPI cards ── */}
      {data && (
        <div className="flex-1 min-h-0">
          <InsightCharts data={data} allHistoryData={allHistoryData} />
        </div>
      )}

      {/* Desired Hours Info Modal */}
      <Dialog open={desiredHoursModalOpen} onOpenChange={setDesiredHoursModalOpen}>
        <DialogContent className="max-w-xl w-full">
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
        <DialogContent className="max-w-xl w-full">
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
        <DialogContent className="max-w-xl w-full">
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
              <li>Live in care</li>
            </ul>
          </div>
        </DialogContent>
      </Dialog>
      {/* Client Scheduled Info Modal */}
      <Dialog open={clientScheduledModalOpen} onOpenChange={setClientScheduledModalOpen}>
        <DialogContent className="max-w-xl w-full">
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
            <div className="text-xs bg-gray-50 dark:bg-gray-800 rounded-lg p-3 font-mono">Gap = Clint care hours − Scheduled</div>
          </div>
        </DialogContent>
      </Dialog>
      {/* Other Scheduled Info Modal */}
      <Dialog open={otherScheduledModalOpen} onOpenChange={setOtherScheduledModalOpen}>
        <DialogContent className="max-w-xl w-full">
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
        <DialogContent className="max-w-xl w-full">
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
              <p>Capacity After Scheduling (+ve Houres only)</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {/* GH Loss Detail Modal */}
      <Dialog open={ghLossModalOpen} onOpenChange={setGhLossModalOpen}>
        <DialogContent className="max-w-xl w-full">
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
                    {item.otherBranchHours != null && item.otherBranches && (
                      <div className="text-[11px] text-blue-600 dark:text-blue-400 mt-0.5">
                        incl. {Object.entries(item.otherBranches).map(([b, h]) => `${h}h in ${b}`).join(', ')}
                      </div>
                    )}
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
        <DialogContent className="max-w-xl w-full">
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
        <DialogContent className="max-w-xl w-full">
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
        <DialogContent className="max-w-xl w-full">
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
    </div>
  );
}
