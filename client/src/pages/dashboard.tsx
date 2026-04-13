import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBranch } from "@/contexts/BranchContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, TrendingUp } from "lucide-react";

export default function Dashboard() {
  const { selectedBranchId } = useBranch();
  const [showGhLossCard] = useState(false);

  const ghLossData = useMemo(() => ({ totalLoss: 0, items: [] as Array<any> }), []);

  return (
    <div className="h-full w-full bg-background scroll-modern flex flex-col overflow-hidden" data-testid="dashboard-container">
      <div className="w-full flex-1 px-lg py-4 overflow-y-auto animate-fade-in flex flex-col">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 mb-4">
          <Card className="glass hover-lift animate-scale-in" data-testid="card-capacity-after-scheduling">
            <CardHeader className="pb-3">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <CardTitle className="text-sm font-medium flex items-center gap-2 cursor-help">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center">
                        <TrendingUp className="w-4 h-4 text-white" />
                      </div>
                      <span className="text-gray-700 dark:text-gray-300">Capacity After Scheduling</span>
                    </CardTitle>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start" className="max-w-sm text-sm z-50">
                    <div className="space-y-1.5">
                      <p className="font-semibold">Available capacity remaining</p>
                      <p className="text-xs opacity-90">Calculated as:</p>
                      <div className="text-xs space-y-1 opacity-90 font-mono">
                        <p>Net Capacity − (Domiciliary + Other Scheduled)</p>
                        <p className="text-xs opacity-75">Values &lt; 1h are excluded (floored)</p>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold bg-gradient-to-r from-green-600 to-green-800 bg-clip-text text-transparent mb-1">
                0h
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Total remaining capacity</div>
            </CardContent>
          </Card>
        </div>
        {showGhLossCard ? (
          <Card className="glass hover-lift animate-scale-in" data-testid="card-gh-loss">
            <CardHeader className="pb-3">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <CardTitle className="text-sm font-medium flex items-center gap-2 cursor-help">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
                        <AlertTriangle className="w-4 h-4 text-white" />
                      </div>
                      <span className="text-gray-700 dark:text-gray-300">GH Loss</span>
                    </CardTitle>
                  </TooltipTrigger>
                </Tooltip>
              </TooltipProvider>
            </CardHeader>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
