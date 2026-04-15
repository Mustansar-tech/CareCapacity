import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import {
  BookOpen, BarChart3, Calendar, Users, Zap,
  Upload, Search, ChevronRight, ArrowLeft, AlertTriangle,
  Info, AlertCircle, CheckCircle, FileSpreadsheet, RefreshCw,
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
  { id: "overview",        label: "Overview",              icon: BookOpen,         color: "text-indigo-600 dark:text-indigo-400"   },
  { id: "getting-started", label: "Getting Started",       icon: Zap,              color: "text-amber-600 dark:text-amber-400"     },
  { id: "dashboard",       label: "Dashboard",             icon: BarChart3,        color: "text-emerald-600 dark:text-emerald-400" },
  { id: "bd-matrix",       label: "Capacity / BD Matrix",  icon: Users,            color: "text-violet-600 dark:text-violet-400"   },
  { id: "schedule",        label: "Schedule",              icon: Calendar,         color: "text-rose-600 dark:text-rose-400"       },
  { id: "faq",             label: "Common Issues / FAQs",  icon: Search,           color: "text-gray-600 dark:text-gray-400"       },
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

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2 mt-5">{children}</h3>;
}

function StepList({ steps, color }: { steps: { title: string; body: string }[]; color: string }) {
  const bgMap: Record<string, string> = {
    amber:  "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
    blue:   "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
    orange: "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300",
    violet: "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300",
  };
  return (
    <ol className="space-y-3 mb-4">
      {steps.map(({ title, body }, i) => (
        <li key={i} className="flex gap-3">
          <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5", bgMap[color])}>{i + 1}</div>
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{title}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
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
              <span className="text-sm font-semibold text-gray-900 dark:text-white">User Guide</span>
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
              The Care Capacity Dashboard gives Home Instead care managers a clear, weekly picture of their workforce. It reads scheduling exports from People Planner and turns them into easy-to-understand capacity figures — so you can see at a glance how much care your team can deliver, where hours are being lost, and where capacity is available for new clients.
            </p>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              It doesn't replace People Planner. It sits alongside it, saving you the time of manually building reports and spreadsheets each week.
            </p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                { icon: BarChart3, label: "Dashboard",         desc: "Weekly KPIs: net capacity, scheduled hours, GH Loss, and utilisation at a glance" },
                { icon: Clock,     label: "Daily View",        desc: "See each Care Pro's status, scheduled hours, and free time by day" },
                { icon: Users,     label: "BD Matrix",         desc: "See which Care Pros have free windows for new client visits, by day and time block" },
                { icon: Calendar,  label: "Schedule",          desc: "Automatically match unallocated visits to available Care Pros" },
                { icon: Zap,       label: "People Planner",    desc: "Pull fresh data directly from People Planner without manual exports" },
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
              To get started, you need three weekly exports from People Planner. Once uploaded, all sections of the dashboard are populated automatically.
            </p>
            <StepList color="amber" steps={[
              { title: "Sign in", body: "Use the email and password provided by your administrator. If you've forgotten your password, contact your admin — there's no self-service reset." },
              { title: "Select your branch", body: "Use the branch selector at the top of the screen. Every branch has its own separate data — switching branches changes everything you see." },
              { title: "Upload your three files", body: "Go to the Dashboard and click the upload area. You'll need the Availability Export, the Guaranteed Hours Export, and the CG Data Export for the target week. All three are required." },
              { title: "Check the results", body: "Once processed, the KPI cards and charts will populate within a few seconds. Cross-check the total contracted hours and Care Pro count against what you'd expect — if something looks off, the most likely cause is a wrong file being uploaded." },
            ]} />
            <Note type="warning">
              All three files must cover the same week. Uploading files from different weeks will produce incorrect figures without any error message.
            </Note>
          </section>

          {/* ── Dashboard ── */}
          <section className="mb-2">
            <SectionHeading id="dashboard" icon={BarChart3} label="Dashboard" color="text-emerald-600 dark:text-emerald-400" />
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              The Dashboard is the main summary view. It shows how your branch is performing for the selected week, across a set of headline figures and a daily breakdown.
            </p>

            <SubHeading>KPI cards</SubHeading>
            <div className="space-y-3 mb-5">
              {[
                {
                  kpi: "Desired Hours",
                  desc: "Total weekly desired hours.",
                },
                {
                  kpi: "Unavailability",
                  desc: "Weekly unavailability.",
                },
                {
                  kpi: "Sickness",
                  desc: "Weekly sickness.",
                },
                {
                  kpi: "Holidays",
                  desc: "Weekly annual leave.",
                },
                {
                  kpi: "Net Capacity",
                  desc: "Total available hours after unavailability, sickness, and holidays are removed.",
                },
                {
                  kpi: "Domiciliary Hours",
                  desc: "Client care hours.",
                },
                {
                  kpi: "Client Scheduled",
                  desc: "Hours scheduled to meet demand.",
                },
                {
                  kpi: "Other Scheduled",
                  desc: "Non-client hours.",
                },
                {
                  kpi: "Capacity After Scheduling",
                  desc: "Total remaining capacity.",
                },
                {
                  kpi: "GH Loss",
                  desc: "Staff with loss. Double-click for details.",
                },
              ].map(({ kpi, desc }) => (
                <div key={kpi} className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">{kpi}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{desc}</p>
                </div>
              ))}
            </div>

            <SubHeading>Daily View</SubHeading>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Below the KPI cards, you'll see a day-by-day breakdown of every Care Pro — their status for the day (Available, Holiday, Sick, etc.), how many hours they're scheduled for, and any windows where they're free.
            </p>
            <Note type="info">
              Care Pros shown as "Ad-hoc" have scheduled visits for that day but no availability record in the Availability Export. Their hours count toward totals, but they won't appear in the BD Matrix for that day. This is normal for bank staff and irregular schedules.
            </Note>
          </section>

          <Divider />

          {/* ── BD Matrix ── */}
          <section className="mb-2">
            <SectionHeading id="bd-matrix" icon={Users} label="Capacity / BD Matrix" color="text-violet-600 dark:text-violet-400" />
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              The BD Matrix answers "who is free to take a new client right now?" It shows, across each day of the week and across 11 standard time slots, how many Care Pros have a genuine free window — meaning they're available, not on leave, and not already scheduled.
            </p>

            <SubHeading>Reading the matrix</SubHeading>
            <div className="grid grid-cols-3 gap-2 mb-4 text-xs">
              {[
                { color: "bg-emerald-100 dark:bg-emerald-900/40 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200", label: "4+ Care Pros",  desc: "Strong coverage" },
                { color: "bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200",   label: "2–3 Care Pros",  desc: "Some options" },
                { color: "bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-700 text-red-800 dark:text-red-200",     label: "0–1 Care Pro",  desc: "Very limited — may need to adjust" },
              ].map(({ color, label, desc }) => (
                <div key={label} className={cn("rounded-lg border px-3 py-2 text-center", color)}>
                  <p className="font-semibold">{label}</p>
                  <p className="opacity-75">{desc}</p>
                </div>
              ))}
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Click any cell to see the list of Care Pros who are free in that slot. You can also select multiple time slots to find Care Pros who are free across all of them — useful when a new client needs morning and evening visits.
            </p>

            <SubHeading>Enquiry Matcher</SubHeading>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Use the Enquiry Matcher for more detailed client matching. Enter the client's required visit times and postcode, and the tool will find the best-matched Care Pros based on availability, proximity, and their existing schedule for that day.
            </p>
            <Note type="info">
              The Enquiry Matcher checks travel time from the Care Pro's previous visit, so it won't suggest someone who physically can't reach the client on time — even if they're technically "free."
            </Note>

            <SubHeading>Workforce Map</SubHeading>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              The map tab shows Care Pro home locations and current client locations. This gives a visual picture of where your workforce and clients are concentrated. If a Care Pro is missing from the map, their postcode in People Planner may be incorrect or unrecognised.
            </p>
          </section>

          <Divider />

          {/* ── Schedule ── */}
          <section className="mb-2">
            <SectionHeading id="schedule" icon={Calendar} label="Schedule" color="text-rose-600 dark:text-rose-400" />
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              The Schedule module can automatically suggest visit assignments for your team. It looks at who is free, where clients are, and how much contracted time each Care Pro still has available — then proposes a schedule that minimises travel and respects contracted hours.
            </p>

            <SubHeading>How to use it</SubHeading>
            <StepList color="violet" steps={[
              { title: "Select a week", body: "Use the week picker to choose which week to schedule. The system uses the data you've already uploaded for that week." },
              { title: "Run the scheduler", body: "Click 'Auto-schedule'. The system assigns visits to Care Pros based on their free windows, contracted hours, and location. This usually takes a few seconds." },
              { title: "Review and adjust", body: "Any visits that couldn't be automatically assigned appear in the 'Unallocated' list. You can drag them onto a Care Pro manually. Hover over a Care Pro to see why a visit was rejected for them." },
              { title: "Save or export", body: "Your schedule is saved automatically as you make changes. Use the export option to download it as a spreadsheet." },
            ]} />

            <Note type="info">
              The scheduler respects daily working time limits, travel time between visits, and contracted weekly hours. It will never assign a Care Pro more than their contracted hours allow, and it won't schedule back-to-back visits that require more travel time than the gap between them.
            </Note>
          </section>

          <Divider />

          {/* ── FAQ ── */}
          <section className="mb-2">
            <SectionHeading id="faq" icon={Search} label="Common Issues / FAQs" color="text-gray-600 dark:text-gray-400" />
            <div className="space-y-4">
              {[
                {
                  q: "A Care Pro is missing from the Dashboard — where are they?",
                  a: "Care Pros are pulled from the CG Data Export. If someone is missing, check that they're listed in the CG Data file you uploaded. Also check for name spelling differences between the CG Data and Guaranteed Hours files — the system matches names across files, so a mismatch will cause a Care Pro to be excluded.",
                },
                {
                  q: "The total contracted hours look wrong.",
                  a: "Contracted hours come from the CG Data Export (the 'Weekly Hours' column). If these look incorrect, re-export CG Data from People Planner and re-upload. The GH annotation in some Care Pro names (e.g. '24 GH') is separate — it's used for GH Loss tracking only.",
                },
                {
                  q: "GH Loss shows a Care Pro as having unworked hours, but they seem fully scheduled.",
                  a: "GH Loss accounts for both scheduled hours and unavailability (such as holidays). If a Care Pro was on leave for part of the week, that time counts against their GH target — so even if all their available slots are filled, the combined shortfall can still show a loss.",
                },
                {
                  q: "A Care Pro doesn't appear in any BD Matrix cells even though they're not on leave.",
                  a: "The BD Matrix only shows Care Pros with a genuine free window — available, not scheduled, and not on leave. If they're fully scheduled across their availability windows, or their available windows are too short, they won't appear. Check their daily view in the Dashboard to see their actual schedule.",
                },
                {
                  q: "The Enquiry Matcher returns fewer Care Pros than expected.",
                  a: "The matcher checks availability, daily working limits, and travel time. The most common cause of a Care Pro being excluded is that they can't reach the client on time given their existing schedule for that day. Try adjusting the requested visit time slightly.",
                },
                {
                  q: "Why are some Care Pros shown as 'Ad-hoc' in the Daily View?",
                  a: "Ad-hoc means they have scheduled visits in the rota but no availability record in the Availability Export for that day. This is common for bank staff and those on irregular schedules. Their hours still count toward totals, but they won't appear in the BD Matrix.",
                },
                {
                  q: "The People Planner sync failed — what do I do?",
                  a: "First check that People Planner is accessible from a normal browser. If it is, the issue may be a timeout or a recent change to the People Planner interface. Try again after a few minutes. If it keeps failing, contact your administrator — the credentials or configuration may need updating.",
                },
                {
                  q: "I uploaded files for the wrong week — can I fix it?",
                  a: "Yes. Simply re-upload the correct files while the correct week is selected in the week picker. Re-uploading replaces the data for that week only — other weeks are not affected.",
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
