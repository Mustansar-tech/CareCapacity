import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import {
  Users, Plus, Edit2, UserX, UserCheck, KeyRound, ClipboardList,
  Search, Shield, ChevronDown, X, Check, AlertCircle, RefreshCw
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
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";

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
    onError: (err: any) => {
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

const editUserSchema = z.object({
  displayName: z.string().min(1),
  role: z.enum(['admin', 'scheduler', 'viewer']),
  branchIds: z.array(z.string()).min(1),
  newPassword: z.string().min(8).optional().or(z.literal('')),
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
      role: user.role as any,
      branchIds: user.branches.map(b => b.id),
      newPassword: '',
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: EditUserForm) => {
      const payload: any = { displayName: data.displayName, role: data.role, branchIds: data.branchIds };
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
    onError: (err: any) => {
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
    onError: (err: any) => {
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

// ─── Admin Page ───────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('users');
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
        </Tabs>
      </div>
    </div>
  );
}
