import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  Lightbulb, 
  TrendingUp, 
  Users, 
  Calendar,
  Clock,
  Target,
  BarChart3,
  AlertTriangle,
  CheckCircle
} from 'lucide-react';
import type { ProcessingResult } from '@shared/schema';

interface AISuggestion {
  id: string;
  category: 'scheduling' | 'business';
  type: 'optimization' | 'opportunity' | 'warning' | 'insight';
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  confidence: number;
  actionable: boolean;
  metrics?: {
    current: number;
    potential: number;
    improvement: string;
  };
}

interface AISuggestionsProps {
  data: ProcessingResult;
}

export function AISuggestions({ data }: AISuggestionsProps) {
  const suggestions = useMemo((): AISuggestion[] => {
    if (!data?.dailySummary.length) return [];

    const suggestions: AISuggestion[] = [];
    let suggestionId = 0;

    // Analyze data patterns
    const totalDays = data.dailySummary.length;
    const shortfallDays = data.dailySummary.filter(day => day.gap < 0).length;
    const surplusDays = data.dailySummary.filter(day => day.gap > 0).length;
    const averageGap = data.dailySummary.reduce((sum, day) => sum + day.gap, 0) / totalDays;
    const totalClientRequired = data.dailySummary.reduce((sum, day) => sum + day.clientRequired, 0);
    const totalNetCapacity = data.dailySummary.reduce((sum, day) => sum + day.netCapacity, 0);
    const averageUtilization = totalNetCapacity > 0 ? (totalClientRequired / totalNetCapacity) * 100 : 0;

    // Get employee patterns
    const allEmployees = Object.values(data.employeesByDate).flat();
    const unavailableEmployees = allEmployees.filter(emp => 
      ['Sick', 'Holiday', 'Other Unavailable', 'Maternity/Paternity', 'Compassionate Leave', 'Pre-Agreed Appointment'].includes(emp.status)
    );
    const unavailabilityRate = allEmployees.length > 0 ? (unavailableEmployees.length / allEmployees.length) * 100 : 0;

    // 1. SCHEDULING TEAM SUGGESTIONS

    // Critical Capacity Management
    if (shortfallDays > totalDays * 0.3) {
      suggestions.push({
        id: `sched-capacity-${suggestionId++}`,
        category: 'scheduling',
        type: 'warning',
        title: 'Chronic Capacity Shortfall Detected',
        description: `${shortfallDays} out of ${totalDays} days show capacity shortages. Consider recruiting additional staff or redistributing workload during peak demand periods.`,
        impact: 'high',
        confidence: 0.9,
        actionable: true,
        metrics: {
          current: shortfallDays,
          potential: Math.max(0, shortfallDays - Math.ceil(totalDays * 0.1)),
          improvement: `${((shortfallDays - Math.ceil(totalDays * 0.1)) / shortfallDays * 100).toFixed(0)}% reduction in shortage days`
        }
      });
    }

    // Staff Optimization
    if (averageGap < -5) {
      suggestions.push({
        id: `sched-optimization-${suggestionId++}`,
        category: 'scheduling',
        type: 'optimization',
        title: 'Immediate Staff Reallocation Needed',
        description: `Average daily shortage of ${Math.abs(averageGap).toFixed(1)} hours detected. Prioritize flexible scheduling and consider temporary staff during peak periods.`,
        impact: 'high',
        confidence: 0.85,
        actionable: true,
        metrics: {
          current: Math.abs(averageGap),
          potential: Math.abs(averageGap) * 0.3,
          improvement: '70% reduction in daily shortages through optimization'
        }
      });
    }

    // Workload Balancing
    if (surplusDays > totalDays * 0.2 && shortfallDays > 0) {
      suggestions.push({
        id: `sched-balance-${suggestionId++}`,
        category: 'scheduling',
        type: 'optimization',
        title: 'Workload Redistribution Opportunity',
        description: `${surplusDays} days have surplus capacity while ${shortfallDays} days face shortages. Implement flexible scheduling to balance workload across the week.`,
        impact: 'medium',
        confidence: 0.75,
        actionable: true,
        metrics: {
          current: shortfallDays,
          potential: Math.max(0, shortfallDays - surplusDays),
          improvement: `Balance ${Math.min(surplusDays, shortfallDays)} days through redistribution`
        }
      });
    }

    // Unavailability Management
    if (unavailabilityRate > 15) {
      suggestions.push({
        id: `sched-unavail-${suggestionId++}`,
        category: 'scheduling',
        type: 'warning',
        title: 'High Staff Unavailability Rate',
        description: `${unavailabilityRate.toFixed(1)}% of staff entries show unavailability. Review absence patterns and consider implementing backup scheduling protocols.`,
        impact: 'medium',
        confidence: 0.8,
        actionable: true
      });
    }

    // 2. BUSINESS DEVELOPMENT SUGGESTIONS

    // Capacity Utilization Insights
    if (averageUtilization < 70) {
      suggestions.push({
        id: `biz-utilization-${suggestionId++}`,
        category: 'business',
        type: 'opportunity',
        title: 'Underutilized Capacity Available',
        description: `Current utilization at ${averageUtilization.toFixed(1)}%. Significant opportunity to expand client services or reduce operational costs through capacity optimization.`,
        impact: 'high',
        confidence: 0.9,
        actionable: true,
        metrics: {
          current: averageUtilization,
          potential: 85,
          improvement: `${(85 - averageUtilization).toFixed(1)}% capacity increase potential`
        }
      });
    } else if (averageUtilization > 90) {
      suggestions.push({
        id: `biz-expansion-${suggestionId++}`,
        category: 'business',
        type: 'opportunity',
        title: 'High Demand Indicates Growth Opportunity',
        description: `Current utilization at ${averageUtilization.toFixed(1)}% suggests strong market demand. Consider expanding workforce to capture additional business opportunities.`,
        impact: 'high',
        confidence: 0.85,
        actionable: true,
        metrics: {
          current: totalNetCapacity,
          potential: totalNetCapacity * 1.2,
          improvement: '20% capacity expansion recommended'
        }
      });
    }

    // Service Quality Insights
    if (shortfallDays === 0) {
      suggestions.push({
        id: `biz-quality-${suggestionId++}`,
        category: 'business',
        type: 'insight',
        title: 'Excellent Service Delivery Consistency',
        description: 'Zero capacity shortfall days detected. This demonstrates strong operational reliability - a key competitive advantage to highlight in business development efforts.',
        impact: 'medium',
        confidence: 0.95,
        actionable: true
      });
    }

    // Cost Optimization
    if (surplusDays > totalDays * 0.4) {
      suggestions.push({
        id: `biz-cost-${suggestionId++}`,
        category: 'business',
        type: 'optimization',
        title: 'Cost Optimization Opportunity',
        description: `${surplusDays} days show surplus capacity. Consider flexible staffing models or service expansion to optimize operational costs and increase profitability.`,
        impact: 'medium',
        confidence: 0.8,
        actionable: true
      });
    }

    // Market Expansion Insight
    const demandTrend = data.dailySummary.slice(-3).reduce((sum, day) => sum + day.clientRequired, 0) / 3;
    const earlyDemand = data.dailySummary.slice(0, 3).reduce((sum, day) => sum + day.clientRequired, 0) / 3;
    if (demandTrend > earlyDemand * 1.1) {
      suggestions.push({
        id: `biz-trend-${suggestionId++}`,
        category: 'business',
        type: 'opportunity',
        title: 'Growing Demand Trend Detected',
        description: `Recent demand shows ${((demandTrend - earlyDemand) / earlyDemand * 100).toFixed(1)}% increase. Market conditions favor service expansion and strategic investment in additional capacity.`,
        impact: 'high',
        confidence: 0.75,
        actionable: true,
        metrics: {
          current: earlyDemand,
          potential: demandTrend,
          improvement: `${((demandTrend - earlyDemand) / earlyDemand * 100).toFixed(1)}% demand growth trend`
        }
      });
    }

    return suggestions.sort((a, b) => {
      const impactWeight = { high: 3, medium: 2, low: 1 };
      const categoryWeight = { scheduling: 1, business: 0.8 };
      
      return (impactWeight[b.impact] * b.confidence * categoryWeight[b.category]) - 
             (impactWeight[a.impact] * a.confidence * categoryWeight[a.category]);
    });
  }, [data]);

  const schedulingSuggestions = suggestions.filter(s => s.category === 'scheduling');
  const businessSuggestions = suggestions.filter(s => s.category === 'business');

  const getIcon = (type: string) => {
    switch (type) {
      case 'optimization': return <Target className="h-4 w-4" />;
      case 'opportunity': return <TrendingUp className="h-4 w-4" />;
      case 'warning': return <AlertTriangle className="h-4 w-4" />;
      case 'insight': return <CheckCircle className="h-4 w-4" />;
      default: return <Lightbulb className="h-4 w-4" />;
    }
  };

  const getAlertVariant = (type: string) => {
    return type === 'warning' ? 'destructive' : 'default';
  };

  return (
    <div className="space-y-6" data-testid="ai-suggestions">
      {/* Header */}
      <div className="text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Lightbulb className="h-6 w-6 text-blue-600" />
          <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            AI-Powered Insights
          </h2>
        </div>
        <p className="text-gray-600 dark:text-gray-300">
          Intelligent analysis and recommendations based on your workforce data
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="glass">
          <CardContent className="p-4 text-center">
            <BarChart3 className="h-8 w-8 text-blue-600 mx-auto mb-2" />
            <div className="text-2xl font-bold">{suggestions.length}</div>
            <div className="text-sm text-gray-600 dark:text-gray-300">Total Suggestions</div>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="p-4 text-center">
            <Calendar className="h-8 w-8 text-green-600 mx-auto mb-2" />
            <div className="text-2xl font-bold">{schedulingSuggestions.length}</div>
            <div className="text-sm text-gray-600 dark:text-gray-300">Scheduling Insights</div>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="p-4 text-center">
            <TrendingUp className="h-8 w-8 text-purple-600 mx-auto mb-2" />
            <div className="text-2xl font-bold">{businessSuggestions.length}</div>
            <div className="text-sm text-gray-600 dark:text-gray-300">Business Opportunities</div>
          </CardContent>
        </Card>
      </div>

      {/* Scheduling Team Suggestions */}
      <Card className="glass">
        <CardHeader className="gradient-card dark:gradient-card-dark rounded-t-lg">
          <CardTitle className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg gradient-bg flex items-center justify-center">
              <Users className="w-5 h-5 text-white" />
            </div>
            <span className="bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent">
              Scheduling Team Recommendations
            </span>
            <Badge variant="outline" className="ml-auto">
              {schedulingSuggestions.length} insights
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          {schedulingSuggestions.length > 0 ? schedulingSuggestions.map((suggestion) => (
            <Alert 
              key={suggestion.id} 
              variant={getAlertVariant(suggestion.type)}
              className="relative"
              data-testid={`suggestion-scheduling-${suggestion.id}`}
            >
              {getIcon(suggestion.type)}
              <div className="flex-1">
                <AlertTitle className="flex items-center justify-between">
                  <span>{suggestion.title}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={suggestion.impact === 'high' ? 'destructive' : suggestion.impact === 'medium' ? 'default' : 'secondary'}>
                      {suggestion.impact} impact
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      <Clock className="h-3 w-3 mr-1" />
                      {Math.round(suggestion.confidence * 100)}% confidence
                    </Badge>
                  </div>
                </AlertTitle>
                <AlertDescription className="mt-2">
                  {suggestion.description}
                  {suggestion.metrics && (
                    <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                      <div className="text-sm font-medium mb-1">Potential Impact:</div>
                      <div className="text-sm text-gray-600 dark:text-gray-300">{suggestion.metrics.improvement}</div>
                    </div>
                  )}
                </AlertDescription>
              </div>
            </Alert>
          )) : (
            <div className="text-center py-8 text-gray-500">
              <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500" />
              <p>No scheduling optimizations needed - your team is performing excellently!</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Business Development Suggestions */}
      <Card className="glass">
        <CardHeader className="gradient-card dark:gradient-card-dark rounded-t-lg">
          <CardTitle className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg gradient-bg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <span className="bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
              Business Development Opportunities
            </span>
            <Badge variant="outline" className="ml-auto">
              {businessSuggestions.length} opportunities
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          {businessSuggestions.length > 0 ? businessSuggestions.map((suggestion) => (
            <Alert 
              key={suggestion.id} 
              variant={getAlertVariant(suggestion.type)}
              className="relative"
              data-testid={`suggestion-business-${suggestion.id}`}
            >
              {getIcon(suggestion.type)}
              <div className="flex-1">
                <AlertTitle className="flex items-center justify-between">
                  <span>{suggestion.title}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={suggestion.impact === 'high' ? 'destructive' : suggestion.impact === 'medium' ? 'default' : 'secondary'}>
                      {suggestion.impact} impact
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      <Clock className="h-3 w-3 mr-1" />
                      {Math.round(suggestion.confidence * 100)}% confidence
                    </Badge>
                  </div>
                </AlertTitle>
                <AlertDescription className="mt-2">
                  {suggestion.description}
                  {suggestion.metrics && (
                    <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                      <div className="text-sm font-medium mb-1">Growth Potential:</div>
                      <div className="text-sm text-gray-600 dark:text-gray-300">{suggestion.metrics.improvement}</div>
                    </div>
                  )}
                </AlertDescription>
              </div>
            </Alert>
          )) : (
            <div className="text-center py-8 text-gray-500">
              <TrendingUp className="h-12 w-12 mx-auto mb-4 text-blue-500" />
              <p>Your business metrics are stable - continue monitoring for emerging opportunities!</p>
            </div>
          )}
        </CardContent>
      </Card>

      {suggestions.length === 0 && (
        <Card className="glass">
          <CardContent className="p-12 text-center">
            <Lightbulb className="h-16 w-16 mx-auto mb-6 text-gray-400" />
            <h3 className="text-xl font-semibold mb-2">No Data Available</h3>
            <p className="text-gray-600 dark:text-gray-300">
              Upload your workforce data to receive AI-powered insights and recommendations.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}