import React, { useMemo, useState, useCallback } from "react";
import dayjs from "dayjs";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell
} from "recharts";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Upload, Download, FileSpreadsheet, Calendar, Users, Clock, 
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle, 
  UserCheck, Target, Search, Filter, Bell, Zap, Eye,
  RefreshCw, MapPin, Phone, Mail, Star
} from "lucide-react";
import { cn } from "@/lib/utils";

// ====================== MOCK DATA ======================

const MOCK_employees = [
  { 
    id: "E1", 
    name: "Jane Smith", 
    contractedWeeklyHours: 37.5, 
    workingDays: ["Mon","Tue","Wed","Thu","Fri"],
    role: "Senior Caregiver",
    skillLevel: "Advanced"
  },
  { 
    id: "E2", 
    name: "John Doe", 
    contractedWeeklyHours: 30, 
    workingDays: ["Mon","Tue","Thu","Fri"],
    role: "Caregiver",
    skillLevel: "Intermediate"
  },
  { 
    id: "E3", 
    name: "Maria Khan", 
    contractedWeeklyHours: 20, 
    workingDays: ["Mon","Wed","Fri"],
    role: "Support Worker",
    skillLevel: "Basic"
  },
  { 
    id: "E4", 
    name: "Alex Green", 
    contractedWeeklyHours: 25, 
    workingDays: ["Tue","Wed","Thu","Sat"],
    role: "Night Caregiver",
    skillLevel: "Advanced"
  },
  { 
    id: "E5", 
    name: "Sam Patel", 
    contractedWeeklyHours: 16, 
    workingDays: ["Mon","Tue","Wed","Thu"],
    role: "Part-time Support",
    skillLevel: "Basic"
  },
];

const MOCK_availability = [
  { employeeId: "E1", date: "2025-08-18", slotStart: "07:30", slotEnd: "15:30" },
  { employeeId: "E2", date: "2025-08-18", slotStart: "09:15", slotEnd: "17:45" },
  { employeeId: "E3", date: "2025-08-18", slotStart: "06:45", slotEnd: "11:15" },
  { employeeId: "E4", date: "2025-08-18", slotStart: "22:30", slotEnd: "06:30" },
  
  { employeeId: "E1", date: "2025-08-19", slotStart: "08:15", slotEnd: "12:45" },
  { employeeId: "E2", date: "2025-08-19", slotStart: "10:30", slotEnd: "18:00" },
  { employeeId: "E3", date: "2025-08-19", slotStart: "09:45", slotEnd: "16:15" },
  { employeeId: "E4", date: "2025-08-19", slotStart: "13:30", slotEnd: "19:00" },
  
  { employeeId: "E1", date: "2025-08-20", slotStart: "07:45", slotEnd: "16:15" },
  { employeeId: "E2", date: "2025-08-20", slotStart: "08:30", slotEnd: "16:45" },
  { employeeId: "E3", date: "2025-08-20", slotStart: "07:15", slotEnd: "10:45" },
  { employeeId: "E5", date: "2025-08-20", slotStart: "14:30", slotEnd: "18:15" },
  
  { employeeId: "E4", date: "2025-08-21", slotStart: "07:30", slotEnd: "13:15" },
  { employeeId: "E2", date: "2025-08-21", slotStart: "09:45", slotEnd: "17:30" },
  { employeeId: "E3", date: "2025-08-21", slotStart: "10:30", slotEnd: "14:30" },
  
  { employeeId: "E1", date: "2025-08-22", slotStart: "08:00", slotEnd: "15:15" },
  { employeeId: "E2", date: "2025-08-22", slotStart: "11:30", slotEnd: "19:00" },
  { employeeId: "E5", date: "2025-08-22", slotStart: "09:45", slotEnd: "14:45" },
];

const MOCK_sickness = [
  { employeeId: "E3", date: "2025-08-18", hours: 5, reason: "Flu symptoms" },
  { employeeId: "E3", date: "2025-08-21", hours: 2, reason: "Medical appointment" },
  { employeeId: "E1", date: "2025-08-20", hours: 3, reason: "Personal illness" },
];

const MOCK_holidays = [
  { employeeId: "E1", date: "2025-08-19", hours: 4, reason: "Annual leave" },
  { employeeId: "E3", date: "2025-08-20", hours: 3.5, reason: "Personal day" },
  { employeeId: "E2", date: "2025-08-22", hours: 8, reason: "Pre-booked holiday" },
];

const MOCK_clientDemandDaily = [
  { 
    date: "2025-08-18", 
    client_hours: 22,
    morning_hours: 8,
    day_hours: 10,
    evening_hours: 4,
    priority_clients: 3,
    regular_clients: 5
  },
  { 
    date: "2025-08-19", 
    client_hours: 18,
    morning_hours: 6,
    day_hours: 8,
    evening_hours: 4,
    priority_clients: 2,
    regular_clients: 4
  },
  { 
    date: "2025-08-20", 
    client_hours: 26,
    morning_hours: 10,
    day_hours: 12,
    evening_hours: 4,
    priority_clients: 4,
    regular_clients: 6
  },
  { 
    date: "2025-08-21", 
    client_hours: 20,
    morning_hours: 7,
    day_hours: 9,
    evening_hours: 4,
    priority_clients: 3,
    regular_clients: 5
  },
  { 
    date: "2025-08-22", 
    client_hours: 22,
    morning_hours: 8,
    day_hours: 10,
    evening_hours: 4,
    priority_clients: 3,
    regular_clients: 5
  },
];

const DEFAULT_WEEK = ["2025-08-18","2025-08-19","2025-08-20","2025-08-21","2025-08-22"];

// ====================== TYPES ======================

interface Employee {
  id: string;
  name: string;
  contractedWeeklyHours: number;
  workingDays: string[];
  role: string;
  skillLevel: string;
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
  reason: string;
}

interface ClientDemand {
  date: string;
  client_hours: number;
  morning_hours: number;
  day_hours: number;
  evening_hours: number;
  priority_clients: number;
  regular_clients: number;
}

interface DailySummary {
  date: string;
  totalAvailable: number;
  sickness: number;
  holiday: number;
  netCapacity: number;
  clientRequired: number;
  capacityGap: number;
}

interface EmployeeCapacityRow {
  employeeId: string;
  name: string;
  role: string;
  skillLevel: string;
  contractedWeeklyHours: number;
  contractedDailyHours: number;
  workingDays: string[];
  availabilityWindow: string;
  availableHours: number;
  sicknessHours: number;
  holidayHours: number;
  netCapacity: number;
  status: 'Available' | 'Unavailable' | 'Sick' | 'Holiday' | 'Partial';
}

// ====================== HELPERS ======================

const parseHours = (startHHMM: string, endHHMM: string): number => {
  if (!startHHMM || !endHHMM) return 0;
  
  // Handle overnight shifts (e.g., 22:00 to 06:00)
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);
  const start = sh + sm/60;
  let end = eh + em/60;
  
  if (end <= start) {
    end += 24; // Add 24 hours for overnight shift
  }
  
  return Math.max(0, end - start);
};

const sumBy = <T,>(arr: T[], fn: (item: T) => number): number => 
  arr.reduce((acc, r) => acc + (fn(r) || 0), 0);

const formatDate = (iso: string) => dayjs(iso).format("ddd DD MMM");
const formatDateLong = (iso: string) => dayjs(iso).format("dddd, MMMM DD, YYYY");

const formatCapacityGap = (value: number) => {
  if (value > 0) return `+${value} surplus`;
  if (value < 0) return `${Math.abs(value)} shortage`;
  return "Balanced";
};

const getCapacityColor = (value: number) => {
  if (value > 0) return "text-green-600 dark:text-green-400";
  if (value < 0) return "text-red-600 dark:text-red-400";
  return "text-gray-600 dark:text-gray-400";
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'Available': return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    case 'Partial': return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
    case 'Unavailable': return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
    case 'Sick': return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
    case 'Holiday': return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    default: return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
  }
};

// ====================== CORE AGGREGATIONS ======================

const aggregateCapacityForWeek = (
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
    const totalAvailable = +(availByDate.get(date) || 0).toFixed(2);
    const sick = +(sickByDate.get(date) || 0).toFixed(2);
    const hol = +(holByDate.get(date) || 0).toFixed(2);
    const netCapacity = Math.max(0, +(totalAvailable - sick - hol).toFixed(2));
    const clientRequired = +(clientMap.get(date) || 0);
    const capacityGap = +(netCapacity - clientRequired).toFixed(2);
    
    return { 
      date, 
      totalAvailable, 
      sickness: sick, 
      holiday: hol, 
      netCapacity, 
      clientRequired, 
      capacityGap 
    };
  });
};

const buildEmployeeCapacityRows = (
  date: string, 
  employees: Employee[], 
  availability: AvailabilitySlot[], 
  sickness: AbsenceRecord[], 
  holidays: AbsenceRecord[]
): EmployeeCapacityRow[] => {
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
    const availabilityWindow = slots.map(s => `${s.start}-${s.end}`).join("; ") || "Not Available";
    const sicknessHours = +(sickMap.get(e.id) || 0);
    const holidayHours = +(holMap.get(e.id) || 0);
    const netCapacity = Math.max(0, +(availableHours - sicknessHours - holidayHours).toFixed(2));
    
    const wdCount = e.workingDays?.length || 5;
    const contractedDailyHours = +((e.contractedWeeklyHours / wdCount) || 0).toFixed(2);
    
    // Determine status
    let status: EmployeeCapacityRow['status'] = 'Unavailable';
    if (sicknessHours > 0) status = 'Sick';
    else if (holidayHours > 0) status = 'Holiday';
    else if (netCapacity === 0) status = 'Unavailable';
    else if (netCapacity > 0 && netCapacity < contractedDailyHours) status = 'Partial';
    else if (netCapacity >= contractedDailyHours) status = 'Available';

    return {
      employeeId: e.id,
      name: e.name,
      role: e.role,
      skillLevel: e.skillLevel,
      contractedWeeklyHours: e.contractedWeeklyHours,
      contractedDailyHours,
      workingDays: e.workingDays,
      availabilityWindow,
      availableHours,
      sicknessHours,
      holidayHours,
      netCapacity,
      status,
    };
  });
};

// ====================== EXCEL EXPORT FUNCTIONS ======================

const exportToExcel = (
  selectedDate: string,
  dailySummary: DailySummary,
  employeeRows: EmployeeCapacityRow[],
  clientDemand: ClientDemand | undefined
) => {
  const wb = XLSX.utils.book_new();
  
  // Daily Summary Sheet
  const summaryData = [
    ['Employee Capacity Analysis Report'],
    ['Date:', formatDateLong(selectedDate)],
    [''],
    ['DAILY CAPACITY SUMMARY'],
    ['Metric', 'Hours', 'Notes'],
    ['Total Available Hours', dailySummary.totalAvailable, 'Raw availability before absences'],
    ['Sickness Hours', dailySummary.sickness, 'Hours lost to sickness'],
    ['Holiday Hours', dailySummary.holiday, 'Hours lost to holidays'],
    ['Net Capacity', dailySummary.netCapacity, 'Available capacity after absences'],
    ['Client Required Hours', dailySummary.clientRequired, 'Total client demand'],
    ['Capacity Gap', dailySummary.capacityGap, dailySummary.capacityGap >= 0 ? 'Sufficient capacity' : 'Capacity shortage'],
  ];
  
  const summaryWS = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, summaryWS, 'Daily Summary');
  
  // Employee Details Sheet
  const employeeHeaders = [
    'Employee Name', 'Role', 'Skill Level', 'Contracted Weekly Hours', 'Contracted Daily Hours',
    'Working Days', 'Availability Window', 'Available Hours', 'Sickness Hours', 'Holiday Hours',
    'Net Capacity', 'Status'
  ];
  
  const employeeData = [
    employeeHeaders,
    ...employeeRows.map(emp => [
      emp.name,
      emp.role,
      emp.skillLevel,
      emp.contractedWeeklyHours,
      emp.contractedDailyHours,
      emp.workingDays.join(', '),
      emp.availabilityWindow,
      emp.availableHours,
      emp.sicknessHours,
      emp.holidayHours,
      emp.netCapacity,
      emp.status
    ])
  ];
  
  const employeeWS = XLSX.utils.aoa_to_sheet(employeeData);
  XLSX.utils.book_append_sheet(wb, employeeWS, 'Employee Capacity');
  
  // Client Demand Breakdown Sheet
  if (clientDemand) {
    const demandData = [
      ['CLIENT DEMAND BREAKDOWN'],
      ['Date:', formatDateLong(selectedDate)],
      [''],
      ['Time Period', 'Required Hours', 'Percentage'],
      ['Morning Shift', clientDemand.morning_hours, ((clientDemand.morning_hours / clientDemand.client_hours) * 100).toFixed(1) + '%'],
      ['Day Shift', clientDemand.day_hours, ((clientDemand.day_hours / clientDemand.client_hours) * 100).toFixed(1) + '%'],
      ['Evening Shift', clientDemand.evening_hours, ((clientDemand.evening_hours / clientDemand.client_hours) * 100).toFixed(1) + '%'],
      [''],
      ['Client Priority', 'Count'],
      ['Priority Clients', clientDemand.priority_clients],
      ['Regular Clients', clientDemand.regular_clients],
      ['Total Clients', clientDemand.priority_clients + clientDemand.regular_clients],
    ];
    
    const demandWS = XLSX.utils.aoa_to_sheet(demandData);
    XLSX.utils.book_append_sheet(wb, demandWS, 'Client Demand');
  }
  
  // Download the file
  XLSX.writeFile(wb, `employee-capacity-${dayjs(selectedDate).format('YYYY-MM-DD')}.xlsx`);
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
    aggregateCapacityForWeek(availability, sickness, holidays, clientDemandDaily, weekDates),
    [availability, sickness, holidays, clientDemandDaily, weekDates]
  );

  const employeeCapacityData = useMemo(() => 
    buildEmployeeCapacityRows(selectedDate, employees, availability, sickness, holidays),
    [selectedDate, employees, availability, sickness, holidays]
  );

  // Get selected day data
  const selectedDayData = useMemo(() => 
    weekSummary.find(d => d.date === selectedDate),
    [weekSummary, selectedDate]
  );

  const selectedDayClientDemand = useMemo(() => 
    clientDemandDaily.find(d => d.date === selectedDate),
    [clientDemandDaily, selectedDate]
  );

  // Calculate KPIs
  const kpis = useMemo(() => {
    const totalNet = sumBy(weekSummary, d => d.netCapacity);
    const totalClient = sumBy(weekSummary, d => d.clientRequired);
    const totalSickness = sumBy(weekSummary, d => d.sickness);
    const totalHolidays = sumBy(weekSummary, d => d.holiday);
    const capacityGap = totalNet - totalClient;

    return {
      netCapacity: +totalNet.toFixed(2),
      clientRequired: +totalClient.toFixed(2),
      capacityGap: +capacityGap.toFixed(2),
      sicknessHours: +totalSickness.toFixed(2),
      holidayHours: +totalHolidays.toFixed(2),
    };
  }, [weekSummary]);

  // Status distribution for pie chart
  const statusDistribution = useMemo(() => {
    const distribution = employeeCapacityData.reduce((acc, emp) => {
      acc[emp.status] = (acc[emp.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(distribution).map(([status, count]) => ({
      name: status,
      value: count,
      percentage: ((count / employeeCapacityData.length) * 100).toFixed(1)
    }));
  }, [employeeCapacityData]);

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadStatus("Processing file...");
    
    setTimeout(() => {
      setUploadStatus("File uploaded successfully! Using mock data for demonstration.");
    }, 1000);
  }, []);

  const handleExcelExport = useCallback(() => {
    if (!selectedDayData) return;
    exportToExcel(selectedDate, selectedDayData, employeeCapacityData, selectedDayClientDemand);
  }, [selectedDate, selectedDayData, employeeCapacityData, selectedDayClientDemand]);

  const COLORS = ['#10b981', '#f59e0b', '#6b7280', '#ef4444', '#3b82f6'];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-gray-900 dark:via-slate-900 dark:to-indigo-900 p-4 md:p-6">
      <div className="max-w-7xl mx-auto">


        {/* Modern Header */}
        <div className="mb-8 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
          <div className="flex items-center gap-4 mb-4">
            <div className="h-12 w-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
              <Users className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300 bg-clip-text text-transparent">
                Employee Capacity & Availability Dashboard
              </h1>
              <p className="text-gray-600 dark:text-gray-400 text-lg">
                Real-time capacity insights for smart scheduling decisions
              </p>
            </div>
          </div>
        </div>

        {/* Modern File Upload */}
        <div className="mb-8 bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 bg-gradient-to-br from-emerald-500 to-green-600 rounded-lg flex items-center justify-center">
              <Upload className="h-5 w-5 text-white" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Import Availability Data
            </h3>
          </div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileUpload}
                className="border-dashed border-2 border-gray-300 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-700/50 hover:border-blue-400 transition-colors"
              />
            </div>
            <Button className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white shadow-lg transition-all duration-200 transform hover:scale-105">
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Upload Excel File
            </Button>
          </div>
          {uploadStatus && (
            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-sm text-blue-700 dark:text-blue-300">{uploadStatus}</p>
            </div>
          )}
        </div>

        {/* Modern Dashboard Tabs */}
        <Tabs defaultValue="overview" className="space-y-8">
          <div className="bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm rounded-2xl p-2 shadow-lg border border-white/20">
            <TabsList className="grid w-full grid-cols-4 bg-transparent gap-2">
              <TabsTrigger value="overview" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-indigo-600 data-[state=active]:text-white rounded-xl transition-all duration-200">
                Overview
              </TabsTrigger>
              <TabsTrigger value="daily" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-indigo-600 data-[state=active]:text-white rounded-xl transition-all duration-200">
                Daily Capacity
              </TabsTrigger>
              <TabsTrigger value="analytics" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-indigo-600 data-[state=active]:text-white rounded-xl transition-all duration-200">
                Performance Analytics
              </TabsTrigger>
              <TabsTrigger value="export" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-indigo-600 data-[state=active]:text-white rounded-xl transition-all duration-200">
                Export Reports
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            {/* Modern KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
              <div className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20 hover:shadow-xl transition-all duration-300 group">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Target className="h-5 w-5 text-white" />
                  </div>
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Net Capacity</span>
                </div>
                <div className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
                  {kpis.netCapacity}h
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Available capacity this week</p>
              </div>

              <div className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20 hover:shadow-xl transition-all duration-300 group">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Users className="h-5 w-5 text-white" />
                  </div>
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Client Required</span>
                </div>
                <div className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
                  {kpis.clientRequired}h
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Total demand this week</p>
              </div>

              <div className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20 hover:shadow-xl transition-all duration-300 group">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                    {kpis.capacityGap > 0 ? <TrendingUp className="h-5 w-5 text-white" /> : 
                     kpis.capacityGap < 0 ? <TrendingDown className="h-5 w-5 text-white" /> : 
                     <CheckCircle className="h-5 w-5 text-white" />}
                  </div>
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Capacity Gap</span>
                </div>
                <div className={cn("text-3xl font-bold", 
                  kpis.capacityGap > 0 ? "bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent" :
                  kpis.capacityGap < 0 ? "bg-gradient-to-r from-red-600 to-rose-600 bg-clip-text text-transparent" :
                  "bg-gradient-to-r from-gray-600 to-slate-600 bg-clip-text text-transparent"
                )}>
                  {formatCapacityGap(kpis.capacityGap)}
                </div>
              </div>

              <div className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20 hover:shadow-xl transition-all duration-300 group">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 bg-gradient-to-br from-red-500 to-rose-600 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                    <AlertTriangle className="h-5 w-5 text-white" />
                  </div>
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Sickness</span>
                </div>
                <div className="text-3xl font-bold bg-gradient-to-r from-red-600 to-rose-600 bg-clip-text text-transparent">
                  {kpis.sicknessHours}h
                </div>
              </div>

              <div className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20 hover:shadow-xl transition-all duration-300 group">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 bg-gradient-to-br from-orange-500 to-amber-600 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Calendar className="h-5 w-5 text-white" />
                  </div>
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Holidays</span>
                </div>
                <div className="text-3xl font-bold bg-gradient-to-r from-orange-600 to-amber-600 bg-clip-text text-transparent">
                  {kpis.holidayHours}h
                </div>
              </div>
            </div>



            {/* Modern Daily Summary Table */}
            <div className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 bg-gradient-to-br from-slate-500 to-gray-600 rounded-xl flex items-center justify-center">
                  <Clock className="h-5 w-5 text-white" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Daily Capacity Summary</h3>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-200 dark:border-gray-700">
                      <TableHead className="text-gray-700 dark:text-gray-300 font-semibold">Date</TableHead>
                      <TableHead className="text-right text-gray-700 dark:text-gray-300 font-semibold">Available</TableHead>
                      <TableHead className="text-right text-gray-700 dark:text-gray-300 font-semibold">Net Capacity</TableHead>
                      <TableHead className="text-right text-gray-700 dark:text-gray-300 font-semibold">Required</TableHead>
                      <TableHead className="text-right text-gray-700 dark:text-gray-300 font-semibold">Gap</TableHead>
                      <TableHead className="text-right text-gray-700 dark:text-gray-300 font-semibold">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {weekSummary.map((day) => (
                      <TableRow key={day.date} className="border-gray-100 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-700/30 transition-colors">
                        <TableCell className="font-medium text-gray-900 dark:text-white">{formatDate(day.date)}</TableCell>
                        <TableCell className="text-right text-gray-700 dark:text-gray-300">{day.totalAvailable}h</TableCell>
                        <TableCell className="text-right font-semibold text-blue-600 dark:text-blue-400">{day.netCapacity}h</TableCell>
                        <TableCell className="text-right text-gray-700 dark:text-gray-300">{day.clientRequired}h</TableCell>
                        <TableCell className={cn("text-right font-semibold", getCapacityColor(day.capacityGap))}>
                          {day.capacityGap >= 0 ? `+${day.capacityGap}` : day.capacityGap}h
                        </TableCell>
                        <TableCell className="text-right">
                          {day.capacityGap >= 0 ? (
                            <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-200 dark:border-green-700">
                              Sufficient
                            </Badge>
                          ) : (
                            <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-700">
                              Shortage
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>


          </TabsContent>

          {/* Daily Capacity Tab */}
          <TabsContent value="daily" className="space-y-6">
            {/* Enhanced Controls Section */}
            <div className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-end">
                {/* Date Selection */}
                <div>
                  <Label htmlFor="date-picker" className="text-sm font-medium mb-2 block">
                    Select Date
                  </Label>
                  <Select value={selectedDate} onValueChange={setSelectedDate}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {weekDates.map(date => (
                        <SelectItem key={date} value={date}>
                          {formatDateLong(date)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Employee Search */}
                <div>
                  <Label htmlFor="employee-search" className="text-sm font-medium mb-2 block">
                    Search Employees
                  </Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                    <Input
                      id="employee-search"
                      placeholder="Search by name..."
                      className="pl-10"
                    />
                  </div>
                </div>

                {/* Skill Level Filter */}
                <div>
                  <Label className="text-sm font-medium mb-2 block">Skill Level</Label>
                  <Select defaultValue="all">
                    <SelectTrigger>
                      <SelectValue placeholder="All Skill Levels" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Skill Levels</SelectItem>
                      <SelectItem value="advanced">Advanced</SelectItem>
                      <SelectItem value="intermediate">Intermediate</SelectItem>
                      <SelectItem value="basic">Basic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Availability Filter */}
                <div>
                  <Label className="text-sm font-medium mb-2 block">Availability</Label>
                  <Select defaultValue="all">
                    <SelectTrigger>
                      <SelectValue placeholder="All Employees" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Employees</SelectItem>
                      <SelectItem value="available">Available Only</SelectItem>
                      <SelectItem value="morning">Morning Shift</SelectItem>
                      <SelectItem value="afternoon">Afternoon Shift</SelectItem>
                      <SelectItem value="evening">Evening Shift</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Quick Stats Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

              {/* Daily Quick Stats */}
              {selectedDayData && (
                <>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Capacity Status</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-sm">Net Capacity:</span>
                          <span className="font-semibold">{selectedDayData.netCapacity}h</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">Required:</span>
                          <span className="font-semibold">{selectedDayData.clientRequired}h</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">Gap:</span>
                          <span className={cn("font-semibold", getCapacityColor(selectedDayData.capacityGap))}>
                            {selectedDayData.capacityGap >= 0 ? `+${selectedDayData.capacityGap}` : selectedDayData.capacityGap}h
                          </span>
                        </div>
                        <Progress 
                          value={selectedDayData.netCapacity > 0 ? (selectedDayData.clientRequired / selectedDayData.netCapacity) * 100 : 0} 
                          className="mt-2" 
                        />
                        <p className="text-xs text-gray-500">
                          {selectedDayData.netCapacity > 0 ? ((selectedDayData.clientRequired / selectedDayData.netCapacity) * 100).toFixed(1) : 0}% capacity needed
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Staff Status</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {statusDistribution.map((status, index) => (
                          <div key={status.name} className="flex justify-between items-center">
                            <Badge className={getStatusColor(status.name)} variant="outline">
                              {status.name}
                            </Badge>
                            <span className="text-sm font-semibold">{status.value}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>



            {/* Comprehensive Employee Capacity Table */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserCheck className="h-5 w-5" />
                  Employee Capacity Details - {formatDate(selectedDate)}
                </CardTitle>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Complete capacity overview: availability, contracted hours, and net capacity for scheduling
                </p>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Availability Window</TableHead>
                        <TableHead className="text-right">Contracted Daily</TableHead>
                        <TableHead className="text-right">Available Hours</TableHead>
                        <TableHead className="text-right">Sickness</TableHead>
                        <TableHead className="text-right">Holiday</TableHead>
                        <TableHead className="text-right">Net Capacity</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {employeeCapacityData.map((emp) => (
                        <TableRow key={emp.employeeId}>
                          <TableCell>
                            <div>
                              <div className="font-medium">{emp.name}</div>
                              <div className="text-xs text-gray-500">{emp.skillLevel}</div>
                            </div>
                          </TableCell>
                          <TableCell>{emp.role}</TableCell>
                          <TableCell>
                            <Badge className={getStatusColor(emp.status)} variant="outline">
                              {emp.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-xs">
                            <div className="text-sm font-mono">
                              {emp.availabilityWindow === "Not Available" ? (
                                <span className="text-gray-400">—</span>
                              ) : (
                                emp.availabilityWindow
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-semibold">{emp.contractedDailyHours}h</TableCell>
                          <TableCell className="text-right">{emp.availableHours}h</TableCell>
                          <TableCell className="text-right text-red-600">{emp.sicknessHours}h</TableCell>
                          <TableCell className="text-right text-orange-600">{emp.holidayHours}h</TableCell>
                          <TableCell className="text-right">
                            {emp.netCapacity > 0 ? (
                              <span className="font-semibold text-green-600">{emp.netCapacity}h</span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                
                {/* Summary Row */}
                <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Total Available:</span>
                      <div className="font-semibold text-lg">
                        {employeeCapacityData.reduce((sum, e) => sum + e.availableHours, 0).toFixed(1)}h
                      </div>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Net Capacity:</span>
                      <div className="font-semibold text-lg text-green-600">
                        {employeeCapacityData.reduce((sum, e) => sum + e.netCapacity, 0).toFixed(1)}h
                      </div>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Staff Available:</span>
                      <div className="font-semibold text-lg">
                        {employeeCapacityData.filter(e => e.status === 'Available' || e.status === 'Partial').length}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Performance Analytics Tab */}
          <TabsContent value="analytics" className="space-y-6">
            {/* Key Performance Metrics */}
            <div className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Key Performance Metrics</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Comprehensive capacity performance analysis</p>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Weekly Utilization Rate */}
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl p-5 border border-blue-200 dark:border-blue-800">
                  <div className="flex items-center gap-2 mb-3">
                    <Target className="h-5 w-5 text-blue-600" />
                    <span className="text-sm font-medium text-blue-800 dark:text-blue-200">Capacity Utilization</span>
                  </div>
                  <div className="text-3xl font-bold text-blue-900 dark:text-blue-100">
                    {weekSummary.length > 0 ? 
                      Math.round((weekSummary.reduce((sum, day) => sum + day.clientRequired, 0) / 
                                 weekSummary.reduce((sum, day) => sum + day.netCapacity, 0)) * 100) : 0}%
                  </div>
                  <div className="text-xs text-blue-600 dark:text-blue-400 mt-2">Weekly average utilization rate</div>
                  <div className="mt-3 h-2 bg-blue-200 dark:bg-blue-800 rounded-full">
                    <div 
                      className="h-2 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full" 
                      style={{ 
                        width: `${Math.min(100, weekSummary.length > 0 ? 
                          Math.round((weekSummary.reduce((sum, day) => sum + day.clientRequired, 0) / 
                                     weekSummary.reduce((sum, day) => sum + day.netCapacity, 0)) * 100) : 0)}%` 
                      }}
                    ></div>
                  </div>
                </div>

                {/* Staff Availability Ratio */}
                <div className="bg-gradient-to-br from-emerald-50 to-green-50 dark:from-emerald-900/20 dark:to-green-900/20 rounded-xl p-5 border border-emerald-200 dark:border-emerald-800">
                  <div className="flex items-center gap-2 mb-3">
                    <Users className="h-5 w-5 text-emerald-600" />
                    <span className="text-sm font-medium text-emerald-800 dark:text-emerald-200">Staff Availability</span>
                  </div>
                  <div className="text-3xl font-bold text-emerald-900 dark:text-emerald-100">
                    {employeeCapacityData.filter(e => e.netCapacity > 0).length}/{employeeCapacityData.length}
                  </div>
                  <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-2">
                    {employeeCapacityData.length > 0 ? Math.round((employeeCapacityData.filter(e => e.netCapacity > 0).length / employeeCapacityData.length) * 100) : 0}% active today
                  </div>
                  <div className="mt-3 h-2 bg-emerald-200 dark:bg-emerald-800 rounded-full">
                    <div 
                      className="h-2 bg-gradient-to-r from-emerald-500 to-green-600 rounded-full" 
                      style={{ 
                        width: `${employeeCapacityData.length > 0 ? Math.round((employeeCapacityData.filter(e => e.netCapacity > 0).length / employeeCapacityData.length) * 100) : 0}%` 
                      }}
                    ></div>
                  </div>
                </div>

                {/* Peak Demand Analysis */}
                <div className="bg-gradient-to-br from-purple-50 to-violet-50 dark:from-purple-900/20 dark:to-violet-900/20 rounded-xl p-5 border border-purple-200 dark:border-purple-800">
                  <div className="flex items-center gap-2 mb-3">
                    <Calendar className="h-5 w-5 text-purple-600" />
                    <span className="text-sm font-medium text-purple-800 dark:text-purple-200">Peak Demand</span>
                  </div>
                  <div className="text-3xl font-bold text-purple-900 dark:text-purple-100">
                    {Math.max(...weekSummary.map(day => day.clientRequired))}h
                  </div>
                  <div className="text-xs text-purple-600 dark:text-purple-400 mt-2">
                    Highest single day this week
                  </div>
                  <div className="text-xs text-purple-500 dark:text-purple-300 mt-1">
                    Avg: {weekSummary.length > 0 ? Math.round(weekSummary.reduce((sum, day) => sum + day.clientRequired, 0) / weekSummary.length) : 0}h daily
                  </div>
                </div>

                {/* Critical Shortage Analysis */}
                <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-xl p-5 border border-amber-200 dark:border-amber-800">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                    <span className="text-sm font-medium text-amber-800 dark:text-amber-200">Risk Assessment</span>
                  </div>
                  <div className="text-3xl font-bold text-amber-900 dark:text-amber-100">
                    {weekSummary.filter(day => day.capacityGap < -2).length}
                  </div>
                  <div className="text-xs text-amber-600 dark:text-amber-400 mt-2">Critical shortage days (2h+)</div>
                  <div className="text-xs text-amber-500 dark:text-amber-300 mt-1">
                    {weekSummary.filter(day => day.capacityGap < 0).length} total shortage days
                  </div>
                </div>
              </div>
            </div>

            {/* Advanced Analytics Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Capacity Trend Analysis */}
              <div className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
                <div className="flex items-center gap-3 mb-6">
                  <div className="h-8 w-8 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-lg flex items-center justify-center">
                    <TrendingUp className="h-4 w-4 text-white" />
                  </div>
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-white">Weekly Capacity Trends</h4>
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={weekSummary.map(d => ({
                      date: formatDate(d.date),
                      capacity: d.netCapacity,
                      demand: d.clientRequired,
                      utilization: d.netCapacity > 0 ? Math.round((d.clientRequired / d.netCapacity) * 100) : 0
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.3} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="hours" label={{ value: 'Hours', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="percent" orientation="right" label={{ value: 'Utilization %', angle: 90, position: 'insideRight' }} tick={{ fontSize: 11 }} />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'rgba(255, 255, 255, 0.95)', 
                          border: 'none', 
                          borderRadius: '12px',
                          boxShadow: '0 10px 25px rgba(0, 0, 0, 0.15)'
                        }} 
                      />
                      <Legend />
                      <Line yAxisId="hours" type="monotone" dataKey="capacity" stroke="#10b981" strokeWidth={3} name="Net Capacity" />
                      <Line yAxisId="hours" type="monotone" dataKey="demand" stroke="#8b5cf6" strokeWidth={3} name="Client Demand" />
                      <Line yAxisId="percent" type="monotone" dataKey="utilization" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" name="Utilization %" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Staff Performance Distribution */}
              <div className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
                <div className="flex items-center gap-3 mb-6">
                  <div className="h-8 w-8 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center">
                    <Users className="h-4 w-4 text-white" />
                  </div>
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-white">Staff Capacity Distribution</h4>
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusDistribution}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, value, percent }) => `${name}: ${value} (${(percent).toFixed(0)}%)`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {statusDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Enhanced Smart Recommendations */}
            <div className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl flex items-center justify-center">
                  <Zap className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Smart Recommendations & Strategic Insights</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">AI-powered recommendations for optimal capacity management</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Critical Actions */}
                <div className="space-y-4">
                  <h4 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                    Critical Actions Required
                  </h4>
                  <div className="space-y-3">
                    {kpis.capacityGap < -5 && (
                      <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
                          <div>
                            <div className="font-medium text-red-800 dark:text-red-200">Severe Capacity Shortage</div>
                            <div className="text-sm text-red-700 dark:text-red-300 mt-1">
                              {Math.abs(kpis.capacityGap)}h weekly shortage detected. Immediate action required:
                              <ul className="mt-2 ml-4 space-y-1 text-xs">
                                <li>• Contact agency staff for emergency cover</li>
                                <li>• Review overtime authorization for existing staff</li>
                                <li>• Consider temporary schedule adjustments</li>
                              </ul>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {employeeCapacityData.filter(e => e.netCapacity > 0).length < 3 && (
                      <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                        <div className="flex items-start gap-3">
                          <Users className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
                          <div>
                            <div className="font-medium text-amber-800 dark:text-amber-200">Low Staff Availability</div>
                            <div className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                              Only {employeeCapacityData.filter(e => e.netCapacity > 0).length} staff available today. Actions needed:
                              <ul className="mt-2 ml-4 space-y-1 text-xs">
                                <li>• Activate backup staffing plan</li>
                                <li>• Review sick leave and holiday patterns</li>
                                <li>• Consider cross-training opportunities</li>
                              </ul>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {kpis.sicknessHours > 15 && (
                      <div className="p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5 flex-shrink-0" />
                          <div>
                            <div className="font-medium text-orange-800 dark:text-orange-200">High Sickness Levels</div>
                            <div className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                              {kpis.sicknessHours}h of sickness this week. Consider:
                              <ul className="mt-2 ml-4 space-y-1 text-xs">
                                <li>• Wellness program implementation</li>
                                <li>• Pattern analysis for recurring absences</li>
                                <li>• Workload distribution review</li>
                              </ul>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Optimization Opportunities */}
                <div className="space-y-4">
                  <h4 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-green-500" />
                    Optimization Opportunities
                  </h4>
                  <div className="space-y-3">
                    {weekSummary.filter(day => day.capacityGap >= 5).length > 2 && (
                      <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl">
                        <div className="flex items-start gap-3">
                          <TrendingUp className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                          <div>
                            <div className="font-medium text-green-800 dark:text-green-200">Capacity Surplus Detected</div>
                            <div className="text-sm text-green-700 dark:text-green-300 mt-1">
                              Strong surplus on {weekSummary.filter(day => day.capacityGap >= 5).length} days. Opportunities:
                              <ul className="mt-2 ml-4 space-y-1 text-xs">
                                <li>• Accept additional client bookings</li>
                                <li>• Offer training sessions during quiet periods</li>
                                <li>• Schedule equipment maintenance tasks</li>
                                <li>• Implement continuous improvement projects</li>
                              </ul>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {employeeCapacityData.filter(e => e.skillLevel === 'Advanced').length > 0 && (
                      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
                        <div className="flex items-start gap-3">
                          <Star className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                          <div>
                            <div className="font-medium text-blue-800 dark:text-blue-200">Skill Development Opportunities</div>
                            <div className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                              {employeeCapacityData.filter(e => e.skillLevel === 'Advanced').length} advanced staff available for:
                              <ul className="mt-2 ml-4 space-y-1 text-xs">
                                <li>• Mentoring junior staff members</li>
                                <li>• Leading specialized client programs</li>
                                <li>• Developing best practice procedures</li>
                                <li>• Training delivery and assessment</li>
                              </ul>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="p-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-xl">
                      <div className="flex items-start gap-3">
                        <Target className="h-5 w-5 text-purple-600 mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="font-medium text-purple-800 dark:text-purple-200">Strategic Planning Insights</div>
                          <div className="text-sm text-purple-700 dark:text-purple-300 mt-1">
                            Based on current trends:
                            <ul className="mt-2 ml-4 space-y-1 text-xs">
                              <li>• Peak demand occurs on {weekSummary.reduce((max, day) => day.clientRequired > max.clientRequired ? day : max, weekSummary[0])?.date ? formatDate(weekSummary.reduce((max, day) => day.clientRequired > max.clientRequired ? day : max, weekSummary[0]).date) : 'N/A'}</li>
                              <li>• Average utilization rate: {weekSummary.length > 0 ? Math.round((weekSummary.reduce((sum, day) => sum + day.clientRequired, 0) / weekSummary.reduce((sum, day) => sum + day.netCapacity, 0)) * 100) : 0}%</li>
                              <li>• Consider flexible scheduling for high-demand periods</li>
                              <li>• Review staff contracts for optimal coverage</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Export Tab */}
          <TabsContent value="export" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Download className="h-5 w-5" />
                  Daily Excel Export
                </CardTitle>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Export comprehensive daily capacity report for your team
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="export-date">Select Date to Export</Label>
                    <Select value={selectedDate} onValueChange={setSelectedDate}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {weekDates.map(date => (
                          <SelectItem key={date} value={date}>
                            {formatDateLong(date)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="flex items-end">
                    <Button 
                      onClick={handleExcelExport} 
                      className="w-full flex items-center gap-2"
                      size="lg"
                    >
                      <FileSpreadsheet className="h-4 w-4" />
                      Export Excel Report
                    </Button>
                  </div>
                </div>
                
                {/* Export Preview */}
                {selectedDayData && (
                  <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                    <h4 className="font-semibold mb-3">Export Contents Preview</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                      <div>
                        <strong>Daily Summary Sheet:</strong>
                        <ul className="ml-4 mt-1 space-y-1">
                          <li>• Net capacity: {selectedDayData.netCapacity}h</li>
                          <li>• Client demand: {selectedDayData.clientRequired}h</li>
                          <li>• Capacity gap: {selectedDayData.capacityGap}h</li>
                          <li>• Absence breakdown</li>
                        </ul>
                      </div>
                      <div>
                        <strong>Employee Capacity Sheet:</strong>
                        <ul className="ml-4 mt-1 space-y-1">
                          <li>• {employeeCapacityData.length} employee records</li>
                          <li>• Availability windows</li>
                          <li>• Contracted vs available hours</li>
                          <li>• Net capacity calculations</li>
                        </ul>
                      </div>
                      <div>
                        <strong>Client Demand Sheet:</strong>
                        <ul className="ml-4 mt-1 space-y-1">
                          <li>• Shift-based demand breakdown</li>
                          <li>• Priority vs regular clients</li>
                          <li>• Demand distribution analysis</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}