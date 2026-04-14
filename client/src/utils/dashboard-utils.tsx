import { Badge } from "@/components/ui/badge";
import { Zap } from "lucide-react";

export const fmtH = (hours: number): string => `${hours}h`;
export const fmtSignedH = (hours: number): string => `${hours >= 0 ? '+' : ''}${hours}h`;

export const GH_REGEX = /(\d+(?:\.\d+)?)\s*GH/i;

export const stripGhAnnotation = (name: string): string =>
  name.replace(/\s*\(?\d+(?:\.\d+)?\s*GH\)?\s*$/i, '').trim();

export interface GhLossItem {
  name: string;
  ghHours: number;
  weeklyScheduled: number;
  weeklyUnavailability: number;
  loss: number;
}

export interface GhLossResult {
  totalLoss: number;
  items: GhLossItem[];
}

export function computeGhLoss(
  employeeSummaryByDate: Record<string, Array<{
    employeeName: string;
    scheduledHours: number;
    ghScheduledHours?: number;
    unavailability: number;
    availability?: number;
  }>>,
): GhLossResult {
  // Step 1: Identify GH-contracted employees and their targets
  const ghTargets = new Map<string, number>();
  for (const records of Object.values(employeeSummaryByDate)) {
    for (const rec of records) {
      const match = GH_REGEX.exec(rec.employeeName);
      if (!match) continue;
      const key = stripGhAnnotation(rec.employeeName);
      if (!ghTargets.has(key)) ghTargets.set(key, parseFloat(match[1]));
    }
  }

  // Step 2: Accumulate per-employee weekly totals
  // - ghScheduledHours includes charge-and-pay cancellations + night shifts (preferred)
  // - availability is summed to enable proportional unavailability scaling
  const empTotals = new Map<string, {
    weeklyScheduled: number;
    weeklyUnavailability: number;
    weeklyAvailability: number;
  }>();

  for (const records of Object.values(employeeSummaryByDate)) {
    for (const rec of records) {
      const key = stripGhAnnotation(rec.employeeName);
      if (!ghTargets.has(key)) continue;
      // Prefer ghScheduledHours (includes paid cancellations + nights)
      const sched = rec.ghScheduledHours ?? rec.scheduledHours;
      const existing = empTotals.get(key);
      if (existing) {
        existing.weeklyScheduled += sched;
        existing.weeklyUnavailability += rec.unavailability ?? 0;
        existing.weeklyAvailability += rec.availability ?? 0;
      } else {
        empTotals.set(key, {
          weeklyScheduled: sched,
          weeklyUnavailability: rec.unavailability ?? 0,
          weeklyAvailability: rec.availability ?? 0,
        });
      }
    }
  }

  // Step 3: Build loss items — no ad-hoc exclusion, all GH employees count
  const items = Array.from(ghTargets.entries())
    .map(([key, ghHours]) => {
      const totals = empTotals.get(key) ?? {
        weeklyScheduled: 0,
        weeklyUnavailability: 0,
        weeklyAvailability: 0,
      };

      // Scale unavailability proportionally to GH hours, not desired hours.
      // If desired weekly = 40h and GH = 30h, a holiday counted as 8h becomes 6h.
      const ghUnavailability = totals.weeklyAvailability > 0
        ? Math.round((totals.weeklyUnavailability * (ghHours / totals.weeklyAvailability)) * 100) / 100
        : Math.round(totals.weeklyUnavailability * 100) / 100;

      const weeklyScheduled = Math.round(totals.weeklyScheduled * 100) / 100;
      const loss = Math.round((ghHours - ghUnavailability - weeklyScheduled) * 100) / 100;

      return {
        name: key,
        ghHours,
        weeklyScheduled,
        weeklyUnavailability: ghUnavailability,
        loss,
      };
    })
    .filter((item) => item.loss > 0)
    .sort((a, b) => b.loss - a.loss);

  const totalLoss = Math.round(items.reduce((acc, item) => acc + item.loss, 0) * 100) / 100;
  return { totalLoss, items };
}

export const statusBadge = (status: string): string => {
  return status === 'Sufficient'
    ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white'
    : 'bg-gradient-to-r from-red-500 to-red-600 text-white';
};

export const renderStatusBadge = (status: string) => {
  if (status === "Ad-hoc") {
    return (
      <Badge
        variant="secondary"
        className="gap-1.5 bg-gradient-to-r from-amber-500 to-amber-600 text-white border-0 shadow-sm"
        data-testid="badge-adhoc"
        title="Scheduled but no availability record for this day"
      >
        <Zap className="w-3.5 h-3.5" />
        Ad-hoc
      </Badge>
    );
  }

  let badgeClass = "font-medium shadow-sm";
  if (status.includes("Available")) {
    badgeClass = "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300 border-green-200";
  } else if (status.includes("Holiday")) {
    badgeClass = "bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300 border-purple-200";
  } else if (status.includes("Sickness") || status.includes("Sick")) {
    badgeClass = "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300";
  } else if (status.includes("Day-Killer")) {
    badgeClass = "bg-red-600 text-white dark:bg-red-900 dark:text-red-100 border-red-700";
  } else {
    badgeClass = "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 border-gray-200";
  }

  return (
    <Badge variant="outline" className={badgeClass} data-testid="badge-status-default">
      {status}
    </Badge>
  );
};
