import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, RefreshCw, Download, Search, ChevronLeft, ChevronRight, AlertCircle, ShieldCheck } from "lucide-react";
import { auditActionLabel, AUDIT_FIELD_LABELS, type AuditEvent, type AuditPage, type AuditValue } from "@shared/audit";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type Branch = { id: string; displayName: string };
const time = (timestamp: string) => new Date(timestamp).toLocaleString("en-GB", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  timeZone: "Europe/London", timeZoneName: "short",
});
const value = (v: AuditValue | undefined) => v == null ? "Not set" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);

function Snapshot({ title, data }: { title: string; data?: Record<string, AuditValue> | null }) {
  if (!data) return null;
  return <section className="min-w-0 rounded-lg border p-3">
    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">{title}</h4>
    <dl className="space-y-2 text-sm">
      {Object.entries(data).filter(([key]) => key !== "id").map(([key, val]) => <div key={key} className="flex flex-col sm:flex-row sm:justify-between gap-1">
        <dt className="text-muted-foreground">{AUDIT_FIELD_LABELS[key] ?? key}</dt>
        <dd className="break-words sm:text-right">{value(val)}</dd>
      </div>)}
    </dl>
  </section>;
}

export function AuditLogTab({ branches, active }: { branches: Branch[]; active: boolean }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [action, setAction] = useState("all");
  const [branch, setBranch] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const params = new URLSearchParams({ page: String(page), pageSize: "50" });
  if (debouncedSearch) params.set("search", debouncedSearch);
  if (action !== "all") params.set("action", action);
  if (branch !== "all") params.set("branchId", branch);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const url = `/api/admin/audit-events?${params}`;
  const { data, isLoading, isFetching, error, refetch } = useQuery<AuditPage>({
    queryKey: ["admin-audit-events", url], queryFn: async () => (await apiRequest("GET", url, undefined, { includeSelectedBranch: false })).json(),
    enabled: active, staleTime: 30_000,
  });
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 50));
  const branchName = (event: AuditEvent) => event.metadata?.branchName
    ?? branches.find(b => b.id === event.branchId)?.displayName
    ?? (event.branchId ? "Branch no longer available" : "Account / application-wide");
  const actorName = (event: AuditEvent) => event.metadata?.actorName ?? event.userEmail ?? "Actor not recorded";
  const clear = () => { setSearch(""); setDebouncedSearch(""); setAction("all"); setBranch("all"); setFrom(""); setTo(""); setPage(1); };
  const exportCsv = async () => {
    setExporting(true);
    try {
      const response = await apiRequest("GET", `/api/admin/audit-events/export?${params}`, undefined, { includeSelectedBranch: false });
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `care-capacity-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      void refetch();
    } catch (err) {
      toast({ title: "Export failed", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    } finally { setExporting(false); }
  };
  return <>
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-600" />Activity & audit log</CardTitle>
            <p className="text-xs text-muted-foreground mt-1.5">Who changed what, when and where. Times and date filters use Europe/London.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting || !!error || isLoading} className="gap-1.5">
              <Download className="h-3.5 w-3.5" />{exporting ? "Exporting…" : "Export CSV"}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          <div className="sm:col-span-2">
            <label htmlFor="audit-search" className="text-xs font-medium">Search events</label>
            <div className="relative mt-1"><Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
              <Input id="audit-search" className="pl-9" placeholder="Person, actor, branch, detail or reference…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <div><label className="text-xs font-medium" htmlFor="audit-action">Action</label>
            <Select value={action} onValueChange={v => { setAction(v); setPage(1); }}>
              <SelectTrigger id="audit-action" className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All actions</SelectItem>{(data?.actions ?? []).map(a =>
                <SelectItem key={a} value={a}>{auditActionLabel(a)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><label className="text-xs font-medium" htmlFor="audit-branch">Branch</label>
            <Select value={branch} onValueChange={v => { setBranch(v); setPage(1); }}>
              <SelectTrigger id="audit-branch" className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All branches</SelectItem>{branches.map(b =>
                <SelectItem key={b.id} value={b.id}>{b.displayName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><label htmlFor="audit-from" className="text-xs font-medium">From date</label>
            <Input id="audit-from" className="mt-1" type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} />
          </div>
          <div><label htmlFor="audit-to" className="text-xs font-medium">To date</label>
            <Input id="audit-to" className="mt-1" type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} />
          </div>
          <div className="flex items-end"><Button variant="ghost" size="sm" onClick={clear}>Clear filters</Button></div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="border-y bg-muted/30 px-5 py-2 text-xs text-muted-foreground flex flex-wrap justify-between gap-2">
          <span>{total.toLocaleString()} matching events</span><span>Read-only history · older entries may have less detail</span>
        </div>
        {error ? <div role="alert" className="p-6 text-sm text-destructive flex items-center gap-2"><AlertCircle className="h-4 w-4" />
          Could not load events. Check your filters, then refresh.</div>
          : isLoading ? <div role="status" className="p-10 text-center text-sm text-muted-foreground">Loading audit history…</div>
          : !data?.events.length ? <div className="text-center py-16 text-muted-foreground">
            <ClipboardList className="h-9 w-9 mx-auto mb-3 opacity-40" /><p>No events match these filters.</p>
          </div> : <div className="divide-y">
            {data.events.map(event => <article key={event.id} className="px-5 py-4 flex items-start gap-3 hover:bg-muted/20">
              <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${event.metadata?.outcome === "failure" ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600 dark:bg-blue-950"}`}>
                <ClipboardList className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 className="text-sm font-semibold">{auditActionLabel(event.action)}</h3>
                  {event.metadata?.outcome === "failure" && <Badge variant="destructive" className="text-[10px]">Failed</Badge>}
                  {event.metadata?.operation === "delete" && <Badge variant="outline" className="text-[10px] text-red-700">Permanent deletion</Badge>}
                </div>
                <p className="text-sm mt-1 break-words">{event.detail ?? "No description was recorded."}</p>
                <p className="text-xs text-muted-foreground mt-2 break-words">By {actorName(event)}
                  {event.userEmail && event.userEmail !== actorName(event) ? ` (${event.userEmail})` : ""} · {branchName(event)}</p>
                <time dateTime={event.timestamp} className="text-xs text-muted-foreground block mt-1">{time(event.timestamp)}</time>
              </div>
              <Button variant="ghost" size="sm" className="shrink-0 text-xs" onClick={() => setSelected(event)}
                aria-label={`View audit details for ${event.metadata?.entityName ?? auditActionLabel(event.action)}`}>Details</Button>
            </article>)}
          </div>}
        <div className="border-t px-5 py-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>Page {page} of {pages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || isFetching} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" />Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= pages || isFetching} onClick={() => setPage(p => p + 1)}>Next<ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      </CardContent>
    </Card>
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{selected ? auditActionLabel(selected.action) : "Audit details"}</DialogTitle>
          <DialogDescription>Full event details and the information retained at the time of the action.</DialogDescription></DialogHeader>
        {selected && <div className="space-y-5">
          <p className="text-sm font-medium break-words">{selected.detail}</p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-muted-foreground">Who</dt><dd className="break-words">{actorName(selected)}{selected.userEmail !== actorName(selected) && <span className="block text-xs">{selected.userEmail}</span>}</dd></div>
            <div><dt className="text-xs text-muted-foreground">When</dt><dd>{time(selected.timestamp)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Branch</dt><dd>{branchName(selected)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Subject</dt><dd>{selected.metadata?.entityName ?? "Not recorded for this event"}</dd></div>
          </dl>
          {!selected.metadata && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Legacy event: names, before/after values or request context may not have been captured. The original entry has been preserved; missing information has not been invented.</p>}
          {selected.metadata?.scope === "request" && <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">Request-level event: records the endpoint, actor and result. Field-by-field before/after values were not captured for this action.</p>}
          {!!selected.metadata?.changes?.length && <section>
            <h4 className="text-sm font-semibold mb-2">What changed</h4>
            <div className="rounded-lg border divide-y">
              {selected.metadata.changes.map(change => <div key={change.field} className="p-3 text-sm">
                <p className="font-medium">{change.label}</p>
                {change.redacted ? <p className="text-xs text-muted-foreground mt-1">Value changed. Sensitive or free-text content is not retained in the audit log.</p>
                  : <p className="mt-1 break-words"><span className="text-muted-foreground">{value(change.before)}</span> → {value(change.after)}</p>}
              </div>)}
            </div>
          </section>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><Snapshot title="Before" data={selected.metadata?.before} /><Snapshot title="After" data={selected.metadata?.after} /></div>
          <section className="rounded-lg bg-muted/40 p-3 text-xs space-y-2 break-all">
            <p><strong>Event reference:</strong> {selected.id}</p>
            {selected.metadata?.entityId && <p><strong>Record reference:</strong> {selected.metadata.entityId}</p>}
            {selected.userId && <p><strong>Actor reference:</strong> {selected.userId}</p>}
            {selected.metadata?.request && <>
              <p><strong>Request reference:</strong> {selected.metadata.request.id}</p>
              <p><strong>Request:</strong> {selected.metadata.request.method} {selected.metadata.request.path}</p>
              <p><strong>IP address:</strong> {selected.metadata.request.ip ?? "Not captured"}</p>
              {selected.metadata.request.statusCode && <p><strong>HTTP result:</strong> {selected.metadata.request.statusCode}</p>}
            </>}
            <p><strong>Timestamp (UTC):</strong> {selected.timestamp}</p>
          </section>
        </div>}
      </DialogContent>
    </Dialog>
  </>;
}
