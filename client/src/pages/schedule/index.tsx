import { lazy, Suspense } from "react";
import { useWeek } from "@/contexts/WeekContext";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";

const WeeklyPlanTab = lazy(() =>
  import("@/components/weekly-plan-tab").then((m) => ({ default: m.WeeklyPlanTab }))
);

function fmt(iso: string) {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export default function SchedulePage() {
  const {
    processedData,
    selectedDate,
    isLoadingLatest,
    allHistoryData,
    selectedWeekId,
    handleWeekChange,
  } = useWeek();

  // Sorted newest-first (same order as the Overview dropdown)
  const sorted = (allHistoryData ?? [])
    .slice()
    .sort((a, b) => b.weekStartDate.localeCompare(a.weekStartDate));

  const currentIdx = selectedWeekId
    ? sorted.findIndex(w => w.id === selectedWeekId)
    : sorted.findIndex(w => {
        const d = new Date();
        const mon = new Date(d);
        const dow = mon.getUTCDay();
        mon.setUTCDate(mon.getUTCDate() - (dow === 0 ? 6 : dow - 1));
        return w.weekStartDate === mon.toISOString().split("T")[0];
      });

  const effectiveIdx = currentIdx === -1 ? 0 : currentIdx;
  const canPrev = effectiveIdx < sorted.length - 1; // older
  const canNext = effectiveIdx > 0;                  // newer

  const activeWeek = sorted[effectiveIdx];

  if (isLoadingLatest && !processedData) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-hidden flex flex-col">
      {/* Week navigation bar */}
      {sorted.length > 0 && (
        <div
          style={{
            height: 48,
            background: "white",
            borderBottom: "1px solid #E5E9F2",
            display: "flex",
            alignItems: "center",
            padding: "0 16px",
            gap: 8,
            flexShrink: 0,
            boxShadow: "0 1px 3px rgba(15,23,42,.04)",
            zIndex: 10,
          }}
        >
          <CalendarDays style={{ width: 16, height: 16, color: "#64748B", flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "#475569", flexShrink: 0 }}>Week:</span>

          {/* Prev (older) */}
          <button
            disabled={!canPrev}
            onClick={() => canPrev && handleWeekChange(sorted[effectiveIdx + 1].id)}
            style={{
              width: 28, height: 28, borderRadius: 6, border: "1px solid #E2E8F0",
              background: canPrev ? "white" : "#F8FAFC",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: canPrev ? "pointer" : "not-allowed", flexShrink: 0,
              color: canPrev ? "#334155" : "#CBD5E1",
            }}
            title="Previous week"
          >
            <ChevronLeft style={{ width: 14, height: 14 }} />
          </button>

          {/* Dropdown */}
          <select
            value={selectedWeekId ?? (activeWeek?.id ?? "")}
            onChange={e => handleWeekChange(e.target.value)}
            style={{
              flex: 1, maxWidth: 260, height: 30, borderRadius: 6,
              border: "1px solid #E2E8F0", background: "white",
              fontSize: 12, fontWeight: 600, color: "#0F172A",
              padding: "0 8px", cursor: "pointer", outline: "none",
            }}
          >
            {sorted.map(w => (
              <option key={w.id} value={w.id}>
                {fmt(w.weekStartDate)} – {fmt(w.weekEndDate ?? "")}
              </option>
            ))}
          </select>

          {/* Next (newer) */}
          <button
            disabled={!canNext}
            onClick={() => canNext && handleWeekChange(sorted[effectiveIdx - 1].id)}
            style={{
              width: 28, height: 28, borderRadius: 6, border: "1px solid #E2E8F0",
              background: canNext ? "white" : "#F8FAFC",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: canNext ? "pointer" : "not-allowed", flexShrink: 0,
              color: canNext ? "#334155" : "#CBD5E1",
            }}
            title="Next week"
          >
            <ChevronRight style={{ width: 14, height: 14 }} />
          </button>

          {activeWeek && (
            <span style={{ fontSize: 11, color: "#94A3B8", flexShrink: 0, marginLeft: 4 }}>
              {fmt(activeWeek.weekStartDate)}
            </span>
          )}
        </div>
      )}

      {/* Schedule content */}
      <div style={{ flex: 1, overflow: "hidden" }}>
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
    </div>
  );
}
