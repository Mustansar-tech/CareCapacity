import React, { useState, useCallback, useEffect } from "react";
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
import {
  Upload, FileSpreadsheet, AlertTriangle, CheckCircle,
  TrendingUp, TrendingDown, Users, Clock, Calendar, BarChart3, RefreshCw, Zap, Target, Sparkles,
  Car, PersonStanding, Thermometer, Sun, Bus
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import type { ProcessingResult } from "@shared/schema";
import { EmployeeSummaryTab } from "@/components/employee-summary-tab";
import { MetricCardSkeleton, TableSkeleton } from "@/components/loading-skeleton";
import { FlexibleTimeWindow } from "@/components/flexible-time-window";
import { getGenderColorClass } from "@/utils/gender-colors";
import BDMatrix from "@/pages/bd-matrix";
import { WeeklyPlanTab } from "@/components/weekly-plan-tab";
import { AIChat } from "@/components/ai-chat";
import { useBranch } from "@/contexts/BranchContext";



const fmtH = (hours: number): string => `${hours}h`;
const fmtSignedH = (hours: number): string => `${hours >= 0 ? '+' : ''}${hours}h`;
const statusBadge = (status: string): string => {
  return status === 'Sufficient'
    ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white'
    : 'bg-gradient-to-r from-red-500 to-red-600 text-white';
};

const TransportIcon = ({ mode }: { mode?: string }) => {
  if (!mode) return null;
  const m = mode.toLowerCase();
  if (m.includes('car')) return <Car className="w-3.5 h-3.5 text-blue-500" />;
  if (m.includes('walk')) return <PersonStanding className="w-3.5 h-3.5 text-green-500" />;
  if (m.includes('public')) return <Bus className="w-3.5 h-3.5 text-purple-500" />;
  return null;
};

const getStatusRowTint = (status: string): string => {
  const s = status.toLowerCase();
  if (s.includes('sick')) return 'bg-red-50/60 dark:bg-red-950/20';
  if (s.includes('holiday') || s.includes('annual leave')) return 'bg-amber-50/60 dark:bg-amber-950/20';
  if (s.includes('maternity') || s.includes('paternity')) return 'bg-pink-50/60 dark:bg-pink-950/20';
  if (s === 'ad-hoc') return 'bg-amber-50/40 dark:bg-amber-950/10';
  return '';
};

const getStatusIcon = (status: string) => {
  const s = status.toLowerCase();
  if (s.includes('sick')) return <Thermometer className="w-3.5 h-3.5 text-red-400" />;
  if (s.includes('holiday') || s.includes('annual leave')) return <Sun className="w-3.5 h-3.5 text-amber-500" />;
  return null;
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
  // default styling for everything else
  return (
    <Badge variant="outline" className="glass-card" data-testid="badge-status-default">
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
  const { data: allHistoryData } = useQuery<any[]>({
    queryKey: ['/api/history'],
    enabled: true, // Enable to populate week selector
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });


  // Query to load latest data automatically
  const { data: latestData, error: latestDataError, isLoading: isLoadingLatest } = useQuery<ProcessingResult>({
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
    if (latestData && (latestData as any).branchId !== selectedBranchId) {
      clientLogger.log('🧹 Clearing stale data from different branch');
      setProcessedData(null);
      setFilteredData(null);
    }
  }, [latestData, selectedBranchId]);

  // Auto-load latest data when component mounts or when we don't have data
  useEffect(() => {
    // Only auto-load if data belongs to current branch
    if (latestData && !processedData && !selectedWeekId && (latestData as any).branchId === selectedBranchId) {
      setProcessedData({
        kpis: latestData.kpis,
        dailySummary: latestData.dailySummary as any,
        employeesByDate: latestData.employeesByDate as any,
        employeeSummaryByDate: latestData.employeeSummaryByDate as any,
        warnings: latestData.warnings as any,
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
      const analysis = allHistoryData?.find((item: any) => item.id === value);
      if (analysis) {
        setProcessedData({
          kpis: analysis.kpis,
          dailySummary: analysis.dailySummary as any,
          employeesByDate: analysis.employeesByDate as any,
          employeeSummaryByDate: analysis.employeeSummaryByDate as any,
          warnings: analysis.warnings as any,
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

      // Don't invalidate queries to prevent auto-refresh
      // queryClient.invalidateQueries({ queryKey: ['/api/history'] });
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
    // Update validation to check for 3 files instead of 4
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
    // Demand file is no longer appended
    formData.append('cgData', files.cgData!);

    // Include branch ID in the form data
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
    <div className="min-h-screen bg-background scroll-modern" data-testid="dashboard-container">
      {/* Hero Section with Modern Layout - Only show on Overview tab */}
      {activeTab === "overview" && (
        <div className="bg-gradient-to-br from-primary/5 via-secondary/5 to-tertiary/5 border-b border-card-border">
          <div className="max-w-7xl mx-auto px-lg py-3xl text-center">
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
      <div className="max-w-7xl mx-auto px-lg py-12 animate-fade-in">
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
          {/* Show intro cards only when no data exists */}
          {!processedData && (
            <div className="text-center mb-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="p-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <FileSpreadsheet className="w-8 h-8 mx-auto mb-3 text-blue-600" />
                  <h3 className="font-semibold mb-2">Availability Export</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Employee availability and shift preferences</p>
                </div>
                <div className="p-6 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                  <FileSpreadsheet className="w-8 h-8 mx-auto mb-3 text-emerald-600" />
                  <h3 className="font-semibold mb-2">Care Pro Guaranteed Hours</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Contracted hours and employee data</p>
                </div>
                {/* Client Demand intro card removed */}
                <div className="p-6 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
                  <Target className="w-8 h-8 mx-auto mb-3 text-orange-600" />
                  <h3 className="font-semibold mb-2">CG Data Export</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Master employee list and weekly hours</p>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-6"> {/* Changed grid columns to 3 */}
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
              // Update disabled condition to reflect 3 files
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
          <div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6" data-testid="results-tabs">
          <TabsList className="grid w-full grid-cols-7 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm p-1 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <TabsTrigger
              value="overview"
              className="data-[state=active]:bg-blue-600 data-[state=active]:text-white dark:data-[state=active]:bg-blue-600 dark:data-[state=active]:text-white data-[state=active]:shadow-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-200 rounded-lg font-medium"
              data-testid="tab-overview"
            >
              <BarChart3 className="w-4 h-4 mr-2" />
              Overview
            </TabsTrigger>
            <TabsTrigger
              value="daily-capacity"
              className="data-[state=active]:bg-blue-600 data-[state=active]:text-white dark:data-[state=active]:bg-blue-600 dark:data-[state=active]:text-white data-[state=active]:shadow-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-200 rounded-lg font-medium"
              data-testid="tab-daily-capacity"
            >
              <Calendar className="w-4 h-4 mr-2" />
              Daily View
            </TabsTrigger>
            <TabsTrigger
              value="employee-summary"
              className="data-[state=active]:bg-blue-600 data-[state=active]:text-white dark:data-[state=active]:bg-blue-600 dark:data-[state=active]:text-white data-[state=active]:shadow-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-200 rounded-lg font-medium"
              data-testid="tab-employee-summary"
            >
              <Users className="w-4 h-4 mr-2" />
              Summary
            </TabsTrigger>
            <TabsTrigger
              value="bd-matrix"
              className="data-[state=active]:bg-blue-600 data-[state=active]:text-white dark:data-[state=active]:bg-blue-600 dark:data-[state=active]:text-white data-[state=active]:shadow-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-200 rounded-lg font-medium"
              data-testid="tab-bd-matrix"
            >
              <Users className="w-4 h-4 mr-2" />
              BD Matrix
            </TabsTrigger>
            <TabsTrigger
              value="schedules"
              className="data-[state=active]:bg-blue-600 data-[state=active]:text-white dark:data-[state=active]:bg-blue-600 dark:data-[state=active]:text-white data-[state=active]:shadow-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-200 rounded-lg font-medium"
              data-testid="tab-schedules"
            >
              <Calendar className="w-4 h-4 mr-2" />
              Schedules
            </TabsTrigger>
            <TabsTrigger
              value="ai-chat"
              className="data-[state=active]:bg-violet-600 data-[state=active]:text-white dark:data-[state=active]:bg-violet-600 dark:data-[state=active]:text-white data-[state=active]:shadow-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-200 rounded-lg font-medium"
              data-testid="tab-ai-chat"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              AI Chat
            </TabsTrigger>
          </TabsList>

          {/* Daily Capacity Tab */}
          <TabsContent value="daily-capacity" className="space-y-6 animate-fade-in" data-testid="content-daily-capacity">
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
                  <TooltipProvider delayDuration={200}>
                  <Table className="table-fixed w-full">
                    <TableHeader className="sticky top-0 z-10 bg-white dark:bg-gray-900">
                      <TableRow>
                        <TableHead data-testid="header-date" className="w-[120px] text-left">Date</TableHead>
                        <TableHead data-testid="header-desired-hours" className="w-[100px] text-right">Desired Hours</TableHead>
                        <TableHead data-testid="header-net-capacity" className="w-[100px] text-right">Net Capacity</TableHead>
                        <TableHead data-testid="header-required" className="w-[100px] text-right">Client Required</TableHead>
                        <TableHead data-testid="header-unavailability" className="w-[100px] text-right">Unavailability</TableHead>
                        <TableHead data-testid="header-sickness" className="w-[100px] text-right">Sickness</TableHead>
                        <TableHead data-testid="header-client-scheduled" className="w-[100px] text-right">Client Scheduled</TableHead>
                        <TableHead data-testid="header-other-scheduled" className="w-[100px] text-right">Other Scheduled</TableHead>
                        <TableHead data-testid="header-holidays" className="w-[100px] text-right">Holidays</TableHead>
                        <TableHead data-testid="header-capacity-after-scheduling" className="w-[100px] text-right">Capacity After Scheduling</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(filteredData || processedData)?.dailySummary?.map((day, index) => (
                        <TableRow
                          key={day.date}
                          className={`cursor-pointer transition-all duration-200 interactive ${
                            selectedDate === day.date
                              ? "bg-gradient-to-r from-blue-50 to-emerald-50 dark:from-blue-900/30 dark:to-emerald-900/30 border-l-4 border-blue-500"
                              : day.netCapacity < day.clientRequired
                              ? "bg-red-50/50 dark:bg-red-950/15 hover:bg-red-100/60 dark:hover:bg-red-950/25"
                              : day.netCapacity > day.clientRequired
                              ? "bg-green-50/40 dark:bg-green-950/10 hover:bg-green-100/50 dark:hover:bg-green-950/20"
                              : "hover:bg-blue-50 dark:hover:bg-blue-900/20"
                          }`}
                          onClick={() => setSelectedDate(day.date)}
                          data-testid={`row-daily-summary-${index}`}
                        >
                          <TableCell className="w-[120px] font-medium" data-testid={`cell-date-${index}`}>
                            {(() => {
                              const d = new Date(day.date);
                              const weekday = d.toLocaleDateString("en-GB", { weekday: 'short' });
                              const dateStr = d.toLocaleDateString("en-GB", { day: '2-digit', month: '2-digit' });
                              return `${weekday} ${dateStr}`;
                            })()}
                          </TableCell>

                          <TableCell className="w-[100px] text-right" data-testid={`cell-desired-hours-${index}`}>
                            <Tooltip>
                              <TooltipTrigger asChild><span className="cursor-help">{fmtH(day.availableHours ?? 0)}</span></TooltipTrigger>
                              <TooltipContent>Total contracted daily hours for all employees</TooltipContent>
                            </Tooltip>
                          </TableCell>

                          <TableCell className="w-[100px] text-right" data-testid={`cell-net-capacity-${index}`}>
                            <Tooltip>
                              <TooltipTrigger asChild><span className="cursor-help">{fmtH(day.netCapacity)}</span></TooltipTrigger>
                              <TooltipContent>Desired Hours minus Unavailability, Sickness and Holidays</TooltipContent>
                            </Tooltip>
                          </TableCell>

                          <TableCell className="w-[100px] text-right" data-testid={`cell-client-required-${index}`}>
                            <Tooltip>
                              <TooltipTrigger asChild><span className="cursor-help">{fmtH(day.clientRequired)}</span></TooltipTrigger>
                              <TooltipContent>Total scheduled client visit hours for the day</TooltipContent>
                            </Tooltip>
                          </TableCell>

                          <TableCell className="w-[100px] text-right" data-testid={`cell-unavailability-${index}`}>
                            <Tooltip>
                              <TooltipTrigger asChild><span className={`cursor-help ${(day.unavailability ?? 0) > 0 ? 'text-orange-600 dark:text-orange-400 font-medium' : ''}`}>{fmtH(day.unavailability ?? 0)}</span></TooltipTrigger>
                              <TooltipContent>Hours lost to appointments and other blockers</TooltipContent>
                            </Tooltip>
                          </TableCell>

                          <TableCell className="w-[100px] text-right" data-testid={`cell-sickness-${index}`}>
                            <Tooltip>
                              <TooltipTrigger asChild><span className={`cursor-help ${(day.sickness ?? 0) > 0 ? 'text-red-600 dark:text-red-400 font-medium' : ''}`}>{fmtH(day.sickness ?? 0)}</span></TooltipTrigger>
                              <TooltipContent>Total hours lost to staff sickness</TooltipContent>
                            </Tooltip>
                          </TableCell>

                          <TableCell className="w-[100px] text-right" data-testid={`cell-client-scheduled-${index}`}>
                            <Tooltip>
                              <TooltipTrigger asChild><span className="cursor-help">{fmtH(day.clientScheduledHours ?? 0)}</span></TooltipTrigger>
                              <TooltipContent>Hours scheduled for client care visits</TooltipContent>
                            </Tooltip>
                          </TableCell>

                          <TableCell className="w-[100px] text-right" data-testid={`cell-other-scheduled-${index}`}>
                            <Tooltip>
                              <TooltipTrigger asChild><span className="cursor-help">{fmtH(day.otherScheduledHours ?? 0)}</span></TooltipTrigger>
                              <TooltipContent>Office, training, and other non-client scheduled hours</TooltipContent>
                            </Tooltip>
                          </TableCell>

                          <TableCell className="w-[100px] text-right" data-testid={`cell-holidays-${index}`}>
                            <Tooltip>
                              <TooltipTrigger asChild><span className={`cursor-help ${(day.holidays ?? 0) > 0 ? 'text-amber-600 dark:text-amber-400 font-medium' : ''}`}>{fmtH(day.holidays ?? 0)}</span></TooltipTrigger>
                              <TooltipContent>Total hours lost to holidays and annual leave</TooltipContent>
                            </Tooltip>
                          </TableCell>

                          <TableCell className="w-[100px] text-right" data-testid={`cell-capacity-after-scheduling-${index}`}>
                            {(() => {
                              const employees = (filteredData || processedData)?.employeesByDate[day.date] || [];
                              const sum = employees.reduce((acc, emp) => {
                                const val = emp.netCapacity - emp.scheduledHours;
                                return acc + (val > 0 ? val : 0);
                              }, 0);
                              const val = Math.round(sum * 100) / 100;
                              return (
                                <Tooltip>
                                  <TooltipTrigger asChild><span className={`cursor-help font-medium ${val > 0 ? 'text-green-600 dark:text-green-400' : ''}`}>{fmtH(val)}</span></TooltipTrigger>
                                  <TooltipContent>Sum of positive (Net Capacity - Scheduled Hours) per employee</TooltipContent>
                                </Tooltip>
                              );
                            })()}
                          </TableCell>
                        </TableRow>
                      )) || []}
                    </TableBody>
                  </Table>
                  </TooltipProvider>
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
                    <TooltipProvider delayDuration={200}>
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-white dark:bg-gray-900">
                        <TableRow>
                          <TableHead data-testid="drilldown-header-employee">Employee</TableHead>
                          <TableHead data-testid="drilldown-header-status">
                            <Select
                              value={statusFilter.length === 1 ? statusFilter[0] : "all"}
                              onValueChange={(value) => {
                                if (value === "all") {
                                  setStatusFilter([]);
                                } else {
                                  setStatusFilter([value]);
                                }
                              }}
                            >
                              <SelectTrigger className="h-8 w-[180px] border-dashed">
                                <SelectValue placeholder="Status (Filter)" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">
                                  All Statuses ({selectedDayDetailsRaw.length})
                                </SelectItem>
                                {availableStatuses.map(status => {
                                  const count = selectedDayDetailsRaw.filter(emp => emp.status === status).length;
                                  return (
                                    <SelectItem key={status} value={status}>
                                      {status} ({count})
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          </TableHead>
                          <TableHead data-testid="drilldown-header-time-window">Time Window(s)</TableHead>
                          <TableHead data-testid="drilldown-header-contracted-daily">Desired Hours</TableHead>
                          <TableHead data-testid="drilldown-header-net-capacity">Net Capacity</TableHead>
                          <TableHead data-testid="drilldown-header-scheduled-hours">Scheduled Hours</TableHead>
                          <TableHead data-testid="drilldown-header-capacity-after-scheduling">Capacity After Scheduling</TableHead>
                          <TableHead data-testid="drilldown-header-notes">Notes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedDayDetails.length > 0 ? selectedDayDetails.map((emp, index) => {
                          const capAfterSched = Math.round((emp.netCapacity - emp.scheduledHours) * 100) / 100;
                          return (
                          <TableRow key={`${emp.employeeName}-${index}`} data-testid={`row-drilldown-${index}`} className={getStatusRowTint(emp.status)}>
                            <TableCell className="font-medium" data-testid={`drilldown-employee-${index}`}>
                              <span className={`flex items-center gap-1.5 ${getGenderColorClass(emp.gender)}`}>
                                <TransportIcon mode={emp.transportMode} />
                                {emp.employeeName}
                              </span>
                            </TableCell>
                            <TableCell data-testid={`drilldown-status-${index}`}>
                              <span className="flex items-center gap-1">
                                {getStatusIcon(emp.status)}
                                {renderStatusBadge(emp.status)}
                              </span>
                            </TableCell>
                            <TableCell data-testid={`drilldown-time-windows-${index}`}>
                              <FlexibleTimeWindow
                                timeWindows={emp.timeWindows || '-'}
                                compact={true}
                                editable={false}
                              />
                            </TableCell>
                            <TableCell data-testid={`drilldown-contracted-daily-${index}`}>
                              {emp.contractedDailyHours}h
                            </TableCell>
                            <TableCell data-testid={`drilldown-net-capacity-${index}`}>
                              {emp.netCapacity}h
                            </TableCell>
                            <TableCell data-testid={`drilldown-scheduled-hours-${index}`}>
                              {emp.scheduledHours}h
                            </TableCell>
                            <TableCell data-testid={`drilldown-capacity-after-scheduling-${index}`}>
                              <span className={`font-medium ${capAfterSched > 0 ? 'text-green-600 dark:text-green-400' : capAfterSched < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
                                {capAfterSched}h
                              </span>
                            </TableCell>
                            <TableCell data-testid={`drilldown-notes-${index}`}>
                              {emp.notes}
                            </TableCell>
                          </TableRow>
                          );
                        }) : (
                          <TableRow>
                            <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                              No employee data available for this date
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                    </TooltipProvider>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>


          {/* AI Chat Tab */}
          <TabsContent value="ai-chat" data-testid="content-ai-chat">
            <AIChat />
          </TabsContent>

          {/* BD Matrix Tab */}
          <TabsContent value="bd-matrix" data-testid="content-bd-matrix">
            <BDMatrix
              data={filteredData || processedData}
            />
          </TabsContent>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6 animate-fade-in" data-testid="content-overview">
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
                {/* Changed grid columns to 3 */}
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
                    // Update disabled condition to reflect 3 files
                    disabled={!files.availability || !files.guaranteed || !files.cgData || isProcessing || processMutation.isPending}
                    className="bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-700 hover:to-emerald-700 text-white px-6 py-2 font-semibold shadow-lg disabled:opacity-50"
                    data-testid="button-process-overview"
                  >
                    {isProcessing || processMutation.isPending ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Processing Files...
                      </>
                    ) : (
                      <>
                        <FileSpreadsheet className="w-4 h-4 mr-2" />
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
              <CardContent className="pt-6">
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
                          <SelectTrigger className="w-80" data-testid="week-selector">
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
                      onClick={() => {
                        toast({
                          title: "Data Refreshed",
                          description: "Dashboard data has been updated."
                        });
                      }}
                      className="hover:bg-blue-50 dark:hover:bg-blue-900/20"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
            {isProcessing || processMutation.isPending ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                {Array.from({ length: 8 }).map((_, i) => (
                  <MetricCardSkeleton key={i} />
                ))}
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                <Card className="glass hover-lift animate-scale-in" data-testid="card-desired-total">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-400 to-green-500 flex items-center justify-center">
                        <Users className="w-4 h-4 text-white" />
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

                <Card className="glass hover-lift animate-scale-in" data-testid="card-net-capacity">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                      <Users className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-gray-700 dark:text-gray-300">Net Capacity</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-blue-800 bg-clip-text text-transparent mb-1" data-testid="text-net-capacity-sum">
                    {(filteredData || processedData)?.kpis.netCapacitySum}h
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Total available hours</div>
                </CardContent>
              </Card>

              <Card className="glass hover-lift animate-scale-in" data-testid="card-client-required">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
                      <Clock className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-gray-700 dark:text-gray-300">Client Required</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold bg-gradient-to-r from-emerald-600 to-emerald-800 bg-clip-text text-transparent mb-1" data-testid="text-client-required-sum">
                    {(filteredData || processedData)?.kpis.clientRequiredSum}h
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Demand hours</div>
                </CardContent>
              </Card>

              <Card className="glass hover-lift animate-scale-in" data-testid="card-capacity-gap">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      ((filteredData || processedData)?.kpis.gapSum ?? 0) >= 0
                        ? 'bg-gradient-to-br from-green-500 to-green-600'
                        : 'bg-gradient-to-br from-red-500 to-red-600'
                    }`}>
                      {((filteredData || processedData)?.kpis.gapSum ?? 0) >= 0 ? (
                        <TrendingUp className="w-4 h-4 text-white" />
                      ) : (
                        <TrendingDown className="w-4 h-4 text-white" />
                      )}
                    </div>
                    <span className="text-gray-700 dark:text-gray-300">Capacity Gap</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={`text-3xl font-bold mb-1 ${
                    ((filteredData || processedData)?.kpis.gapSum ?? 0) >= 0
                      ? 'bg-gradient-to-r from-green-600 to-green-800 bg-clip-text text-transparent'
                      : 'bg-gradient-to-r from-red-600 to-red-800 bg-clip-text text-transparent'
                  }`} data-testid="text-capacity-gap-sum">
                    {((filteredData || processedData)?.kpis.gapSum ?? 0) >= 0 ? '+' : ''}{(filteredData || processedData)?.kpis.gapSum}h
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {((filteredData || processedData)?.kpis.gapSum ?? 0) >= 0 ? 'Surplus capacity' : 'Shortage'}
                  </div>
                </CardContent>
              </Card>

              <Card className="glass hover-lift animate-scale-in" data-testid="card-capacity-after-scheduling">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-200 dark:shadow-none">
                      <Target className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-gray-700 dark:text-gray-300">Capacity After Scheduling</span>
                  </CardTitle>
                </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-purple-800 bg-clip-text text-transparent mb-1" data-testid="text-capacity-after-scheduling-sum">
                      {(() => {
                        const data = filteredData || processedData;
                        if (!data?.dailySummary || !data?.employeesByDate) return "0h";
                        
                        let totalWeeklySurplus = 0;
                        data.dailySummary.forEach(day => {
                          const employees = data.employeesByDate[day.date] || [];
                          const dailySurplus = employees.reduce((acc, emp) => {
                            const val = emp.netCapacity - emp.scheduledHours;
                            return acc + (val > 0 ? val : 0);
                          }, 0);
                          totalWeeklySurplus += dailySurplus;
                        });
                        
                        return fmtH(Math.round(totalWeeklySurplus * 100) / 100);
                      })()}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Total weekly surplus capacity</div>
                  </CardContent>
              </Card>

              </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
              <Card className="glass hover-lift animate-scale-in" data-testid="card-unavailability">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center">
                      <AlertTriangle className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-gray-700 dark:text-gray-300">Unavailability</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold bg-gradient-to-r from-orange-600 to-orange-800 bg-clip-text text-transparent mb-1" data-testid="text-unavailability-sum">
                    {(filteredData || processedData)?.kpis.unavailabilitySum}h
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Scheduled appointments</div>
                </CardContent>
              </Card>

              <Card className="glass hover-lift animate-scale-in" data-testid="card-sickness">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center">
                      <Clock className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-gray-700 dark:text-gray-300">Sickness</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold bg-gradient-to-r from-red-600 to-red-800 bg-clip-text text-transparent mb-1" data-testid="text-sickness-sum">
                    {((filteredData || processedData)?.kpis as any).sicknessSum || 0}h
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Total weekly sickness</div>
                </CardContent>
              </Card>

              <Card className="glass hover-lift animate-scale-in" data-testid="card-client-scheduled">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-400 to-blue-500 flex items-center justify-center">
                      <FileSpreadsheet className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-gray-700 dark:text-gray-300">Client Scheduled</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold bg-gradient-to-r from-blue-500 to-blue-700 bg-clip-text text-transparent mb-1" data-testid="text-client-scheduled-sum">
                    {((filteredData || processedData)?.kpis as any).clientScheduledHoursSum || 0}h
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Client visit hours</div>
                </CardContent>
              </Card>

              <Card className="glass hover-lift animate-scale-in" data-testid="card-other-scheduled">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-400 to-indigo-500 flex items-center justify-center">
                      <FileSpreadsheet className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-gray-700 dark:text-gray-300">Other Scheduled</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold bg-gradient-to-r from-indigo-500 to-indigo-700 bg-clip-text text-transparent mb-1" data-testid="text-other-scheduled-sum">
                    {((filteredData || processedData)?.kpis as any).otherScheduledHoursSum || 0}h
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Office, training, other</div>
                </CardContent>
              </Card>

              <Card className="glass hover-lift animate-scale-in" data-testid="card-holidays">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center">
                      <Calendar className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-gray-700 dark:text-gray-300">Holidays</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-purple-800 bg-clip-text text-transparent mb-1" data-testid="text-holidays-sum">
                    {(filteredData || processedData)?.kpis.holidaysSum}h
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Scheduled time off</div>
                </CardContent>
              </Card>
                </div>
              </div>
            )}
          </TabsContent>

          {/* Employee Summary Tab */}
          <TabsContent value="employee-summary" className="space-y-6 animate-fade-in" data-testid="content-employee-summary">
            {(() => {
              const data = filteredData || processedData;
              const currentDate = selectedDate || (data?.dailySummary?.[0]?.date) || new Date().toISOString().split('T')[0];
              const summaryData = data?.employeeSummaryByDate?.[currentDate] || [];

              return (
                <EmployeeSummaryTab
                  data={summaryData}
                  selectedDate={currentDate}
                  availableDates={Object.keys(data?.employeeSummaryByDate || {})}
                  onDateChange={setSelectedDate}
                />
              );
            })()}
          </TabsContent>

          {/* Schedules Tab */}
          <TabsContent value="schedules" className="space-y-6 animate-fade-in" data-testid="content-schedules">
            <WeeklyPlanTab data={filteredData || processedData} selectedDate={selectedDate} />
          </TabsContent>

          </Tabs>
          </div>
        )}
      </div>
    </div>
  );
}