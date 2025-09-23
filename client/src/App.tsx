import { Switch, Route, Link, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import Dashboard from "@/pages/dashboard";
import NotFound from "@/pages/not-found";
import { ThemeToggle } from "@/components/theme-toggle";
import homeInsteadLogo from "@assets/Screenshot 2025-09-23 154530_1758642491375.png";

function Navigation() {
  const [location] = useLocation();
  
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
                  alt="Home Instead" 
                  className="h-8 w-auto object-contain"
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

          {/* Status & Controls */}
          <div className="flex items-center gap-4">
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
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-emerald-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
      <Navigation />
      <main className="animate-fade-in pt-20">
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
