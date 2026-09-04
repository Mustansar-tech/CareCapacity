import type { GhLossRawSummary } from "@shared/schema";
import { normalizeName } from "../../shared/utils/shared-utils";

const GH_REGEX = /(?:(\d+(?:\.\d+)?)\s*GH\b|\bGH\s*(\d+(?:\.\d+)?))/i;

interface EmployeeSummary {
  employeeName: string;
  scheduledHours: number;
  ghScheduledHours?: number;
  unavailability: number;
  availability?: number;
}

type EmployeeSummaryByDate = Record<string, EmployeeSummary[]>;
type CrossBranchHours = Record<string, { hours: number; branches: Record<string, number> }>;

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Server-side equivalent of the dashboard GH Loss card calculation.
 * Keeping the KPI sync on the same inputs ensures both screens show the same
 * total, including cross-branch credits and foreign-carer exclusions.
 */
export function calculateGhLossTotal(
  employeeSummaryByDate: EmployeeSummaryByDate,
  rawSummary?: GhLossRawSummary | null,
  crossBranchHours?: CrossBranchHours,
  foreignCarers: string[] = [],
): number {
  const foreignSet = new Set(foreignCarers);

  if (rawSummary) {
    const unavailability = new Map<string, { hours: number; availability: number }>();
    for (const records of Object.values(employeeSummaryByDate)) {
      for (const record of records) {
        const key = normalizeName(record.employeeName);
        if (!rawSummary.targets[key]) continue;
        const current = unavailability.get(key) ?? { hours: 0, availability: 0 };
        current.hours += record.unavailability ?? 0;
        current.availability += record.availability ?? 0;
        unavailability.set(key, current);
      }
    }

    const losses = Object.entries(rawSummary.targets)
      .filter(([key]) => !foreignSet.has(key))
      .map(([key, target]) => {
        const unavailable = unavailability.get(key) ?? { hours: 0, availability: 0 };
        const ghUnavailable = unavailable.availability > 0
          ? round2(unavailable.hours * (target.hours / unavailable.availability))
          : round2(unavailable.hours);
        const scheduled = round2(
          (rawSummary.scheduled[key] ?? 0) + (crossBranchHours?.[key]?.hours ?? 0),
        );
        return round2(target.hours - ghUnavailable - scheduled);
      })
      .filter(loss => loss > 0);

    return round2(losses.reduce((total, loss) => total + loss, 0));
  }

  const targets = new Map<string, number>();
  const totals = new Map<string, { scheduled: number; unavailable: number; availability: number }>();

  for (const records of Object.values(employeeSummaryByDate)) {
    for (const record of records) {
      const match = GH_REGEX.exec(record.employeeName);
      if (!match) continue;
      const key = normalizeName(record.employeeName);
      if (!targets.has(key)) targets.set(key, Number(match[1] ?? match[2]));
    }
  }

  for (const records of Object.values(employeeSummaryByDate)) {
    for (const record of records) {
      const key = normalizeName(record.employeeName);
      if (!targets.has(key)) continue;
      const current = totals.get(key) ?? { scheduled: 0, unavailable: 0, availability: 0 };
      current.scheduled += record.ghScheduledHours ?? record.scheduledHours ?? 0;
      current.unavailable += record.unavailability ?? 0;
      current.availability += record.availability ?? 0;
      totals.set(key, current);
    }
  }

  const losses = Array.from(targets.entries())
    .filter(([key]) => !foreignSet.has(key))
    .map(([key, target]) => {
      const total = totals.get(key) ?? { scheduled: 0, unavailable: 0, availability: 0 };
      const ghUnavailable = total.availability > 0
        ? round2(total.unavailable * (target / total.availability))
        : round2(total.unavailable);
      const scheduled = round2(total.scheduled + (crossBranchHours?.[key]?.hours ?? 0));
      return round2(target - ghUnavailable - scheduled);
    })
    .filter(loss => loss > 0);

  return round2(losses.reduce((total, loss) => total + loss, 0));
}