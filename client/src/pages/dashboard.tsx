import React, { useState, useCallback, useEffect, lazy, Suspense } from "react";
import { clientLogger } from '@/lib/logger';
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronDown } from "lucide-react";
import {
  Upload, FileSpreadsheet, AlertTriangle, CheckCircle,
  TrendingUp, TrendingDown, Users, Clock, Calendar, BarChart3, RefreshCw, Zap, Target
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { ProcessingResult, CapacityAnalysisSummary, ProcessingResultWithMeta } from "@shared/schema";
import { useBranch } from "@/contexts/BranchContext";
import { MetricCardSkeleton, TableSkeleton } from "@/components/loading-skeleton";
import { FlexibleTimeWindow } from "@/components/flexible-time-window";
import { getGenderColorClass } from "@/utils/gender-colors";

const WeeklyPlanTab = lazy(() => import("@/components/weekly-plan-tab").then(m => ({ default: m.WeeklyPlanTab })));
const BDMatrix = lazy(() => import("@/pages/bd-matrix"));



import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Helper formatting functions
const fmtH = (hours: number): string => `${hours}h`;
const fmtSignedH = (hours: number): string => `${hours >= 0 ? '+' : ''}${hours}h`;
const statusBadge = (status: string): string => {
  return status === 'Sufficient'
    ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white'
    : 'bg-gradient-to-r from-red-500 to-red-600 text-white';
};

// Render a colored status pill; Ad-hoc gets a bold amber badge
const renderStatusBadge = (status: string) => {
  if (status === "Ad-hoc") {
    return (
      <Badge
        variant="secondary"
        className="gap-1.5 bg-gradient-to-r from-amber-500 to-amber-600 text-white border-0 shadow-sm"
        data-testid="badge-adhoc"
        title="Scheduled but no availability record for this day"
      >
        <Zap className="w-3.5 h-3.5" />
        Ad-hoc
      </Badge>
    );
  }
  
  // Custom styling based on status content
  let badgeClass = "font-medium shadow-sm";
  if (status.includes("Available")) {
    badgeClass = "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300 border-green-200";
  } else if (status.includes("Holiday")) {
    badgeClass = "bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300 border-purple-200";
  } else if (status.includes("Sickness") || status.includes("Sick")) {
    badgeClass = "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300";
  } else if (status.includes("Day-Killer")) {
    badgeClass = "bg-red-600 text-white dark:bg-red-900 dark:text-red-100 border-red-700";
  } else {
    badgeClass = "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 border-gray-200";
  }

  return (
    <Badge variant="outline" className={badgeClass} data-testid="badge-status-default">
      {status}
    </Badge>
  );
};

export default function Dashboard() {
  // Get selected branch ID
  const { selectedBranchId } = useBranch();

  // File upload state - Adding CG Data Export as 4th file
  const [files, setFiles] = useState<{
    availability: File | null;
    guaranteed: File | null;
    demand: File | null; // This will be removed
    cgData: File | null;
  }>({
    availability: null,
    guaranteed: null,
    demand: null,
    cgData: null
  });

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedData, setProcessedData] = useState<ProcessingResult | null>(null);
  const [filteredData, setFilteredData] = useState<ProcessingResult | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [warnings] = useState<string[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [showUploadPanel, setShowUploadPanel] = useState(false);

  const { toast } = useToast();

  // Listen for global reset event from the navigation logo
  useEffect(() => {
    const handleReset = () => {
      clientLogger.log('🏠 Navigation logo clicked - returning to overview');
      setActiveTab("overview");
      // Scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    window.addEventListener('navigate-to-overview', handleReset);
    return () => window.removeEventListener('navigate-to-overview', handleReset);
  }, []);

  // Query to get all historical weeks for the dropdown
  const { data: allHistoryData } = useQuery<CapacityAnalysisSummary[]>({
    queryKey: ['/api/history'],
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  // Query to load latest data automatically
  const { data: latestData, error: latestDataError, isLoading: isLoadingLatest } = useQuery<ProcessingResultWithMeta>({
    queryKey: ['/api/history/latest'],
    enabled: !isProcessing && !files.availability && !files.guaranteed && !files.demand && !files.cgData, // Only fetch if not processing and no files selected
    refetchOnWindowFocus: false, // Prevent refetch when window regains focus
    refetchOnMount: false, // Prevent refetch on component mount
  });

  // Clear processed data when branch changes
  useEffect(() => {
    clientLogger.log('🧹 Branch changed - clearing all processed data');
    setProcessedData(null);
    setFilteredData(null);
    setSelectedWeekId(null);
    setSelectedDate(null);
  }, [selectedBranchId]);

  // Clear processed data if it doesn't match current branch
  useEffect(() => {
    if (latestData && latestData.branchId !== selectedBranchId) {
      clientLogger.log('🧹 Clearing stale data from different branch');
      setProcessedData(null);
      setFilteredData(null);
    }
  }, [latestData, selectedBranchId]);

  // Auto-load latest data when component mounts or when we don't have data
  useEffect(() => {
    if (latestData && !processedData && !selectedWeekId && latestData.branchId === selectedBranchId) {
      setProcessedData({
        kpis: latestData.kpis,
        dailySummary: latestData.dailySummary,
        employeesByDate: latestData.employeesByDate,
        employeeSummaryByDate: latestData.employeeSummaryByDate,
        warnings: latestData.warnings,
      });
      setSelectedDate(latestData.dailySummary?.[0]?.date || null);
      toast({
        title: "Latest Data Loaded",
        description: "Automatically loaded your most recent analysis."
      });
    }
  }, [latestData, processedData, selectedWeekId, selectedBranchId, toast]);

  // Auto-hide upload panel when data is processed
  useEffect(() => {
    if (processedData) {
      setShowUploadPanel(false);
    }
  }, [processedData]);

  // Handle week selection
  const handleWeekChange = useCallback(async (value: string) => {
    if (value === "latest") {
      setSelectedWeekId(null);
      return;
    }

    try {
      setSelectedWeekId(value);
      const analysis = allHistoryData?.find(item => item.id === value);
      if (analysis) {
        setProcessedData({
          kpis: analysis.kpis,
          dailySummary: analysis.dailySummary,
          employeesByDate: analysis.employeesByDate,
          employeeSummaryByDate: analysis.employeeSummaryByDate,
          warnings: analysis.warnings,
        });
        setSelectedDate(analysis.dailySummary?.[0]?.date || null);
        setFilteredData(null); // Clear any filters
      }
    } catch (error) {
      clientLogger.error('Error loading selected week:', error);
      toast({
        variant: "destructive",
        title: "Error Loading Week",
        description: "Failed to load the selected week data."
      });
    }
  }, [allHistoryData, toast]);

  // Handle file selection
  const handleFileChange = useCallback((type: 'availability' | 'guaranteed' | 'demand' | 'cgData') =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] || null;
      setFiles(prev => ({ ...prev, [type]: file }));
    }, []
  );

  // Mutation for processing files
  const processMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await fetch('/api/process', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to process files');
      }

      return response.json();
    },
    onSuccess: (data: ProcessingResult) => {
      setProcessedData(data);
      setIsProcessing(false);

      // Auto-select the first date so all tabs work immediately
      if (data.dailySummary && data.dailySummary.length > 0) {
        setSelectedDate(data.dailySummary[0].date);
      }

      // Clear file inputs after successful processing
      setFiles({
        availability: null,
        guaranteed: null,
        demand: null,
        cgData: null
      });

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
      toast({
        variant: "destructive",
        title: errorTitle,
        description: errorDescription
      });
      setIsProcessing(false); // Ensure processing state is reset on error
    }
  });

  // Process files
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


  // Get selected day details - use filtered data if available, otherwise processed data
  const selectedDayDetailsRaw = selectedDate && (filteredData || processedData)?.employeesByDate[selectedDate] || [];

  // Apply status filter if any statuses are selected
  const selectedDayDetails = statusFilter.length > 0
    ? selectedDayDetailsRaw.filter(emp => statusFilter.includes(emp.status))
    : selectedDayDetailsRaw;

  // Get unique statuses from the current day's employees for the filter dropdown
  const availableStatuses = selectedDate
    ? Array.from(new Set(selectedDayDetailsRaw.map(emp => emp.status))).sort()
    : [];

  return (
    <div className="h-screen w-screen bg-background scroll-modern flex flex-col overflow-hidden" data-testid="dashboard-container">
      {/* Hero Section with Modern Layout - Only show on Overview tab */}
      {activeTab === "overview" && (
        <div className="bg-gradient-to-br from-primary/5 via-secondary/5 to-tertiary/5 border-b border-card-border shrink-0">
          <div className="w-full px-lg py-6 text-center">
            <h1 className="font-display text-5xl font-semibold bg-gradient-to-r from-blue-600 to-emerald-600 bg-clip-text text-transparent mb-2">
              Welcome to Care Capacity Dashboard
            </h1>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
              Intelligent workforce capacity analysis for optimal care scheduling and resource management
            </p>
          </div>
        </div>
      )}
      {/* Main Content Area */}
      <div className="w-full flex-1 px-lg py-4 overflow-y-auto animate-fade-in flex flex-col">
        {/* Compact Upload Toggle - Shows when no data is loaded */}
        {!processedData && (
          <div className="mb-6 animate-fade-in">
            <Button
              onClick={() => setShowUploadPanel(!showUploadPanel)}
              variant="outline"
              className="glass-card hover:shadow-lg transition-all duration-200 h-12 px-6"
              data-testid="toggle-upload-panel"
            >
              <Upload className="w-4 h-4 mr-2" />
              {showUploadPanel ? 'Hide Upload Panel' : 'Upload New Data'}
            </Button>
          </div>
        )}

        {/* Upload Section - Collapsible */}
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
            {latestDataError && (
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-500" />
                <span className="text-sm text-orange-600">No previous data found</span>
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Show intro cards only when no data exists */}
          {!processedData && (
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
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-6">
            {/* Availability Export */}
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

            {/* Guaranteed Hours */}
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

            {/* CG Data Export - NEW MASTER EMPLOYEE LIST */}
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
                  setFiles({
                    availability: null,
                    guaranteed: null,
                    demand: null, // Keep demand in state for reset, though not used
                    cgData: null
                  });
                  // Clear file inputs
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

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4 flex-1 flex flex-col" data-testid="results-tabs">
          <TabsList className="flex w-full gap-1 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm p-1 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm h-auto overflow-hidden">
            <TabsTrigger
              value="overview"
              className="flex-1 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg hover:bg-muted/50 transition-all duration-300 rounded-lg font-bold py-2.5 px-4 my-0.5"
              data-testid="tab-overview"
            >
              <BarChart3 className="w-4 h-4 mr-2" />
              Home
            </TabsTrigger>
            <TabsTrigger
              value="daily-capacity"
              className="flex-1 data-[state=active]:bg-secondary data-[state=active]:text-secondary-foreground data-[state=active]:shadow-lg hover:bg-muted/50 transition-all duration-300 rounded-lg font-bold py-2.5 px-4 my-0.5"
              data-testid="tab-daily-capacity"
            >
              <Calendar className="w-4 h-4 mr-2" />
              Daily View
            </TabsTrigger>
            <TabsTrigger
              value="bd-matrix"
              className="flex-1 data-[state=active]:bg-tertiary data-[state=active]:text-tertiary-foreground data-[state=active]:shadow-lg hover:bg-muted/50 transition-all duration-300 rounded-lg font-bold py-2.5 px-4 my-0.5"
              data-testid="tab-bd-matrix"
            >
              <Users className="w-4 h-4 mr-2" />
              BD Matrix
            </TabsTrigger>
            <TabsTrigger
              value="schedules"
              className="flex-1 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg hover:bg-muted/50 transition-all duration-300 rounded-lg font-bold py-2.5 px-4 my-0.5"
              data-testid="tab-schedules"
            >
              <Calendar className="w-4 h-4 mr-2" />
              Schedules
            </TabsTrigger>
          </TabsList>

          {/* Daily Capacity Tab */}
          <TabsContent value="daily-capacity" className="space-y-4 animate-fade-in flex-1 overflow-y-auto" data-testid="content-daily-capacity">
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
                  <Badge variant="outline" className="text-xs bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm">
                    {(() => {
                      const data = filteredData || processedData;
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
                      {(filteredData || processedData)?.dailySummary?.map((day, index) => (
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
                              {fmtH((day as any).clientRequired ?? 0)}
                            </Badge>
                          </TableCell>

                          <TableCell className="text-right" data-testid={`cell-client-scheduled-${index}`}>
                            <Badge variant="secondary" className="bg-teal-50 text-teal-700 dark:bg-teal-950/30 dark:text-teal-400 border-teal-100">
                              {fmtH((day as any).clientScheduledHours ?? 0)}
                            </Badge>
                          </TableCell>

                          <TableCell className="text-right" data-testid={`cell-other-scheduled-${index}`}>
                            <Badge variant="secondary" className="bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300 border-indigo-200">
                              {fmtH(day.otherScheduledHours ?? 0)}
                            </Badge>
                          </TableCell>

                          {/* Capacity After Scheduling */}
                          <TableCell className="text-right" data-testid={`cell-capacity-after-scheduling-${index}`}>
                            {(() => {
                              const employees = (filteredData || processedData)?.employeesByDate[day.date] || [];
                              const sum = employees.reduce((acc, emp) => {
                                const val = emp.netCapacity - emp.scheduledHours;
                                return acc + (val >= 1 ? Math.floor(val) : 0);
                              }, 0);
                              const roundedSum = sum;
                              return (
                                <Badge 
                                  variant="secondary" 
                                  className={
                                    roundedSum === 0
                                      ? "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300"
                                      : roundedSum > 0 
                                      ? "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300"
                                      : "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300"
                                  }
                                >
                                  {fmtH(roundedSum)}
                                </Badge>
                              );
                            })()}
                          </TableCell>
                        </TableRow>
                      )) || []}
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
                          {selectedDayDetails.length} of {selectedDayDetailsRaw.length} employees
                        </Badge>
                      </h3>
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
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden max-h-[600px] overflow-y-auto relative scroll-modern">
                    <Table>
                      <TableHeader className="sticky top-0 z-30 bg-gray-50 dark:bg-gray-800 shadow-md">
                        <TableRow className="hover:bg-transparent border-b-2">
                          <TableHead data-testid="drilldown-header-employee" className="font-semibold h-14 bg-gray-50 dark:bg-gray-800 sticky top-0">Employee</TableHead>
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
                        {selectedDayDetails.length > 0 ? selectedDayDetails.map((emp, index) => {
                          return (
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
                          );
                        }) : (
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
          </TabsContent>


          {/* BD Matrix Tab */}
          <TabsContent value="bd-matrix" className="flex-1 overflow-hidden" data-testid="content-bd-matrix">
            <div className="h-full overflow-hidden">
              <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>}>
                <BDMatrix
                  data={filteredData || processedData}
                  weekStartDate={
                    selectedWeekId
                      ? allHistoryData?.find(a => a.id === selectedWeekId)?.weekStartDate
                      : latestData?.weekStartDate
                  }
                />
              </Suspense>
            </div>
          </TabsContent>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4 animate-fade-in flex-1 overflow-y-auto" data-testid="content-overview">
            {/* Compact Upload Toggle in Overview */}
            <div className="mb-6">
              <Button
                onClick={() => setShowUploadPanel(!showUploadPanel)}
                variant="outline"
                className="glass-card hover:shadow-lg transition-all duration-200 h-12 px-6 w-full md:w-auto"
                data-testid="toggle-upload-panel-overview"
              >
                <Upload className="w-4 h-4 mr-2" />
                {showUploadPanel ? 'Hide Upload Panel' : 'Upload New Data'}
              </Button>
            </div>

            {/* File Upload Section - Collapsible */}
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
                  {latestDataError && (
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

                  {/* CG Data Export (Master Employee List) */}
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
                        demand: null, // Keep demand in state for reset, though not used
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

            {/* Data Period Information inside Overview */}
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
                                  const data = filteredData || processedData;
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
                              const data = filteredData || processedData;
                              if (!data?.dailySummary || data.dailySummary.length === 0) return '';
                              const startDate = new Date(data.dailySummary[0].date);
                              const monthYear = startDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                              return monthYear;
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
                        <span className="font-medium">{filteredData?.dailySummary.length || processedData?.dailySummary.length || 0} days</span>
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
                      {((filteredData || processedData)?.kpis as any).totalDesiredHoursSum || 0}h
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
                      {(filteredData || processedData)?.kpis.unavailabilitySum}h
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
                      {(filteredData || processedData)?.kpis.sicknessSum}h
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
                      {(filteredData || processedData)?.kpis.holidaysSum || 0}h
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
                      {(filteredData || processedData)?.kpis.netCapacitySum}h
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Total available hours</div>
                  </CardContent>
                </Card>

                {/* 6. Client Required */}
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
                      {(filteredData || processedData)?.kpis.clientRequiredSum}h
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
                      {(filteredData || processedData)?.kpis.clientScheduledHoursSum}h
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
                      {(filteredData || processedData)?.kpis.otherScheduledHoursSum}h
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Non-client hours</div>
                  </CardContent>
                </Card>

                {/* 9. Capacity After Scheduling */}
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
                        const sum = (filteredData || processedData)?.dailySummary.reduce((acc, day) => {
                          const employees = (filteredData || processedData)?.employeesByDate[day.date] || [];
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
              </div>
              </div>
            )}
          </TabsContent>

          {/* Schedules Tab */}
          <TabsContent value="schedules" className="animate-fade-in flex-1 overflow-y-auto" data-testid="content-schedules">
            <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>}>
              <WeeklyPlanTab data={filteredData || processedData} selectedDate={selectedDate} />
            </Suspense>
          </TabsContent>

          </Tabs>
          </div>
        )}
      </div>
    </div>
  );
}