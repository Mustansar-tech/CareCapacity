import { Switch, Route } from "wouter";
import { queryClient, setUnauthorizedHandler } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense } from "react";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import PrivacyPolicy from "@/pages/privacy-policy";
import Terms from "@/pages/terms";
import { ThemeToggle } from "@/components/theme-toggle";
import { BranchProvider, useBranch } from "@/contexts/BranchContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { BranchSelector } from "@/components/BranchSelector";
import { CookieBanner } from "@/components/CookieBanner";
import { HelpPanel } from "@/components/HelpPanel";
import homeInsteadLogo from "@/assets/logo.png";
import { Component, ErrorInfo, ReactNode, useState, useEffect, useRef, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Shield, LogOut, ChevronDown, Clock, AlertTriangle, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import { useSessionTimeout } from "@/hooks/use-session-timeout";
import type { ProcessingResultWithMeta } from "@shared/schema";

// Lazy load heavy pages
const DashboardModule = lazy(() => import("@/pages/dashboard"));
const AdminModule = lazy(() => import("@/pages/admin"));
const BDMatrixModule = lazy(() => import("@/pages/bd-matrix"));
const DataManagementModule = lazy(() => import("@/pages/data-management"));
const ScheduleModule = lazy(() => import("@/pages/schedule"));
const PeoplePlannerModule = lazy(() => import("@/pages/people-planner"));

function PageSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400 text-sm">Loading...</p>
        </div>
      </div>
    }>
      {children}
    </Suspense>
  );
}

function Redirect({ to }: { to: string }) {
  const [, navigate] = useLocation();
  useEffect(() => { navigate(to, { replace: true } as any); }, []);
  return null;
}

function Dashboard() {
  return <PageSuspense><DashboardModule /></PageSuspense>;
}

function AdminPage() {
  const { isAdmin } = useAuth();
  const [, navigate] = useLocation();

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-20">
        <div className="text-center p-8 bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md">
          <Shield className="h-16 w-16 text-red-600 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Access Denied</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Only administrators can access this page.
          </p>
          <button
            onClick={() => navigate('/app/dashboard')}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return <PageSuspense><AdminModule /></PageSuspense>;
}

function BDMatrixPage() {
  const { data: latestData } = useQuery<ProcessingResultWithMeta>({
    queryKey: ["/api/history/latest"],
    refetchOnWindowFocus: false,
  });

  return (
    <PageSuspense>
      <BDMatrixModule
        data={latestData ?? null}
        weekStartDate={latestData?.weekStartDate}
      />
    </PageSuspense>
  );
}

// ─── Error Boundary ──────────────────────────────────────────────────────────

class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (!import.meta.env.PROD) {
      console.error("App Error:", error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
          <div className="text-center p-8 bg-white dark:bg-gray-800 rounded-lg shadow-xl">
            <h1 className="text-2xl font-bold text-red-600 mb-4">Something went wrong</h1>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              {this.state.error?.message || "An unexpected error occurred"}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Role badge ───────────────────────────────────────────────────────────────

const ROLE_STYLES: Record<string, string> = {
  admin:      'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  scheduler:  'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  viewer:     'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};
const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin', scheduler: 'Scheduler', viewer: 'Viewer',
};

// ─── User Menu ────────────────────────────────────────────────────────────────

function UserMenu() {
  const { user, logout, isAdmin } = useAuth();
  const [, navigate] = useLocation();

  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/60 dark:bg-gray-800/60 border border-gray-200/30 dark:border-gray-700/30 hover:bg-white/80 dark:hover:bg-gray-800/80 transition-all">
          <div className="h-7 w-7 rounded-full bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center text-white text-xs font-bold">
            {user.displayName.charAt(0).toUpperCase()}
          </div>
          <div className="hidden sm:block text-left">
            <p className="text-xs font-semibold text-foreground leading-none">{user.displayName}</p>
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground hidden sm:block" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-0.5">
            <p className="text-sm font-semibold">{user.displayName}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isAdmin && (
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => navigate('/app/admin')} className="cursor-pointer">
              <Shield className="mr-2 h-4 w-4 text-blue-500" />
              <span>Administration</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </DropdownMenuGroup>
        )}
        <DropdownMenuItem
          onClick={() => logout()}
          className="cursor-pointer text-red-600 dark:text-red-400 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950"
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function Navigation() {
  const [, navigate] = useLocation();
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <>
      <nav className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-6xl px-4" data-testid="main-navigation">
        <div className="glass elevation-3 bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-2xl px-6 py-2 shadow-2xl pt-[1px] pb-[1px]">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <div
              className="flex items-center gap-3 cursor-pointer group transition-all duration-300 hover:scale-102"
              onClick={() => navigate('/app/dashboard')}
              role="link"
              aria-label="Care Capacity Dashboard - Workforce Intelligence"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') navigate('/app/dashboard');
              }}
            >
              <div className="relative">
                <img
                  src={homeInsteadLogo}
                  alt="Care Capacity Dashboard"
                  width={48}
                  height={48}
                  className="h-12 w-auto rounded-lg object-contain border-2 border-white/40 shadow-xl group-hover:shadow-blue-500/20 transition-all"
                />
              </div>
              <div className="hidden sm:block">
                <div className="text-base font-display font-bold bg-gradient-to-r from-blue-600 via-emerald-600 to-blue-600 bg-clip-text text-transparent">
                  Care Capacity Dashboard
                </div>
                <div className="text-xs text-muted-foreground font-medium opacity-80">Workforce Intelligence</div>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-3">
              <BranchSelector />
              <button
                onClick={() => setHelpOpen(true)}
                aria-label="Help and Support"
                title="Help & Support"
                className="p-1.5 rounded-lg bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border border-gray-200/30 dark:border-gray-700/30 hover:bg-white/80 dark:hover:bg-gray-800/80 transition-colors"
              >
                <HelpCircle className="h-4 w-4 text-gray-500 dark:text-gray-400" />
              </button>
              <div className="p-1 rounded-lg bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border border-gray-200/30 dark:border-gray-700/30">
                <ThemeToggle />
              </div>
              <UserMenu />
            </div>
          </div>
        </div>
      </nav>
      <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}

// ─── Protected Router ─────────────────────────────────────────────────────────

function Router() {
  const { isReady, isLoadingBranches } = useBranch();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-emerald-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 overflow-x-hidden">
      <Navigation />
      <main className="animate-fade-in pt-20 overflow-x-hidden">
        {!isReady ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
              <p className="text-gray-600 dark:text-gray-400">
                {isLoadingBranches ? 'Loading branches...' : 'Initializing...'}
              </p>
            </div>
          </div>
        ) : (
          <Switch>
            {/* Legacy redirects — keep backward compatibility */}
            <Route path="/"><Redirect to="/app/dashboard" /></Route>
            <Route path="/admin"><Redirect to="/app/admin" /></Route>

            {/* App routes */}
            <Route path="/app/dashboard" component={Dashboard} />
            <Route path="/app/admin" component={AdminPage} />
            <Route path="/app/bd-matrix" component={BDMatrixPage} />
            <Route path="/app/schedule">
              <PageSuspense><ScheduleModule /></PageSuspense>
            </Route>
            <Route path="/app/people-planner">
              <PageSuspense><PeoplePlannerModule /></PageSuspense>
            </Route>
            <Route path="/app/data-management">
              <PageSuspense><DataManagementModule /></PageSuspense>
            </Route>

            <Route component={NotFound} />
          </Switch>
        )}
      </main>
    </div>
  );
}

// ─── Session Timeout Manager ──────────────────────────────────────────────────
// Handles inactivity detection, warning dialog, and automatic logout.
// Mounted only when the user is authenticated.

function SessionTimeoutManager() {
  const { logout } = useAuth();

  // stable reference so onExpire never changes identity
  const logoutRef = useRef(logout);
  useEffect(() => { logoutRef.current = logout; }, [logout]);

  const handleExpire = useCallback(() => { logoutRef.current(); }, []);

  const { showWarning, secondsRemaining, extend } = useSessionTimeout({ onExpire: handleExpire });

  // Wire the global 401 handler so any server-expired request also logs out
  useEffect(() => {
    setUnauthorizedHandler(() => { logoutRef.current(); });
    return () => setUnauthorizedHandler(null);
  }, []);

  const minutes = Math.floor(secondsRemaining / 60);
  const secs    = secondsRemaining % 60;

  const handleStayIn = async () => {
    extend();
    // Touch the server session so the rolling cookie is refreshed
    try { await fetch('/api/auth/me', { credentials: 'include' }); } catch { /* ignore */ }
  };

  return (
    <Dialog open={showWarning} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-md rounded-2xl border-0 shadow-2xl"
        onPointerDownOutside={e => e.preventDefault()}
        onEscapeKeyDown={e => e.preventDefault()}
      >
        <DialogHeader className="items-center text-center gap-3 pt-2">
          <div className="mx-auto w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
            <Clock className="w-7 h-7 text-amber-600 dark:text-amber-400" />
          </div>
          <DialogTitle className="text-xl font-bold text-gray-900 dark:text-white">
            Session Expiring Soon
          </DialogTitle>
          <DialogDescription className="text-center text-sm text-gray-600 dark:text-gray-400">
            You've been inactive for a while. For your security you'll be automatically signed out in:
          </DialogDescription>
        </DialogHeader>

        {/* Countdown */}
        <div className="flex items-center justify-center gap-3 my-2">
          <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-xl px-6 py-3 text-center min-w-[100px]">
            <span className="text-4xl font-black tabular-nums text-amber-700 dark:text-amber-300">
              {String(minutes).padStart(2, '0')}:{String(secs).padStart(2, '0')}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg px-3 py-2 text-xs text-blue-700 dark:text-blue-300 mx-0.5">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          Any unsaved work will remain — your data is safe.
        </div>

        <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 mt-1">
          <Button
            variant="outline"
            onClick={() => logout()}
            className="flex-1 rounded-xl border-gray-300 dark:border-gray-600"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out Now
          </Button>
          <Button
            onClick={handleStayIn}
            className="flex-1 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold shadow-lg"
          >
            <Clock className="w-4 h-4 mr-2" />
            Stay Signed In
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Auth Gate ────────────────────────────────────────────────────────────────

function AuthGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-emerald-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <>
      <SessionTimeoutManager />
      {children}
    </>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

function App() {
  useEffect(() => {
    const fixRadixFocusGuards = () => {
      document.querySelectorAll<HTMLElement>('span[aria-hidden="true"][tabindex="0"]').forEach(el => {
        el.setAttribute('tabindex', '-1');
      });
    };
    fixRadixFocusGuards();
    const observer = new MutationObserver(() => fixRadixFocusGuards());
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BranchProvider>
            <TooltipProvider>
              <Toaster />
              <CookieBanner />
              <Switch>
                <Route path="/privacy" component={PrivacyPolicy} />
                <Route path="/terms" component={Terms} />
                <Route>
                  <AuthGate>
                    <Router />
                  </AuthGate>
                </Route>
              </Switch>
            </TooltipProvider>
          </BranchProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
