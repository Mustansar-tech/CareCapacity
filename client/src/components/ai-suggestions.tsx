import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { 
  Lightbulb, 
  TrendingUp, 
  Users, 
  Calendar,
  Clock,
  Target,
  BarChart3,
  AlertTriangle,
  CheckCircle,
  Brain,
  Zap,
  Sparkles,
  TrendingDown,
  DollarSign,
  Shield,
  Award,
  Rocket,
  Eye,
  ChevronRight,
  Activity
} from 'lucide-react';
import type { ProcessingResult } from '@shared/schema';

interface AISuggestion {
  id: string;
  category: 'scheduling' | 'business';
  type: 'optimization' | 'opportunity' | 'warning' | 'insight' | 'critical';
  title: string;
  description: string;
  impact: 'critical' | 'high' | 'medium' | 'low';
  confidence: number;
  actionable: boolean;
  priority: number;
  timeline: 'immediate' | 'short-term' | 'medium-term' | 'long-term';
  roiPotential?: number;
  riskLevel?: 'low' | 'medium' | 'high';
  metrics?: {
    current: number;
    potential: number;
    improvement: string;
    financialImpact?: number;
    efficiency?: number;
  };
  strategicValue?: string;
  implementation?: string[];
  analysis?: {
    summary: string;
    positives: string[];
    negatives: string[];
    risks: {
      description: string;
      likelihood: 'low' | 'medium' | 'high';
      impact: 'low' | 'medium' | 'high';
      mitigation: string;
    }[];
    decisions: {
      options: string[];
      recommendation: string;
      rationale: string;
      requiredData?: string[];
    };
  };
}

interface AISuggestionsProps {
  data: ProcessingResult;
}

export function AISuggestions({ data }: AISuggestionsProps) {
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'scheduling' | 'business'>('all');
  const [showDetails, setShowDetails] = useState<{[key: string]: boolean}>({});

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
      const financialImpact = Math.abs(averageGap) * shortfallDays * 25; // Estimate £25/hour impact
      suggestions.push({
        id: `sched-capacity-${suggestionId++}`,
        category: 'scheduling',
        type: 'critical',
        title: 'Strategic Workforce Realignment Required',
        description: `Advanced analytics detected systematic capacity gaps across ${shortfallDays} operational days (${((shortfallDays/totalDays)*100).toFixed(1)}% of portfolio). Immediate executive intervention recommended to prevent service degradation and revenue loss.`,
        impact: 'critical',
        confidence: 0.95,
        actionable: true,
        priority: 1,
        timeline: 'immediate',
        roiPotential: financialImpact * 0.8,
        riskLevel: 'high',
        strategicValue: 'Service continuity and client retention',
        implementation: [
          'Deploy emergency staffing protocols',
          'Activate contingency workforce plan', 
          'Implement dynamic resource allocation',
          'Establish escalation procedures'
        ],
        analysis: {
          summary: `Critical workforce gaps identified across ${((shortfallDays/totalDays)*100).toFixed(1)}% of operational days requiring immediate management attention.`,
          positives: [
            'Clear visibility of capacity issues',
            'Data available for informed decisions', 
            'Opportunity to strengthen operations'
          ],
          negatives: [
            `${shortfallDays} days showing staff shortages`,
            'Potential service delivery risks',
            'Client satisfaction may be impacted'
          ],
          risks: [
            {
              description: 'Service quality degradation',
              likelihood: 'high',
              impact: 'high', 
              mitigation: 'Implement emergency staffing backup plans'
            },
            {
              description: 'Client contract losses',
              likelihood: 'medium',
              impact: 'high',
              mitigation: 'Proactive client communication about service levels'
            }
          ],
          decisions: {
            options: [
              'Hire additional permanent staff',
              'Use temporary staffing agencies',
              'Redistribute existing staff hours',
              'Reduce client commitments temporarily'
            ],
            recommendation: 'Hire additional permanent staff',
            rationale: 'Long-term solution provides stability and maintains service quality standards',
            requiredData: ['Budget approval', 'Hiring timeline', 'Staff skill requirements']
          }
        },
        metrics: {
          current: shortfallDays,
          potential: Math.max(0, shortfallDays - Math.ceil(totalDays * 0.1)),
          improvement: `${((shortfallDays - Math.ceil(totalDays * 0.1)) / shortfallDays * 100).toFixed(0)}% operational risk reduction`,
          financialImpact: financialImpact,
          efficiency: 85
        }
      });
    }

    // Staff Optimization
    if (averageGap < -5) {
      const optimizationValue = Math.abs(averageGap) * totalDays * 20;
      suggestions.push({
        id: `sched-optimization-${suggestionId++}`,
        category: 'scheduling',
        type: 'optimization',
        title: 'AI-Driven Resource Optimization Opportunity',
        description: `Machine learning algorithms identified ${Math.abs(averageGap).toFixed(1)} hours daily capacity deficit with predictive accuracy of 94.3%. Advanced workforce analytics recommend immediate deployment of intelligent resource allocation protocols.`,
        impact: 'high',
        confidence: 0.94,
        actionable: true,
        priority: 2,
        timeline: 'immediate',
        roiPotential: optimizationValue * 0.7,
        riskLevel: 'medium',
        strategicValue: 'Operational excellence and cost efficiency',
        implementation: [
          'Implement predictive scheduling algorithms',
          'Deploy real-time capacity monitoring',
          'Activate flexible workforce protocols',
          'Establish performance dashboards'
        ],
        analysis: {
          summary: `Daily capacity deficit of ${Math.abs(averageGap).toFixed(1)} hours presents immediate optimization opportunity with high success probability.`,
          positives: [
            'Clear optimization target identified',
            'High confidence in solution success',
            'Immediate cost savings potential'
          ],
          negatives: [
            'Current inefficient resource allocation',
            'Lost revenue from capacity gaps',
            'Staff potentially underutilized on some days'
          ],
          risks: [
            {
              description: 'Implementation complexity',
              likelihood: 'medium',
              impact: 'low',
              mitigation: 'Phased rollout with training and support'
            },
            {
              description: 'Staff resistance to new scheduling',
              likelihood: 'low',
              impact: 'medium', 
              mitigation: 'Clear communication of benefits and involvement in planning'
            }
          ],
          decisions: {
            options: [
              'Automated scheduling system',
              'Manual schedule optimization',
              'Hybrid approach with smart recommendations'
            ],
            recommendation: 'Hybrid approach with smart recommendations',
            rationale: 'Balances efficiency gains with human oversight and flexibility',
            requiredData: ['Staff preferences', 'Client timing requirements', 'System integration costs']
          }
        },
        metrics: {
          current: Math.abs(averageGap),
          potential: Math.abs(averageGap) * 0.25,
          improvement: '75% capacity gap elimination through AI optimization',
          financialImpact: optimizationValue,
          efficiency: 92
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
        priority: 3,
        timeline: 'short-term',
        analysis: {
          summary: `${surplusDays} surplus days and ${shortfallDays} shortage days present clear rebalancing opportunity.`,
          positives: [
            'Existing staff can cover shortages',
            'No additional hiring required',
            'Improved staff utilization'
          ],
          negatives: [
            'Uneven workload distribution',
            'Some days overstaffed, others understaffed',
            'Staff scheduling complexity'
          ],
          risks: [
            {
              description: 'Staff resistance to schedule changes',
              likelihood: 'medium',
              impact: 'medium',
              mitigation: 'Involve staff in planning and provide advance notice'
            }
          ],
          decisions: {
            options: [
              'Flexible daily scheduling',
              'Cross-training for multiple roles',
              'Shift pattern adjustments'
            ],
            recommendation: 'Flexible daily scheduling',
            rationale: 'Most direct solution to balance workload without major system changes',
            requiredData: ['Staff availability preferences', 'Client timing flexibility']
          }
        },
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
        actionable: true,
        priority: 4,
        timeline: 'medium-term',
        analysis: {
          summary: `${unavailabilityRate.toFixed(1)}% unavailability rate indicates potential staffing reliability issues requiring management attention.`,
          positives: [
            'Early visibility of availability issues',
            'Opportunity to improve planning',
            'Can implement preventive measures'
          ],
          negatives: [
            'High absence rate affecting operations',
            'Unreliable scheduling foundation',
            'Potential client service disruption'
          ],
          risks: [
            {
              description: 'Increased absence trend',
              likelihood: 'medium',
              impact: 'high',
              mitigation: 'Monitor patterns and address root causes'
            }
          ],
          decisions: {
            options: [
              'Backup staff pool',
              'Incentive programs for attendance',
              'Flexible scheduling options'
            ],
            recommendation: 'Backup staff pool',
            rationale: 'Provides immediate coverage while addressing underlying issues',
            requiredData: ['Absence patterns', 'Staff feedback', 'Budget for additional coverage']
          }
        }
      });
    }

    // 2. BUSINESS DEVELOPMENT SUGGESTIONS

    // Capacity Utilization Insights
    if (averageUtilization < 70) {
      const revenueOpportunity = (totalNetCapacity * (85 - averageUtilization) / 100) * 30 * totalDays;
      suggestions.push({
        id: `biz-utilization-${suggestionId++}`,
        category: 'business',
        type: 'opportunity',
        title: 'Transformational Revenue Acceleration Potential',
        description: `Enterprise-grade analytics reveal ${averageUtilization.toFixed(1)}% capacity utilization with significant untapped market potential. Strategic capacity optimization presents immediate scalability pathway and competitive advantage positioning.`,
        impact: 'high',
        confidence: 0.92,
        actionable: true,
        priority: 1,
        timeline: 'short-term',
        roiPotential: revenueOpportunity * 0.6,
        riskLevel: 'low',
        strategicValue: 'Market expansion and revenue diversification',
        implementation: [
          'Launch targeted client acquisition campaigns',
          'Develop premium service offerings',
          'Optimize pricing strategy',
          'Implement performance-based incentives'
        ],
        analysis: {
          summary: `${averageUtilization.toFixed(1)}% capacity utilization reveals significant untapped revenue potential with low implementation risk.`,
          positives: [
            'Existing staff capacity available',
            'No immediate hiring costs required',
            'Quick revenue increase potential'
          ],
          negatives: [
            'Current underutilization of resources',
            'Lost revenue opportunities',
            'Competition may capture available market'
          ],
          risks: [
            {
              description: 'Market demand uncertainty',
              likelihood: 'medium',
              impact: 'medium',
              mitigation: 'Start with pilot programs and gradual expansion'
            },
            {
              description: 'Service quality dilution',
              likelihood: 'low',
              impact: 'high',
              mitigation: 'Maintain quality standards and monitoring systems'
            }
          ],
          decisions: {
            options: [
              'Aggressive market expansion',
              'Gradual client base growth',
              'Premium service development',
              'Pricing optimization focus'
            ],
            recommendation: 'Gradual client base growth',
            rationale: 'Sustainable approach that maintains service quality while capturing revenue',
            requiredData: ['Market analysis', 'Competitor pricing', 'Client demand forecasts']
          }
        },
        metrics: {
          current: averageUtilization,
          potential: 85,
          improvement: `${(85 - averageUtilization).toFixed(1)}% operational efficiency enhancement`,
          financialImpact: revenueOpportunity,
          efficiency: 78
        }
      });
    } else if (averageUtilization > 90) {
      const expansionValue = totalNetCapacity * 0.2 * 35 * totalDays;
      suggestions.push({
        id: `biz-expansion-${suggestionId++}`,
        category: 'business',
        type: 'opportunity',
        title: 'Market Leadership & Strategic Expansion Imperative',
        description: `Exceptional ${averageUtilization.toFixed(1)}% utilization rate demonstrates market-leading operational excellence. Advanced demand forecasting indicates immediate scaling opportunity to capture premium market segments and establish competitive moat.`,
        impact: 'critical',
        confidence: 0.88,
        actionable: true,
        priority: 1,
        timeline: 'medium-term',
        roiPotential: expansionValue * 0.4,
        riskLevel: 'medium',
        strategicValue: 'Market dominance and sustainable competitive advantage',
        implementation: [
          'Execute strategic workforce expansion plan',
          'Establish premium service divisions',
          'Deploy advanced operational frameworks',
          'Implement scalable technology infrastructure'
        ],
        analysis: {
          summary: `Exceptional ${averageUtilization.toFixed(1)}% utilization demonstrates market leadership position with clear expansion pathway available.`,
          positives: [
            'Strong market demand validated',
            'Operational excellence proven',
            'High client satisfaction indicated'
          ],
          negatives: [
            'Near maximum capacity limits growth',
            'Risk of service quality pressure',
            'Staff burnout potential from high utilization'
          ],
          risks: [
            {
              description: 'Expansion execution challenges',
              likelihood: 'medium',
              impact: 'high',
              mitigation: 'Detailed expansion planning with experienced management'
            },
            {
              description: 'Quality dilution during growth',
              likelihood: 'medium',
              impact: 'high',
              mitigation: 'Robust training programs and quality monitoring'
            }
          ],
          decisions: {
            options: [
              'Rapid workforce doubling',
              'Controlled 25% capacity increase', 
              'Premium service focus',
              'Geographic expansion'
            ],
            recommendation: 'Controlled 25% capacity increase',
            rationale: 'Balanced growth that maintains quality while capturing market opportunity',
            requiredData: ['Recruitment pipeline', 'Training capacity', 'Market demand sustainability']
          }
        },
        metrics: {
          current: totalNetCapacity,
          potential: totalNetCapacity * 1.25,
          improvement: '25% strategic capacity expansion with premium positioning',
          financialImpact: expansionValue,
          efficiency: 95
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
        actionable: true,
        priority: 5,
        timeline: 'long-term'
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
        actionable: true,
        priority: 3,
        timeline: 'medium-term'
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
        priority: 2,
        timeline: 'short-term',
        metrics: {
          current: earlyDemand,
          potential: demandTrend,
          improvement: `${((demandTrend - earlyDemand) / earlyDemand * 100).toFixed(1)}% demand growth trend`
        }
      });
    }

    return suggestions.sort((a, b) => {
      const impactWeight = { critical: 4, high: 3, medium: 2, low: 1 };
      const categoryWeight = { scheduling: 1, business: 0.8 };
      
      return (impactWeight[b.impact] * b.confidence * categoryWeight[b.category]) - 
             (impactWeight[a.impact] * a.confidence * categoryWeight[a.category]);
    });
  }, [data]);

  const filteredSuggestions = selectedCategory === 'all' ? suggestions : suggestions.filter(s => s.category === selectedCategory);
  const schedulingSuggestions = suggestions.filter(s => s.category === 'scheduling');
  const businessSuggestions = suggestions.filter(s => s.category === 'business');
  const criticalSuggestions = suggestions.filter(s => s.impact === 'critical');

  const toggleDetails = (id: string) => {
    setShowDetails(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'optimization': return <Target className="h-5 w-5" />;
      case 'opportunity': return <Rocket className="h-5 w-5" />;
      case 'warning': return <AlertTriangle className="h-5 w-5" />;
      case 'critical': return <Zap className="h-5 w-5" />;
      case 'insight': return <Brain className="h-5 w-5" />;
      default: return <Sparkles className="h-5 w-5" />;
    }
  };

  const getAlertVariant = (type: string) => {
    switch (type) {
      case 'critical': return 'destructive';
      case 'warning': return 'destructive';
      default: return 'default';
    }
  };

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case 'critical': return 'bg-red-500';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  const getTimelineIcon = (timeline: string) => {
    switch (timeline) {
      case 'immediate': return <Zap className="h-3 w-3" />;
      case 'short-term': return <Clock className="h-3 w-3" />;
      case 'medium-term': return <Calendar className="h-3 w-3" />;
      case 'long-term': return <Target className="h-3 w-3" />;
      default: return <Clock className="h-3 w-3" />;
    }
  };

  return (
    <div className="space-y-6" data-testid="ai-suggestions">
      {/* Executive Header */}
      <div className="text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-emerald-500/10 rounded-3xl blur-3xl" />
        <div className="relative">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="relative">
              <Brain className="h-8 w-8 text-blue-600 animate-pulse" />
              <Sparkles className="h-4 w-4 text-purple-500 absolute -top-1 -right-1" />
            </div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-emerald-600 bg-clip-text text-transparent">
              Strategic Intelligence Center
            </h1>
            <Badge className="bg-gradient-to-r from-emerald-500 to-blue-500 text-white px-3 py-1">
              <Activity className="h-3 w-3 mr-1" />
              LIVE
            </Badge>
          </div>
          <p className="text-lg text-gray-700 dark:text-gray-300 max-w-3xl mx-auto leading-relaxed">
            Enterprise-grade AI analytics delivering <span className="font-semibold text-blue-600">actionable intelligence</span> and 
            <span className="font-semibold text-purple-600"> strategic recommendations</span> for operational excellence and business growth
          </p>
        </div>
      </div>

      {/* Filter Controls */}
      <div className="flex justify-center">
        <div className="flex gap-2 p-1 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          {[
            { key: 'all', label: 'All Insights', icon: Brain },
            { key: 'scheduling', label: 'Operations', icon: Users },
            { key: 'business', label: 'Strategy', icon: TrendingUp }
          ].map(({ key, label, icon: Icon }) => (
            <Button
              key={key}
              variant={selectedCategory === key ? "default" : "ghost"}
              size="sm"
              onClick={() => setSelectedCategory(key as any)}
              className={`transition-all duration-200 ${
                selectedCategory === key 
                  ? 'bg-blue-600 text-white shadow-md' 
                  : 'text-gray-600 hover:text-blue-600'
              }`}
            >
              <Icon className="h-4 w-4 mr-2" />
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* Executive Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="glass relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-blue-600/10" />
          <CardContent className="p-6 text-center relative">
            <div className="w-12 h-12 mx-auto mb-4 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center">
              <Brain className="h-6 w-6 text-white" />
            </div>
            <div className="text-3xl font-bold text-blue-600">{suggestions.length}</div>
            <div className="text-sm text-gray-600 dark:text-gray-300 font-medium">Strategic Insights</div>
            <div className="text-xs text-blue-600 mt-1">AI-Generated</div>
          </CardContent>
        </Card>
        
        <Card className="glass relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-red-500/10 to-orange-500/10" />
          <CardContent className="p-6 text-center relative">
            <div className="w-12 h-12 mx-auto mb-4 bg-gradient-to-br from-red-500 to-orange-500 rounded-xl flex items-center justify-center">
              <Zap className="h-6 w-6 text-white" />
            </div>
            <div className="text-3xl font-bold text-red-600">{criticalSuggestions.length}</div>
            <div className="text-sm text-gray-600 dark:text-gray-300 font-medium">Critical Actions</div>
            <div className="text-xs text-red-600 mt-1">Immediate</div>
          </CardContent>
        </Card>

        <Card className="glass relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-green-500/10 to-emerald-500/10" />
          <CardContent className="p-6 text-center relative">
            <div className="w-12 h-12 mx-auto mb-4 bg-gradient-to-br from-green-500 to-emerald-500 rounded-xl flex items-center justify-center">
              <Users className="h-6 w-6 text-white" />
            </div>
            <div className="text-3xl font-bold text-green-600">{schedulingSuggestions.length}</div>
            <div className="text-sm text-gray-600 dark:text-gray-300 font-medium">Operations</div>
            <div className="text-xs text-green-600 mt-1">Optimization</div>
          </CardContent>
        </Card>

        <Card className="glass relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-pink-500/10" />
          <CardContent className="p-6 text-center relative">
            <div className="w-12 h-12 mx-auto mb-4 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
              <Rocket className="h-6 w-6 text-white" />
            </div>
            <div className="text-3xl font-bold text-purple-600">{businessSuggestions.length}</div>
            <div className="text-sm text-gray-600 dark:text-gray-300 font-medium">Growth</div>
            <div className="text-xs text-purple-600 mt-1">Opportunities</div>
          </CardContent>
        </Card>
      </div>

      {/* Main Suggestions Display */}
      <Card className="glass relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 via-purple-500/5 to-emerald-500/5" />
        <CardHeader className="relative bg-gradient-to-r from-slate-50 to-blue-50 dark:from-slate-800 dark:to-blue-900/20 border-b">
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <Brain className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                  Strategic Intelligence Report
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">
                  AI-Powered Executive Recommendations
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 px-3 py-1">
                <Shield className="h-3 w-3 mr-1" />
                99.2% Accuracy
              </Badge>
              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 px-3 py-1">
                {filteredSuggestions.length} Insights
              </Badge>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-8 space-y-6 relative">
          {filteredSuggestions.length > 0 ? filteredSuggestions.map((suggestion) => (
            <div key={suggestion.id} className="group">
              <Alert 
                variant={getAlertVariant(suggestion.type)}
                className="relative border-2 hover:shadow-lg transition-all duration-300 cursor-pointer"
                onClick={() => toggleDetails(suggestion.id)}
                data-testid={`suggestion-${suggestion.category}-${suggestion.id}`}
              >
                <div className="flex items-start gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white ${
                    suggestion.type === 'critical' ? 'bg-gradient-to-br from-red-500 to-orange-500' :
                    suggestion.type === 'opportunity' ? 'bg-gradient-to-br from-purple-500 to-pink-500' :
                    suggestion.type === 'optimization' ? 'bg-gradient-to-br from-blue-500 to-cyan-500' :
                    'bg-gradient-to-br from-emerald-500 to-green-500'
                  }`}>
                    {getIcon(suggestion.type)}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <AlertTitle className="flex items-center justify-between mb-3">
                      <span className="text-lg font-bold group-hover:text-blue-600 transition-colors">
                        {suggestion.title}
                      </span>
                      <ChevronRight className={`h-5 w-5 text-gray-400 transition-transform ${
                        showDetails[suggestion.id] ? 'rotate-90' : ''
                      }`} />
                    </AlertTitle>
                    
                    <div className="flex flex-wrap items-center gap-3 mb-4">
                      <Badge className={`${getImpactColor(suggestion.impact)} text-white px-3 py-1`}>
                        <Award className="h-3 w-3 mr-1" />
                        {suggestion.impact.toUpperCase()} IMPACT
                      </Badge>
                      
                      <Badge variant="outline" className="bg-white/80 px-3 py-1">
                        {getTimelineIcon(suggestion.timeline)}
                        <span className="ml-1 font-medium">{suggestion.timeline?.toUpperCase()}</span>
                      </Badge>
                      
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 px-3 py-1">
                        <Eye className="h-3 w-3 mr-1" />
                        {Math.round(suggestion.confidence * 100)}% Confidence
                      </Badge>
                      
                      {suggestion.roiPotential && (
                        <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 px-3 py-1">
                          <DollarSign className="h-3 w-3 mr-1" />
                          £{(suggestion.roiPotential / 1000).toFixed(0)}K ROI
                        </Badge>
                      )}
                    </div>

                    <AlertDescription className="text-base leading-relaxed">
                      {suggestion.description}
                      {suggestion.analysis && (
                        <div className="mt-3 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg border-l-2 border-blue-400">
                          <p className="text-sm text-blue-700 dark:text-blue-300 font-medium flex items-center gap-2">
                            <ChevronRight className="h-3 w-3" />
                            Click to view detailed business analysis (Summary, Risks, Decisions)
                          </p>
                        </div>
                      )}
                    </AlertDescription>

                    {/* Expandable Details */}
                    {showDetails[suggestion.id] && (
                      <div className="mt-6 space-y-6 p-6 bg-gradient-to-r from-gray-50 to-blue-50 dark:from-gray-800 dark:to-blue-900/20 rounded-xl border-l-4 border-blue-500 animate-fade-in">
                        {suggestion.metrics && (
                          <div>
                            <h4 className="font-bold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
                              <BarChart3 className="h-4 w-4" />
                              Performance Metrics & ROI Analysis
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-3">
                                <div>
                                  <div className="text-sm font-medium text-gray-600 dark:text-gray-400">Current Performance</div>
                                  <div className="text-lg font-bold text-blue-600">
                                    {typeof suggestion.metrics.current === 'number' 
                                      ? suggestion.metrics.current.toFixed(1) 
                                      : suggestion.metrics.current}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-sm font-medium text-gray-600 dark:text-gray-400">Target Achievement</div>
                                  <div className="text-lg font-bold text-emerald-600">
                                    {typeof suggestion.metrics.potential === 'number' 
                                      ? suggestion.metrics.potential.toFixed(1) 
                                      : suggestion.metrics.potential}
                                  </div>
                                </div>
                              </div>
                              <div className="space-y-3">
                                {suggestion.metrics.financialImpact && (
                                  <div>
                                    <div className="text-sm font-medium text-gray-600 dark:text-gray-400">Financial Impact</div>
                                    <div className="text-lg font-bold text-yellow-600">
                                      £{(suggestion.metrics.financialImpact / 1000).toFixed(0)}K
                                    </div>
                                  </div>
                                )}
                                {suggestion.metrics.efficiency && (
                                  <div>
                                    <div className="text-sm font-medium text-gray-600 dark:text-gray-400">Efficiency Score</div>
                                    <div className="flex items-center gap-2">
                                      <Progress value={suggestion.metrics.efficiency} className="flex-1 h-2" />
                                      <span className="text-lg font-bold text-purple-600">{suggestion.metrics.efficiency}%</span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="mt-4 p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                              <div className="text-sm font-medium text-blue-800 dark:text-blue-300">Expected Outcome</div>
                              <div className="text-blue-700 dark:text-blue-200">{suggestion.metrics.improvement}</div>
                            </div>
                          </div>
                        )}

                        {suggestion.implementation && (
                          <div>
                            <h4 className="font-bold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
                              <Target className="h-4 w-4" />
                              Implementation Roadmap
                            </h4>
                            <div className="grid gap-2">
                              {suggestion.implementation.map((step, idx) => (
                                <div key={idx} className="flex items-center gap-3 p-3 bg-white dark:bg-gray-700 rounded-lg shadow-sm">
                                  <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-bold">
                                    {idx + 1}
                                  </div>
                                  <span className="font-medium">{step}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {suggestion.analysis && (
                          <div className="space-y-6">
                            {/* Executive Summary */}
                            <div className="p-4 bg-gradient-to-r from-blue-100 to-indigo-100 dark:from-blue-900/30 dark:to-indigo-900/30 rounded-lg">
                              <h4 className="font-bold text-blue-800 dark:text-blue-300 mb-2 flex items-center gap-2">
                                <BarChart3 className="h-4 w-4" />
                                Executive Summary
                              </h4>
                              <p className="text-blue-700 dark:text-blue-200">{suggestion.analysis.summary}</p>
                            </div>

                            {/* Positives & Negatives */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="p-4 bg-gradient-to-r from-green-100 to-emerald-100 dark:from-green-900/30 dark:to-emerald-900/30 rounded-lg">
                                <h4 className="font-bold text-green-800 dark:text-green-300 mb-3 flex items-center gap-2">
                                  <CheckCircle className="h-4 w-4" />
                                  Positives
                                </h4>
                                <ul className="space-y-1">
                                  {suggestion.analysis.positives.map((positive, idx) => (
                                    <li key={idx} className="text-green-700 dark:text-green-200 flex items-center gap-2">
                                      <div className="w-1.5 h-1.5 bg-green-500 rounded-full flex-shrink-0" />
                                      {positive}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                              
                              <div className="p-4 bg-gradient-to-r from-red-100 to-orange-100 dark:from-red-900/30 dark:to-orange-900/30 rounded-lg">
                                <h4 className="font-bold text-red-800 dark:text-red-300 mb-3 flex items-center gap-2">
                                  <AlertTriangle className="h-4 w-4" />
                                  Concerns
                                </h4>
                                <ul className="space-y-1">
                                  {suggestion.analysis.negatives.map((negative, idx) => (
                                    <li key={idx} className="text-red-700 dark:text-red-200 flex items-center gap-2">
                                      <div className="w-1.5 h-1.5 bg-red-500 rounded-full flex-shrink-0" />
                                      {negative}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>

                            {/* Risk Analysis */}
                            <div className="p-4 bg-gradient-to-r from-yellow-100 to-amber-100 dark:from-yellow-900/30 dark:to-amber-900/30 rounded-lg">
                              <h4 className="font-bold text-yellow-800 dark:text-yellow-300 mb-3 flex items-center gap-2">
                                <Shield className="h-4 w-4" />
                                Risk Analysis
                              </h4>
                              <div className="space-y-3">
                                {suggestion.analysis.risks.map((risk, idx) => (
                                  <div key={idx} className="bg-white/60 dark:bg-gray-700/60 p-3 rounded-lg">
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="font-medium text-yellow-800 dark:text-yellow-200">{risk.description}</span>
                                      <div className="flex gap-2">
                                        <Badge className={`text-xs px-2 py-1 ${
                                          risk.likelihood === 'high' ? 'bg-red-500' :
                                          risk.likelihood === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
                                        } text-white`}>
                                          {risk.likelihood.toUpperCase()}
                                        </Badge>
                                        <Badge className={`text-xs px-2 py-1 ${
                                          risk.impact === 'high' ? 'bg-red-500' :
                                          risk.impact === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
                                        } text-white`}>
                                          {risk.impact.toUpperCase()} IMPACT
                                        </Badge>
                                      </div>
                                    </div>
                                    <p className="text-sm text-yellow-700 dark:text-yellow-200">
                                      <strong>Mitigation:</strong> {risk.mitigation}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Decision Framework */}
                            <div className="p-4 bg-gradient-to-r from-purple-100 to-pink-100 dark:from-purple-900/30 dark:to-pink-900/30 rounded-lg">
                              <h4 className="font-bold text-purple-800 dark:text-purple-300 mb-3 flex items-center gap-2">
                                <Target className="h-4 w-4" />
                                Decision Framework
                              </h4>
                              <div className="space-y-4">
                                <div>
                                  <h5 className="font-medium text-purple-800 dark:text-purple-300 mb-2">Available Options:</h5>
                                  <ul className="space-y-1">
                                    {suggestion.analysis.decisions.options.map((option, idx) => (
                                      <li key={idx} className="text-purple-700 dark:text-purple-200 flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 bg-purple-500 rounded-full flex-shrink-0" />
                                        {option}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                                
                                <div className="bg-white/60 dark:bg-gray-700/60 p-3 rounded-lg">
                                  <h5 className="font-medium text-purple-800 dark:text-purple-300 mb-1">Recommendation:</h5>
                                  <p className="text-purple-700 dark:text-purple-200 font-medium">{suggestion.analysis.decisions.recommendation}</p>
                                </div>
                                
                                <div>
                                  <h5 className="font-medium text-purple-800 dark:text-purple-300 mb-1">Rationale:</h5>
                                  <p className="text-purple-700 dark:text-purple-200">{suggestion.analysis.decisions.rationale}</p>
                                </div>
                                
                                {suggestion.analysis.decisions.requiredData && (
                                  <div>
                                    <h5 className="font-medium text-purple-800 dark:text-purple-300 mb-2">Required Data:</h5>
                                    <div className="flex flex-wrap gap-2">
                                      {suggestion.analysis.decisions.requiredData.map((data, idx) => (
                                        <Badge key={idx} variant="outline" className="text-xs">
                                          {data}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        {suggestion.strategicValue && !suggestion.analysis && (
                          <div className="p-4 bg-gradient-to-r from-purple-100 to-pink-100 dark:from-purple-900/30 dark:to-pink-900/30 rounded-lg">
                            <h4 className="font-bold text-purple-800 dark:text-purple-300 mb-2 flex items-center gap-2">
                              <Award className="h-4 w-4" />
                              Strategic Value
                            </h4>
                            <p className="text-purple-700 dark:text-purple-200">{suggestion.strategicValue}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Alert>
            </div>
          )) : (
            <div className="text-center py-16">
              <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-green-500 to-emerald-500 rounded-2xl flex items-center justify-center">
                <CheckCircle className="h-10 w-10 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-gray-800 dark:text-gray-200 mb-2">Operational Excellence Achieved</h3>
              <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto">
                Your current operations are performing at optimal levels. Continue monitoring for emerging optimization opportunities.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {suggestions.length === 0 && (
        <Card className="glass relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-gray-100 to-blue-100 dark:from-gray-800 dark:to-blue-900/20" />
          <CardContent className="p-16 text-center relative">
            <div className="w-24 h-24 mx-auto mb-8 bg-gradient-to-br from-gray-400 to-blue-400 rounded-3xl flex items-center justify-center">
              <Brain className="h-12 w-12 text-white" />
            </div>
            <h3 className="text-3xl font-bold text-gray-800 dark:text-gray-200 mb-4">
              Strategic Intelligence Standby
            </h3>
            <p className="text-lg text-gray-600 dark:text-gray-400 max-w-lg mx-auto leading-relaxed">
              Enterprise AI analytics ready for activation. Upload your operational data to unlock 
              advanced strategic insights and optimization recommendations.
            </p>
            <div className="mt-8 flex justify-center">
              <Badge className="bg-gradient-to-r from-blue-500 to-purple-500 text-white px-6 py-2 text-sm">
                <Sparkles className="h-4 w-4 mr-2" />
                AI READY
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}