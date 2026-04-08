import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { BarChart3, Calendar, Users, Bot, HardDrive, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", path: "/app/dashboard", icon: BarChart3 },
  { label: "Schedule", path: "/app/schedule", icon: Calendar },
  { label: "BD Matrix", path: "/app/bd-matrix", icon: Users },
  { label: "People Planner", path: "/app/people-planner", icon: Bot },
  { label: "Data Management", path: "/app/data-management", icon: HardDrive },
  { label: "Administration", path: "/app/admin", icon: Shield, adminOnly: true },
];

export function Sidebar() {
  const [location] = useLocation();
  const { isAdmin } = useAuth();

  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  return (
    <aside className="fixed left-0 top-0 h-full w-56 z-40 bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl border-r border-gray-200/50 dark:border-gray-700/50 pt-20 flex flex-col">
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {visibleItems.map((item) => {
          const isActive =
            location === item.path || location.startsWith(item.path + "/");
          return (
            <Link
              key={item.path}
              href={item.path}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100"
              )}
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
