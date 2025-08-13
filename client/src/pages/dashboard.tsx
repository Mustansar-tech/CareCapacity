import React, { useMemo, useState, useCallback } from "react";
import dayjs from "dayjs";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, AreaChart, Area
} from "recharts";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Download, FileSpreadsheet, Calendar, Users, Clock, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

// ====================== MOCK DATA ======================

const MOCK_employees = [
  { id: "E1", name: "Jane Smith", contractedWeeklyHours: 37.5, workingDays: ["Mon","Tue","Wed","Thu","Fri"] },
  { id: "E2", name: "John Doe", contractedWeeklyHours: 30, workingDays: ["Mon","Tue","Thu","Fri"] },
  { id: "E3", name: "Maria Khan", contractedWeeklyHours: 20, workingDays: ["Mon","Wed","Fri"] },
  { id: "E4", name: "Alex Green", contractedWeeklyHours: 25, workingDays: ["Tue","Wed","Thu","Sat"] },
  { id: "E5", name: "Sam Patel", contractedWeeklyHours: 16, workingDays: ["Mon","Tue","Wed","Thu"] },
];

const MOCK_availability = [
  { employeeId: "E1", date: "2025-08-18", slotStart: "08:00", slotEnd: "16:00" },
  { employeeId: "E2", date: "2025-08-18", slotStart: "09:00", slotEnd: "17:00" },
  { employeeId: "E3", date: "2025-08-18", slotStart: "07:00", slotEnd: "12:00" },
  { employeeId: "E1", date: "2025-08-19", slotStart: "08:00", slotEnd: "12:00" },
  { employeeId: "E2", date: "2025-08-19", slotStart: "09:00", slotEnd: "17:00" },
  { employeeId: "E3", date: "2025-08-19", slotStart: "10:00", slotEnd: "16:00" },
  { employeeId: "E4", date: "2025-08-19", slotStart: "12:00", slotEnd: "18:00" },
  { employeeId: "E1", date: "2025-08-20", slotStart: "08:00", slotEnd: "16:00" },
  { employeeId: "E2", date: "2025-08-20", slotStart: "09:00", slotEnd: "17:00" },
  { employeeId: "E3", date: "2025-08-20", slotStart: "08:00", slotEnd: "11:00" },
  { employeeId: "E5", date: "2025-08-20", slotStart: "14:00", slotEnd: "18:00" },
  { employeeId: "E4", date: "2025-08-21", slotStart: "08:00", slotEnd: "13:00" },
  { employeeId: "E2", date: "2025-08-21", slotStart: "09:00", slotEnd: "17:00" },
  { employeeId: "E3", date: "2025-08-21", slotStart: "10:00", slotEnd: "14:00" },
  { employeeId: "E1", date: "2025-08-22", slotStart: "08:00", slotEnd: "15:00" },
  { employeeId: "E2", date: "2025-08-22", slotStart: "09:00", slotEnd: "16:00" },
  { employeeId: "E5", date: "2025-08-22", slotStart: "10:00", slotEnd: "15:00" },
];

const MOCK_sickness = [
  { employeeId: "E3", date: "2025-08-18", hours: 5 },
  { employeeId: "E3", date: "2025-08-21", hours: 2 },
  { employeeId: "E1", date: "2025-08-20", hours: 3 },
];

const MOCK_holidays = [
  { employeeId: "E1", date: "2025-08-19", hours: 4 },
  { employeeId: "E3", date: "2025-08-20", hours: 3.5 },
  { employeeId: "E2", date: "2025-08-22", hours: 8 },
];

const MOCK_clientDemandDaily = [
  { date: "2025-08-18", client_hours: 22 },
  { date: "2025-08-19", client_hours: 18 },
  { date: "2025-08-20", client_hours: 26 },
  { date: "2025-08-21", client_hours: 20 },
  { date: "2025-08-22", client_hours: 22 },
];

const DEFAULT_WEEK = ["2025-08-18","2025-08-19","2025-08-20","2025-08-21","2025-08-22"];

// ====================== TYPES ======================

interface Employee {
  id: string;
  name: string;
  contractedWeeklyHours: number;
  workingDays: string[];
}

interface AvailabilitySlot {
  employeeId: string;
  date: string;
  slotStart: string;
  slotEnd: string;
  slotHours?: number;
}

interface AbsenceRecord {
  employeeId: string;
  date: string;
  hours: number;
}

interface ClientDemand {
  date: string;
  client_hours: number;
}

interface DailySummary {
  date: string;
  avail: number;
  sickness: number;
  holiday: number;
  net: number;
  client: number;
  delta: number;
}

interface EmployeeDayRow {
  employeeId: string;
  name: string;
  contractedWeeklyHours: number;
  workingDays: string[];
  slotWindows: string;
  availableHours: number;
  sickHrs: number;
  holHrs: number;
  net: number;
  assignedHrs: number;
  contractedDaily: number;
  remaining: number;
}

// ====================== HELPERS ======================

const parseHours = (startHHMM: string, endHHMM: string): number => {
  if (!startHHMM || !endHHMM) return 0;
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);
  const start = sh + sm/60;
  const end = eh + em/60;
  return Math.max(0, end - start);
};

const sumBy = <T,>(arr: T[], fn: (item: T) => number): number => 
  arr.reduce((acc, r) => acc + (fn(r) || 0), 0);

const formatDate = (iso: string) => dayjs(iso).format("ddd DD MMM");

const formatDelta = (value: number) => {
  if (value > 0) return `+${value}`;
  return value.toString();
};

const getDeltaColor = (value: number) => {
  if (value > 0) return "text-green-600 dark:text-green-400";
  if (value < 0) return "text-red-600 dark:text-red-400";
  return "text-gray-600 dark:text-gray-400";
};

// ====================== CORE AGGREGATIONS ======================

const aggregateAvailabilityForWeek = (
  availability: AvailabilitySlot[], 
  sickness: AbsenceRecord[], 
  holidays: AbsenceRecord[], 
  clientDemandDaily: ClientDemand[], 
  weekDates: string[]
): DailySummary[] => {
  const availByDate = new Map<string, number>();
  const sickByDate = new Map<string, number>();
  const holByDate = new Map<string, number>();

  // Calculate availability hours
  availability.forEach(a => {
    const hours = a.slotHours ?? parseHours(a.slotStart, a.slotEnd);
    availByDate.set(a.date, (availByDate.get(a.date) || 0) + hours);
  });

  // Calculate sickness and holiday hours
  sickness.forEach(s => sickByDate.set(s.date, (sickByDate.get(s.date) || 0) + s.hours));
  holidays.forEach(h => holByDate.set(h.date, (holByDate.get(h.date) || 0) + h.hours));

  // Client demand map
  const clientMap = new Map(clientDemandDaily.map(d => [d.date, d.client_hours]));
  
  const allDates = weekDates.length ? weekDates : Array.from(new Set([
    ...availability.map(a => a.date),
    ...sickness.map(s => s.date),
    ...holidays.map(h => h.date),
    ...clientDemandDaily.map(c => c.date),
  ])).sort();

  return allDates.map(date => {
    const avail = +(availByDate.get(date) || 0).toFixed(2);
    const sick = +(sickByDate.get(date) || 0).toFixed(2);
    const hol = +(holByDate.get(date) || 0).toFixed(2);
    const net = Math.max(0, +(avail - sick - hol).toFixed(2));
    const client = +(clientMap.get(date) || 0);
    const delta = +(net - client).toFixed(2);
    
    return { date, avail, sickness: sick, holiday: hol, net, client, delta };
  });
};

const buildEmployeeDayRows = (
  date: string, 
  employees: Employee[], 
  availability: AvailabilitySlot[], 
  sickness: AbsenceRecord[], 
  holidays: AbsenceRecord[]
): EmployeeDayRow[] => {
  const avForDay = availability.filter(a => a.date === date);
  const sickForDay = sickness.filter(s => s.date === date);
  const holForDay = holidays.filter(h => h.date === date);

  const byEmpAvail = new Map<string, Array<{start: string, end: string, hours: number}>>();
  avForDay.forEach(a => {
    const hours = a.slotHours ?? parseHours(a.slotStart, a.slotEnd);
    const arr = byEmpAvail.get(a.employeeId) || [];
    arr.push({ start: a.slotStart, end: a.slotEnd, hours });
    byEmpAvail.set(a.employeeId, arr);
  });

  const sickMap = new Map(sickForDay.map(s => [s.employeeId, s.hours]));
  const holMap = new Map(holForDay.map(h => [h.employeeId, h.hours]));

  return employees.map(e => {
    const slots = byEmpAvail.get(e.id) || [];
    const availableHours = +(sumBy(slots, s => s.hours).toFixed(2));
    const slotWindows = slots.map(s => `${s.start}-${s.end}`).join("; ");
    const sickHrs = +(sickMap.get(e.id) || 0);
    const holHrs = +(holMap.get(e.id) || 0);
    const net = Math.max(0, +(availableHours - sickHrs - holHrs).toFixed(2));
    
    const wdCount = e.workingDays?.length || 5;
    const contractedDaily = +((e.contractedWeeklyHours / wdCount) || 0).toFixed(2);
    const remaining = Math.max(0, +(net).toFixed(2));

    return {
      employeeId: e.id,
      name: e.name,
      contractedWeeklyHours: e.contractedWeeklyHours || 0,
      workingDays: e.workingDays || [],
      slotWindows,
      availableHours,
      sickHrs,
      holHrs,
      net,
      assignedHrs: 0,
      contractedDaily,
      remaining,
    };
  }).filter(r => r.availableHours > 0 || r.remaining > 0);
};

// ====================== DASHBOARD COMPONENT ======================

export default function Dashboard() {
  // Data state
  const [employees] = useState<Employee[]>(MOCK_employees);
  const [availability] = useState<AvailabilitySlot[]>(MOCK_availability);
  const [sickness] = useState<AbsenceRecord[]>(MOCK_sickness);
  const [holidays] = useState<AbsenceRecord[]>(MOCK_holidays);
  const [clientDemandDaily] = useState<ClientDemand[]>(MOCK_clientDemandDaily);
  const [weekDates] = useState<string[]>(DEFAULT_WEEK);
  
  // UI state
  const [selectedDate, setSelectedDate] = useState<string>(DEFAULT_WEEK[0]);
  const [uploadStatus, setUploadStatus] = useState<string>("");

  // Calculate aggregated data
  const weekSummary = useMemo(() => 
    aggregateAvailabilityForWeek(availability, sickness, holidays, clientDemandDaily, weekDates),
    [availability, sickness, holidays, clientDemandDaily, weekDates]
  );

  const employeeDayData = useMemo(() => 
    buildEmployeeDayRows(selectedDate, employees, availability, sickness, holidays),
    [selectedDate, employees, availability, sickness, holidays]
  );

  // Calculate KPIs
  const kpis = useMemo(() => {
    const totalNet = sumBy(weekSummary, d => d.net);
    const totalClient = sumBy(weekSummary, d => d.client);
    const totalSickness = sumBy(weekSummary, d => d.sickness);
    const totalHolidays = sumBy(weekSummary, d => d.holiday);
    const delta = totalNet - totalClient;

    return {
      netAvailability: +totalNet.toFixed(2),
      clientRequired: +totalClient.toFixed(2),
      delta: +delta.toFixed(2),
      sicknessHours: +totalSickness.toFixed(2),
      holidayHours: +totalHolidays.toFixed(2),
    };
  }, [weekSummary]);

  // Chart data for weekly trend
  const chartData = useMemo(() => 
    weekSummary.map(d => ({
      date: formatDate(d.date),
      net: d.net,
      client: d.client,
      delta: d.delta,
    })),
    [weekSummary]
  );

  // Chart data for selected day comparison
  const dayChartData = useMemo(() => {
    const dayData = weekSummary.find(d => d.date === selectedDate);
    if (!dayData) return [];
    
    return [
      { category: "Net Available", hours: dayData.net },
      { category: "Client Required", hours: dayData.client },
    ];
  }, [weekSummary, selectedDate]);

  // Sickness & Holidays chart data
  const absenceChartData = useMemo(() => 
    weekSummary.map(d => ({
      date: formatDate(d.date),
      sickness: d.sickness,
      holidays: d.holiday,
    })),
    [weekSummary]
  );

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadStatus("Processing file...");
    
    // For now, just show success message - actual parsing would happen here
    setTimeout(() => {
      setUploadStatus("File uploaded successfully! Using mock data for demonstration.");
    }, 1000);
  }, []);

  const handleExport = useCallback(() => {
    const exportData = {
      kpis,
      weekSummary,
      employeeData: employees,
      availabilityData: availability,
      sicknessData: sickness,
      holidayData: holidays,
      clientDemand: clientDemandDaily,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `care-hours-analysis-${dayjs().format('YYYY-MM-DD')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [kpis, weekSummary, employees, availability, sickness, holidays, clientDemandDaily]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Care Hours vs Client Demand Dashboard
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Comprehensive workforce planning and availability analysis
          </p>
        </div>

        {/* File Upload */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Excel File Upload
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileUpload}
                className="max-w-sm"
              />
              <Button variant="outline" className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4" />
                Choose File
              </Button>
            </div>
            {uploadStatus && (
              <p className="mt-2 text-sm text-blue-600 dark:text-blue-400">{uploadStatus}</p>
            )}
          </CardContent>
        </Card>

        {/* Main Dashboard Tabs */}
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="daily">Daily Detail</TabsTrigger>
            <TabsTrigger value="absence">Sickness & Holidays</TabsTrigger>
            <TabsTrigger value="export">Export</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Net Availability
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                    {kpis.netAvailability}h
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Client Required
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                    {kpis.clientRequired}h
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400 flex items-center gap-1">
                    Δ (Difference)
                    {kpis.delta > 0 ? <TrendingUp className="h-4 w-4" /> : 
                     kpis.delta < 0 ? <TrendingDown className="h-4 w-4" /> : null}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={cn("text-2xl font-bold", getDeltaColor(kpis.delta))}>
                    {formatDelta(kpis.delta)}h
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Sickness Hours
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                    {kpis.sicknessHours}h
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Holiday Hours
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                    {kpis.holidayHours}h
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Weekly Trend Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Weekly Trend: Net vs Client Hours</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line 
                        type="monotone" 
                        dataKey="net" 
                        stroke="#3b82f6" 
                        strokeWidth={2}
                        name="Net Available Hours"
                      />
                      <Line 
                        type="monotone" 
                        dataKey="client" 
                        stroke="#8b5cf6" 
                        strokeWidth={2}
                        name="Client Required Hours"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Daily Summary Table */}
            <Card>
              <CardHeader>
                <CardTitle>Daily Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead className="text-right">Sickness</TableHead>
                      <TableHead className="text-right">Holidays</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                      <TableHead className="text-right">Client</TableHead>
                      <TableHead className="text-right">Δ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {weekSummary.map((day) => (
                      <TableRow key={day.date}>
                        <TableCell className="font-medium">{formatDate(day.date)}</TableCell>
                        <TableCell className="text-right">{day.avail}h</TableCell>
                        <TableCell className="text-right text-red-600">{day.sickness}h</TableCell>
                        <TableCell className="text-right text-orange-600">{day.holiday}h</TableCell>
                        <TableCell className="text-right font-semibold">{day.net}h</TableCell>
                        <TableCell className="text-right">{day.client}h</TableCell>
                        <TableCell className={cn("text-right font-semibold", getDeltaColor(day.delta))}>
                          {formatDelta(day.delta)}h
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Daily Detail Tab */}
          <TabsContent value="daily" className="space-y-6">
            {/* Date Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Select Date for Detailed View
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Select value={selectedDate} onValueChange={setSelectedDate}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {weekDates.map(date => (
                      <SelectItem key={date} value={date}>
                        {formatDate(date)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            {/* Daily KPIs */}
            {(() => {
              const dayData = weekSummary.find(d => d.date === selectedDate);
              return dayData ? (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Net Available</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-xl font-bold text-blue-600">{dayData.net}h</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Client Required</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-xl font-bold text-purple-600">{dayData.client}h</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Sickness</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-xl font-bold text-red-600">{dayData.sickness}h</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Holidays</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-xl font-bold text-orange-600">{dayData.holiday}h</div>
                    </CardContent>
                  </Card>
                </div>
              ) : null;
            })()}

            {/* Daily Comparison Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Net vs Client Hours - {formatDate(selectedDate)}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dayChartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="category" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="hours" fill="#3b82f6" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Employee Availability Table */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Employee Availability - {formatDate(selectedDate)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Time Slots</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead className="text-right">Sickness</TableHead>
                      <TableHead className="text-right">Holidays</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                      <TableHead className="text-right">Remaining</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {employeeDayData.map((emp) => (
                      <TableRow key={emp.employeeId}>
                        <TableCell className="font-medium">{emp.name}</TableCell>
                        <TableCell className="font-mono text-sm">{emp.slotWindows || "—"}</TableCell>
                        <TableCell className="text-right">{emp.availableHours}h</TableCell>
                        <TableCell className="text-right text-red-600">{emp.sickHrs}h</TableCell>
                        <TableCell className="text-right text-orange-600">{emp.holHrs}h</TableCell>
                        <TableCell className="text-right font-semibold">{emp.net}h</TableCell>
                        <TableCell className="text-right font-semibold text-green-600">{emp.remaining}h</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Sickness & Holidays Tab */}
          <TabsContent value="absence" className="space-y-6">
            {/* Absence Summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-red-600 dark:text-red-400 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    Total Sickness Hours
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-red-600 dark:text-red-400">
                    {kpis.sicknessHours}h
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-orange-600 dark:text-orange-400 flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Total Holiday Hours
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-orange-600 dark:text-orange-400">
                    {kpis.holidayHours}h
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Stacked Area Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Weekly Sickness & Holiday Hours</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={absenceChartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Area
                        type="monotone"
                        dataKey="sickness"
                        stackId="1"
                        stroke="#dc2626"
                        fill="#dc2626"
                        fillOpacity={0.6}
                        name="Sickness Hours"
                      />
                      <Area
                        type="monotone"
                        dataKey="holidays"
                        stackId="1"
                        stroke="#ea580c"
                        fill="#ea580c"
                        fillOpacity={0.6}
                        name="Holiday Hours"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Detailed Breakdown Table */}
            <Card>
              <CardHeader>
                <CardTitle>Daily Absence Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Sickness Hours</TableHead>
                      <TableHead className="text-right">Holiday Hours</TableHead>
                      <TableHead className="text-right">Total Absence</TableHead>
                      <TableHead className="text-right">Impact on Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {weekSummary.map((day) => {
                      const totalAbsence = day.sickness + day.holiday;
                      const impact = `${((totalAbsence / (day.avail + totalAbsence)) * 100).toFixed(1)}%`;
                      return (
                        <TableRow key={day.date}>
                          <TableCell className="font-medium">{formatDate(day.date)}</TableCell>
                          <TableCell className="text-right text-red-600">{day.sickness}h</TableCell>
                          <TableCell className="text-right text-orange-600">{day.holiday}h</TableCell>
                          <TableCell className="text-right font-semibold">{totalAbsence.toFixed(1)}h</TableCell>
                          <TableCell className="text-right">{impact}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Export Tab */}
          <TabsContent value="export" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Download className="h-5 w-5" />
                  Export Data
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-gray-600 dark:text-gray-400">
                  Download your processed care hours analysis data for further reporting or integration.
                </p>
                
                {/* Export Preview */}
                <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                  <h4 className="font-semibold mb-2">Export Preview</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <strong>KPIs:</strong>
                      <ul className="ml-4 mt-1 space-y-1">
                        <li>• Net Availability: {kpis.netAvailability}h</li>
                        <li>• Client Required: {kpis.clientRequired}h</li>
                        <li>• Delta: {formatDelta(kpis.delta)}h</li>
                      </ul>
                    </div>
                    <div>
                      <strong>Data Points:</strong>
                      <ul className="ml-4 mt-1 space-y-1">
                        <li>• {employees.length} employees</li>
                        <li>• {availability.length} availability slots</li>
                        <li>• {weekDates.length} days analyzed</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <Button onClick={handleExport} className="flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  Download Analysis Data
                </Button>
              </CardContent>
            </Card>

            {/* Export Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Weekly Summary for Export</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Net Available</TableHead>
                      <TableHead className="text-right">Client Required</TableHead>
                      <TableHead className="text-right">Delta</TableHead>
                      <TableHead className="text-right">Utilization</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {weekSummary.map((day) => {
                      const utilization = day.net > 0 ? ((day.client / day.net) * 100).toFixed(1) : '0';
                      return (
                        <TableRow key={day.date}>
                          <TableCell className="font-medium">{formatDate(day.date)}</TableCell>
                          <TableCell className="text-right">{day.net}h</TableCell>
                          <TableCell className="text-right">{day.client}h</TableCell>
                          <TableCell className={cn("text-right", getDeltaColor(day.delta))}>
                            {formatDelta(day.delta)}h
                          </TableCell>
                          <TableCell className="text-right">{utilization}%</TableCell>
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
    </div>
  );
}