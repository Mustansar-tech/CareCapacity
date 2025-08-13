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
  UserCheck, Target
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

  // Chart data for time-based capacity visualization
  const capacityChartData = useMemo(() => {
    if (!selectedDayData || !selectedDayClientDemand) return [];
    
    // Categorize availability by time periods based on start times
    const getTimePeriod = (timeSlot: string) => {
      if (!timeSlot || timeSlot === "Not Available") return "None";
      const startTime = timeSlot.split('-')[0];
      const hour = parseInt(startTime.split(':')[0]);
      
      if (hour >= 6 && hour < 12) return 'Morning (6AM-12PM)';
      if (hour >= 12 && hour < 18) return 'Afternoon (12PM-6PM)';
      if (hour >= 18 && hour < 22) return 'Evening (6PM-10PM)';
      return 'Night (10PM-6AM)';
    };

    const periodCapacity = employeeCapacityData.reduce((acc, emp) => {
      const period = getTimePeriod(emp.availabilityWindow);
      acc[period] = (acc[period] || 0) + emp.netCapacity;
      return acc;
    }, {} as Record<string, number>);

    return [
      { 
        name: 'Morning (6AM-12PM)', 
        capacity: periodCapacity['Morning (6AM-12PM)'] || 0,
        required: selectedDayClientDemand.morning_hours,
      },
      { 
        name: 'Afternoon (12PM-6PM)', 
        capacity: periodCapacity['Afternoon (12PM-6PM)'] || 0,
        required: selectedDayClientDemand.day_hours,
      },
      { 
        name: 'Evening (6PM-10PM)', 
        capacity: periodCapacity['Evening (6PM-10PM)'] || 0,
        required: selectedDayClientDemand.evening_hours,
      },
    ];
  }, [selectedDayData, selectedDayClientDemand, employeeCapacityData]);

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
              <TabsTrigger value="absence" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-indigo-600 data-[state=active]:text-white rounded-xl transition-all duration-200">
                Sickness & Holidays
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

            {/* Modern Weekly Capacity Chart */}
            <div className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Weekly Capacity vs Demand</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Green line shows your team's capacity, purple line shows client demand
                  </p>
                </div>
              </div>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weekSummary.map(d => ({
                    date: formatDate(d.date),
                    'Net Capacity': d.netCapacity,
                    'Client Required': d.clientRequired,
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.3} />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis label={{ value: 'Hours', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 12 }} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'rgba(255, 255, 255, 0.9)', 
                        border: 'none', 
                        borderRadius: '12px',
                        boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)'
                      }} 
                    />
                    <Legend />
                    <Line 
                      type="monotone" 
                      dataKey="Net Capacity" 
                      stroke="url(#greenGradient)" 
                      strokeWidth={4}
                      strokeLinecap="round"
                      dot={{ fill: '#10b981', strokeWidth: 2, r: 6 }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="Client Required" 
                      stroke="url(#purpleGradient)" 
                      strokeWidth={4}
                      strokeLinecap="round"
                      dot={{ fill: '#8b5cf6', strokeWidth: 2, r: 6 }}
                    />
                    <defs>
                      <linearGradient id="greenGradient" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#10b981" />
                        <stop offset="100%" stopColor="#06d6a0" />
                      </linearGradient>
                      <linearGradient id="purpleGradient" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#8b5cf6" />
                        <stop offset="100%" stopColor="#a855f7" />
                      </linearGradient>
                    </defs>
                  </LineChart>
                </ResponsiveContainer>
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
            {/* Date Selection */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    Select Date
                  </CardTitle>
                </CardHeader>
                <CardContent>
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
                </CardContent>
              </Card>

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

            {/* Time-based Capacity Chart */}
            <div className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center">
                  <Clock className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Capacity vs Demand by Time Period - {formatDate(selectedDate)}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Blue bars show available capacity, purple bars show client demand for each time period
                  </p>
                </div>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={capacityChartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.3} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis label={{ value: 'Hours', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 12 }} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'rgba(255, 255, 255, 0.9)', 
                        border: 'none', 
                        borderRadius: '12px',
                        boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)'
                      }} 
                    />
                    <Legend />
                    <Bar 
                      dataKey="capacity" 
                      fill="url(#blueGradient)" 
                      name="Available Capacity" 
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar 
                      dataKey="required" 
                      fill="url(#purpleGradient2)" 
                      name="Client Demand" 
                      radius={[4, 4, 0, 0]}
                    />
                    <defs>
                      <linearGradient id="blueGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" />
                        <stop offset="100%" stopColor="#1e40af" />
                      </linearGradient>
                      <linearGradient id="purpleGradient2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8b5cf6" />
                        <stop offset="100%" stopColor="#7c3aed" />
                      </linearGradient>
                    </defs>
                  </BarChart>
                </ResponsiveContainer>
              </div>
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

          {/* Sickness & Holidays Tab */}
          <TabsContent value="absence" className="space-y-6">
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

            <Card>
              <CardHeader>
                <CardTitle>Weekly Sickness & Holiday Hours</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={weekSummary.map(d => ({
                      date: formatDate(d.date),
                      sickness: d.sickness,
                      holidays: d.holiday,
                    }))}>
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