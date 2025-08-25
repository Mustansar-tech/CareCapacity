import { Switch, Route, Link, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { BarChart3Icon, Calendar } from "lucide-react";
import Dashboard from "@/pages/dashboard";
import MonthlyAnalysis from "@/pages/monthly-analysis";
import NotFound from "@/pages/not-found";

function Navigation() {
  const [location] = useLocation();
  
  return (
    <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4" data-testid="main-navigation">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Care Capacity Dashboard</h1>
          <div className="flex gap-2">
            <Link href="/">
              <Button 
                variant={location === "/" ? "default" : "ghost"} 
                className="flex items-center gap-2"
                data-testid="nav-dashboard"
              >
                <BarChart3Icon className="w-4 h-4" />
                Dashboard
              </Button>
            </Link>
            <Link href="/monthly-analysis">
              <Button 
                variant={location === "/monthly-analysis" ? "default" : "ghost"} 
                className="flex items-center gap-2"
                data-testid="nav-monthly-analysis"
              >
                <Calendar className="w-4 h-4" />
                Monthly Analysis
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}

function Router() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navigation />
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/monthly-analysis" component={MonthlyAnalysis} />
        <Route component={NotFound} />
      </Switch>
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
