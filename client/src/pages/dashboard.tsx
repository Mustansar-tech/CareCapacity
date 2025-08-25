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
  TrendingUp, TrendingDown, Users, Clock, Calendar, Filter, BarChart3, RefreshCw
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { ProcessingResult, EmployeeDailyDetail } from "@shared/schema";
import { AdvancedFilters } from "@/components/advanced-filters";
import { InteractiveCharts } from "@/components/interactive-charts";
import { SmartAlerts } from "@/components/smart-alerts";
import { DataQualityPanel } from "@/components/data-quality-panel";

export default function Dashboard() {
  // File upload state
  const [files, setFiles] = useState<{
    availability: File | null;
    guaranteed: File | null;
    demand: File | null;
  }>({
    availability: null,
    guaranteed: null,
    demand: null
  });

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedData, setProcessedData] = useState<ProcessingResult | null>(null);
  const [filteredData, setFilteredData] = useState<ProcessingResult | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  const { toast } = useToast();

  // Query to load latest data automatically
  const { data: latestData, isLoading: isLoadingLatest } = useQuery<ProcessingResult>({
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
        warnings: latestData.warnings as any,
      });
      toast({
        title: "Latest Data Loaded",
        description: "Automatically loaded your most recent analysis."
      });
    }
  }, [latestData, processedData, toast]);

  // Handle file selection
  const handleFileChange = useCallback((type: 'availability' | 'guaranteed' | 'demand') => 
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] || null;
      setFiles(prev => ({ ...prev, [type]: file }));
    }, []
  );

  // Process files
  const handleProcessFiles = useCallback(async () => {
    if (!files.availability || !files.guaranteed || !files.demand) {
      toast({
        variant: "destructive",
        title: "Missing Files",
        description: "Please select all three required files before processing."
      });
      return;
    }

    setIsProcessing(true);
    const formData = new FormData();
    formData.append('availability', files.availability);
    formData.append('guaranteed', files.guaranteed);
    formData.append('demand', files.demand);

    try {
      const response = await fetch('/api/process', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Processing failed');
      }

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
      toast({
        variant: "destructive",
        title: "Processing Failed", 
        description: error instanceof Error ? error.message : "Unknown error occurred"
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
    <div className="p-6 max-w-7xl mx-auto" data-testid="dashboard-container">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2" data-testid="dashboard-title">
          Care Capacity Dashboard
        </h1>
        <p className="text-gray-600 dark:text-gray-300" data-testid="dashboard-description">
          Upload your Excel files to analyze care capacity and generate reports
        </p>
      </div>

      {/* File Upload Section */}
      <Card className="mb-6" data-testid="upload-section">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Upload Files
            {isLoadingLatest && (
              <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {/* Availability Export */}
            <div>
              <Label htmlFor="availability-file" className="text-sm font-medium">
                Availability Export.xlsx
              </Label>
              <Input
                id="availability-file"
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange('availability')}
                className="mt-1"
                data-testid="input-availability-file"
              />
              {files.availability && (
                <p className="text-sm text-green-600 mt-1" data-testid="text-availability-selected">
                  ✓ {files.availability.name}
                </p>
              )}
            </div>

            {/* Guaranteed Hours */}
            <div>
              <Label htmlFor="guaranteed-file" className="text-sm font-medium">
                Care Pro Guaranteed Hours.xlsx
              </Label>
              <Input
                id="guaranteed-file"
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange('guaranteed')}
                className="mt-1"
                data-testid="input-guaranteed-file"
              />
              {files.guaranteed && (
                <p className="text-sm text-green-600 mt-1" data-testid="text-guaranteed-selected">
                  ✓ {files.guaranteed.name}
                </p>
              )}
            </div>

            {/* Client Demand */}
            <div>
              <Label htmlFor="demand-file" className="text-sm font-medium">
                client_demand.xlsx
              </Label>
              <Input
                id="demand-file"
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange('demand')}
                className="mt-1"
                data-testid="input-demand-file"
              />
              {files.demand && (
                <p className="text-sm text-green-600 mt-1" data-testid="text-demand-selected">
                  ✓ {files.demand.name}
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleProcessFiles}
              disabled={isProcessing || !files.availability || !files.guaranteed || !files.demand}
              className="flex-1 md:flex-initial"
              data-testid="button-process"
            >
              {isProcessing ? (
                <>Processing...</>
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
                    demand: null
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

      {/* Results Tabs */}
      {processedData && (
        <>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Button
                variant={showFilters ? "default" : "outline"}
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                data-testid="button-toggle-filters"
              >
                <Filter className="h-4 w-4 mr-2" />
                Filters
              </Button>
              <Badge variant="secondary">
                {filteredData?.dailySummary.length || processedData?.dailySummary.length || 0} days
              </Badge>
            </div>
          </div>
        
        {/* Advanced Filters Panel */}
        {showFilters && (
          <div className="mb-6">
            <AdvancedFilters
              data={processedData}
              onFilterChange={setFilteredData}
              onResetFilters={() => setFilteredData(processedData)}
            />
          </div>
        )}

        <Tabs defaultValue="overview" className="space-y-4" data-testid="results-tabs">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="alerts" data-testid="tab-alerts">Alerts</TabsTrigger>
            <TabsTrigger value="charts" data-testid="tab-charts">Analytics</TabsTrigger>
            <TabsTrigger value="daily-capacity" data-testid="tab-daily-capacity">Daily View</TabsTrigger>
            <TabsTrigger value="quality" data-testid="tab-quality">Data Quality</TabsTrigger>
            <TabsTrigger value="export" data-testid="tab-export">Export</TabsTrigger>
          </TabsList>

          {/* Smart Alerts Tab */}
          <TabsContent value="alerts" data-testid="content-alerts">
            <SmartAlerts 
              data={filteredData} 
              onAlertAction={(alertId, action, data) => {
                if (action === 'view-details' && data?.date) {
                  setSelectedDate(data.date);
                }
              }}
            />
          </TabsContent>

          {/* Interactive Charts Tab */}
          <TabsContent value="charts" data-testid="content-charts">
            <InteractiveCharts 
              data={filteredData}
              onDateSelect={setSelectedDate}
              onEmployeeSelect={(employee) => console.log('Selected employee:', employee)}
            />
          </TabsContent>

          {/* Data Quality Tab */}
          <TabsContent value="quality" data-testid="content-quality">
            <DataQualityPanel 
              data={filteredData}
              warnings={warnings}
            />
          </TabsContent>

          {/* Overview Tab */}
          <TabsContent value="overview" data-testid="content-overview">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <Card data-testid="card-net-capacity">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Net Capacity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-net-capacity-sum">
                    {(filteredData || processedData)?.kpis.netCapacitySum}h
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-client-required">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Client Required
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-client-required-sum">
                    {(filteredData || processedData)?.kpis.clientRequiredSum}h
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-capacity-gap">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    {((filteredData || processedData)?.kpis.gapSum ?? 0) >= 0 ? (
                      <TrendingUp className="w-4 h-4 text-green-500" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-red-500" />
                    )}
                    Capacity Gap
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${
                    ((filteredData || processedData)?.kpis.gapSum ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'
                  }`} data-testid="text-capacity-gap-sum">
                    {((filteredData || processedData)?.kpis.gapSum ?? 0) >= 0 ? '+' : ''}{(filteredData || processedData)?.kpis.gapSum}h
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-unavailability">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-orange-500" />
                    Unavailability
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Sick leave, appointments, and other unavailable time
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-orange-600" data-testid="text-unavailability-sum">
                    {(filteredData || processedData)?.kpis.unavailabilitySum}h
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-holidays">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-blue-500" />
                    Holidays
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-blue-600" data-testid="text-holidays-sum">
                    {(filteredData || processedData)?.kpis.holidaysSum}h
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Daily Capacity Tab */}
          <TabsContent value="daily-capacity" data-testid="content-daily-capacity">
            <Card>
              <CardHeader>
                <CardTitle>Daily Capacity Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead data-testid="header-date">Date</TableHead>
                      <TableHead data-testid="header-available">Available</TableHead>
                      <TableHead data-testid="header-net-capacity">Net Capacity</TableHead>
                      <TableHead data-testid="header-required">Required</TableHead>
                      <TableHead data-testid="header-gap">Gap</TableHead>
                      <TableHead data-testid="header-status">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(filteredData || processedData).dailySummary.map((day, index) => (
                      <TableRow 
                        key={day.date}
                        className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                          selectedDate === day.date ? 'bg-primary/10 border-l-4 border-primary' : ''
                        }`}
                        onClick={() => {
                          setSelectedDate(day.date);
                          console.log('Selected date:', day.date);
                        }}
                        data-testid={`row-daily-summary-${index}`}
                      >
                        <TableCell className="font-medium" data-testid={`cell-date-${index}`}>
                          {new Date(day.date).toLocaleDateString()}
                        </TableCell>
                        <TableCell data-testid={`cell-available-${index}`}>
                          {day.availableHours}h
                        </TableCell>
                        <TableCell data-testid={`cell-net-capacity-${index}`}>
                          {day.netCapacity}h
                        </TableCell>
                        <TableCell data-testid={`cell-client-required-${index}`}>
                          {day.clientRequired}h
                        </TableCell>
                        <TableCell data-testid={`cell-gap-${index}`}>
                          <span className={day.gap >= 0 ? 'text-green-600' : 'text-red-600'}>
                            {day.gap >= 0 ? '+' : ''}{day.gap}h
                          </span>
                        </TableCell>
                        <TableCell data-testid={`cell-status-${index}`}>
                          <Badge variant={day.status === 'Sufficient' ? 'default' : 'destructive'}>
                            {day.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {/* Drilldown Table */}
                {selectedDate && (
                  <div className="mt-6" data-testid="drilldown-section">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" data-testid="drilldown-title">
                      <Calendar className="h-5 w-5" />
                      Employee Details for {new Date(selectedDate).toLocaleDateString()}
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
                          <TableHead data-testid="drilldown-header-contracted-daily">Contracted Daily</TableHead>
                          <TableHead data-testid="drilldown-header-hours">Hours</TableHead>
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
                              {emp.timeWindows}
                            </TableCell>
                            <TableCell data-testid={`drilldown-contracted-daily-${index}`}>
                              {emp.contractedDailyHours}h
                            </TableCell>
                            <TableCell data-testid={`drilldown-hours-${index}`}>
                              {emp.hours}h
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

          {/* Export Tab */}
          <TabsContent value="export" data-testid="content-export">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Download className="w-5 h-5" />
                  Export Data
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 dark:text-gray-300 mb-4" data-testid="export-description">
                  Download the processed capacity data as an Excel file with detailed sheets:
                </p>
                <ul className="list-disc list-inside text-sm text-gray-600 dark:text-gray-300 mb-6 space-y-1">
                  <li><strong>Cleaned:</strong> All processed employee records with capacity calculations</li>
                  <li><strong>DailySummary:</strong> Daily aggregated capacity metrics</li>
                  <li><strong>EmployeeDailyDetail:</strong> Detailed employee breakdown by date</li>
                </ul>
                <Button 
                  onClick={handleExport}
                  className="w-full md:w-auto"
                  data-testid="button-export"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download capacity_dashboard.xlsx
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        </>
      )}
    </div>
  );
}