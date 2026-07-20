import { Badge } from "@/components/ui/badge";
import { Zap } from "lucide-react";

export const fmtH = (hours: number): string => `${Math.round(hours * 100) / 100}h`;
export const fmtSignedH = (hours: number): string => `${hours >= 0 ? '+' : ''}${Math.round(hours * 100) / 100}h`;

export const GH_REGEX = /(\d+(?:\.\d+)?)\s*GH/i;

export const stripGhAnnotation = (name: string): string =>
  name.replace(/\s*\(?\d+(?:\.\d+)?\s*GH\)?\s*$/i, '').trim();

/**
 * Canonical key that matches the server-side normalizeName logic:
 * removes parentheticals (GH annotation etc), non-alpha chars (commas etc),
 * then sorts the remaining words so "Azhar, Taimoor" and "Taimoor (37.5GH) Azhar"
 * both produce the same key.
 */
function normalizeGhKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, '')     // remove anything in parentheses
    .replace(/[^a-z\s]/g, ' ')  // remove commas, hyphens, etc.
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ');
}

/** Strip GH annotation wherever it appears in the name (not just at the end). */
function cleanDisplayName(name: string): string {
  return name
    .replace(/\s*\(\d+(?:\.\d+)?\s*GH\)\s*/gi, ' ')  // remove (XGH) mid-name or end
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/,\s*$/, '');  // no trailing comma
}

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

export interface GhLossRawSummary {
  targets: Record<string, { hours: number; displayName: string }>;
  scheduled: Record<string, number>;
}

/**
 * Compute GH Loss.
 *
 * When `ghLossRawSummary` is provided (from the server-side raw summary), the
 * scheduled hours come from the raw guaranteed hours file — completely bypassing
 * the availability pipeline.  This correctly captures night visits, paid
 * cancellations, and any hours that might be missing from employeeSummaryByDate.
 *
 * Unavailability is always taken from employeeSummaryByDate (since it comes from
 * the availability file, not the guaranteed hours file).
 */
export function computeGhLoss(
  employeeSummaryByDate: Record<string, Array<{
    employeeName: string;
    scheduledHours: number;
    ghScheduledHours?: number;
    unavailability: number;
    availability?: number;
  }>>,
  ghLossRawSummary?: GhLossRawSummary,
): GhLossResult {
  // ── PATH A: raw summary available (new uploads) ───────────────────────────────
  if (ghLossRawSummary) {
    const { targets, scheduled } = ghLossRawSummary;

    // Accumulate weekly unavailability from employeeSummaryByDate.
    // Key here must match the normalizeGhKey used on the server so that
    // "Alison (30GH) Dalzell Stewart" and "Dalzell Stewart, Alison" both resolve.
    const unavailTotals = new Map<string, { weeklyUnavailability: number; weeklyAvailability: number }>();
    for (const records of Object.values(employeeSummaryByDate)) {
      for (const rec of records) {
        const normKey = normalizeGhKey(rec.employeeName);
        if (!targets[normKey]) continue;
        const existing = unavailTotals.get(normKey);
        if (existing) {
          existing.weeklyUnavailability += rec.unavailability ?? 0;
          existing.weeklyAvailability += rec.availability ?? 0;
        } else {
          unavailTotals.set(normKey, {
            weeklyUnavailability: rec.unavailability ?? 0,
            weeklyAvailability: rec.availability ?? 0,
          });
        }
      }
    }

    const items = Object.entries(targets)
      .map(([normKey, { hours: ghHours, displayName }]) => {
        const weeklyScheduled = Math.round((scheduled[normKey] ?? 0) * 100) / 100;
        const unavail = unavailTotals.get(normKey) ?? { weeklyUnavailability: 0, weeklyAvailability: 0 };

        const ghUnavailability = unavail.weeklyAvailability > 0
          ? Math.round((unavail.weeklyUnavailability * (ghHours / unavail.weeklyAvailability)) * 100) / 100
          : Math.round(unavail.weeklyUnavailability * 100) / 100;

        const loss = Math.round((ghHours - ghUnavailability - weeklyScheduled) * 100) / 100;
        return { name: displayName, ghHours, weeklyScheduled, weeklyUnavailability: ghUnavailability, loss };
      })
      .filter((item) => item.loss > 0)
      .sort((a, b) => b.loss - a.loss);

    const totalLoss = Math.round(items.reduce((acc, i) => acc + i.loss, 0) * 100) / 100;
    return { totalLoss, items };
  }

  // ── PATH B: legacy fallback (older data without raw summary) ─────────────────
  // Step 1: Identify GH-contracted employees.
  // Key = normalizeGhKey (removes GH annotation + punctuation, sorts words) so that
  // "Taimoor (37.5GH) Azhar" and "Azhar, Taimoor (37.5GH)" map to the same entry.
  // displayName = cleanDisplayName (removes the annotation but keeps natural word order).
  const ghTargets = new Map<string, { hours: number; displayName: string }>();

  for (const records of Object.values(employeeSummaryByDate)) {
    for (const rec of records) {
      const match = GH_REGEX.exec(rec.employeeName);
      if (!match) continue;
      const normKey = normalizeGhKey(rec.employeeName);
      if (!ghTargets.has(normKey)) {
        ghTargets.set(normKey, {
          hours: parseFloat(match[1]),
          displayName: cleanDisplayName(rec.employeeName),
        });
      }
    }
  }

  // Step 2: Accumulate per-employee weekly totals under the same normalized key.
  const empTotals = new Map<string, {
    weeklyScheduled: number;
    weeklyUnavailability: number;
    weeklyAvailability: number;
  }>();

  for (const records of Object.values(employeeSummaryByDate)) {
    for (const rec of records) {
      const normKey = normalizeGhKey(rec.employeeName);
      if (!ghTargets.has(normKey)) continue;
      const sched = rec.ghScheduledHours ?? rec.scheduledHours;
      const existing = empTotals.get(normKey);
      if (existing) {
        existing.weeklyScheduled += sched;
        existing.weeklyUnavailability += rec.unavailability ?? 0;
        existing.weeklyAvailability += rec.availability ?? 0;
      } else {
        empTotals.set(normKey, {
          weeklyScheduled: sched,
          weeklyUnavailability: rec.unavailability ?? 0,
          weeklyAvailability: rec.availability ?? 0,
        });
      }
    }
  }

  // Step 3: Build loss items.
  const items = Array.from(ghTargets.entries())
    .map(([normKey, { hours: ghHours, displayName }]) => {
      const totals = empTotals.get(normKey) ?? {
        weeklyScheduled: 0,
        weeklyUnavailability: 0,
        weeklyAvailability: 0,
      };

      const ghUnavailability = totals.weeklyAvailability > 0
        ? Math.round((totals.weeklyUnavailability * (ghHours / totals.weeklyAvailability)) * 100) / 100
        : Math.round(totals.weeklyUnavailability * 100) / 100;

      const weeklyScheduled = Math.round(totals.weeklyScheduled * 100) / 100;
      const loss = Math.round((ghHours - ghUnavailability - weeklyScheduled) * 100) / 100;

      return { name: displayName, ghHours, weeklyScheduled, weeklyUnavailability: ghUnavailability, loss };
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
