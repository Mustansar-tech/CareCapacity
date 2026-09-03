import { Trophy } from "lucide-react";

// ── SUR Group BI · Scoreboards ──────────────────────────────────────────────
// Placeholder page. Dashboards for this tab will be built out later.

export default function SurGroupBiScoreboards() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6">
      <div className="h-14 w-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4">
        <Trophy className="w-7 h-7" />
      </div>
      <h1 className="text-lg font-semibold text-foreground mb-1">Scoreboards</h1>
      <p className="text-sm text-muted-foreground max-w-sm">
        Dashboards for this section are coming soon.
      </p>
    </div>
  );
}
