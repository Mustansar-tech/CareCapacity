import React, { useState, useCallback, useEffect, useMemo } from "react";
import { clientLogger } from '@/lib/logger';
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, toAbsoluteUrl } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Upload, FileSpreadsheet, AlertTriangle, CheckCircle,
  TrendingDown, Users, Clock, RefreshCw, Target, Bot
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { ProcessingResult } from "@shared/schema";
import { useBranch } from "@/contexts/BranchContext";
import { useWeek } from "@/contexts/WeekContext";

import { DailyCapacityTab } from "@/components/dashboard/DailyCapacityTab";
import { OverviewTab } from "@/components/dashboard/OverviewTab";
import { SmartHero } from "@/components/dashboard/SmartHero";
import { computeGhLoss, type GhLossResult } from "@/utils/dashboard-utils";

export default function Dashboard() {
  const { selectedBranchId } = useBranch();
  const {
    selectedWeekId,
    selectedDate,
    processedData,
    filteredData,
    allHistoryData,
    isLoadingLatest,
    latestDataError,
    handleWeekChange,
    setProcessedData,
    setFilteredData,
    setSelectedDate,
    setSelectedWeekId,
    resetToLatest,
  } = useWeek();

  const [files, setFiles] = useState<{
    availability: File | null;
    guaranteed: File | null;
    demand: File | null;
    cgData: File | null;
  }>({
    availability: null,
    guaranteed: null,
    demand: null,
    cgData: null
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [showUploadPanel, setShowUploadPanel] = useState(false);
  const [, navigate] = useLocation();
  const search = useSearch();
  const activeTab = new URLSearchParams(search).get("view") === "daily" ? "daily-capacity" : "overview";

  const { toast } = useToast();

  const ghLossData = useMemo<GhLossResult>(() => {
    const data = filteredData || processedData;
    if (!data?.employeeSummaryByDate) return { totalLoss: 0, items: [] };
    return computeGhLoss(
      data.employeeSummaryByDate as Record<string, Array<{ employeeName: string; scheduledHours: number; unavailability: number; availability?: number; ghScheduledHours?: number }>>,
      (data as any).ghLossRawSummary ?? undefined,
    );
  }, [filteredData, processedData]);

  const currentWeekStartDate = useMemo(() => {
    const data = filteredData || processedData;
    try {
      const d = data?.dailySummary?.[0]?.date;
      return d ? d.slice(0, 10) : null;
    } catch { return null; }
  }, [filteredData, processedData]);

  const { data: lastSyncData } = useQuery<{ uploadedAt: string | null }>({
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
  });

  useEffect(() => {
    const handleReset = () => {
      clientLogger.log('🏠 Navigation logo clicked - returning to overview');
      navigate('/app/dashboard');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    window.addEventListener('navigate-to-overview', handleReset);
    return () => window.removeEventListener('navigate-to-overview', handleReset);
  }, []);

  useEffect(() => {
    if (processedData) {
      setShowUploadPanel(false);
    }
  }, [processedData]);

  const handleFileChange = useCallback((type: 'availability' | 'guaranteed' | 'demand' | 'cgData') =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] || null;
      setFiles(prev => ({ ...prev, [type]: file }));
    }, []
  );

  const processMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await fetch(toAbsoluteUrl('/api/process'), {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to process files');
      }
      return response.json();
    },
    onSuccess: (data: ProcessingResult) => {
      // resetToLatest sets the fresh data immediately and arms a skip-flag so
      // the WeekContext auto-load effect doesn't overwrite it with stale
      // latestData before the /api/history/latest query re-fetches.
      resetToLatest(data, data.dailySummary?.[0]?.date ?? null);
      setIsProcessing(false);
      setFiles({ availability: null, guaranteed: null, demand: null, cgData: null });
      queryClient.invalidateQueries({ queryKey: ['/api/history'] });
      queryClient.invalidateQueries({ queryKey: ['/api/history/latest'] });
      queryClient.invalidateQueries({ queryKey: ['/api/locations'] });
      toast({
        title: "Processing Complete",
        description: "Your capacity data has been analyzed successfully."
      });
    },
    onError: (error: any) => {
      clientLogger.error('Processing error:', error);
      let errorTitle = "Processing Failed";
      let errorDescription = "An unknown error occurred.";
      if (error instanceof Error) {
        if (error.message.includes('fetch')) {
          errorTitle = "Connection Error";
          errorDescription = "Unable to connect to the server. Please check your connection and try again.";
        } else {
          errorDescription = error.message;
        }
      }
      toast({ variant: "destructive", title: errorTitle, description: errorDescription });
      setIsProcessing(false);
    }
  });

  const handleProcessFiles = useCallback(async () => {
    const allFilesSelected = files.availability && files.guaranteed && files.cgData;
    if (!allFilesSelected) {
      toast({
        variant: "destructive",
        title: "Missing Files",
        description: "Please select all three required files (Availability, Guaranteed, CG Data) before processing."
      });
      return;
    }
    setIsProcessing(true);
    const formData = new FormData();
    formData.append('availability', files.availability!);
    formData.append('guaranteed', files.guaranteed!);
    formData.append('cgData', files.cgData!);
    if (selectedBranchId) {
      formData.append('branchId', selectedBranchId);
    }
    processMutation.mutate(formData);
  }, [files, toast, processMutation, selectedBranchId]);

  const selectedDayDetailsRaw = selectedDate && (filteredData || processedData)?.employeesByDate[selectedDate] || [];
  const selectedDayDetails = statusFilter.length > 0
    ? selectedDayDetailsRaw.filter(emp => statusFilter.includes(emp.status))
    : selectedDayDetailsRaw;
  const availableStatuses = selectedDate
    ? Array.from(new Set(selectedDayDetailsRaw.map(emp => emp.status))).sort()
    : [];

  return (
    <div className="h-full w-full bg-background scroll-modern flex flex-col overflow-hidden" data-testid="dashboard-container">
      {/* Smart Hero — always visible on overview tab */}
      {activeTab === "overview" && (
        <SmartHero
          processedData={filteredData || processedData}
          allHistoryData={allHistoryData}
          lastSyncedAt={lastSyncData?.uploadedAt ?? null}
          selectedWeekId={selectedWeekId}
          handleWeekChange={handleWeekChange}
          onUploadClick={() => setShowUploadPanel(!showUploadPanel)}
          onProcessClick={() => navigate('/app/people-planner')}
          isLoadingLatest={isLoadingLatest}
        />
      )}

      {/* Main Content Area */}
      <div className="w-full flex-1 px-lg py-4 overflow-y-auto animate-fade-in flex flex-col [scrollbar-gutter:stable]">

        {/* Upload Section - no-data state */}
        {!processedData && (
          <div className="mb-2" />
        )}

        {!processedData && showUploadPanel && (
          <Card className="material-card hover-lift animate-slide-up mb-2xl elevation-2" data-testid="upload-section">
            <CardHeader className="gradient-card dark:gradient-card-dark rounded-t-lg">
              <CardTitle className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg gradient-bg flex items-center justify-center" aria-hidden="true">
                  <Upload className="w-4 h-4 text-white" />
                </div>
                <h2 className="text-xl font-semibold bg-gradient-to-r from-blue-600 to-emerald-600 bg-clip-text text-transparent">
                  Upload Files
                </h2>
                {isLoadingLatest && (
                  <div className="flex items-center gap-2" role="status" aria-label="Loading latest data">
                    <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
                    <span className="text-sm text-blue-600">Loading latest data...</span>
                  </div>
                )}
                {Boolean(latestDataError) && (
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-orange-500" />
                    <span className="text-sm text-orange-600">No previous data found</span>
                  </div>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <Card className="glass hover-lift border-primary/20 bg-primary/5 transition-all duration-300">
                  <CardContent className="p-6 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/20">
                      <FileSpreadsheet className="w-6 h-6 text-white" />
                    </div>
                    <h3 className="font-bold text-lg mb-1">Availability</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">Staff shift patterns and preferences</p>
                  </CardContent>
                </Card>
                <Card className="glass hover-lift border-secondary/20 bg-secondary/5 transition-all duration-300">
                  <CardContent className="p-6 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/20">
                      <Clock className="w-6 h-6 text-white" />
                    </div>
                    <h3 className="font-bold text-lg mb-1">Guaranteed</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">Contracted hours and core data</p>
                  </CardContent>
                </Card>
                <Card className="glass hover-lift border-orange-500/20 bg-orange-500/5 transition-all duration-300">
                  <CardContent className="p-6 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-orange-500/20">
                      <Target className="w-6 h-6 text-white" />
                    </div>
                    <h3 className="font-bold text-lg mb-1">CG Data</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">Master employee list (Required)</p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-6">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                      <Users className="w-2.5 h-2.5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <Label htmlFor="availability-file" className="text-[11px] font-medium truncate">
                      Availability
                    </Label>
                  </div>
                  <Input
                    id="availability-file"
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileChange('availability')}
                    className="file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 transition-all duration-200"
                    data-testid="input-availability-file"
                  />
                  {files.availability && (
                    <div className="flex items-center gap-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
                      <CheckCircle className="w-4 h-4 text-green-600" />
                      <p className="text-sm text-green-600 dark:text-green-400" data-testid="text-availability-selected">
                        {files.availability.name}
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center">
                      <Clock className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <Label htmlFor="guaranteed-file" className="text-[11px] font-medium truncate">
                      Guaranteed
                    </Label>
                  </div>
                  <Input
                    id="guaranteed-file"
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileChange('guaranteed')}
                    className="file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 transition-all duration-200"
                    data-testid="input-guaranteed-file"
                  />
                  {files.guaranteed && (
                    <div className="flex items-center gap-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
                      <CheckCircle className="w-4 h-4 text-green-600" />
                      <p className="text-sm text-green-600 dark:text-green-400" data-testid="text-guaranteed-selected">
                        {files.guaranteed.name}
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded bg-orange-100 dark:bg-orange-900 flex items-center justify-center">
                      <Target className="w-2.5 h-2.5 text-orange-600 dark:text-orange-400" />
                    </div>
                    <Label htmlFor="cgdata-file" className="text-[11px] font-medium truncate">
                      CG Data
                      <span className="ml-1 px-0.5 py-0.5 text-[9px] bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 rounded">
                        Master
                      </span>
                    </Label>
                  </div>
                  <Input
                    id="cgdata-file"
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileChange('cgData')}
                    className="file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100 transition-all duration-200"
                    data-testid="input-cgdata-file"
                  />
                  {files.cgData && (
                    <div className="flex items-center gap-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
                      <CheckCircle className="w-4 h-4 text-green-600" />
                      <p className="text-sm text-green-600 dark:text-green-400" data-testid="text-cgdata-selected">
                        {files.cgData.name}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleProcessFiles}
                  disabled={!files.availability || !files.guaranteed || !files.cgData || isProcessing || processMutation.isPending}
                  className="flex-1 md:flex-initial bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-700 hover:to-emerald-700 text-white border-0 shadow-lg hover:shadow-xl transition-all duration-200"
                  data-testid="button-process"
                >
                  {isProcessing || processMutation.isPending ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <FileSpreadsheet className="w-4 h-4 mr-2" />
                      Process Files
                    </>
                  )}
                </Button>
                {processedData && (
                  <Button
                    onClick={() => {
                      setProcessedData(null);
                      setFilteredData(null);
                      setSelectedDate(null);
                      setFiles({ availability: null, guaranteed: null, demand: null, cgData: null });
                      const inputs = document.querySelectorAll('input[type="file"]') as NodeListOf<HTMLInputElement>;
                      inputs.forEach(input => { input.value = ''; });
                      toast({
                        title: "Data Cleared",
                        description: "Dashboard has been reset. Upload new files to process."
                      });
                    }}
                    variant="outline"
                    className="flex items-center gap-2"
                    data-testid="button-clear"
                  >
                    <AlertTriangle className="w-4 h-4" />
                    Clear
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results Tabs - Always show when data exists */}
        {processedData && (
          <div className="w-full flex-1 flex flex-col">
            <Tabs value={activeTab} className="space-y-4 flex-1 flex flex-col" data-testid="results-tabs">

              {/* Daily Capacity Tab */}
              <TabsContent value="daily-capacity" className="space-y-4 animate-fade-in flex-1 overflow-y-auto" data-testid="content-daily-capacity">
                <DailyCapacityTab
                  processedData={processedData}
                  filteredData={filteredData}
                  isProcessing={isProcessing}
                  selectedDate={selectedDate}
                  setSelectedDate={setSelectedDate}
                  selectedDayDetails={selectedDayDetails}
                  selectedDayDetailsRaw={selectedDayDetailsRaw}
                  availableStatuses={availableStatuses}
                  statusFilter={statusFilter}
                  setStatusFilter={setStatusFilter}
                />
              </TabsContent>

              {/* Overview Tab */}
              <TabsContent value="overview" className="space-y-4 animate-fade-in flex-1 overflow-y-auto" data-testid="content-overview">
                <OverviewTab
                  processedData={processedData}
                  filteredData={filteredData}
                  isProcessing={isProcessing}
                  processMutation={processMutation}
                  showUploadPanel={showUploadPanel}
                  setShowUploadPanel={setShowUploadPanel}
                  isLoadingLatest={isLoadingLatest}
                  latestDataError={latestDataError}
                  files={files}
                  handleFileChange={handleFileChange}
                  handleProcessFiles={handleProcessFiles}
                  setProcessedData={setProcessedData}
                  setFilteredData={setFilteredData}
                  setSelectedDate={setSelectedDate}
                  setFiles={setFiles}
                  allHistoryData={allHistoryData}
                />
              </TabsContent>

            </Tabs>
          </div>
        )}
      </div>
    </div>
  );
}
