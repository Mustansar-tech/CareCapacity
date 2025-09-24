import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { CalendarIcon, TrendingUpIcon, TrendingDownIcon, AlertTriangleIcon, CheckCircleIcon, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface MonthlyAnalysisData {
  year: number;
  month: number;
  weeklyAnalyses: any[];
  monthlyAggregate: {
    totalWeeks: number;
    averageKpis: {
      netCapacitySum: number;
      clientRequiredSum: number;
      gapSum: number;
      unavailabilitySum: number;
      holidaysSum: number;
    };
    weeklyTrends: {
      week: string;
      netCapacity: number;
      gap: number;
      utilizationRate: number;
    }[];
    monthlyInsights: {
      bestWeek: string;
      worstWeek: string;
      averageUtilization: number;
      totalShortageHours: number;
      consistencyScore: number;
    };
  };
}

export default function MonthlyAnalysis() {
  const { toast } = useToast();
  const currentDate = new Date();
  const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth() + 1);

  const { data: monthlyData, isLoading, error, refetch } = useQuery<MonthlyAnalysisData>({
    queryKey: ['/api/history/monthly', selectedYear, selectedMonth],
    enabled: false, // We'll manually trigger this
  });

  const { data: allHistoryData } = useQuery<any[]>({
    queryKey: ['/api/history'],
  });

  // Generate year and month options based on available data
  const availableMonths = React.useMemo(() => {
    if (!allHistoryData || allHistoryData.length === 0) return [];
    
    const monthsSet = new Set<string>();
    allHistoryData.forEach(analysis => {
      const date = new Date(analysis.weekStartDate);
      const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
      monthsSet.add(key);
    });
    
    return Array.from(monthsSet).map(key => {
      const [year, month] = key.split('-').map(Number);
      return { year, month };
    }).sort((a, b) => b.year - a.year || b.month - a.month);
  }, [allHistoryData]);

  const handleAnalyze = () => {
    refetch();
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto" data-testid="monthly-analysis-container">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2" data-testid="page-title">
          Monthly Analysis
        </h1>
        <p className="text-gray-600 dark:text-gray-300" data-testid="page-description">
          View trends and insights across multiple weeks within a month
        </p>
      </div>

      {/* Month/Year Selection */}
      <Card className="mb-6" data-testid="selection-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarIcon className="w-5 h-5" />
            Select Month & Year
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 items-center">
            <div>
              <label className="block text-sm font-medium mb-2">Year</label>
              <Select value={selectedYear.toString()} onValueChange={(value) => setSelectedYear(Number(value))}>
                <SelectTrigger className="w-32" data-testid="select-year">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[2024, 2025, 2026].map(year => (
                    <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Month</label>
              <Select value={selectedMonth.toString()} onValueChange={(value) => setSelectedMonth(Number(value))}>
                <SelectTrigger className="w-40" data-testid="select-month">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {monthNames.map((name, index) => (
                    <SelectItem key={index + 1} value={(index + 1).toString()}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="pt-6">
              <Button onClick={handleAnalyze} disabled={isLoading} data-testid="button-analyze">
                {isLoading ? 'Analyzing...' : 'Analyze Month'}
              </Button>
            </div>
          </div>
          
          {/* Available months indicator */}
          {availableMonths.length > 0 && (
            <div className="mt-4">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Available data for:</p>
              <div className="flex flex-wrap gap-2">
                {availableMonths.slice(0, 10).map(({ year, month }) => (
                  <Badge key={`${year}-${month}`} variant="outline" className="text-xs">
                    {monthNames[month - 1]} {year}
                  </Badge>
                ))}
                {availableMonths.length > 10 && (
                  <Badge variant="outline" className="text-xs">+{availableMonths.length - 10} more</Badge>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {error && (
        <Card className="mb-6" data-testid="error-card">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-red-600">
              <AlertTriangleIcon className="w-5 h-5" />
              <span>Error loading monthly data: {(error as Error).message}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {monthlyData && (
        <div className="space-y-6">
          {/* Monthly Overview */}
          <Card data-testid="overview-card">
            <CardHeader>
              <CardTitle>
                {monthNames[selectedMonth - 1]} {selectedYear} Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{monthlyData.monthlyAggregate.totalWeeks}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Total Weeks</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{monthlyData.monthlyAggregate.averageKpis.netCapacitySum}h</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Avg Net Capacity</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">{monthlyData.monthlyAggregate.averageKpis.clientRequiredSum}h</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Avg Client Required</div>
                </div>
                <div className="text-center">
                  <div className={`text-2xl font-bold ${monthlyData.monthlyAggregate.averageKpis.gapSum >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {monthlyData.monthlyAggregate.averageKpis.gapSum >= 0 ? '+' : ''}{monthlyData.monthlyAggregate.averageKpis.gapSum}h
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Avg Gap</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">{monthlyData.monthlyAggregate.monthlyInsights.averageUtilization}%</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Avg Utilization</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Monthly Insights */}
          <Card data-testid="insights-card">
            <CardHeader>
              <CardTitle>Monthly Insights</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <TrendingUpIcon className="w-5 h-5 text-green-600" />
                  <div>
                    <div className="font-medium">Best Week</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">{monthlyData.monthlyAggregate.monthlyInsights.bestWeek}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                  <TrendingDownIcon className="w-5 h-5 text-red-600" />
                  <div>
                    <div className="font-medium">Worst Week</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">{monthlyData.monthlyAggregate.monthlyInsights.worstWeek}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
                  <AlertTriangleIcon className="w-5 h-5 text-orange-600" />
                  <div>
                    <div className="font-medium">Total Shortage</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">{monthlyData.monthlyAggregate.monthlyInsights.totalShortageHours}h</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <CheckCircleIcon className="w-5 h-5 text-blue-600" />
                  <div>
                    <div className="font-medium">Consistency</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">{monthlyData.monthlyAggregate.monthlyInsights.consistencyScore}%</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Trends and Weekly Data */}
          <Tabs defaultValue="trends" data-testid="monthly-tabs">
            <TabsList>
              <TabsTrigger value="trends">Weekly Trends</TabsTrigger>
              <TabsTrigger value="weekly-data">Weekly Data</TabsTrigger>
            </TabsList>
            
            <TabsContent value="trends">
              <Card>
                <CardHeader>
                  <CardTitle>Weekly Trends</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64 mb-6">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={monthlyData.monthlyAggregate.weeklyTrends}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis 
                          dataKey="week" 
                          angle={-45}
                          textAnchor="end"
                          height={80}
                          fontSize={11}
                        />
                        <YAxis />
                        <Tooltip />
                        <Line type="monotone" dataKey="netCapacity" stroke="#10b981" strokeWidth={2} name="Net Capacity" />
                        <Line type="monotone" dataKey="gap" stroke="#ef4444" strokeWidth={2} name="Gap" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={monthlyData.monthlyAggregate.weeklyTrends}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis 
                          dataKey="week" 
                          angle={-45}
                          textAnchor="end"
                          height={80}
                          fontSize={11}
                        />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="utilizationRate" fill="#8b5cf6" name="Utilization Rate %" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="weekly-data">
              <Card>
                <CardHeader>
                  <CardTitle>Weekly Analysis Data</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Week</TableHead>
                        <TableHead>Upload Date</TableHead>
                        <TableHead>Net Capacity</TableHead>
                        <TableHead>Client Required</TableHead>
                        <TableHead>Gap</TableHead>
                        <TableHead>Utilization</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {monthlyData.weeklyAnalyses.map((analysis, index) => {
                        const kpis = analysis.kpis as any;
                        const utilization = kpis.clientRequiredSum > 0 
                          ? Math.round((kpis.netCapacitySum / kpis.clientRequiredSum) * 100) 
                          : 0;
                        
                        return (
                          <TableRow key={index}>
                            <TableCell className="font-medium">
                              {analysis.weekStartDate} to {analysis.weekEndDate}
                            </TableCell>
                            <TableCell>
                              {new Date(analysis.uploadedAt).toLocaleDateString()}
                            </TableCell>
                            <TableCell>{kpis.netCapacitySum}h</TableCell>
                            <TableCell>{kpis.clientRequiredSum}h</TableCell>
                            <TableCell className={kpis.gapSum >= 0 ? 'text-green-600' : 'text-red-600'}>
                              {kpis.gapSum >= 0 ? '+' : ''}{kpis.gapSum}h
                            </TableCell>
                            <TableCell>{utilization}%</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      )}

      {!monthlyData && !isLoading && !error && (
        <Card data-testid="no-data-card">
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <Clock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No Analysis Yet</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                Select a month and year, then click "Analyze Month" to view historical data and trends.
              </p>
              {availableMonths.length === 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Upload and process some Excel files first to build historical data.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}