import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, toAbsoluteUrl } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  TrendingDown, TrendingUp, Minus, Users, AlertTriangle,
  Plus, Pencil, Trash2, ChevronDown, ChevronUp, Info,
} from "lucide-react";
import type { OutlookResponse, OutlookDetail, Leaver, Joiner } from "@shared/schema";
import { joinerStages } from "@shared/schema";

// ── Types ────────────────────────────────────────────────────────────────────


// ── Confidence weight helper (mirrors server) ─────────────────────────────────

function getConfidenceWeight(stage: string): number {
  switch (stage) {
    case 'Confirmed start': case 'Started': return 0.75;
    case 'Training booked': return 0.70;
    case 'Pre-employment checks': case 'Offer': return 0.60;
    case 'Interview': case 'Pipeline': return 0.50;
    case 'Dropped': return 0;
    default: return 0.50;
  }
}

// ── RAG helpers ───────────────────────────────────────────────────────────────

function RagBadge({ rag }: { rag: string }) {
  if (rag === 'green') return (
    <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700">
      ● Low Risk
    </Badge>
  );
  if (rag === 'amber') return (
    <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-700">
      ● Medium Risk
    </Badge>
  );
  return (
    <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-700">
      ● High Risk
    </Badge>
  );
}

function ragBgClass(rag: string): string {
  if (rag === 'green') return 'from-emerald-500 to-emerald-600';
  if (rag === 'amber') return 'from-amber-500 to-amber-600';
  return 'from-red-500 to-red-600';
}

// ── Leaver form ───────────────────────────────────────────────────────────────

const leaverFormSchema = z.object({
  employeeName: z.string().min(1, "Name is required"),
  employmentType: z.enum(["driver", "walker"], { required_error: "Type is required" }),
  weeklyHours: z.coerce.number().positive("Must be > 0"),
  firstDayOfNotice: z.string().optional(),
  lastWorkingDay: z.string().min(1, "Last working day is required"),
  notes: z.string().optional(),
});

type LeaverFormData = z.infer<typeof leaverFormSchema>;

// ── Joiner form ───────────────────────────────────────────────────────────────

const joinerFormSchema = z.object({
  candidateName: z.string().min(1, "Name is required"),
  employmentType: z.enum(["driver", "walker"], { required_error: "Type is required" }),
  desiredWeeklyHours: z.coerce.number().positive("Must be > 0"),
  trainingDate: z.string().optional(),
  expectedStartDate: z.string().min(1, "Start date is required"),
  stage: z.enum(joinerStages, { required_error: "Stage is required" }),
  notes: z.string().optional(),
});

type JoinerFormData = z.infer<typeof joinerFormSchema>;

// ── LeaverModal ───────────────────────────────────────────────────────────────

function LeaverModal({
  open,
  onClose,
  editing,
  branchId,
}: {
  open: boolean;
  onClose: () => void;
  editing: Leaver | null;
  branchId: string;
}) {
  const { toast } = useToast();
  const form = useForm<LeaverFormData>({
    resolver: zodResolver(leaverFormSchema),
    defaultValues: {
      employeeName: "",
      weeklyHours: 0,
      firstDayOfNotice: "",
      lastWorkingDay: "",

      notes: "",
    },
  });

  // Reliably pre-fill the form whenever editing changes or the modal opens
  useEffect(() => {
    if (open) {
      if (editing) {
        form.reset({
          employeeName: editing.employeeName,
          employmentType: editing.employmentType as "driver" | "walker",
          weeklyHours: editing.weeklyHours ?? 0,
          firstDayOfNotice: editing.firstDayOfNotice ?? "",
          lastWorkingDay: editing.lastWorkingDay,
          notes: editing.notes ?? "",
        });
      } else {
        form.reset({
          employeeName: "",
          weeklyHours: 0,
          firstDayOfNotice: "",
          lastWorkingDay: "",
    
          notes: "",
        });
      }
    }
  }, [open, editing?.id]);

  const mutation = useMutation({
    mutationFn: async (data: LeaverFormData) => {
      const url = editing
        ? toAbsoluteUrl(`/api/capacity-outlook/leavers/${editing.id}?branchId=${branchId}`)
        : toAbsoluteUrl(`/api/capacity-outlook/leavers?branchId=${branchId}`);
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to save');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook'] });
      queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook/leavers'] });
      toast({ title: editing ? "Leaver updated" : "Leaver added", description: "Capacity outlook updated." });
      onClose();
      form.reset();
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Error", description: err.message });
    },
  });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { onClose(); form.reset(); } }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center">
              <TrendingDown className="w-4 h-4 text-white" />
            </div>
            {editing ? "Edit Leaver" : "Add Leaver"}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(d => mutation.mutate(d))} className="space-y-4">
            <FormField control={form.control} name="employeeName" render={({ field }) => (
              <FormItem>
                <FormLabel>Employee Name <span className="text-red-500">*</span></FormLabel>
                <FormControl><Input placeholder="Full name" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="employmentType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type <span className="text-red-500">*</span></FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="driver">Driver</SelectItem>
                      <SelectItem value="walker">Walker</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="weeklyHours" render={({ field }) => (
                <FormItem>
                  <FormLabel>Weekly Hours <span className="text-red-500">*</span></FormLabel>
                  <FormControl><Input type="number" step="0.5" placeholder="e.g. 37.5" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="firstDayOfNotice" render={({ field }) => (
              <FormItem>
                <FormLabel>First Day of Notice</FormLabel>
                <FormControl><Input type="date" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="lastWorkingDay" render={({ field }) => (
                <FormItem>
                  <FormLabel>Last Working Day <span className="text-red-500">*</span></FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

            </div>

            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl><Textarea placeholder="Optional notes…" rows={2} {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { onClose(); form.reset(); }}>Cancel</Button>
              <Button type="submit" disabled={mutation.isPending} className="bg-red-600 hover:bg-red-700 text-white">
                {mutation.isPending ? "Saving…" : editing ? "Update" : "Add Leaver"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ── JoinerModal ───────────────────────────────────────────────────────────────

function JoinerModal({
  open,
  onClose,
  editing,
  branchId,
}: {
  open: boolean;
  onClose: () => void;
  editing: Joiner | null;
  branchId: string;
}) {
  const { toast } = useToast();
  const form = useForm<JoinerFormData>({
    resolver: zodResolver(joinerFormSchema),
    defaultValues: {
      candidateName: "",
      desiredWeeklyHours: 0,
      trainingDate: "",
      expectedStartDate: "",
      stage: undefined,
      notes: "",
    },
  });

  // Reliably pre-fill the form whenever editing changes or the modal opens
  useEffect(() => {
    if (open) {
      if (editing) {
        form.reset({
          candidateName: editing.candidateName,
          employmentType: editing.employmentType as "driver" | "walker",
          desiredWeeklyHours: editing.desiredWeeklyHours ?? 0,
          trainingDate: editing.trainingDate ?? "",
          expectedStartDate: editing.expectedStartDate,
          stage: editing.stage as any,
          notes: editing.notes ?? "",
        });
      } else {
        form.reset({
          candidateName: "",
          desiredWeeklyHours: 0,
          trainingDate: "",
          expectedStartDate: "",
          stage: undefined,
          notes: "",
        });
      }
    }
  }, [open, editing?.id]);

  const watchStage = form.watch("stage");
  const confidenceWeight = watchStage ? getConfidenceWeight(watchStage) : null;

  const mutation = useMutation({
    mutationFn: async (data: JoinerFormData) => {
      const url = editing
        ? toAbsoluteUrl(`/api/capacity-outlook/joiners/${editing.id}?branchId=${branchId}`)
        : toAbsoluteUrl(`/api/capacity-outlook/joiners?branchId=${branchId}`);
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to save');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook'] });
      queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook/joiners'] });
      toast({ title: editing ? "Joiner updated" : "Joiner added", description: "Capacity outlook updated." });
      onClose();
      form.reset();
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Error", description: err.message });
    },
  });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { onClose(); form.reset(); } }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-white" />
            </div>
            {editing ? "Edit Joiner" : "Add Joiner"}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(d => mutation.mutate(d))} className="space-y-4">
            <FormField control={form.control} name="candidateName" render={({ field }) => (
              <FormItem>
                <FormLabel>Candidate Name <span className="text-red-500">*</span></FormLabel>
                <FormControl><Input placeholder="Full name" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="employmentType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type <span className="text-red-500">*</span></FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="driver">Driver</SelectItem>
                      <SelectItem value="walker">Walker</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="desiredWeeklyHours" render={({ field }) => (
                <FormItem>
                  <FormLabel>Desired Weekly Hours <span className="text-red-500">*</span></FormLabel>
                  <FormControl><Input type="number" step="0.5" placeholder="e.g. 35" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="stage" render={({ field }) => (
              <FormItem>
                <FormLabel>Stage <span className="text-red-500">*</span></FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select recruitment stage…" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {joinerStages.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
                {confidenceWeight !== null && (
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-xs">
                      Confidence: {Math.round(confidenceWeight * 100)}%
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      Hours counted at {Math.round(confidenceWeight * 100)}% weighted certainty
                    </span>
                  </div>
                )}
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="trainingDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Training Date</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="expectedStartDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Expected Start Date <span className="text-red-500">*</span></FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl><Textarea placeholder="Optional notes…" rows={2} {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { onClose(); form.reset(); }}>Cancel</Button>
              <Button type="submit" disabled={mutation.isPending} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {mutation.isPending ? "Saving…" : editing ? "Update" : "Add Joiner"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CapacityOutlookPage() {
  const { selectedBranchId } = useBranch();
  const { user } = useAuth();
  const { toast } = useToast();

  const isScheduler = user?.role === 'scheduler' || user?.role === 'admin';

  const [horizonWeeks] = useState(4);
  const [selectedWeekStart, setSelectedWeekStart] = useState<string | null>(null);
  const [leaverModalOpen, setLeaverModalOpen] = useState(false);
  const [joinerModalOpen, setJoinerModalOpen] = useState(false);
  const [editingLeaver, setEditingLeaver] = useState<Leaver | null>(null);
  const [editingJoiner, setEditingJoiner] = useState<Joiner | null>(null);
  const [deletingLeaverId, setDeletingLeaverId] = useState<string | null>(null);
  const [deletingJoinerId, setDeletingJoinerId] = useState<string | null>(null);
  const [leaversOpen, setLeaversOpen] = useState(true);
  const [joinersOpen, setJoinersOpen] = useState(true);

  type LeaverSortCol = 'employeeName' | 'employmentType' | 'weeklyHours' | 'lastWorkingDay';
  type JoinerSortCol = 'candidateName' | 'employmentType' | 'desiredWeeklyHours' | 'stage' | 'confidenceWeight' | 'trainingDate' | 'expectedStartDate';
  type SortDir = 'asc' | 'desc';

  const [leaverSort, setLeaverSort] = useState<{ col: LeaverSortCol; dir: SortDir }>({ col: 'lastWorkingDay', dir: 'asc' });
  const [joinerSort, setJoinerSort] = useState<{ col: JoinerSortCol; dir: SortDir }>({ col: 'expectedStartDate', dir: 'asc' });

  const branchId = selectedBranchId ?? '';

  // Outlook aggregates
  const outlookQuery = useQuery<OutlookResponse>({
    queryKey: ['/api/capacity-outlook', branchId, horizonWeeks],
    queryFn: async () => {
      const res = await fetch(
        toAbsoluteUrl(`/api/capacity-outlook?branchId=${branchId}&weeks=${horizonWeeks}&segment=all`),
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to load outlook');
      return res.json();
    },
    enabled: !!branchId,
    staleTime: 30_000,
  });

  // Leavers list
  const leaversQuery = useQuery<Leaver[]>({
    queryKey: ['/api/capacity-outlook/leavers', branchId],
    queryFn: async () => {
      const res = await fetch(
        toAbsoluteUrl(`/api/capacity-outlook/leavers?branchId=${branchId}`),
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to load leavers');
      return res.json();
    },
    enabled: !!branchId,
    staleTime: 30_000,
  });

  // Joiners list
  const joinersQuery = useQuery<Joiner[]>({
    queryKey: ['/api/capacity-outlook/joiners', branchId],
    queryFn: async () => {
      const res = await fetch(
        toAbsoluteUrl(`/api/capacity-outlook/joiners?branchId=${branchId}`),
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to load joiners');
      return res.json();
    },
    enabled: !!branchId,
    staleTime: 30_000,
  });

  // Drill-down detail
  const detailQuery = useQuery<OutlookDetail>({
    queryKey: ['/api/capacity-outlook/detail', branchId, selectedWeekStart],
    queryFn: async () => {
      const res = await fetch(
        toAbsoluteUrl(`/api/capacity-outlook/detail?branchId=${branchId}&weekStart=${selectedWeekStart}`),
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to load detail');
      return res.json();
    },
    enabled: !!branchId && !!selectedWeekStart,
    staleTime: 30_000,
  });

  // Delete mutations
  const deleteLeaverMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        toAbsoluteUrl(`/api/capacity-outlook/leavers/${id}?branchId=${branchId}`),
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to delete');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook'] });
      queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook/leavers'] });
      setDeletingLeaverId(null);
      toast({ title: "Leaver removed" });
    },
    onError: () => toast({ variant: "destructive", title: "Error", description: "Failed to remove leaver" }),
  });

  const deleteJoinerMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        toAbsoluteUrl(`/api/capacity-outlook/joiners/${id}?branchId=${branchId}`),
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to delete');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook'] });
      queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook/joiners'] });
      setDeletingJoinerId(null);
      toast({ title: "Joiner removed" });
    },
    onError: () => toast({ variant: "destructive", title: "Error", description: "Failed to remove joiner" }),
  });

  const outlook = outlookQuery.data;
  const totals = outlook?.totals;

  // Chart data
  const chartData = useMemo(() => {
    if (!outlook?.weeks) return [];
    return outlook.weeks.map(w => ({
      week: w.label,
      weekStart: w.weekStart,
      lost: w.hoursLost,
      gained: w.hoursGained,
      net: w.netChange,
      rag: w.rag,
    }));
  }, [outlook]);

  const formatDate = (d: string | null | undefined) => {
    if (!d) return '—';
    try {
      return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    } catch { return d; }
  };

  function sortBy<T>(arr: T[], col: keyof T, dir: 'asc' | 'desc'): T[] {
    return [...arr].sort((a, b) => {
      const av = a[col] ?? '';
      const bv = b[col] ?? '';
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return dir === 'asc' ? cmp : -cmp;
    });
  }

  const sortedLeavers = useMemo(
    () => sortBy(leaversQuery.data ?? [], leaverSort.col, leaverSort.dir),
    [leaversQuery.data, leaverSort.col, leaverSort.dir],
  );

  const sortedJoiners = useMemo(
    () => sortBy(joinersQuery.data ?? [], joinerSort.col, joinerSort.dir),
    [joinersQuery.data, joinerSort.col, joinerSort.dir],
  );

  function SortHead<C extends string>({
    col, label, current, onSort,
  }: { col: C; label: string; current: { col: C; dir: SortDir }; onSort: (c: C) => void }) {
    const active = current.col === col;
    return (
      <TableHead
        className="cursor-pointer select-none hover:bg-muted/40 transition-colors"
        onClick={() => onSort(col)}
      >
        <span className="flex items-center gap-1">
          {label}
          <span className="text-muted-foreground text-[10px]">
            {active ? (current.dir === 'asc' ? '▲' : '▼') : '⇅'}
          </span>
        </span>
      </TableHead>
    );
  }

  function toggleLeaverSort(col: LeaverSortCol) {
    setLeaverSort(prev => ({ col, dir: prev.col === col && prev.dir === 'asc' ? 'desc' : 'asc' }));
  }

  function toggleJoinerSort(col: JoinerSortCol) {
    setJoinerSort(prev => ({ col, dir: prev.col === col && prev.dir === 'asc' ? 'desc' : 'asc' }));
  }

  if (!branchId) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted-foreground">Select a branch to view capacity outlook.</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-background flex flex-col overflow-hidden">
      {/* Page header */}
      <div className="bg-gradient-to-br from-primary/5 via-secondary/5 to-tertiary/5 border-b border-card-border shrink-0 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-emerald-600 bg-clip-text text-transparent">
              Capacity Outlook
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Rolling {horizonWeeks}-week forecast — leavers vs pipeline joiners
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isScheduler && (
              <>
                <Button
                  onClick={() => { setEditingLeaver(null); setLeaverModalOpen(true); }}
                  size="sm"
                  className="bg-red-600 hover:bg-red-700 text-white gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Leaver
                </Button>
                <Button
                  onClick={() => { setEditingJoiner(null); setJoinerModalOpen(true); }}
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Joiner
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {/* Hours Lost */}
          <Card className="glass hover-lift animate-scale-in">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center">
                  <TrendingDown className="w-3.5 h-3.5 text-white" />
                </div>
                Hours Lost
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {outlookQuery.isLoading ? (
                <div className="h-8 bg-muted animate-pulse rounded" />
              ) : (
                <>
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                    {totals?.hoursLost ?? 0}h
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">over {horizonWeeks} weeks</div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Hours Gained */}
          <Card className="glass hover-lift animate-scale-in">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
                  <TrendingUp className="w-3.5 h-3.5 text-white" />
                </div>
                Hours Gained
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {outlookQuery.isLoading ? (
                <div className="h-8 bg-muted animate-pulse rounded" />
              ) : (
                <>
                  <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                    {totals?.hoursGained ?? 0}h
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">weighted pipeline</div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Net Change */}
          <Card className="glass hover-lift animate-scale-in">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                  <Minus className="w-3.5 h-3.5 text-white" />
                </div>
                Net Change
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {outlookQuery.isLoading ? (
                <div className="h-8 bg-muted animate-pulse rounded" />
              ) : (
                <>
                  <div className={[
                    "text-2xl font-bold",
                    (totals?.netChange ?? 0) >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400",
                  ].join(' ')}>
                    {(totals?.netChange ?? 0) >= 0 ? '+' : ''}{totals?.netChange ?? 0}h
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">gained minus lost</div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Coverage */}
          <Card className="glass hover-lift animate-scale-in">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center">
                  <Users className="w-3.5 h-3.5 text-white" />
                </div>
                Coverage
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {outlookQuery.isLoading ? (
                <div className="h-8 bg-muted animate-pulse rounded" />
              ) : (
                <>
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">
                    {totals?.hoursLost === 0 ? '—' : `${Math.round((totals?.coverage ?? 0) * 100)}%`}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">pipeline vs losses</div>
                </>
              )}
            </CardContent>
          </Card>

          {/* RAG */}
          <Card className="glass hover-lift animate-scale-in">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <div className={`w-6 h-6 rounded-md bg-gradient-to-br ${ragBgClass(totals?.rag ?? 'green')} flex items-center justify-center`}>
                  <AlertTriangle className="w-3.5 h-3.5 text-white" />
                </div>
                Risk
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {outlookQuery.isLoading ? (
                <div className="h-8 bg-muted animate-pulse rounded" />
              ) : (
                <div className="mt-1">
                  <RagBadge rag={totals?.rag ?? 'green'} />
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Bar chart */}
        <Card className="glass">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              Lost vs Gained by Week
              <span className="text-xs font-normal text-muted-foreground">(click a bar to see who's affected)</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {outlookQuery.isLoading ? (
              <div className="h-48 bg-muted animate-pulse rounded" />
            ) : chartData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                No data for this period
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                  <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="h" />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      `${value}h`,
                      name === 'lost' ? 'Hours Lost' : name === 'gained' ? 'Hours Gained (weighted)' : 'Net',
                    ]}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
                  />
                  <Legend
                    formatter={v => v === 'lost' ? 'Hours Lost' : v === 'gained' ? 'Hours Gained (weighted)' : 'Net'}
                    wrapperStyle={{ fontSize: 12 }}
                  />
                  <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="4 4" />
                  <Bar
                    dataKey="lost"
                    fill="#ef4444"
                    radius={[3, 3, 0, 0]}
                    cursor="pointer"
                    onClick={(d) => setSelectedWeekStart(d.weekStart)}
                  >
                    {chartData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={selectedWeekStart === entry.weekStart ? "#b91c1c" : "#ef4444"}
                      />
                    ))}
                  </Bar>
                  <Bar
                    dataKey="gained"
                    fill="#10b981"
                    radius={[3, 3, 0, 0]}
                    cursor="pointer"
                    onClick={(d) => setSelectedWeekStart(d.weekStart)}
                  >
                    {chartData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={selectedWeekStart === entry.weekStart ? "#047857" : "#10b981"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}

            {/* Week RAG row */}
            {!outlookQuery.isLoading && outlook?.weeks && (
              <div className="flex gap-2 mt-3">
                {outlook.weeks.map(w => (
                  <button
                    key={w.weekStart}
                    onClick={() => setSelectedWeekStart(prev => prev === w.weekStart ? null : w.weekStart)}
                    className={[
                      "flex-1 py-1.5 rounded-md text-xs font-medium border transition-all",
                      selectedWeekStart === w.weekStart
                        ? "border-primary bg-primary/10"
                        : "border-transparent bg-muted hover:bg-muted/80",
                    ].join(' ')}
                  >
                    <span className="block">{w.label}</span>
                    <RagBadge rag={w.rag} />
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Disclaimer */}
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-300">
          <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            <strong>Forecast is indicative; pipeline is weighted for uncertainty.</strong>
            {' '}Last computed: {outlook ? new Date(outlook.computedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '…'}
          </span>
        </div>

        {/* Active Leavers table */}
        <Card className="glass">
          <button
            className="w-full text-left cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg"
            onClick={() => setLeaversOpen(v => !v)}
          >
            <div className="px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center">
                  <TrendingDown className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="text-sm font-semibold">Active Leavers</span>
                {leaversQuery.data && (
                  <Badge variant="secondary">{leaversQuery.data.length}</Badge>
                )}
              </div>
              {leaversOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </div>
          </button>
          {leaversOpen && (
            <CardContent className="pt-0">
              {leaversQuery.isLoading ? (
                <div className="h-16 bg-muted animate-pulse rounded" />
              ) : !leaversQuery.data?.length ? (
                <p className="text-sm text-muted-foreground text-center py-4">No active leavers recorded.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortHead col="employeeName" label="Name" current={leaverSort} onSort={toggleLeaverSort} />
                      <SortHead col="employmentType" label="Type" current={leaverSort} onSort={toggleLeaverSort} />
                      <SortHead col="weeklyHours" label="Hours/wk" current={leaverSort} onSort={toggleLeaverSort} />
                      <SortHead col="lastWorkingDay" label="Last Working Day" current={leaverSort} onSort={toggleLeaverSort} />
                      {isScheduler && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedLeavers.map(l => (
                      <TableRow key={l.id}>
                        <TableCell className="font-medium">{l.employeeName}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize text-xs">{l.employmentType}</Badge>
                        </TableCell>
                        <TableCell>{l.weeklyHours}h</TableCell>
                        <TableCell>{formatDate(l.lastWorkingDay)}</TableCell>
                        {isScheduler && (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={() => { setEditingLeaver(l); setLeaverModalOpen(true); }}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-red-500 hover:text-red-700"
                                onClick={() => setDeletingLeaverId(l.id)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          )}
        </Card>

        {/* Active Pipeline table */}
        <Card className="glass">
          <button
            className="w-full text-left cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg"
            onClick={() => setJoinersOpen(v => !v)}
          >
            <div className="px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
                  <TrendingUp className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="text-sm font-semibold">Active Pipeline</span>
                {joinersQuery.data && (
                  <Badge variant="secondary">{joinersQuery.data.length}</Badge>
                )}
              </div>
              {joinersOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </div>
          </button>
          {joinersOpen && (
            <CardContent className="pt-0">
              {joinersQuery.isLoading ? (
                <div className="h-16 bg-muted animate-pulse rounded" />
              ) : !joinersQuery.data?.length ? (
                <p className="text-sm text-muted-foreground text-center py-4">No active joiners in pipeline.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortHead col="candidateName" label="Name" current={joinerSort} onSort={toggleJoinerSort} />
                      <SortHead col="employmentType" label="Type" current={joinerSort} onSort={toggleJoinerSort} />
                      <SortHead col="desiredWeeklyHours" label="Hours/wk" current={joinerSort} onSort={toggleJoinerSort} />
                      <SortHead col="stage" label="Stage" current={joinerSort} onSort={toggleJoinerSort} />
                      <SortHead col="confidenceWeight" label="Confidence" current={joinerSort} onSort={toggleJoinerSort} />
                      <SortHead col="trainingDate" label="Training Date" current={joinerSort} onSort={toggleJoinerSort} />
                      <SortHead col="expectedStartDate" label="Expected Start" current={joinerSort} onSort={toggleJoinerSort} />
                      {isScheduler && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedJoiners.map(j => (
                      <TableRow key={j.id}>
                        <TableCell className="font-medium">{j.candidateName}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize text-xs">{j.employmentType}</Badge>
                        </TableCell>
                        <TableCell>{j.desiredWeeklyHours}h</TableCell>
                        <TableCell>
                          <Badge
                            className={[
                              "text-xs",
                              j.stage === 'Confirmed start' || j.stage === 'Started'
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                                : j.stage === 'Training booked'
                                ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                                : j.stage === 'Dropped'
                                ? "bg-gray-100 text-gray-600"
                                : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
                            ].join(' ')}
                          >
                            {j.stage}
                          </Badge>
                        </TableCell>
                        <TableCell>{Math.round((j.confidenceWeight ?? 0) * 100)}%</TableCell>
                        <TableCell>{formatDate(j.trainingDate)}</TableCell>
                        <TableCell>{formatDate(j.expectedStartDate)}</TableCell>
                        {isScheduler && (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={() => { setEditingJoiner(j); setJoinerModalOpen(true); }}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-red-500 hover:text-red-700"
                                onClick={() => setDeletingJoinerId(j.id)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          )}
        </Card>

      </div>

      {/* Drill-down Sheet */}
      <Sheet open={!!selectedWeekStart} onOpenChange={v => { if (!v) setSelectedWeekStart(null); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              Week of {selectedWeekStart ? formatDate(selectedWeekStart) : ''}
            </SheetTitle>
            <SheetDescription>
              People affecting capacity in this week
            </SheetDescription>
          </SheetHeader>

          {detailQuery.isLoading ? (
            <div className="mt-6 space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}
            </div>
          ) : (
            <div className="mt-6 space-y-6">
              {/* Leavers in this week */}
              <div>
                <h3 className="font-semibold text-sm text-red-600 dark:text-red-400 mb-2 flex items-center gap-1.5">
                  <TrendingDown className="w-4 h-4" />
                  Leavers
                  {detailQuery.data?.leavers.length === 0 && (
                    <span className="text-muted-foreground font-normal">— none affecting this week</span>
                  )}
                </h3>
                {detailQuery.data?.leavers.map(l => (
                  <div key={l.id} className="p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10 mb-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{l.employeeName}</span>
                      <Badge variant="outline" className="capitalize text-xs">{l.employmentType}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 grid grid-cols-2 gap-1">
                      <span>Weekly hours: <strong>{l.weeklyHours}h</strong></span>
                      <span>Last day: <strong>{formatDate(l.lastWorkingDay)}</strong></span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Joiners in this week */}
              <div>
                <h3 className="font-semibold text-sm text-emerald-600 dark:text-emerald-400 mb-2 flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4" />
                  Pipeline joiners
                  {detailQuery.data?.joiners.length === 0 && (
                    <span className="text-muted-foreground font-normal">— none starting this week</span>
                  )}
                </h3>
                {detailQuery.data?.joiners.map(j => (
                  <div key={j.id} className="p-3 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10 mb-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{j.candidateName}</span>
                      <Badge variant="outline" className="capitalize text-xs">{j.employmentType}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 grid grid-cols-2 gap-1">
                      <span>Desired hours: <strong>{j.desiredWeeklyHours}h</strong></span>
                      <span>Expected start: <strong>{formatDate(j.expectedStartDate)}</strong></span>
                      <span>Stage: <strong>{j.stage}</strong></span>
                      <span>Confidence: <strong>{Math.round((j.confidenceWeight ?? 0) * 100)}%</strong></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Leaver modal */}
      {branchId && (
        <LeaverModal
          open={leaverModalOpen}
          onClose={() => { setLeaverModalOpen(false); setEditingLeaver(null); }}
          editing={editingLeaver}
          branchId={branchId}
        />
      )}

      {/* Joiner modal */}
      {branchId && (
        <JoinerModal
          open={joinerModalOpen}
          onClose={() => { setJoinerModalOpen(false); setEditingJoiner(null); }}
          editing={editingJoiner}
          branchId={branchId}
        />
      )}

      {/* Delete leaver confirm */}
      <AlertDialog open={!!deletingLeaverId} onOpenChange={v => { if (!v) setDeletingLeaverId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove leaver?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the leaver record from the capacity outlook. The action can be undone by re-adding them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingLeaverId && deleteLeaverMutation.mutate(deletingLeaverId)}
              className="bg-red-600 hover:bg-red-700"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete joiner confirm */}
      <AlertDialog open={!!deletingJoinerId} onOpenChange={v => { if (!v) setDeletingJoinerId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove joiner?</AlertDialogTitle>
            <AlertDialogDescription>
              This will drop the joiner from the pipeline. The outlook will update immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingJoinerId && deleteJoinerMutation.mutate(deletingJoinerId)}
              className="bg-red-600 hover:bg-red-700"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
