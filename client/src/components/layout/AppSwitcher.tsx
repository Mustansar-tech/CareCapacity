import { useLocation } from "wouter";
import homeInsteadLogo from "@/assets/logo.png";
import { ChevronsUpDown, LayoutDashboard, PoundSterling, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ── App switcher ──────────────────────────────────────────────────────────────
// Care Capacity and SUR Group BI are two separate sections sharing one login.
// This dropdown (Notion/Linear/Slack-style workspace switcher) is the single
// place to jump between them, so neither sidebar has to nest the other one
// inside its own feature nav.

interface AppSwitcherProps {
  current: "care-capacity" | "sur-group-bi";
  collapsed?: boolean;
  showBi: boolean;
}

const APPS = [
  { id: "care-capacity" as const, label: "Care Capacity", subtitle: "Home Instead", path: "/app/dashboard", icon: LayoutDashboard },
  { id: "sur-group-bi" as const, label: "SUR Group BI", subtitle: "Business Intelligence", path: "/sur-group-bi/data-house", icon: PoundSterling },
];

export function AppSwitcher({ current, collapsed, showBi }: AppSwitcherProps) {
  const [, navigate] = useLocation();
  const active = APPS.find(a => a.id === current) ?? APPS[0];
  const options = showBi ? APPS : APPS.filter(a => a.id === "care-capacity");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={[
            "flex items-center gap-2 rounded-md outline-none min-w-0 transition-colors hover:bg-white/10",
            collapsed ? "p-1.5 justify-center" : "flex-1 px-1 py-1",
          ].join(" ")}
        >
          <img
            src={homeInsteadLogo}
            alt="Home Instead"
            className={`object-contain rounded shrink-0 opacity-90 ${collapsed ? "h-7 w-7" : "h-6 w-6"}`}
          />
          {!collapsed && (
            <>
              <div className="min-w-0 text-left">
                <div className="text-sm font-semibold text-white truncate leading-tight">{active.label}</div>
                <div className="text-[10px] text-white/50 truncate leading-tight">{active.subtitle}</div>
              </div>
              {options.length > 1 && <ChevronsUpDown className="w-3.5 h-3.5 text-white/40 shrink-0 ml-auto" />}
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      {options.length > 1 && (
        <DropdownMenuContent side="bottom" align="start" className="w-56">
          <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Switch section
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {options.map(app => (
            <DropdownMenuItem
              key={app.id}
              onClick={() => navigate(app.path)}
              className="cursor-pointer gap-2.5 py-2"
            >
              <app.icon className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{app.label}</div>
                <div className="text-xs text-muted-foreground truncate">{app.subtitle}</div>
              </div>
              {app.id === current && <Check className="h-4 w-4 text-primary shrink-0" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}
