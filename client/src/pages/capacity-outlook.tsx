import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, toAbsoluteUrl } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
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
    case 'Onboarding':
    case 'Training Attended': return 0.33;
    case 'PVG':
    case 'REF1':
    case 'REF2': return 0.11;
    case 'Dropped': return 0;
    default: return 0.33;
  }
}

function daysSince(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00Z').getTime();
  return Math.floor((Date.now() - d) / 86400000);
}

function isStale14Days(j: { stage: string; trainingDate?: string | null }): boolean {
  return j.stage === 'Training Attended' && !!j.trainingDate && daysSince(j.trainingDate) >= 14;
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
  gender: z.enum(["male", "female", "other"]).optional(),
  employmentType: z.enum(["driver", "walker"], { required_error: "Type is required" }),
  weeklyHours: z.coerce.number().positive("Must be greater than 0"),
  postcode: z.string().optional(),
  lastWorkingDay: z.string().min(1, "Termination day is required"),
  notes: z.string().optional(),
});

type LeaverFormData = z.infer<typeof leaverFormSchema>;

// ── Joiner form ───────────────────────────────────────────────────────────────

const joinerFormSchema = z.object({
  candidateName: z.string().min(1, "Name is required"),
  gender: z.enum(["male", "female", "other"]).optional(),
  employmentType: z.enum(["driver", "walker"], { required_error: "Type is required" }),
  desiredWeeklyHours: z.coerce.number().positive("Must be > 0"),
  contractedHours: z.coerce.number().nonnegative().optional().or(z.literal("")),
  postcode: z.string().optional(),
  trainingDate: z.string().optional(),
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
      gender: undefined,
      weeklyHours: undefined as any,
      postcode: "",
      lastWorkingDay: "",
      notes: "",
    },
  });

  useEffect(() => {
    if (open) {
      if (editing) {
        form.reset({
          employeeName: editing.employeeName,
          gender: (editing.gender as "male" | "female" | "other") ?? undefined,
          employmentType: editing.employmentType as "driver" | "walker",
          weeklyHours: editing.weeklyHours ?? (undefined as any),
          postcode: editing.postcode ?? "",
          lastWorkingDay: editing.lastWorkingDay,
          notes: editing.notes ?? "",
        });
      } else {
        form.reset({
          employeeName: "",
          gender: undefined,
          weeklyHours: undefined as any,
          postcode: "",
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

            <div className="grid grid-cols-3 gap-4">
              <FormField control={form.control} name="gender" render={({ field }) => (
                <FormItem>
                  <FormLabel>Gender</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ""}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

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
                  <FormControl><Input type="number" step="0.5" placeholder="e.g. 37.5" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="postcode" render={({ field }) => (
                <FormItem>
                  <FormLabel>Postcode</FormLabel>
                  <FormControl><Input placeholder="e.g. G1 1AA" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="lastWorkingDay" render={({ field }) => (
                <FormItem>
                  <FormLabel>Termination Day <span className="text-red-500">*</span></FormLabel>
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
      gender: undefined,
      desiredWeeklyHours: 0,
      contractedHours: undefined,
      postcode: "",
      trainingDate: "",
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
          gender: (editing.gender as "male" | "female" | "other") ?? undefined,
          employmentType: editing.employmentType as "driver" | "walker",
          desiredWeeklyHours: editing.desiredWeeklyHours ?? 0,
          contractedHours: editing.contractedHours ?? undefined,
          postcode: editing.postcode ?? "",
          trainingDate: editing.trainingDate ?? "",
          stage: editing.stage as any,
          notes: editing.notes ?? "",
        });
      } else {
        form.reset({
          candidateName: "",
          gender: undefined,
          desiredWeeklyHours: 0,
          contractedHours: undefined,
          postcode: "",
          trainingDate: "",
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

            <div className="grid grid-cols-3 gap-4">
              <FormField control={form.control} name="gender" render={({ field }) => (
                <FormItem>
                  <FormLabel>Gender</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ""}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

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
                  <FormLabel>Desired Hours <span className="text-red-500">*</span></FormLabel>
                  <FormControl><Input type="number" step="0.5" placeholder="e.g. 35" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="contractedHours" render={({ field }) => (
                <FormItem>
                  <FormLabel>Contracted Hours</FormLabel>
                  <FormControl><Input type="number" step="0.5" placeholder="e.g. 30" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="postcode" render={({ field }) => (
                <FormItem>
                  <FormLabel>Postcode</FormLabel>
                  <FormControl><Input placeholder="e.g. G12 8QQ" {...field} /></FormControl>
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

            <FormField control={form.control} name="trainingDate" render={({ field }) => (
              <FormItem>
                <FormLabel>Training Attended</FormLabel>
                <FormControl><Input type="date" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

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
  const [leaverModalOpen, setLeaverModalOpen] = useState(false);
  const [joinerModalOpen, setJoinerModalOpen] = useState(false);
  const [editingLeaver, setEditingLeaver] = useState<Leaver | null>(null);
  const [editingJoiner, setEditingJoiner] = useState<Joiner | null>(null);
  const [deletingLeaverId, setDeletingLeaverId] = useState<string | null>(null);
  const [deletingJoinerId, setDeletingJoinerId] = useState<string | null>(null);
  const [leaversOpen, setLeaversOpen] = useState(true);
  const [joinersOpen, setJoinersOpen] = useState(true);

  type LeaverSortCol = 'employeeName' | 'employmentType' | 'weeklyHours' | 'lastWorkingDay';
  type JoinerSortCol = 'candidateName' | 'employmentType' | 'desiredWeeklyHours' | 'stage' | 'confidenceWeight' | 'trainingDate' | 'postcode';
  type SortDir = 'asc' | 'desc';

  const [leaverSort, setLeaverSort] = useState<{ col: LeaverSortCol; dir: SortDir }>({ col: 'lastWorkingDay', dir: 'asc' });
  const [joinerSort, setJoinerSort] = useState<{ col: JoinerSortCol; dir: SortDir }>({ col: 'trainingDate', dir: 'asc' });

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
                      <TableHead>Gender</TableHead>
                      <SortHead col="employmentType" label="Type" current={leaverSort} onSort={toggleLeaverSort} />
                      <SortHead col="weeklyHours" label="Hours/wk" current={leaverSort} onSort={toggleLeaverSort} />
                      <TableHead>Postcode</TableHead>
                      <SortHead col="lastWorkingDay" label="Termination Day" current={leaverSort} onSort={toggleLeaverSort} />
                      {isScheduler && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedLeavers.map(l => (
                      <TableRow key={l.id}>
                        <TableCell className="font-medium">{l.employeeName}</TableCell>
                        <TableCell className="capitalize">{l.gender ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize text-xs">{l.employmentType}</Badge>
                        </TableCell>
                        <TableCell>{l.weeklyHours}h</TableCell>
                        <TableCell className="font-mono text-xs">{l.postcode || '—'}</TableCell>
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
                      <TableHead>Gender</TableHead>
                      <SortHead col="employmentType" label="Type" current={joinerSort} onSort={toggleJoinerSort} />
                      <SortHead col="desiredWeeklyHours" label="Desired Hrs" current={joinerSort} onSort={toggleJoinerSort} />
                      <TableHead>Contracted Hrs</TableHead>
                      <SortHead col="postcode" label="Postcode" current={joinerSort} onSort={toggleJoinerSort} />
                      <SortHead col="stage" label="Stage" current={joinerSort} onSort={toggleJoinerSort} />
                      <SortHead col="confidenceWeight" label="Confidence" current={joinerSort} onSort={toggleJoinerSort} />
                      <SortHead col="trainingDate" label="Training Attended" current={joinerSort} onSort={toggleJoinerSort} />
                      {isScheduler && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedJoiners.map(j => (
                      <TableRow key={j.id} className={isStale14Days(j) ? "bg-red-50/60 dark:bg-red-950/20" : undefined}>
                        <TableCell className="font-medium">{j.candidateName}</TableCell>
                        <TableCell className="capitalize">{j.gender ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize text-xs">{j.employmentType}</Badge>
                        </TableCell>
                        <TableCell>{j.desiredWeeklyHours}h</TableCell>
                        <TableCell>{j.contractedHours != null ? `${j.contractedHours}h` : '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{j.postcode || '—'}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge
                              className={[
                                "text-xs",
                                j.stage === 'Training Attended'
                                  ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                                  : j.stage === 'PVG' || j.stage === 'REF1' || j.stage === 'REF2'
                                  ? "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
                                  : j.stage === 'Dropped'
                                  ? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                                  : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
                              ].join(' ')}
                            >
                              {j.stage}
                            </Badge>
                            {isStale14Days(j) && (
                              <Badge className="text-xs bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-700 gap-1">
                                <AlertTriangle className="w-3 h-3" /> Stale 14+ days
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{Math.round((j.confidenceWeight ?? 0) * 100)}%</TableCell>
                        <TableCell>{formatDate(j.trainingDate)}</TableCell>
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
