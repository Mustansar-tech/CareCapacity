import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Clock, CheckCircle2, XCircle, ChevronRight } from "lucide-react";

interface ActiveSession {
  sessionId: string;
  status: "queued" | "running";
  phase: string;
  startedAt: string;
  queuePosition: number;
  isOwnSession: boolean;
}

interface ActiveResponse {
  running: ActiveSession | null;
  queued: ActiveSession[];
  total: number;
}

interface FinishedBrief {
  status: "completed" | "failed";
  error?: string;
  clearedAt: number;
}

const PHASE_LABELS: Record<string, string> = {
  starting: "Starting...",
  downloading_visitsExport: "Downloading report 1/3...",
  downloading_careGiverExport: "Downloading report 2/3...",
  downloading_careGiverAvailabilityExport: "Downloading report 3/3...",
  processing: "Processing data...",
  complete: "Complete",
  error: "Error",
  queued: "Waiting...",
};

export function SyncStatusBar() {
  const [, navigate] = useLocation();
  const prevOwnSessionId = useRef<string | null>(null);
  const [finished, setFinished] = useState<FinishedBrief | null>(null);

  const { data } = useQuery<ActiveResponse>({
    queryKey: ["/api/pp/active"],
    refetchInterval: 5000,
    staleTime: 4000,
  });

  // Derive the own session from the response
  const ownRunning = data?.running?.isOwnSession ? data.running : null;
  const ownQueued = data?.queued?.find(s => s.isOwnSession) ?? null;
  const ownSession = ownRunning ?? ownQueued ?? null;

  // When own session disappears from active, fetch it once for final status
  useEffect(() => {
    if (!data) return;

    if (ownSession) {
      prevOwnSessionId.current = ownSession.sessionId;
      setFinished(null);
      return;
    }

    // Own session was previously tracked but is now gone
    if (prevOwnSessionId.current && !ownSession) {
      const id = prevOwnSessionId.current;
      prevOwnSessionId.current = null;

      fetch(`/api/pp/session/${id}`, { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .then(s => {
          if (!s) return;
          setFinished({
            status: s.status === "completed" ? "completed" : "failed",
            error: s.error,
            clearedAt: Date.now() + (s.status === "completed" ? 6000 : 12000),
          });
        })
        .catch(() => {});
    }
  }, [ownSession, data]);

  // Auto-clear the finished banner
  useEffect(() => {
    if (!finished) return;
    const ms = finished.clearedAt - Date.now();
    if (ms <= 0) { setFinished(null); return; }
    const t = setTimeout(() => setFinished(null), ms);
    return () => clearTimeout(t);
  }, [finished]);

  // Show nothing when truly idle
  const hasContent = ownSession || finished || (data && data.total > 0 && !ownSession);
  if (!data || !hasContent) return null;

  const go = () => navigate("/app/people-planner");

  // ── Another user's session (not mine) ──
  if (!ownSession && !finished && data && data.total > 0) {
    return (
      <div
        className="flex items-center gap-2 px-4 py-1.5 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        onClick={go}
      >
        <Loader2 className="w-3 h-3 animate-spin flex-shrink-0 text-slate-400" />
        <span>A sync is in progress on this server</span>
        <ChevronRight className="w-3 h-3 ml-auto flex-shrink-0 opacity-50" />
      </div>
    );
  }

  // ── Finished banner ──
  if (finished) {
    if (finished.status === "completed") {
      return (
        <div
          className="flex items-center gap-2 px-4 py-1.5 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border-b border-emerald-200 dark:border-emerald-800 cursor-pointer hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
          onClick={go}
        >
          <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
          <span className="font-medium">Sync complete — dashboard is up to date</span>
          <ChevronRight className="w-3 h-3 ml-auto flex-shrink-0 opacity-50" />
        </div>
      );
    }
    return (
      <div
        className="flex items-center gap-2 px-4 py-1.5 text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 cursor-pointer hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
        onClick={go}
      >
        <XCircle className="w-3 h-3 flex-shrink-0" />
        <span className="font-medium">Sync failed{finished.error ? ` — ${finished.error}` : ""}</span>
        <ChevronRight className="w-3 h-3 ml-auto flex-shrink-0 opacity-50" />
      </div>
    );
  }

  // ── Own queued session ──
  if (ownQueued && !ownRunning) {
    const pos = ownQueued.queuePosition;
    const ahead = pos - 1;
    return (
      <div
        className="flex items-center gap-2 px-4 py-1.5 text-xs text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
        onClick={go}
      >
        <Clock className="w-3 h-3 flex-shrink-0" />
        <span>
          <span className="font-medium">Your sync is queued</span>
          {ahead > 0 && <span className="opacity-70"> — {ahead} sync{ahead !== 1 ? "s" : ""} ahead, will start automatically</span>}
        </span>
        <ChevronRight className="w-3 h-3 ml-auto flex-shrink-0 opacity-50" />
      </div>
    );
  }

  // ── Own running session ──
  if (ownRunning) {
    const label = PHASE_LABELS[ownRunning.phase] ?? "Syncing...";
    return (
      <div
        className="flex items-center gap-2 px-4 py-1.5 text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border-b border-emerald-200 dark:border-emerald-800 cursor-pointer hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
        onClick={go}
      >
        <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
        <span>
          <span className="font-medium">Syncing your data</span>
          <span className="opacity-70"> — {label}</span>
        </span>
        <ChevronRight className="w-3 h-3 ml-auto flex-shrink-0 opacity-50" />
      </div>
    );
  }

  return null;
}
