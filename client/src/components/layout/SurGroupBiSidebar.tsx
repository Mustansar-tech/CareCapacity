import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { AppSwitcher } from "@/components/layout/AppSwitcher";
import { PoundSterling, Trophy, LogOut } from "lucide-react";

// ── SUR Group BI sidebar ─────────────────────────────────────────────────────
// A deliberately separate, minimal nav shell for the SUR Group BI section.
// Unlike the main app Sidebar, this never shows a franchise/branch selector —
// Business Intelligence spans every office at once rather than scoping to one.

interface BiNavItem {
  id: string;
  label: string;
  path: string;
  icon: typeof PoundSterling;
}

const BI_NAV_ITEMS: BiNavItem[] = [
  { id: "data-house", label: "Data Warehouse", path: "/sur-group-bi/data-house", icon: PoundSterling },
  { id: "scoreboards", label: "Scoreboards", path: "/sur-group-bi/scoreboards", icon: Trophy },
];

export function SurGroupBiSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const initials = user?.displayName
    ?.split(" ")
    .map((n: string) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <aside
      className="h-screen w-[220px] flex flex-col shrink-0 overflow-hidden relative z-10"
      style={{
        background: "linear-gradient(165deg, #2f5729 0%, #2c4f26 45%, #24401f 100%)",
        boxShadow: "6px 0 28px -14px rgba(0,0,0,0.45)",
      }}
    >
      {/* ── Section header / app switcher ── */}
      <div className="flex items-center px-2.5 pt-3 pb-2">
        <AppSwitcher current="sur-group-bi" showBi />
      </div>

      <div className="mx-3 mb-1 h-px bg-gradient-to-r from-white/[0.08] via-white/[0.08] to-transparent" />

      {/* ── Nav items ── */}
      <nav className="flex-1 overflow-y-auto px-0 pt-3 pb-2">
        <div className="px-4 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/30">
          Business Intelligence
        </div>
        <div className="space-y-0.5">
          {BI_NAV_ITEMS.map(item => {
            const active = location === item.path || location.startsWith(item.path + "/");
            return (
              <div key={item.id} className="relative">
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-amber-400" aria-hidden="true" />
                )}
                <Link
                  href={item.path}
                  className={[
                    "relative flex items-center gap-2.5 rounded-lg mx-2 px-2.5 py-[7px] transition-all duration-150 outline-none select-none",
                    active
                      ? "bg-white/[0.14] text-white font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                      : "text-white/60 hover:bg-white/[0.07] hover:text-white",
                  ].join(" ")}
                >
                  <item.icon className={`w-4 h-4 shrink-0 ${active ? "text-amber-300" : ""}`} />
                  <span className="text-[13px] flex-1 truncate tracking-[-0.01em]">{item.label}</span>
                </Link>
              </div>
            );
          })}
        </div>
      </nav>

      {/* ── Footer ── */}
      {user && (
        <div className="shrink-0 px-1 pt-2.5 pb-2.5 bg-black/[0.14] border-t border-white/[0.08]">
          <div className="flex items-center gap-2.5 rounded-lg p-1.5 w-full">
            <div className="h-7 w-7 rounded-full bg-gradient-to-br from-amber-300 to-amber-500 text-emerald-950 flex items-center justify-center text-[11px] font-bold shrink-0 ring-1 ring-white/20">
              {initials}
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="text-xs font-medium text-white/90 truncate">{user.displayName}</div>
              <div className="text-[10px] text-white/40 truncate">{user.email}</div>
            </div>
            <button
              onClick={() => logout()}
              className="p-1.5 rounded text-white/35 hover:text-white hover:bg-white/10 transition-colors shrink-0"
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
