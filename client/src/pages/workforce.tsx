import { useState, useMemo, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, toAbsoluteUrl } from "@/lib/queryClient";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ChevronLeft, ChevronRight, Download, Plus, Search, X, AlertTriangle,
  ChevronDown, Pencil, Trash2, User, BarChart3, RefreshCw, Filter,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { HrCalendar } from "@shared/schema";
import {
  getStatusConfig, MANUAL_STATUSES, LONG_TERM_STATUSES, formatMonthYear,
  getDaysInMonth, isWeekend, isToday, dayLabel, dayWeekday, isAbsence, isLeave,
  normalizeEmployeeKey,
} from "@/utils/hr-utils";

const TODAY_STR = (() => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
})();

function apiUrl(path: string) {
  return toAbsoluteUrl(path);
}

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(apiUrl(url), { credentials: 'include', ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Request failed (${res.status})`);
  }
  return res.json();
}

interface ManualFormState {
  open: boolean;
  mode: 'create' | 'edit';
  id?: string;
  employeeKey: string;
  employeeName: string;
  dates: string[];
  status: string;
  notes: string;
  repeating: boolean;
  bulkKeys: Array<{ key: string; name: string }>;
}

function emptyForm(): ManualFormState {
  return { open: false, mode: 'create', employeeKey: '', employeeName: '', dates: [], status: 'Holiday', notes: '', repeating: false, bulkKeys: [] };
}

export default function WorkforcePage() {
  const { selectedBranchId } = useBranch();
  const { user } = useAuth();
  const { toast } = useToast();

  const canEdit = user?.role === 'admin' || user?.role === 'scheduler';

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [search, setSearch] = useState('');
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(true);
  const [form, setForm] = useState<ManualFormState>(emptyForm());
  const [detailEmployee, setDetailEmployee] = useState<{ key: string; name: string } | null>(null);
  const [historyPage, setHistoryPage] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [openCellId, setOpenCellId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);
  const HISTORY_PAGE_SIZE = 50;

  const calendarKey = ['/api/hr/calendar', selectedBranchId, year, month];

  const { data: records = [], isLoading, refetch } = useQuery<HrCalendar[]>({
    queryKey: calendarKey,
    queryFn: () => apiFetch(`/api/hr/calendar?branchId=${selectedBranchId}&year=${year}&month=${month}`),
    enabled: !!selectedBranchId,
    staleTime: 30_000,
  });

  const { data: historyData } = useQuery<{ records: HrCalendar[]; total: number }>({
    queryKey: ['/api/hr/employee', selectedBranchId, detailEmployee?.key, historyPage],
    queryFn: () => apiFetch(`/api/hr/employee/${encodeURIComponent(detailEmployee!.key)}?branchId=${selectedBranchId}&offset=${historyPage * HISTORY_PAGE_SIZE}&limit=${HISTORY_PAGE_SIZE}`),
    enabled: !!selectedBranchId && !!detailEmployee,
    staleTime: 30_000,
  });
  const historyRecords = historyData?.records ?? [];
  const historyTotal = historyData?.total ?? 0;
  const historyPageCount = Math.ceil(historyTotal / HISTORY_PAGE_SIZE);

  const { data: employeeSummary } = useQuery<{
    ytdManualDays: number;
    sickByMonth: Array<{ year: number; month: number; days: number }>;
    contractedHours: number | null;
    transportMode: string | null;
  }>({
    queryKey: ['/api/hr/employee', selectedBranchId, detailEmployee?.key, 'summary', year, month],
    queryFn: () => apiFetch(`/api/hr/employee/${encodeURIComponent(detailEmployee!.key)}/summary?branchId=${selectedBranchId}&year=${year}&month=${month}`),
    enabled: !!selectedBranchId && !!detailEmployee,
    staleTime: 30_000,
  });

  const days = useMemo(() => getDaysInMonth(year, month), [year, month]);

  const employees = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of records) map.set(r.employeeKey, r.employeeName);
    return Array.from(map.entries()).map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [records]);

  const byKeyDate = useMemo(() => {
    const m = new Map<string, HrCalendar>();
    for (const r of records) m.set(`${r.employeeKey}|${r.date}`, r);
    return m;
  }, [records]);

  const alerts = useMemo(() => {
    const consecutiveSick: Array<{ key: string; name: string; days: number; from: string }> = [];
    const upcomingReturn: Array<{ key: string; name: string; lastDay: string; status: string }> = [];

    for (const emp of employees) {
      let streak = 0;
      let streakFrom = '';
      for (const d of days) {
        const r = byKeyDate.get(`${emp.key}|${d}`);
        const isSick = r && ['Sick', 'Long-term Sick', 'AWOL', 'Partial Sick'].includes(r.status);
        if (isSick) {
          if (streak === 0) streakFrom = d;
          streak++;
        } else {
          if (streak >= 3) consecutiveSick.push({ key: emp.key, name: emp.name, days: streak, from: streakFrom });
          streak = 0;
        }
      }
      if (streak >= 3) consecutiveSick.push({ key: emp.key, name: emp.name, days: streak, from: streakFrom });
    }

    const sevenDaysLater = new Date(TODAY_STR);
    sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
    const upperBound = `${sevenDaysLater.getFullYear()}-${String(sevenDaysLater.getMonth() + 1).padStart(2, '0')}-${String(sevenDaysLater.getDate()).padStart(2, '0')}`;

    for (const emp of employees) {
      const empRecords = records.filter(r => r.employeeKey === emp.key && r.source === 'manual' && (isLeave(r.status) || isAbsence(r.status)));
      if (empRecords.length === 0) continue;
      const sorted = empRecords.sort((a, b) => b.date.localeCompare(a.date));
      const last = sorted[0];
      if (last.date >= TODAY_STR && last.date <= upperBound) {
        upcomingReturn.push({ key: emp.key, name: emp.name, lastDay: last.date, status: last.status });
      }
    }

    return { consecutiveSick, upcomingReturn, total: consecutiveSick.length + upcomingReturn.length };
  }, [employees, days, byKeyDate, records]);

  const longTermMap = useMemo(() => {
    const m = new Set<string>();
    for (const r of records) {
      if (r.source === 'manual' && LONG_TERM_STATUSES.has(r.status)) m.add(r.employeeKey);
    }
    return m;
  }, [records]);

  const filteredEmployees = useMemo(() => {
    let list = employees;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e => e.name.toLowerCase().includes(q));
    }
    if (statusFilters.length > 0) {
      list = list.filter(e => days.some(d => {
        const s = byKeyDate.get(`${e.key}|${d}`)?.status;
        return s !== undefined && statusFilters.includes(s);
      }));
    }
    if (flaggedOnly) {
      const flagged = new Set([
        ...alerts.consecutiveSick.map(a => a.key),
        ...alerts.upcomingReturn.map(a => a.key),
      ]);
      list = list.filter(e => flagged.has(e.key));
    }
    return list;
  }, [employees, search, statusFilters, flaggedOnly, days, byKeyDate, alerts]);

  const allStatuses = useMemo(() => {
    const s = new Set<string>();
    for (const r of records) s.add(r.status);
    return Array.from(s).sort();
  }, [records]);

  // Detail panel metrics are sourced from the server-side summary (full history, not paginated)
  const sickHistoryData = useMemo(() => {
    if (!employeeSummary) return [];
    return employeeSummary.sickByMonth.map(s => {
      const d = new Date(Date.UTC(s.year, s.month - 1, 1));
      return {
        month: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
        days: s.days,
      };
    });
  }, [employeeSummary]);

  const ytdManualDays = employeeSummary?.ytdManualDays ?? 0;

  const latestProcessedDetails = employeeSummary
    ? { contractedHours: employeeSummary.contractedHours, transportMode: employeeSummary.transportMode }
    : null;

  const createMutation = useMutation({
    mutationFn: (body: object) => apiFetch('/api/hr/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: calendarKey }); toast({ title: 'Leave entry saved' }); setForm(emptyForm()); setDateFrom(''); setDateTo(''); },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Failed to save', description: e.message }),
  });

  const bulkMutation = useMutation({
    mutationFn: (body: object) => apiFetch('/api/hr/manual/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    onSuccess: (d: { created: number }) => { queryClient.invalidateQueries({ queryKey: calendarKey }); toast({ title: `${d.created} entries saved` }); setForm(emptyForm()); setDateFrom(''); setDateTo(''); },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Failed to save', description: e.message }),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: string; status?: string; notes?: string }) => apiFetch(`/api/hr/manual/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, branchId: selectedBranchId }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: calendarKey }); toast({ title: 'Entry updated' }); setForm(emptyForm()); },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Failed to update', description: e.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/hr/manual/${id}?branchId=${encodeURIComponent(selectedBranchId ?? '')}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: calendarKey }); toast({ title: 'Entry deleted' }); setDeleteTarget(null); setOpenCellId(null); },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Failed to delete', description: e.message }),
  });

  function goToPrevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1);
  }
  function goToNextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1);
  }

  function openCreate(emp?: { key: string; name: string }) {
    setForm({ ...emptyForm(), open: true, mode: 'create', employeeKey: emp?.key ?? '', employeeName: emp?.name ?? '' });
    setDateFrom('');
    setDateTo('');
  }

  function openEdit(rec: HrCalendar) {
    setOpenCellId(null);
    setForm({ open: true, mode: 'edit', id: rec.id, employeeKey: rec.employeeKey, employeeName: rec.employeeName, dates: [rec.date], status: rec.status, notes: rec.notes ?? '', repeating: false, bulkKeys: [] });
    setDateFrom(rec.date);
    setDateTo(rec.date);
  }

  function buildDateRange(): string[] {
    if (!dateFrom) return [];
    const from = new Date(dateFrom + 'T00:00:00Z');
    const to = dateTo ? new Date(dateTo + 'T00:00:00Z') : from;
    const result: string[] = [];
    const cursor = new Date(from);
    const startDow = from.getUTCDay(); // 0=Sun … 6=Sat
    while (cursor <= to) {
      if (!form.repeating || cursor.getUTCDay() === startDow) {
        result.push(cursor.toISOString().split('T')[0]);
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return result;
  }

  function submitForm() {
    const dates = buildDateRange();
    if (!dates.length) { toast({ variant: 'destructive', title: 'Select at least one date' }); return; }
    if (!form.status) { toast({ variant: 'destructive', title: 'Select a status' }); return; }

    if (form.mode === 'edit' && form.id) {
      editMutation.mutate({ id: form.id, status: form.status, notes: form.notes || undefined });
      return;
    }

    if (form.bulkKeys.length > 0) {
      bulkMutation.mutate({
        branchId: selectedBranchId,
        employeeKeys: form.bulkKeys.map(e => ({ employeeKey: e.key, employeeName: e.name })),
        dates,
        status: form.status,
        notes: form.notes || undefined,
      });
      return;
    }

    if (!form.employeeKey) { toast({ variant: 'destructive', title: 'Select an employee' }); return; }

    if (dates.length === 1) {
      createMutation.mutate({ branchId: selectedBranchId, employeeKey: form.employeeKey, employeeName: form.employeeName, date: dates[0], status: form.status, notes: form.notes || undefined });
    } else {
      bulkMutation.mutate({
        branchId: selectedBranchId,
        employeeKeys: [{ employeeKey: form.employeeKey, employeeName: form.employeeName }],
        dates,
        status: form.status,
        notes: form.notes || undefined,
      });
    }
  }

  function scrollToEmployee(key: string) {
    const row = gridRef.current?.querySelector(`[data-empkey="${key}"]`);
    row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function handleExport() {
    window.open(apiUrl(`/api/hr/export?branchId=${selectedBranchId}&year=${year}&month=${month}`), '_blank');
  }

  return (
    <div className="h-full w-full flex flex-col bg-background overflow-hidden">
      {/* ── Header ── */}
      <div className="shrink-0 px-6 pt-5 pb-3 border-b border-border bg-gradient-to-r from-violet-50/50 to-indigo-50/50 dark:from-violet-950/20 dark:to-indigo-950/20">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-700 to-indigo-600 bg-clip-text text-transparent">Workforce</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Employee availability calendar & absence management</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
              <Download className="w-3.5 h-3.5" /> Export
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>
            {canEdit && (
              <Button size="sm" onClick={() => openCreate()} className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white">
                <Plus className="w-3.5 h-3.5" /> Add Leave Entry
              </Button>
            )}
          </div>
        </div>

        {/* Month nav */}
        <div className="flex items-center gap-3 mt-3">
          <button onClick={goToPrevMonth} className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-lg font-semibold min-w-[180px] text-center">{formatMonthYear(year, month)}</span>
          <button onClick={goToNextMonth} className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
          <button onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth() + 1); }}
            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border hover:bg-muted transition-colors ml-1">
            Today
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-6">

        {/* ── Alerts ── */}
        {alerts.total > 0 && (
          <Collapsible open={alertsOpen} onOpenChange={setAlertsOpen} className="mt-3">
            <CollapsibleTrigger asChild>
              <button className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 text-sm font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors">
                <span className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  {alerts.total} alert{alerts.total !== 1 ? 's' : ''} this month
                </span>
                <ChevronDown className={`w-4 h-4 transition-transform ${alertsOpen ? 'rotate-180' : ''}`} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1 rounded-lg border border-amber-200 dark:border-amber-800 overflow-hidden">
              {alerts.consecutiveSick.map(a => (
                <button key={`sick-${a.key}`} onClick={() => scrollToEmployee(a.key)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors border-b border-amber-100 dark:border-amber-900 last:border-b-0">
                  <div className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                  <span className="font-medium">{a.name}</span>
                  <span className="text-muted-foreground">— {a.days} consecutive sick days from {a.from}</span>
                </button>
              ))}
              {alerts.upcomingReturn.map(a => (
                <button key={`ret-${a.key}`} onClick={() => scrollToEmployee(a.key)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors border-b border-amber-100 dark:border-amber-900 last:border-b-0">
                  <div className="w-2 h-2 rounded-full bg-sky-500 shrink-0" />
                  <span className="font-medium">{a.name}</span>
                  <span className="text-muted-foreground">— returning from {a.status} on {a.lastDay}</span>
                </button>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* ── Filter bar ── */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employees…" className="pl-8 h-8 w-52 text-sm" />
            {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>}
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-sm font-normal">
                <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                {statusFilters.length === 0 ? 'All statuses' : `${statusFilters.length} status${statusFilters.length > 1 ? 'es' : ''}`}
                {statusFilters.length > 0 && (
                  <button onClick={e => { e.stopPropagation(); setStatusFilters([]); }} className="ml-0.5 text-muted-foreground hover:text-foreground">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-52 p-2" align="start">
              <p className="text-xs font-medium text-muted-foreground px-1 mb-1.5">Filter by status</p>
              {allStatuses.map(s => {
                const checked = statusFilters.includes(s);
                const cfg = getStatusConfig(s);
                return (
                  <button key={s} onClick={() => setStatusFilters(prev => checked ? prev.filter(x => x !== s) : [...prev, s])}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors text-left ${checked ? 'bg-violet-100 dark:bg-violet-900/40' : 'hover:bg-muted'}`}>
                    <div className={`w-2.5 h-2.5 rounded-sm shrink-0 ${cfg.bgClass}`} />
                    <span className="flex-1">{s}</span>
                    {checked && <span className="text-violet-600 dark:text-violet-400 text-[10px] font-bold">✓</span>}
                  </button>
                );
              })}
              {allStatuses.length === 0 && <p className="text-xs text-muted-foreground px-1 py-2">No data this month</p>}
            </PopoverContent>
          </Popover>
          {alerts.total > 0 && (
            <button
              onClick={() => setFlaggedOnly(f => !f)}
              className={`h-8 px-3 text-sm rounded-md border transition-colors flex items-center gap-1.5 ${flaggedOnly ? 'bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-900/40 dark:border-amber-700 dark:text-amber-300' : 'border-border hover:bg-muted'}`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Flagged only {flaggedOnly && <X className="w-3 h-3" />}
            </button>
          )}
          <span className="text-xs text-muted-foreground ml-auto">{filteredEmployees.length} of {employees.length} employees</span>
        </div>

        {/* ── Legend ── */}
        <div className="flex flex-wrap gap-2 mt-2">
          {[['Available','bg-green-500'],['Sick','bg-amber-500'],['Holiday','bg-sky-500'],['Maternity/Paternity','bg-purple-500'],['AWOL','bg-red-600'],['Partial Availability','bg-yellow-400'],['Long-term Sick','bg-orange-600'],['Other Unavailable','bg-slate-400']].map(([label, bg]) => (
            <div key={label} className="flex items-center gap-1 text-xs text-muted-foreground">
              <div className={`w-2.5 h-2.5 rounded-sm ${bg}`} />
              {label}
            </div>
          ))}
        </div>

        {/* ── Calendar Grid ── */}
        {isLoading ? (
          <div className="flex items-center justify-center h-48 mt-4">
            <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : !selectedBranchId ? (
          <div className="flex items-center justify-center h-48 mt-4 text-muted-foreground text-sm">Select a branch to view the workforce calendar</div>
        ) : filteredEmployees.length === 0 ? (
          <div className="flex items-center justify-center h-48 mt-4 text-muted-foreground text-sm">
            {records.length === 0 ? 'No data for this month — process a week of data to populate' : 'No employees match your filters'}
          </div>
        ) : (
          <div ref={gridRef} className="mt-3 rounded-lg border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="border-collapse w-full" style={{ tableLayout: 'fixed', minWidth: `${200 + days.length * 36}px` }}>
                <thead>
                  <tr className="bg-muted/60 dark:bg-muted/30">
                    <th className="sticky left-0 z-20 bg-muted/60 dark:bg-gray-800 px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground border-b border-r border-border" style={{ width: '220px', minWidth: '200px' }}>
                      Employee
                    </th>
                    {days.map(d => {
                      const weekend = isWeekend(d);
                      const today = isToday(d);
                      return (
                        <th key={d} style={{ width: '36px', minWidth: '36px' }}
                          className={`px-0 py-1 text-center text-[10px] font-medium border-b border-border ${weekend ? 'bg-muted/80 dark:bg-gray-900/60 text-muted-foreground/50' : 'text-muted-foreground'} ${today ? 'border-b-2 border-b-violet-500' : ''}`}>
                          <div>{dayLabel(d)}</div>
                          <div className="text-[9px] opacity-60">{dayWeekday(d)}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.map((emp, rowIdx) => {
                    const isLongTerm = longTermMap.has(emp.key);
                    return (
                      <tr key={emp.key} data-empkey={emp.key}
                        className={`${rowIdx % 2 === 0 ? 'bg-background' : 'bg-muted/20 dark:bg-muted/10'} hover:bg-violet-50/30 dark:hover:bg-violet-900/10 transition-colors`}>
                        <td className="sticky left-0 z-10 bg-inherit px-3 py-1.5 border-b border-r border-border" style={{ width: '220px', minWidth: '200px' }}>
                          <button onClick={() => { setDetailEmployee(emp); setHistoryPage(0); }} className="flex items-center gap-1.5 text-left w-full group">
                            <span className="text-xs font-medium truncate group-hover:text-violet-700 dark:group-hover:text-violet-400 transition-colors max-w-[165px]">
                              {emp.name}
                            </span>
                            {isLongTerm && (
                              <span className="shrink-0 text-[9px] font-bold px-1 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300">
                                {records.find(r => r.employeeKey === emp.key && LONG_TERM_STATUSES.has(r.status))?.status === 'Maternity/Paternity' ? 'MAT' : 'LTS'}
                              </span>
                            )}
                          </button>
                        </td>
                        {days.map(d => {
                          const rec = byKeyDate.get(`${emp.key}|${d}`);
                          const weekend = isWeekend(d);
                          const today = isToday(d);
                          const cellId = `${emp.key}|${d}`;
                          const cfg = rec ? getStatusConfig(rec.status) : null;

                          return (
                            <td key={d} style={{ width: '36px', padding: '2px' }}
                              className={`border-b border-border text-center ${weekend ? 'bg-muted/40 dark:bg-gray-900/30' : ''} ${today ? 'ring-1 ring-inset ring-violet-400' : ''}`}>
                              {rec && cfg ? (
                                <Popover open={openCellId === cellId} onOpenChange={open => setOpenCellId(open ? cellId : null)}>
                                  <PopoverTrigger asChild>
                                    <button
                                      className={`w-7 h-6 rounded text-[9px] font-bold truncate leading-none flex items-center justify-center relative transition-opacity hover:opacity-80 ${cfg.bgClass} ${cfg.textClass}`}
                                      title={rec.status}
                                    >
                                      {cfg.label.slice(0, 4)}
                                      {rec.source === 'manual' && (
                                        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-white border border-gray-400" />
                                      )}
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent side="top" className="w-64 p-3">
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between">
                                        <span className="text-sm font-semibold">{emp.name}</span>
                                        <Badge variant="outline" className="text-[10px]">{d}</Badge>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <div className={`px-2 py-0.5 rounded text-xs font-medium ${cfg.bgClass} ${cfg.textClass}`}>{rec.status}</div>
                                        <Badge variant={rec.source === 'manual' ? 'secondary' : 'outline'} className="text-[10px]">
                                          {rec.source === 'manual' ? '✏ Manual' : '⚙ Auto'}
                                        </Badge>
                                      </div>
                                      {rec.notes && <p className="text-xs text-muted-foreground italic">"{rec.notes}"</p>}
                                      <p className="text-xs text-muted-foreground">{cfg.description}</p>
                                      {rec.contractedHours != null && (
                                        <p className="text-xs text-muted-foreground">Contracted: {rec.contractedHours}h</p>
                                      )}
                                      {canEdit && (
                                        <div className="flex gap-1.5 pt-1 border-t border-border">
                                          {rec.source === 'manual' ? (
                                            <>
                                              <Button size="sm" variant="outline" className="h-7 text-xs flex-1 gap-1" onClick={() => openEdit(rec)}>
                                                <Pencil className="w-3 h-3" /> Edit
                                              </Button>
                                              <Button size="sm" variant="outline" className="h-7 text-xs text-red-600 hover:text-red-700 gap-1" onClick={() => setDeleteTarget({ id: rec.id, label: `${emp.name} — ${d}` })}>
                                                <Trash2 className="w-3 h-3" />
                                              </Button>
                                            </>
                                          ) : (
                                            <Button size="sm" variant="outline" className="h-7 text-xs w-full gap-1" onClick={() => { setOpenCellId(null); openCreate(emp); setDateFrom(d); setDateTo(d); }}>
                                              <Pencil className="w-3 h-3" /> Override as manual
                                            </Button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </PopoverContent>
                                </Popover>
                              ) : (
                                canEdit ? (
                                  <button onClick={() => { openCreate(emp); setDateFrom(d); setDateTo(d); }}
                                    className="w-7 h-6 rounded border border-border/40 hover:bg-muted/60 transition-all" />
                                ) : (
                                  <div className="w-7 h-6" />
                                )
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Manual Entry Sheet ── */}
      <Sheet open={form.open} onOpenChange={open => { if (!open) { setForm(emptyForm()); setDateFrom(''); setDateTo(''); } }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{form.mode === 'edit' ? 'Edit Leave Entry' : 'Add Leave Entry'}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            {form.mode === 'create' && (
              <>
                <div className="space-y-1.5">
                  <Label>Employee</Label>
                  <Select value={form.employeeKey}
                    onValueChange={v => {
                      const emp = employees.find(e => e.key === v);
                      setForm(f => ({ ...f, employeeKey: v, employeeName: emp?.name ?? '', bulkKeys: [] }));
                    }}>
                    <SelectTrigger><SelectValue placeholder="Select employee…" /></SelectTrigger>
                    <SelectContent className="max-h-52">
                      {employees.map(e => <SelectItem key={e.key} value={e.key}>{e.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Bulk — apply to multiple employees</Label>
                  <div className="max-h-40 overflow-y-auto border border-border rounded-md divide-y divide-border">
                    {employees.map(e => {
                      const selected = form.bulkKeys.some(b => b.key === e.key);
                      return (
                        <button key={e.key}
                          className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${selected ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-300' : 'hover:bg-muted'}`}
                          onClick={() => setForm(f => ({
                            ...f,
                            bulkKeys: selected ? f.bulkKeys.filter(b => b.key !== e.key) : [...f.bulkKeys, { key: e.key, name: e.name }],
                            employeeKey: selected ? f.employeeKey : '',
                          }))}>
                          {selected ? '✓ ' : ''}{e.name}
                        </button>
                      );
                    })}
                  </div>
                  {form.bulkKeys.length > 0 && (
                    <p className="text-xs text-violet-600 dark:text-violet-400">{form.bulkKeys.length} employees selected</p>
                  )}
                </div>
              </>
            )}
            {form.mode === 'edit' && (
              <div className="space-y-1.5">
                <Label>Employee</Label>
                <p className="text-sm font-medium py-1">{form.employeeName}</p>
              </div>
            )}
            {form.mode === 'create' ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="date-from">From</Label>
                    <Input id="date-from" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="date-to">To</Label>
                    <Input id="date-to" type="date" value={dateTo} min={dateFrom} onChange={e => setDateTo(e.target.value)} className="h-9" />
                  </div>
                </div>
                {dateFrom && (
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
                      <input type="checkbox" checked={form.repeating} onChange={e => setForm(f => ({ ...f, repeating: e.target.checked }))}
                        className="w-4 h-4 accent-violet-600 rounded" />
                      Repeat weekly
                    </label>
                    {dateFrom && (
                      <p className="text-xs text-muted-foreground">
                        {buildDateRange().length} day{buildDateRange().length !== 1 ? 's' : ''} selected
                        {form.repeating && dateTo && dateTo > dateFrom ? ' (weekly)' : ''}
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-1.5">
                <Label>Date</Label>
                <p className="text-sm text-muted-foreground py-1 border border-border rounded-md px-3 bg-muted/30">
                  {dateFrom || '—'}
                  <span className="ml-2 text-xs text-muted-foreground/60">(read-only — delete & recreate to change date)</span>
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-56">
                  {MANUAL_STATUSES.map(s => {
                    const cfg = getStatusConfig(s);
                    return (
                      <SelectItem key={s} value={s}>
                        <div className="flex items-center gap-2">
                          <div className={`w-2.5 h-2.5 rounded-sm shrink-0 ${cfg.bgClass}`} />
                          {s}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes-input">Notes (optional)</Label>
              <Textarea id="notes-input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. Expected return date, doctor's note received…" className="resize-none h-20 text-sm" />
            </div>
            <div className="flex gap-2 pt-2">
              <Button className="flex-1 bg-violet-600 hover:bg-violet-700 text-white"
                disabled={createMutation.isPending || bulkMutation.isPending || editMutation.isPending}
                onClick={submitForm}>
                {(createMutation.isPending || bulkMutation.isPending || editMutation.isPending) ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Save'}
              </Button>
              <Button variant="outline" onClick={() => { setForm(emptyForm()); setDateFrom(''); setDateTo(''); }}>Cancel</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Employee Detail Panel ── */}
      <Sheet open={!!detailEmployee} onOpenChange={open => { if (!open) { setDetailEmployee(null); setHistoryPage(0); } }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <User className="w-5 h-5 text-violet-600" />
              {detailEmployee?.name}
            </SheetTitle>
          </SheetHeader>
          {detailEmployee && (
            <div className="space-y-5 mt-5">
              <div className="grid grid-cols-2 gap-3">
                <Card className="bg-violet-50 dark:bg-violet-950/30 border-0">
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">YTD Manual Days</p>
                    <p className="text-2xl font-bold text-violet-700 dark:text-violet-400">{ytdManualDays}</p>
                  </CardContent>
                </Card>
                <Card className="bg-amber-50 dark:bg-amber-950/30 border-0">
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">Sick Days (this month)</p>
                    <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">
                      {sickHistoryData[sickHistoryData.length - 1]?.days ?? 0}
                    </p>
                  </CardContent>
                </Card>
                {latestProcessedDetails?.contractedHours != null && (
                  <Card className="bg-blue-50 dark:bg-blue-950/30 border-0">
                    <CardContent className="p-3">
                      <p className="text-xs text-muted-foreground">Contracted Hours/Day</p>
                      <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{latestProcessedDetails.contractedHours}h</p>
                    </CardContent>
                  </Card>
                )}
                {latestProcessedDetails?.transportMode && (
                  <Card className="bg-slate-50 dark:bg-slate-800/30 border-0">
                    <CardContent className="p-3">
                      <p className="text-xs text-muted-foreground">Transport Mode</p>
                      <p className="text-base font-bold text-slate-700 dark:text-slate-300 mt-1 capitalize">{latestProcessedDetails.transportMode}</p>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* 6-month sick chart */}
              <div>
                <p className="text-sm font-semibold mb-2 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-muted-foreground" /> Sick Days (6 months)</p>
                <ResponsiveContainer width="100%" height={100}>
                  <BarChart data={sickHistoryData} barSize={18}>
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip formatter={(v: number) => [v, 'Sick days']} />
                    <Bar dataKey="days" radius={[3, 3, 0, 0]}>
                      {sickHistoryData.map((_, i) => <Cell key={i} fill={i === sickHistoryData.length - 1 ? '#f59e0b' : '#fde68a'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* History list */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold">Leave & Absence History</p>
                  {historyTotal > 0 && (
                    <span className="text-xs text-muted-foreground">{historyTotal} total</span>
                  )}
                </div>
                <div className="rounded-lg border border-border overflow-hidden">
                  {historyRecords.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-6">No records found</p>
                  ) : (
                    historyRecords.map(r => {
                      const cfg = getStatusConfig(r.status);
                      return (
                        <div key={r.id} className="flex items-center gap-3 px-3 py-2 border-b border-border last:border-b-0 text-xs">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${cfg.bgClass}`} />
                          <span className="text-muted-foreground w-24 shrink-0">{r.date}</span>
                          <span className="font-medium flex-1">{r.status}</span>
                          <Badge variant="outline" className="text-[9px] shrink-0">{r.source === 'manual' ? '✏' : '⚙'}</Badge>
                          {r.notes && <span className="text-muted-foreground italic truncate max-w-[100px]">{r.notes}</span>}
                        </div>
                      );
                    })
                  )}
                </div>
                {historyPageCount > 1 && (
                  <div className="flex items-center justify-between mt-2">
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                      disabled={historyPage === 0}
                      onClick={() => setHistoryPage(p => p - 1)}>
                      <ChevronLeft className="w-3 h-3" /> Prev
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Page {historyPage + 1} of {historyPageCount}
                    </span>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                      disabled={historyPage >= historyPageCount - 1}
                      onClick={() => setHistoryPage(p => p + 1)}>
                      Next <ChevronRight className="w-3 h-3" />
                    </Button>
                  </div>
                )}
              </div>

              {canEdit && (
                <Button className="w-full gap-2 bg-violet-600 hover:bg-violet-700 text-white" onClick={() => { setDetailEmployee(null); openCreate(detailEmployee); }}>
                  <Plus className="w-4 h-4" /> Add Leave Entry
                </Button>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Delete Confirm ── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove the manual leave entry for <strong>{deleteTarget?.label}</strong>. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700 text-white" onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
