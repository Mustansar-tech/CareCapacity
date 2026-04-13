import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import {
  BookOpen, BarChart3, Calendar, Users, Zap,
  Upload, Clock, MapPin, Search, ChevronRight, FileSpreadsheet,
  CheckCircle, AlertCircle, Info, ArrowLeft, AlertTriangle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ─── Section data ─────────────────────────────────────────────────────────────

interface Section {
  id: string;
  label: string;
  icon: typeof BookOpen;
  color: string;
}

const SECTIONS: Section[] = [
  { id: "overview",       label: "Overview",          icon: BookOpen,         color: "text-indigo-600 dark:text-indigo-400"   },
  { id: "getting-started",label: "Getting Started",   icon: Zap,              color: "text-amber-600 dark:text-amber-400"     },
  { id: "data-pipeline",  label: "Data Pipeline",     icon: Upload,           color: "text-blue-600 dark:text-blue-400"       },
  { id: "dashboard",      label: "Dashboard & KPIs",  icon: BarChart3,        color: "text-emerald-600 dark:text-emerald-400" },
  { id: "bd-matrix",      label: "BD Matrix",         icon: Users,            color: "text-violet-600 dark:text-violet-400"   },
  { id: "schedule",       label: "Schedule",          icon: Calendar,         color: "text-rose-600 dark:text-rose-400"       },
  { id: "people-planner", label: "People Planner",    icon: Zap,              color: "text-orange-600 dark:text-orange-400"   },
  { id: "data-formats",   label: "Data Formats",      icon: FileSpreadsheet,  color: "text-teal-600 dark:text-teal-400"       },
  { id: "faq",            label: "Operational FAQs",  icon: Search,           color: "text-gray-600 dark:text-gray-400"       },
];

// ─── Helper components ────────────────────────────────────────────────────────

function SectionHeading({ id, icon: Icon, label, color }: { id: string; icon: typeof BookOpen; label: string; color: string }) {
  const bgMap: Record<string, string> = {
    indigo: "bg-indigo-50 dark:bg-indigo-950/40",
    amber:  "bg-amber-50 dark:bg-amber-950/40",
    blue:   "bg-blue-50 dark:bg-blue-950/40",
    emerald:"bg-emerald-50 dark:bg-emerald-950/40",
    violet: "bg-violet-50 dark:bg-violet-950/40",
    rose:   "bg-rose-50 dark:bg-rose-950/40",
    orange: "bg-orange-50 dark:bg-orange-950/40",
    teal:   "bg-teal-50 dark:bg-teal-950/40",
    gray:   "bg-gray-50 dark:bg-gray-800/40",
  };
  const colorKey = Object.keys(bgMap).find(k => color.includes(k)) ?? "gray";
  return (
    <div id={id} className="flex items-center gap-3 mb-5 scroll-mt-24">
      <div className={cn("p-2 rounded-xl", bgMap[colorKey])}>
        <Icon className={cn("w-5 h-5", color)} />
      </div>
      <h2 className="text-xl font-bold text-gray-900 dark:text-white">{label}</h2>
    </div>
  );
}

function Note({ type = "info", children }: { type?: "info" | "warning" | "critical"; children: React.ReactNode }) {
  const styles = {
    info:     { bg: "bg-blue-50 dark:bg-blue-950/30",    border: "border-blue-200 dark:border-blue-800",    icon: <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />    },
    warning:  { bg: "bg-amber-50 dark:bg-amber-950/30",  border: "border-amber-200 dark:border-amber-800",  icon: <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" /> },
    critical: { bg: "bg-red-50 dark:bg-red-950/30",      border: "border-red-200 dark:border-red-800",      icon: <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" /> },
  };
  const s = styles[type];
  return (
    <div className={cn("flex gap-2 rounded-xl border p-3.5 text-sm mb-4", s.bg, s.border)}>
      {s.icon}
      <div className="text-gray-700 dark:text-gray-300 leading-relaxed">{children}</div>
    </div>
  );
}

function Divider() {
  return <hr className="my-8 border-gray-200 dark:border-gray-700" />;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-xs font-mono text-gray-800 dark:text-gray-200">{children}</code>;
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2 mt-5">{children}</h3>;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DocsPage() {
  const [activeId, setActiveId] = useState("overview");
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) { setActiveId(entry.target.id); break; }
        }
      },
      { rootMargin: "-20% 0px -70% 0px" }
    );
    container.querySelectorAll("[id]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50/30 dark:from-gray-950 dark:via-gray-900 dark:to-gray-900">
      {/* Top bar */}
      <div className="border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/app/dashboard" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-colors group">
              <ArrowLeft className="h-3.5 w-3.5 group-hover:-translate-x-0.5 transition-transform" />
              Dashboard
            </Link>
            <ChevronRight className="h-3.5 w-3.5 text-gray-300 dark:text-gray-600" />
            <div className="flex items-center gap-1.5">
              <BookOpen className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              <span className="text-sm font-semibold text-gray-900 dark:text-white">Documentation</span>
            </div>
          </div>
          <Badge variant="outline" className="text-xs text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700">
            Care Capacity Dashboard
          </Badge>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 flex gap-8">
        {/* Sidebar */}
        <aside className="w-56 shrink-0 sticky top-20 self-start hidden lg:block">
          <p className="text-[10px] uppercase tracking-widest font-semibold text-gray-400 dark:text-gray-500 mb-3 px-2">Contents</p>
          <nav className="flex flex-col gap-0.5">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className={cn(
                  "flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-sm text-left transition-all",
                  activeId === s.id
                    ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-medium"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100"
                )}
              >
                <s.icon className={cn("w-3.5 h-3.5 shrink-0", activeId === s.id ? s.color : "")} />
                {s.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <div ref={contentRef} className="flex-1 min-w-0 max-w-3xl space-y-0">

          {/* ── Overview ── */}
          <section className="mb-2">
            <SectionHeading id="overview" icon={BookOpen} label="Overview" color="text-indigo-600 dark:text-indigo-400" />
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              The Care Capacity Dashboard is a scheduling intelligence platform for Home Instead franchise managers. Its core function is to ingest structured Excel exports from Access People Planner, run a normalisation and capacity-modelling pipeline, and expose the output through four interconnected modules.
            </p>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              The system does not replace the rota — it sits alongside it, turning raw scheduling data into structured metrics that answer operational questions in seconds rather than requiring manual cross-referencing of multiple reports.
            </p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                { icon: BarChart3, label: "Dashboard & KPIs",  desc: "Net capacity, GH loss, utilisation, daily breakdown" },
                { icon: Users,     label: "BD Matrix",          desc: "Free-window availability across 11 standard time blocks" },
                { icon: Calendar,  label: "Schedule",           desc: "VRPTW-based auto-scheduling with travel constraints" },
                { icon: Zap,       label: "People Planner",     desc: "Playwright automation pipeline for headless data extraction" },
              ].map(({ icon: Icon, label, desc }) => (
                <div key={label} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 p-4">
                  <Icon className="w-4 h-4 text-indigo-500 mb-2" />
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{label}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{desc}</p>
                </div>
              ))}
            </div>
          </section>

          <Divider />

          {/* ── Getting Started ── */}
          <section className="mb-2">
            <SectionHeading id="getting-started" icon={Zap} label="Getting Started" color="text-amber-600 dark:text-amber-400" />
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              Initial setup requires three weekly Excel exports from People Planner. Once those are uploaded, all four modules are populated from the same processed dataset.
            </p>
            <ol className="space-y-3 mb-4">
              {[
                { step: "1", title: "Log in", body: "Use the credentials provided by your administrator. Authentication is session-based; sessions expire after inactivity." },
                { step: "2", title: "Select your branch", body: "Use the branch selector in the top navigation bar. Each branch maintains its own independent dataset — switching branches immediately updates all views." },
                { step: "3", title: "Upload the three required exports", body: "Navigate to the Dashboard upload panel and submit your Availability Export, Guaranteed Hours Export, and CG Data Export for the target week. The pipeline runs synchronously and results are available within seconds." },
                { step: "4", title: "Verify the output", body: "Check the Dashboard KPIs against known figures. If total contracted hours or employee counts look wrong, the most likely cause is a mismatched export type or column header change in the upstream system." },
              ].map(({ step, title, body }) => (
                <li key={step} className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{step}</div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{title}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <Note type="warning">
              The system will not always fail loudly on bad input. Incorrect export types or partial-week files can produce structurally valid but numerically incorrect results. Always cross-check totals on first use.
            </Note>
          </section>

          <Divider />

          {/* ── Data Pipeline ── */}
          <section className="mb-2">
            <SectionHeading id="data-pipeline" icon={Upload} label="Data Pipeline" color="text-blue-600 dark:text-blue-400" />
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              All platform features are driven by a single ingestion pipeline. The pipeline accepts three Excel files, normalises them into a unified internal model, computes derived metrics, and persists a weekly snapshot. Each stage is described below.
            </p>

            <SubHeading>Required input files</SubHeading>
            <Note type="critical">
              Three files are required — not two. Uploading only the Availability and Guaranteed Hours exports without CG Data will produce incorrect contracted-hours totals because the pipeline uses CG Data as the authoritative employee master list.
            </Note>
            <div className="space-y-3 mb-4">
              {[
                {
                  name: "Availability Export",
                  sheet: 'Sheet tab: "CAREGiver Availability"',
                  desc: "Contains daily availability windows and leave/unavailability records for each Care Pro. The pipeline reads this sheet exclusively — any other tabs in the workbook are ignored.",
                },
                {
                  name: "Guaranteed Hours Export",
                  sheet: 'Sheet tab: "Data"',
                  desc: "Contains all scheduled visits for the week including client name, timestamps, service type, pay hours, and cancellation flags. Also used to calculate client demand hours.",
                },
                {
                  name: "CG Data Export",
                  sheet: "Single-sheet export",
                  desc: "The master Care Pro list. Provides contracted weekly hours, transport mode, gender, and home postcode for every active employee. The pipeline iterates this list to construct the employee roster — employees absent from CG Data are excluded from capacity calculations.",
                },
              ].map(({ name, sheet, desc }) => (
                <div key={name} className="flex gap-3 p-3.5 rounded-xl border border-blue-100 dark:border-blue-900/50 bg-blue-50/40 dark:bg-blue-950/20">
                  <FileSpreadsheet className="w-4 h-4 text-blue-500 shrink-0 mt-1" />
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{name}</p>
                    <p className="text-xs text-blue-600 dark:text-blue-400 font-mono mt-0.5">{sheet}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <SubHeading>Processing stages</SubHeading>
            <ol className="space-y-4 mb-4">
              {[
                {
                  n: "1", title: "Parsing",
                  body: "Excel buffers are read via xlsx-compat. Rows are extracted as plain objects keyed by column header. The parser probes multiple possible column name variants for each field — e.g. employee name is resolved from: Actual Employee Name → Planned Employee Name → Employee Name → Caregiver Name → Care giver Name.",
                },
                {
                  n: "2", title: "Name normalisation",
                  body: "All employee names are canonicalised before cross-file matching. The process: lowercase → strip parenthetical annotations (including GH tags) → remove title prefixes (Mr, Mrs, Dr) → remove non-alpha characters → split on whitespace → sort tokens alphabetically → rejoin. This means \"Smith, Jane (24 GH)\" and \"Jane Smith\" both normalise to \"jane smith\", making cross-file entity resolution reliable regardless of name order or formatting.",
                },
                {
                  n: "3", title: "Status canonicalisation",
                  body: (
                    <span>
                      Raw availability status strings from the Availability Export are mapped to a fixed enum: <Code>Available</Code>, <Code>Holiday</Code>, <Code>Sick</Code>, <Code>Maternity/Paternity</Code>, <Code>AWOL</Code>, <Code>Compassionate Leave</Code>, <Code>Dependant Leave</Code>, <Code>Educational Commitment</Code>, <Code>Jury Service</Code>, <Code>Other Unavailable</Code>, <Code>Pre-Agreed Appointment</Code>, <Code>Ad-hoc</Code>.
                      The mapping uses prefix/substring matching on the lowercased raw string to tolerate minor label variations between People Planner exports.
                    </span>
                  ),
                },
                {
                  n: "4", title: "Status priority resolution",
                  body: (
                    <span>
                      When a Care Pro has conflicting records for the same day (e.g., both "Available" and "Holiday"), the pipeline selects the highest-priority status. Priority order (highest first): AWOL → Maternity/Paternity → Educational Commitment / Jury Service → Sick → Holiday → Compassionate / Dependant Leave → Other Unavailable → Partial Availability → Available / Ad-hoc.
                      Statuses are categorised as <strong>Day-Killers</strong> (Holiday, Sick, Maternity/Paternity, Compassionate Leave, AWOL, Jury Service, Educational Commitment, Dependant Leave) which eliminate all available hours for that day, or <strong>Time-Killers</strong> (Other Unavailable, Pre-Agreed Appointment) which subtract only their specific window from availability.
                    </span>
                  ),
                },
                {
                  n: "5", title: "Scheduled hours computation",
                  body: (
                    <span>
                      For each visit row in the Guaranteed Hours export, the pipeline:
                      <ul className="mt-2 space-y-1 ml-4 list-disc text-gray-600 dark:text-gray-400">
                        <li>Skips cancelled visits (Cancellation Description is non-blank, excluding "(blank)" and "N/A")</li>
                        <li>Skips Multiple Care (Secondary) visits — double-up care where this is the second carer</li>
                        <li>Skips Live In Care visits</li>
                        <li>Skips overnight visits — start date ≠ end date</li>
                        <li>Includes office/training/shadowing/meeting/admin hours: reads from pay hours field; if pay = 0 and timestamps exist, calculates duration from start/end timestamps instead</li>
                        <li>Accumulates hours into a map keyed by <Code>normalisedName|YYYY-MM-DD</Code></li>
                      </ul>
                    </span>
                  ),
                },
                {
                  n: "6", title: "Free window calculation",
                  body: (
                    <span>
                      Per employee per day, the pipeline computes genuine free time — windows where the Care Pro is available, not on leave, and not yet scheduled. Algorithm:
                      <ol className="mt-2 space-y-1 ml-4 list-decimal text-gray-600 dark:text-gray-400">
                        <li>Parse availability windows into [startMin, endMin] intervals</li>
                        <li>Parse Time-Killer unavailability windows and subtract from availability</li>
                        <li>Parse scheduled visit windows (from GH data) and subtract from the result</li>
                        <li>Merge any adjacent or overlapping intervals</li>
                        <li>Round start times UP and end times DOWN to the nearest 15-minute boundary</li>
                        <li>Discard any window shorter than 60 minutes</li>
                      </ol>
                      The resulting free windows are stored per-employee-per-day and used by both the BD Matrix and the Enquiry Matcher.
                    </span>
                  ),
                },
                {
                  n: "7", title: "Geocoding",
                  body: "Home postcodes from CG Data and client addresses from the Guaranteed Hours export are geocoded via postcodes.io at startup and on new data upload. Coordinates are stored to the database and used for the workforce map and travel-time calculations in the scheduler and Enquiry Matcher. Failed geocodes are logged and retried on the next startup sweep.",
                },
                {
                  n: "8", title: "Persistence",
                  body: "The processed result — employee summaries, daily KPIs, free windows, and client locations — is stored as a weekly snapshot keyed by branch and week start date. Re-uploading the same week overwrites the existing snapshot. Historical snapshots are retained and accessible via the week picker.",
                },
              ].map(({ n, title, body }) => (
                <li key={n} className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{n}</div>
                  <div className="text-sm">
                    <p className="font-semibold text-gray-900 dark:text-white mb-1">{title}</p>
                    <div className="text-gray-600 dark:text-gray-400 leading-relaxed">{body}</div>
                  </div>
                </li>
              ))}
            </ol>

            <SubHeading>Failure modes</SubHeading>
            <div className="space-y-2 mb-2">
              {[
                { risk: "Wrong export type uploaded", impact: "Column headers won't match any known variant, causing fields to silently resolve as undefined. Hours totals will be zero or missing." },
                { risk: "Missing CG Data file", impact: "Employee roster is empty or incomplete. Contracted hours KPIs and utilisation figures will be wrong." },
                { risk: "Partial-week export", impact: "Daily totals are correct for included days, but weekly aggregates will be understated. No error is raised." },
                { risk: "Column header renamed upstream", impact: "The pipeline probes a prioritised list of known variants. If a new name isn't in the list, that field is silently skipped." },
                { risk: "Name formatting change", impact: "If a Care Pro's name changes format between the Availability and Guaranteed Hours exports, cross-file matching will fail for that employee." },
              ].map(({ risk, impact }) => (
                <div key={risk} className="p-3 rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/20 text-sm">
                  <p className="font-medium text-amber-900 dark:text-amber-200">{risk}</p>
                  <p className="text-amber-700 dark:text-amber-400 mt-0.5">{impact}</p>
                </div>
              ))}
            </div>
          </section>

          <Divider />

          {/* ── Dashboard ── */}
          <section className="mb-2">
            <SectionHeading id="dashboard" icon={BarChart3} label="Dashboard & KPIs" color="text-emerald-600 dark:text-emerald-400" />
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              The Dashboard exposes the processed weekly dataset through two tabs. All figures derive from the same pipeline output — there is no separate calculation layer in the frontend beyond what is described here.
            </p>

            <SubHeading>KPI derivation</SubHeading>
            <div className="space-y-3 mb-5">
              {[
                {
                  kpi: "Net Capacity",
                  formula: "Contracted daily hours − (Day-Killer hours + Time-Killer hours)",
                  detail: "For each Care Pro, daily contracted hours are derived from the CG Data weekly hours figure divided by the number of working days in their schedule. Day-Killers (Holiday, Sick, etc.) eliminate the entire day's contracted hours. Time-Killers reduce capacity by only the window they occupy within the availability schedule.",
                },
                {
                  kpi: "Scheduled Hours",
                  formula: "Sum of Pay Hours across non-cancelled, non-excluded visits",
                  detail: "Excludes: cancelled visits, Multiple Care (Secondary), Live In Care, overnight visits (start date ≠ end date). Includes: all standard care visits plus office/training/shadowing/meeting — for those service types, if Pay Hours = 0, duration is calculated from start and end timestamps instead.",
                },
                {
                  kpi: "Client Required (Demand)",
                  formula: "Sum of visit durations for client-facing visits only",
                  detail: "Excludes all office/training/admin service types, secondary/double-up visits, live-in care, and overnight stays. Represents the raw care hours required by clients for that day or week.",
                },
                {
                  kpi: "Utilisation",
                  formula: "Scheduled Hours ÷ Net Capacity × 100",
                  detail: "Measures how much of available workforce capacity is being consumed by scheduled care. A utilisation figure above ~85% indicates limited room for new client intake without additional recruitment.",
                },
                {
                  kpi: "GH Loss",
                  formula: "GH target − weeklyScheduled − weeklyUnavailability (per employee, summed)",
                  detail: (
                    <span>
                      GH Loss is calculated only for employees whose name contains a GH annotation in the format <Code>(24 GH)</Code> or <Code>24 GH</Code>. The numeric value is the contracted Guaranteed Hours target for that employee. The pipeline strips the annotation for display but uses the number to compute loss = GH − Σ(scheduledHours) − Σ(unavailabilityHours) across the full week. Employees with status <Code>Ad-hoc</Code> are excluded from GH Loss even if annotated.
                      Positive loss means the Care Pro has unworked contracted hours — either due to leave consuming scheduled time or insufficient visit allocation.
                    </span>
                  ),
                },
              ].map(({ kpi, formula, detail }) => (
                <div key={kpi} className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40">
                  <div className="flex items-start justify-between gap-3 mb-1.5">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{kpi}</p>
                    <code className="text-xs bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 rounded px-2 py-0.5 shrink-0">{formula}</code>
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">{detail}</div>
                </div>
              ))}
            </div>

            <SubHeading>Daily View</SubHeading>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Shows each Care Pro's day in full: their canonical status (Available, Holiday, Ad-hoc, etc.), scheduled hours, unavailability windows, and computed free windows. The "Ad-hoc" status flags employees who appear in the Guaranteed Hours rota on a given day but have no corresponding availability record — they are included in scheduled hours totals but their free-window capacity cannot be calculated.
            </p>
            <Note type="info">
              Ad-hoc status is not an error — it reflects a genuine data gap where the rota contains a visit but the availability export has no record for that employee on that day. Common for bank staff or irregular schedules.
            </Note>
          </section>

          <Divider />

          {/* ── BD Matrix ── */}
          <section className="mb-2">
            <SectionHeading id="bd-matrix" icon={Users} label="BD Matrix" color="text-violet-600 dark:text-violet-400" />
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              The Business Development Matrix answers the question "who is genuinely free to take a new client at a specific time?" at a glance, across all 7 days of the week and 11 standard company time blocks. It is built directly from the free windows computed by the pipeline — not from availability records directly.
            </p>

            <SubHeading>Time blocks</SubHeading>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              The matrix uses 11 fixed 60-minute blocks aligned to company scheduling standards:
            </p>
            <div className="grid grid-cols-3 gap-1.5 mb-4 text-xs font-mono">
              {["08:00–09:00","09:15–10:15","10:30–11:30","11:45–12:45","13:00–14:00","14:15–15:15","15:30–16:30","16:45–17:45","18:00–19:00","19:15–20:15","20:30–21:30"].map(b => (
                <div key={b} className="rounded-md border border-violet-100 dark:border-violet-900/50 bg-violet-50/50 dark:bg-violet-950/20 px-2 py-1 text-violet-700 dark:text-violet-300 text-center">{b}</div>
              ))}
            </div>

            <SubHeading>Availability determination</SubHeading>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              A Care Pro is counted as available in a block if and only if at least one of their computed free windows <em>fully contains</em> the block:
            </p>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4 font-mono text-xs text-gray-700 dark:text-gray-300 mb-4">
              windowStart ≤ blockStart <span className="text-violet-600 dark:text-violet-400">AND</span> windowEnd ≥ blockEnd
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Partial overlap is not counted. A Care Pro free from 08:00–08:45 does not appear in the 08:00–09:00 block even though they have some availability during it. This intentional strictness ensures that cells in the matrix represent genuinely assignable slots, not optimistic partial availability.
            </p>
            <div className="grid grid-cols-3 gap-2 mb-4 text-xs">
              {[
                { color: "bg-emerald-100 dark:bg-emerald-900/40 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200", label: "4+ Care Pros",  desc: "Strong coverage" },
                { color: "bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200",   label: "2–3 Care Pros",  desc: "Moderate coverage" },
                { color: "bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-700 text-red-800 dark:text-red-200",     label: "0–1 Care Pro",  desc: "At-risk — limited options" },
              ].map(({ color, label, desc }) => (
                <div key={label} className={cn("rounded-lg border px-3 py-2 text-center", color)}>
                  <p className="font-semibold">{label}</p>
                  <p className="opacity-75">{desc}</p>
                </div>
              ))}
            </div>

            <SubHeading>Multi-block intersection</SubHeading>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              When multiple time blocks are selected in the left panel, the matrix computes a set intersection: it finds all Care Pros who pass the containment check for every selected block independently, then displays only those present in all sets. This allows you to identify staff who can cover a client requiring visits across multiple time windows — e.g. a morning and an evening slot — without manual cross-referencing.
            </p>
            <Note type="info">
              Multi-block intersection operates on the same day. If the client requires different days (e.g., Monday morning and Wednesday afternoon), use the Enquiry Matcher rather than multi-block selection.
            </Note>

            <SubHeading>Client Enquiry Matcher</SubHeading>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              The Enquiry Matcher runs a more sophisticated matching engine against the full Care Pro roster. For each candidate, it evaluates four constraint layers in sequence:
            </p>
            <ol className="space-y-2 mb-4 ml-1">
              {[
                { n: "1", title: "Availability", body: "Exact containment check: does the Care Pro have a free window covering the required time block? If no exact match, the engine searches for the nearest available block within 150 minutes of the requested time." },
                { n: "2", title: "Daily working time cap", body: "Hard exclusion if the Care Pro is already scheduled for 9 or more hours on the requested day." },
                { n: "3", title: "Mandatory rest break", body: "If the Care Pro has accumulated 5 or more continuous hours of work (gaps between visits < 30 minutes do not reset the counter), a 30-minute mandatory break is injected before the proposed visit, shifting the effective start time to the next available 15-minute boundary." },
                { n: "4", title: "Travel feasibility", body: "Inbound: travel time is calculated from home (or from the previous client if the gap between the last visit and the proposed start is under 90 minutes). If travel time exceeds the gap, the slot is rejected. Outbound: the engine also checks the forward journey — if the Care Pro cannot reach their next scheduled visit on time after completing the proposed visit (tolerance: travel exceeds gap by > 20 minutes), the slot is rejected." },
              ].map(({ n, title, body }) => (
                <li key={n} className="flex gap-3 text-sm">
                  <div className="w-5 h-5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{n}</div>
                  <div>
                    <span className="font-medium text-gray-900 dark:text-white">{title}: </span>
                    <span className="text-gray-600 dark:text-gray-400">{body}</span>
                  </div>
                </li>
              ))}
            </ol>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Candidates passing all constraints are scored and ranked by: window slack (40%), travel distance added to day (25%), home proximity for first/last visit (25%), and run tightness (10%). Gender matching is applied as a hard filter if the client has a gender preference encoded in their name (e.g., <Code>(F)</Code>).
            </p>

            <SubHeading>Workforce Map</SubHeading>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              The map overlays geocoded Care Pro home locations and current client locations using coordinates stored during the pipeline's geocoding stage. Transport mode is displayed per marker. Markers with missing postcodes are omitted — check the pipeline geocoding log if a known Care Pro is absent from the map.
            </p>
          </section>

          <Divider />

          {/* ── Schedule ── */}
          <section className="mb-2">
            <SectionHeading id="schedule" icon={Calendar} label="Schedule" color="text-rose-600 dark:text-rose-400" />
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              The Schedule module generates optimised visit assignments using a Greedy Vehicle Routing Problem with Time Windows (VRPTW) algorithm tailored for home care. It operates on the same processed dataset — free windows, contracted hours, and geocoded coordinates — without any additional input required.
            </p>

            <SubHeading>Optimisation inputs</SubHeading>
            <ul className="space-y-1.5 mb-4 ml-1">
              {[
                "Visits: geocoded client coordinates, required time windows, gender requirements",
                "Employees: home coordinates, transport mode (Car / Walking / Public), gender, computed free windows",
                "Contract data: weekly contracted hours vs currently assigned minutes",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <CheckCircle className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                  {item}
                </li>
              ))}
            </ul>

            <SubHeading>Algorithm</SubHeading>
            <ol className="space-y-2 mb-4 ml-1">
              {[
                { n: "1", title: "Pre-processing", body: "Office/shadowing visits are excluded. Remaining client visits are geographically clustered to improve route density." },
                { n: "2", title: "Walker-first pass", body: "Walking staff are assigned visits first, using strict proximity rules (same postcode sector or < 1.5 km from client). This minimises over-reliance on car-based staff for dense local routes." },
                { n: "3", title: "Greedy assignment loop", body: "Remaining unallocated visits are scored against every available employee using the weighted objective function (see below). The highest-scoring feasible assignment is committed before moving to the next visit." },
                { n: "4", title: "Break injection", body: "After assignment, the scheduler scans each employee's day for shifts exceeding 5 continuous hours and inserts mandatory 30-minute breaks into the schedule." },
              ].map(({ n, title, body }) => (
                <li key={n} className="flex gap-3 text-sm">
                  <div className="w-5 h-5 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{n}</div>
                  <div><span className="font-medium text-gray-900 dark:text-white">{title}: </span><span className="text-gray-600 dark:text-gray-400">{body}</span></div>
                </li>
              ))}
            </ol>

            <SubHeading>Scoring function</SubHeading>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 p-4 mb-4">
              <div className="space-y-2">
                {[
                  { label: "Window slack",    pct: "40%", desc: "Prefers assignments that fit snugly within a window — avoids creating large unusable gaps" },
                  { label: "Travel added",    pct: "25%", desc: "Penalises assignments that significantly increase the employee's total daily travel time" },
                  { label: "Home proximity",  pct: "25%", desc: "Prefers placing the first and last visit of the day closer to the employee's home postcode" },
                  { label: "Run tightness",   pct: "10%", desc: "Slightly favours smaller inter-visit gaps to build dense care runs" },
                ].map(({ label, pct, desc }) => (
                  <div key={label} className="flex items-start gap-3 text-sm">
                    <span className="font-mono font-bold text-rose-600 dark:text-rose-400 w-8 shrink-0">{pct}</span>
                    <div>
                      <span className="font-medium text-gray-900 dark:text-white">{label}: </span>
                      <span className="text-gray-500 dark:text-gray-400">{desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <SubHeading>Hard constraints</SubHeading>
            <ul className="space-y-1.5 mb-4 ml-1">
              {[
                "Visit must fit within the employee's free window (10-minute tolerance on start time)",
                "No overlapping visits — assignments must be strictly chronological",
                "Daily care hours cap: 9 hours maximum",
                "Weekly hours cap: contracted hours + 30-minute overage buffer",
                "Travel time between consecutive visits must not exceed the gap between them",
                "Gender matching: hard filter where client name contains (F) or (M) preference",
                "Sleep-in and Secondary visits are skipped — they require separate staffing logic",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <Clock className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                  {item}
                </li>
              ))}
            </ul>
            <Note type="info">
              Employees with a <Code>(GH)</Code> annotation in their name receive a priority boost in scoring to ensure contracted hours are preferentially filled before ad-hoc capacity is allocated.
            </Note>
          </section>

          <Divider />

          {/* ── People Planner ── */}
          <section className="mb-2">
            <SectionHeading id="people-planner" icon={Zap} label="People Planner" color="text-orange-600 dark:text-orange-400" />
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              The People Planner module automates the data extraction process using a headless browser pipeline. Instead of manually exporting reports from Access People Planner and uploading them, the pipeline logs in, navigates to each report, triggers the download, and feeds the Excel files directly into the processing pipeline — producing the same output as a manual upload.
            </p>

            <SubHeading>Automation pipeline steps</SubHeading>
            <ol className="space-y-3 mb-4">
              {[
                { n: "1", title: "Session initialisation", body: "A Playwright-controlled Chromium instance is launched. The engine navigates to the Access Identity login page and authenticates using stored credentials. The resulting session state (cookies) is saved to disk and reused on subsequent runs to avoid repeated login flows." },
                { n: "2", title: "Branch context", body: "The pipeline navigates to the configured branch workspace URL within the Access cloud environment, ensuring all subsequent report downloads are scoped to the correct franchise location." },
                { n: "3", title: "Application launch", body: "The People Planner application is opened from the Access launcher. The pipeline waits for the PP dashboard to fully load before proceeding." },
                { n: "4", title: "Triple report download", body: "Three export forms are configured and submitted in sequence: (1) Care Pro Guaranteed Hours — the visit/rota data; (2) CG Data Export — the employee master list; (3) CG Availability Export — availability and leave records. Each download is captured via Playwright's download event handler." },
                { n: "5", title: "Data processing", body: "The downloaded Excel buffers are passed directly to the same parsing and capacity processing functions used by the manual upload route. The output is persisted as a weekly snapshot, identical in structure to a manually uploaded dataset." },
                { n: "6", title: "Visit persistence", body: "Extracted visit records are also upserted into the local database's scheduled visits table, enabling historical visit queries independent of weekly snapshots." },
              ].map(({ n, title, body }) => (
                <li key={n} className="flex gap-3 text-sm">
                  <div className="w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{n}</div>
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white mb-0.5">{title}</p>
                    <p className="text-gray-600 dark:text-gray-400">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <Note type="warning">
              The automation is sensitive to UI changes in the Access People Planner web interface. If People Planner's report pages are restructured or download buttons are renamed, the pipeline will fail silently or time out. Monitor the session log after each run, especially following Access platform updates.
            </Note>
          </section>

          <Divider />

          {/* ── Data Formats ── */}
          <section className="mb-2">
            <SectionHeading id="data-formats" icon={FileSpreadsheet} label="Data Formats" color="text-teal-600 dark:text-teal-400" />
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              The pipeline probes a prioritised list of column name variants for each field. The primary expected column names are listed below. If your export uses an alternative label, check the pipeline source for supported variants before modifying the export.
            </p>

            <SubHeading>Guaranteed Hours Export — key fields</SubHeading>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden mb-5">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Field</th>
                    <th className="px-4 py-2.5 text-left font-medium">Primary column name(s)</th>
                    <th className="px-4 py-2.5 text-left font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {[
                    { field: "Employee name", cols: "Actual Employee Name, Planned Employee Name, Employee Name", notes: "Normalised before any lookup" },
                    { field: "Start time", cols: "Actual Start Date And Time, Start Date And Time, Planned Start Date And Time", notes: "Fallback chain — Actual preferred" },
                    { field: "End time", cols: "Actual End Date And Time, End Date And Time, Planned End Date And Time", notes: "Used to detect overnight visits" },
                    { field: "Service type", cols: "Actual Service Type Description, Service Type Description", notes: "Used to exclude Secondary, Live In, and identify Office/Training types" },
                    { field: "Pay hours", cols: "Actual Pay Rate Hours, Pay Hours, Pay Rate Hours, Hours", notes: "If 0 for office types, duration is calculated from timestamps" },
                    { field: "Client name", cols: "Service Location Name, Client Name, Service User Name", notes: "Used for demand calculation and map labels" },
                    { field: "Cancellation", cols: "Cancellation Description", notes: "Blank, (blank), N/A = included. Any other value = excluded" },
                  ].map(({ field, cols, notes }) => (
                    <tr key={field} className="bg-white dark:bg-gray-900/20">
                      <td className="px-4 py-2.5 font-medium text-gray-800 dark:text-gray-200">{field}</td>
                      <td className="px-4 py-2.5 font-mono text-teal-700 dark:text-teal-400">{cols}</td>
                      <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <SubHeading>CG Data Export — key fields</SubHeading>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden mb-5">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Field</th>
                    <th className="px-4 py-2.5 text-left font-medium">Column name</th>
                    <th className="px-4 py-2.5 text-left font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {[
                    { field: "Employee name", col: "CAREGiver Name", notes: "Primary identifier — must match Guaranteed Hours export after normalisation" },
                    { field: "Contracted hours", col: "Weekly Hours", notes: "Used for GH Loss and net capacity calculations" },
                    { field: "Transport mode", col: "TransportModeDescription", notes: "Car / Walking / Public — affects scheduler and map markers" },
                    { field: "Gender", col: "Title / Gender", notes: "Used for gender-preference matching in the Enquiry Matcher" },
                    { field: "Home postcode", col: "PostCode", notes: "Geocoded for map and travel-time calculations" },
                  ].map(({ field, col, notes }) => (
                    <tr key={field} className="bg-white dark:bg-gray-900/20">
                      <td className="px-4 py-2.5 font-medium text-gray-800 dark:text-gray-200">{field}</td>
                      <td className="px-4 py-2.5 font-mono text-teal-700 dark:text-teal-400">{col}</td>
                      <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <SubHeading>Availability Export — key fields</SubHeading>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden mb-2">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Field</th>
                    <th className="px-4 py-2.5 text-left font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {[
                    { field: "Employee name", notes: "Normalised against Guaranteed Hours and CG Data" },
                    { field: "Date", notes: "Multiple date formats accepted: dd/MM/yyyy, yyyy-MM-dd, dd-MM-yyyy, Excel serial numbers" },
                    { field: "Status", notes: "Raw string — canonicalised via substring matching. Must roughly match one of the 12 known statuses." },
                    { field: "Start / End time", notes: "Defines availability window or Time-Killer window depending on status" },
                  ].map(({ field, notes }) => (
                    <tr key={field} className="bg-white dark:bg-gray-900/20">
                      <td className="px-4 py-2.5 font-medium text-gray-800 dark:text-gray-200">{field}</td>
                      <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <Divider />

          {/* ── FAQ ── */}
          <section className="mb-2">
            <SectionHeading id="faq" icon={Search} label="Operational FAQs" color="text-gray-600 dark:text-gray-400" />
            <div className="space-y-4">
              {[
                {
                  q: "A Care Pro appears in the rota but not in any BD Matrix cells — why?",
                  a: "Their free windows are empty after the pipeline subtracts scheduled visits from availability. Either they are fully scheduled for every free window, their availability windows are narrow and no window survives the 60-minute minimum filter, or they are on leave (Day-Killer status) for the selected day.",
                },
                {
                  q: "GH Loss shows a Care Pro with loss but they appear fully scheduled — what is happening?",
                  a: "GH Loss is calculated as: GH Target − weeklyScheduled − weeklyUnavailability. If the employee has significant unavailability (e.g. partial holiday weeks) that reduces their schedulable time below their GH target, loss accumulates even when all available hours are assigned.",
                },
                {
                  q: "The Enquiry Matcher returns fewer candidates than expected for a given time block.",
                  a: "The matcher applies four sequential constraint layers. The most common cause of candidate elimination is travel feasibility — specifically the forward-travel check, which rejects slots where the Care Pro cannot reach their next scheduled visit on time. Check the candidate's existing schedule for back-to-back visits around the requested time.",
                },
                {
                  q: "Why are some Care Pros shown as 'Ad-hoc' in the Daily View?",
                  a: "Ad-hoc status is assigned when a Care Pro has scheduled visits in the Guaranteed Hours export for a given day but no corresponding availability record in the Availability Export for that day. Their scheduled hours count toward totals, but free windows cannot be calculated and they are excluded from the BD Matrix for that day.",
                },
                {
                  q: "The auto-scheduler produces a different result each run on the same data.",
                  a: "The greedy VRPTW algorithm is deterministic given the same input, but visit ordering within the pre-processing stage can vary if multiple visits have equal priority scores. Consistent ordering of input rows in the Guaranteed Hours export will produce consistent scheduling output.",
                },
                {
                  q: "A Care Pro's contracted hours in the Dashboard differ from what is in People Planner.",
                  a: "The pipeline reads contracted hours exclusively from the CG Data Export's Weekly Hours column. If that figure is out of date relative to People Planner, re-export CG Data and re-upload. The GH annotation in the employee name (e.g. '24 GH') is a separate mechanism used only for GH Loss calculation and does not affect net capacity.",
                },
              ].map(({ q, a }) => (
                <div key={q} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 p-4">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white mb-2">{q}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{a}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="h-16" />
        </div>
      </div>
    </div>
  );
}
