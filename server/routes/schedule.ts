import type { Express } from 'express';
import { storage } from '../storage';
import { logger } from '../logger';
import { safeErrorMessage, resolveBranch } from '../utils/helpers';
import { getCanonicalWeekBoundaries, type ProcessingResult } from '@shared/schema';
import { requireAuth, requireRoleAtLeast } from '../auth';

async function getProcessingResults(branchId: string): Promise<ProcessingResult | null> {
  try {
    const analyses = await storage.getCapacityAnalyses(branchId);
    if (analyses.length === 0) return null;
    return analyses[0] as ProcessingResult;
  } catch (error) {
    logger.error('Error getting processing results', error);
    return null;
  }
}

function parseTimeWindowsForRouting(windows: string): Array<{ start: number; end: number }> {
  if (!windows) return [];
  const timeRanges = windows.split(',').map(w => w.trim()).filter(w => w);
  return timeRanges.map(range => {
    const match = range.match(/(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/);
    if (!match) return null;
    return {
      start: parseInt(match[1]) * 60 + parseInt(match[2]),
      end: parseInt(match[3]) * 60 + parseInt(match[4]),
    };
  }).filter((w): w is { start: number; end: number } => w !== null);
}

function timeStringToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  let time = timeStr;
  if (timeStr.includes('T')) {
    time = timeStr.split('T')[1].split(':').slice(0, 2).join(':');
  }
  const [hours, minutes] = time.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function calculateTravelMinutes(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  mode: string
): number {
  const R = 6371;
  const dLat = (to.lat - from.lat) * Math.PI / 180;
  const dLon = (to.lng - from.lng) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((from.lat * Math.PI) / 180) *
      Math.cos((to.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c * 1.2;

  if (mode === 'walking') return Math.max(2, Math.round((distance / 5) * 60));
  if (mode === 'public') return Math.max(15, Math.round((distance / 15) * 60 + 15));
  return Math.max(5, Math.round((distance / 35) * 60));
}

function calculateTravelTimeBefore(visit: any, employee: any, insertionIndex: number): number {
  if (insertionIndex === 0) {
    return calculateTravelMinutes(
      { lat: employee.homeLat, lng: employee.homeLng },
      { lat: visit.lat, lng: visit.lng },
      employee.transportMode
    );
  }
  const prevVisit = employee.visits[insertionIndex - 1];
  return calculateTravelMinutes(
    { lat: prevVisit.lat, lng: prevVisit.lng },
    { lat: visit.lat, lng: visit.lng },
    employee.transportMode
  );
}

function calculateTravelTimeAfter(visit: any, employee: any, insertionIndex: number): number {
  if (insertionIndex >= employee.visits.length) {
    return calculateTravelMinutes(
      { lat: visit.lat, lng: visit.lng },
      { lat: employee.homeLat, lng: employee.homeLng },
      employee.transportMode
    );
  }
  const nextVisit = employee.visits[insertionIndex];
  return calculateTravelMinutes(
    { lat: visit.lat, lng: visit.lng },
    { lat: nextVisit.lat, lng: nextVisit.lng },
    employee.transportMode
  );
}

function calculateInsertionScore(visit: any, employee: any, insertionIndex: number, settings: any): number {
  const travelBefore = calculateTravelTimeBefore(visit, employee, insertionIndex);
  const travelAfter = calculateTravelTimeAfter(visit, employee, insertionIndex);
  const totalTravel = travelBefore + travelAfter;

  if (totalTravel > settings.maxTravelPerVisit) return 0;

  let score = 1.0;
  score *= (1 - totalTravel / (settings.maxTravelPerVisit * 2)) * 0.4;

  const timeWindowFit = employee.timeWindows.some(
    (window: any) => visit.startTime >= window.start && visit.endTime <= window.end
  ) ? 1 : 0;
  score += timeWindowFit * 0.3;

  const currentUtilization =
    employee.contractedDailyHours > 0
      ? employee.totalWorkTime / 60 / employee.contractedDailyHours
      : 0;
  const utilizationScore =
    currentUtilization < 0.8 ? 1 : Math.max(0, 1 - (currentUtilization - 0.8) / 0.2);
  score += utilizationScore * 0.2;
  score += ((4 - visit.priority) / 3) * 0.1;

  return Math.max(0, score);
}

async function getAvailableEmployeesForDate(branchId: string, date: string) {
  try {
    const results = await getProcessingResults(branchId);
    if (!results) return [];

    const employeesForDate = results.employeesByDate?.[date] || [];
    const employeeLocations = results.employeeLocations || [];

    return employeesForDate
      .filter((emp: any) => ['Available', 'Partial Availability'].includes(emp.status))
      .map((emp: any) => {
        const location = employeeLocations.find((loc: any) => loc.employeeName === emp.employeeName);
        const timeWindows = parseTimeWindowsForRouting(emp.timeWindows);
        return {
          employeeName: emp.employeeName,
          homeLat: location?.homeLat ? Number(location.homeLat) : 55.9533,
          homeLng: location?.homeLng ? Number(location.homeLng) : -3.1883,
          transportMode: location?.transportMode?.toLowerCase().includes('car') ? 'car' : 'walking',
          timeWindows,
          contractedDailyHours: emp.contractedDailyHours,
          visits: [],
          totalTravelTime: 0,
          totalWorkTime: 0,
          utilizationPercent: 0,
        };
      });
  } catch (error) {
    logger.error('Error getting available employees', error);
    return [];
  }
}

async function getUnassignedVisitsForDate(branchId: string, date: string) {
  try {
    const visits = await storage.listVisitsBetween(branchId, date, date);
    const results = await getProcessingResults(branchId);
    const clientLocations = results?.clientLocations || [];

    return visits.map((visit: any) => {
      const clientName = visit.clientId || visit.clientName || 'Unknown Client';
      const client = clientLocations.find((c: any) => c.clientName === clientName);
      return {
        id: visit.id || `${clientName}-${date}`,
        clientName,
        startTime: timeStringToMinutes(visit.preferredStartTime || '09:00'),
        endTime: timeStringToMinutes(visit.preferredEndTime || '10:00'),
        durationMinutes: visit.durationMinutes || 60,
        priority: visit.priority || 2,
        serviceType: visit.serviceType || 'Personal Care',
        lat: client?.lat ? Number(client.lat) : undefined,
        lng: client?.lng ? Number(client.lng) : undefined,
      };
    });
  } catch (error) {
    logger.error('Error getting unassigned visits', error);
    return [];
  }
}

async function optimizeRoutesForDay(date: string, employees: any[], visits: any[], settings: any) {
  logger.info('Optimizing routes', { date, employeeCount: employees.length, visitCount: visits.length });

  const employeeSchedules = employees.map(emp => ({ ...emp, visits: [] }));
  const unassignedVisits = [...visits];

  unassignedVisits.sort((a, b) => a.priority - b.priority);

  for (const visit of visits) {
    if (!visit.lat || !visit.lng) continue;

    let bestEmployee = null;
    let bestScore = -1;
    let bestInsertionIndex = 0;

    for (const employee of employeeSchedules) {
      const canFit = employee.timeWindows.some(
        (window: any) => visit.startTime >= window.start && visit.endTime <= window.end
      );
      if (!canFit) continue;

      for (let insertionIndex = 0; insertionIndex <= employee.visits.length; insertionIndex++) {
        const score = calculateInsertionScore(visit, employee, insertionIndex, settings);
        if (score > bestScore) {
          bestScore = score;
          bestEmployee = employee;
          bestInsertionIndex = insertionIndex;
        }
      }
    }

    if (bestEmployee && bestScore > 0) {
      const travelTimeBefore = calculateTravelTimeBefore(visit, bestEmployee, bestInsertionIndex);
      const travelTimeAfter = calculateTravelTimeAfter(visit, bestEmployee, bestInsertionIndex);

      const assignedVisit = {
        ...visit,
        employeeName: bestEmployee.employeeName,
        actualStartTime: visit.startTime,
        actualEndTime: visit.endTime,
        travelTimeBefore,
        travelTimeAfter,
        score: bestScore,
      };

      bestEmployee.visits.splice(bestInsertionIndex, 0, assignedVisit);
      bestEmployee.totalTravelTime += travelTimeBefore + travelTimeAfter;
      bestEmployee.totalWorkTime += visit.durationMinutes;
      bestEmployee.utilizationPercent =
        bestEmployee.contractedDailyHours > 0
          ? Math.round(
              (bestEmployee.totalWorkTime / 60 / bestEmployee.contractedDailyHours) * 100
            )
          : 0;

      const index = unassignedVisits.findIndex(v => v.id === visit.id);
      if (index > -1) unassignedVisits.splice(index, 1);
    }
  }

  const totalAssigned = employeeSchedules.reduce((sum, emp) => sum + emp.visits.length, 0);
  const totalTravelTime = employeeSchedules.reduce((sum, emp) => sum + emp.totalTravelTime, 0);
  const avgUtilization =
    employeeSchedules.length > 0
      ? Math.round(
          employeeSchedules.reduce((sum, emp) => sum + emp.utilizationPercent, 0) /
            employeeSchedules.length
        )
      : 0;
  const routeEfficiency =
    visits.length > 0 ? Math.round((totalAssigned / visits.length) * 100) : 0;

  return {
    date,
    employees: employeeSchedules,
    unassignedVisits,
    metrics: {
      totalAssignedVisits: totalAssigned,
      totalUnassignedVisits: unassignedVisits.length,
      averageUtilization: avgUtilization,
      totalTravelTime,
      routeEfficiency,
    },
  };
}

export function registerScheduleRoutes(app: Express): void {
  app.post('/api/schedule/auto-day', async (req, res) => {
    try {
      const { date } = req.body;
      const branchId = await resolveBranch(req);

      if (!date) return res.status(400).json({ error: 'Date is required' });

      logger.info('Generating schedule for day', { date, branchId });
      const { autoScheduler } = await import('../auto-scheduler');
      const schedule = await autoScheduler.scheduleDay(date, branchId);
      res.json(schedule);
    } catch (error) {
      logger.error('Error auto-scheduling day', error);
      res.status(500).json({ error: 'Failed to auto-schedule day' });
    }
  });

  app.post('/api/schedule/auto-week', async (req, res) => {
    try {
      const { startDate } = req.body;
      const branchId = await resolveBranch(req);

      if (!startDate) return res.status(400).json({ error: 'Start date is required' });

      logger.info('Generating schedule for week', { startDate, branchId });
      const { autoScheduler } = await import('../auto-scheduler');
      const weekSchedule = await autoScheduler.scheduleWeek(startDate, branchId);
      res.json(weekSchedule);
    } catch (error) {
      logger.error('Error auto-scheduling week', error);
      res.status(500).json({ error: 'Failed to auto-schedule week' });
    }
  });

  app.get('/api/schedule/week/:startDate', async (req, res) => {
    try {
      const { startDate } = req.params;
      const branchId = await resolveBranch(req);
      const { autoScheduler } = await import('../auto-scheduler');
      const weekSchedule = await autoScheduler.getWeekSchedule(startDate, branchId);
      res.json(weekSchedule);
    } catch (error) {
      logger.error('Error getting weekly schedule', error);
      res.status(500).json({ error: 'Failed to get weekly schedule' });
    }
  });

  app.post('/api/run-optimization/optimize', async (req, res) => {
    try {
      const { date } = req.body;
      const branchId = await resolveBranch(req);

      if (!date) return res.status(400).json({ error: 'Date is required' });

      logger.info('Starting run optimization', { date, branchId });
      const { autoScheduler } = await import('../auto-scheduler');
      const result = await autoScheduler.scheduleDay(date, branchId);
      res.json(result);
    } catch (error) {
      logger.error('Run optimization error', error);
      res.status(500).json({
        error: 'Run optimization failed',
        details: safeErrorMessage(error, 'An error occurred'),
      });
    }
  });

  app.post('/api/auto-schedule', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const { date, settings } = req.body;

      if (!date) return res.status(400).json({ error: 'Date is required' });

      logger.info('Starting route optimization', { date, branchId });

      const employees = await getAvailableEmployeesForDate(branchId, date);
      logger.debug('Found available employees', { count: employees.length });

      const visits = await getUnassignedVisitsForDate(branchId, date);
      logger.debug('Found visits to schedule', { count: visits.length });

      if (employees.length === 0 || visits.length === 0) {
        return res.json({
          date,
          employees: [],
          unassignedVisits: visits,
          metrics: {
            totalAssignedVisits: 0,
            totalUnassignedVisits: visits.length,
            averageUtilization: 0,
            totalTravelTime: 0,
            routeEfficiency: 0,
          },
        });
      }

      const optimizedSchedule = await optimizeRoutesForDay(date, employees, visits, settings);
      res.json(optimizedSchedule);
    } catch (error) {
      logger.error('Auto-scheduling error', error);
      res.status(500).json({
        error: 'Auto-scheduling failed',
        details: safeErrorMessage(error, 'An error occurred'),
      });
    }
  });

  app.post(
    '/api/weekly-schedule/generate',
    requireAuth,
    requireRoleAtLeast('scheduler'),
    async (req, res) => {
      try {
        const { weekStartDate } = req.body;
        const branchId = await resolveBranch(req);

        if (!weekStartDate) return res.status(400).json({ message: 'weekStartDate is required' });

        const { weekStart, weekEnd } = getCanonicalWeekBoundaries(weekStartDate);

        const latestData = await storage.getLatestCapacityAnalysis(branchId);
        if (!latestData) {
          return res.status(404).json({
            message: `No processed data available for branch ${branchId}. Please process files first.`,
          });
        }

        const scheduleData = { employees: [], weekDates: [] };
        const metrics = {
          totalVisitsAssigned: 0,
          totalVisitsUnallocated: 0,
          averageTravelTimePerVisit: 0,
          employeesUtilized: 0,
        };

        const savedSchedule = await storage.saveWeeklySchedule({
          branchId,
          weekStartDate: weekStart,
          weekEndDate: weekEnd,
          scheduleData,
          unallocatedVisits: [],
          metrics,
        });

        res.json(savedSchedule);
      } catch (error) {
        logger.error('Error generating weekly schedule', error);
        res.status(500).json({
          message: 'Failed to generate weekly schedule',
          error: safeErrorMessage(error, 'Unknown error'),
        });
      }
    }
  );

  app.get('/api/weekly-schedule/latest', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const latestSchedule = await storage.getLatestWeeklySchedule(branchId);

      if (!latestSchedule) {
        return res.status(404).json({ message: 'No weekly schedules found' });
      }

      res.json(latestSchedule);
    } catch (error) {
      logger.error('Error fetching latest weekly schedule', error);
      const message = safeErrorMessage(error, 'Failed to fetch weekly schedule');
      const statusCode =
        message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message, error: safeErrorMessage(error, 'Unknown error') });
    }
  });

  app.get('/api/weekly-schedule/:weekStartDate', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const { weekStartDate } = req.params;
      const { weekStart, weekEnd } = getCanonicalWeekBoundaries(weekStartDate);

      const schedule = await storage.getWeeklyScheduleByWeek(branchId, weekStart, weekEnd);

      if (!schedule) {
        return res.status(404).json({ message: 'Schedule not found for this week' });
      }

      res.json(schedule);
    } catch (error) {
      logger.error('Error fetching weekly schedule', error);
      const message = safeErrorMessage(error, 'Failed to fetch weekly schedule');
      const statusCode =
        message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message, error: safeErrorMessage(error, 'Unknown error') });
    }
  });

  app.post(
    '/api/weekly-schedule/save',
    requireAuth,
    requireRoleAtLeast('scheduler'),
    async (req, res) => {
      try {
        const branchId = await resolveBranch(req);
        const { weekStartDate, weekEndDate, scheduleData, unallocatedVisits, metrics } = req.body;

        if (!weekStartDate || !weekEndDate || !scheduleData || !metrics) {
          return res.status(400).json({ message: 'Missing required fields' });
        }

        const savedSchedule = await storage.saveWeeklySchedule({
          branchId,
          weekStartDate,
          weekEndDate,
          scheduleData,
          unallocatedVisits: unallocatedVisits || [],
          metrics,
        });

        res.json(savedSchedule);
      } catch (error) {
        logger.error('Error saving weekly schedule', error);
        const message = safeErrorMessage(error, 'Failed to save weekly schedule');
        const statusCode =
          message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
        res.status(statusCode).json({ message, error: safeErrorMessage(error, 'Unknown error') });
      }
    }
  );
}
