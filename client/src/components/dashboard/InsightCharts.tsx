import { useMemo } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend, Label,
} from "recharts";
import { TrendingDown, BriefcaseMedical, AlertTriangle, Umbrella } from "lucide-react";
import type { ProcessingResult, CapacityAnalysisSummary } from "@shared/schema";

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number) { return Math.round(n * 10) / 10; }

function formatName(n: string) {
  return n.includes(", ") ? n.split(", ").reverse().join(" ") : n;
}

// ── Chart 1: Daily Capacity vs Demand ────────────────────────────────────────

const COLOR_CAP      = "#2c4f26";
const COLOR_SHORT    = "#dc2626";
const COLOR_REQ      = "#f59e0b";
const COLOR_SCHED    = "#3b82f6";

function DailyCapacityChart({ data }: { data: ProcessingResult }) {
  const chartData = useMemo(() => {
    return (data.dailySummary ?? []).map(d => {
      const net       = fmt(d.netCapacity ?? 0);
      const required  = fmt(d.clientRequired ?? 0);
      const scheduled = fmt(d.clientScheduledHours ?? 0);
      const short     = required > 0 && net < required;
      const deficit   = short ? fmt(required - net) : 0;
      const surplus   = !short && net > 0 ? fmt(net - required) : 0;
      const label     = new Date(d.date).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
      return { label, net, required, scheduled, short, deficit, surplus };
    });
  }, [data]);

  const shortDays   = chartData.filter(d => d.short);
  const totalDeficit = fmt(shortDays.reduce((s, d) => s + (d.deficit ?? 0), 0));
  const coveragePct  = (() => {
    const totReq = chartData.reduce((s, d) => s + d.required, 0);
    const totNet = chartData.reduce((s, d) => s + d.net, 0);
    return totReq > 0 ? Math.round((totNet / totReq) * 100) : null;
  })();

  // Custom bar: green or red, with a small deficit label above red bars
  const CustomBar = (props: any) => {
    const { x, y, width, height, index } = props;
    const d = chartData[index];
    if (!d || height <= 0) return null;
    const fill = d.short ? COLOR_SHORT : COLOR_CAP;
    return (
      <g>
        <rect x={x} y={y} width={width} height={height} fill={fill} rx={3} ry={3} opacity={0.9} />
        {d.short && d.deficit > 0 && (
          <text
            x={x + width / 2} y={y - 4}
            textAnchor="middle" fontSize={9} fontWeight={700}
            fill={COLOR_SHORT}
          >
            -{d.deficit}h
          </text>
        )}
        {!d.short && d.surplus > 0 && d.surplus >= 5 && (
          <text
            x={x + width / 2} y={y - 4}
            textAnchor="middle" fontSize={9}
            fill="#4a7c40"
          >
            +{d.surplus}h
          </text>
        )}
      </g>
    );
  };

  // Custom dot on the scheduled line: filled circle, hidden when 0
  const CustomSchedDot = (props: any) => {
    const { cx, cy, index } = props;
    const d = chartData[index];
    if (!d || d.scheduled === 0) return null;
    return <circle cx={cx} cy={cy} r={3} fill={COLOR_SCHED} stroke="#fff" strokeWidth={1} />;
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const d = chartData.find(c => c.label === label);
    if (!d) return null;
    const schedGap = d.required > 0 ? fmt(d.required - d.scheduled) : 0;
    return (
      <div className="bg-popover border border-border rounded-lg px-3 py-2.5 text-xs shadow-lg min-w-[160px]">
        <div className="font-semibold text-foreground mb-2">{label}</div>
        <div className="space-y-1">
          <div className="flex justify-between gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: d.short ? COLOR_SHORT : COLOR_CAP }} />
              Net capacity
            </span>
            <span className="font-semibold">{d.net}h</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3.5 border-t-2 border-dashed" style={{ borderColor: COLOR_REQ }} />
              Required
            </span>
            <span className="font-semibold">{d.required}h</span>
          </div>
          {d.scheduled > 0 && (
            <div className="flex justify-between gap-4">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: COLOR_SCHED }} />
                Scheduled
              </span>
              <span className="font-semibold">{d.scheduled}h</span>
            </div>
          )}
          <div className="border-t border-border pt-1 mt-1">
            {d.short ? (
              <div className="flex justify-between gap-4 text-red-600 dark:text-red-400 font-bold">
                <span>⚠ Capacity short</span>
                <span>-{d.deficit}h</span>
              </div>
            ) : (
              <div className="flex justify-between gap-4 text-emerald-600 dark:text-emerald-400 font-medium">
                <span>✓ Surplus</span>
                <span>+{d.surplus}h</span>
              </div>
            )}
            {d.scheduled > 0 && schedGap > 0 && (
              <div className="flex justify-between gap-4 text-blue-600 dark:text-blue-400 mt-0.5">
                <span>Scheduling gap</span>
                <span>{schedGap}h unscheduled</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-sm flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Daily Capacity vs Demand</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">Available hours vs what clients need each day</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
          {shortDays.length > 0 ? (
            <span className="text-[10px] font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 px-2 py-0.5 rounded-full">
              {shortDays.length} day{shortDays.length > 1 ? "s" : ""} short · -{totalDeficit}h total
            </span>
          ) : (
            <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded-full">
              ✓ No shortages this week
            </span>
          )}
          {coveragePct !== null && (
            <span className="text-[10px] text-muted-foreground">{coveragePct}% capacity coverage</span>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-1">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: COLOR_CAP }} />Capacity OK</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: COLOR_SHORT }} />Shortage</span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: COLOR_REQ }} />Required
        </span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 inline-block rounded-full" style={{ backgroundColor: COLOR_SCHED }} />Scheduled</span>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-[140px] mt-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 14, right: 4, left: -16, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)", rx: 4 }} />
            <Bar dataKey="net" shape={<CustomBar />} />
            <Line
              type="monotone"
              dataKey="required"
              stroke={COLOR_REQ}
              strokeWidth={1.5}
              strokeDasharray="5 3"
              dot={false}
              activeDot={{ r: 3, fill: COLOR_REQ }}
            />
            <Line
              type="monotone"
              dataKey="scheduled"
              stroke={COLOR_SCHED}
              strokeWidth={1.5}
              dot={<CustomSchedDot />}
              activeDot={{ r: 3, fill: COLOR_SCHED }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Shortage pill badges */}
      {shortDays.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {shortDays.map(d => (
            <span
              key={d.label}
              className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800"
            >
              {d.label} short by {d.deficit}h
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Chart 2: Capacity Utilisation Donut ───────────────────────────────────────

const DONUT_COLORS = {
  scheduled: "#2c4f26",
  other:     "#3b82f6",
  remaining: "#d1d5db",
  sickness:  "#64748b",
  unavail:   "#ef4444",
  holidays:  "#8b5cf6",
};

function UtilisationDonut({ data }: { data: ProcessingResult }) {
  const { slices, utilizationPct } = useMemo(() => {
    const net         = data.kpis.netCapacitySum ?? 0;
    const clientSched = data.kpis.clientScheduledHoursSum ?? 0;
    const otherSched  = data.kpis.otherScheduledHoursSum ?? 0;
    const remaining   = Math.max(0, net - clientSched - otherSched);
    const sick        = data.kpis.sicknessSum ?? 0;
    const unavail     = data.kpis.unavailabilitySum ?? 0;
    const holidays    = data.kpis.holidaysSum ?? 0;

    const utilizationPct = net > 0 ? Math.round((clientSched / net) * 100) : 0;

    const slices = [
      { name: "Client Scheduled", value: fmt(clientSched), color: DONUT_COLORS.scheduled },
      { name: "Other Scheduled",  value: fmt(otherSched),  color: DONUT_COLORS.other     },
      { name: "Remaining",        value: fmt(remaining),   color: DONUT_COLORS.remaining  },
      { name: "Sickness",         value: fmt(sick),        color: DONUT_COLORS.sickness   },
      { name: "Unavailability",   value: fmt(unavail),     color: DONUT_COLORS.unavail    },
      { name: "Holidays",         value: fmt(holidays),    color: DONUT_COLORS.holidays   },
    ].filter(s => s.value > 0);

    return { slices, utilizationPct };
  }, [data]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-popover border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
        <div className="font-semibold text-foreground">{payload[0].name}</div>
        <div className="text-muted-foreground">{payload[0].value}h</div>
      </div>
    );
  };

  const CentreLabel = ({ viewBox }: any) => {
    const { cx, cy } = viewBox ?? {};
    if (cx == null || cy == null) return null;
    return (
      <g>
        <text x={cx} y={cy - 7} textAnchor="middle" style={{ fontSize: 20, fontWeight: 700 }} className="fill-foreground">
          {utilizationPct}%
        </text>
        <text x={cx} y={cy + 11} textAnchor="middle" style={{ fontSize: 10 }} className="fill-muted-foreground">
          utilised
        </text>
      </g>
    );
  };

  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-sm flex flex-col h-full">
      <div className="mb-1">
        <h3 className="text-sm font-semibold text-foreground">Capacity Breakdown</h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">How net capacity is allocated and lost this week</p>
      </div>
      <div className="flex-1 min-h-0 mt-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              cx="38%"
              cy="50%"
              innerRadius={48}
              outerRadius={70}
              strokeWidth={0}
              paddingAngle={2}
            >
              {slices.map((s, i) => <Cell key={i} fill={s.color} />)}
              <Label content={<CentreLabel />} position="center" />
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend
              layout="vertical"
              align="right"
              verticalAlign="middle"
              iconSize={8}
              iconType="circle"
              wrapperStyle={{ fontSize: "10px", lineHeight: "2" }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Chart 3: Top Capacity Drains ──────────────────────────────────────────────

interface DrainItem { name: string; hours: number; type: "sick" | "unavail" | "holiday" }

const SICK_STATUSES    = new Set(["Sick", "Partial Sick"]);
const UNAVAIL_STATUSES = new Set(["Maternity/Paternity", "Compassionate Leave", "Other Unavailable", "Pre-Agreed Appointment", "Partial Maternity/Paternity", "Partial Compassionate Leave", "Partial Availability"]);
const HOLIDAY_STATUSES = new Set(["Holiday", "Partial Holiday"]);

const TYPE_CONFIG = {
  sick:    { label: "Sick",        icon: BriefcaseMedical, bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-700 dark:text-slate-300",   bar: "#64748b" },
  unavail: { label: "Unavailable", icon: AlertTriangle,    bg: "bg-red-50 dark:bg-red-950",       text: "text-red-700 dark:text-red-300",       bar: "#ef4444" },
  holiday: { label: "Holiday",     icon: Umbrella,         bg: "bg-purple-50 dark:bg-purple-950", text: "text-purple-700 dark:text-purple-300", bar: "#8b5cf6" },
} as const;

function TopDrains({ data }: { data: ProcessingResult }) {
  const items = useMemo((): DrainItem[] => {
    if (!data.employeesByDate) return [];
    const map = new Map<string, { sick: number; unavail: number; holiday: number }>();

    Object.values(data.employeesByDate).forEach(employees => {
      employees.forEach(emp => {
        const cap = emp.contractedDailyHours > 0 ? emp.contractedDailyHours : (emp.hours || 0);
        const hours = Math.min(emp.hours || 0, cap);
        if (hours === 0) return;
        const rec = map.get(emp.employeeName) ?? { sick: 0, unavail: 0, holiday: 0 };
        if (SICK_STATUSES.has(emp.status))         rec.sick    += hours;
        else if (UNAVAIL_STATUSES.has(emp.status)) rec.unavail += hours;
        else if (HOLIDAY_STATUSES.has(emp.status)) rec.holiday += hours;
        map.set(emp.employeeName, rec);
      });
    });

    const all: DrainItem[] = [];
    map.forEach((v, name) => {
      if (v.sick > 0)    all.push({ name, hours: fmt(v.sick),    type: "sick"    });
      if (v.unavail > 0) all.push({ name, hours: fmt(v.unavail), type: "unavail" });
      if (v.holiday > 0) all.push({ name, hours: fmt(v.holiday), type: "holiday" });
    });

    return all.sort((a, b) => b.hours - a.hours).slice(0, 8);
  }, [data]);

  const maxHours = items[0]?.hours ?? 1;

  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-sm flex flex-col h-full">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-foreground">Top Capacity Drains</h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">Who is impacting capacity most this week</p>
      </div>

      {items.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">No capacity drains this week 🎉</div>
      ) : (
        <div className="space-y-2.5">
          {items.map((item, i) => {
            const cfg = TYPE_CONFIG[item.type];
            const Icon = cfg.icon;
            const barPct = Math.round((item.hours / maxHours) * 100);
            return (
              <div key={`${item.name}-${item.type}`} className="flex items-center gap-2.5">
                <div className="w-4 text-[10px] text-muted-foreground text-right shrink-0">{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-foreground truncate">{formatName(item.name)}</span>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex items-center gap-0.5 ${cfg.bg} ${cfg.text}`}>
                        <Icon className="w-2.5 h-2.5" />
                        {cfg.label}
                      </span>
                      <span className="text-xs font-semibold text-foreground w-10 text-right">{item.hours}h</span>
                    </div>
                  </div>
                  <div className="h-1 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${barPct}%`, backgroundColor: cfg.bar }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────

interface InsightChartsProps {
  data: ProcessingResult;
  allHistoryData?: CapacityAnalysisSummary[];
}

export function InsightCharts({ data }: InsightChartsProps) {
  return (
    <div className="px-6 pb-6 pt-2 flex flex-col h-full">
      <div className="flex items-center gap-2 mb-4">
        <TrendingDown className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Intelligence View</h2>
        <span className="text-[11px] text-muted-foreground">— the story behind the numbers</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
        <DailyCapacityChart data={data} />
        <UtilisationDonut data={data} />
        <TopDrains data={data} />
      </div>
    </div>
  );
}
