import React, { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { 
  AlertTriangle, AlertCircle, Info, CheckCircle, X, Bell, 
  TrendingDown, TrendingUp, Users, Clock, Calendar, Target
} from "lucide-react";
import { format, parseISO, isToday, isTomorrow, differenceInDays } from "date-fns";
import type { ProcessingResult, DailySummaryRecord, EmployeeDailyDetail } from "@shared/schema";

interface SmartAlert {
  id: string;
  type: 'critical' | 'warning' | 'info' | 'success';
  priority: number;
  title: string;
  description: string;
  date?: string;
  employees?: string[];
  value?: number;
  threshold?: number;
  actionable: boolean;
  dismissed?: boolean;
  createdAt: Date;
}

interface SmartAlertsProps {
  data: ProcessingResult | null;
  onAlertAction?: (alertId: string, action: string, data?: any) => void;
}

const ALERT_THRESHOLDS = {
  criticalShortage: -10,  // Hours
  warningShortage: -5,    // Hours
  highSickness: 15,       // Percentage of daily capacity
  lowUtilization: 60,     // Percentage
  consecutiveShortages: 3  // Days
};

const ALERT_ICONS = {
  critical: AlertTriangle,
  warning: AlertCircle,
  info: Info,
  success: CheckCircle
};

const ALERT_COLORS = {
  critical: 'destructive',
  warning: 'secondary',
  info: 'outline',
  success: 'default'
} as const;

export function SmartAlerts({ data, onAlertAction }: SmartAlertsProps) {
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());
  const [alertHistory, setAlertHistory] = useState<SmartAlert[]>([]);

  // Generate smart alerts based on data analysis
  const alerts = useMemo((): SmartAlert[] => {
    if (!data?.dailySummary.length) return [];

    const alerts: SmartAlert[] = [];
    let alertId = 0;

    // 1. Critical Capacity Shortages
    data.dailySummary.forEach(day => {
      if (day.gap <= ALERT_THRESHOLDS.criticalShortage) {
        const affectedEmployees = data.employeesByDate[day.date] || [];
        const urgency = isToday(parseISO(day.date)) ? 'TODAY' : 
                       isTomorrow(parseISO(day.date)) ? 'TOMORROW' : 
                       differenceInDays(parseISO(day.date), new Date()) <= 3 ? 'THIS WEEK' : '';

        alerts.push({
          id: `critical-shortage-${alertId++}`,
          type: 'critical',
          priority: 1,
          title: `Critical Staff Shortage ${urgency}`,
          description: `${Math.abs(day.gap)} hours short of required capacity on ${format(parseISO(day.date), 'MMM dd')}. Immediate action needed.`,
          date: day.date,
          employees: affectedEmployees.filter(emp => emp.status === 'Available').map(emp => emp.employeeName),
          value: day.gap,
          threshold: ALERT_THRESHOLDS.criticalShortage,
          actionable: true,
          createdAt: new Date()
        });
      }
    });

    // 2. Warning Level Shortages
    data.dailySummary
      .filter(day => day.gap > ALERT_THRESHOLDS.criticalShortage && day.gap <= ALERT_THRESHOLDS.warningShortage)
      .forEach(day => {
        alerts.push({
          id: `warning-shortage-${alertId++}`,
          type: 'warning',
          priority: 2,
          title: 'Capacity Warning',
          description: `${Math.abs(day.gap)} hours below required capacity on ${format(parseISO(day.date), 'MMM dd')}.`,
          date: day.date,
          value: day.gap,
          threshold: ALERT_THRESHOLDS.warningShortage,
          actionable: true,
          createdAt: new Date()
        });
      });

    // 3. High Sickness Levels
    data.dailySummary.forEach(day => {
      if (day.sickness > 0) {
        const sicknessPercentage = (day.sickness / (day.netCapacity + day.sickness)) * 100;
        if (sicknessPercentage >= ALERT_THRESHOLDS.highSickness) {
          const sickEmployees = data.employeesByDate[day.date]?.filter(emp => emp.status === 'Sick') || [];
          
          alerts.push({
            id: `high-sickness-${alertId++}`,
            type: 'warning',
            priority: 3,
            title: 'High Sickness Rate',
            description: `${Math.round(sicknessPercentage)}% of staff capacity lost to sickness on ${format(parseISO(day.date), 'MMM dd')} (${sickEmployees.length} employees).`,
            date: day.date,
            employees: sickEmployees.map(emp => emp.employeeName),
            value: sicknessPercentage,
            threshold: ALERT_THRESHOLDS.highSickness,
            actionable: true,
            createdAt: new Date()
          });
        }
      }
    });

    // 4. Consecutive Shortages Pattern
    let consecutiveShortages = 0;
    let shortageStart = '';
    data.dailySummary.forEach((day, index) => {
      if (day.gap < 0) {
        if (consecutiveShortages === 0) {
          shortageStart = day.date;
        }
        consecutiveShortages++;
      } else {
        if (consecutiveShortages >= ALERT_THRESHOLDS.consecutiveShortages) {
          alerts.push({
            id: `consecutive-shortage-${alertId++}`,
            type: 'critical',
            priority: 1,
            title: 'Persistent Staffing Issue',
            description: `${consecutiveShortages} consecutive days of staff shortages detected (${format(parseISO(shortageStart), 'MMM dd')} onwards). This indicates a systemic staffing problem.`,
            date: shortageStart,
            value: consecutiveShortages,
            threshold: ALERT_THRESHOLDS.consecutiveShortages,
            actionable: true,
            createdAt: new Date()
          });
        }
        consecutiveShortages = 0;
      }
    });

    // 5. Low Capacity Utilization
    const totalDemand = data.dailySummary.reduce((sum, day) => sum + day.clientRequired, 0);
    const totalCapacity = data.dailySummary.reduce((sum, day) => sum + day.netCapacity, 0);
    const utilizationRate = totalDemand > 0 ? (totalCapacity / totalDemand) * 100 : 100;

    if (utilizationRate < ALERT_THRESHOLDS.lowUtilization) {
      alerts.push({
        id: `low-utilization-${alertId++}`,
        type: 'info',
        priority: 4,
        title: 'Low Capacity Utilization',
        description: `Overall capacity utilization is ${Math.round(utilizationRate)}%, suggesting potential for schedule optimization or cost reduction.`,
        value: utilizationRate,
        threshold: ALERT_THRESHOLDS.lowUtilization,
        actionable: true,
        createdAt: new Date()
      });
    }

    // 6. Positive Insights
    const surplusDays = data.dailySummary.filter(day => day.gap > 10);
    if (surplusDays.length > 0) {
      alerts.push({
        id: `surplus-capacity-${alertId++}`,
        type: 'success',
        priority: 5,
        title: 'Surplus Capacity Opportunities',
        description: `${surplusDays.length} days with significant surplus capacity (${surplusDays.reduce((sum, day) => sum + day.gap, 0)} total hours). Consider additional client services or staff optimization.`,
        value: surplusDays.length,
        actionable: true,
        createdAt: new Date()
      });
    }

    // 7. Weekend/Holiday Planning
    data.dailySummary.forEach(day => {
      const date = parseISO(day.date);
      const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
      
      if ((dayOfWeek === 0 || dayOfWeek === 6) && day.gap < -2) {
        alerts.push({
          id: `weekend-shortage-${alertId++}`,
          type: 'warning',
          priority: 2,
          title: 'Weekend Staffing Challenge',
          description: `${Math.abs(day.gap)} hours shortage on ${format(date, 'EEEE, MMM dd')}. Weekend shifts may need premium rates or incentives.`,
          date: day.date,
          value: day.gap,
          actionable: true,
          createdAt: new Date()
        });
      }
    });

    // Sort by priority and date relevance
    return alerts.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.date && b.date) {
        const daysFromNowA = differenceInDays(parseISO(a.date), new Date());
        const daysFromNowB = differenceInDays(parseISO(b.date), new Date());
        return Math.abs(daysFromNowA) - Math.abs(daysFromNowB);
      }
      return 0;
    });
  }, [data]);

  // Filter out dismissed alerts
  const visibleAlerts = alerts.filter(alert => !dismissedAlerts.has(alert.id));

  const handleDismissAlert = (alertId: string) => {
    setDismissedAlerts(prev => new Set(Array.from(prev).concat(alertId)));
    
    // Add to history
    const alert = alerts.find(a => a.id === alertId);
    if (alert) {
      setAlertHistory(prev => [...prev, { ...alert, dismissed: true }].slice(-50)); // Keep last 50
    }
  };

  const handleAlertAction = (alert: SmartAlert, action: string) => {
    onAlertAction?.(alert.id, action, {
      date: alert.date,
      employees: alert.employees,
      type: alert.type
    });
  };

  const criticalCount = visibleAlerts.filter(a => a.type === 'critical').length;
  const warningCount = visibleAlerts.filter(a => a.type === 'warning').length;

  if (!data) {
    return (
      <Card data-testid="smart-alerts-empty">
        <CardContent className="flex items-center justify-center h-32">
          <p className="text-muted-foreground">No data available for alerts</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="smart-alerts">
      {/* Alert Summary */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Smart Alerts & Insights
          </CardTitle>
          <div className="flex items-center gap-2">
            {criticalCount > 0 && (
              <Badge variant="destructive" className="flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {criticalCount}
              </Badge>
            )}
            {warningCount > 0 && (
              <Badge variant="secondary" className="flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {warningCount}
              </Badge>
            )}
            {visibleAlerts.length === 0 && (
              <Badge variant="default" className="flex items-center gap-1">
                <CheckCircle className="h-3 w-3" />
                All Clear
              </Badge>
            )}
          </div>
        </CardHeader>
        
        {visibleAlerts.length === 0 ? (
          <CardContent>
            <div className="text-center py-8">
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <h3 className="text-lg font-medium">All Systems Optimal</h3>
              <p className="text-muted-foreground">No critical issues detected in your capacity planning.</p>
            </div>
          </CardContent>
        ) : (
          <CardContent className="space-y-4">
            {visibleAlerts.map((alert) => {
              const AlertIcon = ALERT_ICONS[alert.type];
              
              return (
                <Alert 
                  key={alert.id} 
                  variant={ALERT_COLORS[alert.type] as "default" | "destructive"}
                  className="relative"
                  data-testid={`alert-${alert.type}-${alert.id}`}
                >
                  <AlertIcon className="h-4 w-4" />
                  <div className="flex-1">
                    <AlertTitle className="flex items-center justify-between">
                      <span>{alert.title}</span>
                      <div className="flex items-center gap-2">
                        {alert.date && (
                          <Badge variant="outline" className="text-xs">
                            <Calendar className="h-3 w-3 mr-1" />
                            {format(parseISO(alert.date), 'MMM dd')}
                          </Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDismissAlert(alert.id)}
                          className="h-6 w-6 p-0"
                          data-testid={`button-dismiss-${alert.id}`}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </AlertTitle>
                    <AlertDescription className="mt-1">
                      {alert.description}
                      
                      {alert.employees && alert.employees.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs font-medium mb-1">Affected Staff:</p>
                          <div className="flex flex-wrap gap-1">
                            {alert.employees.slice(0, 5).map(emp => (
                              <Badge key={emp} variant="outline" className="text-xs">
                                {emp}
                              </Badge>
                            ))}
                            {alert.employees.length > 5 && (
                              <Badge variant="outline" className="text-xs">
                                +{alert.employees.length - 5} more
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {alert.actionable && (
                        <div className="flex gap-2 mt-3">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleAlertAction(alert, 'view-details')}
                            data-testid={`button-view-details-${alert.id}`}
                          >
                            View Details
                          </Button>
                          {alert.type === 'critical' && (
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleAlertAction(alert, 'urgent-action')}
                              data-testid={`button-urgent-action-${alert.id}`}
                            >
                              Take Action
                            </Button>
                          )}
                        </div>
                      )}
                    </AlertDescription>
                  </div>
                </Alert>
              );
            })}
          </CardContent>
        )}
      </Card>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-sm font-medium">Critical Alerts</p>
              <p className="text-2xl font-bold text-red-600">{criticalCount}</p>
            </div>
            <AlertTriangle className="h-8 w-8 text-red-500" />
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-sm font-medium">Warnings</p>
              <p className="text-2xl font-bold text-amber-600">{warningCount}</p>
            </div>
            <AlertCircle className="h-8 w-8 text-amber-500" />
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-sm font-medium">Total Alerts</p>
              <p className="text-2xl font-bold">{visibleAlerts.length}</p>
            </div>
            <Bell className="h-8 w-8 text-blue-500" />
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-sm font-medium">Dismissed</p>
              <p className="text-2xl font-bold text-gray-600">{dismissedAlerts.size}</p>
            </div>
            <CheckCircle className="h-8 w-8 text-gray-500" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}