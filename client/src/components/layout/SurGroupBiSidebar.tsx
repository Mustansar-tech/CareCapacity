import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { AppSwitcher } from "@/components/layout/AppSwitcher";
import { PoundSterling, LogOut } from "lucide-react";

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
  { id: "data-house", label: "Data House", path: "/sur-group-bi/data-house", icon: PoundSterling },
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
      className="h-screen w-[220px] flex flex-col shrink-0 overflow-hidden"
      style={{ background: "#2c4f26" }}
    >
      {/* ── Section header / app switcher ── */}
      <div className="flex items-center px-3 py-3">
        <AppSwitcher current="sur-group-bi" showBi />
      </div>

      <div className="mx-3 mb-2 border-t border-white/10" />

      {/* ── Nav items ── */}
      <nav className="flex-1 overflow-y-auto px-0 pb-2">
        <div className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-white/35">
          Business Intelligence
        </div>
        <div className="space-y-0.5">
          {BI_NAV_ITEMS.map(item => {
            const active = location === item.path || location.startsWith(item.path + "/");
            return (
              <Link
                key={item.id}
                href={item.path}
                className={[
                  "flex items-center gap-2.5 rounded-md mx-2 px-2.5 py-1.5 transition-all duration-100 outline-none select-none",
                  active ? "bg-white/20 text-white font-medium" : "text-white/65 hover:bg-white/10 hover:text-white",
                ].join(" ")}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                <span className="text-sm flex-1 truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* ── Footer ── */}
      {user && (
        <div className="shrink-0 border-t border-white/10 px-1 pt-2 pb-2">
          <div className="flex items-center gap-2.5 rounded-lg p-2 w-full">
            <div className="h-7 w-7 rounded-full bg-white/20 text-white flex items-center justify-center text-[11px] font-bold shrink-0">
              {initials}
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="text-xs font-medium text-white/90 truncate">{user.displayName}</div>
              <div className="text-[10px] text-white/45 truncate">{user.email}</div>
            </div>
            <button
              onClick={() => logout()}
              className="p-1.5 rounded text-white/40 hover:text-white hover:bg-white/10 transition-colors shrink-0"
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
