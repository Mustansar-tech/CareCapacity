import { lazy, Suspense } from "react";
import { useWeek } from "@/contexts/WeekContext";

const WeeklyPlanTab = lazy(() =>
  import("@/components/weekly-plan-tab").then((m) => ({ default: m.WeeklyPlanTab }))
);

export default function SchedulePage() {
  const { processedData, selectedDate, isLoadingLatest } = useWeek();

  if (isLoadingLatest && !processedData) {
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
          data={processedData}
          selectedDate={selectedDate}
        />
      </Suspense>
    </div>
  );
}
