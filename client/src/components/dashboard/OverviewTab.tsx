import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toAbsoluteUrl } from "@/lib/queryClient";
import { useBranch } from "@/contexts/BranchContext";
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
  const { selectedBranchId } = useBranch();

  const data = filteredData || processedData;

  // Derive the Monday start date of whichever week is currently displayed
  const currentWeekStartDate = (() => {
    try {
      const d = data?.dailySummary?.[0]?.date;
      return d ? d.slice(0, 10) : null;
    } catch { return null; }
  })();

  const { data: lastSyncData } = useQuery<{ uploadedAt: string | null; weekStartDate?: string | null; weekEndDate?: string }>({
    queryKey: ["/api/pp/last-sync", selectedBranchId, currentWeekStartDate],
    queryFn: async () => {
      if (!selectedBranchId) return { uploadedAt: null };
      const url = currentWeekStartDate
        ? `/api/pp/last-sync/${selectedBranchId}?weekStartDate=${currentWeekStartDate}`
        : `/api/pp/last-sync/${selectedBranchId}`;
      const res = await fetch(toAbsoluteUrl(url), { credentials: "include" });
      if (!res.ok) return { uploadedAt: null };
      return res.json();
    },
    enabled: !!selectedBranchId,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  const [sicknessModalOpen, setSicknessModalOpen] = useState(false);
  const [unavailModalOpen, setUnavailModalOpen] = useState(false);
  const [holidayModalOpen, setHolidayModalOpen] = useState(false);
  const [netCapacityModalOpen, setNetCapacityModalOpen] = useState(false);
  const [domiciliaryModalOpen, setDomiciliaryModalOpen] = useState(false);
  const [clientScheduledModalOpen, setClientScheduledModalOpen] = useState(false);
  const [otherScheduledModalOpen, setOtherScheduledModalOpen] = useState(false);
  const [capacityAfterModalOpen, setCapacityAfterModalOpen] = useState(false);
  const [desiredHoursModalOpen, setDesiredHoursModalOpen] = useState(false);
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
          className="glass-card hover:shadow-lg transition-all duration-200 h-9 px-4 text-sm border-tertiary/30 text-tertiary hover:bg-tertiary-container/50"
          title="Automatically download reports from People Planner"
        >
          <Bot className="w-3.5 h-3.5 mr-2" />
          Process Data
        </Button>
      </div>
      {/* File Upload Section */}
      {showUploadPanel && (
        <Card className="mb-6 glass hover-lift animate-slide-up" data-testid="upload-section-overview">
          <CardHeader className="border-b border-card-border bg-surface-container/40 rounded-t-lg">
            <CardTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Upload className="w-4 h-4 text-white" />
              </div>
              <span className="text-foreground font-display">
                Upload Files
              </span>
              {isLoadingLatest && (
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                  <span className="text-sm text-primary">Loading latest data...</span>
                </div>
              )}
              {!!latestDataError && (
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-warning" />
                  <span className="text-sm text-warning">No previous data found</span>
                </div>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              {/* Availability Export */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-primary-container flex items-center justify-center">
                    <Users className="w-3 h-3 text-primary" />
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
                  className="file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-container file:text-primary-on-container hover:file:opacity-90 transition-all duration-200"
                  data-testid="input-availability-file-overview"
                />
                {files.availability && (
                  <div className="flex items-center gap-2 p-2 bg-success-container/60 rounded-lg">
                    <CheckCircle className="w-4 h-4 text-success" />
                    <p className="text-sm text-success" data-testid="text-availability-selected-overview">
                      {files.availability.name}
                    </p>
                  </div>
                )}
              </div>

              {/* Guaranteed Hours */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-secondary-container flex items-center justify-center">
                    <Clock className="w-3 h-3 text-secondary" />
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
                  className="file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-secondary-container file:text-secondary-on-container hover:file:opacity-90 transition-all duration-200"
                  data-testid="input-guaranteed-file-overview"
                />
                {files.guaranteed && (
                  <div className="flex items-center gap-2 p-2 bg-success-container/60 rounded-lg">
                    <CheckCircle className="w-4 h-4 text-success" />
                    <p className="text-sm text-success" data-testid="text-guaranteed-selected-overview">
                      {files.guaranteed.name}
                    </p>
                  </div>
                )}
              </div>

              {/* CG Data Export */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-warning-container flex items-center justify-center">
                    <Target className="w-3 h-3 text-warning" />
                  </div>
                  <Label htmlFor="cgdata-file-overview" className="text-sm font-medium">
                    CG Data Export.xlsx
                    <span className="ml-2 px-1 py-0.5 text-[10px] bg-warning-container text-warning rounded">Master</span>
                  </Label>
                </div>
                <Input
                  id="cgdata-file-overview"
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileChange('cgData')}
                  className="file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-warning-container file:text-warning hover:file:opacity-90 transition-all duration-200"
                  data-testid="input-cgdata-file-overview"
                />
                {files.cgData && (
                  <div className="flex items-center gap-2 p-2 bg-success-container/60 rounded-lg">
                    <CheckCircle className="w-4 h-4 text-success" />
                    <p className="text-sm text-success" data-testid="text-cgdata-selected-overview">
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
                className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-2 font-semibold shadow-lg disabled:opacity-50"
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
                <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-md">
                  <Calendar className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1">
                  <div className="font-bold text-lg text-foreground font-display mb-2">
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
                        Current Week{(() => {
                          try {
                            const now = new Date();
                            const day = now.getUTCDay();
                            const diff = day === 0 ? -6 : 1 - day;
                            const mon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff));
                            const sun = new Date(mon);
                            sun.setUTCDate(mon.getUTCDate() + 6);
                            return ` (${mon.toLocaleDateString('en-GB')} – ${sun.toLocaleDateString('en-GB')})`;
                          } catch {
                            return '';
                          }
                        })()}
                      </SelectItem>
                      {(() => {
                        // 15-week window: 2 past weeks + current week + 13 future weeks
                        const now = new Date();
                        const day = now.getUTCDay();
                        const diff = day === 0 ? -6 : 1 - day;
                        const currentMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff));
                        const lowerCutoff = new Date(currentMonday);
                        lowerCutoff.setUTCDate(lowerCutoff.getUTCDate() - 14);
                        const upperCutoff = new Date(currentMonday);
                        upperCutoff.setUTCDate(upperCutoff.getUTCDate() + 13 * 7);
                        return allHistoryData
                          ?.filter((a) => {
                            if (!a.weekStartDate) return false;
                            const d = new Date(a.weekStartDate);
                            return d >= lowerCutoff && d <= upperCutoff;
                          })
                          .map((analysis) => {
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
                          })
                          .filter(Boolean);
                      })()}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-sm text-muted-foreground font-medium">
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
                    </span>
                    {lastSyncData?.uploadedAt && (
                      <span className="text-xs text-muted-foreground/70 flex items-center gap-1">
                        <Clock className="w-3 h-3 flex-shrink-0" />
                        Last synced:{" "}
                        {new Date(lastSyncData.uploadedAt).toLocaleString('en-GB', {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="flex items-center gap-2 py-2 px-3 bg-card">
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
                className="hover:bg-primary-container/60"
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
                  <div className="w-8 h-8 rounded-lg bg-success flex items-center justify-center">
                    <Clock className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-foreground/80">Desired Hours</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-display text-3xl font-bold text-success tabular-nums mb-1" data-testid="text-desired-sum">
                  {data?.kpis.totalDesiredHoursSum || 0}h
                </div>
                <div className="text-xs text-muted-foreground">Total weekly desired</div>
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
                  <div className="w-8 h-8 rounded-lg bg-error flex items-center justify-center">
                    <AlertTriangle className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-foreground/80">Unavailability</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-display text-3xl font-bold text-error tabular-nums mb-1" data-testid="text-unavailability-sum">
                  {data?.kpis.unavailabilitySum}h
                </div>
                <div className="text-xs text-muted-foreground">
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
                  <div className="w-8 h-8 rounded-lg bg-muted-foreground flex items-center justify-center">
                    <AlertTriangle className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-foreground/80">Sickness</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-display text-3xl font-bold text-muted-foreground tabular-nums mb-1" data-testid="text-sickness-sum">
                  {data?.kpis.sicknessSum}h
                </div>
                <div className="text-xs text-muted-foreground">
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
                  <div className="w-8 h-8 rounded-lg bg-tertiary flex items-center justify-center">
                    <Calendar className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-foreground/80">Holidays</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-display text-3xl font-bold text-tertiary tabular-nums mb-1" data-testid="text-holidays-sum">
                  {data?.kpis.holidaysSum || 0}h
                </div>
                <div className="text-xs text-muted-foreground">
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
                  <div className="w-8 h-8 rounded-lg bg-warning flex items-center justify-center">
                    <Users className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-foreground/80">Net Capacity</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-display text-3xl font-bold text-warning tabular-nums mb-1" data-testid="text-net-capacity-sum">
                  {data?.kpis.netCapacitySum}h
                </div>
                <div className="text-xs text-muted-foreground">Total available hours</div>
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
                  <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                    <Clock className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-foreground/80">Domiciliary Hours</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-display text-3xl font-bold text-primary tabular-nums mb-1" data-testid="text-client-required-sum">
                  {data?.kpis.clientRequiredSum}h
                </div>
                <div className="text-xs text-muted-foreground">client care Hours</div>
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
                  <div className="w-8 h-8 rounded-lg bg-chart-6 flex items-center justify-center">
                    <Clock className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-foreground/80">Client Scheduled</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-display text-3xl font-bold text-chart-6 tabular-nums mb-1" data-testid="text-client-scheduled-sum">
                  {data?.kpis.clientScheduledHoursSum}h
                </div>
                <div className="text-xs text-muted-foreground">Hours scheduled to meet demand</div>
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
                  <div className="w-8 h-8 rounded-lg bg-tertiary flex items-center justify-center">
                    <Clock className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-foreground/80">Other Scheduled</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-display text-3xl font-bold text-tertiary tabular-nums mb-1" data-testid="text-other-scheduled-sum">
                  {data?.kpis.otherScheduledHoursSum}h
                </div>
                <div className="text-xs text-muted-foreground">Non-client hours</div>
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
                  <div className="w-8 h-8 rounded-lg bg-success flex items-center justify-center">
                    <TrendingUp className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-foreground/80">Capacity After Scheduling</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-display text-3xl font-bold text-success tabular-nums mb-1" data-testid="text-capacity-after-scheduling-sum">
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
                <div className="text-xs text-muted-foreground">Total remaining capacity</div>
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
                  <div className="w-8 h-8 rounded-lg bg-error flex items-center justify-center">
                    <TrendingUp className="w-4 h-4 text-white rotate-180" />
                  </div>
                  <span className="text-foreground/80">GH Loss</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-display text-3xl font-bold text-error tabular-nums mb-1" data-testid="text-gh-loss-total">
                  {ghLossData.totalLoss}h
                </div>
                <div className="text-xs text-muted-foreground">
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
              <div className="w-7 h-7 rounded-lg bg-success flex items-center justify-center">
                <Clock className="w-3.5 h-3.5 text-white" />
              </div>
              Desired Hours
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-foreground/80">
            <p className="font-semibold">Total Desired hours across all Care Pros</p>
            <p className="text-xs text-muted-foreground">The sum of each Care Pro's desired weekly hours from their availability schedule. This represents the maximum hours the branch workforce is desired to deliver before any deductions for sickness, holidays, or unavailability.</p>
            <div className="text-xs bg-surface-container rounded-lg p-3 font-mono">
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
              <div className="w-7 h-7 rounded-lg bg-warning flex items-center justify-center">
                <Users className="w-3.5 h-3.5 text-white" />
              </div>
              Net Capacity
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-foreground/80">
            <p className="font-semibold">Total available hours after exclusions</p>
            <p className="text-xs text-muted-foreground">Calculated as:</p>
            <div className="text-xs bg-surface-container rounded-lg p-3 font-mono">Desired Hours − (Sickness + Holidays + Unavailability)</div>
          </div>
        </DialogContent>
      </Dialog>
      {/* Domiciliary Hours Info Modal */}
      <Dialog open={domiciliaryModalOpen} onOpenChange={setDomiciliaryModalOpen}>
        <DialogContent className="max-w-sm w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
                <Clock className="w-3.5 h-3.5 text-white" />
              </div>
              Domiciliary Hours
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-foreground/80">
            <p className="font-semibold">Total branch domiciliary care hours</p>
            <p className="text-xs text-muted-foreground">Excludes:</p>
            <ul className="text-xs space-y-1.5 list-disc list-inside text-muted-foreground">
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
        <DialogContent className="max-w-sm w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-chart-6 flex items-center justify-center">
                <Clock className="w-3.5 h-3.5 text-white" />
              </div>
              Client Scheduled
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-foreground/80">
            <p className="font-semibold">Domiciliary hours scheduled</p>
            <p className="text-xs text-muted-foreground">Actual client hours scheduled</p>
            <div className="text-xs bg-surface-container rounded-lg p-3 font-mono">Gap = Clint care hours − Scheduled</div>
          </div>
        </DialogContent>
      </Dialog>
      {/* Other Scheduled Info Modal */}
      <Dialog open={otherScheduledModalOpen} onOpenChange={setOtherScheduledModalOpen}>
        <DialogContent className="max-w-sm w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-tertiary flex items-center justify-center">
                <Clock className="w-3.5 h-3.5 text-white" />
              </div>
              Other Scheduled
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-foreground/80">
            <p className="font-semibold">Non-client hours scheduled</p>
            <p className="text-xs text-muted-foreground">Includes:</p>
            <ul className="text-xs space-y-1.5 list-disc list-inside text-muted-foreground">
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
              <div className="w-7 h-7 rounded-lg bg-success flex items-center justify-center">
                <TrendingUp className="w-3.5 h-3.5 text-white" />
              </div>
              Capacity After Scheduling
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-foreground/80">
            <p className="font-semibold">Available capacity remaining</p>
            <p className="text-xs text-muted-foreground">Calculated as:</p>
            <div className="text-xs bg-surface-container rounded-lg p-3 font-mono space-y-1">
              <p>Capacity After Scheduling (+ve Houres only)</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {/* GH Loss Detail Modal */}
      <Dialog open={ghLossModalOpen} onOpenChange={setGhLossModalOpen}>
        <DialogContent className="max-w-lg w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-error flex items-center justify-center">
                <TrendingUp className="w-3.5 h-3.5 text-white rotate-180" />
              </div>
              GH Loss Breakdown
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              GH employees working fewer hours than their weekly contracted target
            </p>
          </DialogHeader>

          {ghLossData.items.length > 0 ? (
            <div className="divide-y divide-border max-h-[60vh] overflow-y-auto -mx-6 px-6">
              {ghLossData.items.map((item) => (
                <div key={item.name} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-foreground truncate">
                      {item.name.includes(", ") ? item.name.split(", ").reverse().join(" ") : item.name}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex gap-3 flex-wrap">
                      <span>Contracted: <span className="font-medium text-foreground/80">{item.ghHours}h</span></span>
                      {item.weeklyUnavailability > 0 && (
                        <span>Unavail: <span className="font-medium text-foreground/80">{item.weeklyUnavailability}h</span></span>
                      )}
                      <span>Scheduled: <span className="font-medium text-foreground/80">{item.weeklyScheduled}h</span></span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="inline-block px-2 py-0.5 rounded-full bg-error-container text-error text-xs font-bold whitespace-nowrap">
                      {item.loss}h short
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center">
              <CheckCircle className="w-10 h-10 text-success mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No GH loss detected this week.</p>
            </div>
          )}

          {ghLossData.items.length > 0 && (
            <div className="flex items-center justify-between pt-2 border-t border-border mt-1">
              <span className="text-xs text-muted-foreground">{ghLossData.items.length} staff affected</span>
              <span className="text-sm font-bold text-error">Total: {ghLossData.totalLoss}h short</span>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* Sickness Detail Modal */}
      <Dialog open={sicknessModalOpen} onOpenChange={setSicknessModalOpen}>
        <DialogContent className="max-w-lg w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-muted-foreground flex items-center justify-center">
                <AlertTriangle className="w-3.5 h-3.5 text-white" />
              </div>
              Sickness Breakdown
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Care Pros off sick this week
            </p>
          </DialogHeader>

          {sicknessBreakdown.items.length > 0 ? (
            <div className="divide-y divide-border max-h-[60vh] overflow-y-auto -mx-6 px-6">
              {sicknessBreakdown.items.map((item) => (
                <div key={item.name} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-foreground truncate">
                      {formatName(item.name)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {item.days} day{item.days === 1 ? "" : "s"} affected
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="inline-block px-2 py-0.5 rounded-full bg-surface-container text-muted-foreground text-xs font-bold whitespace-nowrap">
                      {item.hours}h
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center">
              <CheckCircle className="w-10 h-10 text-success mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No sickness recorded this week.</p>
            </div>
          )}

          {sicknessBreakdown.items.length > 0 && (
            <div className="flex items-center justify-between pt-2 border-t border-border mt-1">
              <span className="text-xs text-muted-foreground">{sicknessBreakdown.items.length} CP{sicknessBreakdown.items.length === 1 ? "" : "s"} off sick</span>
              <span className="text-sm font-bold text-muted-foreground">Total: {sicknessBreakdown.total}h</span>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* Unavailability Detail Modal */}
      <Dialog open={unavailModalOpen} onOpenChange={setUnavailModalOpen}>
        <DialogContent className="max-w-lg w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-error flex items-center justify-center">
                <AlertTriangle className="w-3.5 h-3.5 text-white" />
              </div>
              Unavailability Breakdown
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Care Pros unavailable this week (excluding sickness &amp; holidays)
            </p>
          </DialogHeader>

          {unavailBreakdown.items.length > 0 ? (
            <div className="divide-y divide-border max-h-[60vh] overflow-y-auto -mx-6 px-6">
              {unavailBreakdown.items.map((item) => (
                <div key={item.name} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-foreground truncate">
                      {formatName(item.name)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
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
              <CheckCircle className="w-10 h-10 text-success mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No unavailability recorded this week.</p>
            </div>
          )}

          {unavailBreakdown.items.length > 0 && (
            <div className="flex items-center justify-between pt-2 border-t border-border mt-1">
              <span className="text-xs text-muted-foreground">{unavailBreakdown.items.length} CP{unavailBreakdown.items.length === 1 ? "" : "s"} unavailable</span>
              <span className="text-sm font-bold text-error">Total: {unavailBreakdown.total}h</span>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* Holidays Detail Modal */}
      <Dialog open={holidayModalOpen} onOpenChange={setHolidayModalOpen}>
        <DialogContent className="max-w-lg w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-tertiary flex items-center justify-center">
                <Calendar className="w-3.5 h-3.5 text-white" />
              </div>
              Holidays Breakdown
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Care Pros on annual leave this week
            </p>
          </DialogHeader>

          {holidayBreakdown.items.length > 0 ? (
            <div className="divide-y divide-border max-h-[60vh] overflow-y-auto -mx-6 px-6">
              {holidayBreakdown.items.map((item) => (
                <div key={item.name} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-foreground truncate">
                      {formatName(item.name)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {item.days} day{item.days === 1 ? "" : "s"} on leave
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="inline-block px-2 py-0.5 rounded-full bg-tertiary-container text-tertiary text-xs font-bold whitespace-nowrap">
                      {item.hours}h
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center">
              <CheckCircle className="w-10 h-10 text-success mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No holidays recorded this week.</p>
            </div>
          )}

          {holidayBreakdown.items.length > 0 && (
            <div className="flex items-center justify-between pt-2 border-t border-border mt-1">
              <span className="text-xs text-muted-foreground">{holidayBreakdown.items.length} CP{holidayBreakdown.items.length === 1 ? "" : "s"} on holiday</span>
              <span className="text-sm font-bold text-tertiary">Total: {holidayBreakdown.total}h</span>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
