import { useMemo } from "react";
import { clientLogger } from '@/lib/logger';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  const data = filteredData || processedData;
  const ghLossData = useMemo<GhLossResult>(() => {
    if (!data?.employeeSummaryByDate) return { totalLoss: 0, items: [] };
    return computeGhLoss(
      data.employeeSummaryByDate as Record<string, Array<{ employeeName: string; scheduledHours: number; unavailability: number }>>,
      data.employeesByDate as Record<string, Array<{ employeeName: string; status: string }>>,
    );
  }, [data]);

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
            <Card className="glass hover-lift animate-scale-in" data-testid="card-desired-total">
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
            <Card className="glass hover-lift animate-scale-in" data-testid="card-unavailability">
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
                <div className="text-xs text-gray-500 dark:text-gray-400">Weekly unavailability</div>
              </CardContent>
            </Card>

            {/* 3. Sickness */}
            <Card className="glass hover-lift animate-scale-in" data-testid="card-sickness">
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
                <div className="text-xs text-gray-500 dark:text-gray-400">Weekly sickness</div>
              </CardContent>
            </Card>

            {/* 4. Holidays */}
            <Card className="glass hover-lift animate-scale-in" data-testid="card-holidays">
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
                <div className="text-xs text-gray-500 dark:text-gray-400">Weekly annual leave</div>
              </CardContent>
            </Card>

            {/* 5. Net Capacity */}
            <Card className="glass hover-lift animate-scale-in" data-testid="card-net-capacity">
              <CardHeader className="pb-3">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <CardTitle className="text-sm font-medium flex items-center gap-2 cursor-help">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center">
                          <Users className="w-4 h-4 text-white" />
                        </div>
                        <span className="text-gray-700 dark:text-gray-300">Net Capacity</span>
                      </CardTitle>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="start" className="max-w-sm text-sm z-50">
                      <div className="space-y-1.5">
                        <p className="font-semibold">Total available hours after exclusions</p>
                        <p className="text-xs opacity-90">Calculated as:</p>
                        <div className="text-xs space-y-1 opacity-90 font-mono">
                          <p>Contracted Hours − (Sickness + Holidays + Unavailability)</p>
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold bg-gradient-to-r from-amber-600 to-amber-800 bg-clip-text text-transparent mb-1" data-testid="text-net-capacity-sum">
                  {data?.kpis.netCapacitySum}h
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Total available hours</div>
              </CardContent>
            </Card>

            {/* 6. Client Required / Domiciliary Hours */}
            <Card className="glass hover-lift animate-scale-in" data-testid="card-client-required">
              <CardHeader className="pb-3">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <CardTitle className="text-sm font-medium flex items-center gap-2 cursor-help">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
                          <Clock className="w-4 h-4 text-white" />
                        </div>
                        <span className="text-gray-700 dark:text-gray-300">Domiciliary Hours</span>
                      </CardTitle>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="start" className="max-w-sm text-sm z-50">
                      <div className="space-y-1.5">
                        <p className="font-semibold">Total branch domiciliary care hours</p>
                        <p className="text-xs opacity-90">Excludes:</p>
                        <ul className="text-xs space-y-0.5 opacity-90 list-disc list-inside">
                          <li>Cancelled visits</li>
                          <li>Secondary/multiple care</li>
                          <li>Office hours & training</li>
                          <li>Sleep-in & waking nights</li>
                          <li>Shadowing & on-call</li>
                        </ul>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold bg-gradient-to-r from-emerald-600 to-emerald-800 bg-clip-text text-transparent mb-1" data-testid="text-client-required-sum">
                  {data?.kpis.clientRequiredSum}h
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">client care Hours</div>
              </CardContent>
            </Card>

            {/* 6b. Client Scheduled Hours */}
            <Card className="glass hover-lift animate-scale-in" data-testid="card-client-scheduled">
              <CardHeader className="pb-3">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <CardTitle className="text-sm font-medium flex items-center gap-2 cursor-help">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center">
                          <Clock className="w-4 h-4 text-white" />
                        </div>
                        <span className="text-gray-700 dark:text-gray-300">Client Scheduled</span>
                      </CardTitle>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="center" className="max-w-xs text-sm z-50">
                      <div className="space-y-1.5">
                        <p className="font-semibold">Domiciliary hours scheduled</p>
                        <p className="text-xs opacity-90">Actual client hours scheduled</p>
                        <p className="text-xs opacity-75 font-mono">Gap = Required − Scheduled</p>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold bg-gradient-to-r from-teal-600 to-teal-800 bg-clip-text text-transparent mb-1" data-testid="text-client-scheduled-sum">
                  {data?.kpis.clientScheduledHoursSum}h
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Hours scheduled to meet demand</div>
              </CardContent>
            </Card>

            {/* 7. Other Scheduled */}
            <Card className="glass hover-lift animate-scale-in" data-testid="card-other-scheduled">
              <CardHeader className="pb-3">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <CardTitle className="text-sm font-medium flex items-center gap-2 cursor-help">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-200 dark:shadow-none">
                          <Clock className="w-4 h-4 text-white" />
                        </div>
                        <span className="text-gray-700 dark:text-gray-300">Other Scheduled</span>
                      </CardTitle>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="start" className="max-w-sm text-sm z-50">
                      <div className="space-y-1.5">
                        <p className="font-semibold">Non-client hours scheduled</p>
                        <p className="text-xs opacity-90">Includes:</p>
                        <ul className="text-xs space-y-0.5 opacity-90 list-disc list-inside">
                          <li>Office hours & admin work</li>
                          <li>Training sessions</li>
                          <li>Shadowing & induction</li>
                          <li>On-call duties</li>
                        </ul>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold bg-gradient-to-r from-indigo-500 to-indigo-700 bg-clip-text text-transparent mb-1" data-testid="text-other-scheduled-sum">
                  {data?.kpis.otherScheduledHoursSum}h
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Non-client hours</div>
              </CardContent>
            </Card>

            {/* 8. Capacity After Scheduling */}
            <Card className="glass hover-lift animate-scale-in" data-testid="card-capacity-after-scheduling">
              <CardHeader className="pb-3">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <CardTitle className="text-sm font-medium flex items-center gap-2 cursor-help">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center">
                          <TrendingUp className="w-4 h-4 text-white" />
                        </div>
                        <span className="text-gray-700 dark:text-gray-300">Capacity After Scheduling</span>
                      </CardTitle>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="start" className="max-w-sm text-sm z-50">
                      <div className="space-y-1.5">
                        <p className="font-semibold">Available capacity remaining</p>
                        <p className="text-xs opacity-90">Calculated as:</p>
                        <div className="text-xs space-y-1 opacity-90 font-mono">
                          <p>Net Capacity − (Domiciliary + Other Scheduled)</p>
                          <p className="text-xs opacity-75">Values &lt; 1h are excluded (floored)</p>
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
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
            <Card className="glass hover-lift animate-scale-in" data-testid="card-gh-loss">
              <CardHeader className="pb-3">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <CardTitle className="text-sm font-medium flex items-center gap-2 cursor-help">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500 to-rose-600 flex items-center justify-center">
                          <TrendingUp className="w-4 h-4 text-white rotate-180" />
                        </div>
                        <span className="text-gray-700 dark:text-gray-300">GH Loss</span>
                      </CardTitle>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="start" className="w-80 text-sm z-50 p-0">
                      <div className="px-3 pt-3 pb-2 border-b border-white/10">
                        <p className="font-semibold text-sm">GH employees under their weekly target</p>
                        <p className="text-xs opacity-60 mt-0.5">Loss = GH target − unavailability − scheduled</p>
                      </div>
                      {ghLossData.items.length > 0 ? (
                        <div className="max-h-72 overflow-y-auto divide-y divide-white/10">
                          {ghLossData.items.map((item) => (
                            <div key={item.name} className="px-3 py-2">
                              <div className="flex items-start justify-between gap-2">
                                <span className="font-semibold text-xs leading-snug">{item.name}</span>
                                <span className="text-xs font-bold text-orange-400 whitespace-nowrap shrink-0">
                                  {item.loss}h short
                                </span>
                              </div>
                              <div className="text-xs opacity-60 mt-0.5 flex gap-3">
                                <span>GH: {item.ghHours}h</span>
                                {item.weeklyUnavailability > 0 && (
                                  <span>Unavail: {item.weeklyUnavailability}h</span>
                                )}
                                <span>Sched: {item.weeklyScheduled}h</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="px-3 py-3 text-xs opacity-60">No GH loss detected this week.</p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
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
    </>
  );
}
