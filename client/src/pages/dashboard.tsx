import React, { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { 
  Upload, Download, FileSpreadsheet, AlertTriangle, CheckCircle, 
  TrendingUp, TrendingDown, Users, Clock, Calendar, Filter, BarChart3, RefreshCw, Target, Lightbulb as LightBulbIcon
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { ProcessingResult, EmployeeDailyDetail } from "@shared/schema";
import { EmployeeSummaryTab } from "@/components/employee-summary-tab";
import { InteractiveCharts } from "@/components/interactive-charts";
import { AISuggestions } from "@/components/ai-suggestions";
import { DataQualityPanel } from "@/components/data-quality-panel";
import { LoadingSkeleton, MetricCardSkeleton, TableSkeleton } from "@/components/loading-skeleton";
import { FlexibleTimeWindow } from "@/components/flexible-time-window";


// Helper formatting functions
const fmtH = (hours: number): string => `${hours}h`;
const fmtSignedH = (hours: number): string => `${hours >= 0 ? '+' : ''}${hours}h`;
const statusBadge = (status: string): string => {
  return status === 'Sufficient' 
    ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white'
    : 'bg-gradient-to-r from-red-500 to-red-600 text-white';
};

export default function Dashboard() {
  // File upload state - Adding CG Data Export as 4th file
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

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedData, setProcessedData] = useState<ProcessingResult | null>(null);
  const [filteredData, setFilteredData] = useState<ProcessingResult | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const { toast } = useToast();

  // Query to load latest data automatically
  const { data: latestData, isLoading: isLoadingLatest, error: latestDataError } = useQuery<ProcessingResult>({
    queryKey: ['/api/history/latest'],
    enabled: !processedData, // Only load if we don't have current data
  });

  // Auto-load latest data when component mounts or when we don't have data
  useEffect(() => {
    if (latestData && !processedData) {
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
  }, [latestData, processedData, toast]);

  // Handle file selection
  const handleFileChange = useCallback((type: 'availability' | 'guaranteed' | 'demand' | 'cgData') => 
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] || null;
      setFiles(prev => ({ ...prev, [type]: file }));
    }, []
  );

  // Process files
  const handleProcessFiles = useCallback(async () => {
    if (!files.availability || !files.guaranteed || !files.demand || !files.cgData) {
      toast({
        variant: "destructive",
        title: "Missing Files",
        description: "Please select all four required files before processing."
      });
      return;
    }

    setIsProcessing(true);
    
    const formData = new FormData();
    formData.append('availability', files.availability);
    formData.append('guaranteed', files.guaranteed);
    formData.append('demand', files.demand);
    formData.append('cgData', files.cgData);

    try {
      const response = await fetch('/api/process', {
        method: 'POST',
        body: formData,
        headers: {
          // Don't set Content-Type for FormData, let browser set it with boundary
        }
      });

      if (!response.ok) {
        let errorMessage = 'Processing failed';
        try {
          const result = await response.json();
          errorMessage = result.message || errorMessage;
        } catch {
          // If we can't parse JSON, use status text
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();

      setProcessedData(result);
      setSelectedDate(result.dailySummary[0]?.date || null);

      toast({
        title: "Processing Successful",
        description: `Processed ${result.dailySummary.length} days of data successfully.`,
      });

      if (result.warnings && result.warnings.length > 0) {
        toast({
          variant: "destructive",
          title: "Warnings",
          description: result.warnings.slice(0, 3).join("; ") + (result.warnings.length > 3 ? "..." : ""),
        });
      }

    } catch (error) {
      console.error('Processing error:', error);
      
      let errorTitle = "Processing Failed";
      let errorDescription = "Unknown error occurred";
      
      if (error instanceof Error) {
        if (error.message.includes('fetch')) {
          errorTitle = "Connection Error";
          errorDescription = "Unable to connect to server. Please check your connection and try again.";
        } else {
          errorDescription = error.message;
        }
      }
      
      toast({
        variant: "destructive",
        title: errorTitle, 
        description: errorDescription
      });
    } finally {
      setIsProcessing(false);
    }
  }, [files, toast]);

  // Download export
  const handleExport = useCallback(async () => {
    try {
      const response = await fetch('/api/export');
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Export failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'capacity_dashboard.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast({
        title: "Export Successful",
        description: "Capacity dashboard exported successfully."
      });

    } catch (error) {
      console.error('Export error:', error);
      toast({
        variant: "destructive",
        title: "Export Failed",
        description: error instanceof Error ? error.message : "Unknown error occurred"
      });
    }
  }, [toast]);

  // Get selected day details - use filtered data if available, otherwise processed data
  const selectedDayDetails = selectedDate && (filteredData || processedData)?.employeesByDate[selectedDate] || [];

  return (
    <div className="min-h-screen bg-background scroll-modern" data-testid="dashboard-container">
      {/* Hero Section with Modern Layout */}
      <div className="bg-gradient-to-br from-primary/5 via-secondary/5 to-tertiary/5 border-b border-card-border">
        <div className="max-w-7xl mx-auto px-lg py-3xl">
          <div className="text-center">
            <div className="inline-flex items-center gap-md mb-lg animate-scale-in">
              <div className="w-16 h-16 rounded-2xl gradient-primary elevation-3 flex items-center justify-center">
                <BarChart3 className="w-8 h-8 text-primary-foreground" />
              </div>
              <div>
                <h1 className="font-display text-5xl font-semibold text-foreground mb-2" data-testid="dashboard-title">
                  Care Capacity Dashboard
                </h1>
                <div className="w-24 h-1 bg-gradient-to-r from-primary via-secondary to-tertiary rounded-full mx-auto"></div>
              </div>
            </div>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed" data-testid="dashboard-description">
              Intelligent workforce capacity analysis for optimal care scheduling and resource management
            </p>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-7xl mx-auto px-lg py-2xl animate-fade-in">
        {/* Upload Section with Enhanced Design */}
        {!processedData && (
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
                <div className="p-6 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
                  <Target className="w-8 h-8 mx-auto mb-3 text-orange-600" />
                  <h3 className="font-semibold mb-2">CG Data Export</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Master employee list and weekly hours</p>
                </div>
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
                <div className="p-6 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                  <FileSpreadsheet className="w-8 h-8 mx-auto mb-3 text-purple-600" />
                  <h3 className="font-semibold mb-2">Client Demand</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Client requirements and scheduling needs</p>
                </div>
              </div>
            </div>
          )}
          
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-6">
            {/* CG Data Export - MASTER EMPLOYEE LIST - MOVED TO FIRST */}
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

            {/* Client Demand */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded bg-purple-100 dark:bg-purple-900 flex items-center justify-center">
                  <TrendingUp className="w-2.5 h-2.5 text-purple-600 dark:text-purple-400" />
                </div>
                <Label htmlFor="demand-file" className="text-[11px] font-medium truncate">
                  Demand
                </Label>
              </div>
              <Input
                id="demand-file"
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange('demand')}
                className="file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100 transition-all duration-200"
                data-testid="input-demand-file"
              />
              {files.demand && (
                <div className="flex items-center gap-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <p className="text-sm text-green-600 dark:text-green-400" data-testid="text-demand-selected">
                    {files.demand.name}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleProcessFiles}
              disabled={!files.availability || !files.guaranteed || !files.demand || !files.cgData || isProcessing}
              className="flex-1 md:flex-initial bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-700 hover:to-emerald-700 text-white border-0 shadow-lg hover:shadow-xl transition-all duration-200"
              data-testid="button-process"
            >
              {isProcessing ? (
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
                    demand: null,
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

        <Tabs defaultValue="overview" className="space-y-6" data-testid="results-tabs">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-emerald-600 bg-clip-text text-transparent">
              Analysis Results
            </h2>
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
                // Clear file inputs
                const inputs = document.querySelectorAll('input[type="file"]') as NodeListOf<HTMLInputElement>;
                inputs.forEach(input => { input.value = ''; });
                toast({
                  title: "Ready for New Upload",
                  description: "Upload new files to process fresh data."
                });
              }}
              className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white border-0 shadow-lg hover:shadow-xl transition-all duration-200"
              data-testid="button-upload-new"
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload New Files
            </Button>
          </div>
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
              value="ai-suggestions" 
              className="data-[state=active]:bg-blue-600 data-[state=active]:text-white dark:data-[state=active]:bg-blue-600 dark:data-[state=active]:text-white data-[state=active]:shadow-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-200 rounded-lg font-medium"
              data-testid="tab-ai-suggestions"
            >
              <LightBulbIcon className="w-4 h-4 mr-2" />
              AI Insights
            </TabsTrigger>
            <TabsTrigger 
              value="charts" 
              className="data-[state=active]:bg-blue-600 data-[state=active]:text-white dark:data-[state=active]:bg-blue-600 dark:data-[state=active]:text-white data-[state=active]:shadow-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-200 rounded-lg font-medium"
              data-testid="tab-charts"
            >
              <TrendingUp className="w-4 h-4 mr-2" />
              Analytics
            </TabsTrigger>
            <TabsTrigger 
              value="quality" 
              className="data-[state=active]:bg-blue-600 data-[state=active]:text-white dark:data-[state=active]:bg-blue-600 dark:data-[state=active]:text-white data-[state=active]:shadow-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-200 rounded-lg font-medium"
              data-testid="tab-quality"
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Quality
            </TabsTrigger>
            <TabsTrigger 
              value="export" 
              className="data-[state=active]:bg-blue-600 data-[state=active]:text-white dark:data-[state=active]:bg-blue-600 dark:data-[state=active]:text-white data-[state=active]:shadow-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-200 rounded-lg font-medium"
              data-testid="tab-export"
            >
              <Download className="w-4 h-4 mr-2" />
              Export
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
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead></TableHead>
                        <TableHead data-testid="header-date">Date</TableHead>
                        <TableHead data-testid="header-available">Available</TableHead>
                        <TableHead data-testid="header-net-capacity">Net Capacity</TableHead>
                        <TableHead data-testid="header-required">Client Required</TableHead>
                        <TableHead data-testid="header-gap">Gap</TableHead>
                        <TableHead data-testid="header-status">Status</TableHead>
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
                            {new Date(day.date).toLocaleDateString("en-GB")}
                          </TableCell>

                          {/* Available */}
                          <TableCell data-testid={`cell-available-${index}`}>
                            {fmtH(day.availableHours)}
                          </TableCell>

                          {/* Net Capacity */}
                          <TableCell data-testid={`cell-net-capacity-${index}`}>
                            {fmtH(day.netCapacity)}
                          </TableCell>

                          {/* Client Required */}
                          <TableCell data-testid={`cell-client-required-${index}`}>
                            {fmtH(day.clientRequired)}
                          </TableCell>

                          {/* Gap */}
                          <TableCell data-testid={`cell-gap-${index}`}>
                            <Badge
                              variant={day.gap >= 0 ? "default" : "destructive"}
                              className={`${
                                day.gap >= 0
                                  ? "bg-gradient-to-r from-green-500 to-green-600 text-white"
                                  : "bg-gradient-to-r from-red-500 to-red-600 text-white"
                              }`}
                            >
                              {fmtSignedH(day.gap)}
                            </Badge>
                          </TableCell>

                          {/* Status: use backend field */}
                          <TableCell data-testid={`cell-status-${index}`}>
                            <Badge className={statusBadge(day.status)}>
                              {day.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      )) || []}
                    </TableBody>
                  </Table>
                )}

                {/* Drilldown Table */}
                {selectedDate && (
                  <div className="mt-6" data-testid="drilldown-section">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" data-testid="drilldown-title">
                      <Calendar className="h-5 w-5" />
                      Employee Details for {new Date(selectedDate).toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                      })}
                      <Badge variant="outline" className="ml-2">
                        {selectedDayDetails.length} employees
                      </Badge>
                    </h3>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead data-testid="drilldown-header-employee">Employee</TableHead>
                          <TableHead data-testid="drilldown-header-status">Status</TableHead>
                          <TableHead data-testid="drilldown-header-time-window">Time Window(s)</TableHead>
                          <TableHead data-testid="drilldown-header-contracted-daily">Desired Hours</TableHead>
                          <TableHead data-testid="drilldown-header-scheduled-hours">Scheduled Hours</TableHead>
                          <TableHead data-testid="drilldown-header-net-capacity">Net Capacity</TableHead>
                          <TableHead data-testid="drilldown-header-notes">Notes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedDayDetails.length > 0 ? selectedDayDetails.map((emp, index) => (
                          <TableRow key={`${emp.employeeName}-${index}`} data-testid={`row-drilldown-${index}`}>
                            <TableCell className="font-medium" data-testid={`drilldown-employee-${index}`}>
                              {emp.employeeName}
                            </TableCell>
                            <TableCell data-testid={`drilldown-status-${index}`}>
                              <Badge variant="outline">{emp.status}</Badge>
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
                            <TableCell data-testid={`drilldown-scheduled-hours-${index}`}>
                              {emp.scheduledHours}h
                            </TableCell>
                            <TableCell data-testid={`drilldown-net-capacity-${index}`}>
                              {emp.netCapacity}h
                            </TableCell>
                            <TableCell data-testid={`drilldown-notes-${index}`}>
                              {emp.notes}
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
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Smart Alerts Tab - Only Alerts */}
          <TabsContent value="ai-suggestions" data-testid="content-ai-suggestions">
            <AISuggestions 
              data={filteredData || processedData} 
            />
          </TabsContent>

          {/* Interactive Charts Tab */}
          <TabsContent value="charts" data-testid="content-charts">
            <InteractiveCharts 
              data={filteredData || processedData}
              onDateSelect={setSelectedDate}
              onEmployeeSelect={(employee) => console.log('Selected employee:', employee)}
            />
          </TabsContent>

          {/* Data Quality Tab */}
          <TabsContent value="quality" data-testid="content-quality">
            <DataQualityPanel 
              data={filteredData || processedData}
              warnings={warnings}
            />
          </TabsContent>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6 animate-fade-in" data-testid="content-overview">
            {/* File Upload Section inside Overview */}
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
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
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

                  {/* Client Demand */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-purple-100 dark:bg-purple-900 flex items-center justify-center">
                        <TrendingUp className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                      </div>
                      <Label htmlFor="demand-file-overview" className="text-sm font-medium">
                        Hours by Service Type.xlsx
                      </Label>
                    </div>
                    <Input
                      id="demand-file-overview"
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={handleFileChange('demand')}
                      className="file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100 transition-all duration-200"
                      data-testid="input-demand-file-overview"
                    />
                    {files.demand && (
                      <div className="flex items-center gap-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
                        <CheckCircle className="w-4 h-4 text-green-600" />
                        <p className="text-sm text-green-600 dark:text-green-400" data-testid="text-demand-selected-overview">
                          {files.demand.name}
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
                    disabled={!files.availability || !files.guaranteed || !files.demand || !files.cgData || isProcessing}
                    className="bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-700 hover:to-emerald-700 text-white px-6 py-2 font-semibold shadow-lg disabled:opacity-50"
                    data-testid="button-process-overview"
                  >
                    {isProcessing ? (
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

            {/* Data Period Information inside Overview */}
            <Card className="mb-6 glass hover-lift animate-slide-up" data-testid="data-period-info-overview">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg">
                        <Calendar className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <div className="font-bold text-xl bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300 bg-clip-text text-transparent">
                          Week of {(() => {
                            const data = filteredData || processedData;
                            if (!data?.dailySummary || data.dailySummary.length === 0) return 'Unknown';
                            const startDate = new Date(data.dailySummary[0].date).toLocaleDateString();
                            const endDate = new Date(data.dailySummary[data.dailySummary.length - 1].date).toLocaleDateString();
                            return `${startDate} - ${endDate}`;
                          })()}
                        </div>
                        <div className="text-sm text-gray-600 dark:text-gray-400 font-medium">
                          {(() => {
                            const data = filteredData || processedData;
                            if (!data?.dailySummary || data.dailySummary.length === 0) return '';
                            const startDate = new Date(data.dailySummary[0].date);
                            const monthYear = startDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                            return monthYear;
                          })()}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="flex items-center gap-2 py-2 px-3 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm">
                        <Clock className="w-4 h-4" />
                        <span className="font-medium">{filteredData?.dailySummary.length || processedData?.dailySummary.length || 0} days</span>
                      </Badge>
                      <Badge variant="secondary" className="py-2 px-3 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white border-0">
                        Processed: Today
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
            {isProcessing ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                {Array.from({ length: 5 }).map((_, i) => (
                  <MetricCardSkeleton key={i} />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
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
                  <div className="text-xs text-gray-500 dark:text-gray-400">Sick leave & appointments</div>
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

          {/* Export Tab */}
          <TabsContent value="export" className="space-y-6 animate-fade-in" data-testid="content-export">
            <Card className="glass hover-lift">
              <CardHeader className="gradient-card dark:gradient-card-dark rounded-t-lg">
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center shadow-lg">
                      <Download className="w-5 h-5 text-white" />
                    </div>
                    <span className="bg-gradient-to-r from-blue-600 to-emerald-600 bg-clip-text text-transparent">
                      Export Data
                    </span>
                  </div>
                  <Badge variant="outline" className="text-xs bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm">
                    {(() => {
                      const data = filteredData || processedData;
                      if (!data.dailySummary || data.dailySummary.length === 0) return 'No data';
                      const startDate = new Date(data.dailySummary[0].date);
                      const endDate = new Date(data.dailySummary[data.dailySummary.length - 1].date);
                      return `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`;
                    })()}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <p className="text-gray-600 dark:text-gray-300 mb-6" data-testid="export-description">
                  Download the processed capacity data as a comprehensive Excel file with detailed analysis sheets:
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                    <CheckCircle className="w-5 h-5 text-blue-600 mt-0.5" />
                    <div>
                      <div className="font-medium text-blue-900 dark:text-blue-100">Cleaned Data</div>
                      <div className="text-sm text-blue-700 dark:text-blue-300">All processed employee records with capacity calculations</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                    <CheckCircle className="w-5 h-5 text-emerald-600 mt-0.5" />
                    <div>
                      <div className="font-medium text-emerald-900 dark:text-emerald-100">Daily Summary</div>
                      <div className="text-sm text-emerald-700 dark:text-emerald-300">Daily aggregated capacity metrics and KPIs</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                    <CheckCircle className="w-5 h-5 text-purple-600 mt-0.5" />
                    <div>
                      <div className="font-medium text-purple-900 dark:text-purple-100">Employee Details</div>
                      <div className="text-sm text-purple-700 dark:text-purple-300">Detailed employee breakdown by date and assignments</div>
                    </div>
                  </div>
                </div>
                <Button 
                  onClick={handleExport}
                  className="w-full md:w-auto bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-700 hover:to-emerald-700 text-white border-0 shadow-lg"
                  disabled={isProcessing}
                  data-testid="button-export"
                >
                  {isProcessing ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Generating Excel file...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 mr-2" />
                      Download capacity_dashboard.xlsx
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
          </Tabs>
          </div>
        )}
      </div>
    </div>
  );
}