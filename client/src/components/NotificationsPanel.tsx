import { useLocation } from "wouter";
import { Bell, CheckCheck, AlertTriangle, CheckCircle, Info, TrendingDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useNotifications, type AppNotification } from "@/hooks/use-notifications";

function formatRelative(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const typeConfig = {
  success: {
    icon: CheckCircle,
    iconClass: "text-emerald-500",
    dot: "bg-emerald-500",
    bg: "bg-emerald-50 dark:bg-emerald-900/20",
    border: "border-emerald-100 dark:border-emerald-800/30",
  },
  warning: {
    icon: AlertTriangle,
    iconClass: "text-amber-500",
    dot: "bg-amber-500",
    bg: "bg-amber-50 dark:bg-amber-900/20",
    border: "border-amber-100 dark:border-amber-800/30",
  },
  alert: {
    icon: TrendingDown,
    iconClass: "text-rose-500",
    dot: "bg-rose-500",
    bg: "bg-rose-50 dark:bg-rose-900/20",
    border: "border-rose-100 dark:border-rose-800/30",
  },
  info: {
    icon: Info,
    iconClass: "text-blue-500",
    dot: "bg-blue-500",
    bg: "bg-blue-50 dark:bg-blue-900/20",
    border: "border-blue-100 dark:border-blue-800/30",
  },
};

function NotificationItem({
  notification,
  onRead,
  onNavigate,
}: {
  notification: AppNotification;
  onRead: (id: string) => void;
  onNavigate: () => void;
}) {
  const [, navigate] = useLocation();
  const cfg = typeConfig[notification.type];
  const Icon = cfg.icon;

  function handleClick() {
    onRead(notification.id);
    if (notification.link) {
      navigate(notification.link);
      onNavigate();
    }
  }

  return (
    <div
      onClick={handleClick}
      className={[
        "flex gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800 last:border-0 transition-colors",
        notification.link ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50" : "",
        !notification.read ? "bg-blue-50/40 dark:bg-blue-900/10" : "",
      ].join(" ")}
    >
      <div className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${cfg.bg} border ${cfg.border}`}>
        <Icon className={`w-4 h-4 ${cfg.iconClass}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm font-semibold leading-snug ${notification.read ? "text-gray-600 dark:text-gray-400" : "text-gray-900 dark:text-white"}`}>
            {notification.title}
          </p>
          <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap mt-0.5 shrink-0">
            {formatRelative(notification.timestamp)}
          </span>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed line-clamp-2">
          {notification.message}
        </p>
      </div>
      {!notification.read && (
        <div className={`mt-2 w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
      )}
    </div>
  );
}

interface NotificationsBellProps {
  className?: string;
}

export function NotificationsBell({ className }: NotificationsBellProps) {
  const { notifications, unreadCount, markAllRead, markRead } = useNotifications();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label="Notifications"
          title="Notifications"
          className={`relative p-1.5 text-white/65 hover:text-white transition-colors ${className ?? ""}`}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[360px] p-0 shadow-2xl border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            <span className="text-sm font-bold text-gray-900 dark:text-white">Notifications</span>
            {unreadCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-[10px] font-bold">
                {unreadCount} new
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 transition-colors font-medium"
              title="Mark all as read"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Mark all read
            </button>
          )}
        </div>

        {/* Notification list */}
        <div className="max-h-[420px] overflow-y-auto bg-white dark:bg-gray-900">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
                <Bell className="w-5 h-5 text-gray-400 dark:text-gray-500" />
              </div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">All caught up</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Notifications will appear here after data is processed.
              </p>
            </div>
          ) : (
            notifications.map((n) => (
              <NotificationItem
                key={n.id}
                notification={n}
                onRead={markRead}
                onNavigate={() => {}}
              />
            ))
          )}
        </div>

        {/* Footer */}
        {notifications.length > 0 && (
          <div className="px-4 py-2.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 text-center">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Showing last {notifications.length} notification{notifications.length !== 1 ? "s" : ""}
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
