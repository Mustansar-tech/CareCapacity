import { ReactNode } from "react";
import { SurGroupBiSidebar } from "@/components/layout/SurGroupBiSidebar";

// Top-level shell for the SUR Group BI section — sits alongside the main
// franchise-scoped app, not nested under it. Deliberately does not render the
// main Sidebar or BranchSelector: BI views span all offices/franchises at
// once, so a single-franchise selector doesn't apply here.

interface SurGroupBiLayoutProps {
  children: ReactNode;
}

export function SurGroupBiLayout({ children }: SurGroupBiLayoutProps) {
  return (
    <div className="h-screen flex overflow-hidden bg-background">
      <SurGroupBiSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto overflow-x-hidden animate-fade-in">
          {children}
        </main>
      </div>
    </div>
  );
}
