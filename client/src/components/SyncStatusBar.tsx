import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Clock, CheckCircle2, XCircle, ChevronRight } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";

interface ActiveSession {
  sessionId: string;
  status: "queued" | "running";
  phase: string;
  startedAt: string;
  queuePosition: number;
  isOwnSession: boolean;
  branchId?: string; // only present for own sessions
}

interface ActiveResponse {
  running: ActiveSession | null;
  queued: ActiveSession[];
  total: number;
}

interface FinishedBrief {
  sessionId: string;
  branchId?: string;
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
  const { selectedBranchId } = useBranch();

  // Track session IDs we are watching so we can detect when they disappear
  const prevOwnSessionIds = useRef<Set<string>>(new Set());
  const [finished, setFinished] = useState<FinishedBrief | null>(null);

  const { data } = useQuery<ActiveResponse>({
    queryKey: ["/api/pp/active"],
    refetchInterval: 5000,
    staleTime: 4000,
  });

  // All own sessions (running + queued), keyed by branchId
  const allOwn: ActiveSession[] = [
    ...(data?.running?.isOwnSession ? [data.running] : []),
    ...(data?.queued?.filter(s => s.isOwnSession) ?? []),
  ];

  const currentOwnIds = new Set(allOwn.map(s => s.sessionId));

  // Detect sessions that have just disappeared (completed or failed)
  useEffect(() => {
    if (!data) return;

    const gone = [...prevOwnSessionIds.current].filter(id => !currentOwnIds.has(id));

    gone.forEach(id => {
      fetch(`/api/pp/session/${id}`, { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .then(s => {
          if (!s) return;
          setFinished({
            sessionId: id,
            branchId: s.branchId,
            status: s.status === "completed" ? "completed" : "failed",
            error: s.error,
            clearedAt: Date.now() + (s.status === "completed" ? 6000 : 12000),
          });
        })
        .catch(() => {});
    });

    // Keep set in sync — only update when content changes
    if (allOwn.length > 0) {
      prevOwnSessionIds.current = currentOwnIds;
    } else if (gone.length === 0) {
      prevOwnSessionIds.current = new Set();
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-clear finished banner
  useEffect(() => {
    if (!finished) return;
    const ms = finished.clearedAt - Date.now();
    if (ms <= 0) { setFinished(null); return; }
    const t = setTimeout(() => setFinished(null), ms);
    return () => clearTimeout(t);
  }, [finished]);

  // ── Derive what to show ──────────────────────────────────────────────────────

  // Session for the branch the user is currently viewing (highest priority)
  const currentBranchSession = allOwn.find(s => s.branchId === selectedBranchId);

  // Any own queued session for the current branch
  const currentBranchQueued = allOwn.find(
    s => s.status === "queued" && s.branchId === selectedBranchId
  );

  // Only show the strip if the current branch has something happening
  const currentBranchHasActivity =
    currentBranchSession ||
    (finished && finished.branchId === selectedBranchId);

  if (!data || !currentBranchHasActivity) return null;

  const go = () => navigate("/app/people-planner");

  // ── 1. Finished banner for current branch ───────────────────────────────────
  if (finished && finished.branchId === selectedBranchId) {
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

  // ── 2. Current branch is actively running ───────────────────────────────────
  if (currentBranchSession?.status === "running") {
    const label = PHASE_LABELS[currentBranchSession.phase] ?? "Syncing...";
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

  // ── 3. Current branch is queued (another branch is running) ─────────────────
  if (currentBranchQueued) {
    const ahead = currentBranchQueued.queuePosition - 1;
    return (
      <div
        className="flex items-center gap-2 px-4 py-1.5 text-xs text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
        onClick={go}
      >
        <Clock className="w-3 h-3 flex-shrink-0" />
        <span>
          <span className="font-medium">Your sync is queued</span>
          {ahead > 0 && (
            <span className="opacity-70">
              {" "}— {ahead} sync{ahead !== 1 ? "s" : ""} ahead, will start automatically
            </span>
          )}
        </span>
        <ChevronRight className="w-3 h-3 ml-auto flex-shrink-0 opacity-50" />
      </div>
    );
  }

  return null;
}
