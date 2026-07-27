import { useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, ReferenceDot, CartesianGrid,
} from "recharts";
import {
  TrendingUp, TrendingDown, Minus, Upload, Bot,
  Calendar, RefreshCw, AlertTriangle, CheckCircle, Zap, Building2,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { clientLogger } from "@/lib/logger";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import type { ProcessingResult, CapacityAnalysisSummary } from "@shared/schema";

interface SmartHeroProps {
  processedData: ProcessingResult | null;
  allHistoryData: CapacityAnalysisSummary[] | undefined;
  lastSyncedAt?: string | null;
  selectedWeekId: string | null;
  handleWeekChange: (value: string) => void;
  onUploadClick: () => void;
  onProcessClick: () => void;
  isLoadingLatest: boolean;
}

// ── Narrative builder ──────────────────────────────────────────────────────────

function buildNarrative(data: ProcessingResult, prevWeekData: CapacityAnalysisSummary | undefined) {
  const net            = data.kpis.netCapacitySum ?? 0;
  const desired        = data.kpis.totalDesiredHoursSum ?? 0;
  const clientRequired = data.kpis.clientRequiredSum ?? 0;
  const clientSched    = data.kpis.clientScheduledHoursSum ?? 0;

  const supplyPct       = desired > 0 ? (net / desired) * 100 : 0;
  const demandCoverage  = clientRequired > 0 ? (clientSched / clientRequired) * 100 : 0;
  const prevNet         = prevWeekData?.kpis?.netCapacitySum ?? 0;
  const wowPct          = prevNet > 0 ? ((net - prevNet) / prevNet) * 100 : null;

  const activeCaregivers = (() => {
    if (!data.employeesByDate) return 0;
    const names = new Set<string>();
    Object.values(data.employeesByDate).forEach(emps =>
      emps.forEach(e => { if ((e.netCapacity ?? 0) > 0) names.add(e.employeeName); })
    );
    return names.size;
  })();

  const weekendGap = (() => {
    if (!data.dailySummary?.length) return null;
    const wdAvg = data.dailySummary.filter(d => { const v = new Date(d.date).getUTCDay(); return v >= 1 && v <= 5; });
    const weAvg = data.dailySummary.filter(d => { const v = new Date(d.date).getUTCDay(); return v === 0 || v === 6; });
    if (!wdAvg.length || !weAvg.length) return null;
    const avgWd = wdAvg.reduce((s, d) => s + (d.netCapacity ?? 0), 0) / wdAvg.length;
    const avgWe = weAvg.reduce((s, d) => s + (d.netCapacity ?? 0), 0) / weAvg.length;
    return avgWd > 0 ? ((avgWd - avgWe) / avgWd) * 100 : null;
  })();

  const shortDays = (data.dailySummary ?? [])
    .filter(d => (d.clientRequired ?? 0) > (d.netCapacity ?? 0))
    .map(d => new Date(d.date).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }));

  let status: "on track" | "under pressure" | "at risk" = "on track";
  if (supplyPct < 65)       status = "at risk";
  else if (supplyPct < 82)  status = "under pressure";

  let insight = "holding steady across the week";
  if (weekendGap !== null && weekendGap > 25)       insight = "with a weekend gap worth watching";
  else if (weekendGap !== null && weekendGap < -10) insight = "with strong weekend coverage";
  else if (wowPct !== null && wowPct > 3)           insight = "with capacity up vs last week";
  else if (wowPct !== null && wowPct < -3)          insight = "with capacity down vs last week";

  return {
    status,
    headline: `Your week is ${status}, ${insight}.`,
    net:              Math.round(net * 10) / 10,
    desired:          Math.round(desired * 10) / 10,
    supplyPct:        Math.round(supplyPct * 10) / 10,
    demandCoverage:   Math.round(demandCoverage),
    activeCaregivers,
    wowPct:           wowPct !== null ? Math.round(wowPct * 10) / 10 : null,
    shortDays,
    drainHours: Math.round(((data.kpis.sicknessSum ?? 0) + (data.kpis.unavailabilitySum ?? 0) + (data.kpis.holidaysSum ?? 0)) * 10) / 10,
  };
}

function formatWeekRange(startDate: string, endDate: string) {
  try {
    const start    = new Date(startDate);
    const end      = new Date(endDate);
    const startDay = start.getUTCDate();
    const endDay   = end.getUTCDate();
    const month    = start.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
    const year     = start.getUTCFullYear();
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return { range: `${startDay}–${endDay} ${month} ${year}`, weekNum };
  } catch {
    return { range: startDate, weekNum: null };
  }
}

// ── Status badge config ────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  "on track": {
    icon: CheckCircle,
    label: "On Track",
    badge: "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    headlineClass: "text-emerald-600 dark:text-emerald-400",
    bar: "bg-emerald-500",
    strip: "bg-emerald-500",
  },
  "under pressure": {
    icon: AlertTriangle,
    label: "Under Pressure",
    badge: "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    headlineClass: "text-amber-500 dark:text-amber-400",
    bar: "bg-amber-500",
    strip: "bg-amber-500",
  },
  "at risk": {
    icon: Zap,
    label: "At Risk",
    badge: "bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800",
    headlineClass: "text-red-600 dark:text-red-400",
    bar: "bg-red-500",
    strip: "bg-red-500",
  },
} as const;

// ── Time-of-day greeting ───────────────────────────────────────────────────────

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ── Main component ────────────────────────────────────────────────────────────

export function SmartHero({
  processedData,
  allHistoryData,
  lastSyncedAt,
  selectedWeekId,
  handleWeekChange,
  onUploadClick,
  onProcessClick,
}: SmartHeroProps) {
  const data = processedData;
  const { user } = useAuth();
  const { branches, selectedBranchId } = useBranch();
  const selectedBranch = branches.find(b => b.id === selectedBranchId);
  const firstName = user?.displayName?.split(" ")[0] ?? "";

  const sortedHistory = useMemo(() => {
    if (!allHistoryData) return [];
    return [...allHistoryData]
      .filter(a => a.weekStartDate)
      .sort((a, b) => new Date(a.weekStartDate!).getTime() - new Date(b.weekStartDate!).getTime());
  }, [allHistoryData]);

  const currentIndex = useMemo(() => {
    if (!data || !sortedHistory.length) return -1;
    const d = data.dailySummary?.[0]?.date?.slice(0, 10);
    if (!d) return sortedHistory.length - 1;
    const idx = sortedHistory.findIndex(h => h.weekStartDate === d);
    return idx >= 0 ? idx : sortedHistory.length - 1;
  }, [data, sortedHistory]);

  const prevWeekData = useMemo(() =>
    currentIndex > 0 ? sortedHistory[currentIndex - 1] : undefined
  , [sortedHistory, currentIndex]);

  // ── helper: ISO week number ───────────────────────────────────────────────
  function isoWeek(d: Date) {
    const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
    const yr = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    return Math.ceil((((tmp.getTime() - yr.getTime()) / 86400000) + 1) / 7);
  }

  // ── all processed weeks ────────────────────────────────────────────────────
  const allWeeksData = useMemo(() => {
    const ci = currentIndex >= 0 ? currentIndex : sortedHistory.length - 1;
    return sortedHistory.map((h, i) => {
      const d = h.weekStartDate ? new Date(h.weekStartDate) : null;
      const shortDate = d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : null;
      return {
        label:      shortDate ?? `Wk ${i + 1}`,
        subLabel:   shortDate ?? "",
        net:        Math.round((h.kpis?.netCapacitySum      ?? 0) * 10) / 10,
        required:   Math.round((h.kpis?.clientRequiredSum   ?? 0) * 10) / 10,
        isCurrent:  i === ci,
        isProjected: false,
        projNet:    undefined as number | undefined,
        projReq:    undefined as number | undefined,
      };
    });
  }, [sortedHistory, currentIndex]);

  // ── linear-regression projection (next week) ──────────────────────────────
  const lineChartData = useMemo(() => {
    if (allWeeksData.length === 0) return allWeeksData;

    const base = allWeeksData.map(d => ({ ...d }));

    if (allWeeksData.length >= 2) {
      const recent = allWeeksData.slice(-Math.min(6, allWeeksData.length));
      const n = recent.length;
      const sumX   = recent.reduce((s, _, i) => s + i, 0);
      const sumX2  = recent.reduce((s, _, i) => s + i * i, 0);
      const denom  = n * sumX2 - sumX * sumX;

      function linReg(vals: number[]) {
        const sumY  = vals.reduce((s, v) => s + v, 0);
        const sumXY = vals.reduce((s, v, i) => s + i * v, 0);
        const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
        const intercept = (sumY - slope * sumX) / n;
        return Math.max(0, Math.round((slope * n + intercept) * 10) / 10);
      }

      const projNet = linReg(recent.map(d => d.net));
      const projReq = linReg(recent.map(d => d.required));

      // Bridge: last real point also participates in the dashed series
      base[base.length - 1].projNet = base[base.length - 1].net;
      base[base.length - 1].projReq = base[base.length - 1].required;

      // Next week label
      const nextLabel = "Next";

      base.push({
        label: nextLabel, subLabel: "forecast",
        net: undefined as any, required: undefined as any,
        isCurrent: false, isProjected: true,
        projNet, projReq,
      });
    }

    return base;
  }, [allWeeksData]);

  // keep fourWeekData for the WoW badge
  const fourWeekData = useMemo(() => {
    const end   = currentIndex >= 0 ? currentIndex : sortedHistory.length - 1;
    const start = Math.max(0, end - 3);
    return sortedHistory.slice(start, end + 1).map((h, i, arr) => {
      const d = h.weekStartDate ? new Date(h.weekStartDate) : null;
      const shortDate = d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : null;
      return {
        label:     shortDate ?? `Wk ${i + 1}`,
        subLabel:  shortDate ?? "",
        net:       Math.round((h.kpis?.netCapacitySum ?? 0) * 10) / 10,
        required:  Math.round((h.kpis?.clientRequiredSum ?? 0) * 10) / 10,
        scheduled: Math.round((h.kpis?.clientScheduledHoursSum ?? 0) * 10) / 10,
        isCurrent: i === arr.length - 1,
      };
    });
  }, [sortedHistory, currentIndex]);

  const narrative = useMemo(() => {
    if (!data) return null;
    try { return buildNarrative(data, prevWeekData); }
    catch (e) { clientLogger.error("SmartHero narrative error", e); return null; }
  }, [data, prevWeekData]);

  const weekLabel = useMemo(() => {
    if (!data?.dailySummary?.length) return null;
    const s = data.dailySummary[0].date?.slice(0, 10);
    const e = data.dailySummary[data.dailySummary.length - 1].date?.slice(0, 10);
    if (!s || !e) return null;
    return formatWeekRange(s, e);
  }, [data]);

  const WoWIcon = narrative?.wowPct == null ? Minus
    : narrative.wowPct > 0 ? TrendingUp : TrendingDown;
  const wowColor = narrative?.wowPct == null ? "text-gray-400"
    : narrative.wowPct > 0 ? "text-emerald-500" : "text-red-500";

  const cfg = narrative ? STATUS_CONFIG[narrative.status] : null;
  const StatusIcon = cfg?.icon ?? CheckCircle;

  return (
    <div className="border-b border-border bg-background shrink-0">
      {/* Status colour strip */}
      {cfg && <div className={`h-0.5 w-full ${cfg.strip}`} />}

      <div className="w-full px-6 pt-4 pb-2">
        {/* ── Welcome row ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 mb-3">
          {firstName && (
            <span className="text-sm text-muted-foreground">
              {greeting()}, <strong className="text-foreground font-semibold">{firstName}</strong>
            </span>
          )}
          {selectedBranch && (
            <span className="text-sm text-muted-foreground">
              · <span className="font-medium text-foreground">{selectedBranch.displayName}</span>
            </span>
          )}
        </div>

        <div className="flex items-start gap-6 flex-wrap lg:flex-nowrap">
          {/* ── Left: narrative + controls ── */}
          <div className="flex-1 min-w-[320px]">
            {data && narrative && cfg ? (
              <>
                {/* Status + week context */}
                <div className="flex items-center gap-2 mb-2">
                  <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${cfg.badge}`}>
                    <StatusIcon className="w-3 h-3" />
                    {cfg.label}
                  </span>
                  {weekLabel && (
                    <span className="text-[11px] text-muted-foreground">
                      Week {weekLabel.weekNum} · {weekLabel.range}
                    </span>
                  )}
                </div>

                {/* Headline */}
                <h1 className="text-[22px] font-bold text-foreground leading-tight mb-1.5 tracking-tight">
                  {(() => {
                    const m = narrative.headline.match(/^(Your week is )([^,]+)(,.*)$/);
                    if (!m) return narrative.headline;
                    return <>{m[1]}<span className={cfg.headlineClass}>{m[2]}</span>{m[3]}</>;
                  })()}
                </h1>

                {/* Sub-narrative */}
                <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                  Net capacity is <strong className="text-foreground">{narrative.net}h</strong> across{" "}
                  <strong className="text-foreground">{narrative.activeCaregivers} caregivers</strong>
                  {narrative.wowPct !== null && (
                    <>, {narrative.wowPct > 0 ? "up" : "down"}{" "}
                      <strong className={wowColor}>{Math.abs(narrative.wowPct)}%</strong> vs last week</>
                  )}
                  {narrative.demandCoverage > 0 && (
                    <>. Client scheduling covers{" "}
                      <strong className="text-foreground">{narrative.demandCoverage}%</strong> of demand</>
                  )}.
                </p>

                {/* Stat chips */}
                <div className="flex flex-wrap gap-2 mb-3">
                  <div className="flex items-center gap-2 bg-muted/60 rounded-lg px-3 py-1.5">
                    <div className="text-right">
                      <div className="text-sm font-bold text-foreground">{narrative.supplyPct}%</div>
                      <div className="text-[10px] text-muted-foreground leading-none">supply</div>
                    </div>
                    <div className="w-16 h-1.5 rounded-full bg-border overflow-hidden">
                      <div className={`h-full rounded-full ${cfg.bar}`} style={{ width: `${Math.min(narrative.supplyPct, 100)}%` }} />
                    </div>
                  </div>

                  {narrative.demandCoverage > 0 && (
                    <div className="flex items-center gap-2 bg-muted/60 rounded-lg px-3 py-1.5">
                      <div className="text-right">
                        <div className="text-sm font-bold text-foreground">{narrative.demandCoverage}%</div>
                        <div className="text-[10px] text-muted-foreground leading-none">demand met</div>
                      </div>
                      <div className="w-16 h-1.5 rounded-full bg-border overflow-hidden">
                        <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(narrative.demandCoverage, 100)}%` }} />
                      </div>
                    </div>
                  )}

                  {narrative.drainHours > 0 && (
                    <div className="flex items-center gap-1.5 bg-muted/60 rounded-lg px-3 py-1.5">
                      <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />
                      <div>
                        <div className="text-sm font-bold text-foreground">{narrative.drainHours}h</div>
                        <div className="text-[10px] text-muted-foreground leading-none">capacity lost</div>
                      </div>
                    </div>
                  )}
                </div>


                {/* Action bar — row 1: buttons */}
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <Button onClick={onUploadClick} size="sm" className="h-8 px-4 text-xs bg-emerald-700 hover:bg-emerald-800 text-white border-0 shadow-sm">
                    <Upload className="w-3.5 h-3.5 mr-1.5" />
                    Upload New Data
                  </Button>
                  <Button onClick={onProcessClick} variant="outline" size="sm" className="h-8 px-4 text-xs border-border hover:bg-muted">
                    <Bot className="w-3.5 h-3.5 mr-1.5" />
                    Process Data
                  </Button>
                </div>

                {/* Action bar — row 2: week nav + sync */}
                {data && weekLabel && (
                  <div className="flex items-center gap-1">
                    {/* ← Previous week */}
                    <button
                      onClick={() => {
                        const prev = sortedHistory[currentIndex - 1];
                        if (prev) handleWeekChange(prev.id);
                      }}
                      disabled={currentIndex <= 0}
                      title="Previous week"
                      className="w-7 h-8 flex items-center justify-center rounded-md border border-border bg-background hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>

                    {/* Week label + dropdown */}
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground border border-border rounded-md px-2.5 h-8 bg-background">
                      <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                      <Select value={selectedWeekId || "latest"} onValueChange={handleWeekChange}>
                        <SelectTrigger className="border-0 p-0 h-auto text-xs font-medium text-foreground bg-transparent shadow-none focus:ring-0 w-auto min-w-[10rem] max-w-[14rem]">
                          <SelectValue>
                            Week · {weekLabel.range}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectItem value="latest">Current Week</SelectItem>
                          {(() => {
                            const now = new Date();
                            const day = now.getUTCDay();
                            const diff = day === 0 ? -6 : 1 - day;
                            const mon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff));
                            const lo = new Date(mon); lo.setUTCDate(lo.getUTCDate() - 14);
                            const hi = new Date(mon); hi.setUTCDate(hi.getUTCDate() + 13 * 7);
                            return allHistoryData
                              ?.filter(a => { if (!a.weekStartDate) return false; const d = new Date(a.weekStartDate); return d >= lo && d <= hi; })
                              .map(a => {
                                try {
                                  if (!a.weekStartDate || !a.weekEndDate) return null;
                                  const { range, weekNum } = formatWeekRange(a.weekStartDate, a.weekEndDate);
                                  return (
                                    <SelectItem key={a.id} value={a.id}>
                                      {range}
                                    </SelectItem>
                                  );
                                } catch { return null; }
                              })
                              .filter(Boolean);
                          })()}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* → Next week */}
                    <button
                      onClick={() => {
                        const next = sortedHistory[currentIndex + 1];
                        if (next) handleWeekChange(next.id);
                      }}
                      disabled={currentIndex >= sortedHistory.length - 1}
                      title="Next week"
                      className="w-7 h-8 flex items-center justify-center rounded-md border border-border bg-background hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>

                    {/* Last sync */}
                    {lastSyncedAt && (
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground ml-1 whitespace-nowrap">
                        <RefreshCw className="w-3 h-3 shrink-0" />
                        {new Date(lastSyncedAt).toLocaleString("en-GB", {
                          day: "numeric", month: "short",
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </span>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <h1 className="text-[22px] font-bold text-foreground leading-tight mb-1.5 tracking-tight">
                  Care Capacity Dashboard
                </h1>
                <p className="text-sm text-muted-foreground mb-3">
                  Upload or sync data to see your week's capacity story.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={onUploadClick} size="sm" className="h-8 px-4 text-xs bg-emerald-700 hover:bg-emerald-800 text-white border-0 shadow-sm">
                    <Upload className="w-3.5 h-3.5 mr-1.5" />
                    Upload New Data
                  </Button>
                  <Button onClick={onProcessClick} variant="outline" size="sm" className="h-8 px-4 text-xs border-border hover:bg-muted">
                    <Bot className="w-3.5 h-3.5 mr-1.5" />
                    Process Data
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* ── Right: all-weeks trend chart ── */}
          {narrative && cfg && (
            <div className="flex-1 min-w-[400px] border border-border rounded-xl bg-card p-4 shadow-sm">
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="text-[11px] font-semibold text-foreground">Capacity vs Demand Trend</span>
                  <p className="text-[10px] text-muted-foreground leading-none mt-0.5">
                    All {lineChartData.filter(d => !d.isProjected).length} processed weeks
                    {lineChartData.some(d => d.isProjected) && " · 1 week forecast"}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  {narrative.wowPct !== null && (
                    <span className={`flex items-center gap-0.5 font-bold rounded-full px-1.5 py-0.5 ${
                      narrative.wowPct > 0
                        ? "bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400"
                        : "bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400"
                    }`}>
                      <WoWIcon className="w-2.5 h-2.5" />
                      {narrative.wowPct > 0 ? "+" : ""}{narrative.wowPct}% vs prev wk
                    </span>
                  )}
                  <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-[#2c4f26] inline-block rounded" />Net cap</span>
                  <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-amber-500 inline-block rounded" />Required</span>
                </div>
              </div>

              {lineChartData.length > 1 ? (
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={lineChartData} margin={{ top: 10, right: 6, left: -10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="heroNetGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor="#2c4f26" stopOpacity={0.22} />
                          <stop offset="100%" stopColor="#2c4f26" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="heroReqGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor="#f59e0b" stopOpacity={0.16} />
                          <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.01} />
                        </linearGradient>
                      </defs>

                      <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} opacity={0.7} />

                      <XAxis
                        dataKey="label"
                        tick={({ x, y, payload, index }: any) => {
                          const d = lineChartData[index];
                          return (
                            <g transform={`translate(${x},${y})`}>
                              <text x={0} y={0} dy={11} textAnchor="middle"
                                fontSize={9.5}
                                fill={d?.isCurrent ? "#2c4f26" : d?.isProjected ? "#f59e0b" : "var(--muted-foreground)"}
                                fontWeight={d?.isCurrent ? 700 : 400}
                                fontStyle={d?.isProjected ? "italic" : "normal"}>
                                {payload.value}
                              </text>
                            </g>
                          );
                        }}
                        interval={0}
                        height={20}
                        axisLine={false}
                        tickLine={false}
                      />

                      <YAxis
                        tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                        axisLine={false}
                        tickLine={false}
                        width={46}
                        tickFormatter={(v) => `${v}h`}
                      />

                      {/* Current-week reference line */}
                      {lineChartData.some(d => d.isCurrent) && (
                        <ReferenceLine
                          x={lineChartData.find(d => d.isCurrent)?.label}
                          stroke="#2c4f26"
                          strokeDasharray="3 2"
                          strokeWidth={1.5}
                          opacity={0.45}
                          label={{ value: "now", position: "top", fontSize: 8.5, fill: "#2c4f26", fontWeight: 700 }}
                        />
                      )}

                      {/* Tooltip */}
                      <Tooltip
                        content={({ active, payload, label }: any) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0]?.payload;
                          const netVal = d?.net      ?? d?.projNet;
                          const reqVal = d?.required ?? d?.projReq;
                          const deficit = netVal != null && reqVal != null && reqVal > netVal
                            ? Math.round((reqVal - netVal) * 10) / 10 : null;
                          const surplus = netVal != null && reqVal != null && netVal > reqVal
                            ? Math.round((netVal - reqVal) * 10) / 10 : null;
                          return (
                            <div className="bg-popover border border-border rounded-xl px-3 py-2.5 text-xs shadow-xl">
                              <div className="font-semibold text-foreground mb-1.5 flex items-center gap-1.5">
                                {label}
                                {d?.subLabel && <span className="text-muted-foreground font-normal">· {d.subLabel}</span>}
                                {d?.isProjected && <span className="text-[10px] italic px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950 text-amber-600">forecast</span>}
                                {d?.isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950 text-emerald-700">current</span>}
                              </div>
                              <div className="space-y-1 min-w-[150px]">
                                {netVal != null && (
                                  <div className="flex justify-between gap-4">
                                    <span className="flex items-center gap-1.5 text-muted-foreground"><span className="w-2.5 h-2.5 rounded-sm bg-[#2c4f26] inline-block" />Net capacity</span>
                                    <span className="font-semibold">{netVal}h</span>
                                  </div>
                                )}
                                {reqVal != null && (
                                  <div className="flex justify-between gap-4">
                                    <span className="flex items-center gap-1.5 text-muted-foreground"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" />Required</span>
                                    <span className="font-semibold text-amber-600">{reqVal}h</span>
                                  </div>
                                )}
                                {deficit != null && (
                                  <div className="flex justify-between gap-4 pt-1 mt-0.5 border-t border-border text-red-500 font-bold">
                                    <span>⚠ Deficit</span><span>−{deficit}h</span>
                                  </div>
                                )}
                                {surplus != null && surplus > 0 && (
                                  <div className="flex justify-between gap-4 pt-1 mt-0.5 border-t border-border text-emerald-600">
                                    <span>✓ Surplus</span><span>+{surplus}h</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        }}
                      />

                      {/* Gradient area fills — actuals */}
                      <Area
                        type="monotone" dataKey="net"
                        stroke="#2c4f26" strokeWidth={3.5}
                        fill="url(#heroNetGrad)" fillOpacity={1}
                        dot={({ cx, cy, payload }: any) => {
                          if (payload.isProjected) return <g key={`dn-${payload.label}`} />;
                          return (
                            <circle key={`dn-${payload.label}`} cx={cx} cy={cy}
                              r={payload.isCurrent ? 5 : 3}
                              fill={payload.isCurrent ? "#2c4f26" : "white"}
                              stroke="#2c4f26" strokeWidth={payload.isCurrent ? 0 : 1.5}
                            />
                          );
                        }}
                        activeDot={{ r: 5, fill: "#2c4f26", stroke: "white", strokeWidth: 2 }}
                        connectNulls={false}
                      />
                      <Area
                        type="monotone" dataKey="required"
                        stroke="#f59e0b" strokeWidth={3}
                        fill="url(#heroReqGrad)" fillOpacity={1}
                        dot={({ cx, cy, payload }: any) => {
                          if (payload.isProjected) return <g key={`dr-${payload.label}`} />;
                          return (
                            <circle key={`dr-${payload.label}`} cx={cx} cy={cy}
                              r={payload.isCurrent ? 5 : 3}
                              fill={payload.isCurrent ? "#f59e0b" : "white"}
                              stroke="#f59e0b" strokeWidth={payload.isCurrent ? 0 : 1.5}
                            />
                          );
                        }}
                        activeDot={{ r: 5, fill: "#f59e0b", stroke: "white", strokeWidth: 2 }}
                        connectNulls={false}
                      />

                      {/* Dashed projected bridge */}
                      <Area type="monotone" dataKey="projNet" stroke="#2c4f26" strokeWidth={1.5} strokeDasharray="5 3" fill="none" dot={false} connectNulls={false} legendType="none" />
                      <Area type="monotone" dataKey="projReq" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3" fill="none" dot={false} connectNulls={false} legendType="none" />

                      {/* Forecast endpoint dots */}
                      {lineChartData.some(d => d.isProjected) && (() => {
                        const proj = lineChartData[lineChartData.length - 1];
                        return (
                          <>
                            {proj.projNet != null && <ReferenceDot x={proj.label} y={proj.projNet} r={5} fill="#2c4f26" stroke="white" strokeWidth={2} />}
                            {proj.projReq != null && <ReferenceDot x={proj.label} y={proj.projReq} r={5} fill="#f59e0b" stroke="white" strokeWidth={2} />}
                          </>
                        );
                      })()}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-40 flex flex-col items-center justify-center gap-1">
                  <div className="text-3xl font-bold text-foreground tracking-tight">{narrative.net}h</div>
                  <div className="text-xs text-muted-foreground">net capacity this week</div>
                  <p className="text-[10px] text-muted-foreground mt-2">Upload more weeks to build the trend</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
