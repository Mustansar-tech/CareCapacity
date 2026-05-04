import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { clientLogger } from '@/lib/logger';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { useBranch } from '@/contexts/BranchContext';
import type { ProcessingResult, CapacityAnalysisSummary, ProcessingResultWithMeta } from '@shared/schema';
import { useToast } from '@/hooks/use-toast';

interface WeekContextType {
  selectedWeekId: string | null;
  selectedDate: string | null;
  processedData: ProcessingResult | null;
  filteredData: ProcessingResult | null;
  allHistoryData: CapacityAnalysisSummary[] | undefined;
  latestData: ProcessingResultWithMeta | undefined;
  isLoadingLatest: boolean;
  latestDataError: unknown;
  handleWeekChange: (value: string) => void;
  setProcessedData: (data: ProcessingResult | null) => void;
  setFilteredData: (data: ProcessingResult | null) => void;
  setSelectedDate: (date: string | null) => void;
  setSelectedWeekId: (id: string | null) => void;
}

const WeekContext = createContext<WeekContextType | undefined>(undefined);

export function WeekProvider({ children }: { children: ReactNode }) {
  const { selectedBranchId } = useBranch();
  const { toast } = useToast();

  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [processedData, setProcessedData] = useState<ProcessingResult | null>(null);
  const [filteredData, setFilteredData] = useState<ProcessingResult | null>(null);

  const { data: allHistoryData } = useQuery<CapacityAnalysisSummary[]>({
    queryKey: ['/api/history'],
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const { data: latestData, error: latestDataError, isLoading: isLoadingLatest } = useQuery<ProcessingResultWithMeta>({
    queryKey: ['/api/history/latest'],
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  // When branch changes: clear selected week and reload latest for new branch
  useEffect(() => {
    clientLogger.log('🧹 Branch changed - clearing week selection and processed data');
    setProcessedData(null);
    setFilteredData(null);
    setSelectedWeekId(null);
    setSelectedDate(null);
    queryClient.invalidateQueries({ queryKey: ['/api/history'] });
    queryClient.invalidateQueries({ queryKey: ['/api/history/latest'] });
    queryClient.invalidateQueries({ queryKey: ['/api/locations'] });
  }, [selectedBranchId]);

  // If latestData arrives from a different branch, discard it
  useEffect(() => {
    if (latestData && latestData.branchId !== selectedBranchId) {
      clientLogger.log('🧹 Clearing stale data from different branch');
      setProcessedData(null);
      setFilteredData(null);
    }
  }, [latestData, selectedBranchId]);

  // Auto-load latest data when no week is explicitly selected
  useEffect(() => {
    if (latestData && !selectedWeekId && latestData.branchId === selectedBranchId) {
      const isInitialLoad = !processedData;
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
        toast({
          title: 'Latest Data Loaded',
          description: 'Automatically loaded your most recent analysis.',
        });
      }
    }
  }, [latestData, selectedWeekId, selectedBranchId, toast]);

  const handleWeekChange = useCallback(
    async (value: string) => {
      if (value === 'latest') {
        setSelectedWeekId(null);
        return;
      }
      try {
        setSelectedWeekId(value);
        const analysis = allHistoryData?.find((item) => item.id === value);
        if (analysis) {
          setProcessedData({
            kpis: analysis.kpis,
            dailySummary: analysis.dailySummary,
            employeesByDate: analysis.employeesByDate,
            employeeSummaryByDate: analysis.employeeSummaryByDate,
            warnings: analysis.warnings,
            ghLossRawSummary: (analysis as any).ghLossRawSummary,
          } as any);
          setSelectedDate(analysis.dailySummary?.[0]?.date || null);
          setFilteredData(null);
        }
      } catch (error) {
        clientLogger.error('Error loading selected week:', error);
        toast({
          variant: 'destructive',
          title: 'Error Loading Week',
          description: 'Failed to load the selected week data.',
        });
      }
    },
    [allHistoryData, toast]
  );

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
