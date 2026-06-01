import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { clientLogger } from '@/lib/logger';
import { useQuery } from '@tanstack/react-query';
import { queryClient, toAbsoluteUrl } from '@/lib/queryClient';
import { useBranch } from '@/contexts/BranchContext';
import type { ProcessingResult, CapacityAnalysisHeader, CapacityAnalysisSummary, ProcessingResultWithMeta } from '@shared/schema';
import { useToast } from '@/hooks/use-toast';

interface WeekContextType {
  selectedWeekId: string | null;
  selectedDate: string | null;
  processedData: ProcessingResult | null;
  filteredData: ProcessingResult | null;
  allHistoryData: CapacityAnalysisHeader[] | undefined;
  latestData: ProcessingResultWithMeta | undefined;
  isLoadingLatest: boolean;
  latestDataError: unknown;
  handleWeekChange: (value: string) => void;
  setProcessedData: (data: ProcessingResult | null) => void;
  setFilteredData: (data: ProcessingResult | null) => void;
  setSelectedDate: (date: string | null) => void;
  setSelectedWeekId: (id: string | null) => void;
  /** After uploading & processing new files — sets fresh data immediately, guards against stale cache overwrite. */
  resetToLatest: (freshData: ProcessingResult, freshDate: string | null) => void;
  /** After an external sync (e.g. People Planner) — clears data, guards against stale cache, waits for fresh latestData. */
  switchToLatest: () => void;
}

const WeekContext = createContext<WeekContextType | undefined>(undefined);

/**
 * Returns a stable string key for a latestData snapshot.
 * Used to detect when latestData has actually been refreshed with new content.
 */
function latestDataKey(d: ProcessingResultWithMeta | undefined | null): string {
  if (!d) return 'none';
  const ts = d.uploadedAt ? new Date(d.uploadedAt as any).getTime() : 0;
  return `${d.id ?? 'no-id'}_${ts}`;
}

export function WeekProvider({ children }: { children: ReactNode }) {
  const { selectedBranchId } = useBranch();
  const { toast } = useToast();

  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [processedData, setProcessedData] = useState<ProcessingResult | null>(null);
  const [filteredData, setFilteredData] = useState<ProcessingResult | null>(null);

  // Refs so effects can read current values without becoming their dependencies
  const processedDataRef = useRef<ProcessingResult | null>(null);
  const latestDataRef = useRef<ProcessingResultWithMeta | undefined>(undefined);
  const toastRef = useRef(toast);

  useEffect(() => { processedDataRef.current = processedData; });
  useEffect(() => { toastRef.current = toast; });

  /**
   * When defined: the auto-load effect will skip any latestData whose key
   * matches this value (i.e. the stale entry we were on before triggering a
   * reset/switch). Cleared as soon as latestData changes to a new key.
   */
  const skipLatestKey = useRef<string | undefined>(undefined);

  // ─── Queries — branchId is part of the key so they re-fire on branch change
  // and only run once a branch is actually selected (enabled: !!selectedBranchId)

  const { data: allHistoryData } = useQuery<CapacityAnalysisHeader[]>({
    queryKey: ['/api/history', selectedBranchId],
    enabled: !!selectedBranchId,
    queryFn: async () => {
      const res = await fetch(toAbsoluteUrl(`/api/history?branchId=${encodeURIComponent(selectedBranchId!)}`), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch history');
      return res.json();
    },
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const { data: latestData, error: latestDataError, isLoading: isLoadingLatest } = useQuery<ProcessingResultWithMeta>({
    queryKey: ['/api/history/latest', selectedBranchId],
    enabled: !!selectedBranchId,
    queryFn: async () => {
      const res = await fetch(toAbsoluteUrl(`/api/history/latest?branchId=${encodeURIComponent(selectedBranchId!)}`), {
        credentials: 'include',
      });
      if (res.status === 404) return undefined as any;
      if (!res.ok) throw new Error('Failed to fetch latest data');
      return res.json();
    },
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  // Keep latestDataRef in sync
  useEffect(() => { latestDataRef.current = latestData; }, [latestData]);

  // Branch change: clear local state — the query key change handles the refetch automatically
  useEffect(() => {
    clientLogger.log('🧹 Branch changed - clearing week selection and processed data');
    setProcessedData(null);
    setFilteredData(null);
    setSelectedWeekId(null);
    setSelectedDate(null);
    skipLatestKey.current = undefined;
    // Invalidate so any cached data for this branch is refreshed
    queryClient.invalidateQueries({ queryKey: ['/api/history', selectedBranchId] });
    queryClient.invalidateQueries({ queryKey: ['/api/history/latest', selectedBranchId] });
    queryClient.invalidateQueries({ queryKey: ['/api/locations'] });
  }, [selectedBranchId]);

  // Discard latestData that arrived for a different branch
  useEffect(() => {
    if (latestData && latestData.branchId !== selectedBranchId) {
      clientLogger.log('🧹 Clearing stale data from different branch');
      setProcessedData(null);
      setFilteredData(null);
    }
  }, [latestData, selectedBranchId]);

  // Auto-load latest data when no week is explicitly selected
  useEffect(() => {
    if (!latestData || selectedWeekId !== null || latestData.branchId !== selectedBranchId) return;

    const key = latestDataKey(latestData);

    if (skipLatestKey.current !== undefined) {
      if (key === skipLatestKey.current) {
        // Still the same stale entry — wait for the fresh refetch
        clientLogger.log('⏭️ Auto-load skipping stale latestData, waiting for fresh refetch', { key });
        return;
      }
      // latestData has changed to a fresh entry — clear the guard and proceed
      clientLogger.log('✅ Auto-load: fresh latestData detected, clearing skip guard', { key });
      skipLatestKey.current = undefined;
    }

    const isInitialLoad = processedDataRef.current === null;
    setProcessedData({
      kpis: latestData.kpis,
      dailySummary: latestData.dailySummary,
      employeesByDate: latestData.employeesByDate,
      employeeSummaryByDate: latestData.employeeSummaryByDate,
      warnings: latestData.warnings,
      ghLossRawSummary: (latestData as any).ghLossRawSummary,
    } as any);
    setSelectedDate(latestData.dailySummary?.[0]?.date || null);
    if (isInitialLoad) {
      toastRef.current({
        title: 'Latest Data Loaded',
        description: 'Automatically loaded your most recent analysis.',
      });
    }
  }, [latestData, selectedWeekId, selectedBranchId]);

  const handleWeekChange = useCallback(
    async (value: string) => {
      if (value === 'latest') {
        setSelectedWeekId(null);
        return;
      }
      try {
        setSelectedWeekId(value);
        setFilteredData(null);
        if (!selectedBranchId) return;
        const res = await fetch(
          toAbsoluteUrl(`/api/history/${encodeURIComponent(value)}?branchId=${encodeURIComponent(selectedBranchId)}`),
          { credentials: 'include' },
        );
        if (!res.ok) throw new Error('Failed to fetch week data');
        const analysis: CapacityAnalysisSummary = await res.json();
        setProcessedData({
          kpis: analysis.kpis,
          dailySummary: analysis.dailySummary,
          employeesByDate: analysis.employeesByDate,
          employeeSummaryByDate: analysis.employeeSummaryByDate,
          warnings: analysis.warnings,
          ghLossRawSummary: (analysis as any).ghLossRawSummary,
        } as any);
        setSelectedDate(analysis.dailySummary?.[0]?.date || null);
      } catch (error) {
        clientLogger.error('Error loading selected week:', error);
        toastRef.current({
          variant: 'destructive',
          title: 'Error Loading Week',
          description: 'Failed to load the selected week data.',
        });
      }
    },
    [selectedBranchId]
  );

  /**
   * For the Excel upload pipeline.
   * Sets fresh data immediately (no loading flash) and guards the effect
   * against overwriting it with the stale latestData cache.
   */
  const resetToLatest = useCallback((freshData: ProcessingResult, freshDate: string | null) => {
    skipLatestKey.current = latestDataKey(latestDataRef.current);
    setProcessedData(freshData);
    setSelectedDate(freshDate);
    setSelectedWeekId(null);
    setFilteredData(null);
  }, []);

  /**
   * For external syncs (People Planner) where we don't have the fresh data yet.
   * Clears the current data, arms the skip guard, then waits for latestData to
   * refresh before the auto-load effect shows the new week.
   * Call this BEFORE invalidating /api/history/latest.
   */
  const switchToLatest = useCallback(() => {
    skipLatestKey.current = latestDataKey(latestDataRef.current);
    setProcessedData(null);
    setSelectedDate(null);
    setSelectedWeekId(null);
    setFilteredData(null);
  }, []);

  return (
    <WeekContext.Provider
      value={{
        selectedWeekId,
        selectedDate,
        processedData,
        filteredData,
        allHistoryData,
        latestData,
        isLoadingLatest,
        latestDataError,
        handleWeekChange,
        setProcessedData,
        setFilteredData,
        setSelectedDate,
        setSelectedWeekId,
        resetToLatest,
        switchToLatest,
      }}
    >
      {children}
    </WeekContext.Provider>
  );
}

export function useWeek() {
  const context = useContext(WeekContext);
  if (context === undefined) {
    throw new Error('useWeek must be used within a WeekProvider');
  }
  return context;
}
