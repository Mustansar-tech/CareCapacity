import { Upload, FileSpreadsheet, Clock, Target, Bot, ChevronRight, Users, TrendingUp, AlertCircle, CheckCircle2, ArrowUpRight, Calendar, BarChart3, Activity, Zap } from "lucide-react";

const stats = [
  { label: "Total Contracted Hours", value: "1,842", change: "+3.2%", up: true, icon: Clock, color: "from-violet-500 to-purple-600" },
  { label: "Available This Week", value: "1,594", change: "+1.8%", up: true, icon: Users, color: "from-blue-500 to-cyan-500" },
  { label: "GH Loss", value: "127h", change: "-5.4%", up: false, icon: TrendingUp, color: "from-rose-500 to-pink-600" },
  { label: "Capacity After Clients", value: "312h", change: "+2.1%", up: true, icon: BarChart3, color: "from-emerald-500 to-teal-500" },
];

const fileTypes = [
  { label: "Availability Export", sub: "Staff shift patterns & availability", icon: FileSpreadsheet, accent: "#6366f1", bg: "#eef2ff" },
  { label: "Guaranteed Hours", sub: "Contracted hours & core data", icon: Clock, accent: "#059669", bg: "#ecfdf5" },
  { label: "CG Data Export", sub: "Master employee list — required", icon: Target, accent: "#d97706", bg: "#fffbeb", badge: "Required" },
];

const weekActivity = [
  { day: "Mon", pct: 82 }, { day: "Tue", pct: 91 }, { day: "Wed", pct: 74 },
  { day: "Thu", pct: 88 }, { day: "Fri", pct: 67 }, { day: "Sat", pct: 45 }, { day: "Sun", pct: 38 },
];

export function Premium() {
  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: "#f8fafc", minHeight: "100vh", color: "#0f172a" }}>
      {/* Top Nav strip */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 32px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Activity size={16} color="#fff" />
          </div>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.3px" }}>Care Capacity</span>
          <span style={{ padding: "2px 8px", background: "#f1f5f9", borderRadius: 99, fontSize: 11, fontWeight: 600, color: "#64748b", marginLeft: 4 }}>Glasgow North</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ padding: "6px 14px", borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 13, fontWeight: 500, color: "#475569", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <Calendar size={14} />
            Week of 21 Jul 2026
          </div>
          <div style={{ width: 32, height: 32, borderRadius: 99, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>JD</span>
          </div>
        </div>
      </div>

      <div style={{ padding: "28px 32px", maxWidth: 1200, margin: "0 auto" }}>

        {/* Hero row */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 99, background: "linear-gradient(135deg, #ede9fe, #ddd6fe)", marginBottom: 10 }}>
              <Zap size={12} color="#7c3aed" />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#7c3aed" }}>Week Overview</span>
            </div>
            <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.75px", margin: "0 0 6px", lineHeight: 1.15 }}>
              Good morning, James
            </h1>
            <p style={{ fontSize: 15, color: "#64748b", margin: 0, fontWeight: 400 }}>
              Here's your workforce capacity picture for this week.
            </p>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button style={{ padding: "9px 18px", borderRadius: 10, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 13, fontWeight: 600, color: "#374151", cursor: "pointer", display: "flex", alignItems: "center", gap: 7, boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
              <Upload size={14} />
              Upload Data
            </button>
            <button style={{ padding: "9px 18px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", fontSize: 13, fontWeight: 600, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 7, boxShadow: "0 4px 12px rgba(99,102,241,0.35)" }}>
              <Bot size={14} />
              Sync from People Planner
            </button>
          </div>
        </div>

        {/* KPI Strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
          {stats.map((s) => (
            <div key={s.label} style={{ background: "#fff", borderRadius: 14, padding: "18px 20px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
                  background: s.color === "from-violet-500 to-purple-600" ? "linear-gradient(135deg,#8b5cf6,#7c3aed)"
                    : s.color === "from-blue-500 to-cyan-500" ? "linear-gradient(135deg,#3b82f6,#06b6d4)"
                    : s.color === "from-rose-500 to-pink-600" ? "linear-gradient(135deg,#f43f5e,#ec4899)"
                    : "linear-gradient(135deg,#10b981,#0d9488)"
                }}>
                  <s.icon size={16} color="#fff" />
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, padding: "3px 8px", borderRadius: 99, background: s.up ? "#ecfdf5" : "#fef2f2", color: s.up ? "#059669" : "#e11d48", display: "flex", alignItems: "center", gap: 3 }}>
                  <ArrowUpRight size={11} style={{ transform: s.up ? "none" : "rotate(90deg)" }} />
                  {s.change}
                </span>
              </div>
              <div>
                <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.5px", lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4, fontWeight: 500 }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Main grid: upload + activity */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20 }}>

          {/* Upload card */}
          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", overflow: "hidden" }}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Upload size={15} color="#fff" />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Upload Weekly Files</h2>
                  <p style={{ margin: 0, fontSize: 12, color: "#94a3b8" }}>All three files required for analysis</p>
                </div>
              </div>
              <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 500 }}>0 / 3 uploaded</span>
            </div>

            <div style={{ padding: "20px 24px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
                {fileTypes.map((f) => (
                  <div key={f.label} style={{ border: "1.5px dashed #e2e8f0", borderRadius: 12, padding: "16px", textAlign: "center", cursor: "pointer", position: "relative", transition: "all 0.15s", background: "#fafafa" }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: f.bg, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px" }}>
                      <f.icon size={20} color={f.accent} />
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}>{f.label}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.4 }}>{f.sub}</div>
                    {f.badge && (
                      <span style={{ position: "absolute", top: 8, right: 8, fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 99, background: "#fef3c7", color: "#d97706", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        {f.badge}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Progress & button */}
              <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
                <AlertCircle size={15} color="#94a3b8" />
                <span style={{ fontSize: 13, color: "#64748b" }}>Drop or click a file slot to upload each report.</span>
              </div>

              <button style={{ width: "100%", padding: "12px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: 0.45, letterSpacing: "-0.1px", boxShadow: "0 4px 12px rgba(99,102,241,0.35)" }}>
                Process Files
              </button>
              <p style={{ textAlign: "center", fontSize: 11, color: "#94a3b8", marginTop: 8 }}>Upload all 3 files to enable processing</p>
            </div>
          </div>

          {/* Right column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Weekly activity sparkline */}
            <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", padding: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Daily Capacity</h3>
                <span style={{ fontSize: 11, color: "#94a3b8", display: "flex", alignItems: "center", gap: 4, fontWeight: 500 }}>This week <ChevronRight size={12} /></span>
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 64 }}>
                {weekActivity.map((d) => (
                  <div key={d.day} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <div style={{ width: "100%", background: d.pct > 80 ? "#ddd6fe" : d.pct > 60 ? "#e0f2fe" : "#fee2e2", borderRadius: 6, height: `${d.pct * 0.64}px`, position: "relative", overflow: "hidden" }}>
                      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${d.pct}%`, background: d.pct > 80 ? "linear-gradient(to top, #8b5cf6, #a78bfa)" : d.pct > 60 ? "linear-gradient(to top, #3b82f6, #60a5fa)" : "linear-gradient(to top, #f43f5e, #fb7185)", borderRadius: 6 }} />
                    </div>
                    <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>{d.day}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, color: "#64748b" }}>Avg utilisation</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#6366f1" }}>69%</span>
              </div>
            </div>

            {/* Status checklist */}
            <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", padding: "20px" }}>
              <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700 }}>This Week's Status</h3>
              {[
                { label: "Capacity data loaded", done: true },
                { label: "GH loss calculated", done: true },
                { label: "Sickness flagged (3 staff)", done: true },
                { label: "Schedule generated", done: false },
                { label: "Route plan optimised", done: false },
              ].map((item) => (
                <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #f8fafc" }}>
                  <div style={{ width: 20, height: 20, borderRadius: 99, background: item.done ? "#ecfdf5" : "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {item.done ? <CheckCircle2 size={13} color="#059669" /> : <div style={{ width: 6, height: 6, borderRadius: 99, background: "#cbd5e1" }} />}
                  </div>
                  <span style={{ fontSize: 13, color: item.done ? "#374151" : "#94a3b8", fontWeight: item.done ? 500 : 400 }}>{item.label}</span>
                </div>
              ))}
            </div>

            {/* Quick links */}
            <div style={{ background: "linear-gradient(135deg, #1e1b4b, #312e81)", borderRadius: 16, padding: "20px" }}>
              <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700, color: "#e0e7ff" }}>Quick Actions</h3>
              {[
                { label: "View weekly schedule", icon: Calendar },
                { label: "Daily capacity breakdown", icon: BarChart3 },
                { label: "Capacity Outlook", icon: TrendingUp },
              ].map((a) => (
                <div key={a.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid rgba(255,255,255,0.08)", cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <a.icon size={14} color="#a5b4fc" />
                    <span style={{ fontSize: 13, color: "#c7d2fe", fontWeight: 500 }}>{a.label}</span>
                  </div>
                  <ChevronRight size={13} color="#6366f1" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
