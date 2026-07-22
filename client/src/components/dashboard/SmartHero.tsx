import { useMemo } from "react";
import { LineChart, Line, ResponsiveContainer, Tooltip } from "recharts";
import { TrendingUp, TrendingDown, Minus, Upload, Bot, Calendar, RefreshCw, AlertTriangle, CheckCircle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { clientLogger } from "@/lib/logger";
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

function buildNarrative(data: ProcessingResult, prevWeekData: CapacityAnalysisSummary | undefined) {
  const net = data.kpis.netCapacitySum ?? 0;
  const desired = data.kpis.totalDesiredHoursSum ?? 0;
  const clientRequired = data.kpis.clientRequiredSum ?? 0;
  const clientScheduled = data.kpis.clientScheduledHoursSum ?? 0;

  const supplyPct = desired > 0 ? (net / desired) * 100 : 0;
  const demandCoveragePct = clientRequired > 0 ? (clientScheduled / clientRequired) * 100 : 0;

  const prevNet = prevWeekData?.kpis?.netCapacitySum ?? 0;
  const wowPct = prevNet > 0 ? ((net - prevNet) / prevNet) * 100 : null;

  const activeCaregivers = (() => {
    if (!data.employeesByDate) return 0;
    const names = new Set<string>();
    Object.values(data.employeesByDate).forEach(employees =>
      employees.forEach(e => { if ((e.netCapacity ?? 0) > 0) names.add(e.employeeName); })
    );
    return names.size;
  })();

  const weekendGap = (() => {
    if (!data.dailySummary || data.dailySummary.length === 0) return null;
    const weekdays = data.dailySummary.filter(d => { const day = new Date(d.date).getUTCDay(); return day >= 1 && day <= 5; });
    const weekend  = data.dailySummary.filter(d => { const day = new Date(d.date).getUTCDay(); return day === 0 || day === 6; });
    if (weekdays.length === 0 || weekend.length === 0) return null;
    const avgWeekday = weekdays.reduce((s, d) => s + (d.netCapacity ?? 0), 0) / weekdays.length;
    const avgWeekend = weekend.reduce((s, d) => s + (d.netCapacity ?? 0), 0) / weekend.length;
    return avgWeekday > 0 ? ((avgWeekday - avgWeekend) / avgWeekday) * 100 : null;
  })();

  // Short days
  const shortDays = (data.dailySummary ?? [])
    .filter(d => (d.clientRequired ?? 0) > (d.netCapacity ?? 0))
    .map(d => new Date(d.date).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }));

  let status: "on track" | "under pressure" | "at risk" = "on track";
  if (supplyPct < 65) { status = "at risk"; }
  else if (supplyPct < 82) { status = "under pressure"; }

  let insight = "";
  if (weekendGap !== null && weekendGap > 25)       insight = "with a weekend gap worth watching";
  else if (weekendGap !== null && weekendGap < -10) insight = "with strong weekend coverage";
  else if (wowPct !== null && wowPct > 3)           insight = "with capacity up vs last week";
  else if (wowPct !== null && wowPct < -3)          insight = "with capacity down vs last week";
  else                                               insight = "holding steady across the week";

  return {
    status,
    headline: `Your week is ${status}, ${insight}.`,
    net: Math.round(net * 10) / 10,
    desired: Math.round(desired * 10) / 10,
    supplyPct: Math.round(supplyPct * 10) / 10,
    demandCoveragePct: Math.round(demandCoveragePct),
    activeCaregivers,
    wowPct: wowPct !== null ? Math.round(wowPct * 10) / 10 : null,
    weekendGap,
    shortDays,
    sickness: Math.round((data.kpis.sicknessSum ?? 0) * 10) / 10,
    unavail:  Math.round((data.kpis.unavailabilitySum ?? 0) * 10) / 10,
    holidays: Math.round((data.kpis.holidaysSum ?? 0) * 10) / 10,
  };
}

function formatWeekRange(startDate: string, endDate: string) {
  try {
    const start = new Date(startDate);
    const end   = new Date(endDate);
    const startDay = start.getUTCDate();
    const endDay   = end.getUTCDate();
    const month = start.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
    const year  = start.getUTCFullYear();
    const weekNum = (() => {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
      d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    })();
    return { range: `${startDay}–${endDay} ${month} ${year}`, weekNum };
  } catch {
    return { range: startDate, weekNum: null };
  }
}

// ── Status badge config ───────────────────────────────────────────────────────

const STATUS_CONFIG = {
  "on track": {
    icon: CheckCircle,
    label: "On Track",
    badge: "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    headline: "text-emerald-600 dark:text-emerald-400",
    bar: "bg-emerald-500",
    strip: "bg-emerald-500",
  },
  "under pressure": {
    icon: AlertTriangle,
    label: "Under Pressure",
    badge: "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    headline: "text-amber-500 dark:text-amber-400",
    bar: "bg-amber-500",
    strip: "bg-amber-500",
  },
  "at risk": {
    icon: Zap,
    label: "At Risk",
    badge: "bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800",
    headline: "text-red-600 dark:text-red-400",
    bar: "bg-red-500",
    strip: "bg-red-500",
  },
} as const;

export function SmartHero({
  processedData,
  allHistoryData,
  lastSyncedAt,
  selectedWeekId,
  handleWeekChange,
  onUploadClick,
  onProcessClick,
  isLoadingLatest,
}: SmartHeroProps) {
  const data = processedData;

  const sortedHistory = useMemo(() => {
    if (!allHistoryData) return [];
    return [...allHistoryData]
      .filter(a => a.weekStartDate)
      .sort((a, b) => new Date(a.weekStartDate!).getTime() - new Date(b.weekStartDate!).getTime());
  }, [allHistoryData]);

  const currentIndex = useMemo(() => {
    if (!data || !sortedHistory.length) return -1;
    const currentDate = data.dailySummary?.[0]?.date?.slice(0, 10);
    if (!currentDate) return sortedHistory.length - 1;
    const idx = sortedHistory.findIndex(h => h.weekStartDate === currentDate);
    return idx >= 0 ? idx : sortedHistory.length - 1;
  }, [data, sortedHistory]);

  const prevWeekData = useMemo(() => {
    if (currentIndex <= 0) return undefined;
    return sortedHistory[currentIndex - 1];
  }, [sortedHistory, currentIndex]);

  const sparklineData = useMemo(() => {
    const end   = currentIndex >= 0 ? currentIndex : sortedHistory.length - 1;
    const start = Math.max(0, end - 6);
    return sortedHistory.slice(start, end + 1).map((h, i, arr) => ({
      label: h.weekStartDate ? new Date(h.weekStartDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : `Week ${i + 1}`,
      net: Math.round((h.kpis?.netCapacitySum ?? 0) * 10) / 10,
      isLast: i === arr.length - 1,
    }));
  }, [sortedHistory, currentIndex]);

  const narrative = useMemo(() => {
    if (!data) return null;
    try { return buildNarrative(data, prevWeekData); }
    catch (e) { clientLogger.error("SmartHero narrative error", e); return null; }
  }, [data, prevWeekData]);

  const weekLabel = useMemo(() => {
    if (!data?.dailySummary?.length) return null;
    const startDate = data.dailySummary[0].date?.slice(0, 10);
    const endDate   = data.dailySummary[data.dailySummary.length - 1].date?.slice(0, 10);
    if (!startDate || !endDate) return null;
    return formatWeekRange(startDate, endDate);
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

      <div className="w-full px-6 py-4">
        <div className="flex items-start gap-6 flex-wrap lg:flex-nowrap">

          {/* ── Left: narrative + controls ── */}
          <div className="flex-1 min-w-0">
            {data && narrative && cfg ? (
              <>
                {/* Status badge */}
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
                <h1 className="text-2xl font-bold text-foreground leading-tight mb-1.5 tracking-tight">
                  {(() => {
                    const txt   = narrative.headline;
                    const match = txt.match(/^(Your week is )([^,]+)(,.*)$/);
                    if (!match) return txt;
                    return (<>{match[1]}<span className={cfg.headline}>{match[2]}</span>{match[3]}</>);
                  })()}
                </h1>

                {/* Sub-narrative */}
                <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                  Net capacity is{" "}
                  <strong className="text-foreground">{narrative.net}h</strong>
                  {" "}across{" "}
                  <strong className="text-foreground">{narrative.activeCaregivers} caregivers</strong>
                  {narrative.wowPct !== null && (
                    <>, {narrative.wowPct > 0 ? "up" : "down"}{" "}
                      <strong className={wowColor}>{Math.abs(narrative.wowPct)}%</strong>
                      {" "}vs last week</>
                  )}
                  {narrative.demandCoveragePct > 0 && (
                    <>. Client scheduling covers{" "}
                      <strong className="text-foreground">{narrative.demandCoveragePct}%</strong>
                      {" "}of demand</>
                  )}.
                </p>

                {/* Inline stat chips */}
                <div className="flex flex-wrap gap-2 mb-3">
                  {/* Supply */}
                  <div className="flex items-center gap-2 bg-muted/60 rounded-lg px-3 py-1.5">
                    <div className="text-right">
                      <div className="text-sm font-bold text-foreground">{narrative.supplyPct}%</div>
                      <div className="text-[10px] text-muted-foreground leading-none">supply</div>
                    </div>
                    <div className="w-16 h-1.5 rounded-full bg-border overflow-hidden">
                      <div className={`h-full rounded-full ${cfg.bar}`} style={{ width: `${Math.min(narrative.supplyPct, 100)}%` }} />
                    </div>
                  </div>
                  {/* Demand coverage */}
                  {narrative.demandCoveragePct > 0 && (
                    <div className="flex items-center gap-2 bg-muted/60 rounded-lg px-3 py-1.5">
                      <div className="text-right">
                        <div className="text-sm font-bold text-foreground">{narrative.demandCoveragePct}%</div>
                        <div className="text-[10px] text-muted-foreground leading-none">demand met</div>
                      </div>
                      <div className="w-16 h-1.5 rounded-full bg-border overflow-hidden">
                        <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(narrative.demandCoveragePct, 100)}%` }} />
                      </div>
                    </div>
                  )}
                  {/* Capacity drain chip */}
                  {(narrative.sickness + narrative.unavail + narrative.holidays) > 0 && (
                    <div className="flex items-center gap-1.5 bg-muted/60 rounded-lg px-3 py-1.5">
                      <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />
                      <div>
                        <div className="text-sm font-bold text-foreground">{Math.round((narrative.sickness + narrative.unavail + narrative.holidays) * 10) / 10}h</div>
                        <div className="text-[10px] text-muted-foreground leading-none">capacity lost</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Day risk pills */}
                {narrative.shortDays.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap mb-3">
                    <span className="text-[10px] text-muted-foreground font-medium">Short days:</span>
                    {narrative.shortDays.map(day => (
                      <span key={day} className="text-[10px] bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 px-1.5 py-0.5 rounded-full font-medium">
                        {day}
                      </span>
                    ))}
                  </div>
                )}

                {/* Action buttons + controls */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={onUploadClick}
                    size="sm"
                    className="h-8 px-4 text-xs bg-emerald-700 hover:bg-emerald-800 text-white border-0 shadow-sm"
                  >
                    <Upload className="w-3.5 h-3.5 mr-1.5" />
                    Upload New Data
                  </Button>
                  <Button
                    onClick={onProcessClick}
                    variant="outline"
                    size="sm"
                    className="h-8 px-4 text-xs border-border hover:bg-muted"
                  >
                    <Bot className="w-3.5 h-3.5 mr-1.5" />
                    Process Data
                  </Button>

                  {data && weekLabel && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground border border-border rounded-md px-2.5 h-8 bg-background">
                      <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                      <Select value={selectedWeekId || "latest"} onValueChange={handleWeekChange}>
                        <SelectTrigger className="border-0 p-0 h-auto text-xs font-medium text-foreground bg-transparent shadow-none focus:ring-0 w-auto min-w-[10rem] max-w-[14rem]">
                          <SelectValue>
                            Week {weekLabel.weekNum} · {weekLabel.range}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectItem value="latest">Current Week</SelectItem>
                          {(() => {
                            const now = new Date();
                            const day = now.getUTCDay();
                            const diff = day === 0 ? -6 : 1 - day;
                            const currentMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff));
                            const lowerCutoff = new Date(currentMonday);
                            lowerCutoff.setUTCDate(lowerCutoff.getUTCDate() - 14);
                            const upperCutoff = new Date(currentMonday);
                            upperCutoff.setUTCDate(upperCutoff.getUTCDate() + 13 * 7);
                            return allHistoryData
                              ?.filter(a => {
                                if (!a.weekStartDate) return false;
                                const d = new Date(a.weekStartDate);
                                return d >= lowerCutoff && d <= upperCutoff;
                              })
                              .map(analysis => {
                                try {
                                  if (!analysis.weekStartDate || !analysis.weekEndDate) return null;
                                  const { range, weekNum } = formatWeekRange(analysis.weekStartDate, analysis.weekEndDate);
                                  return (
                                    <SelectItem key={analysis.id} value={analysis.id}>
                                      {weekNum ? `Week ${weekNum} · ` : ""}{range}
                                    </SelectItem>
                                  );
                                } catch { return null; }
                              })
                              .filter(Boolean);
                          })()}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {lastSyncedAt && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <RefreshCw className="w-3 h-3" />
                      {new Date(lastSyncedAt).toLocaleString("en-GB", {
                        weekday: "short", day: "numeric", month: "short",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold text-foreground leading-tight mb-1.5 tracking-tight">
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

          {/* ── Right: sparkline card ── */}
          {narrative && cfg && (
            <div className="shrink-0 w-56 border border-border rounded-xl bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Net Capacity · This Week
                </span>
                {narrative.wowPct !== null && (
                  <span className={`flex items-center gap-0.5 text-[10px] font-bold rounded-full px-1.5 py-0.5 ${
                    narrative.wowPct > 0
                      ? "bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400"
                      : "bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400"
                  }`}>
                    <WoWIcon className="w-2.5 h-2.5" />
                    {narrative.wowPct > 0 ? "+" : ""}{narrative.wowPct}%
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-1 mb-0.5">
                <span className="text-3xl font-bold text-foreground tracking-tight">{narrative.net}</span>
                <span className="text-base font-semibold text-muted-foreground">h</span>
              </div>
              <div className="text-xs text-muted-foreground mb-1">
                out of <strong className="text-foreground">{narrative.desired}h</strong> desired
              </div>
              {/* Supply bar */}
              <div className="mb-3">
                <div className="flex justify-between text-[10px] mb-0.5">
                  <span className="text-muted-foreground">Supply</span>
                  <span className={`font-semibold ${cfg.headline}`}>{narrative.supplyPct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-border overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${cfg.bar}`} style={{ width: `${Math.min(narrative.supplyPct, 100)}%` }} />
                </div>
              </div>
              {sparklineData.length > 1 && (
                <div className="h-12 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={sparklineData}>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          return (
                            <div className="bg-popover border border-border rounded px-2 py-1 text-xs shadow-md">
                              <div className="font-medium text-foreground">{payload[0].payload.label}</div>
                              <div className="text-muted-foreground">{payload[0].value}h</div>
                            </div>
                          );
                        }}
                      />
                      <Line type="monotone" dataKey="net" stroke="#d97706" strokeWidth={1.5} dot={false} activeDot={{ r: 3, fill: "#d97706" }} />
                    </LineChart>
                  </ResponsiveContainer>
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5 px-0.5">
                    <span>{sparklineData.length > 1 ? `${sparklineData.length - 1} wks ago` : ""}</span>
                    <span>Now</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
