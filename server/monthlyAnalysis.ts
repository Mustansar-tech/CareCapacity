import { CapacityAnalysis } from "@shared/schema";

export interface MonthlyAggregate {
  totalWeeks: number;
  averageKpis: {
    netCapacitySum: number;
    clientRequiredSum: number;
    gapSum: number;
    unavailabilitySum: number;
    holidaysSum: number;
  };
  weeklyTrends: {
    week: string;
    netCapacity: number;
    gap: number;
    utilizationRate: number;
  }[];
  monthlyInsights: {
    bestWeek: string;
    worstWeek: string;
    averageUtilization: number;
    totalShortageHours: number;
    consistencyScore: number;
  };
}

export function aggregateMonthlyData(analyses: CapacityAnalysis[]): MonthlyAggregate {
  if (analyses.length === 0) {
    return {
      totalWeeks: 0,
      averageKpis: {
        netCapacitySum: 0,
        clientRequiredSum: 0,
        gapSum: 0,
        unavailabilitySum: 0,
        holidaysSum: 0,
      },
      weeklyTrends: [],
      monthlyInsights: {
        bestWeek: '',
        worstWeek: '',
        averageUtilization: 0,
        totalShortageHours: 0,
        consistencyScore: 0,
      },
    };
  }

  const totalWeeks = analyses.length;

  // Calculate average KPIs
  const averageKpis = {
    netCapacitySum: Math.round(
      analyses.reduce((sum, a) => sum + (a.kpis as any).netCapacitySum, 0) / totalWeeks * 100
    ) / 100,
    clientRequiredSum: Math.round(
      analyses.reduce((sum, a) => sum + (a.kpis as any).clientRequiredSum, 0) / totalWeeks * 100
    ) / 100,
    gapSum: Math.round(
      analyses.reduce((sum, a) => sum + (a.kpis as any).gapSum, 0) / totalWeeks * 100
    ) / 100,
    unavailabilitySum: Math.round(
      analyses.reduce((sum, a) => sum + (a.kpis as any).unavailabilitySum, 0) / totalWeeks * 100
    ) / 100,
    holidaysSum: Math.round(
      analyses.reduce((sum, a) => sum + (a.kpis as any).holidaysSum, 0) / totalWeeks * 100
    ) / 100,
  };

  // Weekly trends
  const weeklyTrends = analyses
    .map((analysis) => {
      const kpis = analysis.kpis as any;
      const utilizationRate = kpis.clientRequiredSum > 0 
        ? Math.round((kpis.netCapacitySum / kpis.clientRequiredSum) * 100 * 100) / 100
        : 0;
      
      return {
        week: `${analysis.weekStartDate} to ${analysis.weekEndDate}`,
        netCapacity: kpis.netCapacitySum,
        gap: kpis.gapSum,
        utilizationRate,
      };
    })
    .sort((a, b) => a.week.localeCompare(b.week));

  // Monthly insights
  const utilizationRates = weeklyTrends.map(w => w.utilizationRate);
  const gaps = weeklyTrends.map(w => w.gap);
  
  const bestWeekIndex = gaps.indexOf(Math.max(...gaps));
  const worstWeekIndex = gaps.indexOf(Math.min(...gaps));
  
  const averageUtilization = Math.round(
    utilizationRates.reduce((sum, rate) => sum + rate, 0) / totalWeeks * 100
  ) / 100;
  
  const totalShortageHours = Math.round(
    Math.abs(gaps.filter(gap => gap < 0).reduce((sum, gap) => sum + gap, 0)) * 100
  ) / 100;
  
  // Consistency score based on standard deviation of gaps
  const avgGap = gaps.reduce((sum, gap) => sum + gap, 0) / totalWeeks;
  const variance = gaps.reduce((sum, gap) => sum + Math.pow(gap - avgGap, 2), 0) / totalWeeks;
  const stdDev = Math.sqrt(variance);
  const consistencyScore = Math.max(0, Math.round((100 - stdDev) * 100) / 100);

  const monthlyInsights = {
    bestWeek: weeklyTrends[bestWeekIndex]?.week || '',
    worstWeek: weeklyTrends[worstWeekIndex]?.week || '',
    averageUtilization,
    totalShortageHours,
    consistencyScore,
  };

  return {
    totalWeeks,
    averageKpis,
    weeklyTrends,
    monthlyInsights,
  };
}