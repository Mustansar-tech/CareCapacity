import { useMemo, Fragment } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toAbsoluteUrl } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { PoundSterling, Home, AlertTriangle, CheckCircle2, PlayCircle, Loader2 } from "lucide-react";

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

// ── Formatting helpers ────────────────────────────────────────────────────────

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

const gbpPrecise = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

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

function MonthGrid({ month, showTitle = true }: { month: string; showTitle?: boolean }) {
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

  const grandTotal = useMemo(() => {
    if (!grid || grid.dates.length === 0) return null;
    const lastDate = grid.dates[grid.dates.length - 1];
    return grid.totals[lastDate];
  }, [grid]);

  const officeGroups = useMemo(() => {
    if (!grid) return [];
    const seen = new Map<string, DayRateGridFranchise[]>();
    for (const f of grid.franchises) {
      if (!seen.has(f.office)) seen.set(f.office, []);
      seen.get(f.office)!.push(f);
    }
    return Array.from(seen.entries());
  }, [grid]);

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
                  Group Total — {grid.dates[grid.dates.length - 1] && formatDateHeader(grid.dates[grid.dates.length - 1]).day}
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
                        Franchise
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
                        Group Total
                      </td>
                      {grid.dates.map((date) => {
                        const t = grid.totals[date];
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
  const [currentMonth, nextMonth] = useMemo(() => getComparisonMonths(new Date()), []);

  const automationStatusQuery = useQuery<DayRateAutomationStatus>({
    queryKey: ["/api/day-rate/automation/status"],
    queryFn: async () => {
      const res = await fetch(toAbsoluteUrl("/api/day-rate/automation/status"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load automation status");
      return res.json();
    },
    staleTime: 30_000,
    retry: false,
  });
  const automationStatus = automationStatusQuery.data;

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const runNowMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(toAbsoluteUrl("/api/day-rate/automation/run"), {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to start automation run");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Financial Summary run started",
        description: "Downloading and processing exports for every franchise — this can take several minutes. Refresh the status below to check progress.",
      });
      // Give the background session a moment to register before polling status.
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/day-rate/automation/status"] });
      }, 3000);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to start run", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="p-6 space-y-6" data-testid="page-day-rate-tracker">
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
            {automationStatus.lastErrors.length > 0 && (
              <span className="text-destructive">
                {automationStatus.lastErrors.length} failure{automationStatus.lastErrors.length === 1 ? "" : "s"}:{" "}
                {automationStatus.lastErrors.slice(0, 3).map(e => `${e.franchiseName} (${e.reportingMonth})`).join(", ")}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => automationStatusQuery.refetch()}
                data-testid="button-refresh-automation-status"
              >
                Refresh status
              </Button>
              <Button
                size="sm"
                onClick={() => runNowMutation.mutate()}
                disabled={runNowMutation.isPending}
                data-testid="button-run-automation-now"
              >
                {runNowMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <PlayCircle className="h-4 w-4 mr-1.5" />
                )}
                Run now
              </Button>
            </div>
          </CardContent>
          {automationStatus.recentSessions.length > 0 && (
            <CardContent className="pt-0 pb-3 text-xs text-muted-foreground space-y-1">
              {automationStatus.recentSessions.slice(0, 5).map((s) => (
                <div key={s.sessionId} className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant={s.status === "failed" ? "destructive" : s.status === "completed" ? "outline" : "secondary"}
                    className="text-[10px] px-1.5 py-0"
                  >
                    {s.status}
                  </Badge>
                  <span>Branch session {s.sessionId}</span>
                  <span>
                    {s.jobResults.filter(j => j.status === "completed").length}/{s.jobResults.length} jobs done
                  </span>
                  <span>{new Date(s.startedAt).toLocaleTimeString("en-GB")}</span>
                </div>
              ))}
            </CardContent>
          )}
        </Card>
      )}
      {!automationStatus && !automationStatusQuery.isLoading && (
        <Card>
          <CardContent className="py-3 text-sm text-muted-foreground">
            You need admin access to view or trigger the Financial Summary automation.
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
        </TabsList>
        <TabsContent value={currentMonth}>
          <MonthGrid month={currentMonth} showTitle={false} />
        </TabsContent>
        <TabsContent value={nextMonth}>
          <MonthGrid month={nextMonth} showTitle={false} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
