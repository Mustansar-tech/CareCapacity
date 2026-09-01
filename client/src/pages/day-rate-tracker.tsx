import { useMemo, useState, Fragment } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, toAbsoluteUrl } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  PoundSterling,
  Home,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  PlayCircle,
  Loader2,
  ArrowDownRight,
  ArrowUpRight,
  Minus,
} from "lucide-react";
import { KpiWeeklyGrid } from "@/components/kpi-weekly-grid";
import { AnnualRoadmapGrid } from "@/components/annual-roadmap-grid";

// ── Types (mirrors server/repositories/day-rate.repository.ts) ───────────────

interface DayRateGridEntry {
  revenue: number;
  dayRate: number;
}

interface DayRateGridFranchise {
  id: string;
  franchiseName: string;
  office: string;
  area: string | null;
  groupName: string;
  isLiveInCare: boolean;
  displayOrder: number;
  entries: Record<string, DayRateGridEntry>;
}

interface DayRateGrid {
  reportingMonth: string;
  daysInMonth: number;
  dates: string[];
  franchises: DayRateGridFranchise[];
  totals: Record<string, DayRateGridEntry>;
}

interface DayRateAutomationJobResult {
  franchiseName: string;
  reportingMonth: string;
  status: "running" | "completed" | "failed";
  revenue?: number;
  error?: string;
}

interface DayRateAutomationSession {
  sessionId: string;
  status: "queued" | "running" | "completed" | "failed";
  branchId: string;
  startedAt: string;
  completedAt?: string;
  jobResults: DayRateAutomationJobResult[];
}

interface DayRateAutomationStatus {
  enabled: boolean;
  lastRunAt: string | null;
  lastRunSessionIds: string[];
  lastRunSummary: { total: number; completed: number; failed: number } | null;
  lastErrors: { branchId: string; franchiseName: string; reportingMonth: string; error: string }[];
  recentSessions: DayRateAutomationSession[];
}

interface DayRateFranchiseRef {
  id: string;
  franchiseName: string;
  office: string;
  isLiveInCare: boolean;
  displayOrder: number;
}

const ALL_FRANCHISES_FILTER = "all";

// ── Franchise colour bands ─────────────────────────────────────────────────────
// Every office/franchise gets its own vivid colour — mirroring the owner
// colour bands on the KPI Tracker (Daniel/Sandra/Craig/Sean/Willie) — so rows
// belonging to the same franchise read as one group at a glance, and
// different franchises are instantly distinguishable when "All franchises"
// is selected. Colour is derived from a stable hash of the office code, so a
// given franchise always gets the same colour across renders, filters and
// sessions rather than shifting with sort order.
interface FranchiseTheme {
  dot: string;
  chip: string;
  text: string;
  topBorder: string;
  leftBorder: string;
  stickyBg: string;
  stickyHoverBg: string;
  rowTint: string;
  rowHover: string;
  swatch: string;
}

const FRANCHISE_PALETTE: FranchiseTheme[] = [
  {
    dot: "bg-sky-500", chip: "bg-sky-600", text: "text-sky-800 dark:text-sky-300",
    topBorder: "border-t-sky-300 dark:border-t-sky-800", leftBorder: "border-l-sky-500",
    stickyBg: "bg-sky-50/70 dark:bg-sky-950/25", stickyHoverBg: "group-hover:bg-sky-100/70 dark:group-hover:bg-sky-900/30",
    rowTint: "bg-sky-50/40 dark:bg-sky-950/10", rowHover: "hover:bg-sky-100/50 dark:hover:bg-sky-900/20",
    swatch: "bg-sky-500",
  },
  {
    dot: "bg-violet-500", chip: "bg-violet-600", text: "text-violet-800 dark:text-violet-300",
    topBorder: "border-t-violet-300 dark:border-t-violet-800", leftBorder: "border-l-violet-500",
    stickyBg: "bg-violet-50/70 dark:bg-violet-950/25", stickyHoverBg: "group-hover:bg-violet-100/70 dark:group-hover:bg-violet-900/30",
    rowTint: "bg-violet-50/40 dark:bg-violet-950/10", rowHover: "hover:bg-violet-100/50 dark:hover:bg-violet-900/20",
    swatch: "bg-violet-500",
  },
  {
    dot: "bg-amber-500", chip: "bg-amber-500", text: "text-amber-800 dark:text-amber-300",
    topBorder: "border-t-amber-300 dark:border-t-amber-800", leftBorder: "border-l-amber-500",
    stickyBg: "bg-amber-50/70 dark:bg-amber-950/25", stickyHoverBg: "group-hover:bg-amber-100/70 dark:group-hover:bg-amber-900/30",
    rowTint: "bg-amber-50/40 dark:bg-amber-950/10", rowHover: "hover:bg-amber-100/50 dark:hover:bg-amber-900/20",
    swatch: "bg-amber-500",
  },
  {
    dot: "bg-rose-500", chip: "bg-rose-600", text: "text-rose-800 dark:text-rose-300",
    topBorder: "border-t-rose-300 dark:border-t-rose-800", leftBorder: "border-l-rose-500",
    stickyBg: "bg-rose-50/70 dark:bg-rose-950/25", stickyHoverBg: "group-hover:bg-rose-100/70 dark:group-hover:bg-rose-900/30",
    rowTint: "bg-rose-50/40 dark:bg-rose-950/10", rowHover: "hover:bg-rose-100/50 dark:hover:bg-rose-900/20",
    swatch: "bg-rose-500",
  },
  {
    dot: "bg-teal-500", chip: "bg-teal-600", text: "text-teal-800 dark:text-teal-300",
    topBorder: "border-t-teal-300 dark:border-t-teal-800", leftBorder: "border-l-teal-500",
    stickyBg: "bg-teal-50/70 dark:bg-teal-950/25", stickyHoverBg: "group-hover:bg-teal-100/70 dark:group-hover:bg-teal-900/30",
    rowTint: "bg-teal-50/40 dark:bg-teal-950/10", rowHover: "hover:bg-teal-100/50 dark:hover:bg-teal-900/20",
    swatch: "bg-teal-500",
  },
  {
    dot: "bg-fuchsia-500", chip: "bg-fuchsia-600", text: "text-fuchsia-800 dark:text-fuchsia-300",
    topBorder: "border-t-fuchsia-300 dark:border-t-fuchsia-800", leftBorder: "border-l-fuchsia-500",
    stickyBg: "bg-fuchsia-50/70 dark:bg-fuchsia-950/25", stickyHoverBg: "group-hover:bg-fuchsia-100/70 dark:group-hover:bg-fuchsia-900/30",
    rowTint: "bg-fuchsia-50/40 dark:bg-fuchsia-950/10", rowHover: "hover:bg-fuchsia-100/50 dark:hover:bg-fuchsia-900/20",
    swatch: "bg-fuchsia-500",
  },
  {
    dot: "bg-orange-500", chip: "bg-orange-600", text: "text-orange-800 dark:text-orange-300",
    topBorder: "border-t-orange-300 dark:border-t-orange-800", leftBorder: "border-l-orange-500",
    stickyBg: "bg-orange-50/70 dark:bg-orange-950/25", stickyHoverBg: "group-hover:bg-orange-100/70 dark:group-hover:bg-orange-900/30",
    rowTint: "bg-orange-50/40 dark:bg-orange-950/10", rowHover: "hover:bg-orange-100/50 dark:hover:bg-orange-900/20",
    swatch: "bg-orange-500",
  },
  {
    dot: "bg-indigo-500", chip: "bg-indigo-600", text: "text-indigo-800 dark:text-indigo-300",
    topBorder: "border-t-indigo-300 dark:border-t-indigo-800", leftBorder: "border-l-indigo-500",
    stickyBg: "bg-indigo-50/70 dark:bg-indigo-950/25", stickyHoverBg: "group-hover:bg-indigo-100/70 dark:group-hover:bg-indigo-900/30",
    rowTint: "bg-indigo-50/40 dark:bg-indigo-950/10", rowHover: "hover:bg-indigo-100/50 dark:hover:bg-indigo-900/20",
    swatch: "bg-indigo-500",
  },
  {
    dot: "bg-emerald-500", chip: "bg-emerald-600", text: "text-emerald-800 dark:text-emerald-300",
    topBorder: "border-t-emerald-300 dark:border-t-emerald-800", leftBorder: "border-l-emerald-500",
    stickyBg: "bg-emerald-50/70 dark:bg-emerald-950/25", stickyHoverBg: "group-hover:bg-emerald-100/70 dark:group-hover:bg-emerald-900/30",
    rowTint: "bg-emerald-50/40 dark:bg-emerald-950/10", rowHover: "hover:bg-emerald-100/50 dark:hover:bg-emerald-900/20",
    swatch: "bg-emerald-500",
  },
  {
    dot: "bg-pink-500", chip: "bg-pink-600", text: "text-pink-800 dark:text-pink-300",
    topBorder: "border-t-pink-300 dark:border-t-pink-800", leftBorder: "border-l-pink-500",
    stickyBg: "bg-pink-50/70 dark:bg-pink-950/25", stickyHoverBg: "group-hover:bg-pink-100/70 dark:group-hover:bg-pink-900/30",
    rowTint: "bg-pink-50/40 dark:bg-pink-950/10", rowHover: "hover:bg-pink-100/50 dark:hover:bg-pink-900/20",
    swatch: "bg-pink-500",
  },
  {
    dot: "bg-cyan-500", chip: "bg-cyan-600", text: "text-cyan-800 dark:text-cyan-300",
    topBorder: "border-t-cyan-300 dark:border-t-cyan-800", leftBorder: "border-l-cyan-500",
    stickyBg: "bg-cyan-50/70 dark:bg-cyan-950/25", stickyHoverBg: "group-hover:bg-cyan-100/70 dark:group-hover:bg-cyan-900/30",
    rowTint: "bg-cyan-50/40 dark:bg-cyan-950/10", rowHover: "hover:bg-cyan-100/50 dark:hover:bg-cyan-900/20",
    swatch: "bg-cyan-500",
  },
  {
    dot: "bg-lime-500", chip: "bg-lime-600", text: "text-lime-800 dark:text-lime-300",
    topBorder: "border-t-lime-300 dark:border-t-lime-800", leftBorder: "border-l-lime-500",
    stickyBg: "bg-lime-50/70 dark:bg-lime-950/25", stickyHoverBg: "group-hover:bg-lime-100/70 dark:group-hover:bg-lime-900/30",
    rowTint: "bg-lime-50/40 dark:bg-lime-950/10", rowHover: "hover:bg-lime-100/50 dark:hover:bg-lime-900/20",
    swatch: "bg-lime-500",
  },
];

function getFranchiseTheme(office: string): FranchiseTheme {
  let hash = 0;
  for (let i = 0; i < office.length; i++) {
    hash = (hash * 31 + office.charCodeAt(i)) >>> 0;
  }
  return FRANCHISE_PALETTE[hash % FRANCHISE_PALETTE.length];
}

// ── Formatting helpers ────────────────────────────────────────────────────────

// All monetary figures on this dashboard allow up to 2 decimal places and
// are never rounded away — e.g. £108,728.35 stays £108,728.35, not £108,728.
// A whole-pound amount still displays without decimals (£100, not £100.00);
// only maximumFractionDigits is set, no minimum, so real pence are preserved
// but nothing is padded that wasn't there.
const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

const gbpPrecise = gbp;

function formatMonthLabel(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatDateHeader(date: string): { day: string; weekday: string } {
  const d = new Date(date + "T00:00:00Z");
  return {
    day: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }),
    weekday: d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
  };
}

/**
 * Always compares "last calendar month" (closed) vs "this calendar month" vs
 * "next calendar month" — computed from today's date rather than stored, so
 * once the calendar rolls into September this automatically becomes Aug vs
 * Sep vs Oct without anyone re-selecting anything.
 */
function getComparisonMonths(now: Date): [string, string, string] {
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (y: number, m: number) => `${y}-${pad(m + 1)}`;
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return [fmt(year, month - 1), fmt(year, month), fmt(year, month + 1)];
}

type Trend = "up" | "down" | "flat" | null;

function getTrend(current: number | undefined, previous: number | undefined): Trend {
  if (current === undefined || previous === undefined) return null;
  if (current > previous) return "up";
  if (current < previous) return "down";
  return "flat";
}

function trendClasses(trend: Trend): string {
  if (trend === "up") {
    return "bg-emerald-50/80 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300";
  }
  if (trend === "down") {
    return "bg-rose-50/80 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300";
  }
  if (trend === "flat") {
    return "bg-slate-50/70 text-slate-600 dark:bg-slate-900/40 dark:text-slate-300";
  }
  return "text-muted-foreground";
}

function TrendIcon({ trend }: { trend: Trend }) {
  if (trend === "up") return <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden="true" />;
  if (trend === "down") return <ArrowDownRight className="h-3 w-3 shrink-0" aria-hidden="true" />;
  if (trend === "flat") return <Minus className="h-3 w-3 shrink-0" aria-hidden="true" />;
  return null;
}

function getTrendLabel(trend: Trend): string {
  if (trend === "up") return "increased from the previous day";
  if (trend === "down") return "decreased from the previous day";
  if (trend === "flat") return "unchanged from the previous day";
  return "no previous day available";
}

// ── Month grid (one full daily breakdown for a single reporting month) ────────

function MonthGrid({
  month,
  showTitle = true,
  isClosed = false,
  selectedOffice = ALL_FRANCHISES_FILTER,
  officeOptions,
  onSelectedOfficeChange,
}: {
  month: string;
  showTitle?: boolean;
  isClosed?: boolean;
  selectedOffice?: string;
  officeOptions: { office: string; label: string }[];
  onSelectedOfficeChange: (office: string) => void;
}) {
  const gridQuery = useQuery<DayRateGrid>({
    queryKey: ["/api/day-rate/grid", month],
    queryFn: async () => {
      const res = await fetch(
        toAbsoluteUrl(`/api/day-rate/grid?month=${month}`),
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load day rate grid");
      return res.json();
    },
    staleTime: 30_000,
  });

  const grid = gridQuery.data;

  const officeGroups = useMemo(() => {
    if (!grid) return [];
    const seen = new Map<string, DayRateGridFranchise[]>();
    for (const f of grid.franchises) {
      if (selectedOffice !== ALL_FRANCHISES_FILTER && f.office !== selectedOffice) continue;
      if (!seen.has(f.office)) seen.set(f.office, []);
      seen.get(f.office)!.push(f);
    }
    return Array.from(seen.entries());
  }, [grid, selectedOffice]);

  // Totals across only the currently-visible (filtered) franchises. Day rate
  // is cumulative revenue-to-date divided by the fixed number of days in the
  // month, so it's recomputed the same way the server does for the full set.
  const filteredTotals = useMemo(() => {
    if (!grid) return {} as Record<string, DayRateGridEntry>;
    if (selectedOffice === ALL_FRANCHISES_FILTER) return grid.totals;
    const visibleFranchises = officeGroups.flatMap(([, rows]) => rows);
    const out: Record<string, DayRateGridEntry> = {};
    for (const date of grid.dates) {
      const revenue = visibleFranchises.reduce((sum, f) => sum + (f.entries[date]?.revenue ?? 0), 0);
      out[date] = { revenue, dayRate: grid.daysInMonth > 0 ? revenue / grid.daysInMonth : 0 };
    }
    return out;
  }, [grid, officeGroups, selectedOffice]);

  const grandTotal = useMemo(() => {
    if (!grid || grid.dates.length === 0) return null;
    const lastDate = grid.dates[grid.dates.length - 1];
    return filteredTotals[lastDate];
  }, [grid, filteredTotals]);

  const grandTotalTrend = useMemo(() => {
    if (!grid || grid.dates.length < 2) return null;
    const lastIndex = grid.dates.length - 1;
    return getTrend(
      filteredTotals[grid.dates[lastIndex]]?.dayRate,
      filteredTotals[grid.dates[lastIndex - 1]]?.dayRate,
    );
  }, [grid, filteredTotals]);

  return (
    <div className="space-y-4">
      {showTitle && (
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          {formatMonthLabel(month)}
          {isClosed && (
            <Badge variant="secondary" className="font-normal text-muted-foreground">Closed</Badge>
          )}
        </h2>
      )}

      {gridQuery.isLoading && (
        <Card className="border-border/70 shadow-sm"><CardContent className="py-10 text-center text-muted-foreground">Loading…</CardContent></Card>
      )}

      {gridQuery.isError && (
        <Card className="border-destructive/30 bg-destructive/[0.03] shadow-sm"><CardContent className="py-10 text-center text-destructive">Failed to load the day rate grid.</CardContent></Card>
      )}

      {grid && grid.dates.length === 0 && !gridQuery.isLoading && (
        <Card className="border-border/70 shadow-sm"><CardContent className="py-10 text-center text-muted-foreground">No data for {formatMonthLabel(month)} yet.</CardContent></Card>
      )}

      {grid && grid.dates.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
             <Card className="relative overflow-hidden border-sky-200/60 bg-gradient-to-br from-sky-500/[0.08] via-card to-card shadow-sm dark:border-sky-900/40">
               <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-sky-400/10 blur-2xl" aria-hidden="true" />
              <CardHeader className="pb-2">
                 <CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-sky-700/80 dark:text-sky-300/80">
                   <span className="h-1.5 w-1.5 rounded-full bg-sky-500 shrink-0" aria-hidden="true" />
                   Days in Month
                 </CardTitle>
              </CardHeader>
               <CardContent className="relative flex items-end gap-2 text-3xl font-semibold tracking-tight">
                 {grid.daysInMonth}
                 <span className="pb-1 text-sm font-normal text-muted-foreground">days</span>
               </CardContent>
            </Card>
             <Card className="relative overflow-hidden border-violet-200/60 bg-gradient-to-br from-violet-500/[0.08] via-card to-card shadow-sm dark:border-violet-900/40">
               <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-violet-400/10 blur-2xl" aria-hidden="true" />
              <CardHeader className="pb-2">
                 <CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-violet-700/80 dark:text-violet-300/80">
                   <span className="h-1.5 w-1.5 rounded-full bg-violet-500 shrink-0" aria-hidden="true" />
                  {selectedOffice === ALL_FRANCHISES_FILTER ? "Group Total" : "Franchise Total"} — {isClosed ? "Final" : grid.dates[grid.dates.length - 1] && formatDateHeader(grid.dates[grid.dates.length - 1]).day}
                </CardTitle>
              </CardHeader>
              <CardContent className="relative">
                 <div className="text-3xl font-semibold tracking-tight">{grandTotal ? gbp.format(grandTotal.revenue) : "—"}</div>
                 <div className={`mt-1 flex items-center gap-1.5 text-sm font-medium ${trendClasses(grandTotalTrend)}`} title={getTrendLabel(grandTotalTrend)}>
                   <span>Day rate: {grandTotal ? gbpPrecise.format(grandTotal.dayRate) : "—"}</span>
                   <TrendIcon trend={grandTotalTrend} />
                   {grandTotalTrend && <span className="sr-only">{getTrendLabel(grandTotalTrend)}</span>}
                </div>
              </CardContent>
            </Card>
          </div>

           <Card className="overflow-hidden border-border/70 shadow-sm">
            <CardContent className="p-0">
               <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-3 py-2 text-xs">
                 <span className="font-medium text-muted-foreground">Daily revenue and day rate</span>
                 <div className="flex items-center gap-3 text-muted-foreground" aria-label="Day rate trend legend">
                   <span className="font-medium">Day rate trend</span>
                   <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                     <ArrowUpRight className="h-3 w-3" aria-hidden="true" /> Rising
                   </span>
                   <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-300">
                     <ArrowDownRight className="h-3 w-3" aria-hidden="true" /> Falling
                   </span>
                 </div>
               </div>
               {selectedOffice === ALL_FRANCHISES_FILTER && officeGroups.length > 1 && (
                 <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b bg-muted/10 px-3 py-2 text-xs" aria-label="Franchise colour key">
                   {officeGroups.map(([office, rows]) => {
                     const theme = getFranchiseTheme(office);
                     return (
                       <span key={office} className="inline-flex items-center gap-1.5 text-muted-foreground">
                         <span className={`h-2 w-2 rounded-full ${theme.swatch}`} aria-hidden="true" />
                         <span className="font-medium">{rows[0]?.franchiseName ?? office}</span>
                       </span>
                     );
                   })}
                 </div>
               )}
              <div className="overflow-x-auto">
                <table className="border-collapse text-sm w-full" data-testid={`table-day-rate-grid-${month}`}>
                  <thead>
                    <tr>
                       <th className="sticky left-0 z-10 bg-background border-b border-r px-3 py-2 text-left font-medium min-w-[220px]">
                        <Select value={selectedOffice} onValueChange={onSelectedOfficeChange}>
                          <SelectTrigger
                             className="h-8 w-full border-none bg-transparent px-0 font-semibold shadow-none focus:ring-0 focus:ring-offset-0 [&>svg]:opacity-60"
                            data-testid={`select-franchise-filter-${month}`}
                          >
                            <SelectValue placeholder="Franchise" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={ALL_FRANCHISES_FILTER}>All franchises</SelectItem>
                            {officeOptions.map((o) => (
                              <SelectItem key={o.office} value={o.office}>{o.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </th>
                      {grid.dates.map((date) => {
                        const { day, weekday } = formatDateHeader(date);
                         const isLatestDate = date === grid.dates[grid.dates.length - 1];
                         const isToday = date === new Date().toISOString().slice(0, 10);
                         return (
                           <th
                             key={date}
                             colSpan={2}
                             className={`border-b border-r px-3 py-2 text-center font-medium whitespace-nowrap ${isLatestDate ? "bg-primary/[0.06]" : ""} ${isToday ? "text-primary" : ""}`}
                           >
                            <div>{day}</div>
                             <div className={`text-xs font-normal ${isToday ? "text-primary/80" : "text-muted-foreground"}`}>
                               {weekday}{isToday && <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium">Today</span>}
                             </div>
                          </th>
                        );
                      })}
                    </tr>
                    <tr className="text-xs text-muted-foreground">
                      <th className="sticky left-0 z-10 bg-background border-b border-r px-3 py-1 text-left font-normal">
                        Office / Franchise
                      </th>
                      {grid.dates.map((date) => (
                        <Fragment key={date}>
                         <th className="border-b border-r px-2 py-1 text-right font-normal">Revenue</th>
                         <th className="border-b border-r bg-primary/[0.025] px-2 py-1 text-right font-normal">Day Rate</th>
                        </Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                     {officeGroups.map(([office, rows]) => {
                      const theme = getFranchiseTheme(office);
                      return rows.map((f, idx) => (
                         <tr key={f.id} className={`group transition-colors ${theme.rowTint} ${theme.rowHover} ${idx === 0 ? `border-t-2 ${theme.topBorder}` : ""}`}>
                           <td className={`sticky left-0 z-10 border-b border-r border-l-4 ${theme.leftBorder} px-3 py-1.5 whitespace-nowrap transition-colors ${theme.stickyBg} ${theme.stickyHoverBg} ${idx === 0 ? `border-t-2 ${theme.topBorder}` : ""}`}>
                            <div className="flex items-center gap-2">
                               {idx === 0 ? (
                                 <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${theme.chip} shadow-sm`}>
                                   <Home className="h-3 w-3 text-white" aria-hidden="true" />
                                 </span>
                               ) : (
                                 <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${theme.dot} ml-5`} aria-hidden="true" />
                               )}
                              <span className={idx === 0 ? `font-semibold ${theme.text}` : "text-muted-foreground"}>
                                {f.franchiseName}
                              </span>
                              {f.isLiveInCare && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">LIC</Badge>
                              )}
                            </div>
                          </td>
                           {grid.dates.map((date, dateIndex) => {
                            const e = f.entries[date];
                             const previousEntry = dateIndex > 0 ? f.entries[grid.dates[dateIndex - 1]] : undefined;
                             const dayRateTrend = getTrend(e?.dayRate, previousEntry?.dayRate);
                             const isLatestDate = date === grid.dates[grid.dates.length - 1];
                            return (
                              <Fragment key={date}>
                                 <td className={`border-b border-r px-2 py-1.5 text-right tabular-nums ${isLatestDate ? "bg-primary/[0.025]" : ""}`}>
                                  {e ? gbp.format(e.revenue) : <span className="text-muted-foreground">—</span>}
                                </td>
                                 <td
                                   className={`border-b border-r px-2 py-1.5 text-right tabular-nums font-medium transition-colors ${trendClasses(dayRateTrend)} ${isLatestDate ? "ring-1 ring-inset ring-primary/10" : ""}`}
                                   title={e ? `Day rate ${gbpPrecise.format(e.dayRate)} — ${getTrendLabel(dayRateTrend)}` : "No day rate available"}
                                 >
                                   <span className="inline-flex items-center justify-end gap-1">
                                     {e ? gbpPrecise.format(e.dayRate) : "—"}
                                     <TrendIcon trend={dayRateTrend} />
                                   </span>
                                   {dayRateTrend && <span className="sr-only">{getTrendLabel(dayRateTrend)}</span>}
                                </td>
                              </Fragment>
                            );
                          })}
                        </tr>
                      ));
                    })}
                     <tr className="bg-muted/60 font-semibold">
                       <td className="sticky left-0 z-10 bg-muted/60 border-t border-r px-3 py-2">
                        {selectedOffice === ALL_FRANCHISES_FILTER ? "Group Total" : "Franchise Total"}
                      </td>
                       {grid.dates.map((date, dateIndex) => {
                        const t = filteredTotals[date];
                         const previousTotal = dateIndex > 0 ? filteredTotals[grid.dates[dateIndex - 1]] : undefined;
                         const totalTrend = getTrend(t?.dayRate, previousTotal?.dayRate);
                        return (
                          <Fragment key={date}>
                            <td className="border-t border-r px-2 py-2 text-right tabular-nums">
                              {t ? gbp.format(t.revenue) : "—"}
                            </td>
                             <td className={`border-t border-r px-2 py-2 text-right tabular-nums ${trendClasses(totalTrend)}`}>
                               <span className="inline-flex items-center justify-end gap-1">
                                 {t ? gbpPrecise.format(t.dayRate) : "—"}
                                 <TrendIcon trend={totalTrend} />
                               </span>
                               {totalTrend && <span className="sr-only">{getTrendLabel(totalTrend)}</span>}
                            </td>
                          </Fragment>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DayRateTrackerPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [previousMonth, currentMonth, nextMonth] = useMemo(() => getComparisonMonths(new Date()), []);
  const [selectedOffice, setSelectedOffice] = useState<string>(ALL_FRANCHISES_FILTER);
  const [selectedArchiveMonth, setSelectedArchiveMonth] = useState<string>("");

  const monthsQuery = useQuery<string[]>({
    queryKey: ["/api/day-rate/months"],
    queryFn: async () => {
      const res = await fetch(toAbsoluteUrl("/api/day-rate/months"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load reporting months");
      return res.json();
    },
    staleTime: 5 * 60_000,
    enabled: isAdmin,
  });

  // Every closed month older than the rolling 3-month window — newest first —
  // so past months stay reachable via an archive dropdown instead of piling
  // up as permanent tabs.
  const archiveMonths = useMemo(() => {
    return (monthsQuery.data ?? [])
      .filter(m => m < previousMonth)
      .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  }, [monthsQuery.data, previousMonth]);

  const franchisesQuery = useQuery<DayRateFranchiseRef[]>({
    queryKey: ["/api/day-rate/franchises"],
    queryFn: async () => {
      const res = await fetch(toAbsoluteUrl("/api/day-rate/franchises"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load franchise list");
      return res.json();
    },
    staleTime: 5 * 60_000,
    enabled: isAdmin,
  });

  // One dropdown option per office, labelled with its base (non-LIC)
  // franchise name — selecting it filters the grid down to that franchise's
  // normal and Live-In Care rows together.
  const officeOptions = useMemo(() => {
    const franchises = franchisesQuery.data ?? [];
    const byOffice = new Map<string, DayRateFranchiseRef>();
    for (const f of franchises) {
      const existing = byOffice.get(f.office);
      if (!existing || (existing.isLiveInCare && !f.isLiveInCare)) {
        byOffice.set(f.office, f);
      }
    }
    return Array.from(byOffice.entries())
      .map(([office, f]) => ({ office, label: f.franchiseName, displayOrder: f.displayOrder }))
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }, [franchisesQuery.data]);

  // Hooks must run unconditionally on every render, so the admin gate below
  // (which returns early) comes after this query — it's simply disabled
  // (enabled: isAdmin) rather than skipped, keeping hook order stable.
  const automationStatusQuery = useQuery<DayRateAutomationStatus>({
    queryKey: ["/api/day-rate/automation/status"],
    queryFn: async () => {
      const res = await fetch(toAbsoluteUrl("/api/day-rate/automation/status"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load automation status");
      return res.json();
    },
    staleTime: 30_000,
    retry: false,
    enabled: isAdmin,
    // Poll a bit faster while a manual run is likely in flight so the banner
    // and grid update without the admin needing to refresh the page.
    refetchInterval: (query) => {
      const sessions = query.state.data?.recentSessions ?? [];
      const anyRunning = sessions.some(s => s.status === "queued" || s.status === "running");
      return anyRunning ? 5_000 : false;
    },
  });
  const automationStatus = automationStatusQuery.data;

  const isAutomationRunning = (automationStatus?.recentSessions ?? []).some(
    s => s.status === "queued" || s.status === "running",
  );

  const runAutomationMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/day-rate/automation/run");
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Financial Summary automation started",
        description: "Pulling the latest figures from People Planner for every franchise — this can take a few minutes.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/day-rate/automation/status"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to start the automation",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (!isAdmin) {
    return (
      <div className="p-6" data-testid="page-day-rate-tracker-denied">
        <Card className="max-w-lg mx-auto mt-12">
          <CardContent className="pt-6 text-center space-y-3">
            <ShieldAlert className="h-8 w-8 text-muted-foreground mx-auto" />
            <h1 className="text-lg font-semibold">Admin access required</h1>
            <p className="text-sm text-muted-foreground">
              The Day Rate Tracker is only available to admin users.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-full p-4 sm:p-6 space-y-6" data-testid="page-day-rate-tracker">
      <div className="relative overflow-hidden rounded-2xl border border-primary/10 bg-gradient-to-br from-primary/[0.10] via-background to-violet-500/[0.07] p-5 shadow-sm sm:p-6">
        <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-primary/15 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -left-10 bottom-[-3.5rem] h-36 w-36 rounded-full bg-violet-500/15 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute right-1/3 top-0 h-24 w-24 rounded-full bg-amber-400/10 blur-2xl" aria-hidden="true" />
        <div className="relative">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2.5 sm:text-3xl">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-violet-600 text-primary-foreground shadow-md shadow-primary/25">
              <PoundSterling className="h-5 w-5" aria-hidden="true" />
            </span>
            Data House
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Revenue, KPIs and the annual roadmap for every franchise, in one place.
          </p>
        </div>
      </div>

      <Tabs defaultValue="day-rate-tracker" className="space-y-4">
        <TabsList className="h-auto rounded-xl bg-muted/70 p-1.5 shadow-inner">
          <TabsTrigger value="day-rate-tracker" className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-all data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm sm:px-4 sm:text-sm" data-testid="tab-section-day-rate-tracker">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle" aria-hidden="true" />
            Day Rate Tracker
          </TabsTrigger>
          <TabsTrigger value="kpi-tracker" className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-all data-[state=active]:bg-background data-[state=active]:text-violet-600 dark:data-[state=active]:text-violet-400 data-[state=active]:shadow-sm sm:px-4 sm:text-sm" data-testid="tab-section-kpi-tracker">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-violet-500 align-middle" aria-hidden="true" />
            KPI Tracker
          </TabsTrigger>
          <TabsTrigger value="annual-roadmap" className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-all data-[state=active]:bg-background data-[state=active]:text-amber-600 dark:data-[state=active]:text-amber-400 data-[state=active]:shadow-sm sm:px-4 sm:text-sm" data-testid="tab-section-annual-roadmap">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" aria-hidden="true" />
            Annual Roadmap
          </TabsTrigger>
        </TabsList>

        <TabsContent value="day-rate-tracker" className="space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              {formatMonthLabel(previousMonth)} (closed) vs {formatMonthLabel(currentMonth)} vs {formatMonthLabel(nextMonth)} —
              cumulative revenue and day rate per franchise, from the People Planner Financial Summary. This comparison
              always tracks the last closed, current and next calendar month, so it rolls forward automatically each month.
            </p>
            <Button
              onClick={() => runAutomationMutation.mutate()}
              disabled={runAutomationMutation.isPending || isAutomationRunning}
              className="shadow-md shadow-primary/15 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/20"
              data-testid="button-run-automation"
            >
              {runAutomationMutation.isPending || isAutomationRunning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {isAutomationRunning ? "Running…" : "Starting…"}
                </>
              ) : (
                <>
                  <PlayCircle className="h-4 w-4" />
                  Run automation now
                </>
              )}
            </Button>
          </div>

          {automationStatus && automationStatus.lastRunSummary && automationStatus.lastRunSummary.failed > 0 && (
            <Alert variant="destructive" className="border-rose-200 bg-rose-50/70 dark:border-rose-900/60 dark:bg-rose-950/20" data-testid="banner-automation-failure">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>
                {automationStatus.lastErrors.length} franchise figure{automationStatus.lastErrors.length === 1 ? "" : "s"} failed to pull from People Planner
              </AlertTitle>
              <AlertDescription>
                <div className="mt-1 space-y-1">
                  {automationStatus.lastErrors.slice(0, 6).map((e, i) => (
                    <div key={i}>
                      <span className="font-medium">{e.franchiseName}</span> ({formatMonthLabel(e.reportingMonth)}) — {e.error}
                    </div>
                  ))}
                  {automationStatus.lastErrors.length > 6 && (
                    <div className="text-xs opacity-80">+{automationStatus.lastErrors.length - 6} more</div>
                  )}
                  <div className="text-xs opacity-80 pt-1">
                    These figures were left unchanged rather than written incorrectly — use "Run automation now" to retry after checking People Planner.
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {automationStatus && (
            <Card className={`shadow-sm ${automationStatus.lastRunSummary && automationStatus.lastRunSummary.failed > 0 ? "border-rose-200 bg-rose-50/50 dark:border-rose-900/60 dark:bg-rose-950/20" : "border-emerald-200/80 bg-emerald-50/45 dark:border-emerald-900/60 dark:bg-emerald-950/20"}`} data-testid="card-automation-status">
              <CardContent className="py-3 flex items-center gap-3 flex-wrap text-sm">
                {automationStatus.lastRunSummary && automationStatus.lastRunSummary.failed > 0 ? (
                  <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                )}
                <span className="text-muted-foreground">
                  Financial Summary automation last ran{" "}
                  {automationStatus.lastRunAt
                    ? new Date(automationStatus.lastRunAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
                    : "— not yet run"}
                  {automationStatus.lastRunSummary && (
                    <>
                      {" · "}
                      {automationStatus.lastRunSummary.completed}/{automationStatus.lastRunSummary.total} succeeded
                    </>
                  )}
                </span>
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue={currentMonth} className="space-y-4">
            <TabsList className="h-auto rounded-lg bg-muted/50 p-1">
              <TabsTrigger value={previousMonth} className="rounded-md px-3 py-1.5 text-xs font-medium transition-all data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm sm:text-sm" data-testid={`tab-${previousMonth}`}>
                {formatMonthLabel(previousMonth)}
                <Badge variant="secondary" className="ml-1.5 font-normal text-[10px] px-1.5 py-0">Closed</Badge>
              </TabsTrigger>
              <TabsTrigger value={currentMonth} className="rounded-md px-3 py-1.5 text-xs font-medium transition-all data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm sm:text-sm" data-testid={`tab-${currentMonth}`}>
                {formatMonthLabel(currentMonth)}
              </TabsTrigger>
              <TabsTrigger value={nextMonth} className="rounded-md px-3 py-1.5 text-xs font-medium transition-all data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm sm:text-sm" data-testid={`tab-${nextMonth}`}>
                {formatMonthLabel(nextMonth)}
              </TabsTrigger>
              {archiveMonths.length > 0 && (
                <TabsTrigger value="archive" className="rounded-md px-3 py-1.5 text-xs font-medium transition-all data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm sm:text-sm" data-testid="tab-archive">
                  Previous months
                </TabsTrigger>
              )}
            </TabsList>
            <TabsContent value={previousMonth}>
              <MonthGrid
                month={previousMonth}
                showTitle={false}
                isClosed
                selectedOffice={selectedOffice}
                officeOptions={officeOptions}
                onSelectedOfficeChange={setSelectedOffice}
              />
            </TabsContent>
            <TabsContent value={currentMonth}>
              <MonthGrid
                month={currentMonth}
                showTitle={false}
                selectedOffice={selectedOffice}
                officeOptions={officeOptions}
                onSelectedOfficeChange={setSelectedOffice}
              />
            </TabsContent>
            <TabsContent value={nextMonth}>
              <MonthGrid
                month={nextMonth}
                showTitle={false}
                selectedOffice={selectedOffice}
                officeOptions={officeOptions}
                onSelectedOfficeChange={setSelectedOffice}
              />
            </TabsContent>
            {archiveMonths.length > 0 && (
              <TabsContent value="archive" className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-muted-foreground">Month</span>
                  <Select
                    value={selectedArchiveMonth || archiveMonths[0]}
                    onValueChange={setSelectedArchiveMonth}
                  >
                    <SelectTrigger className="w-[220px]" data-testid="select-archive-month">
                      <SelectValue placeholder="Select a month" />
                    </SelectTrigger>
                    <SelectContent>
                      {archiveMonths.map(m => (
                        <SelectItem key={m} value={m}>{formatMonthLabel(m)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <MonthGrid
                  month={selectedArchiveMonth || archiveMonths[0]}
                  showTitle={false}
                  isClosed
                  selectedOffice={selectedOffice}
                  officeOptions={officeOptions}
                  onSelectedOfficeChange={setSelectedOffice}
                />
              </TabsContent>
            )}
          </Tabs>
        </TabsContent>

        <TabsContent value="kpi-tracker">
          <KpiWeeklyGrid />
        </TabsContent>
        <TabsContent value="annual-roadmap">
          <AnnualRoadmapGrid />
        </TabsContent>
      </Tabs>
    </div>
  );
}
