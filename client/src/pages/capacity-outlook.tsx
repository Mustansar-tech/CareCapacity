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
  Plus, Pencil, Trash2, ChevronDown, ChevronUp, Info, Calendar, CheckCircle2,
} from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import type { OutlookResponse, OutlookDetail, Leaver, Joiner, MonthlySnapshot } from "@shared/schema";
import { joinerStages } from "@shared/schema";

// ── Types ────────────────────────────────────────────────────────────────────


// ── Milestone confidence helpers ──────────────────────────────────────────────

const MILESTONE_WEIGHTS: Record<string, number> = {
  'Hired': 1.0,
  'Onboarding': 0.33,
  'Training Attended': 0.33,
  'PVG': 0.11,
  'REF1': 0.11,
  'REF2': 0.11,
};
const MILESTONE_ORDER = ['Hired', 'REF2', 'REF1', 'PVG', 'Training Attended', 'Onboarding'];
const ALL_MILESTONES = ['Onboarding', 'Training Attended', 'PVG', 'REF1', 'REF2', 'Hired'] as const;

function calcMilestoneConfidence(stages: string[]): number {
  if (stages.includes('Hired')) return 1.0;
  return stages.reduce((sum, s) => sum + (MILESTONE_WEIGHTS[s] ?? 0), 0);
}

function getInitialCompletedStages(editing: Joiner): string[] {
  if (editing.completedStages && editing.completedStages.length > 0) return editing.completedStages;
  if (editing.stage === 'Dropped') return [];
  const base = ['Onboarding'];
  if (editing.stage && editing.stage !== 'Onboarding') base.push(editing.stage);
  return base;
}

function daysSince(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00Z').getTime();
  return Math.floor((Date.now() - d) / 86400000);
}

function isStale14Days(j: { stage: string; completedStages?: string[] | null; trainingDate?: string | null }): boolean {
  const hasTraining = j.completedStages ? j.completedStages.includes('Training Attended') : j.stage === 'Training Attended';
  return hasTraining && !!j.trainingDate && daysSince(j.trainingDate) >= 14;
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
  firstDayOfNotice: z.string().optional(),
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
  completedStages: z.array(z.string()).default([]),
  status: z.enum(["active", "dropped", "hired", "hired_archived"]).default("active"),
  hiredAt: z.string().optional(),
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
      firstDayOfNotice: "",
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
          firstDayOfNotice: editing.firstDayOfNotice ?? "",
          lastWorkingDay: editing.lastWorkingDay,
          notes: editing.notes ?? "",
        });
      } else {
        form.reset({
          employeeName: "",
          gender: undefined,
          weeklyHours: undefined as any,
          postcode: "",
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

              <FormField control={form.control} name="firstDayOfNotice" render={({ field }) => (
                <FormItem>
                  <FormLabel>Day of Notice</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="lastWorkingDay" render={({ field }) => (
              <FormItem>
                <FormLabel>Termination Day <span className="text-red-500">*</span></FormLabel>
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
      completedStages: ['Onboarding'],
      status: "active",
      notes: "",
    },
  });

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
          completedStages: getInitialCompletedStages(editing),
          status: (editing.status as "active" | "dropped" | "hired" | "hired_archived") ?? "active",
          hiredAt: editing.hiredAt ?? "",
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
          completedStages: ['Onboarding'],
          status: "active",
          hiredAt: "",
          notes: "",
        });
      }
    }
  }, [open, editing?.id]);

  const watchedStages = form.watch("completedStages");
  const watchedStatus = form.watch("status");
  const isHired = watchedStages?.includes('Hired') || watchedStatus === 'hired';
  const liveConfidence = watchedStatus === 'dropped' ? 0 : isHired ? 1.0 : calcMilestoneConfidence(watchedStages ?? []);

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

            <FormItem>
              <FormLabel>Milestones Completed <span className="text-red-500">*</span></FormLabel>
              <div className="flex flex-wrap gap-2 mt-1">
                {ALL_MILESTONES.map(m => {
                  const checked = watchedStages?.includes(m) ?? false;
                  const disabled = watchedStatus === 'dropped';
                  const isHiredMilestone = m === 'Hired';
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        const current = form.getValues('completedStages') ?? [];
                        const next = checked ? current.filter(s => s !== m) : [...current, m];
                        form.setValue('completedStages', next, { shouldValidate: true });
                        // Toggling Hired milestone also sets status + hiredAt
                        if (isHiredMilestone) {
                          if (!checked) {
                            form.setValue('status', 'hired', { shouldValidate: true });
                            form.setValue('hiredAt', new Date().toISOString().split('T')[0]);
                          } else {
                            form.setValue('status', 'active', { shouldValidate: true });
                            form.setValue('hiredAt', '');
                          }
                        }
                      }}
                      className={[
                        "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
                        checked && !disabled && isHiredMilestone
                          ? "bg-yellow-100 text-yellow-800 border-yellow-400 dark:bg-yellow-900/40 dark:text-yellow-300 dark:border-yellow-600"
                          : checked && !disabled
                          ? "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700"
                          : "bg-muted text-muted-foreground border-border hover:bg-muted/80",
                      ].join(' ')}
                    >
                      {isHiredMilestone ? '🏆 ' : ''}{m}
                      {isHiredMilestone
                        ? <span className="opacity-60 ml-1">= 100%</span>
                        : <span className="opacity-60"> +{Math.round((MILESTONE_WEIGHTS[m] ?? 0) * 100)}%</span>
                      }
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-3 mt-2">
                <div className={[
                  "text-sm font-semibold",
                  liveConfidence >= 1.0 ? "text-yellow-600 dark:text-yellow-400"
                  : liveConfidence >= 0.7 ? "text-emerald-600 dark:text-emerald-400"
                  : liveConfidence >= 0.4 ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground",
                ].join(' ')}>
                  {isHired ? '✓ Hired — 100% confident' : `Total confidence: ${Math.round(liveConfidence * 100)}%`}
                </div>
                {!isHired && (
                  <button
                    type="button"
                    onClick={() => {
                      const isDrop = watchedStatus !== 'dropped';
                      form.setValue('status', isDrop ? 'dropped' : 'active', { shouldValidate: true });
                      if (isDrop) form.setValue('completedStages', [], { shouldValidate: true });
                    }}
                    className={[
                      "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                      watchedStatus === 'dropped'
                        ? "bg-red-100 text-red-700 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700"
                        : "bg-muted text-muted-foreground border-border hover:bg-red-50 hover:text-red-600",
                    ].join(' ')}
                  >
                    {watchedStatus === 'dropped' ? '✕ Dropped' : 'Mark as Dropped'}
                  </button>
                )}
              </div>
            </FormItem>

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
  const [activeTab, setActiveTab] = useState<'leavers' | 'pipeline'>('pipeline');
  const [monthlyViewOpen, setMonthlyViewOpen] = useState(false);

  type LeaverSortCol = 'employeeName' | 'employmentType' | 'weeklyHours' | 'firstDayOfNotice' | 'lastWorkingDay';
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

  // Monthly capacity data
  const monthlyQuery = useQuery<MonthlyData>({
    queryKey: ['/api/capacity-outlook/monthly', branchId],
    queryFn: async () => {
      const res = await fetch(
        toAbsoluteUrl(`/api/capacity-outlook/monthly?branchId=${branchId}`),
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to load monthly data');
      return res.json();
    },
    enabled: !!branchId,
    staleTime: 60_000,
  });

  // Page-load rollover check: if the previous month's snapshot is missing,
  // auto-close it. Scheduler-only — viewers can't call the close endpoint.
  useEffect(() => {
    if (!monthlyQuery.data || !branchId || !isScheduler) return;
    const { snapshots, currentYear, currentMonth } = monthlyQuery.data;
    const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;
    const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const hasPrevSnapshot = snapshots.some(s => s.year === prevYear && s.month === prevMonth);
    if (!hasPrevSnapshot) {
      fetch(toAbsoluteUrl(`/api/capacity-outlook/monthly/close?branchId=${branchId}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ year: prevYear, month: prevMonth }),
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook/monthly'] });
        queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook/leavers'] });
        queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook/joiners'] });
      }).catch(() => {});
    }
  }, [monthlyQuery.data, branchId, isScheduler]);

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
      queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook/monthly'] });
      setDeletingJoinerId(null);
      toast({ title: "Joiner removed" });
    },
    onError: () => toast({ variant: "destructive", title: "Error", description: "Failed to remove joiner" }),
  });

  const outlook = outlookQuery.data;
  const totals = outlook?.totals;

  // Steady-state weekly KPIs — computed from raw leaver/joiner lists
  const activeLeavers = leaversQuery.data ?? [];
  // Split pipeline joiners: active (not yet hired) vs hired this month
  const pipelineJoiners = (joinersQuery.data ?? []).filter(j => j.status === 'active');
  const hiredJoiners = (joinersQuery.data ?? []).filter(j => j.status === 'hired');
  const activeJoiners = pipelineJoiners; // alias for coverage/net calculation

  // Split leavers: already gone (past termination) vs still on notice (still working)
  const todayStr = new Date().toISOString().split('T')[0];
  const alreadyGone = activeLeavers.filter(l => l.lastWorkingDay && l.lastWorkingDay < todayStr);
  const onNotice   = activeLeavers.filter(l => !l.lastWorkingDay || l.lastWorkingDay >= todayStr);
  const hoursAlreadyGone = Math.round(alreadyGone.reduce((s, l) => s + (l.weeklyHours ?? 0), 0) * 10) / 10;
  const hoursOnNotice    = Math.round(onNotice.reduce((s, l) => s + (l.weeklyHours ?? 0), 0) * 10) / 10;

  // For coverage/net: only hours actually lost (already gone) count against us now
  const weeklyLossRate = hoursAlreadyGone;
  const weeklyGainRate = Math.round(activeJoiners.reduce((s, j) => s + (j.desiredWeeklyHours ?? 0) * (j.confidenceWeight ?? 0), 0) * 10) / 10;
  const weeklyNet = Math.round((weeklyGainRate - weeklyLossRate) * 10) / 10;

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
            <Button
              onClick={() => setMonthlyViewOpen(true)}
              size="sm"
              variant="outline"
              className="gap-1.5"
            >
              <Calendar className="w-3.5 h-3.5" />
              Monthly View
            </Button>
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

          {/* Staff Leaving */}
          <Card className="glass hover-lift animate-scale-in">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center">
                  <TrendingDown className="w-3.5 h-3.5 text-white" />
                </div>
                Staff Leaving
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {leaversQuery.isLoading ? (
                <div className="h-8 bg-muted animate-pulse rounded" />
              ) : (
                <>
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                    {activeLeavers.length} <span className="text-base font-medium">staff</span>
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {hoursAlreadyGone > 0 && (
                      <div className="text-xs text-red-600 dark:text-red-400 font-medium">
                        {hoursAlreadyGone}h/wk already gone
                      </div>
                    )}
                    {hoursOnNotice > 0 && (
                      <div className="text-xs text-amber-600 dark:text-amber-400">
                        {hoursOnNotice}h/wk still on notice
                      </div>
                    )}
                    {hoursAlreadyGone === 0 && hoursOnNotice === 0 && (
                      <div className="text-xs text-muted-foreground">no hours at risk</div>
                    )}
                    {((monthlyQuery.data?.live.hoursOut ?? 0) > 0 || (monthlyQuery.data?.live.headsOut ?? 0) > 0) && (
                      <div className="text-xs text-red-500/70 dark:text-red-400/70 mt-0.5 border-t border-red-100 dark:border-red-900/30 pt-0.5">
                        {monthlyQuery.data!.live.hoursOut}h out · {monthlyQuery.data!.live.headsOut} {monthlyQuery.data!.live.headsOut === 1 ? 'leaver' : 'leavers'} this month
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* In Pipeline */}
          <Card className="glass hover-lift animate-scale-in">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
                  <TrendingUp className="w-3.5 h-3.5 text-white" />
                </div>
                In Pipeline
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {joinersQuery.isLoading ? (
                <div className="h-8 bg-muted animate-pulse rounded" />
              ) : (
                <>
                  <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                    {pipelineJoiners.length} <span className="text-base font-medium">candidates</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {weeklyGainRate}h/wk expected (weighted)
                  </div>
                  {hiredJoiners.length > 0 && (
                    <div className="text-xs text-yellow-600 dark:text-yellow-400 font-medium mt-0.5 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      {hiredJoiners.length} hired this month
                    </div>
                  )}
                  {((monthlyQuery.data?.live.hoursIn ?? 0) > 0 || (monthlyQuery.data?.live.headsIn ?? 0) > 0) && (
                    <div className="text-xs text-emerald-500/70 dark:text-emerald-400/70 mt-0.5 border-t border-emerald-100 dark:border-emerald-900/30 pt-0.5">
                      {monthlyQuery.data!.live.hoursIn}h in · {monthlyQuery.data!.live.headsIn} {monthlyQuery.data!.live.headsIn === 1 ? 'hire' : 'hires'} this month
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Weekly Net */}
          <Card className="glass hover-lift animate-scale-in">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                  <Minus className="w-3.5 h-3.5 text-white" />
                </div>
                Weekly Net
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {leaversQuery.isLoading || joinersQuery.isLoading ? (
                <div className="h-8 bg-muted animate-pulse rounded" />
              ) : (
                <>
                  <div className={[
                    "text-2xl font-bold",
                    weeklyNet >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
                  ].join(' ')}>
                    {weeklyNet >= 0 ? '+' : ''}{weeklyNet}h/wk
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    ongoing capacity change
                  </div>
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
                  <div className={[
                    "text-2xl font-bold",
                    (totals?.coverage ?? 0) >= 1
                      ? "text-emerald-600 dark:text-emerald-400"
                      : (totals?.coverage ?? 0) >= 0.5
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-red-600 dark:text-red-400",
                  ].join(' ')}>
                    {weeklyLossRate === 0 ? '—' : `${Math.round((weeklyGainRate / weeklyLossRate) * 100)}%`}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">pipeline covers leavers</div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Risk */}
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

        {/* Leavers / Pipeline tabbed card */}
        <Card className="glass">
          {/* Tab bar */}
          <div className="flex items-center border-b border-border px-2 pt-1 gap-0">
            <button
              onClick={() => setActiveTab('pipeline')}
              className={[
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
                activeTab === 'pipeline'
                  ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/40",
              ].join(' ')}
            >
              <div className={`w-5 h-5 rounded flex items-center justify-center ${activeTab === 'pipeline' ? 'bg-emerald-500' : 'bg-muted'}`}>
                <TrendingUp className="w-3 h-3 text-white" />
              </div>
              Active Pipeline
              <span className={[
                "inline-flex items-center justify-center rounded-full text-xs font-semibold px-1.5 py-0.5 min-w-[20px]",
                activeTab === 'pipeline'
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                  : "bg-muted text-muted-foreground",
              ].join(' ')}>
                {pipelineJoiners.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('leavers')}
              className={[
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
                activeTab === 'leavers'
                  ? "border-red-500 text-red-600 dark:text-red-400"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/40",
              ].join(' ')}
            >
              <div className={`w-5 h-5 rounded flex items-center justify-center ${activeTab === 'leavers' ? 'bg-red-500' : 'bg-muted'}`}>
                <TrendingDown className="w-3 h-3 text-white" />
              </div>
              Active Leavers
              <span className={[
                "inline-flex items-center justify-center rounded-full text-xs font-semibold px-1.5 py-0.5 min-w-[20px]",
                activeTab === 'leavers'
                  ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                  : "bg-muted text-muted-foreground",
              ].join(' ')}>
                {leaversQuery.data?.length ?? 0}
              </span>
            </button>
          </div>

          {/* Tab content */}
          <CardContent className="pt-0 px-0">
            {activeTab === 'leavers' && (
              leaversQuery.isLoading ? (
                <div className="h-16 bg-muted animate-pulse rounded m-4" />
              ) : !leaversQuery.data?.length ? (
                <p className="text-sm text-muted-foreground text-center py-8">No active leavers recorded.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortHead col="employeeName" label="Name" current={leaverSort} onSort={toggleLeaverSort} />
                      <TableHead>Gender</TableHead>
                      <SortHead col="employmentType" label="Type" current={leaverSort} onSort={toggleLeaverSort} />
                      <SortHead col="weeklyHours" label="Hours/wk" current={leaverSort} onSort={toggleLeaverSort} />
                      <TableHead>Postcode</TableHead>
                      <SortHead col="firstDayOfNotice" label="Day of Notice" current={leaverSort} onSort={toggleLeaverSort} />
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
                        <TableCell>{l.firstDayOfNotice ? formatDate(l.firstDayOfNotice) : '—'}</TableCell>
                        <TableCell>{formatDate(l.lastWorkingDay)}</TableCell>
                        {isScheduler && (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button size="icon" variant="ghost" className="h-7 w-7"
                                onClick={() => { setEditingLeaver(l); setLeaverModalOpen(true); }}>
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-700"
                                onClick={() => setDeletingLeaverId(l.id)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )
            )}

            {activeTab === 'pipeline' && (
              joinersQuery.isLoading ? (
                <div className="h-16 bg-muted animate-pulse rounded m-4" />
              ) : !pipelineJoiners.length && !hiredJoiners.length ? (
                <p className="text-sm text-muted-foreground text-center py-8">No active joiners in pipeline.</p>
              ) : (
                <>
                  {pipelineJoiners.length > 0 && (
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
                        {sortBy(pipelineJoiners, joinerSort.col, joinerSort.dir).map(j => (
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
                              <div className="flex items-center gap-1 flex-wrap">
                                {j.stage === 'Dropped' ? (
                                  <Badge className="text-xs bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">Dropped</Badge>
                                ) : (j.completedStages && j.completedStages.length > 0 ? j.completedStages : [j.stage]).map(m => (
                                  <Badge key={m} className={[
                                    "text-xs",
                                    m === 'Training Attended'
                                      ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                                      : m === 'PVG' || m === 'REF1' || m === 'REF2'
                                      ? "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
                                      : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
                                  ].join(' ')}>{m}</Badge>
                                ))}
                                {isStale14Days(j) && (
                                  <Badge className="text-xs bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-700 gap-1">
                                    <AlertTriangle className="w-3 h-3" /> Stale
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>{Math.round((j.confidenceWeight ?? 0) * 100)}%</TableCell>
                            <TableCell>{formatDate(j.trainingDate)}</TableCell>
                            {isScheduler && (
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <Button size="icon" variant="ghost" className="h-7 w-7"
                                    onClick={() => { setEditingJoiner(j); setJoinerModalOpen(true); }}>
                                    <Pencil className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-700"
                                    onClick={() => setDeletingJoinerId(j.id)}>
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

                  {hiredJoiners.length > 0 && (
                    <div className="border-t border-yellow-200 dark:border-yellow-800/40 bg-yellow-50/60 dark:bg-yellow-900/10 px-4 py-3">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle2 className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
                        <span className="text-xs font-semibold text-yellow-700 dark:text-yellow-300 uppercase tracking-wide">
                          Hired this month — {hiredJoiners.reduce((s, j) => s + (j.desiredWeeklyHours ?? 0), 0)}h/wk · {hiredJoiners.length} {hiredJoiners.length === 1 ? 'person' : 'people'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {hiredJoiners.map(j => (
                          <div key={j.id} className="flex items-center gap-2 bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 rounded-lg px-3 py-1.5">
                            <span className="text-xs font-medium text-yellow-800 dark:text-yellow-200">{j.candidateName}</span>
                            <span className="text-xs text-yellow-600 dark:text-yellow-400">{j.desiredWeeklyHours}h/wk</span>
                            <Badge variant="outline" className="text-xs capitalize border-yellow-400 text-yellow-700 dark:text-yellow-400 py-0 px-1.5">{j.employmentType}</Badge>
                            {isScheduler && (
                              <Button size="icon" variant="ghost" className="h-5 w-5 text-yellow-600 hover:text-yellow-800 dark:text-yellow-400"
                                onClick={() => { setEditingJoiner(j); setJoinerModalOpen(true); }}>
                                <Pencil className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )
            )}
          </CardContent>
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

      {/* Monthly View Sheet */}
      <MonthlyViewSheet
        open={monthlyViewOpen}
        onClose={() => setMonthlyViewOpen(false)}
        branchId={branchId}
        monthlyData={monthlyQuery.data ?? null}
        isLoading={monthlyQuery.isLoading}
        isScheduler={isScheduler}
        hiredJoiners={hiredJoiners}
      />
    </div>
  );
}

// ── Monthly View Sheet ────────────────────────────────────────────────────────

const MONTH_NAMES = [
  '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

type MonthlyData = {
  snapshots: MonthlySnapshot[];
  live: { hoursIn: number; headsIn: number; hoursOut: number; headsOut: number };
  currentYear: number;
  currentMonth: number;
};

function MonthlyViewSheet({
  open,
  onClose,
  branchId,
  monthlyData,
  isLoading,
  isScheduler,
  hiredJoiners,
}: {
  open: boolean;
  onClose: () => void;
  branchId: string;
  monthlyData: MonthlyData | null;
  isLoading: boolean;
  isScheduler: boolean;
  hiredJoiners: Joiner[];
}) {
  const { toast } = useToast();

  const closeMonthMutation = useMutation({
    mutationFn: async () => {
      const year = monthlyData?.currentYear ?? new Date().getUTCFullYear();
      const month = monthlyData?.currentMonth ?? (new Date().getUTCMonth() + 1);
      const res = await fetch(
        toAbsoluteUrl(`/api/capacity-outlook/monthly/close?branchId=${branchId}`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ year, month }),
        },
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to close month');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook/monthly'] });
      queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook/joiners'] });
      toast({ title: "Month closed", description: "Snapshot saved and hired staff archived." });
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Error", description: err.message });
    },
  });

  // Build rows: current month first (live or locked), then past closed months
  const rows = useMemo(() => {
    if (!monthlyData) return [];
    const { snapshots, live, currentYear, currentMonth } = monthlyData;

    // If a snapshot already exists for the current month (manual close), show
    // it as locked rather than the live running total to preserve the record.
    const closedCurrentMonth = snapshots.find(
      s => s.year === currentYear && s.month === currentMonth,
    );

    const currentMonthRow = closedCurrentMonth
      ? { ...closedCurrentMonth, isLive: false, isClosed: true }
      : {
          year: currentYear, month: currentMonth,
          hoursIn: live.hoursIn, headsIn: live.headsIn,
          hoursOut: live.hoursOut, headsOut: live.headsOut,
          isLive: true, isClosed: false,
        };

    // Past snapshots — server returns DESC order (newest first)
    const pastRows = snapshots
      .filter(s => !(s.year === currentYear && s.month === currentMonth))
      .map(s => ({ ...s, isLive: false, isClosed: true }));

    return [currentMonthRow, ...pastRows];
  }, [monthlyData]);

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                <Calendar className="w-4 h-4 text-white" />
              </div>
              Monthly In / Out History
            </SheetTitle>
            {isScheduler && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => closeMonthMutation.mutate()}
                disabled={closeMonthMutation.isPending}
                className="gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                {closeMonthMutation.isPending ? 'Closing…' : 'Close Month'}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Hours In = staff hired · Hours Out = termination days · Net = In − Out
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-10 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">
              No data yet. Once staff are hired or leave, this table will populate.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-emerald-700 dark:text-emerald-400">In (h/wk)</TableHead>
                  <TableHead className="text-emerald-700 dark:text-emerald-400">Hires</TableHead>
                  <TableHead className="text-red-600 dark:text-red-400">Out (h/wk)</TableHead>
                  <TableHead className="text-red-600 dark:text-red-400">Leavers</TableHead>
                  <TableHead>Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const net = Math.round((row.hoursIn - row.hoursOut) * 10) / 10;
                  const isCurrentMonth = row.year === monthlyData?.currentYear && row.month === monthlyData?.currentMonth;
                  const isLive = 'isLive' in row && row.isLive;
                  const isClosed = 'isClosed' in row && row.isClosed;
                  return (
                    <TableRow
                      key={`${row.year}-${row.month}`}
                      className={isCurrentMonth ? "bg-blue-50/60 dark:bg-blue-900/10 font-medium" : undefined}
                    >
                      <TableCell>
                        <span className="font-medium">{MONTH_NAMES[row.month]} {row.year}</span>
                        {isLive && (
                          <Badge className="ml-2 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200">
                            Live
                          </Badge>
                        )}
                        {isCurrentMonth && isClosed && (
                          <Badge className="ml-2 text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200">
                            Closed
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-emerald-700 dark:text-emerald-400 font-semibold">
                        {row.hoursIn > 0 ? `+${row.hoursIn}h` : '—'}
                      </TableCell>
                      <TableCell className="text-emerald-600 dark:text-emerald-400">
                        {row.headsIn > 0 ? row.headsIn : '—'}
                      </TableCell>
                      <TableCell className="text-red-600 dark:text-red-400 font-semibold">
                        {row.hoursOut > 0 ? `${row.hoursOut}h` : '—'}
                      </TableCell>
                      <TableCell className="text-red-500 dark:text-red-400">
                        {row.headsOut > 0 ? row.headsOut : '—'}
                      </TableCell>
                      <TableCell className={[
                        "font-semibold",
                        net > 0 ? "text-emerald-600 dark:text-emerald-400"
                        : net < 0 ? "text-red-600 dark:text-red-400"
                        : "text-muted-foreground",
                      ].join(' ')}>
                        {net === 0 ? '±0h' : net > 0 ? `+${net}h` : `${net}h`}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {/* Hires this month — individual breakdown */}
          {!isLoading && hiredJoiners.length > 0 && (
            <div className="mt-5">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
                <span className="text-xs font-semibold text-yellow-700 dark:text-yellow-300 uppercase tracking-wide">
                  Hires this month
                </span>
                <span className="text-xs text-muted-foreground">
                  {hiredJoiners.length} {hiredJoiners.length === 1 ? 'person' : 'people'} ·{' '}
                  {hiredJoiners.reduce((s, j) => s + (j.desiredWeeklyHours ?? 0), 0)}h/wk
                </span>
              </div>
              <div className="rounded-lg border border-yellow-200 dark:border-yellow-800/40 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-yellow-50/80 dark:bg-yellow-900/10">
                      <TableHead className="text-xs py-2">Name</TableHead>
                      <TableHead className="text-xs py-2">Type</TableHead>
                      <TableHead className="text-xs py-2">Hours/wk</TableHead>
                      <TableHead className="text-xs py-2">Hired on</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {hiredJoiners.map(j => (
                      <TableRow key={j.id} className="bg-yellow-50/40 dark:bg-yellow-900/5">
                        <TableCell className="text-xs font-medium py-2">{j.candidateName}</TableCell>
                        <TableCell className="text-xs py-2 capitalize">{j.employmentType ?? '—'}</TableCell>
                        <TableCell className="text-xs py-2 text-emerald-700 dark:text-emerald-400 font-semibold">
                          {j.desiredWeeklyHours ? `${j.desiredWeeklyHours}h` : '—'}
                        </TableCell>
                        <TableCell className="text-xs py-2 text-muted-foreground">
                          {j.hiredAt
                            ? new Date(j.hiredAt + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
                            : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>

        {!isLoading && rows.length > 0 && (
          <div className="px-6 py-3 border-t border-border bg-muted/30 shrink-0">
            <p className="text-xs text-muted-foreground">
              Up to 12 months history · {rows.length - 1} closed · 1 live (current month)
              {isScheduler && (
                <span> · Use <strong>Close Month</strong> to lock the current month and archive hired staff</span>
              )}
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
