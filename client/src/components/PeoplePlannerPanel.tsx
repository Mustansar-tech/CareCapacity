import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useBranch } from "@/contexts/BranchContext";
import { apiRequest } from "@/lib/queryClient";
import {
  Bot,
  Download,
  CheckCircle,
  XCircle,
  Loader2,
  RefreshCw,
  Calendar,
  Building2,
  AlertTriangle,
  FileDown,
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
  jobs?: AutomationJob[];
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const PHASE_LABELS: Record<string, string> = {
  starting: "Starting automation...",
  downloading_visitsExport: "Downloading Guaranteed Hours (1/3)...",
  downloading_careGiverExport: "Downloading CG Data Export (2/3)...",
  downloading_careGiverAvailabilityExport: "Downloading Availability Export (3/3)...",
  processing: "Processing data through pipeline...",
  complete: "Complete!",
  error: "Error occurred",
};

const PHASE_PROGRESS: Record<string, number> = {
  starting: 5,
  downloading_visitsExport: 20,
  downloading_careGiverExport: 45,
  downloading_careGiverAvailabilityExport: 70,
  processing: 88,
  complete: 100,
  error: 100,
};

function getMonday(d = new Date()): string {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  return date.toISOString().split("T")[0];
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
  const { selectedBranchId } = useBranch();
  const { toast } = useToast();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [weekStartDate, setWeekStartDate] = useState<string>(getMonday());
  const [elapsed, setElapsed] = useState<string>("");
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);

  // Poll session status while running
  const { data: session, refetch: refetchSession } = useQuery<PipelineSession>({
    queryKey: ["/api/pp/session", activeSessionId],
    queryFn: () => fetch(`/api/pp/session/${activeSessionId}`).then(r => r.json()),
    enabled: !!activeSessionId,
    refetchInterval: (data: PipelineSession | undefined) => {
      if (!data) return 2000;
      return data.status === "running" ? 2000 : false;
    },
    refetchIntervalInBackground: true,
  });

  // Invalidate dashboard data when session completes
  useEffect(() => {
    if (session?.status === "completed") {
      queryClient.invalidateQueries({ queryKey: ["/api/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/history/latest"] });
      toast({
        title: "People Planner sync complete",
        description: "Dashboard data has been refreshed with the latest data.",
      });
    }
  }, [session?.status]);

  // Elapsed timer
  useEffect(() => {
    if (!sessionStartedAt || session?.status !== "running") return;
    const interval = setInterval(() => {
      setElapsed(elapsedTime(sessionStartedAt));
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionStartedAt, session?.status]);

  const triggerMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/pp/trigger", {
        weekStartDate,
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

  // Week end date derived from start
  const weekEndDate = (() => {
    if (!weekStartDate) return "";
    const d = new Date(weekStartDate);
    d.setDate(d.getDate() + 6);
    return d.toISOString().split("T")[0];
  })();

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col gap-0 p-0">
        {/* Header */}
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <SheetTitle className="text-lg font-semibold">People Planner Sync</SheetTitle>
              <SheetDescription className="text-sm">
                Automatically download reports from Access Workspace
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1 px-6 py-4">
          <div className="space-y-5">

            {/* Week selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Week starting (Monday)
              </label>
              <input
                type="date"
                value={weekStartDate}
                onChange={e => setWeekStartDate(e.target.value)}
                disabled={isActive}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
              {weekStartDate && (
                <p className="text-xs text-muted-foreground">
                  Week: {formatDate(weekStartDate)} – {formatDate(weekEndDate)}
                </p>
              )}
            </div>

            {/* Reports that will run */}
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reports to download</p>
              {[
                { label: "Care Pro Guaranteed Hours", sub: "Visits & scheduled hours" },
                { label: "CG Data Export", sub: "Care Pro master data" },
                { label: "Availability Export", sub: "Shift patterns & availability" },
              ].map((r, i) => {
                const jobForIndex = session?.jobs?.[i];
                const isJobDone = jobForIndex?.status === "completed";
                const isJobFailed = jobForIndex?.status === "failed";
                const isJobRunning = jobForIndex?.status === "running" || jobForIndex?.status === "pending";
                return (
                  <div key={r.label} className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                      isJobDone ? "bg-emerald-100 dark:bg-emerald-900" :
                      isJobFailed ? "bg-red-100 dark:bg-red-900" :
                      isJobRunning ? "bg-blue-100 dark:bg-blue-900" : "bg-muted"
                    }`}>
                      {isJobDone ? <CheckCircle className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> :
                       isJobFailed ? <XCircle className="w-3.5 h-3.5 text-red-600" /> :
                       isJobRunning ? <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin" /> :
                       <span className="w-2 h-2 rounded-full bg-muted-foreground/40" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{r.label}</p>
                      <p className="text-xs text-muted-foreground">{r.sub}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Active session progress */}
            {(isActive || session) && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{phaseLabel}</p>
                  {session?.status === "running" && elapsed && (
                    <span className="text-xs text-muted-foreground">{elapsed}</span>
                  )}
                  {session?.status === "completed" && (
                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 border-0">
                      <CheckCircle className="w-3 h-3 mr-1" />Done
                    </Badge>
                  )}
                  {session?.status === "failed" && (
                    <Badge variant="destructive" className="border-0">
                      <XCircle className="w-3 h-3 mr-1" />Failed
                    </Badge>
                  )}
                </div>

                <Progress
                  value={progress}
                  className={`h-2 ${session?.status === "failed" ? "[&>div]:bg-red-500" : session?.status === "completed" ? "[&>div]:bg-emerald-500" : ""}`}
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
                        All 3 reports downloaded and processed. Dashboard data is now up to date.
                      </p>
                    </div>
                  </div>
                )}

                {/* Job download links */}
                {session?.jobs && session.jobs.some(j => j.downloadReady) && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Downloaded files</p>
                    {session.jobs.filter(j => j.downloadReady && j.fileName).map(j => (
                      <a
                        key={j.id}
                        href={`/api/pp/download/${j.id}`}
                        download={j.fileName ?? undefined}
                        className="flex items-center gap-2 rounded-md border bg-background hover:bg-muted/50 px-3 py-2 text-sm transition-colors cursor-pointer"
                      >
                        <FileDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <span className="flex-1 truncate">{j.fileName}</span>
                        <Download className="w-3 h-3 text-muted-foreground" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Configuration note */}
            {!activeSessionId && !triggerMutation.isPending && (
              <div className="rounded-lg border bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800 p-4">
                <div className="flex gap-2">
                  <Building2 className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Automated report download</p>
                    <p className="text-xs text-blue-600/80 dark:text-blue-400">
                      This will log into Access Workspace, navigate to People Planner, and download all 3 reports for the selected week. The data will be processed automatically and the dashboard updated.
                    </p>
                    <p className="text-xs text-blue-600/80 dark:text-blue-400 mt-1">
                      This typically takes 3–8 minutes depending on network speed.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t space-y-2">
          {session?.status === "failed" || session?.status === "completed" ? (
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
              className="w-full bg-gradient-to-r from-violet-500 to-indigo-600 hover:from-violet-600 hover:to-indigo-700 text-white border-0 shadow-lg"
              onClick={handleStart}
              disabled={isActive || !weekStartDate || !selectedBranchId}
            >
              {isActive ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Running automation...
                </>
              ) : (
                <>
                  <Bot className="w-4 h-4 mr-2" />
                  Start People Planner Sync
                </>
              )}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
