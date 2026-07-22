import { useMemo } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import { TrendingDown, BriefcaseMedical, AlertTriangle, Umbrella } from "lucide-react";
import type { ProcessingResult } from "@shared/schema";

// ── Helpers ────────────────────────────────────────────────────────────────────

function abbrevDay(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
}

function fmt(n: number) { return Math.round(n * 10) / 10; }

function formatName(n: string) {
  return n.includes(", ") ? n.split(", ").reverse().join(" ") : n;
}

// ── Chart 1: Daily Capacity vs Demand ─────────────────────────────────────────

function DailyCapacityChart({ data }: { data: ProcessingResult }) {
  const chartData = useMemo(() =>
    (data.dailySummary ?? [])
      .slice()
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map(day => ({
        day: abbrevDay(day.date),
        net: fmt(day.netCapacity ?? 0),
        required: fmt(day.clientRequired ?? 0),
        scheduled: fmt(day.clientScheduledHours ?? 0),
        shortage: (day.clientRequired ?? 0) > (day.netCapacity ?? 0),
      }))
  , [data]);

  const shortDays = chartData.filter(d => d.shortage);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    return (
      <div className="bg-popover border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
        <div className="font-semibold text-foreground mb-1">{label}</div>
        <div className="space-y-0.5">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Net capacity</span>
            <span className="font-medium">{d?.net}h</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Client required</span>
            <span className="font-medium text-amber-600">{d?.required}h</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Client scheduled</span>
            <span className="font-medium text-emerald-600">{d?.scheduled}h</span>
          </div>
          {d?.shortage && <div className="text-red-500 font-semibold pt-0.5">⚠ Capacity short</div>}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-sm flex flex-col">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Daily Capacity vs Demand</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">Available hours vs what clients need each day</p>
        </div>
        <div className="flex flex-col items-end gap-1 text-[10px] text-muted-foreground shrink-0 ml-2">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#2c4f26] inline-block" />Capacity</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" />Shortage</span>
          <span className="flex items-center gap-1"><span className="w-6 border-t-2 border-dashed border-amber-500 inline-block" />Required</span>
        </div>
      </div>
      <div className="h-44 mt-2 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} barSize={26} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
            <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)", rx: 4 }} />
            <Bar dataKey="net" radius={[3, 3, 0, 0]}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.shortage ? "#ef4444" : "#2c4f26"} />
              ))}
            </Bar>
            <Line
              dataKey="required"
              type="step"
              stroke="#f59e0b"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              dot={false}
              activeDot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {shortDays.length > 0 && (
        <div className="mt-2 flex gap-1 flex-wrap">
          {shortDays.map(d => (
            <span key={d.day} className="text-[10px] bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded-full font-medium">
              {d.day} short by {fmt(d.required - d.net)}h
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

  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
      <div className="mb-1">
        <h3 className="text-sm font-semibold text-foreground">Capacity Breakdown</h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">How net capacity is allocated and lost this week</p>
      </div>
      <div className="relative h-48 mt-1">
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
        {/* Centre label */}
        <div
          className="absolute flex flex-col items-center justify-center pointer-events-none"
          style={{ left: 0, width: "76%", top: 0, bottom: 0 }}
        >
          <span className="text-2xl font-bold text-foreground">{utilizationPct}%</span>
          <span className="text-[10px] text-muted-foreground">utilised</span>
        </div>
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
        if (SICK_STATUSES.has(emp.status))    rec.sick    += hours;
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
    <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
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

interface InsightChartsProps { data: ProcessingResult }

export function InsightCharts({ data }: InsightChartsProps) {
  return (
    <div className="px-6 pb-6 pt-2">
      <div className="flex items-center gap-2 mb-4">
        <TrendingDown className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Intelligence View</h2>
        <span className="text-[11px] text-muted-foreground">— the story behind the numbers</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <DailyCapacityChart data={data} />
        <UtilisationDonut data={data} />
        <TopDrains data={data} />
      </div>
    </div>
  );
}
