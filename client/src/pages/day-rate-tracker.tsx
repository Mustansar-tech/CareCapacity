import { useState, useMemo, useEffect, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { toAbsoluteUrl } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PoundSterling, Home } from "lucide-react";

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

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DayRateTrackerPage() {
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const monthsQuery = useQuery<string[]>({
    queryKey: ["/api/day-rate/months"],
    queryFn: async () => {
      const res = await fetch(toAbsoluteUrl("/api/day-rate/months"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load reporting months");
      return res.json();
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!selectedMonth && monthsQuery.data && monthsQuery.data.length > 0) {
      setSelectedMonth(monthsQuery.data[monthsQuery.data.length - 1]);
    }
  }, [monthsQuery.data, selectedMonth]);

  const gridQuery = useQuery<DayRateGrid>({
    queryKey: ["/api/day-rate/grid", selectedMonth],
    queryFn: async () => {
      const res = await fetch(
        toAbsoluteUrl(`/api/day-rate/grid?month=${selectedMonth}`),
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load day rate grid");
      return res.json();
    },
    enabled: !!selectedMonth,
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
    <div className="p-6 space-y-6" data-testid="page-day-rate-tracker">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <PoundSterling className="h-6 w-6 text-primary" />
            Day Rate Tracker
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cumulative month-to-date revenue and day rate, per franchise, from the People Planner Financial Summary.
          </p>
        </div>

        <Select
          value={selectedMonth ?? undefined}
          onValueChange={setSelectedMonth}
          disabled={!monthsQuery.data || monthsQuery.data.length === 0}
        >
          <SelectTrigger className="w-56" data-testid="select-reporting-month">
            <SelectValue placeholder="Select reporting month" />
          </SelectTrigger>
          <SelectContent>
            {monthsQuery.data?.slice().reverse().map((m) => (
              <SelectItem key={m} value={m}>{formatMonthLabel(m)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {gridQuery.isLoading && (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Loading…</CardContent></Card>
      )}

      {gridQuery.isError && (
        <Card><CardContent className="py-10 text-center text-destructive">Failed to load the day rate grid.</CardContent></Card>
      )}

      {grid && grid.dates.length === 0 && !gridQuery.isLoading && (
        <Card><CardContent className="py-10 text-center text-muted-foreground">No data for this reporting month yet.</CardContent></Card>
      )}

      {grid && grid.dates.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Reporting Month</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">{formatMonthLabel(grid.reportingMonth)}</CardContent>
            </Card>
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
                <table className="border-collapse text-sm w-full" data-testid="table-day-rate-grid">
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
