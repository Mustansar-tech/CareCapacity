import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  CheckCircle, AlertTriangle, Info, TrendingUp, 
  Database, Users, Clock, Target, Shield
} from "lucide-react";
import type { ProcessingResult } from "@shared/schema";

interface DataQualityMetrics {
  completeness: {
    score: number;
    details: string[];
  };
  accuracy: {
    score: number;
    details: string[];
  };
  consistency: {
    score: number;
    details: string[];
  };
  reliability: {
    score: number;
    details: string[];
  };
  overall: number;
  anomalies: Array<{
    type: 'warning' | 'error' | 'info';
    message: string;
    affected: number;
  }>;
}

interface DataQualityPanelProps {
  data: ProcessingResult | null;
  warnings?: string[];
}

export function DataQualityPanel({ data, warnings = [] }: DataQualityPanelProps) {
  const qualityMetrics = useMemo((): DataQualityMetrics => {
    if (!data) {
      return {
        completeness: { score: 0, details: [] },
        accuracy: { score: 0, details: [] },
        consistency: { score: 0, details: [] },
        reliability: { score: 0, details: [] },
        overall: 0,
        anomalies: []
      };
    }

    const metrics: DataQualityMetrics = {
      completeness: { score: 0, details: [] },
      accuracy: { score: 0, details: [] },
      consistency: { score: 0, details: [] },
      reliability: { score: 0, details: [] },
      overall: 0,
      anomalies: []
    };

    // 1. Data Completeness Analysis
    const totalDays = data.dailySummary.length;
    const daysWithEmployees = Object.keys(data.employeesByDate).length;
    const completenessRatio = totalDays > 0 ? (daysWithEmployees / totalDays) * 100 : 0;
    
    metrics.completeness.score = completenessRatio;
    metrics.completeness.details.push(`${daysWithEmployees}/${totalDays} days have employee data`);
    
    // Check for missing client demand data
    const daysWithoutDemand = data.dailySummary.filter(day => day.clientRequired === 0).length;
    if (daysWithoutDemand > 0) {
      metrics.completeness.details.push(`${daysWithoutDemand} days missing client demand data`);
      metrics.completeness.score -= (daysWithoutDemand / totalDays) * 20;
    }

    // 2. Data Accuracy Analysis
    let accuracyIssues = 0;
    const totalEmployeeRecords = Object.values(data.employeesByDate).flat().length;
    
    // Check for unrealistic working hours
    Object.values(data.employeesByDate).flat().forEach(employee => {
      if (employee.contractedDailyHours > 24) {
        accuracyIssues++;
        metrics.anomalies.push({
          type: 'error',
          message: `${employee.employeeName} has unrealistic daily hours: ${employee.contractedDailyHours}h`,
          affected: 1
        });
      }
      
      if (employee.hours > employee.contractedDailyHours * 1.5) {
        accuracyIssues++;
        metrics.anomalies.push({
          type: 'warning',
          message: `${employee.employeeName} working significantly over contracted hours`,
          affected: 1
        });
      }
    });

    metrics.accuracy.score = Math.max(0, 100 - (accuracyIssues / totalEmployeeRecords) * 100);
    metrics.accuracy.details.push(`${accuracyIssues} accuracy issues identified`);

    // 3. Data Consistency Analysis
    let consistencyIssues = 0;
    const employeeNames = new Set<string>();
    const nameVariations = new Map<string, Set<string>>();

    // Check for name consistency across days
    Object.values(data.employeesByDate).flat().forEach(employee => {
      const baseName = employee.employeeName.toLowerCase().replace(/[^a-z\s]/g, '');
      if (!nameVariations.has(baseName)) {
        nameVariations.set(baseName, new Set());
      }
      nameVariations.get(baseName)!.add(employee.employeeName);
      employeeNames.add(employee.employeeName);
    });

    // Detect potential name variations
    nameVariations.forEach((variations, baseName) => {
      if (variations.size > 1) {
        consistencyIssues++;
        metrics.anomalies.push({
          type: 'info',
          message: `Potential name variations detected: ${Array.from(variations).join(', ')}`,
          affected: variations.size
        });
      }
    });

    // Check for consistent contracted hours per employee
    const employeeHours = new Map<string, Set<number>>();
    Object.values(data.employeesByDate).flat().forEach(employee => {
      if (!employeeHours.has(employee.employeeName)) {
        employeeHours.set(employee.employeeName, new Set());
      }
      employeeHours.get(employee.employeeName)!.add(employee.contractedDailyHours);
    });

    employeeHours.forEach((hoursSet, name) => {
      if (hoursSet.size > 1) {
        consistencyIssues++;
        metrics.anomalies.push({
          type: 'warning',
          message: `${name} has inconsistent contracted hours: ${Array.from(hoursSet).join(', ')}h`,
          affected: 1
        });
      }
    });

    metrics.consistency.score = Math.max(0, 100 - (consistencyIssues / employeeNames.size) * 50);
    metrics.consistency.details.push(`${consistencyIssues} consistency issues found`);
    metrics.consistency.details.push(`${employeeNames.size} unique employees identified`);

    // 4. Data Reliability Analysis
    const warningCount = warnings.length;
    let reliabilityScore = 100;
    
    if (warningCount > 0) {
      reliabilityScore -= Math.min(warningCount * 5, 50); // Max 50 point deduction
      metrics.reliability.details.push(`${warningCount} processing warnings`);
    }

    // Check for data gaps or unusual patterns
    const sortedDays = data.dailySummary.sort((a, b) => a.date.localeCompare(b.date));
    let gapCount = 0;
    
    for (let i = 1; i < sortedDays.length; i++) {
      const prevDate = new Date(sortedDays[i - 1].date);
      const currDate = new Date(sortedDays[i].date);
      const dayDiff = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24);
      
      if (dayDiff > 1) {
        gapCount++;
        if (dayDiff > 7) {
          metrics.anomalies.push({
            type: 'warning',
            message: `${Math.floor(dayDiff)} day gap in data between ${prevDate.toDateString()} and ${currDate.toDateString()}`,
            affected: Math.floor(dayDiff)
          });
        }
      }
    }

    if (gapCount > 0) {
      reliabilityScore -= gapCount * 5;
      metrics.reliability.details.push(`${gapCount} data gaps identified`);
    }

    metrics.reliability.score = Math.max(0, reliabilityScore);

    // Calculate overall score
    metrics.overall = Math.round(
      (metrics.completeness.score * 0.3 +
       metrics.accuracy.score * 0.3 +
       metrics.consistency.score * 0.2 +
       metrics.reliability.score * 0.2)
    );

    return metrics;
  }, [data, warnings]);

  const getScoreColor = (score: number) => {
    if (score >= 90) return "text-green-600";
    if (score >= 70) return "text-amber-600";
    return "text-red-600";
  };

  const getScoreVariant = (score: number) => {
    if (score >= 90) return "default";
    if (score >= 70) return "secondary";
    return "destructive";
  };

  if (!data) {
    return (
      <Card data-testid="data-quality-panel-empty">
        <CardContent className="flex items-center justify-center h-32">
          <p className="text-muted-foreground">No data available for quality analysis</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="data-quality-panel">
      {/* Overall Quality Score */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Data Quality Score
            <Badge variant={getScoreVariant(qualityMetrics.overall)} className="ml-2">
              {qualityMetrics.overall}/100
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Progress value={qualityMetrics.overall} className="h-3 mb-4" />
          <p className="text-sm text-muted-foreground">
            {qualityMetrics.overall >= 90 
              ? "Excellent data quality - ready for confident decision making"
              : qualityMetrics.overall >= 70
              ? "Good data quality - minor issues identified"
              : "Data quality needs attention - review issues before making critical decisions"
            }
          </p>
        </CardContent>
      </Card>

      {/* Quality Metrics Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completeness</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-2">
              <div className={`text-2xl font-bold ${getScoreColor(qualityMetrics.completeness.score)}`}>
                {Math.round(qualityMetrics.completeness.score)}%
              </div>
            </div>
            <Progress value={qualityMetrics.completeness.score} className="h-2 mb-2" />
            <div className="text-xs text-muted-foreground">
              {qualityMetrics.completeness.details.map((detail, index) => (
                <div key={index}>{detail}</div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Accuracy</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-2">
              <div className={`text-2xl font-bold ${getScoreColor(qualityMetrics.accuracy.score)}`}>
                {Math.round(qualityMetrics.accuracy.score)}%
              </div>
            </div>
            <Progress value={qualityMetrics.accuracy.score} className="h-2 mb-2" />
            <div className="text-xs text-muted-foreground">
              {qualityMetrics.accuracy.details.map((detail, index) => (
                <div key={index}>{detail}</div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Consistency</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-2">
              <div className={`text-2xl font-bold ${getScoreColor(qualityMetrics.consistency.score)}`}>
                {Math.round(qualityMetrics.consistency.score)}%
              </div>
            </div>
            <Progress value={qualityMetrics.consistency.score} className="h-2 mb-2" />
            <div className="text-xs text-muted-foreground">
              {qualityMetrics.consistency.details.map((detail, index) => (
                <div key={index}>{detail}</div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Reliability</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-2">
              <div className={`text-2xl font-bold ${getScoreColor(qualityMetrics.reliability.score)}`}>
                {Math.round(qualityMetrics.reliability.score)}%
              </div>
            </div>
            <Progress value={qualityMetrics.reliability.score} className="h-2 mb-2" />
            <div className="text-xs text-muted-foreground">
              {qualityMetrics.reliability.details.map((detail, index) => (
                <div key={index}>{detail}</div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Anomalies and Issues */}
      {qualityMetrics.anomalies.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Detected Issues
              <Badge variant="secondary">{qualityMetrics.anomalies.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {qualityMetrics.anomalies.map((anomaly, index) => {
              const Icon = anomaly.type === 'error' ? AlertTriangle : 
                          anomaly.type === 'warning' ? AlertTriangle : Info;
              const variant = anomaly.type === 'error' ? 'destructive' :
                             anomaly.type === 'warning' ? 'secondary' : 'outline';
              
              return (
                <Alert key={index} variant={variant as any}>
                  <Icon className="h-4 w-4" />
                  <AlertTitle className="text-sm">
                    {anomaly.type.charAt(0).toUpperCase() + anomaly.type.slice(1)}
                    {anomaly.affected > 1 && (
                      <Badge variant="outline" className="ml-2 text-xs">
                        {anomaly.affected} affected
                      </Badge>
                    )}
                  </AlertTitle>
                  <AlertDescription className="text-sm">
                    {anomaly.message}
                  </AlertDescription>
                </Alert>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Processing Warnings */}
      {warnings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="h-5 w-5" />
              Processing Warnings
              <Badge variant="secondary">{warnings.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {warnings.map((warning, index) => (
                <div key={index} className="text-sm bg-muted p-2 rounded">
                  {warning}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}