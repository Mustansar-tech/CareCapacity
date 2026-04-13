import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import {
  BookOpen, BarChart3, Calendar, Users, Zap, Shield,
  Upload, Clock, MapPin, Search, ChevronRight, FileSpreadsheet,
  CheckCircle, AlertCircle, Info, ArrowLeft,
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
  { id: "data-upload",    label: "Uploading Data",    icon: Upload,           color: "text-blue-600 dark:text-blue-400"       },
  { id: "dashboard",      label: "Dashboard",         icon: BarChart3,        color: "text-emerald-600 dark:text-emerald-400" },
  { id: "bd-matrix",      label: "BD Matrix",         icon: Users,            color: "text-violet-600 dark:text-violet-400"   },
  { id: "schedule",       label: "Schedule",          icon: Calendar,         color: "text-rose-600 dark:text-rose-400"       },
  { id: "people-planner", label: "People Planner",    icon: Zap,              color: "text-orange-600 dark:text-orange-400"   },
  { id: "roles",          label: "Roles & Permissions", icon: Shield,         color: "text-slate-600 dark:text-slate-400"     },
  { id: "data-formats",   label: "Data Formats",      icon: FileSpreadsheet,  color: "text-teal-600 dark:text-teal-400"       },
  { id: "faq",            label: "FAQs",              icon: Search,           color: "text-gray-600 dark:text-gray-400"       },
];

// ─── Helper components ────────────────────────────────────────────────────────

function SectionHeading({ id, icon: Icon, label, color }: { id: string; icon: typeof BookOpen; label: string; color: string }) {
  return (
    <div id={id} className="flex items-center gap-3 mb-5 scroll-mt-24">
      <div className={cn("p-2 rounded-xl", color.includes("indigo") ? "bg-indigo-50 dark:bg-indigo-950/40" : color.includes("amber") ? "bg-amber-50 dark:bg-amber-950/40" : color.includes("blue") ? "bg-blue-50 dark:bg-blue-950/40" : color.includes("emerald") ? "bg-emerald-50 dark:bg-emerald-950/40" : color.includes("violet") ? "bg-violet-50 dark:bg-violet-950/40" : color.includes("rose") ? "bg-rose-50 dark:bg-rose-950/40" : color.includes("orange") ? "bg-orange-50 dark:bg-orange-950/40" : color.includes("teal") ? "bg-teal-50 dark:bg-teal-950/40" : "bg-gray-50 dark:bg-gray-800/40")}>
        <Icon className={cn("w-5 h-5", color)} />
      </div>
      <h2 className="text-xl font-bold text-gray-900 dark:text-white">{label}</h2>
    </div>
  );
}

function Note({ type = "info", children }: { type?: "info" | "warning" | "success"; children: React.ReactNode }) {
  const styles = {
    info:    { bg: "bg-blue-50 dark:bg-blue-950/30",   border: "border-blue-200 dark:border-blue-800",   icon: <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />    },
    warning: { bg: "bg-amber-50 dark:bg-amber-950/30", border: "border-amber-200 dark:border-amber-800", icon: <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" /> },
    success: { bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-200 dark:border-emerald-800", icon: <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" /> },
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

function RoleBadge({ role }: { role: "admin" | "scheduler" | "viewer" }) {
  const styles = {
    admin:     "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400 border-red-200 dark:border-red-800",
    scheduler: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 border-blue-200 dark:border-blue-800",
    viewer:    "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700",
  };
  return <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border", styles[role])}>{role}</span>;
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
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
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
              The <strong>Care Capacity Dashboard</strong> is a workforce intelligence platform built for Home Instead franchise managers. It turns raw Excel scheduling data into clear capacity insights — helping you understand who is available, when, and where, so you can make faster and better business development decisions.
            </p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                { icon: BarChart3, label: "Capacity Overview", desc: "Weekly KPIs and daily utilisation" },
                { icon: Users,     label: "BD Matrix",         desc: "Staff availability by time block" },
                { icon: Calendar,  label: "Schedule",          desc: "Auto-generate and view rotas" },
                { icon: Zap,       label: "People Planner",    desc: "Automation pipeline integration" },
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
              Follow these steps to begin using the dashboard for the first time.
            </p>
            <ol className="space-y-3 mb-4">
              {[
                { step: "1", title: "Log in", body: "Use the email and password provided by your administrator. If you have forgotten your password, contact your admin — there is no self-service reset in the current version." },
                { step: "2", title: "Select your branch", body: "Use the branch selector in the top navigation bar to choose the franchise location you want to view. Admins can see all branches; schedulers and viewers only see their assigned branches." },
                { step: "3", title: "Upload your Excel files", body: "Navigate to the Dashboard and use the Upload panel to submit your weekly schedule and availability exports from Careblox / People Planner. The system processes them automatically." },
                { step: "4", title: "View your data", body: "Once processed, the Dashboard, BD Matrix, and Schedule pages populate with the week's data. Data is retained historically so you can compare week-over-week." },
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
            <Note type="info">
              After uploading, processing typically takes a few seconds. The dashboard will automatically refresh once the results are ready.
            </Note>
          </section>

          <Divider />

          {/* ── Data Upload ── */}
          <section className="mb-2">
            <SectionHeading id="data-upload" icon={Upload} label="Uploading Data" color="text-blue-600 dark:text-blue-400" />
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              The dashboard accepts Excel (<code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">.xlsx</code>) exports from your scheduling system. Two files are typically required each week:
            </p>
            <div className="space-y-3 mb-4">
              {[
                { name: "Rota / Schedule Export", desc: "The weekly rota showing each Care Pro's assigned visits, client names, timings, and visit durations." },
                { name: "Availability / Unavailability Export", desc: "Staff availability windows and any unavailability blocks (annual leave, sickness, training) for the week." },
              ].map(({ name, desc }) => (
                <div key={name} className="flex gap-3 p-3.5 rounded-xl border border-blue-100 dark:border-blue-900/50 bg-blue-50/40 dark:bg-blue-950/20">
                  <FileSpreadsheet className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{name}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <Note type="warning">
              File column headers must match the expected format. If processing fails, check that you exported the correct report type from your scheduling system. Contact your system administrator if the format has changed.
            </Note>
          </section>

          <Divider />

          {/* ── Dashboard ── */}
          <section className="mb-2">
            <SectionHeading id="dashboard" icon={BarChart3} label="Dashboard" color="text-emerald-600 dark:text-emerald-400" />
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              The Dashboard is the central view of the platform. It has two tabs: <strong>Overview</strong> and <strong>Daily View</strong>.
            </p>

            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">Overview Tab</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Shows high-level KPIs for the entire week, including:
            </p>
            <ul className="space-y-1.5 mb-4 ml-1">
              {[
                "Total scheduled hours vs available hours",
                "Capacity utilisation percentage",
                "Number of active Care Pros",
                "GH (Guaranteed Hours) loss — hours not worked against contracted minimums",
                "Cancelled visits count and associated lost hours",
                "Unavailability breakdown (annual leave, sickness, etc.)",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                  {item}
                </li>
              ))}
            </ul>

            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">Daily View Tab</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Breaks down each day of the week individually. Click any Care Pro's row to see their full day — scheduled visits, free windows, and any unavailability. The daily view helps you spot specific coverage gaps and plan ad-hoc client placements.
            </p>
            <Note type="success">
              Use the branch selector at the top to instantly switch between franchise locations. KPIs update immediately on branch change.
            </Note>
          </section>

          <Divider />

          {/* ── BD Matrix ── */}
          <section className="mb-2">
            <SectionHeading id="bd-matrix" icon={Users} label="BD Matrix" color="text-violet-600 dark:text-violet-400" />
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              The Business Development Matrix gives you a bird's-eye view of staff availability across standard time blocks for the whole week. Use it to quickly answer: <em>"Who is free on Tuesday afternoon for a new client?"</em>
            </p>

            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">Reading the matrix</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Each cell shows the number of Care Pros who are fully free during that time block on that day. Colour coding indicates availability levels:
            </p>
            <div className="grid grid-cols-3 gap-2 mb-4 text-xs">
              {[
                { color: "bg-emerald-100 dark:bg-emerald-900/40 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200", label: "High (5+)", desc: "Plenty of options" },
                { color: "bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200",   label: "Medium (2–4)", desc: "Some availability" },
                { color: "bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-700 text-red-800 dark:text-red-200",     label: "Low (0–1)", desc: "Very limited" },
              ].map(({ color, label, desc }) => (
                <div key={label} className={cn("rounded-lg border px-3 py-2 text-center", color)}>
                  <p className="font-semibold">{label}</p>
                  <p className="opacity-75">{desc}</p>
                </div>
              ))}
            </div>

            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">Multi-block filtering</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Tick multiple time blocks in the left column to find Care Pros who are free across <em>all</em> of your selected blocks simultaneously. This is useful for matching a client who needs cover spanning multiple shifts. A highlighted "Available in ALL Selected" row appears at the top of the matrix.
            </p>

            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">Client Enquiry Matcher</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Click the <strong>Enquiry Matcher</strong> button in the header to match an incoming client enquiry against current Care Pro availability. Enter the client's required schedule and the system returns ranked matches based on free windows, transport mode, and proximity.
            </p>

            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">Workforce Map</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Click <strong>View Map</strong> to see a live geographic map of Care Pros and current clients. Markers indicate transport mode:
            </p>
            <ul className="space-y-1.5 mb-4 ml-1">
              {[
                "🚗 Car — wider service radius",
                "🚲 Bicycle — local routes only",
                "🚶 Walking — very local placements",
                "🚌 Public transport — route-dependent",
              ].map((item) => (
                <li key={item} className="text-sm text-gray-600 dark:text-gray-400">{item}</li>
              ))}
            </ul>
          </section>

          <Divider />

          {/* ── Schedule ── */}
          <section className="mb-2">
            <SectionHeading id="schedule" icon={Calendar} label="Schedule" color="text-rose-600 dark:text-rose-400" />
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              The Schedule page provides a structured view of the current week's rota and supports auto-generation of optimised schedules.
            </p>
            <ul className="space-y-2 mb-4 ml-1">
              {[
                { title: "View current rota", body: "See each Care Pro's assigned visits in a day-by-day grid." },
                { title: "Auto-schedule (day)", body: "Generate an optimised daily schedule for a specific date. Requires Scheduler role or above." },
                { title: "Auto-schedule (week)", body: "Generate a full week's optimised rota. Best used at the start of each planning week." },
                { title: "Save schedule", body: "Persist a generated schedule so it can be reviewed later or shared." },
              ].map(({ title, body }) => (
                <li key={title} className="flex items-start gap-2 text-sm">
                  <Clock className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium text-gray-900 dark:text-white">{title}</span>
                    <span className="text-gray-500 dark:text-gray-400"> — {body}</span>
                  </div>
                </li>
              ))}
            </ul>
            <Note type="info">
              Auto-scheduling takes into account Care Pro availability windows, client visit preferences, travel time, and contracted hours. Results are a starting point — always review before committing.
            </Note>
          </section>

          <Divider />

          {/* ── People Planner ── */}
          <section className="mb-2">
            <SectionHeading id="people-planner" icon={Zap} label="People Planner" color="text-orange-600 dark:text-orange-400" />
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              The People Planner integration automates the export and processing of scheduling data from your People Planner system. It runs as a background automation pipeline and produces processed Excel reports without manual intervention.
            </p>
            <ul className="space-y-2 mb-4 ml-1">
              {[
                { title: "Run automation", body: "Trigger a fresh data pull and processing job. Requires Scheduler role or above." },
                { title: "Session history", body: "Review past automation runs, their status, and any errors encountered." },
                { title: "Download reports", body: "Download the processed output Excel files directly from completed jobs." },
                { title: "Health status", body: "Check whether the People Planner connection is active and responding." },
              ].map(({ title, body }) => (
                <li key={title} className="flex items-start gap-2 text-sm">
                  <Zap className="w-3.5 h-3.5 text-orange-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium text-gray-900 dark:text-white">{title}</span>
                    <span className="text-gray-500 dark:text-gray-400"> — {body}</span>
                  </div>
                </li>
              ))}
            </ul>
            <Note type="warning">
              People Planner automation requires the integration to be configured and the target system to be reachable. Contact your administrator if the health check shows as offline.
            </Note>
          </section>

          <Divider />

          {/* ── Roles ── */}
          <section className="mb-2">
            <SectionHeading id="roles" icon={Shield} label="Roles & Permissions" color="text-slate-600 dark:text-slate-400" />
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              The dashboard uses a three-tier role system. Users are assigned a role by an administrator when their account is created.
            </p>
            <div className="space-y-3 mb-4">
              {[
                {
                  role: "admin" as const,
                  label: "Administrator",
                  desc: "Full access to all features. Can create, edit, and deactivate user accounts, view audit logs, manage branches, and access all data across all branches.",
                  perms: ["All Scheduler permissions", "User management", "Audit logs", "System settings"],
                },
                {
                  role: "scheduler" as const,
                  label: "Scheduler",
                  desc: "Can upload data, run auto-scheduling, trigger People Planner automation, and view all dashboard features for their assigned branches.",
                  perms: ["Upload & process data", "Auto-schedule (day & week)", "Run People Planner", "View all dashboards"],
                },
                {
                  role: "viewer" as const,
                  label: "Viewer",
                  desc: "Read-only access to dashboard data for their assigned branches. Cannot upload files, modify schedules, or manage users.",
                  perms: ["View Dashboard", "View BD Matrix", "View Schedule", "View People Planner status"],
                },
              ].map(({ role, label, desc, perms }) => (
                <div key={role} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <RoleBadge role={role} />
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{label}</span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{desc}</p>
                  <ul className="space-y-1">
                    {perms.map(p => (
                      <li key={p} className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                        <CheckCircle className="w-3 h-3 text-emerald-500 shrink-0" />
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <Note type="info">
              User accounts are created exclusively by administrators. There is no public sign-up flow. Password resets must be handled by an admin from the Administration page.
            </Note>
          </section>

          <Divider />

          {/* ── Data Formats ── */}
          <section className="mb-2">
            <SectionHeading id="data-formats" icon={FileSpreadsheet} label="Data Formats" color="text-teal-600 dark:text-teal-400" />
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
              The platform expects Excel files with specific column structures. The ingestion pipeline is tolerant of minor formatting differences, but the core columns below are required.
            </p>
            <div className="space-y-4 mb-4">
              {[
                {
                  title: "Schedule / Rota file",
                  cols: [
                    { name: "Employee Name", desc: "Full name of the Care Pro" },
                    { name: "Client Name",   desc: "Full name of the client" },
                    { name: "Visit Date",    desc: "Date in DD/MM/YYYY or YYYY-MM-DD format" },
                    { name: "Start Time",    desc: "Visit start time (HH:MM)" },
                    { name: "End Time",      desc: "Visit end time (HH:MM)" },
                    { name: "Status",        desc: "e.g. Confirmed, Cancelled, Ad-hoc" },
                  ],
                },
                {
                  title: "Availability / Unavailability file",
                  cols: [
                    { name: "Employee Name",   desc: "Full name of the Care Pro" },
                    { name: "Date",            desc: "Date of the unavailability" },
                    { name: "Type",            desc: "e.g. Annual Leave, Sickness, Training" },
                    { name: "Start Time",      desc: "Block start time" },
                    { name: "End Time",        desc: "Block end time" },
                  ],
                },
              ].map(({ title, cols }) => (
                <div key={title}>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white mb-2">{title}</p>
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                          <th className="text-left px-3 py-2 font-semibold text-gray-700 dark:text-gray-300">Column</th>
                          <th className="text-left px-3 py-2 font-semibold text-gray-700 dark:text-gray-300">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cols.map((col, i) => (
                          <tr key={col.name} className={i % 2 === 0 ? "bg-white dark:bg-gray-800/30" : "bg-gray-50/50 dark:bg-gray-800/10"}>
                            <td className="px-3 py-2 font-mono text-teal-700 dark:text-teal-400">{col.name}</td>
                            <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{col.desc}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
            <Note type="warning">
              Column names are case-insensitive and leading/trailing spaces are trimmed. If a required column is missing, processing will fail and an error will be shown on the upload panel.
            </Note>
          </section>

          <Divider />

          {/* ── FAQ ── */}
          <section className="mb-12">
            <SectionHeading id="faq" icon={Search} label="Frequently Asked Questions" color="text-gray-600 dark:text-gray-400" />
            <div className="space-y-4">
              {[
                {
                  q: "My upload failed — what do I do?",
                  a: "Check that you exported the correct report from your scheduling system. Common causes: wrong date range selected, wrong report type, or a column renamed in a recent system update. Try re-exporting with the default column settings.",
                },
                {
                  q: "Why is a Care Pro missing from the BD Matrix?",
                  a: "The matrix only shows staff who have availability data for the week. If a Care Pro is fully booked or has no availability windows recorded, they will not appear. Check the Daily View for their schedule.",
                },
                {
                  q: "Can I view data from previous weeks?",
                  a: "Yes. The dashboard stores historical processing results. Use the date range selector on the Dashboard Overview to switch between past weeks.",
                },
                {
                  q: "Why does the GH Loss figure seem high?",
                  a: "GH (Guaranteed Hours) loss is calculated as contracted minimum hours minus actual hours worked (scheduled visits minus unavailability). High values often indicate a week with significant unavailability or cancellations. Check the Cancelled Visits section for more detail.",
                },
                {
                  q: "Who can reset my password?",
                  a: "Only an administrator can reset passwords via the Administration page. Contact your local admin or system manager.",
                },
                {
                  q: "Can multiple people use the system at the same time?",
                  a: "Yes — the dashboard supports concurrent users. Each user has their own session and branch selection. Changes such as schedule generation are persisted centrally.",
                },
                {
                  q: "How do I add a new branch?",
                  a: "Branches are configured by the system administrator at the database level. Contact your system administrator to add or modify branch records.",
                },
                {
                  q: "Is the data stored securely?",
                  a: "Yes. All data is stored in a PostgreSQL database with encrypted connections. User sessions are secured with HTTP-only cookies. Access is restricted by role. See the Privacy Policy for full details.",
                },
              ].map(({ q, a }) => (
                <div key={q} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/30 p-4">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1.5">{q}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{a}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 p-5 text-center">
              <BookOpen className="w-6 h-6 text-indigo-500 mx-auto mb-2" />
              <p className="text-sm font-semibold text-gray-900 dark:text-white">Still have questions?</p>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Use the <strong>Help &amp; Support</strong> panel in the top navigation bar to contact your system administrator.
              </p>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
