import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Cookie, Shield, BarChart2, AlertCircle, ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

const STORAGE_KEY = "cookie_consent_v2";

type ConsentChoice = "all" | "necessary";

interface CookieCategory {
  id: string;
  icon: typeof Shield;
  iconColor: string;
  title: string;
  description: string;
  required: boolean;
}

const CATEGORIES: CookieCategory[] = [
  {
    id: "necessary",
    icon: Shield,
    iconColor: "text-green-600 dark:text-green-400",
    title: "Strictly necessary",
    description:
      "A single session cookie keeps you signed in. Without it the application cannot function. These cannot be disabled.",
    required: true,
  },
  {
    id: "monitoring",
    icon: AlertCircle,
    iconColor: "text-amber-500 dark:text-amber-400",
    title: "Error monitoring",
    description:
      "Sentry captures application errors and performance data so we can identify and fix problems quickly. No personal care data is included in error reports.",
    required: false,
  },
  {
    id: "analytics",
    icon: BarChart2,
    iconColor: "text-blue-500 dark:text-blue-400",
    title: "Analytics",
    description:
      "Vercel Analytics collects anonymous page-view data (no identifying information) to help us understand how the tool is used and where to improve it.",
    required: false,
  },
];

export function CookieBanner() {
  const { isAuthenticated, isLoading } = useAuth();
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) setVisible(true);
    } catch {
      // localStorage unavailable — don't show banner
    }
  }, []);

  function save(choice: ConsentChoice) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ choice, ts: Date.now() }));
    } catch {
      // ignore
    }
    setVisible(false);
  }

  if (!visible || isLoading || isAuthenticated) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Cookie preferences"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] w-full max-w-lg px-4"
    >
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl shadow-black/10 dark:shadow-black/50 overflow-hidden">

        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex items-start gap-3 px-5 pt-5 pb-4">
          <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center mt-0.5">
            <Cookie className="h-4.5 w-4.5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-white leading-snug">
              We updated what we use cookies for
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
              We now use cookies and similar tools for signing in, error monitoring, and anonymous analytics.
              Choose what you're comfortable with.{" "}
              <Link
                href="/privacy"
                className="text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
              >
                Privacy Policy
              </Link>
            </p>
          </div>
        </div>

        {/* ── Expandable detail ──────────────────────────────── */}
        <div className="px-5">
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors mb-3"
            aria-expanded={expanded}
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {expanded ? "Hide details" : "Show what each one does"}
          </button>

          {expanded && (
            <div className="space-y-2.5 mb-4">
              {CATEGORIES.map(cat => {
                const Icon = cat.icon;
                return (
                  <div
                    key={cat.id}
                    className="flex items-start gap-3 bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700/50 rounded-xl px-3.5 py-3"
                  >
                    <Icon className={`h-4 w-4 flex-shrink-0 mt-0.5 ${cat.iconColor}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                          {cat.title}
                        </span>
                        {cat.required && (
                          <span className="text-[10px] font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 px-1.5 py-0.5 rounded-full">
                            Always on
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
                        {cat.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Actions ────────────────────────────────────────── */}
        <div className="flex items-center gap-2.5 px-5 pb-5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => save("necessary")}
            className="flex-1 rounded-xl border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-xs font-semibold hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <X className="h-3.5 w-3.5 mr-1.5 text-gray-400" />
            Necessary only
          </Button>
          <Button
            size="sm"
            onClick={() => save("all")}
            className="flex-1 rounded-xl text-xs font-semibold shadow-md"
            style={{ background: "#2c4f26" }}
          >
            <Cookie className="h-3.5 w-3.5 mr-1.5" />
            Accept all
          </Button>
        </div>
      </div>
    </div>
  );
}
