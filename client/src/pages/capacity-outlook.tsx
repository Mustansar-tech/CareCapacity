import { useState, useMemo, useEffect } from "react";
import { getGenderColorClass } from "@/utils/gender-colors";
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
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  TrendingDown, TrendingUp, Minus, Users, AlertTriangle,
  Plus, Pencil, Trash2, ChevronDown, ChevronUp, Info, Calendar, CheckCircle2, UserMinus, RotateCcw, Archive, CalendarDays, ArrowUpDown,
} from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import type { OutlookResponse, OutlookDetail, Leaver, Joiner, MonthlySnapshot, AvailabilityChange } from "@shared/schema";
import { joinerStages } from "@shared/schema";

// ── Types ────────────────────────────────────────────────────────────────────

interface CumulativeKpiResult {
  cumulativeHoursLost: number;
  cumulativeHoursHired: number;
  pipelineWeightedHours: number;
  pipelineRawHours: number;
  coverage: number;
  net: number;
  rag: 'green' | 'amber' | 'red';
  computedAt: string;
  terminatedYtd: number;
  hiredYtd: number;
  availNetDelta: number;
  availIncreasedHours: number;
  availDecreasedHours: number;
  availIncreaseCount: number;
  availDecreaseCount: number;
  availPendingCount: number;
  availPendingNetDelta: number;
}

// ── Milestone confidence helpers ──────────────────────────────────────────────

const MILESTONE_WEIGHTS: Record<string, number> = {
  'Hired': 1.0,
  'PVG': 0.34,
  'REF1': 0.33,
  'REF2': 0.33,
};
const MILESTONE_ORDER = ['Hired', 'REF2', 'REF1', 'PVG'];
const ALL_MILESTONES = ['PVG', 'REF1', 'REF2', 'Hired'] as const;

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

function isStale14Days(j: { trainingDay2Date?: string | null }): boolean {
  return !!j.trainingDay2Date && daysSince(j.trainingDay2Date) >= 14;
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
  employeeNo: z.string().min(1, "Employee number is required"),
  gender: z.enum(["male", "female", "other"], { required_error: "Gender is required" }),
  employmentType: z.enum(["driver", "walker"], { required_error: "Type is required" }),
  weeklyHours: z.coerce.number({ invalid_type_error: "Enter hours or select Bank" }).nonnegative("Enter hours or select Bank"),
  contractedHours: z.coerce.number({ invalid_type_error: "Enter contracted hours" }).nonnegative("Must be 0 or more"),
  postcode: z.string().min(1, "Postcode is required"),
  firstDayOfNotice: z.string().min(1, "Day of notice is required"),
  lastWorkingDay: z.string().min(1, "Termination day is required"),
  notes: z.string().optional(),
});

type LeaverFormData = z.infer<typeof leaverFormSchema>;

// ── Joiner form ───────────────────────────────────────────────────────────────

const joinerFormSchema = z.object({
  candidateName: z.string().min(1, "Name is required"),
  gender: z.enum(["male", "female", "other"], { required_error: "Gender is required" }),
  employmentType: z.enum(["driver", "walker"], { required_error: "Type is required" }),
  desiredWeeklyHours: z.coerce.number({ invalid_type_error: "Enter hours or select Bank" }).nonnegative("Enter hours or select Bank"),
  contractedHours: z.coerce.number({ invalid_type_error: "Enter contracted hours" }).nonnegative("Must be 0 or more"),
  postcode: z.string().min(1, "Postcode is required"),
  trainingDate: z.string().optional(),
  completedStages: z.array(z.string()).default([]),
  status: z.enum(["active", "dropped", "hired", "hired_archived"]).default("active"),
  hiredAt: z.string().optional(),
  availability: z.string().optional(),
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
      employeeNo: "",
      gender: undefined,
      weeklyHours: undefined as any,
      contractedHours: undefined,
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
          employeeNo: editing.employeeNo ?? "",
          gender: (editing.gender as "male" | "female" | "other") ?? undefined,
          employmentType: editing.employmentType as "driver" | "walker",
          weeklyHours: editing.weeklyHours ?? (undefined as any),
          contractedHours: editing.contractedHours ?? undefined,
          postcode: editing.postcode ?? "",
          firstDayOfNotice: editing.firstDayOfNotice ?? "",
          lastWorkingDay: editing.lastWorkingDay,
          notes: editing.notes ?? "",
        });
      } else {
        form.reset({
          employeeName: "",
          employeeNo: "",
          gender: undefined,
          weeklyHours: undefined as any,
          contractedHours: undefined,
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" onCloseAutoFocus={e => e.preventDefault()}>
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
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="employeeName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Employee Name <span className="text-red-500">*</span></FormLabel>
                  <FormControl><Input placeholder="Full name" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="employeeNo" render={({ field }) => (
                <FormItem>
                  <FormLabel>Employee No <span className="text-red-500">*</span></FormLabel>
                  <FormControl><Input placeholder="e.g. 10042" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <FormField control={form.control} name="gender" render={({ field }) => (
                <FormItem>
                  <FormLabel>Gender <span className="text-red-500">*</span></FormLabel>
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

              <FormField control={form.control} name="weeklyHours" render={({ field }) => {
                const isBank = field.value === 0;
                return (
                  <FormItem>
                    <FormLabel>Desired Hrs/wk <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <div>
                        {isBank ? (
                          <button
                            type="button"
                            onClick={() => field.onChange(undefined)}
                            style={{
                              width: '100%', height: 36, borderRadius: 6,
                              border: '2px solid #6366F1', background: '#EEF2FF',
                              color: '#4F46E5', fontSize: 13, fontWeight: 700,
                              cursor: 'pointer', display: 'flex', alignItems: 'center',
                              justifyContent: 'center', gap: 6,
                            }}
                          >
                            Bank
                            <span style={{ fontSize: 10, fontWeight: 400, color: '#818CF8' }}>click to enter hours</span>
                          </button>
                        ) : (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <Input
                              type="number" step="0.5" placeholder="e.g. 37.5"
                              value={field.value ?? ""}
                              onChange={e => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
                            />
                            <button
                              type="button"
                              onClick={() => field.onChange(0)}
                              style={{
                                padding: '0 12px', height: 36, borderRadius: 6, flexShrink: 0,
                                border: '1px solid #E2E8F0', background: 'white',
                                color: '#64748B', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                              }}
                            >
                              Bank
                            </button>
                          </div>
                        )}
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                );
              }} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="contractedHours" render={({ field }) => (
                <FormItem>
                  <FormLabel>Contracted Hours <span className="text-red-500">*</span></FormLabel>
                  <FormControl><Input type="number" step="0.5" placeholder="e.g. 30" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="postcode" render={({ field }) => (
                <FormItem>
                  <FormLabel>Postcode <span className="text-red-500">*</span></FormLabel>
                  <FormControl><Input placeholder="e.g. G1 1AA" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="firstDayOfNotice" render={({ field }) => (
                <FormItem>
                  <FormLabel>Day of Notice <span className="text-red-500">*</span></FormLabel>
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
      availability: "",
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
          availability: editing.availability ?? "",
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
          availability: "",
          notes: "",
        });
      }
    }
  }, [open, editing?.id]);

  const watchedStages = form.watch("completedStages");
  const watchedStatus = form.watch("status");
  const watchedDesiredHours = form.watch("desiredWeeklyHours");
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" onCloseAutoFocus={e => e.preventDefault()}>
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
                  <FormLabel>Gender <span className="text-red-500">*</span></FormLabel>
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

              <FormField control={form.control} name="desiredWeeklyHours" render={({ field }) => {
                const isBank = watchedDesiredHours === 0;
                return (
                  <FormItem>
                    <FormLabel>Desired Hrs/wk <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <div>
                        {isBank ? (
                          <button
                            type="button"
                            onClick={() => field.onChange(undefined)}
                            style={{
                              width: '100%', height: 36, borderRadius: 6,
                              border: '2px solid #6366F1', background: '#EEF2FF',
                              color: '#4F46E5', fontSize: 13, fontWeight: 700,
                              cursor: 'pointer', display: 'flex', alignItems: 'center',
                              justifyContent: 'center', gap: 6,
                            }}
                          >
                            Bank
                            <span style={{ fontSize: 10, fontWeight: 400, color: '#818CF8' }}>click to enter hours</span>
                          </button>
                        ) : (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <Input
                              type="number" step="0.5" placeholder="e.g. 35"
                              value={field.value || ""}
                              onChange={e => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
                            />
                            <button
                              type="button"
                              onClick={() => field.onChange(0)}
                              style={{
                                padding: '0 12px', height: 36, borderRadius: 6, flexShrink: 0,
                                border: '1px solid #E2E8F0', background: 'white',
                                color: '#64748B', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                              }}
                            >
                              Bank
                            </button>
                          </div>
                        )}
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                );
              }} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="contractedHours" render={({ field }) => (
                <FormItem>
                  <FormLabel>Contracted Hours <span className="text-red-500">*</span></FormLabel>
                  <FormControl><Input type="number" step="0.5" placeholder="e.g. 30" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="postcode" render={({ field }) => (
                <FormItem>
                  <FormLabel>Postcode <span className="text-red-500">*</span></FormLabel>
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

            <FormField control={form.control} name="trainingDate" render={({ field }) => {
              const selected = (field.value ?? '').split(',').map(s => s.trim()).filter(Boolean);
              return (
                <FormItem>
                  <FormLabel>Training Attended</FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-2">
                      {[1, 2, 3, 4].map(day => {
                        const isOn = selected.includes(String(day));
                        return (
                          <button
                            key={day}
                            type="button"
                            onClick={() => {
                              const next = isOn
                                ? selected.filter(d => d !== String(day))
                                : [...selected, String(day)].sort((a, b) => Number(a) - Number(b));
                              field.onChange(next.join(','));
                            }}
                            className={[
                              "w-9 h-9 rounded-full border-2 text-sm font-bold transition-colors focus:outline-none",
                              isOn
                                ? "bg-violet-500 border-violet-500 text-white"
                                : "border-border text-muted-foreground hover:border-violet-400 hover:text-violet-600",
                            ].join(' ')}
                          >
                            {day}
                          </button>
                        );
                      })}
                      {selected.length > 0 && (
                        <span className="text-xs text-muted-foreground ml-1">Day{selected.length > 1 ? 's' : ''} {selected.join(', ')} selected</span>
                      )}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              );
            }} />

            <FormField control={form.control} name="availability" render={({ field }) => (
              <FormItem>
                <FormLabel>Availability</FormLabel>
                <FormControl><Textarea placeholder="e.g. Mon–Fri mornings, weekends available…" rows={2} className="resize-none" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl><Textarea placeholder="Optional notes…" rows={2} className="resize-none" {...field} /></FormControl>
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

// ── AvailabilityChangeModal ───────────────────────────────────────────────────

const availChangeFormSchema = z.object({
  employeeName: z.string().min(1, "Name is required"),
  gender: z.enum(["male", "female", "other"], { required_error: "Gender is required" }),
  postcode: z.string().min(1, "Postcode is required"),
  employmentType: z.enum(["driver", "walker"], { required_error: "Type is required" }),
  previousHours: z.coerce.number({ invalid_type_error: "Enter previous hours" }).nonnegative("Must be 0 or more"),
  newHours: z.coerce.number({ invalid_type_error: "Enter new hours" }).nonnegative("Must be 0 or more"),
  effectiveDate: z.string().min(1, "Effective date is required"),
  notes: z.string().optional(),
});

type AvailChangeFormData = z.infer<typeof availChangeFormSchema>;

function AvailabilityChangeModal({
  open,
  onClose,
  editing,
  changeType,
  branchId,
}: {
  open: boolean;
  onClose: () => void;
  editing: AvailabilityChange | null;
  changeType: 'increase' | 'decrease';
  branchId: string;
}) {
  const { toast } = useToast();
  const { user } = useAuth();

  const form = useForm<AvailChangeFormData>({
    resolver: zodResolver(availChangeFormSchema),
    defaultValues: {
      employeeName: '',
      gender: undefined,
      postcode: '',
      employmentType: 'driver',
      previousHours: undefined as any,
      newHours: undefined as any,
      effectiveDate: '',
      notes: '',
    },
  });

  useEffect(() => {
    if (open) {
      if (editing) {
        form.reset({
          employeeName: editing.employeeName ?? '',
          gender: (editing.gender as 'male' | 'female' | 'other') ?? undefined,
          postcode: editing.postcode ?? '',
          employmentType: (editing.employmentType as 'driver' | 'walker') ?? 'driver',
          previousHours: editing.previousHours ?? (undefined as any),
          newHours: editing.newHours ?? (undefined as any),
          effectiveDate: editing.effectiveDate ?? '',
          notes: editing.notes ?? '',
        });
      } else {
        form.reset({
          employeeName: '',
          gender: undefined,
          postcode: '',
          employmentType: 'driver',
          previousHours: undefined as any,
          newHours: undefined as any,
          effectiveDate: '',
          notes: '',
        });
      }
    }
  }, [open, editing]);

  const saveMutation = useMutation({
    mutationFn: async (values: AvailChangeFormData) => {
      const payload = {
        branchId,
        changeType,
        employeeName: values.employeeName,
        gender: values.gender,
        postcode: values.postcode,
        employmentType: values.employmentType,
        previousHours: values.previousHours,
        newHours: values.newHours,
        effectiveDate: values.effectiveDate || null,
        notes: values.notes || null,
      };
      const url = editing
        ? toAbsoluteUrl(`/api/capacity-outlook/availability-changes/${editing.id}?branchId=${branchId}`)
        : toAbsoluteUrl(`/api/capacity-outlook/availability-changes?branchId=${branchId}`);
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message || 'Failed to save');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook/availability-changes'] });
      queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook/cumulative-kpi'] });
      toast({ title: editing ? 'Record updated' : 'Record added' });
      onClose();
    },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Error', description: e.message }),
  });

  const label = changeType === 'increase' ? 'Availability Increase' : 'Availability Decrease';

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md" onCloseAutoFocus={e => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit' : 'Add'} {label}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(v => saveMutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="employeeName" render={({ field }) => (
              <FormItem>
                <FormLabel>Care Pro Name <span className="text-red-500">*</span></FormLabel>
                <FormControl><Input placeholder="e.g. Jane Smith" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="gender" render={({ field }) => (
                <FormItem>
                  <FormLabel>Gender <span className="text-red-500">*</span></FormLabel>
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

              <FormField control={form.control} name="postcode" render={({ field }) => (
                <FormItem>
                  <FormLabel>Postcode <span className="text-red-500">*</span></FormLabel>
                  <FormControl><Input placeholder="e.g. G1 1AA" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="employmentType" render={({ field }) => (
              <FormItem>
                <FormLabel>Type <span className="text-red-500">*</span></FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="driver">Driver</SelectItem>
                    <SelectItem value="walker">Walker / Public Transport</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="previousHours" render={({ field }) => (
                <FormItem>
                  <FormLabel>Previous Hours <span className="text-red-500">*</span></FormLabel>
                  <FormControl>
                    <Input
                      type="number" step="0.5" placeholder="e.g. 20"
                      value={field.value ?? ''}
                      onChange={e => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="newHours" render={({ field }) => (
                <FormItem>
                  <FormLabel>New Hours <span className="text-red-500">*</span></FormLabel>
                  <FormControl>
                    <Input
                      type="number" step="0.5" placeholder="e.g. 30"
                      value={field.value ?? ''}
                      onChange={e => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="effectiveDate" render={({ field }) => (
              <FormItem>
                <FormLabel>Effective Date <span className="text-red-500">*</span></FormLabel>
                <FormControl><Input type="date" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes <span className="text-muted-foreground text-xs">(optional)</span></FormLabel>
                <FormControl><Textarea placeholder="Any context…" rows={2} {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving…' : editing ? 'Save Changes' : 'Add Record'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ── AvailabilityNotesPopup ────────────────────────────────────────────────────

function AvailabilityNotesPopup({
  open,
  joiner,
  onClose,
}: {
  open: boolean;
  joiner: Joiner | null;
  branchId: string;
  onClose: () => void;
}) {
  if (!joiner) return null;

  const trainingDays = (joiner.trainingDate ?? '').split(',').map(s => s.trim()).filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md" onCloseAutoFocus={e => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center">
              <CalendarDays className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-base">{joiner.candidateName}</div>
              <div className="text-xs font-normal text-muted-foreground capitalize">{joiner.employmentType} · {joiner.stage}</div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {trainingDays.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Training Attended</p>
              <div className="flex items-center gap-2">
                {[1,2,3,4].map(d => (
                  <span
                    key={d}
                    className={[
                      "w-9 h-9 rounded-full border-2 flex items-center justify-center text-sm font-bold",
                      trainingDays.includes(String(d))
                        ? "bg-violet-500 border-violet-500 text-white"
                        : "border-border text-muted-foreground/40",
                    ].join(' ')}
                  >
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Availability</p>
            {joiner.availability ? (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap rounded-md bg-muted/40 p-3">{joiner.availability}</p>
            ) : (
              <p className="text-sm text-muted-foreground/50 italic">No availability recorded</p>
            )}
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Notes</p>
            {joiner.notes ? (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap rounded-md bg-muted/40 p-3">{joiner.notes}</p>
            ) : (
              <p className="text-sm text-muted-foreground/50 italic">No notes recorded</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
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
  const isAdmin = user?.role === 'admin';

  const [horizonWeeks] = useState(4);
  const [leaverModalOpen, setLeaverModalOpen] = useState(false);
  const [joinerModalOpen, setJoinerModalOpen] = useState(false);
  const [editingLeaver, setEditingLeaver] = useState<Leaver | null>(null);
  const [editingJoiner, setEditingJoiner] = useState<Joiner | null>(null);
  const [deletingLeaverId, setDeletingLeaverId] = useState<string | null>(null);
  const [hardDeletingLeaverId, setHardDeletingLeaverId] = useState<string | null>(null);
  const [hardDeletingJoinerId, setHardDeletingJoinerId] = useState<string | null>(null);
  const [deletingJoinerId, setDeletingJoinerId] = useState<string | null>(null);
  const [availabilityPopupJoiner, setAvailabilityPopupJoiner] = useState<Joiner | null>(null);
  const [activeTab, setActiveTab] = useState<'leavers' | 'pipeline'>('pipeline');
  const [activeStaffTab, setActiveStaffTab] = useState<'joiners' | 'leavers' | 'avail-increase' | 'avail-decrease'>('joiners');

  const [availChangeModalOpen, setAvailChangeModalOpen] = useState(false);
  const [availChangeType, setAvailChangeType] = useState<'increase' | 'decrease'>('increase');
  const [editingAvailChange, setEditingAvailChange] = useState<AvailabilityChange | null>(null);
  const [deletingAvailChangeId, setDeletingAvailChangeId] = useState<string | null>(null);
  const [monthlyViewOpen, setMonthlyViewOpen] = useState(false);

  type LeaverSortCol = 'employeeName' | 'employmentType' | 'weeklyHours' | 'firstDayOfNotice' | 'lastWorkingDay';
  type JoinerSortCol = 'candidateName' | 'employmentType' | 'desiredWeeklyHours' | 'stage' | 'confidenceWeight' | 'trainingDate' | 'postcode';
  type SortDir = 'asc' | 'desc';

  const [leaverSort, setLeaverSort] = useState<{ col: LeaverSortCol; dir: SortDir }>({ col: 'lastWorkingDay', dir: 'asc' });
  const [joinerSort, setJoinerSort] = useState<{ col: JoinerSortCol; dir: SortDir }>({ col: 'trainingDate', dir: 'asc' });
  const [expandedLeaverMonths, setExpandedLeaverMonths] = useState<Set<string>>(new Set());
  const [expandedJoinerMonths, setExpandedJoinerMonths] = useState<Set<string>>(new Set());

  const toggleLeaverMonth = (key: string) =>
    setExpandedLeaverMonths(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s; });
  const toggleJoinerMonth = (key: string) =>
    setExpandedJoinerMonths(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s; });

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
    queryKey: ['/api/capacity-outlook/leavers', branchId, 'all'],
    queryFn: async () => {
      const res = await fetch(
        toAbsoluteUrl(`/api/capacity-outlook/leavers?branchId=${branchId}&includeProcessed=true`),
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to load leavers');
      return res.json();
    },
    enabled: !!branchId,
    staleTime: 30_000,
  });

  // Joiners list — includes hired_archived so past months remain visible
  const joinersQuery = useQuery<Joiner[]>({
    queryKey: ['/api/capacity-outlook/joiners', branchId, 'all'],
    queryFn: async () => {
      const res = await fetch(
        toAbsoluteUrl(`/api/capacity-outlook/joiners?branchId=${branchId}&includeAll=true`),
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to load joiners');
      return res.json();
    },
    enabled: !!branchId,
    staleTime: 30_000,
  });

  // Availability changes
  const availChangesQuery = useQuery<AvailabilityChange[]>({
    queryKey: ['/api/capacity-outlook/availability-changes', branchId],
    queryFn: async () => {
      const res = await fetch(
        toAbsoluteUrl(`/api/capacity-outlook/availability-changes?branchId=${branchId}`),
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to load availability changes');
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

  // Cumulative KPI — snapshots (authoritative for closed months) + live current month
  const cumulativeKpiQuery = useQuery<CumulativeKpiResult>({
    queryKey: ['/api/capacity-outlook/cumulative-kpi', branchId],
    queryFn: async () => {
      const res = await fetch(
        toAbsoluteUrl(`/api/capacity-outlook/cumulative-kpi?branchId=${branchId}`),
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to load cumulative KPI');
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
      queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook/monthly'] });
      setDeletingJoinerId(null);
      toast({ title: "Joiner removed" });
    },
    onError: () => toast({ variant: "destructive", title: "Error", description: "Failed to remove joiner" }),
  });

  const deleteAvailChangeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        toAbsoluteUrl(`/api/capacity-outlook/availability-changes/${id}?branchId=${branchId}`),
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to delete');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook/availability-changes'] });
      queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook/cumulative-kpi'] });
      setDeletingAvailChangeId(null);
      toast({ title: 'Record removed' });
    },
    onError: () => toast({ variant: 'destructive', title: 'Error', description: 'Failed to remove record' }),
  });

  const hardDeleteLeaverMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        toAbsoluteUrl(`/api/capacity-outlook/leavers/${id}?branchId=${branchId}&hard=true`),
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to permanently delete');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook'] });
      queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook/leavers'] });
      queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook/cumulative-kpi'] });
      setHardDeletingLeaverId(null);
      toast({ title: "Leaver permanently deleted" });
    },
    onError: () => toast({ variant: "destructive", title: "Error", description: "Failed to permanently delete leaver" }),
  });

  const hardDeleteJoinerMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        toAbsoluteUrl(`/api/capacity-outlook/joiners/${id}?branchId=${branchId}&hard=true`),
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to permanently delete');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook'] });
      queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook/joiners'] });
      queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook/monthly'] });
      queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook/cumulative-kpi'] });
      setHardDeletingJoinerId(null);
      toast({ title: "Joiner permanently deleted" });
    },
    onError: () => toast({ variant: "destructive", title: "Error", description: "Failed to permanently delete joiner" }),
  });

  const outlook = outlookQuery.data;
  const totals = outlook?.totals;

  // All leavers: active (on notice / already gone) + processed (terminated in closed months)
  const allLeavers = leaversQuery.data ?? [];
  const activeLeavers = allLeavers.filter(l => l.status === 'active');
  const terminatedLeavers = allLeavers.filter(l => l.status === 'processed');

  // All joiners: active pipeline + hired this month + hired_archived from closed months
  const allJoiners = joinersQuery.data ?? [];
  const pipelineJoiners = allJoiners.filter(j => j.status === 'active');
  const hiredJoiners = allJoiners.filter(j => j.status === 'hired');
  const archivedJoiners = allJoiners.filter(j => j.status === 'hired_archived');
  const activeJoiners = pipelineJoiners;

  // Active leaver splits (current month only)
  const todayStr = new Date().toISOString().split('T')[0];
  const currentMonthStart = todayStr.slice(0, 7) + '-01';
  // Leavers whose termination date is in a PAST calendar month — shown in the archive, not the current strip
  const pastMonthActiveLeavers = activeLeavers.filter(l => l.lastWorkingDay && l.lastWorkingDay < currentMonthStart);
  const currentMonthActiveLeavers = activeLeavers.filter(l => !l.lastWorkingDay || l.lastWorkingDay >= currentMonthStart);
  const alreadyGone = currentMonthActiveLeavers.filter(l => l.lastWorkingDay && l.lastWorkingDay < todayStr);
  const onNotice   = currentMonthActiveLeavers.filter(l => !l.lastWorkingDay || l.lastWorkingDay >= todayStr);
  const hoursAlreadyGone = Math.round(alreadyGone.reduce((s, l) => s + (l.weeklyHours ?? 0), 0) * 10) / 10;
  const hoursOnNotice    = Math.round(onNotice.reduce((s, l) => s + (l.weeklyHours ?? 0), 0) * 10) / 10;

  // For the Staff Leaving / In Pipeline KPI cards (current period)
  const weeklyLossRate = hoursAlreadyGone;
  const weeklyGainRate = Math.round(activeJoiners.reduce((s, j) => s + (j.desiredWeeklyHours ?? 0) * (j.confidenceWeight ?? 0), 0) * 10) / 10;
  const rawWeeklyHours = Math.round(activeJoiners.reduce((s, j) => s + (j.desiredWeeklyHours ?? 0), 0) * 10) / 10;
  const weeklyNet = Math.round((weeklyGainRate - weeklyLossRate) * 10) / 10;

  // Cumulative KPI values come from the API (snapshots + live month)
  const cumKpi = cumulativeKpiQuery.data;

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
      <div className="border-b border-card-border shrink-0 px-6 py-4" style={{background: 'linear-gradient(135deg, hsl(var(--background)) 0%, hsl(210 60% 97%) 50%, hsl(160 50% 96%) 100%)'}}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center shadow-md">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-emerald-600 bg-clip-text text-transparent">
                Capacity Outlook
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Monthly rolling forecast — leavers vs pipeline joiners
              </p>
            </div>
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
                {/* − dropdown: Add Leaver + Add Availability Decrease */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white gap-1.5">
                      <Minus className="w-3.5 h-3.5" /> Leaver
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onClick={() => setTimeout(() => { setEditingLeaver(null); setLeaverModalOpen(true); }, 0)}>
                      <UserMinus className="w-4 h-4 mr-2 text-red-500" /> Add Leaver
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setTimeout(() => { setAvailChangeType('decrease'); setEditingAvailChange(null); setAvailChangeModalOpen(true); }, 0)}>
                      <TrendingDown className="w-4 h-4 mr-2 text-amber-500" /> Add Availability Decrease
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* + dropdown: Add Joiner + Add Availability Increase */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5">
                      <Plus className="w-3.5 h-3.5" /> Joiner
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onClick={() => setTimeout(() => { setEditingJoiner(null); setJoinerModalOpen(true); }, 0)}>
                      <TrendingUp className="w-4 h-4 mr-2 text-emerald-500" /> Add Joiner
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setTimeout(() => { setAvailChangeType('increase'); setEditingAvailChange(null); setAvailChangeModalOpen(true); }, 0)}>
                      <TrendingUp className="w-4 h-4 mr-2 text-emerald-400" /> Add Availability Increase
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">

          {/* Staff Leaving */}
          <Card className="hover-lift animate-scale-in border-l-4 border-l-red-400 bg-red-50/40 dark:bg-red-950/10">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-semibold text-red-700 dark:text-red-400 flex items-center gap-1.5">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center shadow-sm">
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
                  <div className="mt-1 space-y-1">
                    {alreadyGone.length === 0 && onNotice.length === 0 ? (
                      <div className="text-sm text-muted-foreground">no active leavers</div>
                    ) : (
                      <>
                        {alreadyGone.length > 0 && (
                          <div className="flex items-baseline gap-1.5 text-red-600 dark:text-red-400">
                            <span className="text-2xl font-bold leading-none">{alreadyGone.length}</span>
                            <span className="text-xs font-medium">{hoursAlreadyGone}h/wk already gone</span>
                          </div>
                        )}
                        {onNotice.length > 0 && (
                          <div className="flex items-baseline gap-1.5 text-amber-600 dark:text-amber-400">
                            <span className="text-2xl font-bold leading-none">{onNotice.length}</span>
                            <span className="text-xs">{hoursOnNotice}h/wk still on notice</span>
                          </div>
                        )}
                      </>
                    )}
                    {((monthlyQuery.data?.live.hoursOut ?? 0) > 0 || (monthlyQuery.data?.live.headsOut ?? 0) > 0) && (
                      <div className="text-xs text-red-500/70 dark:text-red-400/70 border-t border-red-100 dark:border-red-900/30 pt-1 mt-1">
                        {monthlyQuery.data!.live.hoursOut}h out · {monthlyQuery.data!.live.headsOut} {monthlyQuery.data!.live.headsOut === 1 ? 'leaver' : 'leavers'} this month
                      </div>
                    )}
                    {(cumKpi?.terminatedYtd ?? 0) > 0 && (
                      <div className="text-xs text-red-400/70 dark:text-red-500/60 mt-1">
                        {cumKpi!.terminatedYtd} terminated this year
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* In Pipeline */}
          <Card className="hover-lift animate-scale-in border-l-4 border-l-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/10">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-sm">
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
                    {rawWeeklyHours}h/wk expected
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
                  {(cumKpi?.hiredYtd ?? 0) > 0 && (
                    <div className="text-xs text-emerald-400/70 dark:text-emerald-500/60 mt-1">
                      {cumKpi!.hiredYtd} hired this year
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Avail. Changes */}
          <Card className="hover-lift animate-scale-in border-l-4 border-l-violet-400 bg-violet-50/40 dark:bg-violet-950/10">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-semibold text-violet-700 dark:text-violet-400 flex items-center gap-1.5">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center shadow-sm">
                  <ArrowUpDown className="w-3.5 h-3.5 text-white" />
                </div>
                Avail. Changes
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {cumulativeKpiQuery.isLoading ? (
                <div className="h-8 bg-muted animate-pulse rounded" />
              ) : (() => {
                const delta = cumKpi?.availNetDelta ?? 0;
                const increases = cumKpi?.availIncreaseCount ?? 0;
                const decreases = cumKpi?.availDecreaseCount ?? 0;
                const pending   = cumKpi?.availPendingCount ?? 0;
                const pendingDelta = cumKpi?.availPendingNetDelta ?? 0;
                const totalEffective = increases + decreases;
                if (totalEffective === 0 && pending === 0) {
                  return <div className="text-sm text-muted-foreground mt-1">no changes recorded</div>;
                }
                return (
                  <div className="mt-1 space-y-1">
                    {totalEffective > 0 && (
                      <div className={`flex items-baseline gap-1.5 ${delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        <span className="text-2xl font-bold leading-none">
                          {delta > 0 ? '+' : ''}{delta}h
                        </span>
                        <span className="text-xs font-medium">net / wk</span>
                      </div>
                    )}
                    {increases > 0 && (
                      <div className="text-xs text-emerald-600/80 dark:text-emerald-400/80">
                        +{cumKpi!.availIncreasedHours}h from {increases} increase{increases !== 1 ? 's' : ''}
                      </div>
                    )}
                    {decreases > 0 && (
                      <div className="text-xs text-amber-600/80 dark:text-amber-400/80">
                        −{cumKpi!.availDecreasedHours}h from {decreases} decrease{decreases !== 1 ? 's' : ''}
                      </div>
                    )}
                    {pending > 0 && (
                      <div className="text-xs text-violet-500/70 dark:text-violet-400/60 border-t border-violet-100 dark:border-violet-900/30 pt-1 mt-1">
                        {pending} pending ({pendingDelta > 0 ? '+' : ''}{pendingDelta}h)
                      </div>
                    )}
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          {/* Running Net */}
          <Card className="hover-lift animate-scale-in border-l-4 border-l-blue-400 bg-blue-50/40 dark:bg-blue-950/10">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-semibold text-blue-700 dark:text-blue-400 flex items-center gap-1.5">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-sm">
                  <Minus className="w-3.5 h-3.5 text-white" />
                </div>
                Running Net
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {cumulativeKpiQuery.isLoading ? (
                <div className="h-8 bg-muted animate-pulse rounded" />
              ) : (() => {
                const net = cumKpi?.net ?? 0;
                const fmtNet = (n: number) => n === 0 ? '±0h/wk' : n > 0 ? `+${n}h/wk` : `${n}h/wk`;
                return (
                  <>
                    <div className={[
                      "text-2xl font-bold",
                      net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
                    ].join(' ')}>
                      {fmtNet(net)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {cumKpi?.cumulativeHoursHired ?? 0}h hired − {cumKpi?.cumulativeHoursLost ?? 0}h terminated
                    </div>
                    {(cumKpi?.availNetDelta ?? 0) !== 0 && (
                      <div className={`text-xs mt-0.5 font-medium ${(cumKpi?.availNetDelta ?? 0) > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        {(cumKpi?.availNetDelta ?? 0) > 0 ? '+' : ''}{cumKpi!.availNetDelta}h avail. changes
                      </div>
                    )}
                    {(cumKpi?.pipelineRawHours ?? 0) > 0 && (
                      <div className="text-xs mt-1 text-blue-500/70 dark:text-blue-400/60">
                        {cumKpi!.pipelineRawHours}h/wk in pipeline (not confirmed)
                      </div>
                    )}
                  </>
                );
              })()}
            </CardContent>
          </Card>

          {/* Risk */}
          <Card className={`hover-lift animate-scale-in border-l-4 ${cumKpi?.rag === 'red' ? 'border-l-red-500 bg-red-50/40 dark:bg-red-950/10' : cumKpi?.rag === 'amber' ? 'border-l-amber-400 bg-amber-50/40 dark:bg-amber-950/10' : 'border-l-emerald-400 bg-emerald-50/30 dark:bg-emerald-950/10'}`}>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className={`text-xs font-semibold flex items-center gap-1.5 ${cumKpi?.rag === 'red' ? 'text-red-700 dark:text-red-400' : cumKpi?.rag === 'amber' ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                <div className={`w-6 h-6 rounded-md bg-gradient-to-br ${ragBgClass(cumKpi?.rag ?? 'green')} flex items-center justify-center shadow-sm`}>
                  <AlertTriangle className="w-3.5 h-3.5 text-white" />
                </div>
                Risk
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {cumulativeKpiQuery.isLoading ? (
                <div className="h-8 bg-muted animate-pulse rounded" />
              ) : (
                <div className="mt-1">
                  <RagBadge rag={cumKpi?.rag ?? 'green'} />
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

        {/* ── Tabbed staff sections ──────────────────────────────────────────── */}
        <Card className="overflow-hidden border-0 shadow-2xl ring-1 ring-black/[0.07] dark:ring-white/[0.08]">
          {/* Tab bar */}
          <div className="flex border-b border-border bg-slate-50/80 dark:bg-slate-900/40 overflow-x-auto px-2 pt-2 gap-1">
            {([
              { id: 'joiners' as const, label: 'All Joiners', count: allJoiners.length,
                activeBg: 'bg-emerald-500', activeTabBg: 'bg-emerald-50 dark:bg-emerald-950/40', activeText: 'text-emerald-700 dark:text-emerald-300', activeBorder: 'border-emerald-500', countCls: 'bg-emerald-500 text-white',
                icon: <TrendingUp className="w-3 h-3" /> },
              { id: 'leavers' as const, label: 'All Leavers', count: allLeavers.length,
                activeBg: 'bg-red-500', activeTabBg: 'bg-red-50 dark:bg-red-950/40', activeText: 'text-red-700 dark:text-red-300', activeBorder: 'border-red-500', countCls: 'bg-red-500 text-white',
                icon: <TrendingDown className="w-3 h-3" /> },
              { id: 'avail-increase' as const, label: 'Avail. Increase', count: (availChangesQuery.data ?? []).filter(r => r.changeType === 'increase').length,
                activeBg: 'bg-teal-500', activeTabBg: 'bg-teal-50 dark:bg-teal-950/40', activeText: 'text-teal-700 dark:text-teal-300', activeBorder: 'border-teal-500', countCls: 'bg-teal-500 text-white',
                icon: <TrendingUp className="w-3 h-3" /> },
              { id: 'avail-decrease' as const, label: 'Avail. Decrease', count: (availChangesQuery.data ?? []).filter(r => r.changeType === 'decrease').length,
                activeBg: 'bg-amber-500', activeTabBg: 'bg-amber-50 dark:bg-amber-950/40', activeText: 'text-amber-700 dark:text-amber-300', activeBorder: 'border-amber-500', countCls: 'bg-amber-500 text-white',
                icon: <TrendingDown className="w-3 h-3" /> },
            ]).map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveStaffTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-all whitespace-nowrap ${
                  activeStaffTab === tab.id
                    ? `${tab.activeBorder} ${tab.activeText} ${tab.activeTabBg} shadow-sm`
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-white/60 dark:hover:bg-white/5'
                }`}
              >
                <div className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${activeStaffTab === tab.id ? tab.activeBg + ' text-white' : 'bg-muted-foreground/20 text-muted-foreground'}`}>
                  {tab.icon}
                </div>
                {tab.label}
                <span className={`inline-flex items-center justify-center rounded-full text-xs font-bold px-1.5 py-0.5 min-w-[20px] transition-colors ${activeStaffTab === tab.id ? tab.countCls : 'bg-muted text-muted-foreground'}`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* ─ Joiners panel ─────────────────────────────────────────────────── */}
          {activeStaffTab === 'joiners' && (
            <CardContent className="pt-0 px-0">
              {joinersQuery.isLoading ? (
                <div className="h-16 bg-muted animate-pulse rounded m-4" />
              ) : !pipelineJoiners.length && !hiredJoiners.length && !archivedJoiners.length ? (
                <p className="text-sm text-muted-foreground text-center py-8">No joiners recorded.</p>
              ) : (
                <div className="overflow-x-auto">
                  {pipelineJoiners.length > 0 && (
                  <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-emerald-50 to-transparent dark:from-emerald-900/20 dark:to-transparent border-b border-emerald-100 dark:border-emerald-900/30">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-md bg-emerald-500 flex items-center justify-center shadow-sm">
                        <TrendingUp className="w-3.5 h-3.5 text-white" />
                      </div>
                      <span className="text-sm font-bold text-emerald-800 dark:text-emerald-200">In Pipeline</span>
                      <span className="text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full">{pipelineJoiners.length}</span>
                    </div>
                    <span className="text-xs font-medium text-emerald-600/80 dark:text-emerald-400/70 pr-2">{rawWeeklyHours}h/wk expected</span>
                  </div>
                )}
                {pipelineJoiners.length > 0 && (
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-emerald-50/60 dark:bg-emerald-900/15 border-b border-emerald-100 dark:border-emerald-900/30">
                          <SortHead col="candidateName" label="Name" current={joinerSort} onSort={toggleJoinerSort} />
                          <SortHead col="employmentType" label="Type" current={joinerSort} onSort={toggleJoinerSort} />
                          <SortHead col="desiredWeeklyHours" label="Desired Hrs/wk" current={joinerSort} onSort={toggleJoinerSort} />
                          <TableHead>Contracted Hrs</TableHead>
                          <SortHead col="postcode" label="Postcode" current={joinerSort} onSort={toggleJoinerSort} />
                          <SortHead col="stage" label="Stage" current={joinerSort} onSort={toggleJoinerSort} />
                          <SortHead col="trainingDate" label="Training" current={joinerSort} onSort={toggleJoinerSort} />
                          {isScheduler && <TableHead className="text-right">Actions</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortBy(pipelineJoiners, joinerSort.col, joinerSort.dir).map(j => (
                          <TableRow key={j.id} className={`hover:bg-muted/30 transition-colors ${isStale14Days(j) ? "bg-red-50/60 dark:bg-red-950/20" : ""}`}>
                            <TableCell
                              className={`font-medium cursor-pointer select-none ${getGenderColorClass(j.gender ?? undefined)}`}
                              onDoubleClick={() => setAvailabilityPopupJoiner(j)}
                              title="Double-click to edit availability & notes"
                            >{j.candidateName}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="capitalize text-xs">{j.employmentType}</Badge>
                            </TableCell>
                            <TableCell>{j.desiredWeeklyHours === 0 ? <Badge variant="outline" className="text-xs text-indigo-600 border-indigo-200 bg-indigo-50">Bank</Badge> : `${j.desiredWeeklyHours}h`}</TableCell>
                            <TableCell>{j.contractedHours != null ? `${j.contractedHours}h` : '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{j.postcode || '—'}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1 flex-wrap">
                                {j.stage === 'Dropped' ? (
                                  <Badge className="text-xs bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">Dropped</Badge>
                                ) : (j.completedStages && j.completedStages.length > 0 ? j.completedStages : [j.stage])
                                  .filter(m => m !== 'Onboarding' && m !== 'Training Attended')
                                  .map(m => (
                                  <Badge key={m} className={[
                                    "text-xs",
                                    m === 'PVG' || m === 'REF1' || m === 'REF2'
                                      ? "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
                                      : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
                                  ].join(' ')}>{m}</Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell>
                              {(() => {
                                const days = (j.trainingDate ?? '').split(',').map(s => s.trim()).filter(Boolean);
                                return (
                                  <div className="flex flex-col gap-1">
                                    <span
                                      className="flex items-center gap-1"
                                      title={days.length > 0 ? `Days ${days.join(', ')} of 4 attended` : 'No training days attended yet'}
                                    >
                                      {[1,2,3,4].map(d => (
                                        <span
                                          key={d}
                                          className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${
                                            days.includes(String(d))
                                              ? 'bg-emerald-500 text-white'
                                              : 'bg-red-400 text-white'
                                          }`}
                                        >{d}</span>
                                      ))}
                                    </span>
                                    {isStale14Days(j) && (
                                      <Badge className="text-xs bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-700 gap-1 w-fit">
                                        <AlertTriangle className="w-3 h-3" /> Delay
                                      </Badge>
                                    )}
                                  </div>
                                );
                              })()}
                            </TableCell>
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
                    <div className="border-t-2 border-amber-200 dark:border-amber-800/50 bg-gradient-to-r from-amber-50 to-yellow-50/30 dark:from-amber-900/20 dark:to-yellow-900/10">
                      <div className="flex items-center justify-between px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-md bg-amber-400 flex items-center justify-center shadow-sm">
                            <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                          </div>
                          <span className="text-sm font-bold text-amber-800 dark:text-amber-200">Hired This Month</span>
                        </div>
                        <div className="flex items-center gap-3 pr-2">
                          <span className="text-xs font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full">{hiredJoiners.length} {hiredJoiners.length === 1 ? 'person' : 'people'}</span>
                          <span className="text-xs font-medium text-amber-600/80 dark:text-amber-400/70">{hiredJoiners.reduce((s, j) => s + (j.desiredWeeklyHours ?? 0), 0)}h/wk</span>
                        </div>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-amber-50/60 dark:bg-amber-900/15 border-b border-amber-100 dark:border-amber-900/30">
                            <TableHead>Name</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Desired Hrs/wk</TableHead>
                            <TableHead>Contracted Hrs</TableHead>
                            <TableHead>Postcode</TableHead>
                            <TableHead>Stage</TableHead>
                            {isScheduler && <TableHead className="text-right">Actions</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {hiredJoiners.map(j => (
                            <TableRow key={j.id}>
                              <TableCell
                                className={`font-medium cursor-pointer select-none ${getGenderColorClass(j.gender ?? undefined)}`}
                                onDoubleClick={() => setAvailabilityPopupJoiner(j)}
                                title="Double-click to edit availability & notes"
                              >{j.candidateName}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="capitalize text-xs">{j.employmentType}</Badge>
                              </TableCell>
                              <TableCell>{j.desiredWeeklyHours === 0 ? <Badge variant="outline" className="text-xs text-indigo-600 border-indigo-200 bg-indigo-50">Bank</Badge> : `${j.desiredWeeklyHours}h`}</TableCell>
                              <TableCell>{j.contractedHours != null ? `${j.contractedHours}h` : '—'}</TableCell>
                              <TableCell className="font-mono text-xs">{j.postcode || '—'}</TableCell>
                              <TableCell>
                                {j.stage ? <Badge className="text-xs capitalize">{j.stage}</Badge> : '—'}
                              </TableCell>
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
                    </div>
                  )}

                  {archivedJoiners.length > 0 && (() => {
                    const groups: Record<string, typeof archivedJoiners> = {};
                    for (const j of archivedJoiners) {
                      const key = (j.hiredAt ?? '').slice(0, 7);
                      if (!key) continue;
                      (groups[key] ??= []).push(j);
                    }
                    const sortedGroups = Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
                    return (
                      <>
                        {sortedGroups.map(([monthKey, rows]) => {
                          const label = new Date(`${monthKey}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
                          const totalHrs = rows.reduce((s, j) => s + (j.desiredWeeklyHours ?? 0), 0);
                          const isOpen = expandedJoinerMonths.has(monthKey);
                          return (
                            <div key={monthKey} className="border-t border-emerald-200 dark:border-emerald-800/40 bg-emerald-50/20 dark:bg-emerald-900/5">
                              <button
                                onClick={() => toggleJoinerMonth(monthKey)}
                                className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-emerald-50/60 dark:hover:bg-emerald-900/10 transition-colors text-left"
                              >
                                <Archive className="w-4 h-4 text-emerald-400 dark:text-emerald-500 shrink-0" />
                                <span className="text-xs font-semibold text-emerald-600/70 dark:text-emerald-400/70 uppercase tracking-wide flex-1">
                                  {label} — {totalHrs}h/wk · {rows.length} {rows.length === 1 ? 'person' : 'people'} hired
                                </span>
                                {isOpen
                                  ? <ChevronUp className="w-3.5 h-3.5 text-emerald-400 dark:text-emerald-500 shrink-0" />
                                  : <ChevronDown className="w-3.5 h-3.5 text-emerald-400 dark:text-emerald-500 shrink-0" />
                                }
                              </button>
                              {isOpen && (
                                <Table>
                                  <TableHeader>
                                    <TableRow className="bg-emerald-100/30 dark:bg-emerald-900/10">
                                      <TableHead>Name</TableHead>
                                      <TableHead>Status</TableHead>
                                      <TableHead>Type</TableHead>
                                      <TableHead>Desired Hrs/wk</TableHead>
                                      <TableHead>Contracted Hrs</TableHead>
                                      <TableHead>Hired</TableHead>
                                      {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {rows.map(j => (
                                      <TableRow key={j.id} className="opacity-60 hover:opacity-100 transition-opacity">
                                        <TableCell
                                          className={`font-medium cursor-pointer select-none ${getGenderColorClass(j.gender ?? undefined)}`}
                                          onDoubleClick={() => setAvailabilityPopupJoiner(j)}
                                          title="Double-click to edit availability & notes"
                                        >{j.candidateName}</TableCell>
                                        <TableCell>
                                          <Badge className="text-xs bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800">Hired</Badge>
                                        </TableCell>
                                        <TableCell>
                                          <Badge variant="outline" className="capitalize text-xs">{j.employmentType}</Badge>
                                        </TableCell>
                                        <TableCell>{j.desiredWeeklyHours === 0 ? <Badge variant="outline" className="text-xs text-indigo-600 border-indigo-200 bg-indigo-50">Bank</Badge> : `${j.desiredWeeklyHours}h`}</TableCell>
                                        <TableCell>{j.contractedHours != null ? `${j.contractedHours}h` : '—'}</TableCell>
                                        <TableCell>{formatDate(j.hiredAt)}</TableCell>
                                        {isAdmin && (
                                          <TableCell className="text-right">
                                            <div className="flex items-center justify-end gap-1">
                                              <Button size="icon" variant="ghost" className="h-7 w-7"
                                                onClick={() => { setEditingJoiner(j); setJoinerModalOpen(true); }}>
                                                <Pencil className="w-3.5 h-3.5" />
                                              </Button>
                                              <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-700"
                                                onClick={() => setHardDeletingJoinerId(j.id)}>
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
                            </div>
                          );
                        })}
                      </>
                    );
                  })()}
                </div>
              )}
            </CardContent>
          )}

          {/* ─ Availability Increase panel ───────────────────────────────────── */}
          {activeStaffTab === 'avail-increase' && (() => {
            const increases = (availChangesQuery.data ?? []).filter(r => r.changeType === 'increase');
            const totalIncrease = increases.reduce((s, r) => s + ((r.newHours ?? 0) - (r.previousHours ?? 0)), 0);
            return (
              <CardContent className="pt-0 px-0">
                  {availChangesQuery.isLoading ? (
                    <div className="h-16 bg-muted animate-pulse rounded m-4" />
                  ) : increases.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-3">
                      <div className="w-10 h-10 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
                        <TrendingUp className="w-5 h-5 text-teal-500" />
                      </div>
                      <p className="text-sm text-muted-foreground">No availability increases recorded yet.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-teal-50 to-transparent dark:from-teal-900/20 dark:to-transparent border-b border-teal-100 dark:border-teal-900/30">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-md bg-teal-500 flex items-center justify-center shadow-sm">
                            <TrendingUp className="w-3.5 h-3.5 text-white" />
                          </div>
                          <span className="text-sm font-bold text-teal-800 dark:text-teal-200">Availability Increases</span>
                          <span className="text-xs font-semibold bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 px-2 py-0.5 rounded-full">{increases.length}</span>
                        </div>
                        {totalIncrease > 0 && <span className="text-xs font-medium text-teal-600/80 dark:text-teal-400/70 pr-2">+{Math.round(totalIncrease * 10) / 10}h/wk net gain</span>}
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-teal-50/60 dark:bg-teal-900/15 border-b border-teal-100 dark:border-teal-900/30">
                            <TableHead>Name</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Prev Hrs</TableHead>
                            <TableHead>New Hrs</TableHead>
                            <TableHead>Effective</TableHead>
                            <TableHead>Notes</TableHead>
                            {isScheduler && <TableHead className="text-right">Actions</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {increases.map(r => (
                            <TableRow key={r.id} className="text-sm">
                              <TableCell className="font-medium">{r.employeeName}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="capitalize text-xs">{r.employmentType}</Badge>
                              </TableCell>
                              <TableCell>{r.previousHours != null ? `${r.previousHours}h` : '—'}</TableCell>
                              <TableCell>
                                <span className="text-emerald-700 dark:text-emerald-400 font-semibold">{r.newHours}h</span>
                              </TableCell>
                              <TableCell>{formatDate(r.effectiveDate)}</TableCell>
                              <TableCell className="max-w-[150px] truncate text-muted-foreground">{r.notes || '—'}</TableCell>
                              {isScheduler && (
                                <TableCell className="text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <Button size="icon" variant="ghost" className="h-7 w-7"
                                      onClick={() => { setAvailChangeType('increase'); setEditingAvailChange(r); setAvailChangeModalOpen(true); }}>
                                      <Pencil className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-700"
                                      onClick={() => setDeletingAvailChangeId(r.id)}>
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                  </div>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
            );
          })()}

          {/* ─ Leavers panel ─────────────────────────────────────────────────── */}
          {activeStaffTab === 'leavers' && (
            <CardContent className="pt-0 px-0">
              {leaversQuery.isLoading ? (
                <div className="h-16 bg-muted animate-pulse rounded m-4" />
              ) : !leaversQuery.data?.length ? (
                <p className="text-sm text-muted-foreground text-center py-8">No active leavers recorded.</p>
              ) : (
                <div className="overflow-x-auto">
                  {/* On-notice leavers (still working) */}
                  {sortBy(onNotice, leaverSort.col, leaverSort.dir).length > 0 && (
                    <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-amber-50 to-transparent dark:from-amber-900/20 dark:to-transparent border-b border-amber-100 dark:border-amber-900/30">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md bg-amber-500 flex items-center justify-center shadow-sm">
                          <TrendingDown className="w-3.5 h-3.5 text-white" />
                        </div>
                        <span className="text-sm font-bold text-amber-800 dark:text-amber-200">On Notice</span>
                        <span className="text-xs font-semibold bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full">{onNotice.length}</span>
                      </div>
                      <span className="text-xs font-medium text-amber-600/80 dark:text-amber-400/70 pr-2">{hoursOnNotice}h/wk at risk</span>
                    </div>
                  )}
                  {sortBy(onNotice, leaverSort.col, leaverSort.dir).length > 0 && (
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-amber-50/60 dark:bg-amber-900/15 border-b border-amber-100 dark:border-amber-900/30">
                          <SortHead col="employeeName" label="Name" current={leaverSort} onSort={toggleLeaverSort} />
                          <TableHead>Status</TableHead>
                          <TableHead>Emp No</TableHead>
                          <SortHead col="employmentType" label="Type" current={leaverSort} onSort={toggleLeaverSort} />
                          <SortHead col="weeklyHours" label="Desired Hrs/wk" current={leaverSort} onSort={toggleLeaverSort} />
                          <TableHead>Contracted Hrs</TableHead>
                          <TableHead>Postcode</TableHead>
                          <SortHead col="firstDayOfNotice" label="Day of Notice" current={leaverSort} onSort={toggleLeaverSort} />
                          <SortHead col="lastWorkingDay" label="Termination Day" current={leaverSort} onSort={toggleLeaverSort} />
                          <TableHead>Notes</TableHead>
                          {isScheduler && <TableHead className="text-right">Actions</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortBy(onNotice, leaverSort.col, leaverSort.dir).map(l => (
                          <TableRow key={l.id}>
                            <TableCell className={`font-medium ${getGenderColorClass(l.gender ?? undefined)}`}>{l.employeeName}</TableCell>
                            <TableCell>
                              <Badge className="text-xs bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800">On Notice</Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs">{l.employeeNo || '—'}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="capitalize text-xs">{l.employmentType}</Badge>
                            </TableCell>
                            <TableCell>{l.weeklyHours === 0 ? <Badge variant="outline" className="text-xs text-indigo-600 border-indigo-200 bg-indigo-50">Bank</Badge> : `${l.weeklyHours}h`}</TableCell>
                            <TableCell>{l.contractedHours != null ? `${l.contractedHours}h` : '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{l.postcode || '—'}</TableCell>
                            <TableCell>{l.firstDayOfNotice ? formatDate(l.firstDayOfNotice) : '—'}</TableCell>
                            <TableCell>{formatDate(l.lastWorkingDay)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[200px] whitespace-pre-wrap">{l.notes || '—'}</TableCell>
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
                  )}

                  {/* Already terminated strip */}
                  {alreadyGone.length > 0 && (
                    <div className="border-t-2 border-red-200 dark:border-red-800/50 bg-gradient-to-r from-red-50 to-rose-50/20 dark:from-red-900/20 dark:to-rose-900/10">
                      <div className="flex items-center justify-between px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-md bg-red-500 flex items-center justify-center shadow-sm">
                            <UserMinus className="w-3.5 h-3.5 text-white" />
                          </div>
                          <span className="text-sm font-bold text-red-800 dark:text-red-200">Already Terminated</span>
                        </div>
                        <div className="flex items-center gap-3 pr-2">
                          <span className="text-xs font-semibold bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 px-2 py-0.5 rounded-full">{alreadyGone.length} {alreadyGone.length === 1 ? 'person' : 'people'}</span>
                          <span className="text-xs font-medium text-red-600/80 dark:text-red-400/70">{alreadyGone.reduce((s, l) => s + (l.weeklyHours ?? 0), 0)}h/wk lost</span>
                        </div>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-red-50/60 dark:bg-red-900/15 border-b border-red-100 dark:border-red-900/30">
                            <TableHead>Name</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Emp No</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Desired Hrs/wk</TableHead>
                            <TableHead>Contracted Hrs</TableHead>
                            <TableHead>Postcode</TableHead>
                            <TableHead>Day of Notice</TableHead>
                            <TableHead>Termination Day</TableHead>
                            <TableHead>Notes</TableHead>
                            {isScheduler && <TableHead className="text-right">Actions</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {alreadyGone.map(l => (
                            <TableRow key={l.id}>
                              <TableCell className={`font-medium ${getGenderColorClass(l.gender ?? undefined)}`}>{l.employeeName}</TableCell>
                              <TableCell>
                                <Badge className="text-xs bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800">Terminated</Badge>
                              </TableCell>
                              <TableCell className="font-mono text-xs">{l.employeeNo || '—'}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="capitalize text-xs">{l.employmentType}</Badge>
                              </TableCell>
                              <TableCell>{l.weeklyHours === 0 ? <Badge variant="outline" className="text-xs text-indigo-600 border-indigo-200 bg-indigo-50">Bank</Badge> : `${l.weeklyHours}h`}</TableCell>
                              <TableCell>{l.contractedHours != null ? `${l.contractedHours}h` : '—'}</TableCell>
                              <TableCell className="font-mono text-xs">{l.postcode || '—'}</TableCell>
                              <TableCell>{l.firstDayOfNotice ? formatDate(l.firstDayOfNotice) : '—'}</TableCell>
                              <TableCell>{formatDate(l.lastWorkingDay)}</TableCell>
                              <TableCell className="text-xs text-muted-foreground max-w-[200px] whitespace-pre-wrap">{l.notes || '—'}</TableCell>
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
                    </div>
                  )}

                  {onNotice.length === 0 && alreadyGone.length === 0 && terminatedLeavers.length === 0 && pastMonthActiveLeavers.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">No leavers recorded.</p>
                  )}

                  {/* Past months — terminated (closed month archives, collapsible) */}
                  {(terminatedLeavers.length > 0 || pastMonthActiveLeavers.length > 0) && (() => {
                    const archiveRows = [...terminatedLeavers, ...pastMonthActiveLeavers];
                    const groups: Record<string, typeof archiveRows> = {};
                    for (const l of archiveRows) {
                      const key = (l.lastWorkingDay ?? '').slice(0, 7);
                      if (!key) continue;
                      (groups[key] ??= []).push(l);
                    }
                    const sortedGroups = Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
                    return (
                      <>
                        {sortedGroups.map(([monthKey, rows]) => {
                          const label = new Date(`${monthKey}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
                          const totalHrs = rows.reduce((s, l) => s + (l.weeklyHours ?? 0), 0);
                          const isOpen = expandedLeaverMonths.has(monthKey);
                          return (
                            <div key={monthKey} className="border-t border-red-200 dark:border-red-800/40 bg-red-50/20 dark:bg-red-900/5">
                              <button
                                onClick={() => toggleLeaverMonth(monthKey)}
                                className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-red-50/60 dark:hover:bg-red-900/10 transition-colors text-left"
                              >
                                <Archive className="w-4 h-4 text-red-400 dark:text-red-500 shrink-0" />
                                <span className="text-xs font-semibold text-red-600/70 dark:text-red-400/70 uppercase tracking-wide flex-1">
                                  {label} — {totalHrs}h/wk · {rows.length} {rows.length === 1 ? 'person' : 'people'} terminated
                                </span>
                                {isOpen
                                  ? <ChevronUp className="w-3.5 h-3.5 text-red-400 dark:text-red-500 shrink-0" />
                                  : <ChevronDown className="w-3.5 h-3.5 text-red-400 dark:text-red-500 shrink-0" />
                                }
                              </button>
                              {isOpen && (
                                <Table>
                                  <TableHeader>
                                    <TableRow className="bg-red-100/30 dark:bg-red-900/10">
                                      <TableHead>Name</TableHead>
                                      <TableHead>Emp No</TableHead>
                                      <TableHead>Type</TableHead>
                                      <TableHead>Desired Hrs/wk</TableHead>
                                      <TableHead>Contracted Hrs</TableHead>
                                      <TableHead>Termination Day</TableHead>
                                      <TableHead>Notes</TableHead>
                                      {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {rows.map(l => (
                                      <TableRow key={l.id} className="opacity-60 hover:opacity-100 transition-opacity">
                                        <TableCell className="font-medium">{l.employeeName}</TableCell>
                                        <TableCell className="font-mono text-xs">{l.employeeNo || '—'}</TableCell>
                                        <TableCell>
                                          <Badge variant="outline" className="capitalize text-xs">{l.employmentType}</Badge>
                                        </TableCell>
                                        <TableCell>{l.weeklyHours === 0 ? <Badge variant="outline" className="text-xs text-indigo-600 border-indigo-200 bg-indigo-50">Bank</Badge> : `${l.weeklyHours}h`}</TableCell>
                                        <TableCell>{l.contractedHours != null ? `${l.contractedHours}h` : '—'}</TableCell>
                                        <TableCell>{formatDate(l.lastWorkingDay)}</TableCell>
                                        <TableCell className="text-xs text-muted-foreground max-w-[200px] whitespace-pre-wrap">{l.notes || '—'}</TableCell>
                                        {isAdmin && (
                                          <TableCell className="text-right">
                                            <div className="flex items-center justify-end gap-1">
                                              <Button size="icon" variant="ghost" className="h-7 w-7"
                                                onClick={() => { setEditingLeaver(l); setLeaverModalOpen(true); }}>
                                                <Pencil className="w-3.5 h-3.5" />
                                              </Button>
                                              <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-700"
                                                onClick={() => setHardDeletingLeaverId(l.id)}>
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
                            </div>
                          );
                        })}
                      </>
                    );
                  })()}
                </div>
              )}
            </CardContent>
          )}

          {/* ─ Availability Decrease panel ───────────────────────────────────── */}
          {activeStaffTab === 'avail-decrease' && (() => {
            const decreases = (availChangesQuery.data ?? []).filter(r => r.changeType === 'decrease');
            const totalDecrease = decreases.reduce((s, r) => s + ((r.previousHours ?? 0) - (r.newHours ?? 0)), 0);
            return (
              <CardContent className="pt-0 px-0">
                  {availChangesQuery.isLoading ? (
                    <div className="h-16 bg-muted animate-pulse rounded m-4" />
                  ) : decreases.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-3">
                      <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                        <TrendingDown className="w-5 h-5 text-amber-500" />
                      </div>
                      <p className="text-sm text-muted-foreground">No availability decreases recorded yet.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-orange-50 to-transparent dark:from-orange-900/20 dark:to-transparent border-b border-orange-100 dark:border-orange-900/30">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-md bg-orange-500 flex items-center justify-center shadow-sm">
                            <TrendingDown className="w-3.5 h-3.5 text-white" />
                          </div>
                          <span className="text-sm font-bold text-orange-800 dark:text-orange-200">Availability Decreases</span>
                          <span className="text-xs font-semibold bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded-full">{decreases.length}</span>
                        </div>
                        {totalDecrease > 0 && <span className="text-xs font-medium text-orange-600/80 dark:text-orange-400/70 pr-2">−{Math.round(totalDecrease * 10) / 10}h/wk net loss</span>}
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-orange-50/60 dark:bg-orange-900/15 border-b border-orange-100 dark:border-orange-900/30">
                            <TableHead>Name</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Prev Hrs</TableHead>
                            <TableHead>New Hrs</TableHead>
                            <TableHead>Effective</TableHead>
                            <TableHead>Notes</TableHead>
                            {isScheduler && <TableHead className="text-right">Actions</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {decreases.map(r => (
                            <TableRow key={r.id} className="text-sm">
                              <TableCell className="font-medium">{r.employeeName}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="capitalize text-xs">{r.employmentType}</Badge>
                              </TableCell>
                              <TableCell>{r.previousHours != null ? `${r.previousHours}h` : '—'}</TableCell>
                              <TableCell>
                                <span className="text-amber-700 dark:text-amber-400 font-semibold">{r.newHours}h</span>
                              </TableCell>
                              <TableCell>{formatDate(r.effectiveDate)}</TableCell>
                              <TableCell className="max-w-[150px] truncate text-muted-foreground">{r.notes || '—'}</TableCell>
                              {isScheduler && (
                                <TableCell className="text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <Button size="icon" variant="ghost" className="h-7 w-7"
                                      onClick={() => { setAvailChangeType('decrease'); setEditingAvailChange(r); setAvailChangeModalOpen(true); }}>
                                      <Pencil className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-700"
                                      onClick={() => setDeletingAvailChangeId(r.id)}>
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                  </div>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
            );
          })()}

        </Card>{/* end tabbed staff sections */}

      </div>

      {/* Availability Change modal */}
      {branchId && (
        <AvailabilityChangeModal
          open={availChangeModalOpen}
          onClose={() => { setAvailChangeModalOpen(false); setEditingAvailChange(null); }}
          editing={editingAvailChange}
          changeType={availChangeType}
          branchId={branchId}
        />
      )}

      {/* Delete availability change confirm */}
      <AlertDialog open={!!deletingAvailChangeId} onOpenChange={v => { if (!v) setDeletingAvailChangeId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this record?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the availability change record. You can re-add it at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingAvailChangeId && deleteAvailChangeMutation.mutate(deletingAvailChangeId)}
              className="bg-red-600 hover:bg-red-700"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      {/* Availability & notes popup */}
      <AvailabilityNotesPopup
        open={!!availabilityPopupJoiner}
        joiner={availabilityPopupJoiner}
        branchId={selectedBranchId ?? ''}
        onClose={() => setAvailabilityPopupJoiner(null)}
      />

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

      {/* Hard delete leaver confirm (admin only — past records) */}
      <AlertDialog open={!!hardDeletingLeaverId} onOpenChange={v => { if (!v) setHardDeletingLeaverId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete this leaver record?</AlertDialogTitle>
            <AlertDialogDescription>
              This will <strong>permanently remove</strong> the record from the database. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => hardDeletingLeaverId && hardDeleteLeaverMutation.mutate(hardDeletingLeaverId)}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Hard delete joiner confirm (admin only — past records) */}
      <AlertDialog open={!!hardDeletingJoinerId} onOpenChange={v => { if (!v) setHardDeletingJoinerId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete this joiner record?</AlertDialogTitle>
            <AlertDialogDescription>
              This will <strong>permanently remove</strong> the record from the database. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => hardDeletingJoinerId && hardDeleteJoinerMutation.mutate(hardDeletingJoinerId)}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete permanently
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
        allLeavers={allLeavers}
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
  allLeavers,
}: {
  open: boolean;
  onClose: () => void;
  branchId: string;
  monthlyData: MonthlyData | null;
  isLoading: boolean;
  isScheduler: boolean;
  hiredJoiners: Joiner[];
  allLeavers: Leaver[];
}) {
  const { toast } = useToast();

  const [editingRow, setEditingRow] = useState<{ year: number; month: number } | null>(null);
  const [editValues, setEditValues] = useState({ hoursIn: 0, headsIn: 0, hoursOut: 0, headsOut: 0 });

  const reopenMonthMutation = useMutation({
    mutationFn: async ({ year, month }: { year: number; month: number }) => {
      const res = await fetch(
        toAbsoluteUrl(`/api/capacity-outlook/monthly/${year}/${month}?branchId=${branchId}`),
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to reopen month');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook/monthly'] });
      toast({ title: "Month reopened", description: "Now showing as Live." });
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Error", description: err.message });
    },
  });

  const updateSnapshotMutation = useMutation({
    mutationFn: async ({ year, month, values }: { year: number; month: number; values: typeof editValues }) => {
      const res = await fetch(
        toAbsoluteUrl(`/api/capacity-outlook/monthly/${year}/${month}?branchId=${branchId}`),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(values),
        },
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to update snapshot');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/capacity-outlook/monthly'] });
      setEditingRow(null);
      toast({ title: "Snapshot updated" });
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Error", description: err.message });
    },
  });


  type MonthRow = {
    year: number; month: number;
    hoursIn: number; headsIn: number; hoursOut: number; headsOut: number;
    femaleHoursIn?: number | null; maleHoursIn?: number | null;
    femaleHeadsIn?: number | null; maleHeadsIn?: number | null;
    femaleHoursOut?: number | null; maleHoursOut?: number | null;
    femaleHeadsOut?: number | null; maleHeadsOut?: number | null;
    isLive: boolean; isClosed: boolean; isEmpty: boolean;
  };

  // Build rows: all months from Jan of current year to current month (newest first),
  // then any closed snapshots from earlier years that exist in the DB.
  const rows = useMemo((): MonthRow[] => {
    if (!monthlyData) return [];
    const { snapshots, live, currentYear, currentMonth } = monthlyData;

    const result: MonthRow[] = [];

    // Current month (top of list)
    const closedCurrent = snapshots.find(s => s.year === currentYear && s.month === currentMonth);
    result.push(closedCurrent
      ? { ...closedCurrent, isLive: false, isClosed: true, isEmpty: false }
      : { year: currentYear, month: currentMonth, hoursIn: live.hoursIn, headsIn: live.headsIn, hoursOut: live.hoursOut, headsOut: live.headsOut, isLive: true, isClosed: false, isEmpty: false },
    );

    // Jan → month-1 of current year (newest first) — snapshot or blank editable row
    for (let m = currentMonth - 1; m >= 1; m--) {
      const existing = snapshots.find(s => s.year === currentYear && s.month === m);
      result.push(existing
        ? { ...existing, isLive: false, isClosed: true, isEmpty: false }
        : { year: currentYear, month: m, hoursIn: 0, headsIn: 0, hoursOut: 0, headsOut: 0, isLive: false, isClosed: false, isEmpty: true },
      );
    }

    // Any closed snapshots from previous years (already in DB)
    snapshots
      .filter(s => s.year < currentYear)
      .sort((a, b) => b.year !== a.year ? b.year - a.year : b.month - a.month)
      .forEach(s => result.push({ ...s, isLive: false, isClosed: true, isEmpty: false }));

    return result;
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
                  {isScheduler && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const isCurrentMonth = row.year === monthlyData?.currentYear && row.month === monthlyData?.currentMonth;
                  const isLive = 'isLive' in row && row.isLive;
                  const isClosed = 'isClosed' in row && row.isClosed;
                  const isEmpty = row.isEmpty;
                  const isEditing = editingRow?.year === row.year && editingRow?.month === row.month;
                  const canEdit = isScheduler && (isClosed || isEmpty);
                  const displayHoursIn  = isEditing ? editValues.hoursIn  : row.hoursIn;
                  const displayHeadsIn  = isEditing ? editValues.headsIn  : row.headsIn;
                  const displayHoursOut = isEditing ? editValues.hoursOut : row.hoursOut;
                  const displayHeadsOut = isEditing ? editValues.headsOut : row.headsOut;
                  const net = Math.round((displayHoursIn - displayHoursOut) * 10) / 10;

                  // Gender split — live row: compute from individual records; closed row: use stored snapshot fields
                  const currentMonthLeavers = allLeavers.filter(l => {
                    if (!l.lastWorkingDay) return false;
                    const d = new Date(l.lastWorkingDay + 'T00:00:00Z');
                    return d.getUTCFullYear() === row.year && d.getUTCMonth() + 1 === row.month;
                  });
                  const femaleHiresH: number = isLive
                    ? Math.round(hiredJoiners.filter(j => j.gender?.toLowerCase() === 'female').reduce((s, j) => s + (j.desiredWeeklyHours ?? 0), 0) * 10) / 10
                    : (row.femaleHoursIn ?? 0);
                  const maleHiresH: number = isLive
                    ? Math.round(hiredJoiners.filter(j => j.gender?.toLowerCase() === 'male').reduce((s, j) => s + (j.desiredWeeklyHours ?? 0), 0) * 10) / 10
                    : (row.maleHoursIn ?? 0);
                  const femaleLeaversH: number = isLive
                    ? Math.round(currentMonthLeavers.filter(l => l.gender?.toLowerCase() === 'female').reduce((s, l) => s + (l.weeklyHours ?? 0), 0) * 10) / 10
                    : (row.femaleHoursOut ?? 0);
                  const maleLeaversH: number = isLive
                    ? Math.round(currentMonthLeavers.filter(l => l.gender?.toLowerCase() === 'male').reduce((s, l) => s + (l.weeklyHours ?? 0), 0) * 10) / 10
                    : (row.maleHoursOut ?? 0);
                  const femaleHiresCount: number = isLive
                    ? hiredJoiners.filter(j => j.gender?.toLowerCase() === 'female').length
                    : (row.femaleHeadsIn ?? 0);
                  const maleHiresCount: number = isLive
                    ? hiredJoiners.filter(j => j.gender?.toLowerCase() === 'male').length
                    : (row.maleHeadsIn ?? 0);
                  const femaleLeaversCount: number = isLive
                    ? currentMonthLeavers.filter(l => l.gender?.toLowerCase() === 'female').length
                    : (row.femaleHeadsOut ?? 0);
                  const maleLeaversCount: number = isLive
                    ? currentMonthLeavers.filter(l => l.gender?.toLowerCase() === 'male').length
                    : (row.maleHeadsOut ?? 0);
                  const femaleNet = Math.round((femaleHiresH - femaleLeaversH) * 10) / 10;
                  const maleNet   = Math.round((maleHiresH   - maleLeaversH)   * 10) / 10;
                  // Show gender split if live (always has data) or closed with stored gender data
                  const hasStoredGender = !isLive && isClosed && (
                    row.femaleHoursIn != null || row.maleHoursIn != null ||
                    row.femaleHoursOut != null || row.maleHoursOut != null
                  );
                  const showGenderSplit = isLive || hasStoredGender;

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

                      {/* In h/wk */}
                      <TableCell>
                        {isEditing ? (
                          <input
                            type="number" min={0} step={0.5}
                            value={editValues.hoursIn}
                            onChange={e => setEditValues(v => ({ ...v, hoursIn: parseFloat(e.target.value) || 0 }))}
                            className="w-16 border border-border rounded px-1.5 py-0.5 text-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-400"
                          />
                        ) : showGenderSplit ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="font-bold text-pink-500 dark:text-pink-400">{femaleHiresH > 0 ? `+${femaleHiresH}h` : '—'}</span>
                            <span className="font-bold text-blue-500 dark:text-blue-400">{maleHiresH > 0 ? `+${maleHiresH}h` : '—'}</span>
                          </div>
                        ) : (
                          <span className="font-semibold text-emerald-700 dark:text-emerald-400">{displayHoursIn > 0 ? `+${displayHoursIn}h` : '—'}</span>
                        )}
                      </TableCell>

                      {/* Hires */}
                      <TableCell>
                        {isEditing ? (
                          <input
                            type="number" min={0} step={1}
                            value={editValues.headsIn}
                            onChange={e => setEditValues(v => ({ ...v, headsIn: parseInt(e.target.value) || 0 }))}
                            className="w-14 border border-border rounded px-1.5 py-0.5 text-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-400"
                          />
                        ) : showGenderSplit ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="font-bold text-pink-500 dark:text-pink-400">{femaleHiresCount || '—'}</span>
                            <span className="font-bold text-blue-500 dark:text-blue-400">{maleHiresCount || '—'}</span>
                          </div>
                        ) : (
                          <span className="text-emerald-600 dark:text-emerald-400">{displayHeadsIn > 0 ? displayHeadsIn : '—'}</span>
                        )}
                      </TableCell>

                      {/* Out h/wk */}
                      <TableCell>
                        {isEditing ? (
                          <input
                            type="number" min={0} step={0.5}
                            value={editValues.hoursOut}
                            onChange={e => setEditValues(v => ({ ...v, hoursOut: parseFloat(e.target.value) || 0 }))}
                            className="w-16 border border-border rounded px-1.5 py-0.5 text-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-red-400"
                          />
                        ) : showGenderSplit ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="font-bold text-pink-500 dark:text-pink-400">{femaleLeaversH > 0 ? `${femaleLeaversH}h` : '—'}</span>
                            <span className="font-bold text-blue-500 dark:text-blue-400">{maleLeaversH > 0 ? `${maleLeaversH}h` : '—'}</span>
                          </div>
                        ) : (
                          <span className="font-semibold text-red-600 dark:text-red-400">{displayHoursOut > 0 ? `${displayHoursOut}h` : '—'}</span>
                        )}
                      </TableCell>

                      {/* Leavers */}
                      <TableCell>
                        {isEditing ? (
                          <input
                            type="number" min={0} step={1}
                            value={editValues.headsOut}
                            onChange={e => setEditValues(v => ({ ...v, headsOut: parseInt(e.target.value) || 0 }))}
                            className="w-14 border border-border rounded px-1.5 py-0.5 text-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-red-400"
                          />
                        ) : showGenderSplit ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="font-bold text-pink-500 dark:text-pink-400">{femaleLeaversCount || '—'}</span>
                            <span className="font-bold text-blue-500 dark:text-blue-400">{maleLeaversCount || '—'}</span>
                          </div>
                        ) : (
                          <span className="text-red-500 dark:text-red-400">{displayHeadsOut > 0 ? displayHeadsOut : '—'}</span>
                        )}
                      </TableCell>

                      {/* Net */}
                      <TableCell>
                        {showGenderSplit ? (
                          <div className="flex flex-col gap-0.5">
                            <span className={`font-bold ${femaleNet > 0 ? 'text-pink-500 dark:text-pink-400' : femaleNet < 0 ? 'text-pink-700 dark:text-pink-300' : 'text-pink-400'}`}>
                              {femaleNet === 0 ? '±0h' : femaleNet > 0 ? `+${femaleNet}h` : `${femaleNet}h`}
                            </span>
                            <span className={`font-bold ${maleNet > 0 ? 'text-blue-500 dark:text-blue-400' : maleNet < 0 ? 'text-blue-700 dark:text-blue-300' : 'text-blue-400'}`}>
                              {maleNet === 0 ? '±0h' : maleNet > 0 ? `+${maleNet}h` : `${maleNet}h`}
                            </span>
                          </div>
                        ) : (
                          <span className={[
                            "font-semibold",
                            net > 0 ? "text-emerald-600 dark:text-emerald-400"
                            : net < 0 ? "text-red-600 dark:text-red-400"
                            : "text-muted-foreground",
                          ].join(' ')}>
                            {net === 0 ? '±0h' : net > 0 ? `+${net}h` : `${net}h`}
                          </span>
                        )}
                      </TableCell>

                      {/* Edit / Save / Cancel */}
                      {isScheduler && (
                        <TableCell className="text-right py-1">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm" variant="default"
                                className="h-7 px-2 text-xs"
                                disabled={updateSnapshotMutation.isPending}
                                onClick={() => updateSnapshotMutation.mutate({ year: row.year, month: row.month, values: editValues })}
                              >
                                {updateSnapshotMutation.isPending ? 'Saving…' : 'Save'}
                              </Button>
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={() => setEditingRow(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              {canEdit && (
                                <Button
                                  size="icon"
                                  variant={isEmpty ? "outline" : "ghost"}
                                  className={isEmpty ? "h-7 w-7 border-dashed text-muted-foreground hover:text-foreground" : "h-7 w-7"}
                                  onClick={() => {
                                    setEditingRow({ year: row.year, month: row.month });
                                    setEditValues({ hoursIn: row.hoursIn, headsIn: row.headsIn, hoursOut: row.hoursOut, headsOut: row.headsOut });
                                  }}
                                >
                                  {isEmpty ? <Plus className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
                                </Button>
                              )}
                              {isClosed && (
                                <Button
                                  size="icon" variant="ghost"
                                  className="h-7 w-7 text-muted-foreground hover:text-amber-600"
                                  title="Reopen month"
                                  disabled={reopenMonthMutation.isPending}
                                  onClick={() => reopenMonthMutation.mutate({ year: row.year, month: row.month })}
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </Button>
                              )}
                            </div>
                          )}
                        </TableCell>
                      )}
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
                        <TableCell className={`text-xs font-medium py-2 ${getGenderColorClass(j.gender ?? undefined)}`}>{j.candidateName}</TableCell>
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
