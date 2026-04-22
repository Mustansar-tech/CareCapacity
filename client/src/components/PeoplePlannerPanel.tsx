import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useBranch } from "@/contexts/BranchContext";
import {
  Bot,
  Download,
  CheckCircle,
  XCircle,
  X,
  Loader2,
  RefreshCw,
  Calendar,
  Building2,
  AlertTriangle,
  FileDown,
  Terminal,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface AutomationJob {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  downloadReady: boolean;
  fileName: string | null;
  filePath: string | null;
  config: {
    reportType: string;
    workspaceBranch: string;
    startDate: string;
    endDate: string;
  };
  logs: string[];
}

interface PipelineSession {
  sessionId: string;
  status: "running" | "completed" | "failed";
  error?: string;
  jobIds: string[];
  phase: string;
  startedAt: string;
  completedAt?: string;
  branchId?: string;
  jobs?: AutomationJob[];
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const PHASE_LABELS: Record<string, string> = {
  starting:                              "Starting automation...",
  downloading_visitsExport:              "Preparing dashboard data (1/3)...",
  downloading_careGiverExport:           "Loading dashboard metrics (2/3)...",
  downloading_careGiverAvailabilityExport: "Building dashboard insights (3/3)...",
  processing:                            "Updating dashboard...",
  complete:                              "Complete!",
  error:                                 "Error occurred",
};

const PHASE_PROGRESS: Record<string, number> = {
  starting:                              5,
  downloading_visitsExport:              20,
  downloading_careGiverExport:           45,
  downloading_careGiverAvailabilityExport: 70,
  processing:                            88,
  complete:                              100,
  error:                                 100,
};

const REPORT_LABELS: Record<string, string> = {
  visitsExport:                  "Care Pro Guaranteed Hours",
  careGiverExport:               "CG Data Export",
  careGiverAvailabilityExport:   "Availability Export",
};

function getMondayOf(d = new Date()): string {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  return date.toISOString().split("T")[0];
}

function normalizeToMonday(dateStr: string): string {
  if (!dateStr) return dateStr;
  return getMondayOf(new Date(dateStr));
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

function elapsedTime(startedAt: string): string {
  const diff = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  return `${Math.floor(diff / 60)}m ${diff % 60}s`;
}

export function PeoplePlannerPanel({ open, onClose }: Props) {
  const { selectedBranchId, branches } = useBranch();
  const { toast } = useToast();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [weekStartDate, setWeekStartDate] = useState<string>(getMondayOf());
  const [elapsed, setElapsed] = useState<string>("");
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState<string | null>(null);

  const selectedBranch = branches?.find(b => b.id === selectedBranchId);

  const { data: health } = useQuery<{ healthy: boolean; reason?: string }>({
    queryKey: ["/api/pp/health"],
    queryFn: async () => {
      const r = await fetch("/api/pp/health");
      if (!r.ok) return { healthy: false, reason: "Health check request failed" };
      return r.json();
    },
    enabled: open,
    staleTime: 60_000,
    retry: false,
  });

  const { data: session } = useQuery<PipelineSession>({
    queryKey: ["/api/pp/session", activeSessionId],
    queryFn: async () => {
      const r = await fetch(`/api/pp/session/${activeSessionId}`);
      if (!r.ok) throw new Error("Session not found");
      return r.json();
    },
    enabled: !!activeSessionId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 2000;
      return data.status === "running" ? 2000 : false;
    },
    refetchIntervalInBackground: true,
  });

  const { data: recentSessions } = useQuery<PipelineSession[]>({
    queryKey: ["/api/pp/sessions", selectedBranchId],
    queryFn: async () => {
      const url = selectedBranchId
        ? `/api/pp/sessions?branchId=${selectedBranchId}`
        : "/api/pp/sessions";
      const r = await fetch(url);
      if (!r.ok) throw new Error("Could not load sessions");
      return r.json();
    },
    enabled: open,
    refetchInterval: open ? 5000 : false,
  });

  useEffect(() => {
    if (session?.status === "completed") {
      queryClient.invalidateQueries({ queryKey: ["/api/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/history/latest"] });
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({
        title: "People Planner sync complete",
        description: "Dashboard data has been refreshed.",
      });
    }
  }, [session?.status]);

  useEffect(() => {
    if (session?.status !== "completed") return;
    const timer = setTimeout(() => onClose(), 1000);
    return () => clearTimeout(timer);
  }, [session?.status]);

  useEffect(() => {
    if (!sessionStartedAt || session?.status !== "running") return;
    const interval = setInterval(() => setElapsed(elapsedTime(sessionStartedAt)), 1000);
    return () => clearInterval(interval);
  }, [sessionStartedAt, session?.status]);

  const triggerMutation = useMutation({
    mutationFn: async () => {
      const monday = normalizeToMonday(weekStartDate);
      const response = await apiRequest("POST", "/api/pp/run", {
        weekStartDate: monday,
        branchId: selectedBranchId,
      });
      return response.json();
    },
    onSuccess: (data: { sessionId: string }) => {
      setActiveSessionId(data.sessionId);
      setSessionStartedAt(new Date().toISOString());
      setElapsed("0s");
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to start automation",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const isActive = session?.status === "running" || triggerMutation.isPending;
  const automationAvailable = health?.healthy ?? true;
  const phase = session?.phase ?? "starting";
  const progress = PHASE_PROGRESS[phase] ?? 10;
  const phaseLabel = PHASE_LABELS[phase] ?? phase;

  const handleStart = () => {
    setActiveSessionId(null);
    setElapsed("");
    setSessionStartedAt(null);
    triggerMutation.mutate();
  };

  const handleReset = () => {
    setActiveSessionId(null);
    setElapsed("");
    setSessionStartedAt(null);
  };

  const weekEndDate = (() => {
    if (!weekStartDate) return "";
    const d = new Date(weekStartDate);
    d.setDate(d.getDate() + 6);
    return d.toISOString().split("T")[0];
  })();

  const sessionJobs = session?.jobs ?? [];
  const reportOrder = ["visitsExport", "careGiverExport", "careGiverAvailabilityExport"] as const;

  if (!open) return null;

  return (
    <Card className="material-card hover-lift animate-slide-up mb-4 elevation-2">
      <CardHeader className="gradient-card dark:gradient-card-dark rounded-t-lg pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg flex-shrink-0">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div>
              <CardTitle className="text-lg font-semibold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">Process Data</CardTitle>
              <CardDescription className="text-xs">select the week to process new data</CardDescription>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-700 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">

        {/* Automation unavailable banner */}
        {health && !health.healthy && (
          <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Automation unavailable</p>
              {health.reason && (
                <p className="text-xs text-amber-600/80 dark:text-amber-400">{health.reason}</p>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Branch display */}
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
            <Building2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Branch</p>
              <p className="text-sm font-medium truncate">
                {selectedBranch?.displayName ?? selectedBranchId ?? "—"}
              </p>
            </div>
          </div>

          {/* Week selector */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              Week starting (Monday)
            </label>
            <input
              type="date"
              value={weekStartDate}
              onChange={e => setWeekStartDate(normalizeToMonday(e.target.value))}
              disabled={isActive}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            {weekStartDate && (
              <p className="text-xs text-muted-foreground">
                {formatDate(weekStartDate)} – {formatDate(weekEndDate)}
              </p>
            )}
          </div>
        </div>

        {/* Active session progress */}
        {(isActive || session) && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{phaseLabel}</p>
              <div className="flex items-center gap-2">
                {session?.status === "running" && elapsed && (
                  <span className="text-xs text-muted-foreground">{elapsed}</span>
                )}
                {session?.status === "completed" && (
                  <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 border-0 text-xs">
                    <CheckCircle className="w-3 h-3 mr-1" />Done
                  </Badge>
                )}
                {session?.status === "failed" && (
                  <Badge variant="destructive" className="border-0 text-xs">
                    <XCircle className="w-3 h-3 mr-1" />Failed
                  </Badge>
                )}
              </div>
            </div>

            <Progress
              value={progress}
              className={`h-2 ${
                session?.status === "failed"
                  ? "[&>div]:bg-red-500"
                  : session?.status === "completed"
                  ? "[&>div]:bg-emerald-500"
                  : ""
              }`}
            />

            {session?.status === "failed" && session.error && (
              <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3">
                <div className="flex gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700 dark:text-red-300">{session.error}</p>
                </div>
              </div>
            )}

            {session?.status === "completed" && (
              <div className="rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-3">
                <div className="flex gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-emerald-700 dark:text-emerald-300">
                    Dashboard updated successfully and ready to explore.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Recent sessions history */}
        {recentSessions && recentSessions.length > 0 && !isActive && !session && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recent syncs</p>
            <div className="space-y-1.5">
              {recentSessions.slice(0, 5).map(s => {
                const reportDate = s.jobs?.[0]?.config?.startDate;
                const completedJobs = s.jobs?.filter(j => j.status === "completed").length ?? 0;
                const totalJobs = s.jobs?.length ?? s.jobIds.length;
                return (
                  <div key={s.sessionId} className="rounded-md border px-3 py-2 text-xs bg-muted/20 space-y-1">
                    <div className="flex items-center gap-2">
                      {s.status === "completed" ? (
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                      ) : s.status === "failed" ? (
                        <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                      ) : (
                        <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin flex-shrink-0" />
                      )}
                      <span className="flex-1 font-medium text-foreground/80">
                        {reportDate ? `w/c ${formatDate(reportDate)}` : "Sync"}
                      </span>
                      <span className="text-muted-foreground/70 flex-shrink-0">
                        {new Date(s.startedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 pl-5 text-muted-foreground">
                      <span>{completedJobs}/{totalJobs} reports downloaded</span>
                      {s.status === "failed" && s.error && (
                        <span className="text-red-500 truncate max-w-[160px]" title={s.error}>
                          — {s.error}
                        </span>
                      )}
                    </div>
                    {s.jobs && s.jobs.filter(j => j.downloadReady && j.fileName).length > 0 && (
                      <div className="flex flex-wrap gap-2 pl-5 pt-0.5">
                        {s.jobs.filter(j => j.downloadReady && j.fileName).map(j => (
                          <a
                            key={j.id}
                            href={`/api/pp/download/${j.id}`}
                            download={j.fileName}
                            className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                            title={`Download ${j.fileName}`}
                          >
                            <FileDown className="w-3 h-3" />
                            {REPORT_LABELS[j.config?.reportType] ?? j.config?.reportType}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="pt-1">
          {(session?.status === "failed" || session?.status === "completed") ? (
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={handleReset}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Run again
              </Button>
              <Button variant="outline" className="flex-1" onClick={onClose}>
                Close
              </Button>
            </div>
          ) : (
            <Button
              className="w-full bg-gradient-to-r from-violet-500 to-indigo-600 hover:from-violet-600 hover:to-indigo-700 text-white border-0 shadow-lg disabled:opacity-60"
              onClick={handleStart}
              disabled={isActive || !weekStartDate || !selectedBranchId || !automationAvailable}
              title={!automationAvailable ? (health?.reason ?? "Automation unavailable") : undefined}
            >
              {isActive ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Running automation...
                </>
              ) : (
                <>
                  <Bot className="w-4 h-4 mr-2" />
                  Start Processing
                </>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
