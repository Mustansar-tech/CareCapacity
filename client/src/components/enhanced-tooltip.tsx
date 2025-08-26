import React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface EnhancedTooltipProps {
  children: React.ReactNode;
  content: string;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

export function EnhancedTooltip({ 
  children, 
  content, 
  side = "top", 
  className = "" 
}: EnhancedTooltipProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {children}
        </TooltipTrigger>
        <TooltipContent 
          side={side} 
          className={`bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 px-3 py-2 rounded-lg shadow-lg border-0 animate-scale-in ${className}`}
        >
          <p className="text-sm font-medium">{content}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}