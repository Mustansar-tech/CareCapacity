import { useState, useEffect, useCallback, useRef, ComponentType } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { BranchSelector } from "@/components/BranchSelector";
import { HelpPanel } from "@/components/HelpPanel";
import homeInsteadLogo from "@/assets/logo.png";
import {
  LayoutDashboard, CalendarDays, Users, TrendingUp, UserCheck,
  Star, Search, PanelLeftClose, PanelLeftOpen, LogOut, Shield,
  BookOpen, HelpCircle, Calendar, X, ChevronDown, PoundSterling,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ── Types ──────────────────────────────────────────────────────────────────────

interface NavItem {
  id: string;
  label: string;
  path: string;
  search?: string;
  icon: ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

// ── Nav structure ──────────────────────────────────────────────────────────────

const NAV_GROUPS: NavGroup[] = [
  {
    label: "INSIGHTS",
    items: [
      { id: "overview",  label: "Overview",  path: "/app/dashboard",        icon: LayoutDashboard },
      { id: "workforce", label: "Workforce", path: "/app/workforce",        icon: UserCheck       },
    ],
  },
  {
    label: "SCHEDULING",
    items: [
      { id: "daily-view", label: "Daily View",      path: "/app/dashboard", search: "view=daily", icon: CalendarDays },
      { id: "schedule",   label: "AI Schedule",     path: "/app/schedule",                         icon: Calendar    },
      { id: "bd-matrix",  label: "Enquiry Dashboard", path: "/app/bd-matrix",                        icon: Users       },
    ],
  },
  {
    label: "RECRUITMENT",
    items: [
      { id: "outlook", label: "Outlook", path: "/app/capacity-outlook", icon: TrendingUp },
    ],
  },
  {
    label: "BUSINESS INTELLIGENCE",
    items: [
      { id: "sur-group-bi", label: "SUR Group BI", path: "/sur-group-bi/data-house", icon: PoundSterling, adminOnly: true },
    ],
  },
];

const ALL_ITEMS: NavItem[] = NAV_GROUPS.flatMap(g => g.items);

// ── Persistence ────────────────────────────────────────────────────────────────

const PINNED_KEY = "sidebar_pinned_ids";
const COLLAPSED_KEY = "sidebar_collapsed";

function loadPinned(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (!raw) return ["overview", "schedule"];
    return JSON.parse(raw);
  } catch { return ["overview", "schedule"]; }
}

function savePinned(ids: string[]) {
  localStorage.setItem(PINNED_KEY, JSON.stringify(ids));
}

function loadCollapsed(): boolean {
  return localStorage.getItem(COLLAPSED_KEY) === "true";
}

// ── Active detection ───────────────────────────────────────────────────────────

function useIsActive() {
  const [location] = useLocation();
  const search = useSearch();
  return useCallback((item: NavItem) => {
    const pathMatches = location === item.path || location.startsWith(item.path + "/");
    if (!pathMatches) return false;
    const params = new URLSearchParams(search);
    if (item.search) {
      const itemParams = new URLSearchParams(item.search);
      for (const [k, v] of itemParams.entries()) {
        if (params.get(k) !== v) return false;
      }
      return true;
    }
    if (item.path === "/app/dashboard") return params.get("view") !== "daily";
    return true;
  }, [location, search]);
}

// ── Command Palette ────────────────────────────────────────────────────────────

interface PaletteProps {
  open: boolean;
  onClose: () => void;
  pinned: string[];
  onTogglePin: (id: string) => void;
}

function CommandPalette({ open, onClose, pinned, onTogglePin }: PaletteProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [, navigate] = useLocation();
  const isActive = useIsActive();

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const filtered = ALL_ITEMS.filter(item =>
    item.label.toLowerCase().includes(query.toLowerCase())
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[999] flex items-start justify-center pt-[15vh]"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background border border-border rounded-xl shadow-2xl w-[480px] max-h-[70vh] flex flex-col overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Type to filter..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Items */}
        <div className="overflow-y-auto flex-1 py-1">
          {filtered.map(item => {
            const isPinned = pinned.includes(item.id);
            const active = isActive(item);
            const href = item.search ? `${item.path}?${item.search}` : item.path;
            return (
              <div
                key={item.id}
                className={[
                  "flex items-center gap-3 px-4 py-2.5 cursor-pointer group",
                  active
                    ? "bg-muted/60"
                    : "hover:bg-muted/40",
                ].join(" ")}
                onClick={() => {
                  navigate(href);
                  onClose();
                }}
              >
                <item.icon className={`w-4 h-4 shrink-0 ${active ? "text-foreground" : "text-muted-foreground"}`} />
                <span className={`flex-1 text-sm ${active ? "font-medium text-foreground" : "text-foreground/80"}`}>
                  {item.label}
                </span>
                <button
                  onClick={e => { e.stopPropagation(); onTogglePin(item.id); }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted"
                  title={isPinned ? "Remove from pinned" : "Pin to sidebar"}
                >
                  <Star
                    className={`w-3.5 h-3.5 transition-colors ${
                      isPinned
                        ? "fill-amber-500 text-amber-500"
                        : "text-muted-foreground hover:text-amber-400"
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer hint */}
        <div className="border-t border-border px-4 py-2 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">Click star to pin to sidebar</span>
          <span className="text-[11px] text-muted-foreground">esc to close</span>
        </div>
      </div>
    </div>
  );
}

// ── Single nav item ────────────────────────────────────────────────────────────

interface SidebarItemProps {
  item: NavItem;
  collapsed: boolean;
  isPinned: boolean;
  isActive: boolean;
  onTogglePin: (id: string) => void;
}

function SidebarItem({ item, collapsed, isPinned, isActive, onTogglePin }: SidebarItemProps) {
  const href = item.search ? `${item.path}?${item.search}` : item.path;
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="relative group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Link
        href={href}
        className={[
          "flex items-center gap-2.5 rounded-md mx-2 transition-all duration-100 outline-none select-none",
          collapsed ? "px-2 py-2 justify-center" : "px-2.5 py-1.5",
          isActive
            ? "bg-white/20 text-white font-medium"
            : "text-white/65 hover:bg-white/10 hover:text-white",
        ].join(" ")}
        title={collapsed ? item.label : undefined}
      >
        <item.icon className="w-4 h-4 shrink-0" />
        {!collapsed && (
          <span className="text-sm flex-1 truncate">{item.label}</span>
        )}
      </Link>

      {/* Pin button — only visible on hover, only when not collapsed */}
      {!collapsed && hovered && (
        <button
          className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded transition-opacity"
          onClick={e => { e.preventDefault(); onTogglePin(item.id); }}
          title={isPinned ? "Unpin" : "Pin"}
        >
          <Star
            className={`w-3 h-3 ${isPinned ? "fill-amber-400 text-amber-400" : "text-white/30 hover:text-amber-400"}`}
          />
        </button>
      )}

      {/* Tooltip for collapsed mode */}
      {collapsed && hovered && (
        <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 z-50 px-2 py-1 bg-gray-900 text-white text-xs rounded shadow-md whitespace-nowrap pointer-events-none">
          {item.label}
        </div>
      )}
    </div>
  );
}

// ── User avatar button ─────────────────────────────────────────────────────────

function UserAvatar({ collapsed }: { collapsed: boolean }) {
  const { user, logout, isAdmin } = useAuth();
  const [, navigate] = useLocation();

  if (!user) return null;

  const initials = user.displayName
    .split(" ")
    .map((n: string) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={[
            "flex items-center gap-2.5 rounded-lg p-2 w-full transition-colors hover:bg-white/10 outline-none",
            collapsed ? "justify-center" : "",
          ].join(" ")}
        >
          <div className="h-7 w-7 rounded-full bg-white/20 text-white flex items-center justify-center text-[11px] font-bold shrink-0">
            {initials}
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 text-left min-w-0">
                <div className="text-xs font-medium text-white/90 truncate">{user.displayName}</div>
                <div className="text-[10px] text-white/45 truncate">{user.email}</div>
              </div>
              <ChevronDown className="w-3 h-3 text-white/35 shrink-0" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-52 mb-1">
        <DropdownMenuLabel className="font-normal py-2">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[12px] font-semibold">
              {initials}
            </div>
            <div>
              <p className="text-sm font-semibold">{user.displayName}</p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/app/docs")} className="cursor-pointer">
          <BookOpen className="mr-2 h-4 w-4 text-indigo-500" />
          Documentation
        </DropdownMenuItem>
        {isAdmin && (
          <DropdownMenuItem onClick={() => navigate("/app/admin")} className="cursor-pointer">
            <Shield className="mr-2 h-4 w-4 text-blue-500" />
            Administration
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => logout()}
          className="cursor-pointer text-red-600 dark:text-red-400 focus:text-red-600 focus:bg-red-50"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Main Sidebar ───────────────────────────────────────────────────────────────

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [pinned, setPinned] = useState<string[]>(loadPinned);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const isActive = useIsActive();
  const { isAdmin } = useAuth();
  const [, navigate] = useLocation();

  const toggleCollapsed = () => {
    setCollapsed(c => {
      const next = !c;
      localStorage.setItem(COLLAPSED_KEY, String(next));
      return next;
    });
  };

  const togglePin = useCallback((id: string) => {
    setPinned(prev => {
      const next = prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id];
      savePinned(next);
      return next;
    });
  }, []);

  // ⌘K / Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen(p => !p);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const pinnedItems = pinned
    .map(id => ALL_ITEMS.find(item => item.id === id))
    .filter(Boolean) as NavItem[];

  const visibleGroups = NAV_GROUPS.map(g => ({
    ...g,
    items: g.items.filter(item => !item.adminOnly || isAdmin),
  })).filter(g => g.items.length > 0);

  return (
    <>
      <aside
        className={[
          "h-screen flex flex-col shrink-0 transition-all duration-200 overflow-hidden",
          collapsed ? "w-[56px]" : "w-[220px]",
        ].join(" ")}
        style={{ background: "#2c4f26" }}
      >
        {/* ── App header ── */}
        <div className={[
          "flex items-center shrink-0 px-3 py-3 gap-2",
          collapsed ? "justify-center" : "justify-between",
        ].join(" ")}>
          <button
            onClick={() => navigate("/app/dashboard")}
            className="flex items-center gap-2 min-w-0 outline-none"
          >
            <img
              src={homeInsteadLogo}
              alt="Home Instead"
              className={`object-contain rounded shrink-0 opacity-90 ${collapsed ? "h-7 w-7" : "h-6 w-6"}`}
            />
            {!collapsed && (
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white truncate leading-tight">Care Capacity</div>
                <div className="text-[10px] text-white/50 truncate leading-tight">Home Instead</div>
              </div>
            )}
          </button>
          {!collapsed && (
            <button
              onClick={toggleCollapsed}
              className="p-1 rounded text-white/40 hover:text-white hover:bg-white/10 transition-colors shrink-0"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* ── Branch selector ── */}
        {collapsed ? (
          <div className="pb-2 flex justify-center">
            <BranchSelector iconOnly />
          </div>
        ) : (
          <div className="px-3 pb-2">
            <BranchSelector compact />
          </div>
        )}

        {/* ── Search / command bar ── */}
        <div className="px-3 pb-3 shrink-0">
          <button
            onClick={() => setPaletteOpen(true)}
            className={[
              "w-full flex items-center gap-2 rounded-lg border border-white/15 bg-white/10 text-white/60 hover:text-white hover:bg-white/15 transition-colors",
              collapsed ? "p-2 justify-center" : "px-3 py-1.5",
            ].join(" ")}
            title="Search (⌘K)"
          >
            <Search className="w-3.5 h-3.5 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left text-xs">Search...</span>
                <kbd className="text-[10px] font-mono bg-white/10 text-white/50 px-1 py-0.5 rounded border border-white/10 leading-none">
                  ⌘K
                </kbd>
              </>
            )}
          </button>
        </div>

        {/* ── Nav items ── */}
        <nav className="flex-1 overflow-y-auto space-y-4 px-0 pb-2">
          {/* Pinned section */}
          {pinnedItems.length > 0 && (
            <div>
              {!collapsed && (
                <div className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-white/35">
                  Pinned
                </div>
              )}
              <div className="space-y-0.5">
                {pinnedItems.map(item => (
                  <SidebarItem
                    key={`pinned-${item.id}`}
                    item={item}
                    collapsed={collapsed}
                    isPinned={pinned.includes(item.id)}
                    isActive={isActive(item)}
                    onTogglePin={togglePin}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Groups */}
          {visibleGroups.map(group => (
            <div key={group.label}>
              {!collapsed && (
                <div className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-white/35">
                  {group.label}
                </div>
              )}
              {collapsed && pinnedItems.length > 0 && (
                <div className="mx-2 mb-1 border-t border-white/10" />
              )}
              <div className="space-y-0.5">
                {group.items.map(item => (
                  <SidebarItem
                    key={item.id}
                    item={item}
                    collapsed={collapsed}
                    isPinned={pinned.includes(item.id)}
                    isActive={isActive(item)}
                    onTogglePin={togglePin}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* ── Footer ── */}
        <div className="shrink-0 border-t border-white/10 px-1 pt-2 pb-2 space-y-1">
          {/* Expand button when collapsed */}
          {collapsed && (
            <button
              onClick={toggleCollapsed}
              className="w-full flex justify-center p-2 text-white/40 hover:text-white hover:bg-white/10 rounded-md transition-colors"
              title="Expand sidebar"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          )}

          {/* Help */}
          <button
            onClick={() => setHelpOpen(true)}
            className={[
              "w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-white/50 hover:text-white hover:bg-white/10 transition-colors",
              collapsed ? "justify-center" : "",
            ].join(" ")}
            title={collapsed ? "Help" : undefined}
          >
            <HelpCircle className="w-4 h-4 shrink-0" />
            {!collapsed && <span className="text-xs">Help</span>}
          </button>

          {/* User */}
          <UserAvatar collapsed={collapsed} />
        </div>
      </aside>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        pinned={pinned}
        onTogglePin={togglePin}
      />

      <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}
