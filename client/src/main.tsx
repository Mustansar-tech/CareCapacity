import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { BranchProvider } from "./contexts/BranchContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import App from './App';
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BranchProvider>
          <App />
          <Toaster />
        </BranchProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);