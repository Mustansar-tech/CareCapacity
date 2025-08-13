import React, { useMemo, useState, useCallback } from "react";
import dayjs from "dayjs";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell
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
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Upload, Download, FileSpreadsheet, Calendar, Users, Clock, 
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle, 
  XCircle, Info, UserCheck, UserX, Target
} from "lucide-react";
import { cn } from "@/lib/utils";

// ====================== ENHANCED MOCK DATA ======================

const MOCK_employees = [
  { 
    id: "E1", 
    name: "Jane Smith", 
    contractedWeeklyHours: 37.5, 
    workingDays: ["Mon","Tue","Wed","Thu","Fri"],
    role: "Senior Caregiver",
    skillLevel: "Advanced",
    hourlyRate: 18.50
  },
  { 
    id: "E2", 
    name: "John Doe", 
    contractedWeeklyHours: 30, 
    workingDays: ["Mon","Tue","Thu","Fri"],
    role: "Caregiver",
    skillLevel: "Intermediate", 
    hourlyRate: 16.00
  },
  { 
    id: "E3", 
    name: "Maria Khan", 
    contractedWeeklyHours: 20, 
    workingDays: ["Mon","Wed","Fri"],
    role: "Support Worker",
    skillLevel: "Basic",
    hourlyRate: 14.50
  },
  { 
    id: "E4", 
    name: "Alex Green", 
    contractedWeeklyHours: 25, 
    workingDays: ["Tue","Wed","Thu","Sat"],
    role: "Night Caregiver",
    skillLevel: "Advanced",
    hourlyRate: 19.00
  },
  { 
    id: "E5", 
    name: "Sam Patel", 
    contractedWeeklyHours: 16, 
    workingDays: ["Mon","Tue","Wed","Thu"],
    role: "Part-time Support",
    skillLevel: "Basic",
    hourlyRate: 13.50
  },
];

const MOCK_availability = [
  { employeeId: "E1", date: "2025-08-18", slotStart: "08:00", slotEnd: "16:00", preferredShift: "Day" },
  { employeeId: "E2", date: "2025-08-18", slotStart: "09:00", slotEnd: "17:00", preferredShift: "Day" },
  { employeeId: "E3", date: "2025-08-18", slotStart: "07:00", slotEnd: "12:00", preferredShift: "Morning" },
  { employeeId: "E4", date: "2025-08-18", slotStart: "22:00", slotEnd: "06:00", preferredShift: "Night" },
  
  { employeeId: "E1", date: "2025-08-19", slotStart: "08:00", slotEnd: "12:00", preferredShift: "Morning" },
  { employeeId: "E2", date: "2025-08-19", slotStart: "09:00", slotEnd: "17:00", preferredShift: "Day" },
  { employeeId: "E3", date: "2025-08-19", slotStart: "10:00", slotEnd: "16:00", preferredShift: "Day" },
  { employeeId: "E4", date: "2025-08-19", slotStart: "12:00", slotEnd: "18:00", preferredShift: "Evening" },
  
  { employeeId: "E1", date: "2025-08-20", slotStart: "08:00", slotEnd: "16:00", preferredShift: "Day" },
  { employeeId: "E2", date: "2025-08-20", slotStart: "09:00", slotEnd: "17:00", preferredShift: "Day" },
  { employeeId: "E3", date: "2025-08-20", slotStart: "08:00", slotEnd: "11:00", preferredShift: "Morning" },
  { employeeId: "E5", date: "2025-08-20", slotStart: "14:00", slotEnd: "18:00", preferredShift: "Evening" },
  
  { employeeId: "E4", date: "2025-08-21", slotStart: "08:00", slotEnd: "13:00", preferredShift: "Morning" },
  { employeeId: "E2", date: "2025-08-21", slotStart: "09:00", slotEnd: "17:00", preferredShift: "Day" },
  { employeeId: "E3", date: "2025-08-21", slotStart: "10:00", slotEnd: "14:00", preferredShift: "Day" },
  
  { employeeId: "E1", date: "2025-08-22", slotStart: "08:00", slotEnd: "15:00", preferredShift: "Day" },
  { employeeId: "E2", date: "2025-08-22", slotStart: "09:00", slotEnd: "16:00", preferredShift: "Day" },
  { employeeId: "E5", date: "2025-08-22", slotStart: "10:00", slotEnd: "15:00", preferredShift: "Day" },
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

const MOCK_assignments = [
  { employeeId: "E1", date: "2025-08-18", hours: 6, clientName: "Mrs. Johnson", timeSlot: "08:00-14:00" },
  { employeeId: "E2", date: "2025-08-18", hours: 4, clientName: "Mr. Brown", timeSlot: "09:00-13:00" },
  { employeeId: "E2", date: "2025-08-19", hours: 7, clientName: "Mrs. Wilson", timeSlot: "09:00-16:00" },
  { employeeId: "E4", date: "2025-08-19", hours: 5, clientName: "Mr. Davis", timeSlot: "12:00-17:00" },
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
  hourlyRate: number;
}

interface AvailabilitySlot {
  employeeId: string;
  date: string;
  slotStart: string;
  slotEnd: string;
  preferredShift: string;
  slotHours?: number;
}

interface AbsenceRecord {
  employeeId: string;
  date: string;
  hours: number;
  reason: string;
}

interface Assignment {
  employeeId: string;
  date: string;
  hours: number;
  clientName: string;
  timeSlot: string;
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
  avail: number;
  sickness: number;
  holiday: number;
  net: number;
  client: number;
  delta: number;
  assigned: number;
  remaining: number;
}

interface SchedulingEmployeeRow {
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
  netAvailable: number;
  currentAssignments: number;
  maxCanAssign: number;
  remainingCapacity: number;
  utilizationRate: number;
  status: 'Available' | 'Partially Available' | 'Unavailable' | 'Sick' | 'Holiday';
  hourlyRate: number;
  estimatedCost: number;
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

const formatDelta = (value: number) => {
  if (value > 0) return `+${value}`;
  return value.toString();
};

const getDeltaColor = (value: number) => {
  if (value > 0) return "text-green-600 dark:text-green-400";
  if (value < 0) return "text-red-600 dark:text-red-400";
  return "text-gray-600 dark:text-gray-400";
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'Available': return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    case 'Partially Available': return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
    case 'Unavailable': return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
    case 'Sick': return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
    case 'Holiday': return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    default: return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
  }
};

// ====================== CORE AGGREGATIONS ======================

const aggregateAvailabilityForWeek = (
  availability: AvailabilitySlot[], 
  sickness: AbsenceRecord[], 
  holidays: AbsenceRecord[], 
  assignments: Assignment[],
  clientDemandDaily: ClientDemand[], 
  weekDates: string[]
): DailySummary[] => {
  const availByDate = new Map<string, number>();
  const sickByDate = new Map<string, number>();
  const holByDate = new Map<string, number>();
  const assignedByDate = new Map<string, number>();

  // Calculate availability hours
  availability.forEach(a => {
    const hours = a.slotHours ?? parseHours(a.slotStart, a.slotEnd);
    availByDate.set(a.date, (availByDate.get(a.date) || 0) + hours);
  });

  // Calculate sickness, holiday, and assignment hours
  sickness.forEach(s => sickByDate.set(s.date, (sickByDate.get(s.date) || 0) + s.hours));
  holidays.forEach(h => holByDate.set(h.date, (holByDate.get(h.date) || 0) + h.hours));
  assignments.forEach(a => assignedByDate.set(a.date, (assignedByDate.get(a.date) || 0) + a.hours));

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
    const assigned = +(assignedByDate.get(date) || 0).toFixed(2);
    const net = Math.max(0, +(avail - sick - hol).toFixed(2));
    const client = +(clientMap.get(date) || 0);
    const delta = +(net - client).toFixed(2);
    const remaining = Math.max(0, +(net - assigned).toFixed(2));
    
    return { date, avail, sickness: sick, holiday: hol, net, client, delta, assigned, remaining };
  });
};

const buildSchedulingEmployeeRows = (
  date: string, 
  employees: Employee[], 
  availability: AvailabilitySlot[], 
  sickness: AbsenceRecord[], 
  holidays: AbsenceRecord[],
  assignments: Assignment[]
): SchedulingEmployeeRow[] => {
  const avForDay = availability.filter(a => a.date === date);
  const sickForDay = sickness.filter(s => s.date === date);
  const holForDay = holidays.filter(h => h.date === date);
  const assignedForDay = assignments.filter(a => a.date === date);

  const byEmpAvail = new Map<string, Array<{start: string, end: string, hours: number, shift: string}>>();
  avForDay.forEach(a => {
    const hours = a.slotHours ?? parseHours(a.slotStart, a.slotEnd);
    const arr = byEmpAvail.get(a.employeeId) || [];
    arr.push({ start: a.slotStart, end: a.slotEnd, hours, shift: a.preferredShift });
    byEmpAvail.set(a.employeeId, arr);
  });

  const sickMap = new Map(sickForDay.map(s => [s.employeeId, s.hours]));
  const holMap = new Map(holForDay.map(h => [h.employeeId, h.hours]));
  const assignedMap = new Map(assignedForDay.map(a => [a.employeeId, a.hours]));

  return employees.map(e => {
    const slots = byEmpAvail.get(e.id) || [];
    const availableHours = +(sumBy(slots, s => s.hours).toFixed(2));
    const availabilityWindow = slots.map(s => `${s.start}-${s.end} (${s.shift})`).join("; ") || "Not Available";
    const sicknessHours = +(sickMap.get(e.id) || 0);
    const holidayHours = +(holMap.get(e.id) || 0);
    const currentAssignments = +(assignedMap.get(e.id) || 0);
    const netAvailable = Math.max(0, +(availableHours - sicknessHours - holidayHours).toFixed(2));
    
    const wdCount = e.workingDays?.length || 5;
    const contractedDailyHours = +((e.contractedWeeklyHours / wdCount) || 0).toFixed(2);
    
    // Calculate max assignable hours (lesser of net available and contracted daily)
    const maxCanAssign = Math.min(netAvailable, contractedDailyHours);
    const remainingCapacity = Math.max(0, +(maxCanAssign - currentAssignments).toFixed(2));
    const utilizationRate = maxCanAssign > 0 ? +((currentAssignments / maxCanAssign) * 100).toFixed(1) : 0;
    
    // Determine status
    let status: SchedulingEmployeeRow['status'] = 'Unavailable';
    if (sicknessHours > 0) status = 'Sick';
    else if (holidayHours > 0) status = 'Holiday';
    else if (netAvailable === 0) status = 'Unavailable';
    else if (remainingCapacity > 0) status = 'Available';
    else if (currentAssignments > 0) status = 'Partially Available';
    
    const estimatedCost = +(remainingCapacity * e.hourlyRate).toFixed(2);

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
      netAvailable,
      currentAssignments,
      maxCanAssign,
      remainingCapacity,
      utilizationRate,
      status,
      hourlyRate: e.hourlyRate,
      estimatedCost,
    };
  });
};

// ====================== EXCEL EXPORT FUNCTIONS ======================

const exportToExcel = (
  selectedDate: string,
  dailySummary: DailySummary,
  employeeRows: SchedulingEmployeeRow[],
  clientDemand: ClientDemand | undefined
) => {
  const wb = XLSX.utils.book_new();
  
  // Daily Summary Sheet
  const summaryData = [
    ['Care Hours Analysis Report'],
    ['Date:', formatDateLong(selectedDate)],
    [''],
    ['DAILY SUMMARY'],
    ['Metric', 'Hours', 'Notes'],
    ['Total Available Hours', dailySummary.avail, 'Raw availability before absences'],
    ['Sickness Hours', dailySummary.sickness, 'Hours lost to sickness'],
    ['Holiday Hours', dailySummary.holiday, 'Hours lost to holidays'],
    ['Net Available Hours', dailySummary.net, 'Available after absences'],
    ['Client Required Hours', dailySummary.client, 'Total client demand'],
    ['Current Assignments', dailySummary.assigned, 'Already scheduled hours'],
    ['Remaining Capacity', dailySummary.remaining, 'Hours still available to assign'],
    ['Surplus/Deficit', dailySummary.delta, dailySummary.delta >= 0 ? 'Sufficient capacity' : 'Shortage - needs attention'],
  ];
  
  const summaryWS = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, summaryWS, 'Daily Summary');
  
  // Employee Details Sheet
  const employeeHeaders = [
    'Employee Name', 'Role', 'Skill Level', 'Contracted Daily Hours', 
    'Available Window', 'Available Hours', 'Sickness Hours', 'Holiday Hours',
    'Net Available', 'Current Assignments', 'Max Can Assign', 'Remaining Capacity',
    'Utilization %', 'Status', 'Hourly Rate', 'Estimated Cost', 'Working Days'
  ];
  
  const employeeData = [
    employeeHeaders,
    ...employeeRows.map(emp => [
      emp.name,
      emp.role,
      emp.skillLevel,
      emp.contractedDailyHours,
      emp.availabilityWindow,
      emp.availableHours,
      emp.sicknessHours,
      emp.holidayHours,
      emp.netAvailable,
      emp.currentAssignments,
      emp.maxCanAssign,
      emp.remainingCapacity,
      emp.utilizationRate + '%',
      emp.status,
      '£' + emp.hourlyRate,
      '£' + emp.estimatedCost,
      emp.workingDays.join(', ')
    ])
  ];
  
  const employeeWS = XLSX.utils.aoa_to_sheet(employeeData);
  XLSX.utils.book_append_sheet(wb, employeeWS, 'Employee Details');
  
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
  XLSX.writeFile(wb, `care-hours-scheduling-${dayjs(selectedDate).format('YYYY-MM-DD')}.xlsx`);
};

// ====================== DASHBOARD COMPONENT ======================

export default function Dashboard() {
  // Data state
  const [employees] = useState<Employee[]>(MOCK_employees);
  const [availability] = useState<AvailabilitySlot[]>(MOCK_availability);
  const [sickness] = useState<AbsenceRecord[]>(MOCK_sickness);
  const [holidays] = useState<AbsenceRecord[]>(MOCK_holidays);
  const [assignments] = useState<Assignment[]>(MOCK_assignments);
  const [clientDemandDaily] = useState<ClientDemand[]>(MOCK_clientDemandDaily);
  const [weekDates] = useState<string[]>(DEFAULT_WEEK);
  
  // UI state
  const [selectedDate, setSelectedDate] = useState<string>(DEFAULT_WEEK[0]);
  const [uploadStatus, setUploadStatus] = useState<string>("");

  // Calculate aggregated data
  const weekSummary = useMemo(() => 
    aggregateAvailabilityForWeek(availability, sickness, holidays, assignments, clientDemandDaily, weekDates),
    [availability, sickness, holidays, assignments, clientDemandDaily, weekDates]
  );

  const schedulingEmployeeData = useMemo(() => 
    buildSchedulingEmployeeRows(selectedDate, employees, availability, sickness, holidays, assignments),
    [selectedDate, employees, availability, sickness, holidays, assignments]
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
    const totalNet = sumBy(weekSummary, d => d.net);
    const totalClient = sumBy(weekSummary, d => d.client);
    const totalSickness = sumBy(weekSummary, d => d.sickness);
    const totalHolidays = sumBy(weekSummary, d => d.holiday);
    const totalAssigned = sumBy(weekSummary, d => d.assigned);
    const delta = totalNet - totalClient;

    return {
      netAvailability: +totalNet.toFixed(2),
      clientRequired: +totalClient.toFixed(2),
      delta: +delta.toFixed(2),
      sicknessHours: +totalSickness.toFixed(2),
      holidayHours: +totalHolidays.toFixed(2),
      assignedHours: +totalAssigned.toFixed(2),
      utilizationRate: totalNet > 0 ? +((totalAssigned / totalNet) * 100).toFixed(1) : 0,
    };
  }, [weekSummary]);

  // Chart data for capacity visualization
  const capacityChartData = useMemo(() => {
    if (!selectedDayData || !selectedDayClientDemand) return [];
    
    return [
      { 
        name: 'Morning', 
        available: schedulingEmployeeData.filter(e => e.availabilityWindow.includes('Morning')).reduce((sum, e) => sum + e.remainingCapacity, 0),
        required: selectedDayClientDemand.morning_hours,
      },
      { 
        name: 'Day', 
        available: schedulingEmployeeData.filter(e => e.availabilityWindow.includes('Day')).reduce((sum, e) => sum + e.remainingCapacity, 0),
        required: selectedDayClientDemand.day_hours,
      },
      { 
        name: 'Evening', 
        available: schedulingEmployeeData.filter(e => e.availabilityWindow.includes('Evening')).reduce((sum, e) => sum + e.remainingCapacity, 0),
        required: selectedDayClientDemand.evening_hours,
      },
    ];
  }, [selectedDayData, selectedDayClientDemand, schedulingEmployeeData]);

  // Status distribution for pie chart
  const statusDistribution = useMemo(() => {
    const distribution = schedulingEmployeeData.reduce((acc, emp) => {
      acc[emp.status] = (acc[emp.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(distribution).map(([status, count]) => ({
      name: status,
      value: count,
      percentage: ((count / schedulingEmployeeData.length) * 100).toFixed(1)
    }));
  }, [schedulingEmployeeData]);

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
    exportToExcel(selectedDate, selectedDayData, schedulingEmployeeData, selectedDayClientDemand);
  }, [selectedDate, selectedDayData, schedulingEmployeeData, selectedDayClientDemand]);

  const COLORS = ['#10b981', '#f59e0b', '#6b7280', '#ef4444', '#3b82f6'];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Care Hours vs Client Demand Dashboard
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Comprehensive scheduling tool for care team management
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
            <TabsTrigger value="daily">Daily Scheduling</TabsTrigger>
            <TabsTrigger value="absence">Sickness & Holidays</TabsTrigger>
            <TabsTrigger value="export">Export Reports</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            {/* Enhanced KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-7 gap-4">
              <Card className="lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400 flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    Net Available Hours
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                    {kpis.netAvailability}h
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Total capacity this week</p>
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400 flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Client Required Hours
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                    {kpis.clientRequired}h
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Total demand this week</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400 flex items-center gap-1">
                    Difference
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
                    Sickness
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
                    Holidays
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                    {kpis.holidayHours}h
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Weekly Overview Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Weekly Capacity vs Demand Overview</CardTitle>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Green line shows your team's available capacity, purple line shows client demand
                </p>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={weekSummary.map(d => ({
                      date: formatDate(d.date),
                      'Available Capacity': d.net,
                      'Client Demand': d.client,
                      'Already Assigned': d.assigned,
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis label={{ value: 'Hours', angle: -90, position: 'insideLeft' }} />
                      <Tooltip />
                      <Legend />
                      <Line 
                        type="monotone" 
                        dataKey="Available Capacity" 
                        stroke="#10b981" 
                        strokeWidth={3}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="Client Demand" 
                        stroke="#8b5cf6" 
                        strokeWidth={3}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="Already Assigned" 
                        stroke="#3b82f6" 
                        strokeWidth={2}
                        strokeDasharray="5 5"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Daily Summary Table */}
            <Card>
              <CardHeader>
                <CardTitle>Daily Capacity Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead className="text-right">Demand</TableHead>
                      <TableHead className="text-right">Assigned</TableHead>
                      <TableHead className="text-right">Remaining</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {weekSummary.map((day) => (
                      <TableRow key={day.date}>
                        <TableCell className="font-medium">{formatDate(day.date)}</TableCell>
                        <TableCell className="text-right">{day.net}h</TableCell>
                        <TableCell className="text-right">{day.client}h</TableCell>
                        <TableCell className="text-right">{day.assigned}h</TableCell>
                        <TableCell className="text-right font-semibold">{day.remaining}h</TableCell>
                        <TableCell className="text-right">
                          {day.delta >= 0 ? (
                            <Badge className="bg-green-100 text-green-800">Sufficient</Badge>
                          ) : (
                            <Badge className="bg-red-100 text-red-800">Shortage</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Enhanced Daily Scheduling Tab */}
          <TabsContent value="daily" className="space-y-6">
            {/* Date Selection with Quick Stats */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    Select Date for Scheduling
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
                          <span className="text-sm">Available:</span>
                          <span className="font-semibold">{selectedDayData.net}h</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">Required:</span>
                          <span className="font-semibold">{selectedDayData.client}h</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">Remaining:</span>
                          <span className="font-semibold text-green-600">{selectedDayData.remaining}h</span>
                        </div>
                        <Progress 
                          value={(selectedDayData.assigned / selectedDayData.net) * 100} 
                          className="mt-2" 
                        />
                        <p className="text-xs text-gray-500">
                          {((selectedDayData.assigned / selectedDayData.net) * 100).toFixed(1)}% utilized
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Staff Availability</CardTitle>
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

            {/* Shift-based Capacity Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Capacity vs Demand by Shift - {formatDate(selectedDate)}</CardTitle>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Blue bars show available capacity, purple bars show client demand
                </p>
              </CardHeader>
              <CardContent>
                <div className="h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={capacityChartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis label={{ value: 'Hours', angle: -90, position: 'insideLeft' }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="available" fill="#3b82f6" name="Available Capacity" />
                      <Bar dataKey="required" fill="#8b5cf6" name="Client Demand" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Staff Status Overview */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Staff Status Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-60">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={statusDistribution}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({name, percentage}) => `${name}: ${percentage}%`}
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
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Quick Actions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button 
                    onClick={handleExcelExport} 
                    className="w-full flex items-center gap-2"
                  >
                    <Download className="h-4 w-4" />
                    Export Daily Schedule
                  </Button>
                  <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
                    <div className="flex justify-between">
                      <span>Total Staff:</span>
                      <span className="font-semibold">{schedulingEmployeeData.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Available Today:</span>
                      <span className="font-semibold text-green-600">
                        {schedulingEmployeeData.filter(e => e.status === 'Available' || e.status === 'Partially Available').length}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Total Remaining Hours:</span>
                      <span className="font-semibold text-blue-600">
                        {schedulingEmployeeData.reduce((sum, e) => sum + e.remainingCapacity, 0).toFixed(1)}h
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Comprehensive Employee Scheduling Table */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserCheck className="h-5 w-5" />
                  Employee Scheduling Details - {formatDate(selectedDate)}
                </CardTitle>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Complete overview for scheduling team: availability, contracted hours, current assignments, and remaining capacity
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
                        <TableHead className="text-right">Current Assignments</TableHead>
                        <TableHead className="text-right">Can Still Assign</TableHead>
                        <TableHead className="text-right">Utilization</TableHead>
                        <TableHead className="text-right">Hourly Rate</TableHead>
                        <TableHead className="text-right">Est. Cost Available</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {schedulingEmployeeData.map((emp) => (
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
                          <TableCell className="text-right">{emp.netAvailable}h</TableCell>
                          <TableCell className="text-right">{emp.currentAssignments}h</TableCell>
                          <TableCell className="text-right">
                            {emp.remainingCapacity > 0 ? (
                              <span className="font-semibold text-green-600">{emp.remainingCapacity}h</span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Progress value={emp.utilizationRate} className="w-12 h-2" />
                              <span className="text-sm">{emp.utilizationRate}%</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">£{emp.hourlyRate}</TableCell>
                          <TableCell className="text-right">
                            {emp.estimatedCost > 0 ? (
                              <span className="font-semibold">£{emp.estimatedCost}</span>
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
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Total Available:</span>
                      <div className="font-semibold text-lg">
                        {schedulingEmployeeData.reduce((sum, e) => sum + e.netAvailable, 0).toFixed(1)}h
                      </div>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Currently Assigned:</span>
                      <div className="font-semibold text-lg">
                        {schedulingEmployeeData.reduce((sum, e) => sum + e.currentAssignments, 0).toFixed(1)}h
                      </div>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Still Can Assign:</span>
                      <div className="font-semibold text-lg text-green-600">
                        {schedulingEmployeeData.reduce((sum, e) => sum + e.remainingCapacity, 0).toFixed(1)}h
                      </div>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Total Cost Available:</span>
                      <div className="font-semibold text-lg">
                        £{schedulingEmployeeData.reduce((sum, e) => sum + e.estimatedCost, 0).toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Sickness & Holidays Tab - Same as before */}
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

          {/* Enhanced Export Tab */}
          <TabsContent value="export" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Download className="h-5 w-5" />
                  Daily Excel Export
                </CardTitle>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Export comprehensive daily scheduling report for your team
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
                          <li>• Available hours: {selectedDayData.net}h</li>
                          <li>• Client demand: {selectedDayData.client}h</li>
                          <li>• Capacity remaining: {selectedDayData.remaining}h</li>
                          <li>• Absence breakdown</li>
                        </ul>
                      </div>
                      <div>
                        <strong>Employee Details Sheet:</strong>
                        <ul className="ml-4 mt-1 space-y-1">
                          <li>• {schedulingEmployeeData.length} employee records</li>
                          <li>• Availability windows</li>
                          <li>• Contracted vs available hours</li>
                          <li>• Assignment capacity & costs</li>
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

            {/* Quick Export Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Export Summary - {formatDate(selectedDate)}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Metric</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedDayData && (
                      <>
                        <TableRow>
                          <TableCell>Staff Available</TableCell>
                          <TableCell className="text-right">{schedulingEmployeeData.filter(e => e.status === 'Available' || e.status === 'Partially Available').length}</TableCell>
                          <TableCell>
                            <Badge className="bg-green-100 text-green-800">Ready to Schedule</Badge>
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Total Capacity</TableCell>
                          <TableCell className="text-right">{selectedDayData.net}h</TableCell>
                          <TableCell>
                            {selectedDayData.net >= selectedDayData.client ? (
                              <Badge className="bg-green-100 text-green-800">Sufficient</Badge>
                            ) : (
                              <Badge className="bg-red-100 text-red-800">Insufficient</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Unassigned Hours</TableCell>
                          <TableCell className="text-right">{selectedDayData.remaining}h</TableCell>
                          <TableCell>
                            {selectedDayData.remaining > 0 ? (
                              <Badge className="bg-blue-100 text-blue-800">Available</Badge>
                            ) : (
                              <Badge className="bg-gray-100 text-gray-800">Fully Utilized</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      </>
                    )}
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