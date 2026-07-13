import { Switch, Route, Link, useSearch } from "wouter";
import { queryClient, setUnauthorizedHandler, toAbsoluteUrl } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense } from "react";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import ResetPasswordPage from "@/pages/reset-password";
import PrivacyPolicy from "@/pages/privacy-policy";
import Terms from "@/pages/terms";
import CookiePolicy from "@/pages/cookie-policy";
import { LegalConsentModal } from "@/components/LegalConsentModal";
import { CURRENT_LEGAL_VERSION } from "@shared/schema";
import { BranchProvider, useBranch } from "@/contexts/BranchContext";
import { WeekProvider, useWeek } from "@/contexts/WeekContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { BranchSelector } from "@/components/BranchSelector";
import { CookieBanner } from "@/components/CookieBanner";
import { HelpPanel } from "@/components/HelpPanel";
import homeInsteadLogo from "@/assets/logo.png";
import { Component, ComponentType, ErrorInfo, ReactNode, useState, useEffect, useRef, useCallback } from "react";
import { Shield, LogOut, ChevronDown, Clock, AlertTriangle, HelpCircle, BarChart3, Calendar, Users, BookOpen, TrendingUp, UserCheck } from "lucide-react";
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
import { useLocation } from "wouter";
import { useSessionTimeout } from "@/hooks/use-session-timeout";
import { AppLayout } from "@/components/layout/AppLayout";
import { SyncStatusBar } from "@/components/SyncStatusBar";

// ─── Lazy page modules ────────────────────────────────────────────────────────

const DashboardModule = lazy(() => import("@/pages/dashboard"));
const AdminModule = lazy(() => import("@/pages/admin"));
const BDMatrixModule = lazy(() => import("@/pages/bd-matrix"));
const CapacityOutlookModule = lazy(() => import("@/pages/capacity-outlook"));
const ScheduleModule = lazy(() => import("@/pages/schedule"));
const PeoplePlannerModule = lazy(() => import("@/pages/people-planner"));
const DocsModule = lazy(() => import("@/pages/docs"));
const WorkforceModule = lazy(() => import("@/pages/workforce"));

// ─── Shared utilities ─────────────────────────────────────────────────────────

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
  useEffect(() => { navigate(to); }, [to]);
  return null;
}

// ─── Page components ──────────────────────────────────────────────────────────

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
  const { processedData, selectedDate } = useWeek();

  return (
    <PageSuspense>
      <BDMatrixModule
        data={processedData}
        weekStartDate={selectedDate ?? undefined}
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

// ─── User Menu ────────────────────────────────────────────────────────────────

function UserMenu() {
  const { user, logout, isAdmin } = useAuth();
  const [, navigate] = useLocation();

  if (!user) return null;

  const initials = user.displayName
    .split(" ")
    .map((n: string) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2.5 outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded group">
          <div className="h-7 w-7 rounded-full bg-white/20 flex items-center justify-center text-white text-[11px] font-semibold shrink-0 group-hover:bg-white/30 transition-colors">
            {initials}
          </div>
          <span className="hidden sm:block text-sm text-white/85 whitespace-nowrap group-hover:text-white transition-colors">
            {user.displayName}
          </span>
          <ChevronDown className="h-3 w-3 text-white/40 hidden sm:block" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 mt-1">
        <DropdownMenuLabel className="font-normal py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-[12px] font-semibold">
              {initials}
            </div>
            <div className="flex flex-col">
              <p className="text-sm font-semibold leading-none">{user.displayName}</p>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{user.email}</p>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => navigate('/app/docs')} className="cursor-pointer">
            <BookOpen className="mr-2 h-4 w-4 text-indigo-500" />
            <span>Documentation</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {isAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => navigate('/app/admin')} className="cursor-pointer">
                <Shield className="mr-2 h-4 w-4 text-blue-500" />
                <span>Administration</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}
        <DropdownMenuSeparator />
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

interface NavItem {
  label: string;
  path: string;
  search?: string;
  icon: ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Home",             path: "/app/dashboard",                         icon: BarChart3  },
  { label: "Daily View",       path: "/app/dashboard", search: "view=daily",   icon: Calendar   },
  { label: "BD Matrix",        path: "/app/bd-matrix",                         icon: Users      },
  { label: "Schedule",         path: "/app/schedule",                          icon: Calendar   },
  { label: "Capacity Outlook", path: "/app/capacity-outlook",                  icon: TrendingUp },
  { label: "Workforce",        path: "/app/workforce",                         icon: UserCheck  },
];

function Navigation() {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const { isAdmin } = useAuth();
  const [helpOpen, setHelpOpen] = useState(false);

  const visibleItems = NAV_ITEMS.filter(item => !item.adminOnly || isAdmin);

  function isItemActive(item: NavItem): boolean {
    const pathMatches = location === item.path || location.startsWith(item.path + "/");
    if (!pathMatches) return false;
    const params = new URLSearchParams(search);
    if (item.search) {
      const itemParams = new URLSearchParams(item.search);
      for (const [key, val] of itemParams.entries()) {
        if (params.get(key) !== val) return false;
      }
      return true;
    }
    // "Home" tab is active on /app/dashboard when NOT showing view=daily
    if (item.path === "/app/dashboard") return params.get("view") !== "daily";
    return true;
  }

  return (
    <>
      <header
        className="z-50 flex flex-col shrink-0"
        data-testid="main-navigation"
      >
        {/* ── Row 1: dark green utility bar — 48px ── */}
        <div
          className="flex items-center px-6 gap-6"
          style={{ height: "48px", background: "#2c4f26" }}
        >
          {/* Brand: logo + product name */}
          <button
            className="flex items-center gap-2.5 shrink-0 group outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded"
            onClick={() => navigate("/app/dashboard")}
            aria-label="Go to dashboard"
          >
            <img
              src={homeInsteadLogo}
              alt="Home Instead"
              className="h-6 w-auto rounded object-contain opacity-85 group-hover:opacity-100 transition-opacity"
            />
            <span className="hidden md:block text-sm font-semibold text-white/90 whitespace-nowrap group-hover:text-white transition-colors">
              Care Capacity
            </span>
          </button>

          {/* Soft rule */}
          <div className="h-4 w-px bg-white/10 shrink-0" />

          {/* Location selector */}
          <BranchSelector />

          {/* Spacer — pushes right group to far right */}
          <div className="flex-1" />

          {/* Right icon cluster */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setHelpOpen(true)}
              aria-label="Help and Support"
              title="Help & Support"
              className="p-1.5 text-white/65 hover:text-white transition-colors"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          </div>

          {/* Soft rule */}
          <div className="h-4 w-px bg-white/10 shrink-0" />

          {/* User */}
          <UserMenu />
        </div>

        {/* ── Row 2: workspace tabs — 38px ── */}
        <div
          className="flex items-end px-4 gap-0 dark:bg-gray-800 dark:border-gray-700"
          style={{
            height: "38px",
            background: "#f5f6f7",
            borderBottom: "1px solid #e5e7eb",
          }}
        >
          {visibleItems.map((item) => {
            const active = isItemActive(item);
            const href = item.search ? `${item.path}?${item.search}` : item.path;
            return (
              <Link
                key={item.label}
                href={href}
                className={[
                  "flex items-center gap-2 px-12 h-[34px] text-sm font-medium whitespace-nowrap transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-slate-300 rounded-t-md select-none",
                  active
                    ? "text-slate-700 dark:text-white"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-white/60 dark:hover:bg-gray-700/50",
                ].join(" ")}
                style={active ? {
                  background: "#f8f8f8",
                  border: "1px solid #e5e7eb",
                  borderBottom: "1px solid #f8f8f8",
                  borderTop: "2px solid #2c4f26",
                } : {}}
              >
                <item.icon className="w-3.5 h-3.5 flex-shrink-0 opacity-75" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </header>
      <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}

// ─── Session Timeout Manager ──────────────────────────────────────────────────

function SessionTimeoutManager() {
  const { logout } = useAuth();

  const logoutRef = useRef(logout);
  useEffect(() => { logoutRef.current = logout; }, [logout]);

  const handleExpire = useCallback(() => { logoutRef.current(); }, []);

  const { showWarning, secondsRemaining, extend } = useSessionTimeout({ onExpire: handleExpire });

  useEffect(() => {
    setUnauthorizedHandler(() => { logoutRef.current(); });
    return () => setUnauthorizedHandler(null);
  }, []);

  const minutes = Math.floor(secondsRemaining / 60);
  const secs    = secondsRemaining % 60;

  const handleStayIn = async () => {
    extend();
    try { await fetch(toAbsoluteUrl('/api/auth/me'), { credentials: 'include' }); } catch { /* ignore */ }
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

// ─── Login Route ──────────────────────────────────────────────────────────────
// Shows the login page. If already authenticated, redirects to /app/dashboard.

function LoginRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate('/app/dashboard');
    }
  }, [isAuthenticated, isLoading]);

  if (isLoading || isAuthenticated) return null;

  return <LoginPage />;
}

// ─── Protected Route ──────────────────────────────────────────────────────────
// Guards all /app/* routes. Redirects unauthenticated users to /login.



function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [, navigate] = useLocation();
  const needsConsent = isAuthenticated && user && user.legalConsentVersion !== CURRENT_LEGAL_VERSION;

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, isLoading]);

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

  if (!isAuthenticated) return null;

  return (
    <>
      <LegalConsentModal open={!!needsConsent} />
      <SessionTimeoutManager />
      {!needsConsent && children}
    </>
  );
}

// ─── Protected Router ─────────────────────────────────────────────────────────

function Router() {
  const { isReady, isLoadingBranches } = useBranch();

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gradient-to-br from-blue-50 via-white to-emerald-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
      <Navigation />
      <SyncStatusBar />
      <main className="flex-1 overflow-y-auto overflow-x-hidden animate-fade-in">
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
            {/* Legacy redirects — backward compatibility */}
            <Route path="/"><Redirect to="/app/dashboard" /></Route>
            <Route path="/admin"><Redirect to="/app/admin" /></Route>

            {/* App routes — all wrapped in AppLayout (sidebar + content offset) */}
            <Route path="/app/dashboard">
              <AppLayout><Dashboard /></AppLayout>
            </Route>
            <Route path="/app/admin">
              <AppLayout><AdminPage /></AppLayout>
            </Route>
            <Route path="/app/bd-matrix">
              <AppLayout><BDMatrixPage /></AppLayout>
            </Route>
            <Route path="/app/schedule">
              <AppLayout><PageSuspense><ScheduleModule /></PageSuspense></AppLayout>
            </Route>
            <Route path="/app/people-planner">
              <AppLayout><PageSuspense><PeoplePlannerModule /></PageSuspense></AppLayout>
            </Route>
            <Route path="/app/capacity-outlook">
              <AppLayout><PageSuspense><CapacityOutlookModule /></PageSuspense></AppLayout>
            </Route>
            <Route path="/app/workforce">
              <AppLayout><PageSuspense><WorkforceModule /></PageSuspense></AppLayout>
            </Route>
            <Route path="/app/docs">
              <PageSuspense><DocsModule /></PageSuspense>
            </Route>

            <Route component={NotFound} />
          </Switch>
        )}
      </main>
    </div>
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
            <WeekProvider>
            <TooltipProvider>
              <Toaster />
              <CookieBanner />
              <Switch>
                <Route path="/privacy" component={PrivacyPolicy} />
                <Route path="/terms" component={Terms} />
                <Route path="/cookies" component={CookiePolicy} />
                <Route path="/docs"><Redirect to="/app/docs" /></Route>
                <Route path="/login" component={LoginRoute} />
                <Route path="/reset-password" component={ResetPasswordPage} />
                <Route>
                  <ProtectedRoute>
                    <Router />
                  </ProtectedRoute>
                </Route>
              </Switch>
            </TooltipProvider>
            </WeekProvider>
          </BranchProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
