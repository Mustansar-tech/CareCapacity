import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ProcessingResultWithMeta } from "@shared/schema";

const WeeklyPlanTab = lazy(() =>
  import("@/components/weekly-plan-tab").then((m) => ({ default: m.WeeklyPlanTab }))
);

export default function SchedulePage() {
  const { data: latestData, isLoading } = useQuery<ProcessingResultWithMeta>({
    queryKey: ["/api/history/latest"],
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="w-full px-6 py-4">
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        }
      >
        <WeeklyPlanTab
          data={latestData ?? null}
          selectedDate={latestData?.weekStartDate ?? null}
        />
      </Suspense>
    </div>
  );
}
