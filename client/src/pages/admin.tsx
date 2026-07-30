import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import {
  Users, Plus, Edit2, UserX, UserCheck, KeyRound, ClipboardList,
  Search, Shield, ChevronDown, X, Check, AlertCircle, RefreshCw, ArrowLeft,
  Bug, MessageSquare, CalendarClock, Play, CheckCircle2, Mail, Trash2, MapPin,
  Megaphone, Send, Eye, EyeOff, Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  admin:      { label: 'Administrator', color: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
  scheduler:  { label: 'Scheduler',     color: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  viewer:     { label: 'Viewer',        color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
};

const ACTION_LABELS: Record<string, string> = {
  LOGIN: 'Signed in',
  LOGOUT: 'Signed out',
  USER_CREATED: 'User created',
  USER_UPDATED: 'User updated',
  SCHEDULE_SAVED: 'Schedule saved',
  SCHEDULE_GENERATED: 'Schedule generated',
  VISIT_REASSIGNED: 'Visit reassigned',
};

type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  isActive: number;
  createdAt: string;
  branches: Array<{ id: string; name: string; displayName: string }>;
};

type AuditLog = {
  id: string;
  userId: string | null;
  userEmail: string | null;
  branchId: string | null;
  action: string;
  detail: string | null;
  timestamp: string;
};

type Branch = { id: string; name: string; displayName: string };

// ─── Create User Form ────────────────────────────────────────────────────────

const createUserSchema = z.object({
  email: z.string().email("Valid email required"),
  password: z.string().min(8, "At least 8 characters"),
  displayName: z.string().min(1, "Display name required"),
  role: z.enum(['admin', 'scheduler', 'viewer']),
  branchIds: z.array(z.string()).min(1, "Assign at least one branch"),
});
type CreateUserForm = z.infer<typeof createUserSchema>;

function CreateUserDialog({ branches, onCreated }: { branches: Branch[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<CreateUserForm>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { email: '', password: '', displayName: '', role: 'viewer', branchIds: [] },
  });

  const mutation = useMutation({
    mutationFn: async (data: CreateUserForm) => {
      const res = await apiRequest('POST', '/api/admin/users', data);
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'User created', description: 'The new user can now sign in with their credentials.' });
      form.reset();
      setOpen(false);
      onCreated();
    },
    onError: (err: Error) => {
      toast({ title: 'Failed to create user', description: err.message, variant: 'destructive' });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-sm">
          <Plus className="h-4 w-4" />
          Add User
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogClose asChild>
          <button className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
        </DialogClose>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-500" />
            Create New User
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(d => mutation.mutate(d))} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="displayName" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Full Name</FormLabel>
                  <FormControl><Input {...field} placeholder="Jane Smith" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Outlook Email</FormLabel>
                  <FormControl><Input {...field} type="email" placeholder="jane.smith@homeinstead.com" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="password" render={({ field }) => (
                <FormItem>
                  <FormLabel>Initial Password</FormLabel>
                  <FormControl><Input {...field} type="password" placeholder="Min. 8 characters" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="role" render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(ROLE_LABELS).map(([v, r]) => (
                        <SelectItem key={v} value={v}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="branchIds" render={({ field }) => (
              <FormItem>
                <FormLabel>Branch Access</FormLabel>
                <div className="grid grid-cols-2 gap-2 p-3 rounded-lg border border-border bg-muted/30">
                  {branches.map(b => (
                    <label key={b.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 p-1.5 rounded">
                      <Checkbox
                        checked={field.value.includes(b.id)}
                        onCheckedChange={checked => {
                          if (checked) field.onChange([...field.value, b.id]);
                          else field.onChange(field.value.filter(id => id !== b.id));
                        }}
                      />
                      <span className="text-sm">{b.displayName}</span>
                    </label>
                  ))}
                </div>
                <FormMessage />
              </FormItem>
            )} />

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={mutation.isPending} className="bg-blue-600 hover:bg-blue-700 text-white">
                {mutation.isPending ? 'Creating...' : 'Create User'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit User Dialog ─────────────────────────────────────────────────────────

const SUPABASE_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|<>?,./`~]).{8,}$/;

const editUserSchema = z.object({
  displayName: z.string().min(1),
  role: z.enum(['admin', 'scheduler', 'viewer']),
  branchIds: z.array(z.string()).min(1),
  newPassword: z.union([
    z.literal(''),
    z.string().regex(SUPABASE_PASSWORD_REGEX, 'Must be 8+ chars with uppercase, lowercase, number and special character'),
  ]).optional(),
});
type EditUserForm = z.infer<typeof editUserSchema>;

function EditUserDialog({ user, branches, onUpdated }: { user: AdminUser; branches: Branch[]; onUpdated: () => void }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const { user: currentUser } = useAuth();

  const form = useForm<EditUserForm>({
    resolver: zodResolver(editUserSchema),
    defaultValues: {
      displayName: user.displayName,
      role: user.role as EditUserForm['role'],
      branchIds: user.branches.map(b => b.id),
      newPassword: '',
    },
  });

  type UpdateUserPayload = {
    displayName: string;
    role: EditUserForm['role'];
    branchIds: string[];
    newPassword?: string;
  };

  const mutation = useMutation({
    mutationFn: async (data: EditUserForm) => {
      const payload: UpdateUserPayload = { displayName: data.displayName, role: data.role, branchIds: data.branchIds };
      if (data.newPassword) payload.newPassword = data.newPassword;
      const res = await apiRequest('PATCH', `/api/admin/users/${user.id}`, payload);
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'User updated', description: 'Changes have been saved successfully.' });
      setOpen(false);
      onUpdated();
    },
    onError: (err: Error) => {
      toast({ title: 'Failed to update user', description: err.message, variant: 'destructive' });
    },
  });

  const toggleActive = useMutation({
    mutationFn: async (isActive: number) => {
      const res = await apiRequest('PATCH', `/api/admin/users/${user.id}`, { isActive });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: user.isActive ? 'User deactivated' : 'User reactivated' });
      onUpdated();
    },
    onError: (err: Error) => {
      toast({ title: 'Failed', description: err.message, variant: 'destructive' });
    },
  });

  const isSelf = currentUser?.id === user.id;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
          <Edit2 className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogClose asChild>
          <button className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
        </DialogClose>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit2 className="h-5 w-5 text-blue-500" />
            Edit User — {user.displayName}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(d => mutation.mutate(d))} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="displayName" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Full Name</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="role" render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} disabled={isSelf}>
                    <FormControl>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(ROLE_LABELS).map(([v, r]) => (
                        <SelectItem key={v} value={v}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="newPassword" render={({ field }) => (
                <FormItem>
                  <FormLabel>Reset Password</FormLabel>
                  <FormControl>
                    <Input {...field} type="password" placeholder="Leave blank to keep" />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">8+ chars · uppercase · lowercase · number · special character</p>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="branchIds" render={({ field }) => (
              <FormItem>
                <FormLabel>Branch Access</FormLabel>
                <div className="grid grid-cols-2 gap-2 p-3 rounded-lg border border-border bg-muted/30">
                  {branches.map(b => (
                    <label key={b.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 p-1.5 rounded">
                      <Checkbox
                        checked={field.value.includes(b.id)}
                        onCheckedChange={checked => {
                          if (checked) field.onChange([...field.value, b.id]);
                          else field.onChange(field.value.filter(id => id !== b.id));
                        }}
                      />
                      <span className="text-sm">{b.displayName}</span>
                    </label>
                  ))}
                </div>
                <FormMessage />
              </FormItem>
            )} />

            <DialogFooter className="flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isSelf || toggleActive.isPending}
                onClick={() => toggleActive.mutate(user.isActive ? 0 : 1)}
                className={user.isActive
                  ? "text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-950"
                  : "text-emerald-600 border-emerald-200 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                }
              >
                {user.isActive ? (
                  <><UserX className="h-3.5 w-3.5 mr-1.5" />Deactivate</>
                ) : (
                  <><UserCheck className="h-3.5 w-3.5 mr-1.5" />Reactivate</>
                )}
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={mutation.isPending} className="bg-blue-600 hover:bg-blue-700 text-white">
                  {mutation.isPending ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Feedback Tab ─────────────────────────────────────────────────────────────

interface FeedbackItem {
  id: string;
  type: string;
  title: string;
  description: string;
  stepsToReproduce?: string;
  submittedByEmail: string;
  branchId?: string;
  submittedAt: string;
}

// ─── Automation Tab ───────────────────────────────────────────────────────────

type WeeklySyncResult = {
  ok: boolean;
  message: string;
  branches: number;
  weeks: Array<{ label: string; weekStartDate: string }>;
};

type LeaverReportResult = {
  ok: boolean;
  month: string;
  branchesCovered: number;
  totalLeavers: number;
  recipients: string[];
  skipped: boolean;
  reason?: string;
};

type Recipient = { id: string; email: string; addedAt: string };

function LeaverRecipientManager() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [newEmail, setNewEmail] = useState('');

  const { data: recipients = [], isLoading } = useQuery<Recipient[]>({
    queryKey: ['/api/leaver-report/recipients'],
  });

  const addMutation = useMutation({
    mutationFn: async (email: string) => {
      const res = await apiRequest('POST', '/api/leaver-report/recipients', { email });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message ?? 'Failed to add');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/leaver-report/recipients'] });
      setNewEmail('');
      toast({ title: 'Recipient added' });
    },
    onError: (err: Error) => toast({ title: 'Failed to add', description: err.message, variant: 'destructive' }),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/leaver-report/recipients/${id}`, undefined);
      if (!res.ok) throw new Error('Failed to remove');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/leaver-report/recipients'] });
      toast({ title: 'Recipient removed' });
    },
    onError: (err: Error) => toast({ title: 'Failed to remove', description: err.message, variant: 'destructive' }),
  });

  const handleAdd = () => {
    const trimmed = newEmail.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast({ title: 'Enter a valid email address', variant: 'destructive' });
      return;
    }
    addMutation.mutate(trimmed);
  };

  const isDbManaged = recipients.length > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Recipients</p>
        {!isDbManaged && !isLoading && (
          <span className="text-xs text-muted-foreground">No recipients — report will be skipped until you add one</span>
        )}
      </div>

      {/* Current list */}
      <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
        {isLoading ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">Loading…</div>
        ) : isDbManaged ? (
          recipients.map(r => (
            <div key={r.id} className="flex items-center justify-between px-3 py-2 text-sm bg-background">
              <span className="font-medium">{r.email}</span>
              <button
                onClick={() => removeMutation.mutate(r.id)}
                disabled={removeMutation.isPending}
                className="text-muted-foreground hover:text-destructive transition-colors ml-2 shrink-0"
                title="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        ) : (
          <div className="px-3 py-2 text-sm text-muted-foreground italic">
            No recipients added yet — add one below.
          </div>
        )}
      </div>

      {/* Add row */}
      <div className="flex gap-2">
        <Input
          type="email"
          placeholder="name@example.com"
          value={newEmail}
          onChange={e => setNewEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          className="h-8 text-sm"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={handleAdd}
          disabled={addMutation.isPending || !newEmail.trim()}
          className="gap-1.5 shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>
      {isDbManaged && (
        <p className="text-xs text-muted-foreground">
          These addresses are stored in the database and override the <span className="font-mono">LEAVER_REPORT_EMAILS</span> secret.
        </p>
      )}
    </div>
  );
}

function AutomationTab() {
  const { toast } = useToast();
  const { selectedBranchId } = useBranch();
  const [lastResult, setLastResult] = useState<WeeklySyncResult | null>(null);
  const [lastReportResult, setLastReportResult] = useState<LeaverReportResult | null>(null);
  const [selectedWeeks, setSelectedWeeks] = useState<Set<'previous' | 'current' | 'next'>>(
    new Set(['previous', 'current', 'next'])
  );

  const toggleWeek = (week: 'previous' | 'current' | 'next') => {
    setSelectedWeeks(prev => {
      const next = new Set(prev);
      if (next.has(week)) { next.delete(week); } else { next.add(week); }
      return next;
    });
  };

  const syncMutation = useMutation({
    mutationFn: async () => {
      const weeks = Array.from(selectedWeeks);
      const res = await apiRequest('POST', '/api/pp/trigger-weekly-sync', { weeks });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? 'Unknown error');
      }
      return res.json() as Promise<WeeklySyncResult>;
    },
    onSuccess: (data) => {
      setLastResult(data);
      const count = data.weeks.length;
      const label = count === 3 ? 'all three weeks' : count === 1 ? `1 week` : `${count} weeks`;
      toast({ title: 'Weekly sync started', description: `Queued ${data.branches} branch${data.branches !== 1 ? 'es' : ''} across ${label}.` });
    },
    onError: (err: Error) => {
      toast({ title: 'Sync failed', description: err.message, variant: 'destructive' });
    },
  });

  const clearMapMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', `/api/admin/clear-map-locations?branchId=${selectedBranchId}`, {});
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message ?? 'Unknown error');
      }
      return res.json() as Promise<{ employeesRemoved: number; clientsRemoved: number }>;
    },
    onSuccess: (data) => {
      toast({
        title: 'Map data cleared',
        description: `Removed ${data.employeesRemoved} care pro${data.employeesRemoved !== 1 ? 's' : ''} and ${data.clientsRemoved} client${data.clientsRemoved !== 1 ? 's' : ''} from the map. They will reappear automatically after the next data upload.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: 'Clear failed', description: err.message, variant: 'destructive' });
    },
  });

  const leaverReportMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/leaver-report/send', {});
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message ?? 'Unknown error');
      }
      return res.json() as Promise<LeaverReportResult>;
    },
    onSuccess: (data) => {
      setLastReportResult(data);
      if (data.skipped) {
        toast({ title: 'Report skipped', description: data.reason ?? 'No leavers found', variant: 'destructive' });
      } else {
        toast({ title: 'Leaver report sent', description: `${data.totalLeavers} leaver${data.totalLeavers !== 1 ? 's' : ''} across ${data.branchesCovered} branch${data.branchesCovered !== 1 ? 'es' : ''} — sent to ${data.recipients.length} recipient${data.recipients.length !== 1 ? 's' : ''}.` });
      }
    },
    onError: (err: Error) => {
      toast({ title: 'Report failed', description: err.message, variant: 'destructive' });
    },
  });

  const WEEK_META = [
    { label: 'previous' as const, display: 'Previous week', time: 'Auto Mon 01:00', dot: 'bg-amber-400' },
    { label: 'current'  as const, display: 'Current week',  time: 'Auto Mon 03:00', dot: 'bg-blue-500'  },
    { label: 'next'     as const, display: 'Next week',     time: 'Auto Mon 05:00', dot: 'bg-emerald-500' },
  ];

  const runLabel = selectedWeeks.size === 3
    ? 'Run all three weeks now'
    : selectedWeeks.size === 0
      ? 'Select at least one week'
      : `Run ${Array.from(selectedWeeks).join(' + ')} week${selectedWeeks.size > 1 ? 's' : ''} now`;

  return (
    <div className="space-y-4">
      {/* Manual trigger card */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-950">
              <CalendarClock className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <CardTitle className="text-base">People Planner — Weekly Sync</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Select which weeks to sync, then run for all branches immediately
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Week selector tiles */}
          <div className="grid grid-cols-3 gap-3">
            {WEEK_META.map(({ label, display, time, dot }) => {
              const selected = selectedWeeks.has(label);
              const dateStr = lastResult?.weeks.find(w => w.label === label)?.weekStartDate;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => toggleWeek(label)}
                  className={`rounded-lg border p-3 space-y-1 text-left transition-all ${
                    selected
                      ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/40 ring-1 ring-purple-500'
                      : 'border-border bg-muted/30 opacity-50 hover:opacity-80'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <div className={`h-2 w-2 rounded-full ${dot}`} />
                    <span className="text-xs font-semibold text-foreground">{display}</span>
                    {selected && <CheckCircle2 className="h-3 w-3 text-purple-500 ml-auto" />}
                  </div>
                  <p className="text-xs text-muted-foreground">{time}</p>
                  {dateStr && (
                    <p className="text-xs font-mono text-muted-foreground">{dateStr}</p>
                  )}
                </button>
              );
            })}
          </div>

          {/* Select all / none shortcuts */}
          <div className="flex gap-3 text-xs">
            <button
              type="button"
              onClick={() => setSelectedWeeks(new Set(['previous', 'current', 'next']))}
              className="text-purple-600 dark:text-purple-400 hover:underline"
            >
              Select all
            </button>
            <span className="text-muted-foreground">·</span>
            <button
              type="button"
              onClick={() => setSelectedWeeks(new Set())}
              className="text-muted-foreground hover:underline"
            >
              Clear
            </button>
          </div>

          {/* Trigger button */}
          <div className="flex items-center gap-3 pt-1">
            <Button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending || selectedWeeks.size === 0}
              className="gap-2 bg-purple-600 hover:bg-purple-700 text-white shadow-sm"
            >
              {syncMutation.isPending ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {syncMutation.isPending ? 'Queuing syncs…' : runLabel}
            </Button>
            {lastResult && !syncMutation.isPending && (
              <div className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                <span>Queued for {lastResult.branches} branches</span>
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Syncs start immediately — monitor progress in the People Planner panel on the main dashboard.
          </p>
        </CardContent>
      </Card>

      {/* Leaver report card */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-100 dark:bg-red-950">
              <Mail className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <CardTitle className="text-base">Monthly Leaver Report</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Emails a summary of last month's leavers (all branches) to configured recipients
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Schedule info */}
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <span className="font-mono text-xs bg-muted border rounded px-1.5 py-0.5">1st of every month · 08:00 UTC</span>
            <span>Automatic send</span>
          </div>

          {/* Recipient manager */}
          <LeaverRecipientManager />

          {/* Manual trigger */}
          <div className="flex items-center gap-3 pt-1">
            <Button
              onClick={() => leaverReportMutation.mutate()}
              disabled={leaverReportMutation.isPending}
              variant="outline"
              className="gap-2 border-red-200 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              {leaverReportMutation.isPending ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Mail className="h-4 w-4" />
              )}
              {leaverReportMutation.isPending ? 'Sending…' : 'Send test report now'}
            </Button>
            {lastReportResult && !leaverReportMutation.isPending && (
              lastReportResult.skipped ? (
                <span className="text-sm text-amber-600 dark:text-amber-400">
                  Skipped — {lastReportResult.reason}
                </span>
              ) : (
                <div className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Sent · {lastReportResult.totalLeavers} leavers · {lastReportResult.month}</span>
                </div>
              )
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Sends the report for the previous calendar month. Requires <span className="font-mono">RESEND_API_KEY</span> in Replit Secrets.
          </p>
        </CardContent>
      </Card>

      {/* Schedule info card */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground font-medium">Automatic schedule (UK time)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            {[
              { time: 'Every Monday 01:00', desc: 'Previous week — catches any late changes before the working week starts' },
              { time: 'Every Monday 03:00', desc: 'Current week — main operational data for the week ahead' },
              { time: 'Every Monday 05:00', desc: 'Next week — advance visibility for scheduling decisions' },
            ].map(row => (
              <div key={row.time} className="flex items-start gap-3 py-1.5 border-b border-border/50 last:border-0">
                <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded text-foreground shrink-0 mt-0.5">
                  {row.time}
                </span>
                <span className="text-muted-foreground text-xs">{row.desc}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Map data maintenance card */}
      <Card className="border-0 shadow-sm border-l-4 border-l-amber-400">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-950">
              <MapPin className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <CardTitle className="text-base">Workforce &amp; Client Map — Clear stale pins</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Removes terminated care pros and discharged clients that are still showing on the map for the selected branch
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            The map is refreshed automatically on every data upload. Use this if you see old or terminated people still
            appearing — it wipes the map for the current branch and the pins will rebuild cleanly from your next upload.
          </p>
          <div className="flex items-center gap-3">
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  disabled={!selectedBranchId || clearMapMutation.isPending}
                  className="gap-2 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/40"
                >
                  {clearMapMutation.isPending ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  {clearMapMutation.isPending ? 'Clearing…' : 'Clear map data for this branch'}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Clear map data?</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-muted-foreground">
                  This will remove all care pro and client pins from the Workforce &amp; Client Map for the currently
                  selected branch. The map will be empty until you process a new data upload.
                </p>
                <DialogFooter className="gap-2 mt-2">
                  <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button
                      variant="destructive"
                      onClick={() => clearMapMutation.mutate()}
                    >
                      Yes, clear map
                    </Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            {clearMapMutation.isSuccess && !clearMapMutation.isPending && (
              <div className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                <span>Done — map cleared</span>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Going forward, terminated care pros and discharged clients are removed automatically whenever you upload new data.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function FeedbackTab() {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: feedbackItems = [], isLoading, refetch } = useQuery<FeedbackItem[]>({
    queryKey: ['/api/feedback'],
  });

  return (
    <TabsContent value="feedback">
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Feedback & Bug Reports</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
              className="gap-1.5 h-8"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[520px]">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full" />
              </div>
            ) : feedbackItems.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No feedback submitted yet</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {feedbackItems.map(item => (
                  <div
                    key={item.id}
                    className="px-5 py-4 hover:bg-muted/20 transition-colors cursor-pointer"
                    onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                        item.type === 'bug'
                          ? 'bg-red-100 dark:bg-red-950'
                          : 'bg-blue-100 dark:bg-blue-950'
                      }`}>
                        {item.type === 'bug'
                          ? <Bug className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                          : <MessageSquare className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-foreground truncate">{item.title}</p>
                          <Badge
                            variant="outline"
                            className={`text-xs shrink-0 ${
                              item.type === 'bug'
                                ? 'text-red-600 border-red-200 bg-red-50 dark:bg-red-950/30'
                                : 'text-blue-600 border-blue-200 bg-blue-50 dark:bg-blue-950/30'
                            }`}
                          >
                            {item.type === 'bug' ? 'Bug' : 'General'}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{item.submittedByEmail}</p>
                        {expanded === item.id && (
                          <div className="mt-3 space-y-2">
                            <p className="text-sm text-foreground">{item.description}</p>
                            {item.stepsToReproduce && (
                              <div className="mt-2 p-3 bg-muted/50 rounded-lg">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Steps to Reproduce</p>
                                <p className="text-sm text-foreground whitespace-pre-wrap">{item.stepsToReproduce}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {new Date(item.submittedAt).toLocaleString('en-GB', {
                          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                        })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </TabsContent>
  );
}

// ─── Communications Tab ───────────────────────────────────────────────────────

interface FeatureCardDraft { emoji: string; title: string; desc: string; }

function CommunicationsTab() {
  const { toast } = useToast();
  const [subject,        setSubject]        = useState('');
  const [releaseVersion, setReleaseVersion] = useState('');
  const [headline,       setHeadline]       = useState('');
  const [subheadline,    setSubheadline]    = useState('');
  const [body,           setBody]           = useState('');
  const [featureCards,   setFeatureCards]   = useState<FeatureCardDraft[]>([
    { emoji: '🔐', title: 'Microsoft Sign-In',    desc: 'Secure access using your existing Microsoft 365 account.' },
    { emoji: '📊', title: 'Dashboard Improvements', desc: 'Improved KPI visibility, readability and user experience.'  },
    { emoji: '⚡', title: 'Platform Performance', desc: 'Behind-the-scenes enhancements to reliability and responsiveness.' },
  ]);
  const [showFeatureCards, setShowFeatureCards] = useState(false);
  const [bullets,        setBullets]        = useState<string[]>(['']);
  const [comingNext,     setComingNext]     = useState<string[]>(['']);
  const [showComingNext, setShowComingNext] = useState(false);
  const [screenshotUrl,  setScreenshotUrl]  = useState('');
  const [ctaText,        setCtaText]        = useState('');
  const [ctaUrl,         setCtaUrl]         = useState('');
  const [showPreview,    setShowPreview]    = useState(false);
  const [sending,        setSending]        = useState(false);
  const [lastResult,     setLastResult]     = useState<{ sent: number; failed: number; total: number } | null>(null);

  const { data: recipientsData } = useQuery<{ count: number; emails: { email: string; name: string }[] }>({
    queryKey: ['/api/admin/broadcast-email/recipients'],
  });

  const activeBullets    = bullets.filter(b => b.trim());
  const activeComingNext = comingNext.filter(c => c.trim());
  const activeCards      = featureCards.filter(c => c.title.trim() || c.desc.trim());

  const handleAddBullet      = () => setBullets(prev => [...prev, '']);
  const handleBulletChange   = (i: number, val: string) => setBullets(prev => prev.map((b, idx) => idx === i ? val : b));
  const handleRemoveBullet   = (i: number) => setBullets(prev => prev.filter((_, idx) => idx !== i));

  const handleAddComing      = () => setComingNext(prev => [...prev, '']);
  const handleComingChange   = (i: number, val: string) => setComingNext(prev => prev.map((c, idx) => idx === i ? val : c));
  const handleRemoveComing   = (i: number) => setComingNext(prev => prev.filter((_, idx) => idx !== i));

  const handleCardChange = (i: number, field: keyof FeatureCardDraft, val: string) =>
    setFeatureCards(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: val } : c));

  const canSend = subject.trim() && headline.trim() && body.trim();

  const handleSend = async () => {
    if (!canSend) return;
    const confirmed = window.confirm(
      `Send this email to ${recipientsData?.count ?? '?'} active users?\n\nSubject: ${subject}`
    );
    if (!confirmed) return;

    setSending(true);
    try {
      const res = await apiRequest('POST', '/api/admin/broadcast-email', {
        subject,
        headline,
        subheadline:    subheadline.trim()    || undefined,
        releaseVersion: releaseVersion.trim() || undefined,
        body,
        featureCards:   showFeatureCards && activeCards.length > 0 ? activeCards : undefined,
        bullets:        activeBullets.length > 0 ? activeBullets : undefined,
        screenshotUrl:  screenshotUrl.trim() || undefined,
        comingNext:     showComingNext && activeComingNext.length > 0 ? activeComingNext : undefined,
        ctaText:        ctaText.trim() || undefined,
        ctaUrl:         ctaUrl.trim()  || undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Send failed');
      setLastResult(data);
      toast({
        title: `✅ Sent to ${data.sent} of ${data.total} users`,
        description: data.failed > 0 ? `${data.failed} failed — check logs` : 'All delivered successfully',
      });
    } catch (err: unknown) {
      toast({ title: 'Failed to send', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const dashboardUrl = 'https://carecapacity.sur-group.co.uk/login';
  const logoUrl = 'https://carecapacity.sur-group.co.uk/favicon.png';

  const releaseLabel = releaseVersion.trim() ||
    new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toUpperCase();
  const updatesCount = activeBullets.length + (showFeatureCards ? activeCards.length : 0);

  // ── Markdown-lite body parser ──────────────────────────────────────────────
  function parseBodyPreview(raw: string): string {
    if (!raw.trim()) return '<p class="placeholder">We\'re pleased to share the latest updates to the Care Capacity platform, including new features, security enhancements and experience improvements designed to help teams work more efficiently.</p>';
    const inline = (s: string) =>
      s.replace(/\*\*(.+?)\*\*/g, '<strong style="color:#0c1628;font-weight:700;">$1</strong>')
       .replace(/_(.+?)_/g, '<em>$1</em>');
    return raw.split(/\n{2,}/).map(block => {
      const t = block.trim();
      if (!t) return '';
      if (t === '---') return '<hr class="hr">';
      if (t.startsWith('### ')) return `<p class="eyebrow">${inline(t.slice(4))}</p>`;
      if (t.startsWith('## '))  return `<h2 class="bh2">${inline(t.slice(3))}</h2>`;
      if (t.startsWith('# '))   return `<h1 class="bh1">${inline(t.slice(2))}</h1>`;
      const lines = t.split('\n');
      if (lines.every(l => /^[-*]\s/.test(l.trim()))) {
        return `<ul class="bul">${lines.map(l => `<li>${inline(l.trim().replace(/^[-*]\s/, ''))}</li>`).join('')}</ul>`;
      }
      return `<p class="bp">${inline(lines.join('<br>'))}</p>`;
    }).join('');
  }

  // ── Feature cards preview HTML ─────────────────────────────────────────────
  const featureCardsPreviewHtml = showFeatureCards && activeCards.length > 0
    ? `<div class="fc-section">
        <div class="fc-grid">
          ${activeCards.slice(0,3).map(c => `
            <div class="fc-card">
              <div class="fc-emoji">${c.emoji || '⚡'}</div>
              <div class="fc-title">${c.title || 'Feature'}</div>
              <div class="fc-desc">${c.desc || ''}</div>
            </div>`).join('')}
        </div>
      </div>` : '';

  // ── Screenshot preview HTML ────────────────────────────────────────────────
  const screenshotPreviewHtml = screenshotUrl.trim()
    ? `<div class="screenshot-section">
        <p class="eyebrow">Platform Preview</p>
        <img src="${screenshotUrl}" style="width:100%;border-radius:8px;border:1px solid #e2e8f0;display:block;" />
        <p style="font-size:12px;color:#94a3b8;margin:8px 0 0;line-height:1.5;">Enhanced dashboard visibility, cleaner navigation and a more secure experience.</p>
      </div>` : '';

  // ── Release notes preview HTML ─────────────────────────────────────────────
  const bulletsPreviewHtml = activeBullets.length > 0
    ? `<div class="rn-section">
        <p class="eyebrow">Included in this Release</p>
        ${activeBullets.map((b,i,arr) => `
          <div class="rn-item" style="${i < arr.length-1 ? 'border-bottom:1px solid #f1f5f9;' : ''}">
            <div class="rn-check">✓</div>
            <span class="rn-text">${b}</span>
          </div>`).join('')}
      </div>` : '';

  // ── Coming Next preview HTML ───────────────────────────────────────────────
  const comingNextPreviewHtml = showComingNext && activeComingNext.length > 0
    ? `<div class="cn-section">
        <p class="eyebrow" style="color:#64748b;">Coming Next</p>
        ${activeComingNext.map(item => `
          <div class="cn-item">
            <span class="cn-arrow">→</span>
            <span class="cn-text">${item}</span>
          </div>`).join('')}
      </div>` : '';

  // Live preview rendered in an iframe srcDoc
  const previewHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',system-ui,sans-serif;background:#f0f2f5;padding:32px 16px 48px;-webkit-font-smoothing:antialiased}
    .outer{max-width:580px;margin:0 auto}

    /* Card shell */
    .card{border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06),0 20px 60px rgba(0,0,0,0.10),0 0 0 1px rgba(0,0,0,0.04)}

    /* Stripe */
    .stripe{height:3px;background:linear-gradient(90deg,#059669 0%,#10b981 50%,#34d399 100%)}
    /* Logo row */
    .pre{background:#fff;padding:20px 36px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #f4f6f8}
    .logo-wrap{display:flex;align-items:center;gap:11px}
    .pre img{width:30px;height:31px;border-radius:7px;display:block}
    .brand{font-size:14px;font-weight:700;color:#0c1628;letter-spacing:-0.02em;line-height:1}
    .brandtag{font-size:10px;color:#94a3b8;margin-top:3px;font-weight:400}
    .pill{font-size:10px;font-weight:600;color:#059669;background:#f0fdf4;padding:4px 10px;border-radius:20px;border:1px solid #bbf7d0;letter-spacing:0.05em;text-transform:uppercase}
    /* Hero */
    .hero{background:#0c1628;padding:52px 44px 44px}
    .hero-release{display:inline-block;font-size:10px;font-weight:700;color:#34d399;letter-spacing:0.15em;text-transform:uppercase;background:rgba(52,211,153,0.08);border:1px solid rgba(52,211,153,0.25);padding:5px 12px;border-radius:20px;margin-bottom:20px}
    .hero h1{font-size:44px;font-weight:900;color:#fff;line-height:1.05;letter-spacing:-0.04em;margin:0 0 16px}
    .hero-sub{font-size:17px;color:#94a3b8;line-height:1.55;margin:0 0 32px;max-width:460px}
    .metrics{display:flex;gap:12px;flex-wrap:wrap}
    .metric{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px 18px;text-align:center}
    .metric-val{font-size:20px;font-weight:800;color:#fff;line-height:1}
    .metric-val.green{color:#34d399}
    .metric-lbl{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;margin-top:4px}
    .hero-glow{height:1px;background:linear-gradient(90deg,transparent,rgba(5,150,105,0.4),transparent)}
    /* Body */
    .body{background:#fff;padding:40px 44px 28px}
    .body-eyebrow{font-size:10px;font-weight:700;color:#059669;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 8px}
    .greeting{font-size:15px;color:#374151;line-height:1.6;margin:0 0 24px}
    /* Typography */
    .bh1{font-size:20px;font-weight:800;color:#0c1628;letter-spacing:-0.025em;line-height:1.2;margin:28px 0 12px}
    .bh1:first-child{margin-top:0}
    .bh2{font-size:15px;font-weight:700;color:#0c1628;line-height:1.35;margin:24px 0 8px;display:flex;align-items:center;gap:8px}
    .bh2::before{content:'';display:inline-block;width:3px;height:14px;background:#059669;border-radius:2px;flex-shrink:0}
    .eyebrow{font-size:10px;font-weight:700;color:#059669;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 8px;display:block}
    .bp{font-size:15px;color:#4b5563;line-height:1.8;margin-bottom:16px}
    .bp:last-child{margin-bottom:0}
    .bul{list-style:none;padding:0;margin:4px 0 18px}
    .bul li{font-size:14px;color:#4b5563;line-height:1.75;padding:6px 0 6px 20px;position:relative;border-bottom:1px solid #f8fafc}
    .bul li:last-child{border-bottom:none}
    .bul li::before{content:'';position:absolute;left:2px;top:14px;width:6px;height:6px;border-radius:50%;background:#059669}
    .hr{border:none;border-top:1px solid #f1f5f9;margin:24px 0}
    .placeholder{font-size:15px;color:#cbd5e1;font-style:italic;line-height:1.75}
    /* Feature cards */
    .fc-section{background:#f8fafc;padding:28px 44px;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0}
    .fc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#e2e8f0;border-radius:8px;overflow:hidden}
    .fc-card{background:#fff;padding:20px 16px;text-align:center}
    .fc-emoji{font-size:28px;line-height:1;margin-bottom:10px}
    .fc-title{font-size:13px;font-weight:700;color:#0c1628;margin-bottom:6px}
    .fc-desc{font-size:12px;color:#64748b;line-height:1.5}
    /* Screenshot */
    .screenshot-section{background:#fff;padding:28px 44px}
    /* Release notes */
    .rn-section{background:#fff;padding:0 44px 28px}
    .rn-item{display:flex;align-items:flex-start;gap:10px;padding:9px 0}
    .rn-check{width:20px;height:20px;background:#059669;border-radius:5px;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;line-height:1}
    .rn-text{font-size:14px;color:#374151;font-weight:500;line-height:1.4}
    /* Coming Next */
    .cn-section{background:#f8fafc;padding:24px 44px;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0}
    .cn-item{display:flex;align-items:flex-start;gap:8px;margin-bottom:8px}
    .cn-item:last-child{margin-bottom:0}
    .cn-arrow{font-size:14px;color:#94a3b8;flex-shrink:0;margin-top:1px}
    .cn-text{font-size:13px;color:#64748b;line-height:1.5}
    /* CTA */
    .cta-section{background:#fff;padding:36px 44px 40px;text-align:center}
    .cta-btn{display:inline-block;background:linear-gradient(90deg,#059669,#10b981);color:#fff;font-family:'Inter',system-ui,sans-serif;font-size:16px;font-weight:700;text-decoration:none;padding:18px 44px;border-radius:14px;letter-spacing:0.01em;box-shadow:0 12px 30px rgba(16,185,129,.30)}
    /* Footer */
    .footer{background:#0c1628;padding:36px 44px;text-align:center}
    .footer-brand{display:flex;align-items:center;justify-content:center;gap:9px;margin-bottom:12px}
    .footer-icon{width:26px;height:26px;background:#059669;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:13px}
    .footer-name{font-size:14px;font-weight:800;color:#fff;letter-spacing:0.06em;text-transform:uppercase}
    .footer-tag{font-size:12px;color:#64748b;margin-bottom:14px}
    .footer-rule{height:1px;background:rgba(255,255,255,0.06);margin:0 0 14px}
    .footer-p{font-size:11px;color:#475569;line-height:1.6;margin-bottom:4px}
    .footer-small{font-size:10px;color:#1e293b;margin-top:6px}
  </style></head><body>
  <div class="outer">
    <div class="card">
      <div class="stripe"></div>

      <div class="pre">
        <div class="logo-wrap">
          <img src="${logoUrl}" alt="" />
          <div>
            <div class="brand">Care Capacity</div>
            <div class="brandtag">Workforce Intelligence Platform</div>
          </div>
        </div>
        <span class="pill">Platform Update</span>
      </div>

      <div class="hero">
        <div class="hero-release">RELEASE ${releaseLabel}</div>
        <h1>${headline || 'Microsoft Sign-In Is Now Live'}</h1>
        <div class="hero-sub">${subheadline || 'Faster access, stronger security and a better platform experience.'}</div>
        <div class="metrics">
          <div class="metric">
            <div class="metric-val green">Live</div>
            <div class="metric-lbl">Status</div>
          </div>
          <div class="metric">
            <div class="metric-val" style="font-size:15px;">${releaseLabel}</div>
            <div class="metric-lbl">Release</div>
          </div>
        </div>
      </div>
      <div class="hero-glow"></div>

      <div class="body">
        <p class="body-eyebrow">What's New</p>
        <p class="greeting">Hi there,</p>
        ${parseBodyPreview(body)}
      </div>

      ${featureCardsPreviewHtml}
      ${screenshotPreviewHtml}
      ${bulletsPreviewHtml}
      ${comingNextPreviewHtml}

      <div class="footer">
        <div class="footer-brand">
          <div class="footer-icon">⚡</div>
          <div class="footer-name">CARE CAPACITY</div>
        </div>
        <div class="footer-tag">Workforce Intelligence Platform</div>
        <div class="footer-rule"></div>
        <div style="display:flex;gap:10px;justify-content:center;margin-bottom:14px;">
          <a href="${ctaUrl || dashboardUrl}" target="_blank" rel="noopener" style="display:inline-block;font-size:13px;font-weight:600;color:#34d399;text-decoration:none;border:1px solid rgba(52,211,153,0.35);border-radius:8px;padding:9px 20px;letter-spacing:0.01em;">${ctaText || 'Launch Care Capacity →'}</a>
          <a href="mailto:mustansar.hussain@sg.homeinstead.co.uk" style="display:inline-block;font-size:13px;font-weight:600;color:#34d399;text-decoration:none;border:1px solid rgba(52,211,153,0.35);border-radius:8px;padding:9px 20px;letter-spacing:0.01em;">Contact Us</a>
        </div>
        <p class="footer-p">Built by the Digital &amp; Technology Team</p>
        <p class="footer-small">© ${new Date().getFullYear()} Home Instead – Scottish Group</p>
      </div>
    </div>
  </div>
  </body></html>`;

  return (
    <TabsContent value="communications">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

        {/* ── Compose panel ── */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                  <Megaphone className="h-4 w-4 text-white" />
                </div>
                <div>
                  <CardTitle className="text-base">Compose Broadcast</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Sends to{' '}
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {recipientsData?.count ?? '…'} active users
                    </span>
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPreview(p => !p)}
                className="gap-1.5 h-8 xl:hidden"
              >
                {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showPreview ? 'Hide preview' : 'Preview'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">

            {/* ── SEND ── */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Email Subject *</label>
              <Input
                placeholder="e.g. Care Capacity — July 2026 Update"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                className="h-9"
              />
            </div>

            {/* ── HERO ── */}
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Hero Section</p>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Headline *</label>
                  <Input
                    placeholder="Microsoft Sign-In Is Now Live"
                    value={headline}
                    onChange={e => setHeadline(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Release version</label>
                  <Input
                    placeholder="2026.07"
                    value={releaseVersion}
                    onChange={e => setReleaseVersion(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Subheadline</label>
                <Input
                  placeholder="Faster access, stronger security and a better platform experience."
                  value={subheadline}
                  onChange={e => setSubheadline(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>

            {/* ── CONTENT ── */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Message Body *</label>
              <Textarea
                placeholder={"We're pleased to share the latest updates to the Care Capacity platform, including new features, security enhancements and experience improvements designed to help teams work more efficiently."}
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={4}
                className="resize-none text-sm leading-relaxed"
              />
              <p className="text-[11px] text-muted-foreground">Supports # headings, ## subheadings, **bold**, _italic_, - bullets, --- dividers</p>
            </div>

            {/* ── FEATURE CARDS ── */}
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Feature Cards</p>
                <button
                  onClick={() => setShowFeatureCards(p => !p)}
                  className="text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                >
                  {showFeatureCards ? '− Hide' : '+ Include in email'}
                </button>
              </div>
              {showFeatureCards && (
                <div className="space-y-3">
                  {featureCards.map((card, i) => (
                    <div key={i} className="grid grid-cols-[32px_1fr_2fr] gap-2 items-start">
                      <Input
                        placeholder="🔐"
                        value={card.emoji}
                        onChange={e => handleCardChange(i, 'emoji', e.target.value)}
                        className="h-8 text-sm text-center px-1"
                      />
                      <Input
                        placeholder="Feature name"
                        value={card.title}
                        onChange={e => handleCardChange(i, 'title', e.target.value)}
                        className="h-8 text-sm"
                      />
                      <Input
                        placeholder="Short description…"
                        value={card.desc}
                        onChange={e => handleCardChange(i, 'desc', e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── RELEASE NOTES ── */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Included in this Release <span className="normal-case font-normal">(optional)</span>
                </label>
                <button onClick={handleAddBullet} className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1">
                  <Plus className="h-3 w-3" /> Add
                </button>
              </div>
              <div className="space-y-2">
                {bullets.map((b, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <div className="w-5 h-5 rounded bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center shrink-0">
                      <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <Input placeholder={`e.g. Microsoft Sign-In`} value={b} onChange={e => handleBulletChange(i, e.target.value)} className="h-8 text-sm flex-1" />
                    {bullets.length > 1 && (
                      <button onClick={() => handleRemoveBullet(i)} className="text-muted-foreground hover:text-destructive transition-colors"><X className="h-3.5 w-3.5" /></button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* ── COMING NEXT ── */}
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Coming Next (roadmap)</p>
                <button onClick={() => setShowComingNext(p => !p)} className="text-xs text-emerald-600 hover:text-emerald-700 font-medium">
                  {showComingNext ? '− Hide' : '+ Include in email'}
                </button>
              </div>
              {showComingNext && (
                <div className="space-y-2">
                  {comingNext.map((c, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <span className="text-muted-foreground text-sm shrink-0">→</span>
                      <Input placeholder="e.g. AI Powered Insights" value={c} onChange={e => handleComingChange(i, e.target.value)} className="h-8 text-sm flex-1" />
                      {comingNext.length > 1 && (
                        <button onClick={() => handleRemoveComing(i)} className="text-muted-foreground hover:text-destructive transition-colors"><X className="h-3.5 w-3.5" /></button>
                      )}
                    </div>
                  ))}
                  <button onClick={handleAddComing} className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1">
                    <Plus className="h-3 w-3" /> Add item
                  </button>
                </div>
              )}
            </div>

            {/* ── SCREENSHOT + CTA ── */}
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Optional Extras</p>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Screenshot URL (platform preview image)</label>
                <Input
                  placeholder="https://… (leave blank to skip)"
                  value={screenshotUrl}
                  onChange={e => setScreenshotUrl(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">CTA button label</label>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Launch Care Capacity →"
                    value={ctaText}
                    onChange={e => setCtaText(e.target.value)}
                    className="h-8 text-sm"
                  />
                  <Input
                    placeholder="URL (blank = dashboard)"
                    value={ctaUrl}
                    onChange={e => setCtaUrl(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Send result */}
            {lastResult && (
              <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-200 dark:border-emerald-800">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <p className="text-sm text-emerald-700 dark:text-emerald-400">
                  Last send: <strong>{lastResult.sent}</strong> of <strong>{lastResult.total}</strong> delivered
                  {lastResult.failed > 0 && ` · ${lastResult.failed} failed`}
                </p>
              </div>
            )}

            {/* Send button */}
            <Button
              onClick={handleSend}
              disabled={!canSend || sending}
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white gap-2 h-10"
            >
              {sending ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Sending to {recipientsData?.count ?? '?'} users…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Send to all {recipientsData?.count ?? '?'} active users
                </>
              )}
            </Button>

            {/* Recipients list */}
            {recipientsData?.emails && recipientsData.emails.length > 0 && (
              <details className="group">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors list-none flex items-center gap-1">
                  <Sparkles className="h-3 w-3" />
                  View {recipientsData.count} recipients
                </summary>
                <div className="mt-2 border border-border rounded-lg overflow-hidden">
                  {recipientsData.emails.map(r => (
                    <div key={r.email} className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-border last:border-0 hover:bg-muted/30">
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-400 to-emerald-400 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                        {r.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium truncate">{r.name}</span>
                      <span className="text-muted-foreground truncate">{r.email}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}

          </CardContent>
        </Card>

        {/* ── Live preview panel ── */}
        <Card className={`border-0 shadow-sm ${showPreview ? 'block' : 'hidden xl:block'}`}>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Live Email Preview</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <iframe
              srcDoc={previewHtml}
              title="Email preview"
              className="w-full rounded-b-lg border-0"
              style={{ height: '640px' }}
              sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            />
          </CardContent>
        </Card>

      </div>
    </TabsContent>
  );
}

// ─── Admin Page ───────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('users');
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const { data: users = [], isLoading: isLoadingUsers } = useQuery<AdminUser[]>({
    queryKey: ['/api/admin/users'],
  });

  const { data: auditLogs = [], isLoading: isLoadingLogs, refetch: refetchLogs } = useQuery<AuditLog[]>({
    queryKey: ['/api/admin/audit-logs'],
    enabled: activeTab === 'audit',
    staleTime: 30_000,
  });

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['/api/branches'],
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['/api/admin/users'] });
  };

  const filteredUsers = users.filter(u =>
    u.displayName.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  const activeCount = users.filter(u => u.isActive).length;
  const inactiveCount = users.filter(u => !u.isActive).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-emerald-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
      <div className="max-w-6xl mx-auto px-4 pt-28 pb-12">

        {/* Back Button */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="mb-6 flex justify-end"
        >
          <Button 
            onClick={() => navigate('/')}
            variant="outline"
            className="gap-2 h-10"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Button>
        </motion.div>

        {/* Page header */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-blue-100 dark:bg-blue-950/50 rounded-xl">
              <Shield className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h1 className="text-2xl font-display font-bold text-foreground">Administration</h1>
              <p className="text-sm text-muted-foreground">Manage users, permissions, and compliance logs</p>
            </div>
          </div>
        </motion.div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Total Users', value: users.length, icon: Users, color: 'text-blue-600 bg-blue-50 dark:bg-blue-950/30' },
            { label: 'Active', value: activeCount, icon: UserCheck, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30' },
            { label: 'Inactive', value: inactiveCount, icon: UserX, color: 'text-red-500 bg-red-50 dark:bg-red-950/30' },
          ].map(stat => (
            <Card key={stat.label} className="border-0 shadow-sm">
              <CardContent className="flex items-center gap-3 p-4">
                <div className={`p-2 rounded-lg ${stat.color}`}>
                  <stat.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Main tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4 bg-white/80 dark:bg-gray-900/80 border border-border rounded-xl p-1">
            <TabsTrigger value="users" className="rounded-lg gap-2 flex-1">
              <Users className="h-4 w-4" /> Users
            </TabsTrigger>
            <TabsTrigger value="audit" className="rounded-lg gap-2 flex-1">
              <ClipboardList className="h-4 w-4" /> Audit Log
            </TabsTrigger>
            <TabsTrigger value="feedback" className="rounded-lg gap-2 flex-1">
              <MessageSquare className="h-4 w-4" /> Feedback
            </TabsTrigger>
            <TabsTrigger value="automation" className="rounded-lg gap-2 flex-1">
              <CalendarClock className="h-4 w-4" /> Automation
            </TabsTrigger>
            <TabsTrigger value="communications" className="rounded-lg gap-2 flex-1">
              <Megaphone className="h-4 w-4" /> Communications
            </TabsTrigger>
          </TabsList>

          {/* ── Users Tab ── */}
          <TabsContent value="users">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search users..."
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="pl-9 h-9 bg-muted/50"
                    />
                  </div>
                  <CreateUserDialog branches={branches} onCreated={refresh} />
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {isLoadingUsers ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full" />
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">No users found</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {filteredUsers.map(u => (
                      <div key={u.id} className={`flex items-center gap-4 px-5 py-3.5 hover:bg-muted/30 transition-colors ${!u.isActive ? 'opacity-50' : ''}`}>
                        {/* Avatar */}
                        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
                          {u.displayName.charAt(0).toUpperCase()}
                        </div>
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-sm text-foreground truncate">{u.displayName}</p>
                            {!u.isActive && (
                              <Badge variant="outline" className="text-xs text-red-500 border-red-200">Inactive</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                        </div>
                        {/* Role badge */}
                        <Badge className={`text-xs font-medium border-0 ${ROLE_LABELS[u.role]?.color}`}>
                          {ROLE_LABELS[u.role]?.label || u.role}
                        </Badge>
                        {/* Branches */}
                        <div className="hidden md:flex items-center gap-1 flex-wrap max-w-[200px]">
                          {u.branches.slice(0, 2).map(b => (
                            <Badge key={b.id} variant="outline" className="text-xs">
                              {b.displayName}
                            </Badge>
                          ))}
                          {u.branches.length > 2 && (
                            <Badge variant="outline" className="text-xs text-muted-foreground">
                              +{u.branches.length - 2}
                            </Badge>
                          )}
                        </div>
                        {/* Actions */}
                        <EditUserDialog user={u} branches={branches} onUpdated={refresh} />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Audit Log Tab ── */}
          <TabsContent value="audit">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Activity Log</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetchLogs()}
                    disabled={isLoadingLogs}
                    className="gap-1.5 h-8"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isLoadingLogs ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[520px]">
                  {isLoadingLogs ? (
                    <div className="flex items-center justify-center py-16">
                      <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full" />
                    </div>
                  ) : auditLogs.length === 0 ? (
                    <div className="text-center py-16 text-muted-foreground">
                      <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-30" />
                      <p className="font-medium">No audit events recorded yet</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {auditLogs.map(log => (
                        <div key={log.id} className="flex items-start gap-3 px-5 py-3 hover:bg-muted/20 transition-colors">
                          <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-950 flex items-center justify-center shrink-0 mt-0.5">
                            <ClipboardList className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-foreground">
                                {ACTION_LABELS[log.action] || log.action}
                              </p>
                              {log.userEmail && (
                                <span className="text-xs text-muted-foreground">by {log.userEmail}</span>
                              )}
                            </div>
                            {log.detail && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">{log.detail}</p>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {new Date(log.timestamp).toLocaleString('en-GB', {
                              day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                            })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Feedback Tab ── */}
          <FeedbackTab />

          {/* ── Automation Tab ── */}
          <TabsContent value="automation">
            <AutomationTab />
          </TabsContent>

          {/* ── Communications Tab ── */}
          <CommunicationsTab />
        </Tabs>
      </div>
    </div>
  );
}
