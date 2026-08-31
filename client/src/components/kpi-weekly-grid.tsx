import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, toAbsoluteUrl } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2, Plus, Save } from "lucide-react";

// ── Types (mirrors shared/schema.ts kpiWeeklyEntries + server/routes/kpi-weekly.ts) ─

interface KpiWeeklyEntry {
  id: string;
  weekBeginning: string;
  weekNumber: number;
  qtrNumber: number;
  groupName: string;
  store: string;
  daysInMonth: number;
  monthlyRevenue: number;
  monthlyRevenueTarget: number;
  enquiries: number;
  enquiriesTarget: number;
  newClients: number;
  applications: number;
  newHiresHeads: number;
  newHiresHours: number;
  guaranteedHourWastageLastWeek: number;
  guaranteedHourWastageWeekAhead: number;
  absenceHoursLastWeek: number;
  hospitalisationsHeads: number;
  hospitalisationsHours: number;
  clientHoursAtRisk: number | null;
}

interface KpiWeekSummary {
  weekBeginning: string;
  weekNumber: number;
  qtrNumber: number;
  daysInMonth: number;
}

// Numeric fields a store row can hold — every field except identity/meta ones.
type EditableField = Exclude<keyof KpiWeeklyEntry, "id" | "weekBeginning" | "weekNumber" | "qtrNumber" | "groupName" | "store">;

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 });
const pct = (n: number) => (Number.isFinite(n) ? `${(n * 100).toFixed(0)}%` : "—");

// Vivid owner colour bands mirroring the original Excel workbook's column
// header colours — each owner's cluster of metrics gets a matching header
// band and a soft tint across the column body so the grid reads at a glance.
const OWNER_COLORS: Record<string, { header: string; col: string; colHeader: string; accent: string }> = {
  Daniel: {
    header: "bg-blue-600 text-white",
    colHeader: "bg-blue-100/80 text-blue-900 dark:bg-blue-950/50 dark:text-blue-200 border-blue-200 dark:border-blue-900",
    col: "bg-blue-50/60 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900/60",
    accent: "text-blue-700 dark:text-blue-300",
  },
  Sandra: {
    header: "bg-emerald-600 text-white",
    colHeader: "bg-emerald-100/80 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200 border-emerald-200 dark:border-emerald-900",
    col: "bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/60",
    accent: "text-emerald-700 dark:text-emerald-300",
  },
  Craig: {
    header: "bg-red-600 text-white",
    colHeader: "bg-red-100/80 text-red-900 dark:bg-red-950/50 dark:text-red-200 border-red-200 dark:border-red-900",
    col: "bg-red-50/60 dark:bg-red-950/20 border-red-100 dark:border-red-900/60",
    accent: "text-red-700 dark:text-red-300",
  },
  Sean: {
    header: "bg-amber-500 text-white",
    colHeader: "bg-amber-100/80 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200 border-amber-200 dark:border-amber-900",
    col: "bg-amber-50/60 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/60",
    accent: "text-amber-700 dark:text-amber-300",
  },
  Willie: {
    header: "bg-purple-600 text-white",
    colHeader: "bg-purple-100/80 text-purple-900 dark:bg-purple-950/50 dark:text-purple-200 border-purple-200 dark:border-purple-900",
    col: "bg-purple-50/60 dark:bg-purple-950/20 border-purple-100 dark:border-purple-900/60",
    accent: "text-purple-700 dark:text-purple-300",
  },
};

// Column groups mirror the "owner" header row in the source workbook (Daniel /
// Sandra / Craig / Sean / Willie each accountable for one cluster of metrics).
const COLUMN_GROUPS: {
  owner: string;
  columns: { field: EditableField | "dayRate" | "enquiryConversion" | "hireConversion"; label: string; kind: "currency" | "number" | "hours" | "percent"; computed?: boolean }[];
}[] = [
  {
    owner: "Daniel",
    columns: [
      { field: "monthlyRevenue", label: "Monthly Revenue", kind: "currency" },
      { field: "monthlyRevenueTarget", label: "Revenue Target", kind: "currency" },
      { field: "daysInMonth", label: "Days in Month", kind: "number" },
      { field: "dayRate", label: "Day Rate", kind: "currency", computed: true },
    ],
  },
  {
    owner: "Sandra",
    columns: [
      { field: "enquiries", label: "Enquiries", kind: "number" },
      { field: "enquiriesTarget", label: "Target", kind: "number" },
      { field: "newClients", label: "New Clients", kind: "number" },
      { field: "enquiryConversion", label: "Conversion Rate", kind: "percent", computed: true },
    ],
  },
  {
    owner: "Craig",
    columns: [
      { field: "applications", label: "Applications", kind: "number" },
      { field: "newHiresHeads", label: "New Hires (Heads)", kind: "number" },
      { field: "newHiresHours", label: "New Hires (Hours)", kind: "hours" },
      { field: "hireConversion", label: "Conversion Rate", kind: "percent", computed: true },
    ],
  },
  {
    owner: "Sean",
    columns: [
      { field: "guaranteedHourWastageLastWeek", label: "GH Wastage (Last Week)", kind: "hours" },
      { field: "guaranteedHourWastageWeekAhead", label: "GH Wastage (Week Ahead)", kind: "hours" },
      { field: "absenceHoursLastWeek", label: "Absence Hours (Last Week)", kind: "hours" },
    ],
  },
  {
    owner: "Willie",
    columns: [
      { field: "hospitalisationsHeads", label: "Hospitalisations (Heads)", kind: "number" },
      { field: "hospitalisationsHours", label: "Hospitalisations Hours", kind: "hours" },
      { field: "clientHoursAtRisk", label: "Client Hours at Risk", kind: "hours" },
    ],
  },
];

const FLAT_COLUMNS = COLUMN_GROUPS.flatMap(g => g.columns.map(col => ({ ...col, owner: g.owner })));

function dayRateOf(row: { monthlyRevenue: number; daysInMonth: number }): number {
  return row.daysInMonth > 0 ? row.monthlyRevenue / row.daysInMonth : 0;
}
function enquiryConversionOf(row: { newClients: number; enquiries: number }): number {
  return row.enquiries > 0 ? row.newClients / row.enquiries : 0;
}
function hireConversionOf(row: { newHiresHeads: number; applications: number }): number {
  return row.applications > 0 ? row.newHiresHeads / row.applications : 0;
}

function emptyRow(store: string): KpiWeeklyEntry {
  return {
    id: `new-${store}`,
    weekBeginning: "",
    weekNumber: 0,
    qtrNumber: 0,
    groupName: "SUR Group",
    store,
    daysInMonth: 0,
    monthlyRevenue: 0,
    monthlyRevenueTarget: 0,
    enquiries: 0,
    enquiriesTarget: 0,
    newClients: 0,
    applications: 0,
    newHiresHeads: 0,
    newHiresHours: 0,
    guaranteedHourWastageLastWeek: 0,
    guaranteedHourWastageWeekAhead: 0,
    absenceHoursLastWeek: 0,
    hospitalisationsHeads: 0,
    hospitalisationsHours: 0,
    clientHoursAtRisk: null,
  };
}

function formatWeekLabel(w: KpiWeekSummary): string {
  const d = new Date(w.weekBeginning + "T00:00:00Z");
  const dateStr = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  return `Wk ${w.weekNumber} (Qtr ${w.qtrNumber}) — ${dateStr}`;
}

export function KpiWeeklyGrid() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, KpiWeeklyEntry>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [newWeek, setNewWeek] = useState({ weekBeginning: "", weekNumber: "", qtrNumber: "", daysInMonth: "" });

  const storesQuery = useQuery<string[]>({
    queryKey: ["/api/kpi-weekly/stores"],
    queryFn: async () => {
      const res = await fetch(toAbsoluteUrl("/api/kpi-weekly/stores"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load store list");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });
  const stores = storesQuery.data ?? [];

  const weeksQuery = useQuery<KpiWeekSummary[]>({
    queryKey: ["/api/kpi-weekly/weeks"],
    queryFn: async () => {
      const res = await fetch(toAbsoluteUrl("/api/kpi-weekly/weeks"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load week list");
      return res.json();
    },
    staleTime: 30_000,
  });
  const weeks = weeksQuery.data ?? [];

  // Default to the week whose start date is closest to (and not after) today,
  // so the tab opens on "now" rather than the furthest-future placeholder week.
  useEffect(() => {
    if (selectedWeek || weeks.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const past = weeks.filter(w => w.weekBeginning <= today);
    const best = past.length > 0 ? past[0] : weeks[weeks.length - 1];
    setSelectedWeek(best.weekBeginning);
  }, [weeks, selectedWeek]);

  const currentWeekMeta = weeks.find(w => w.weekBeginning === selectedWeek) ?? null;

  const entriesQuery = useQuery<KpiWeeklyEntry[]>({
    queryKey: ["/api/kpi-weekly", selectedWeek],
    queryFn: async () => {
      const res = await fetch(toAbsoluteUrl(`/api/kpi-weekly/${selectedWeek}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load week data");
      return res.json();
    },
    enabled: !!selectedWeek,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!entriesQuery.data) return;
    const byStore: Record<string, KpiWeeklyEntry> = {};
    for (const store of stores) {
      const found = entriesQuery.data.find(e => e.store === store);
      byStore[store] = found ?? emptyRow(store);
    }
    setRows(byStore);
  }, [entriesQuery.data, stores]);

  const totalRow = useMemo(() => {
    const values = Object.values(rows);
    if (values.length === 0) return null;
    const sum = (f: EditableField) => values.reduce((acc, r) => acc + (typeof r[f] === "number" ? (r[f] as number) : 0), 0);
    const daysInMonth = currentWeekMeta?.daysInMonth ?? values[0]?.daysInMonth ?? 0;
    const monthlyRevenue = sum("monthlyRevenue");
    const monthlyRevenueTarget = sum("monthlyRevenueTarget");
    const enquiries = sum("enquiries");
    const enquiriesTarget = sum("enquiriesTarget");
    const newClients = sum("newClients");
    const applications = sum("applications");
    const newHiresHeads = sum("newHiresHeads");
    const newHiresHours = sum("newHiresHours");
    return {
      monthlyRevenue, monthlyRevenueTarget, daysInMonth,
      dayRate: dayRateOf({ monthlyRevenue, daysInMonth }),
      enquiries, enquiriesTarget, newClients,
      enquiryConversion: enquiryConversionOf({ newClients, enquiries }),
      applications, newHiresHeads, newHiresHours,
      hireConversion: hireConversionOf({ newHiresHeads, applications }),
      guaranteedHourWastageLastWeek: sum("guaranteedHourWastageLastWeek"),
      guaranteedHourWastageWeekAhead: sum("guaranteedHourWastageWeekAhead"),
      absenceHoursLastWeek: sum("absenceHoursLastWeek"),
      hospitalisationsHeads: sum("hospitalisationsHeads"),
      hospitalisationsHours: sum("hospitalisationsHours"),
      clientHoursAtRisk: sum("clientHoursAtRisk" as EditableField),
    };
  }, [rows, currentWeekMeta]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedWeek || !currentWeekMeta) throw new Error("No week selected");
      const payload = {
        weekNumber: currentWeekMeta.weekNumber,
        qtrNumber: currentWeekMeta.qtrNumber,
        daysInMonth: currentWeekMeta.daysInMonth,
        groupName: "SUR Group",
        rows: stores.map(store => {
          const r = rows[store] ?? emptyRow(store);
          const { id, weekBeginning, weekNumber, qtrNumber, groupName, ...rest } = r;
          return rest;
        }),
      };
      const res = await apiRequest("PUT", `/api/kpi-weekly/${selectedWeek}`, payload);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Week saved", description: `${currentWeekMeta ? formatWeekLabel(currentWeekMeta) : "Week"} updated.` });
      queryClient.invalidateQueries({ queryKey: ["/api/kpi-weekly", selectedWeek] });
      queryClient.invalidateQueries({ queryKey: ["/api/kpi-weekly/weeks"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save week", description: error.message, variant: "destructive" });
    },
  });

  const addWeekMutation = useMutation({
    mutationFn: async () => {
      const weekBeginning = newWeek.weekBeginning;
      const weekNumber = parseInt(newWeek.weekNumber, 10);
      const qtrNumber = parseInt(newWeek.qtrNumber, 10);
      const daysInMonth = parseInt(newWeek.daysInMonth, 10) || 0;
      if (!weekBeginning || !weekNumber || !qtrNumber) throw new Error("Week beginning, week number and quarter are required");
      const payload = {
        weekNumber, qtrNumber, daysInMonth, groupName: "SUR Group",
        rows: stores.map(store => {
          const { id, weekBeginning: _wb, weekNumber: _wn, qtrNumber: _qn, groupName: _gn, ...rest } = emptyRow(store);
          return { ...rest, daysInMonth };
        }),
      };
      const res = await apiRequest("PUT", `/api/kpi-weekly/${weekBeginning}`, payload);
      await res.json();
      return weekBeginning;
    },
    onSuccess: (weekBeginning) => {
      toast({ title: "Week added" });
      setAddOpen(false);
      setNewWeek({ weekBeginning: "", weekNumber: "", qtrNumber: "", daysInMonth: "" });
      queryClient.invalidateQueries({ queryKey: ["/api/kpi-weekly/weeks"] }).then(() => setSelectedWeek(weekBeginning));
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add week", description: error.message, variant: "destructive" });
    },
  });

  function updateCell(store: string, field: EditableField, raw: string) {
    setRows(prev => {
      const current = prev[store] ?? emptyRow(store);
      const value = raw === "" ? 0 : Number(raw);
      return { ...prev, [store]: { ...current, [field]: Number.isFinite(value) ? value : current[field] } };
    });
  }

  function formatValue(kind: "currency" | "number" | "hours" | "percent", value: number): string {
    if (kind === "currency") return gbp.format(value);
    if (kind === "percent") return pct(value);
    if (kind === "hours") return value.toLocaleString("en-GB", { maximumFractionDigits: 1 });
    return value.toLocaleString("en-GB");
  }

  const isLoading = storesQuery.isLoading || weeksQuery.isLoading || (!!selectedWeek && entriesQuery.isLoading);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Select value={selectedWeek ?? undefined} onValueChange={setSelectedWeek}>
            <SelectTrigger className="w-[280px]" data-testid="select-kpi-week">
              <SelectValue placeholder="Select a week" />
            </SelectTrigger>
            <SelectContent>
              {weeks.map(w => (
                <SelectItem key={w.weekBeginning} value={w.weekBeginning}>{formatWeekLabel(w)}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-add-kpi-week">
                <Plus className="h-4 w-4" />
                Add week
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add a new week</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="new-week-date">Week beginning</Label>
                  <Input id="new-week-date" type="date" value={newWeek.weekBeginning}
                    onChange={e => setNewWeek(w => ({ ...w, weekBeginning: e.target.value }))} data-testid="input-new-week-date" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="new-week-num">Week #</Label>
                    <Input id="new-week-num" type="number" value={newWeek.weekNumber}
                      onChange={e => setNewWeek(w => ({ ...w, weekNumber: e.target.value }))} data-testid="input-new-week-number" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="new-week-qtr">Quarter</Label>
                    <Input id="new-week-qtr" type="number" value={newWeek.qtrNumber}
                      onChange={e => setNewWeek(w => ({ ...w, qtrNumber: e.target.value }))} data-testid="input-new-week-qtr" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="new-week-days">Days in month</Label>
                    <Input id="new-week-days" type="number" value={newWeek.daysInMonth}
                      onChange={e => setNewWeek(w => ({ ...w, daysInMonth: e.target.value }))} data-testid="input-new-week-days" />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => addWeekMutation.mutate()} disabled={addWeekMutation.isPending} data-testid="button-confirm-add-week">
                  {addWeekMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create week"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !selectedWeek} data-testid="button-save-kpi-week">
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save changes
        </Button>
      </div>

      {isLoading && (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Loading…</CardContent></Card>
      )}

      {!isLoading && weeks.length === 0 && (
        <Card><CardContent className="py-10 text-center text-muted-foreground">No KPI weeks yet — add one to get started.</CardContent></Card>
      )}

      {!isLoading && selectedWeek && stores.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="border-collapse text-sm w-full" data-testid="table-kpi-weekly">
                <thead>
                  <tr>
                    <th rowSpan={2} className="sticky left-0 z-10 bg-background border-b-2 border-r px-3 py-2 text-left font-medium min-w-[160px]">
                      Store
                    </th>
                    {COLUMN_GROUPS.map(g => {
                      const palette = OWNER_COLORS[g.owner];
                      return (
                        <th key={g.owner} colSpan={g.columns.length} className={`border-b-2 border-r-2 border-white/40 dark:border-black/40 px-3 py-1.5 text-center font-semibold text-xs tracking-wide uppercase ${palette.header}`}>
                          {g.owner}
                        </th>
                      );
                    })}
                  </tr>
                  <tr className="text-xs">
                    {FLAT_COLUMNS.map(col => {
                      const palette = OWNER_COLORS[col.owner];
                      return (
                        <th key={col.field} className={`border-b-2 border-r px-2 py-1.5 text-right font-medium whitespace-nowrap ${palette.colHeader}`}>
                          {col.label}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {stores.map(store => {
                    const row = rows[store] ?? emptyRow(store);
                    const dayRate = dayRateOf(row);
                    const enquiryConversion = enquiryConversionOf(row);
                    const hireConversion = hireConversionOf(row);
                    return (
                      <tr key={store} className="hover:brightness-[0.97] dark:hover:brightness-125 transition-[filter]">
                        <td className="sticky left-0 z-10 bg-background border-b border-r px-3 py-1.5 whitespace-nowrap font-medium">
                          {store}
                        </td>
                        {FLAT_COLUMNS.map(col => {
                          const palette = OWNER_COLORS[col.owner];
                          if (col.computed) {
                            const value = col.field === "dayRate" ? dayRate : col.field === "enquiryConversion" ? enquiryConversion : hireConversion;
                            return (
                              <td key={col.field} className={`border-b border-r px-2 py-1.5 text-right tabular-nums font-semibold ${palette.col} ${palette.accent}`}>
                                {formatValue(col.kind, value)}
                              </td>
                            );
                          }
                          const field = col.field as EditableField;
                          const rawValue = row[field];
                          return (
                            <td key={field} className={`border-b border-r p-0 ${palette.col}`}>
                              <Input
                                type="number"
                                className={`h-8 border-none rounded-none text-right tabular-nums shadow-none focus-visible:ring-1 focus-visible:z-10 relative bg-transparent ${palette.col}`}
                                value={rawValue === null ? "" : (rawValue as number)}
                                onChange={e => updateCell(store, field, e.target.value)}
                                data-testid={`input-kpi-${store.replace(/\s+/g, "-")}-${field}`}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {totalRow && (
                    <tr className="bg-muted/60 font-semibold">
                      <td className="sticky left-0 z-10 bg-muted/60 border-t-2 border-r px-3 py-2">SUR Group Total</td>
                      {FLAT_COLUMNS.map(col => (
                        <td key={col.field} className="border-t-2 border-r px-2 py-2 text-right tabular-nums">
                          {formatValue(col.kind, (totalRow as any)[col.field] ?? 0)}
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
