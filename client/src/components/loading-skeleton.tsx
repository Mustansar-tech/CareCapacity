import React from "react";

interface LoadingSkeletonProps {
  className?: string;
  lines?: number;
  type?: 'card' | 'table' | 'metric';
}

export function LoadingSkeleton({ className = "", lines = 3, type = 'card' }: LoadingSkeletonProps) {
  if (type === 'metric') {
    return (
      <div className={`animate-pulse ${className}`}>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-lg skeleton dark:skeleton-dark"></div>
          <div className="w-24 h-4 skeleton dark:skeleton-dark rounded"></div>
        </div>
        <div className="w-20 h-8 skeleton dark:skeleton-dark rounded mb-1"></div>
        <div className="w-16 h-3 skeleton dark:skeleton-dark rounded"></div>
      </div>
    );
  }

  if (type === 'table') {
    return (
      <div className={`animate-pulse space-y-3 ${className}`}>
        <div className="grid grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-4 skeleton dark:skeleton-dark rounded"></div>
          ))}
        </div>
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="grid grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, j) => (
              <div key={j} className="h-4 skeleton dark:skeleton-dark rounded"></div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`animate-pulse space-y-3 ${className}`}>
      <div className="h-4 skeleton dark:skeleton-dark rounded w-3/4"></div>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 skeleton dark:skeleton-dark rounded"></div>
      ))}
      <div className="h-4 skeleton dark:skeleton-dark rounded w-1/2"></div>
    </div>
  );
}

export function MetricCardSkeleton() {
  return (
    <div className="glass p-6 rounded-lg animate-pulse">
      <LoadingSkeleton type="metric" />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="glass p-6 rounded-lg">
      <LoadingSkeleton type="table" lines={rows} />
    </div>
  );
}