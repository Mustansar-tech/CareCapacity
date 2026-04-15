import { useMemo, useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth, type AuthUser } from "@/contexts/AuthContext";
import type { CapacityAnalysisSummary } from "@shared/schema";
import { computeGhLoss } from "@/utils/dashboard-utils";

export type NotificationType = "success" | "warning" | "alert" | "info";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  link?: string;
}

const STORAGE_KEY_PREFIX = "notifications_read";

function getStorageKey(userId: string, branchId: string) {
  return `${STORAGE_KEY_PREFIX}:${userId}:${branchId}`;
}

function loadReadIds(userId: string, branchId: string): Set<string> {
  try {
    const raw = localStorage.getItem(getStorageKey(userId, branchId));
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveReadIds(userId: string, branchId: string, ids: Set<string>) {
  try {
    localStorage.setItem(getStorageKey(userId, branchId), JSON.stringify([...ids]));
  } catch {}
}

function deriveNotifications(
  analyses: CapacityAnalysisSummary[],
  readIds: Set<string>,
  branchId: string,
): AppNotification[] {
  const notifications: AppNotification[] = [];

  for (const analysis of analyses) {
    const uploadedAt = new Date(analysis.uploadedAt);
    const weekLabel = `${new Date(analysis.weekStartDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${new Date(analysis.weekEndDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;

    const procId = `proc:${analysis.id}`;
    const warnings = (analysis.warnings as string[] | undefined) ?? [];
    if (warnings.length > 0) {
      const warnId = `warn:${analysis.id}`;
      notifications.push({
        id: warnId,
        type: "warning",
        title: `${warnings.length} processing warning${warnings.length > 1 ? "s" : ""}`,
        message: `Week ${weekLabel}: ${warnings[0]}${warnings.length > 1 ? ` and ${warnings.length - 1} more.` : ""}`,
        timestamp: uploadedAt,
        read: readIds.has(warnId),
        link: "/app/dashboard",
      });
    }

    if (analysis.employeeSummaryByDate) {
      try {
        const ghLoss = computeGhLoss(
          analysis.employeeSummaryByDate as any,
          analysis.ghLossRawSummary as any,
        );
        if (ghLoss.items.length > 0) {
          const ghlId = `ghl:${analysis.id}`;
          notifications.push({
            id: ghlId,
            type: "alert",
            title: `GH Loss: ${ghLoss.items.length} staff below target`,
            message: `Week ${weekLabel}: ${ghLoss.totalLoss}h total shortfall across ${ghLoss.items.length} care pro${ghLoss.items.length > 1 ? "s" : ""}.`,
            timestamp: uploadedAt,
            read: readIds.has(ghlId),
            link: "/app/dashboard",
          });
        }
      } catch {}
    }
  }

  notifications.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return notifications;
}

export function useNotifications() {
  const { selectedBranchId } = useBranch();
  const { user } = useAuth();
  const userId = user?.id ?? "anon";
  const branchId = selectedBranchId ?? "none";

  const [readIds, setReadIds] = useState<Set<string>>(() =>
    loadReadIds(userId, branchId),
  );

  useEffect(() => {
    setReadIds(loadReadIds(userId, branchId));
  }, [userId, branchId]);

  const { data: analyses } = useQuery<CapacityAnalysisSummary[]>({
    queryKey: ["/api/history"],
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 60_000,
  });

  const notifications = useMemo(
    () => deriveNotifications(analyses ?? [], readIds, branchId),
    [analyses, readIds, branchId],
  );

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const markAllRead = useCallback(() => {
    const newIds = new Set(readIds);
    for (const n of notifications) newIds.add(n.id);
    saveReadIds(userId, branchId, newIds);
    setReadIds(new Set(newIds));
  }, [notifications, readIds, userId, branchId]);

  const markRead = useCallback(
    (id: string) => {
      const newIds = new Set(readIds);
      newIds.add(id);
      saveReadIds(userId, branchId, newIds);
      setReadIds(new Set(newIds));
    },
    [readIds, userId, branchId],
  );

  return { notifications, unreadCount, markAllRead, markRead };
}
