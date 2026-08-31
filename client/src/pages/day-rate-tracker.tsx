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
import { PoundSterling, Home, AlertTriangle, CheckCircle2, ShieldAlert, PlayCircle, Loader2 } from "lucide-react";
import { KpiWeeklyGrid } from "@/components/kpi-weekly-grid";

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
 * Always compares "this calendar month" vs "next calendar month" — computed from
 * today's date rather than stored, so once the calendar rolls into September this
 * automatically becomes Sep vs Oct without anyone re-selecting anything.
 */
function getComparisonMonths(now: Date): [string, string] {
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (y: number, m: number) => `${y}-${pad(m + 1)}`;
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return [fmt(year, month), fmt(year, month + 1)];
}

// ── Month grid (one full daily breakdown for a single reporting month) ────────

function MonthGrid({
  month,
  showTitle = true,
  selectedOffice = ALL_FRANCHISES_FILTER,
  officeOptions,
  onSelectedOfficeChange,
}: {
  month: string;
  showTitle?: boolean;
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

  return (
    <div className="space-y-4">
      {showTitle && <h2 className="text-lg font-semibold tracking-tight">{formatMonthLabel(month)}</h2>}

      {gridQuery.isLoading && (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Loading…</CardContent></Card>
      )}

      {gridQuery.isError && (
        <Card><CardContent className="py-10 text-center text-destructive">Failed to load the day rate grid.</CardContent></Card>
      )}

      {grid && grid.dates.length === 0 && !gridQuery.isLoading && (
        <Card><CardContent className="py-10 text-center text-muted-foreground">No data for {formatMonthLabel(month)} yet.</CardContent></Card>
      )}

      {grid && grid.dates.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Days in Month</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">{grid.daysInMonth}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {selectedOffice === ALL_FRANCHISES_FILTER ? "Group Total" : "Franchise Total"} — {grid.dates[grid.dates.length - 1] && formatDateHeader(grid.dates[grid.dates.length - 1]).day}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{grandTotal ? gbp.format(grandTotal.revenue) : "—"}</div>
                <div className="text-sm text-muted-foreground">
                  Day rate: {grandTotal ? gbpPrecise.format(grandTotal.dayRate) : "—"}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="border-collapse text-sm w-full" data-testid={`table-day-rate-grid-${month}`}>
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-background border-b border-r px-3 py-2 text-left font-medium min-w-[220px]">
                        <Select value={selectedOffice} onValueChange={onSelectedOfficeChange}>
                          <SelectTrigger
                            className="h-7 w-full border-none bg-transparent px-0 font-medium shadow-none focus:ring-0 focus:ring-offset-0 [&>svg]:opacity-60"
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
                        return (
                          <th key={date} colSpan={2} className="border-b border-r px-3 py-2 text-center font-medium whitespace-nowrap">
                            <div>{day}</div>
                            <div className="text-xs text-muted-foreground font-normal">{weekday}</div>
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
                          <th className="border-b border-r px-2 py-1 text-right font-normal">Day Rate</th>
                        </Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {officeGroups.map(([office, rows]) => (
                      rows.map((f, idx) => (
                        <tr key={f.id} className="hover:bg-muted/40">
                          <td className="sticky left-0 z-10 bg-background border-b border-r px-3 py-1.5 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              {idx === 0 && <Home className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                              <span className={idx === 0 ? "font-medium" : "text-muted-foreground pl-5"}>
                                {f.franchiseName}
                              </span>
                              {f.isLiveInCare && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">LIC</Badge>
                              )}
                            </div>
                          </td>
                          {grid.dates.map((date) => {
                            const e = f.entries[date];
                            return (
                              <Fragment key={date}>
                                <td className="border-b border-r px-2 py-1.5 text-right tabular-nums">
                                  {e ? gbp.format(e.revenue) : <span className="text-muted-foreground">—</span>}
                                </td>
                                <td className="border-b border-r px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                                  {e ? gbpPrecise.format(e.dayRate) : "—"}
                                </td>
                              </Fragment>
                            );
                          })}
                        </tr>
                      ))
                    ))}
                    <tr className="bg-muted/60 font-semibold">
                      <td className="sticky left-0 z-10 bg-muted/60 border-t border-r px-3 py-2">
                        {selectedOffice === ALL_FRANCHISES_FILTER ? "Group Total" : "Franchise Total"}
                      </td>
                      {grid.dates.map((date) => {
                        const t = filteredTotals[date];
                        return (
                          <Fragment key={date}>
                            <td className="border-t border-r px-2 py-2 text-right tabular-nums">
                              {t ? gbp.format(t.revenue) : "—"}
                            </td>
                            <td className="border-t border-r px-2 py-2 text-right tabular-nums">
                              {t ? gbpPrecise.format(t.dayRate) : "—"}
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
  const [currentMonth, nextMonth] = useMemo(() => getComparisonMonths(new Date()), []);
  const [selectedOffice, setSelectedOffice] = useState<string>(ALL_FRANCHISES_FILTER);

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
    <div className="p-6 space-y-6" data-testid="page-day-rate-tracker">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <PoundSterling className="h-6 w-6 text-primary" />
            Day Rate Tracker
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {formatMonthLabel(currentMonth)} vs {formatMonthLabel(nextMonth)} — cumulative revenue and day rate per
            franchise, from the People Planner Financial Summary. This comparison always tracks the current and next
            calendar month, so it rolls forward automatically each month.
          </p>
        </div>
        <Button
          onClick={() => runAutomationMutation.mutate()}
          disabled={runAutomationMutation.isPending || isAutomationRunning}
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
        <Alert variant="destructive" data-testid="banner-automation-failure">
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
        <Card data-testid="card-automation-status">
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
        <TabsList>
          <TabsTrigger value={currentMonth} data-testid={`tab-${currentMonth}`}>
            {formatMonthLabel(currentMonth)}
          </TabsTrigger>
          <TabsTrigger value={nextMonth} data-testid={`tab-${nextMonth}`}>
            {formatMonthLabel(nextMonth)}
          </TabsTrigger>
          <TabsTrigger value="kpi-tracker" data-testid="tab-kpi-tracker">
            KPI Tracker
          </TabsTrigger>
        </TabsList>
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
        <TabsContent value="kpi-tracker">
          <KpiWeeklyGrid />
        </TabsContent>
      </Tabs>
    </div>
  );
}
