import React, { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import type { ProcessingResult } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { 
  LineChart, Line, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ComposedChart
} from 'recharts';
import { BarChart3, TrendingUp, Calendar, AlertTriangle, CheckCircle, Activity } from "lucide-react";

interface InteractiveChartsProps {
  data: ProcessingResult | null;
  onDateSelect?: (date: string) => void;
  onEmployeeSelect?: (employee: any) => void;
}

interface ChartDataPoint {
  date: string;
  displayDate: string;
  netCapacity: number;
  clientRequired: number;
  gap: number;
  availableHours: number;
  unavailability: number;
  holidays: number;
  status: 'Sufficient' | 'Shortage';
  employeeCount: number;
}

// Enhanced Material Design 3.0 color palette
const COLORS = {
  capacity: 'hsl(142, 76%, 36%)',
  demand: 'hsl(32, 95%, 44%)',
  shortage: 'hsl(0, 84%, 60%)',
  sufficient: 'hsl(142, 76%, 36%)',
  sickness: 'hsl(24, 95%, 53%)',
  holidays: 'hsl(217, 91%, 60%)',
  available: 'hsl(239, 84%, 67%)'
};

export function InteractiveCharts({ data, onDateSelect, onEmployeeSelect }: InteractiveChartsProps) {
  const [selectedChart, setSelectedChart] = useState<string>("overview");
  const [selectedDataPoint, setSelectedDataPoint] = useState<ChartDataPoint | null>(null);

  // Transform data for charts
  const chartData = useMemo((): ChartDataPoint[] => {
    if (!data?.dailySummary) return [];

    return data.dailySummary.map(day => {
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
        unavailability: day.unavailability,
        holidays: day.holidays,
        status: day.status,
        employeeCount: data.employeesByDate[day.date]?.length || 0
      };
    });
  }, [data]);

  const handleChartClick = (data: any) => {
    if (data && data.date) {
      setSelectedDataPoint(data);
      onDateSelect?.(data.date);
    }
  };

  // Enhanced Material Design 3.0 Tooltip Component
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      
      return (
        <div 
          className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm rounded-xl shadow-lg border border-card-border p-4 min-w-[280px]"
          style={{
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="w-3 h-3 rounded-full bg-gradient-to-r from-primary to-secondary"></div>
            <p className="font-semibold text-foreground">{label}</p>
          </div>
          
          <div className="space-y-2">
            {payload.map((entry: any, index: number) => (
              <div key={index} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div 
                    className="w-2 h-2 rounded-full" 
                    style={{ backgroundColor: entry.color }}
                  ></div>
                  <span className="text-sm font-medium text-muted-foreground">{entry.name}:</span>
                </div>
                <span className="text-sm font-semibold text-foreground">
                  {entry.value}{entry.dataKey === 'netCapacity' || entry.dataKey === 'clientRequired' || entry.dataKey === 'gap' ? 'h' : ''}
                </span>
              </div>
            ))}
          </div>
          
          <div className="mt-3 pt-3 border-t border-card-border">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Employees:</span>
              <span className="font-medium text-foreground">{data.employeeCount || 0}</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  if (!data) {
    return (
      <Card className="material-card elevation-2">
        <CardContent className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">No data available for charts</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2xl" data-testid="interactive-charts">
      {/* Enhanced Chart Navigation */}
      <Card className="material-card elevation-2">
        <CardHeader className="pb-lg">
          <CardTitle className="flex items-center gap-md">
            <div className="w-12 h-12 rounded-2xl gradient-secondary elevation-2 flex items-center justify-center">
              <BarChart3 className="w-6 h-6 text-secondary-foreground" />
            </div>
            <div>
              <h2 className="font-display text-2xl font-semibold text-foreground">Interactive Analytics</h2>
              <p className="text-muted-foreground">Comprehensive data visualization and insights</p>
            </div>
          </CardTitle>
        </CardHeader>
        
        <CardContent>
          <Tabs value={selectedChart} onValueChange={setSelectedChart} className="w-full">
            <TabsList className="grid w-full grid-cols-2 material-card p-1 elevation-1">
              <TabsTrigger 
                value="overview" 
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all duration-200 rounded-lg font-medium"
                data-testid="tab-overview"
              >
                <Activity className="w-4 h-4 mr-2" />
                Overview
              </TabsTrigger>
              <TabsTrigger 
                value="trends" 
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all duration-200 rounded-lg font-medium"
                data-testid="tab-trends"
              >
                <TrendingUp className="w-4 h-4 mr-2" />
                Trends
              </TabsTrigger>
            </TabsList>

            {/* Overview Chart */}
            <TabsContent value="overview" className="space-y-4 mt-6">
              <Card className="material-card elevation-1">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    Capacity vs Demand Overview
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={400}>
                    <ComposedChart data={chartData} onClick={handleChartClick}>
                      <CartesianGrid stroke="hsl(220, 13%, 91%)" strokeDasharray="2 4" strokeOpacity={0.4} />
                      <XAxis 
                        dataKey="displayDate" 
                        tick={{ fontSize: 12, fill: 'hsl(220, 9%, 46%)' }}
                        interval="preserveStartEnd"
                      />
                      <YAxis tick={{ fontSize: 12, fill: 'hsl(220, 9%, 46%)' }} />
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
                        name="Capacity Gap"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Trends Chart */}
            <TabsContent value="trends" className="space-y-4 mt-6">
              <Card className="material-card elevation-1">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Weekly Trends
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={400}>
                    <LineChart data={chartData}>
                      <CartesianGrid stroke="hsl(220, 13%, 91%)" strokeDasharray="2 4" strokeOpacity={0.4} />
                      <XAxis 
                        dataKey="displayDate" 
                        tick={{ fontSize: 12, fill: 'hsl(220, 9%, 46%)' }}
                      />
                      <YAxis tick={{ fontSize: 12, fill: 'hsl(220, 9%, 46%)' }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      <Line 
                        type="monotone" 
                        dataKey="netCapacity" 
                        stroke={COLORS.capacity} 
                        strokeWidth={2}
                        name="Net Capacity"
                      />
                      <Line 
                        type="monotone" 
                        dataKey="clientRequired" 
                        stroke={COLORS.demand} 
                        strokeWidth={2}
                        name="Client Required"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Selected Data Point Details */}
      {selectedDataPoint && (
        <Card className="material-card elevation-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Selected Date Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">Net Capacity</p>
                <p className="text-2xl font-bold text-green-600">{selectedDataPoint.netCapacity}h</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Client Required</p>
                <p className="text-2xl font-bold text-amber-600">{selectedDataPoint.clientRequired}h</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Gap</p>
                <p className={`text-2xl font-bold ${selectedDataPoint.gap >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {selectedDataPoint.gap >= 0 ? '+' : ''}{selectedDataPoint.gap}h
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