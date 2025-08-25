import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ComposedChart
} from 'recharts';
import { 
  TrendingUp, TrendingDown, Calendar, Users, Clock, 
  AlertTriangle, CheckCircle, Activity, Target 
} from "lucide-react";
import { format, parseISO, startOfWeek, endOfWeek, eachDayOfInterval } from "date-fns";
import type { ProcessingResult, DailySummaryRecord } from "@shared/schema";

interface InteractiveChartsProps {
  data: ProcessingResult | null;
  onDateSelect?: (date: string) => void;
  onEmployeeSelect?: (employee: string) => void;
}

interface ChartDataPoint {
  date: string;
  displayDate: string;
  netCapacity: number;
  clientRequired: number;
  gap: number;
  availableHours: number;
  sickness: number;
  holidays: number;
  status: 'Sufficient' | 'Shortage';
  employeeCount: number;
}

interface TrendDataPoint {
  week: string;
  avgCapacity: number;
  avgDemand: number;
  avgGap: number;
  utilizationRate: number;
}

const COLORS = {
  capacity: '#10b981', // green-500
  demand: '#f59e0b',   // amber-500
  shortage: '#ef4444', // red-500
  sufficient: '#10b981', // green-500
  sickness: '#f97316',  // orange-500
  holidays: '#3b82f6', // blue-500
  available: '#6366f1'  // indigo-500
};

export function InteractiveCharts({ data, onDateSelect, onEmployeeSelect }: InteractiveChartsProps) {
  const [selectedChart, setSelectedChart] = useState<string>("overview");
  const [selectedDataPoint, setSelectedDataPoint] = useState<ChartDataPoint | null>(null);

  // Transform data for charts
  const chartData = useMemo((): ChartDataPoint[] => {
    if (!data?.dailySummary) return [];

    return data.dailySummary.map(day => {
      // Safe date formatting with fallback
      let displayDate = day.date;
      try {
        if (day.date && typeof day.date === 'string') {
          displayDate = format(parseISO(day.date), 'MMM dd');
        }
      } catch (error) {
        console.warn('Date formatting error for:', day.date, error);
        displayDate = day.date || 'Unknown';
      }
      
      return {
        date: day.date,
        displayDate,
        netCapacity: day.netCapacity,
        clientRequired: day.clientRequired,
        gap: day.gap,
        availableHours: day.availableHours,
        sickness: day.sickness,
        holidays: day.holidays,
        status: day.status,
        employeeCount: data.employeesByDate[day.date]?.length || 0
      };
    });
  }, [data]);

  // Weekly trend data
  const trendData = useMemo((): TrendDataPoint[] => {
    if (!data?.dailySummary.length) return [];

    const weeks = new Map<string, DailySummaryRecord[]>();
    
    data.dailySummary.forEach(day => {
      try {
        if (!day.date || typeof day.date !== 'string') {
          console.warn('Invalid date for trend data:', day.date);
          return;
        }
        
        const date = parseISO(day.date);
        if (isNaN(date.getTime())) {
          console.warn('Invalid date parsed for trend data:', day.date);
          return;
        }
        
        const weekStart = format(startOfWeek(date), 'yyyy-MM-dd');
        if (!weeks.has(weekStart)) {
          weeks.set(weekStart, []);
        }
        weeks.get(weekStart)!.push(day);
      } catch (error) {
        console.warn('Error processing date for trend data:', day.date, error);
      }
    });

    return Array.from(weeks.entries()).map(([weekStart, days]) => {
      const totalCapacity = days.reduce((sum, d) => sum + d.netCapacity, 0);
      const totalDemand = days.reduce((sum, d) => sum + d.clientRequired, 0);
      const totalGap = days.reduce((sum, d) => sum + d.gap, 0);
      const avgCapacity = totalCapacity / days.length;
      const avgDemand = totalDemand / days.length;
      const avgGap = totalGap / days.length;
      const utilizationRate = totalDemand > 0 ? (totalCapacity / totalDemand) * 100 : 100;

      // Safe week label formatting
      let weekLabel = weekStart;
      try {
        weekLabel = format(parseISO(weekStart), 'MMM dd');
      } catch (error) {
        console.warn('Error formatting week label:', weekStart, error);
      }

      return {
        week: weekLabel,
        avgCapacity: Math.round(avgCapacity * 100) / 100,
        avgDemand: Math.round(avgDemand * 100) / 100,
        avgGap: Math.round(avgGap * 100) / 100,
        utilizationRate: Math.round(utilizationRate * 100) / 100
      };
    });
  }, [data]);

  // Status distribution for pie chart
  const statusData = useMemo(() => {
    if (!data?.dailySummary) return [];
    
    const statusCounts = data.dailySummary.reduce((acc, day) => {
      acc[day.status] = (acc[day.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(statusCounts).map(([status, count]) => ({
      name: status,
      value: count,
      percentage: Math.round((count / data.dailySummary.length) * 100)
    }));
  }, [data]);

  // Heat map data for calendar view
  const heatMapData = useMemo(() => {
    if (!chartData.length) return [];
    
    try {
      const firstDate = parseISO(chartData[0].date);
      const lastDate = parseISO(chartData[chartData.length - 1].date);
      
      // Validate dates before creating interval
      if (isNaN(firstDate.getTime()) || isNaN(lastDate.getTime())) {
        console.warn('Invalid date range for heat map data');
        return [];
      }
      
      const allDays = eachDayOfInterval({ start: firstDate, end: lastDate });
      
      return allDays.map(date => {
        const dateStr = format(date, 'yyyy-MM-dd');
        const dayData = chartData.find(d => d.date === dateStr);
        
        return {
          date: dateStr,
          displayDate: format(date, 'MMM dd'),
          day: format(date, 'EEE'),
          gap: dayData?.gap || 0,
          status: dayData?.status || 'No Data',
          intensity: dayData ? Math.min(Math.abs(dayData.gap) / 20, 1) : 0
        };
      });
    } catch (error) {
      console.warn('Error creating heat map data:', error);
      return [];
    }
  }, [chartData]);

  const handleChartClick = (data: any, index: number) => {
    if (data && data.date) {
      setSelectedDataPoint(data);
      onDateSelect?.(data.date);
    }
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      
      // Safe date parsing with fallback
      let dateDisplay = label;
      try {
        if (label && typeof label === 'string' && label.match(/^\d{4}-\d{2}-\d{2}$/)) {
          dateDisplay = format(parseISO(label), 'EEEE, MMMM dd, yyyy');
        } else if (data?.date && typeof data.date === 'string') {
          dateDisplay = format(parseISO(data.date), 'EEEE, MMMM dd, yyyy');
        }
      } catch (error) {
        console.warn('Date parsing error:', error);
        dateDisplay = label || data?.date || 'Unknown Date';
      }
      
      return (
        <div className="bg-background border border-border rounded-lg shadow-lg p-3">
          <p className="font-medium">{dateDisplay}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {entry.name}: {entry.value}
              {entry.dataKey === 'gap' && (
                <Badge variant={entry.value >= 0 ? 'default' : 'destructive'} className="ml-2 text-xs">
                  {entry.value >= 0 ? 'Surplus' : 'Shortage'}
                </Badge>
              )}
            </p>
          ))}
          <p className="text-xs text-muted-foreground mt-1">
            {data.employeeCount} employees scheduled
          </p>
        </div>
      );
    }
    return null;
  };

  if (!data) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">No data available for charts</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="interactive-charts">
      {/* Chart Navigation */}
      <Tabs value={selectedChart} onValueChange={setSelectedChart} className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="trends" data-testid="tab-trends">Trends</TabsTrigger>
          <TabsTrigger value="breakdown" data-testid="tab-breakdown">Breakdown</TabsTrigger>
          <TabsTrigger value="distribution" data-testid="tab-distribution">Distribution</TabsTrigger>
          <TabsTrigger value="heatmap" data-testid="tab-heatmap">Heat Map</TabsTrigger>
        </TabsList>

        {/* Overview Chart */}
        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Capacity vs Demand Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <ComposedChart data={chartData} onClick={handleChartClick}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="displayDate" 
                    tick={{ fontSize: 12 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  
                  <Area 
                    type="monotone" 
                    dataKey="netCapacity" 
                    fill={COLORS.capacity} 
                    fillOpacity={0.3}
                    stroke={COLORS.capacity}
                    name="Net Capacity"
                  />
                  <Area 
                    type="monotone" 
                    dataKey="clientRequired" 
                    fill={COLORS.demand} 
                    fillOpacity={0.3}
                    stroke={COLORS.demand}
                    name="Client Demand"
                  />
                  <Line 
                    type="monotone" 
                    dataKey="gap" 
                    stroke={COLORS.shortage}
                    strokeWidth={3}
                    name="Gap"
                    dot={{ fill: COLORS.shortage, strokeWidth: 2, r: 4 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Trends Chart */}
        <TabsContent value="trends" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Weekly Trends & Utilization
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <ComposedChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                  <YAxis yAxisId="hours" orientation="left" tick={{ fontSize: 12 }} />
                  <YAxis yAxisId="percentage" orientation="right" tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  
                  <Bar yAxisId="hours" dataKey="avgCapacity" fill={COLORS.capacity} name="Avg Capacity" />
                  <Bar yAxisId="hours" dataKey="avgDemand" fill={COLORS.demand} name="Avg Demand" />
                  <Line 
                    yAxisId="percentage" 
                    type="monotone" 
                    dataKey="utilizationRate" 
                    stroke={COLORS.sufficient}
                    strokeWidth={3}
                    name="Utilization %"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Breakdown Chart */}
        <TabsContent value="breakdown" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Hours Breakdown by Category
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={chartData} onClick={handleChartClick}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="displayDate" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  
                  <Bar dataKey="availableHours" stackId="a" fill={COLORS.available} name="Available" />
                  <Bar dataKey="sickness" stackId="a" fill={COLORS.sickness} name="Sickness" />
                  <Bar dataKey="holidays" stackId="a" fill={COLORS.holidays} name="Holidays" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Distribution Chart */}
        <TabsContent value="distribution" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  Status Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={statusData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percentage }) => `${name}: ${percentage}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {statusData.map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={entry.name === 'Sufficient' ? COLORS.sufficient : COLORS.shortage} 
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Capacity Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={Object.entries(
                      chartData.reduce((acc, curr) => {
                        const bucket = curr.netCapacity < 20 ? 'Low (0-20)' :
                                       curr.netCapacity < 40 ? 'Medium (20-40)' :
                                       curr.netCapacity < 60 ? 'High (40-60)' : 'Very High (60+)';
                        acc[bucket] = (acc[bucket] || 0) + 1;
                        return acc;
                      }, {} as Record<string, number>)
                    ).map(([bucket, count]) => ({ bucket, count }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill={COLORS.capacity} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Heat Map */}
        <TabsContent value="heatmap" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Capacity Gap Heat Map
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-1 mb-4">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <div key={day} className="text-center text-xs font-medium p-2">
                    {day}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {heatMapData.map(day => (
                  <Button
                    key={day.date}
                    variant="outline"
                    size="sm"
                    className="h-12 w-full p-1 text-xs"
                    style={{
                      backgroundColor: day.status === 'Shortage' 
                        ? `rgba(239, 68, 68, ${day.intensity})` 
                        : day.status === 'Sufficient'
                        ? `rgba(16, 185, 129, ${Math.max(day.intensity, 0.1)})`
                        : 'transparent',
                      color: day.intensity > 0.5 ? 'white' : 'inherit'
                    }}
                    onClick={() => onDateSelect?.(day.date)}
                    data-testid={`heatmap-day-${day.date}`}
                  >
                    <div className="text-center">
                      <div className="font-medium">
                        {format(parseISO(day.date), 'dd')}
                      </div>
                      <div className="text-xs">
                        {day.gap > 0 ? `+${day.gap}` : day.gap}
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
              <div className="flex items-center justify-center gap-4 mt-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-red-500 rounded"></div>
                  Shortage
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-green-500 rounded"></div>
                  Sufficient
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Selected Data Point Details */}
      {selectedDataPoint && (
        <Card className="bg-muted/50">
          <CardHeader>
            <CardTitle className="text-lg">
              Details for {format(parseISO(selectedDataPoint.date), 'EEEE, MMMM dd, yyyy')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">Net Capacity</p>
                <p className="text-2xl font-bold text-green-600">{selectedDataPoint.netCapacity}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Client Required</p>
                <p className="text-2xl font-bold text-amber-600">{selectedDataPoint.clientRequired}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Gap</p>
                <p className={`text-2xl font-bold ${selectedDataPoint.gap >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {selectedDataPoint.gap >= 0 ? '+' : ''}{selectedDataPoint.gap}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Employees</p>
                <p className="text-2xl font-bold text-blue-600">{selectedDataPoint.employeeCount}</p>
              </div>
            </div>
            <div className="mt-4">
              <Badge variant={selectedDataPoint.status === 'Sufficient' ? 'default' : 'destructive'}>
                {selectedDataPoint.status === 'Sufficient' ? (
                  <CheckCircle className="w-4 h-4 mr-1" />
                ) : (
                  <AlertTriangle className="w-4 h-4 mr-1" />
                )}
                {selectedDataPoint.status}
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}