import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, toAbsoluteUrl } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Save } from "lucide-react";

// ── Types (mirrors shared/schema.ts annualRoadmapEntries/annualRoadmapAssumptions) ─

interface RoadmapEntry {
  id: string;
  year: number;
  office: string;
  month: number;
  projectedRevenue: number;
  actualRevenue: number | null;
  dayRateTarget: number;
  clientHoursTarget: number;
  careProHoursTarget: number;
  monthlyGrowthTarget: number;
  enquiriesRequired: number;
  clientsRequired: number;
  careProApplicationsRequired: number;
  careProsRequiredHeads: number;
  newCareProHoursRequired: number;
  netCareProHoursRequired: number;
}

interface RoadmapAssumption {
  id: string;
  year: number;
  displayOrder: number;
  headcountThreshold: number;
  revenueTrigger: number;
  revenuePerKeyPlayer: number;
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const gbp2 = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 });

type NumericField = Exclude<keyof RoadmapEntry, "id" | "year" | "office" | "month">;

const ROW_GROUPS: {
  section: string;
  rows: { field: NumericField; label: string; kind: "currency" | "currency2" | "hours" | "number" }[];
}[] = [
  {
    section: "Monthly Plan",
    rows: [
      { field: "projectedRevenue", label: "Projected Revenue", kind: "currency" },
      { field: "actualRevenue", label: "Actual Revenue", kind: "currency" },
      { field: "dayRateTarget", label: "Day Rate Target", kind: "currency2" },
      { field: "clientHoursTarget", label: "Client Hours (cum.)", kind: "hours" },
      { field: "careProHoursTarget", label: "Carepro Hours (cum.)", kind: "hours" },
    ],
  },
  {
    section: "Growth Drivers (required to hit the plan)",
    rows: [
      { field: "monthlyGrowthTarget", label: "Growth Target (£/month)", kind: "currency2" },
      { field: "enquiriesRequired", label: "New Care Enquiries Required", kind: "number" },
      { field: "clientsRequired", label: "New Clients Required", kind: "number" },
      { field: "careProApplicationsRequired", label: "Carepro Applications Required", kind: "number" },
      { field: "careProsRequiredHeads", label: "Carepros Required (Heads)", kind: "number" },
      { field: "newCareProHoursRequired", label: "New Carepro Hours Required", kind: "hours" },
      { field: "netCareProHoursRequired", label: "Net Carepro Hours Required", kind: "hours" },
    ],
  },
];

function emptyEntry(year: number, office: string, month: number): RoadmapEntry {
  return {
    id: `new-${office}-${month}`, year, office, month,
    projectedRevenue: 0, actualRevenue: null, dayRateTarget: 0,
    clientHoursTarget: 0, careProHoursTarget: 0, monthlyGrowthTarget: 0,
    enquiriesRequired: 0, clientsRequired: 0, careProApplicationsRequired: 0,
    careProsRequiredHeads: 0, newCareProHoursRequired: 0, netCareProHoursRequired: 0,
  };
}

function formatValue(kind: "currency" | "currency2" | "hours" | "number", value: number | null): string {
  if (value === null) return "—";
  if (kind === "currency") return gbp.format(value);
  if (kind === "currency2") return gbp2.format(value);
  if (kind === "hours") return value.toLocaleString("en-GB", { maximumFractionDigits: 1 });
  return value.toLocaleString("en-GB", { maximumFractionDigits: 1 });
}

export function AnnualRoadmapGrid() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [office, setOffice] = useState<string | null>(null);
  const [monthsByOffice, setMonthsByOffice] = useState<Record<number, RoadmapEntry>>({});
  const [assumptions, setAssumptions] = useState<RoadmapAssumption[]>([]);

  const officesQuery = useQuery<string[]>({
    queryKey: ["/api/annual-roadmap/offices"],
    queryFn: async () => {
      const res = await fetch(toAbsoluteUrl("/api/annual-roadmap/offices"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load office list");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });
  const offices = officesQuery.data ?? [];

  const yearsQuery = useQuery<number[]>({
    queryKey: ["/api/annual-roadmap/years"],
    queryFn: async () => {
      const res = await fetch(toAbsoluteUrl("/api/annual-roadmap/years"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load year list");
      return res.json();
    },
    staleTime: 60_000,
  });
  // Always offer the current year even if nothing has been saved for it yet.
  const years = useMemo(() => {
    const set = new Set([...(yearsQuery.data ?? []), currentYear]);
    return Array.from(set).sort((a, b) => b - a);
  }, [yearsQuery.data, currentYear]);

  useEffect(() => {
    if (!office && offices.length > 0) setOffice(offices[0]);
  }, [offices, office]);

  const yearDataQuery = useQuery<{ entries: RoadmapEntry[]; assumptions: RoadmapAssumption[] }>({
    queryKey: ["/api/annual-roadmap", year],
    queryFn: async () => {
      const res = await fetch(toAbsoluteUrl(`/api/annual-roadmap/${year}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load roadmap data");
      return res.json();
    },
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!yearDataQuery.data || !office) return;
    const byMonth: Record<number, RoadmapEntry> = {};
    for (let m = 1; m <= 12; m++) {
      const found = yearDataQuery.data.entries.find(e => e.office === office && e.month === m);
      byMonth[m] = found ?? emptyEntry(year, office, m);
    }
    setMonthsByOffice(byMonth);
    setAssumptions(yearDataQuery.data.assumptions);
  }, [yearDataQuery.data, office, year]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!office) throw new Error("No office selected");
      const months = Object.values(monthsByOffice)
        .sort((a, b) => a.month - b.month)
        .map(({ id, year: _y, office: _o, ...rest }) => rest);
      const res = await apiRequest("PUT", `/api/annual-roadmap/${year}/${encodeURIComponent(office)}`, { months });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Roadmap saved", description: `${office} — ${year} updated.` });
      queryClient.invalidateQueries({ queryKey: ["/api/annual-roadmap", year] });
      queryClient.invalidateQueries({ queryKey: ["/api/annual-roadmap/years"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save roadmap", description: error.message, variant: "destructive" });
    },
  });

  const saveAssumptionsMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        assumptions: assumptions.map(({ id, year: _y, ...rest }) => rest),
      };
      const res = await apiRequest("PUT", `/api/annual-roadmap/${year}/assumptions`, payload);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Assumptions saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/annual-roadmap", year] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save assumptions", description: error.message, variant: "destructive" });
    },
  });

  function updateCell(month: number, field: NumericField, raw: string) {
    setMonthsByOffice(prev => {
      const current = prev[month] ?? emptyEntry(year, office ?? "", month);
      const value = raw === "" ? null : Number(raw);
      return { ...prev, [month]: { ...current, [field]: value === null ? (field === "actualRevenue" ? null : 0) : (Number.isFinite(value) ? value : current[field]) } };
    });
  }

  function updateAssumption(id: string, field: keyof RoadmapAssumption, raw: string) {
    setAssumptions(prev => prev.map(a => a.id === id ? { ...a, [field]: raw === "" ? 0 : (Number(raw) || 0) } : a));
  }

  const isLoading = officesQuery.isLoading || yearDataQuery.isLoading;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Select value={office ?? undefined} onValueChange={setOffice}>
            <SelectTrigger className="w-[220px]" data-testid="select-roadmap-office">
              <SelectValue placeholder="Select a branch" />
            </SelectTrigger>
            <SelectContent>
              {offices.map(o => (
                <SelectItem key={o} value={o}>{o}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v, 10))}>
            <SelectTrigger className="w-[110px]" data-testid="select-roadmap-year">
              <SelectValue placeholder="Year" />
            </SelectTrigger>
            <SelectContent>
              {years.map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !office} data-testid="button-save-roadmap">
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save changes
        </Button>
      </div>

      {isLoading && (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Loading…</CardContent></Card>
      )}

      {!isLoading && office && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="border-collapse text-sm w-full" data-testid="table-annual-roadmap">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-background border-b-2 border-r px-3 py-2 text-left font-medium min-w-[220px]">
                      {office} — {year}
                    </th>
                    {MONTH_LABELS.map(m => (
                      <th key={m} className="border-b-2 border-r px-2 py-2 text-right font-medium whitespace-nowrap min-w-[100px]">
                        {m}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROW_GROUPS.map(group => (
                    <Fragment key={group.section}>
                      <tr className="bg-muted/50">
                        <td colSpan={13} className="sticky left-0 z-10 bg-muted/50 border-b px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {group.section}
                        </td>
                      </tr>
                      {group.rows.map(row => (
                        <tr key={row.field} className="hover:bg-muted/30 transition-colors">
                          <td className="sticky left-0 z-10 bg-background border-b border-r px-3 py-1.5 whitespace-nowrap">
                            {row.label}
                          </td>
                          {Array.from({ length: 12 }, (_, i) => i + 1).map(month => {
                            const entry = monthsByOffice[month] ?? emptyEntry(year, office, month);
                            const value = entry[row.field];
                            return (
                              <td key={month} className="border-b border-r p-0">
                                <Input
                                  type="number"
                                  className="h-8 border-none rounded-none text-right tabular-nums shadow-none focus-visible:ring-1 focus-visible:z-10 relative bg-transparent"
                                  value={value === null ? "" : (value as number)}
                                  onChange={e => updateCell(month, row.field, e.target.value)}
                                  data-testid={`input-roadmap-${row.field}-${month}`}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Key Player Hiring Assumptions ({year})</h3>
            <Button size="sm" variant="outline" onClick={() => saveAssumptionsMutation.mutate()} disabled={saveAssumptionsMutation.isPending} data-testid="button-save-assumptions">
              {saveAssumptionsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Group-wide thresholds — not per branch. Reused every year unless you change them here.</p>
          <div className="overflow-x-auto">
            <table className="border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border-b-2 border-r px-3 py-1.5 text-left font-medium">Key Player #</th>
                  <th className="border-b-2 border-r px-3 py-1.5 text-right font-medium">Revenue Trigger</th>
                  <th className="border-b-2 px-3 py-1.5 text-right font-medium">Revenue per Key Player</th>
                </tr>
              </thead>
              <tbody>
                {assumptions.map(a => (
                  <tr key={a.id}>
                    <td className="border-b border-r p-0">
                      <Input type="number" className="h-8 w-[100px] border-none rounded-none text-right tabular-nums shadow-none bg-transparent"
                        value={a.headcountThreshold} onChange={e => updateAssumption(a.id, "headcountThreshold", e.target.value)} data-testid={`input-assumption-headcount-${a.displayOrder}`} />
                    </td>
                    <td className="border-b border-r p-0">
                      <Input type="number" className="h-8 w-[140px] border-none rounded-none text-right tabular-nums shadow-none bg-transparent"
                        value={a.revenueTrigger} onChange={e => updateAssumption(a.id, "revenueTrigger", e.target.value)} data-testid={`input-assumption-trigger-${a.displayOrder}`} />
                    </td>
                    <td className="border-b p-0">
                      <Input type="number" className="h-8 w-[140px] border-none rounded-none text-right tabular-nums shadow-none bg-transparent"
                        value={a.revenuePerKeyPlayer} onChange={e => updateAssumption(a.id, "revenuePerKeyPlayer", e.target.value)} data-testid={`input-assumption-perplayer-${a.displayOrder}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
