import { Switch, Route, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/dashboard";
import NotFound from "@/pages/not-found";
import { ThemeToggle } from "@/components/theme-toggle";
import { BranchProvider, useBranch } from "@/contexts/BranchContext";
import { BranchSelector } from "@/components/BranchSelector";
import { SplashScreen } from "@/components/SplashScreen";
import homeInsteadLogo from "@/assets/logo.png";
import { Component, ErrorInfo, ReactNode, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

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

function Navigation() {
  
  return (
    <nav className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-6xl px-4" data-testid="main-navigation">
      <div className="glass elevation-3 bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-2xl px-6 py-3 shadow-2xl">
        <div className="flex items-center justify-between">
          {/* Logo Section */}
          <Link href="/" className="group" data-testid="link-home">
            <div className="flex items-center gap-3 transition-all duration-300 hover:scale-105">
              <div className="relative">
                <img 
                  src={homeInsteadLogo} 
                  alt="Care Capacity Dashboard" 
                  className="h-20 w-20 rounded-full object-cover border-2 border-white/20 shadow-lg"
                />
              </div>
              <div className="hidden sm:block">
                <div className="text-sm font-display font-semibold bg-gradient-to-r from-blue-600 via-emerald-600 to-blue-600 bg-clip-text text-transparent animate-gradient">
                  Care Capacity Dashboard
                </div>
                <div className="text-xs text-muted-foreground">Workforce Intelligence</div>
              </div>
            </div>
          </Link>

          {/* Branch Selector & Controls */}
          <div className="flex items-center gap-4">
            {/* Branch Selector */}
            <BranchSelector />
            
            {/* Theme Toggle with Enhanced Styling */}
            <div className="p-1 rounded-lg bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border border-gray-200/30 dark:border-gray-700/30" data-testid="theme-toggle-container">
              <ThemeToggle />
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}

function Router() {
  const { isReady, isLoadingBranches } = useBranch();
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-emerald-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
      <Navigation />
      <main className="animate-fade-in pt-20">
        {!isReady ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600 dark:text-gray-400">
                {isLoadingBranches ? 'Loading branches...' : 'Initializing branch selection...'}
              </p>
            </div>
          </div>
        ) : (
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route component={NotFound} />
          </Switch>
        )}
      </main>
    </div>
  );
}

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
              <Router />
            )}
          </TooltipProvider>
        </BranchProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
