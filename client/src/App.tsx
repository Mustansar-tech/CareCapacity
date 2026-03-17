import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense } from "react";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import { ThemeToggle } from "@/components/theme-toggle";
import { BranchProvider, useBranch } from "@/contexts/BranchContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { BranchSelector } from "@/components/BranchSelector";
import { SplashScreen } from "@/components/SplashScreen";
import homeInsteadLogo from "@/assets/logo.png";
import { Component, ErrorInfo, ReactNode, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Shield, LogOut, ChevronDown, User } from "lucide-react";
import { Button } from "@/components/ui/button";
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

// Lazy load heavy pages
const DashboardModule = lazy(() => import("@/pages/dashboard"));
const AdminModule = lazy(() => import("@/pages/admin"));

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
            onClick={() => navigate('/')}
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
            <DropdownMenuItem onClick={() => navigate('/admin')} className="cursor-pointer">
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

  return (
    <nav className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-6xl px-4" data-testid="main-navigation">
      <div className="glass elevation-3 bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-2xl px-6 py-2 shadow-2xl">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <div
            className="flex items-center gap-3 cursor-pointer group transition-all duration-300 hover:scale-102"
            onClick={() => navigate('/')}
            role="link"
            aria-label="Navigate to Care Capacity Dashboard"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') navigate('/');
            }}
          >
            <div className="relative">
              <img
                src={homeInsteadLogo}
                alt="Care Capacity Dashboard"
                className="h-16 w-16 rounded-full object-cover border-2 border-white/40 shadow-xl group-hover:shadow-blue-500/20 transition-all"
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
            <div className="p-1 rounded-lg bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border border-gray-200/30 dark:border-gray-700/30">
              <ThemeToggle />
            </div>
            <UserMenu />
          </div>
        </div>
      </div>
    </nav>
  );
}

// ─── Protected Router ─────────────────────────────────────────────────────────

function Router() {
  const { isReady, isLoadingBranches } = useBranch();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-emerald-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
      <Navigation />
      <main className="animate-fade-in pt-20">
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
            <Route path="/" component={Dashboard} />
            <Route path="/admin" component={AdminPage} />
            <Route component={NotFound} />
          </Switch>
        )}
      </main>
    </div>
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

  return <>{children}</>;
}

// ─── App ──────────────────────────────────────────────────────────────────────

function App() {
  const [showSplash, setShowSplash] = useState(() => {
    const hasSeenSplash = sessionStorage.getItem('hasSeenSplash');
    return !hasSeenSplash;
  });

  const handleSplashComplete = () => {
    sessionStorage.setItem('hasSeenSplash', 'true');
    setShowSplash(false);
  };

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BranchProvider>
            <TooltipProvider>
              <Toaster />
              {showSplash ? (
                <SplashScreen
                  key="splash"
                  onComplete={handleSplashComplete}
                  minimumDisplayTime={2500}
                />
              ) : (
                <AuthGate>
                  <Router />
                </AuthGate>
              )}
            </TooltipProvider>
          </BranchProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
