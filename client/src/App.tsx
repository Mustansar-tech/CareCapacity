import { Switch, Route, Link, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { BarChart3Icon, Calendar, Shield } from "lucide-react";
import Dashboard from "@/pages/dashboard";
import MonthlyAnalysis from "@/pages/monthly-analysis";
import DataManagement from "@/pages/data-management";
import NotFound from "@/pages/not-found";
import { ThemeToggle } from "@/components/theme-toggle";

function Navigation() {
  const [location] = useLocation();
  
  return (
    <nav className="glass backdrop-blur-lg bg-white/80 dark:bg-gray-900/80 border-b border-white/20 dark:border-gray-700/50 px-6 py-4 sticky top-0 z-50" data-testid="main-navigation">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg gradient-bg flex items-center justify-center">
              <BarChart3Icon className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-emerald-600 bg-clip-text text-transparent">
              Care Capacity Dashboard
            </h1>
          </div>
          <div className="flex gap-1 bg-gray-100/50 dark:bg-gray-800/50 p-1 rounded-lg backdrop-blur-sm">
            <Link href="/">
              <Button 
                variant={location === "/" ? "default" : "ghost"} 
                size="sm"
                className={`flex items-center gap-2 transition-all duration-200 ${
                  location === "/" 
                    ? "bg-white dark:bg-gray-700 shadow-sm" 
                    : "hover:bg-white/50 dark:hover:bg-gray-700/50"
                }`}
                data-testid="nav-dashboard"
              >
                <BarChart3Icon className="w-4 h-4" />
                Dashboard
              </Button>
            </Link>
            <Link href="/monthly-analysis">
              <Button 
                variant={location === "/monthly-analysis" ? "default" : "ghost"} 
                size="sm"
                className={`flex items-center gap-2 transition-all duration-200 ${
                  location === "/monthly-analysis" 
                    ? "bg-white dark:bg-gray-700 shadow-sm" 
                    : "hover:bg-white/50 dark:hover:bg-gray-700/50"
                }`}
                data-testid="nav-monthly-analysis"
              >
                <Calendar className="w-4 h-4" />
                Monthly Analysis
              </Button>
            </Link>
            <Link href="/data-management">
              <Button 
                variant={location === "/data-management" ? "default" : "ghost"} 
                size="sm"
                className={`flex items-center gap-2 transition-all duration-200 ${
                  location === "/data-management" 
                    ? "bg-white dark:bg-gray-700 shadow-sm" 
                    : "hover:bg-white/50 dark:hover:bg-gray-700/50"
                }`}
                data-testid="nav-data-management"
              >
                <Shield className="w-4 h-4" />
                Data Privacy
              </Button>
            </Link>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full status-pulse" title="System Online"></div>
            <span className="text-xs text-gray-500 dark:text-gray-400">Online</span>
          </div>
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}

function Router() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-emerald-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
      <Navigation />
      <main className="animate-fade-in">
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/monthly-analysis" component={MonthlyAnalysis} />
          <Route path="/data-management" component={DataManagement} />
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
