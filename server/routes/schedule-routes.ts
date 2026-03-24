import type { Express } from "express";
import { storage } from "../storage";
import { logger } from "../logger";
import { requireAuth, requireRoleAtLeast } from "../auth";
import { getCanonicalWeekBoundaries, type ProcessingResult } from "@shared/schema";
import { safeErrorMessage, resolveBranch } from "../routes-utils";

function parseTimeWindowsForRouting(windows: string): Array<{ start: number; end: number }> {
  if (!windows) return [];
  const timeRanges = windows.split(',').map(w => w.trim()).filter(w => w);
  return timeRanges
    .map(range => {
      const match = range.match(/(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/);
      if (!match) return null;
      return {
        start: parseInt(match[1]) * 60 + parseInt(match[2]),
        end: parseInt(match[3]) * 60 + parseInt(match[4]),
      };
    })
    .filter((w): w is { start: number; end: number } => w !== null);
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
  mode: string,
): number {
  const R = 6371;
  const dLat = (to.lat - from.lat) * Math.PI / 180;
  const dLon = (to.lng - from.lng) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(from.lat * Math.PI / 180) * Math.cos(to.lat * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c * 1.2;

  if (mode === 'walking') return Math.max(2, Math.round((distance / 5) * 60));
  if (mode === 'public') return Math.max(15, Math.round((distance / 15) * 60 + 15));
  return Math.max(5, Math.round((distance / 35) * 60));
}

interface EmployeeScheduleSlot {
  employeeName: string;
  homeLat: number;
  homeLng: number;
  transportMode: string;
  timeWindows: Array<{ start: number; end: number }>;
  contractedDailyHours: number;
  visits: Array<{
    id: string;
    clientName: string;
    startTime: number;
    endTime: number;
    durationMinutes: number;
    priority: number;
    serviceType: string;
    lat?: number;
    lng?: number;
    employeeName?: string;
    actualStartTime?: number;
    actualEndTime?: number;
    travelTimeBefore?: number;
    travelTimeAfter?: number;
    score?: number;
  }>;
  totalTravelTime: number;
  totalWorkTime: number;
  utilizationPercent: number;
}

function calculateInsertionScore(
  visit: { lat: number; lng: number; startTime: number; endTime: number; priority: number },
  employee: EmployeeScheduleSlot,
  insertionIndex: number,
  settings: { maxTravelPerVisit: number },
): number {
  const travelBefore = calculateTravelTimeBefore(visit, employee, insertionIndex);
  const travelAfter = calculateTravelTimeAfter(visit, employee, insertionIndex);
  const totalTravel = travelBefore + travelAfter;

  if (totalTravel > settings.maxTravelPerVisit) return 0;

  let score = 1.0;
  score *= (1 - totalTravel / (settings.maxTravelPerVisit * 2)) * 0.4;

  const timeWindowFit = employee.timeWindows.some(
    window => visit.startTime >= window.start && visit.endTime <= window.end,
  ) ? 1 : 0;
  score += timeWindowFit * 0.3;

  const currentUtilization = employee.contractedDailyHours > 0
    ? (employee.totalWorkTime / 60) / employee.contractedDailyHours
    : 0;
  const utilizationScore = currentUtilization < 0.8
    ? 1
    : Math.max(0, 1 - (currentUtilization - 0.8) / 0.2);
  score += utilizationScore * 0.2;
  score += (4 - visit.priority) / 3 * 0.1;

  return Math.max(0, score);
}

function calculateTravelTimeBefore(
  visit: { lat?: number; lng?: number },
  employee: EmployeeScheduleSlot,
  insertionIndex: number,
): number {
  const visitCoords = { lat: visit.lat ?? 0, lng: visit.lng ?? 0 };
  if (insertionIndex === 0) {
    return calculateTravelMinutes(
      { lat: employee.homeLat, lng: employee.homeLng },
      visitCoords,
      employee.transportMode,
    );
  }
  const prevVisit = employee.visits[insertionIndex - 1];
  return calculateTravelMinutes(
    { lat: prevVisit.lat ?? 0, lng: prevVisit.lng ?? 0 },
    visitCoords,
    employee.transportMode,
  );
}

function calculateTravelTimeAfter(
  visit: { lat?: number; lng?: number },
  employee: EmployeeScheduleSlot,
  insertionIndex: number,
): number {
  const visitCoords = { lat: visit.lat ?? 0, lng: visit.lng ?? 0 };
  if (insertionIndex >= employee.visits.length) {
    return calculateTravelMinutes(
      visitCoords,
      { lat: employee.homeLat, lng: employee.homeLng },
      employee.transportMode,
    );
  }
  const nextVisit = employee.visits[insertionIndex];
  return calculateTravelMinutes(
    visitCoords,
    { lat: nextVisit.lat ?? 0, lng: nextVisit.lng ?? 0 },
    employee.transportMode,
  );
}

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

async function getAvailableEmployeesForDate(branchId: string, date: string): Promise<EmployeeScheduleSlot[]> {
  try {
    const results = await getProcessingResults(branchId);
    if (!results) return [];

    const employeesForDate = results.employeesByDate?.[date] || [];
    const employeeLocations = results.employeeLocations || [];

    return employeesForDate
      .filter((emp: { status: string }) => ['Available', 'Partial Availability'].includes(emp.status))
      .map((emp: { employeeName: string; timeWindows: string; contractedDailyHours: number }) => {
        const location = employeeLocations.find(
          (loc: { employeeName: string }) => loc.employeeName === emp.employeeName,
        );
        return {
          employeeName: emp.employeeName,
          homeLat: location?.homeLat ? Number(location.homeLat) : 55.9533,
          homeLng: location?.homeLng ? Number(location.homeLng) : -3.1883,
          transportMode: location?.transportMode?.toLowerCase().includes('car') ? 'car' : 'walking',
          timeWindows: parseTimeWindowsForRouting(emp.timeWindows),
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

    return visits.map((visit: { id?: string; clientId?: string; clientName?: string; preferredStartTime?: string; preferredEndTime?: string; durationMinutes?: number; priority?: number; serviceType?: string }) => {
      const clientName = visit.clientId || visit.clientName || 'Unknown Client';
      const client = clientLocations.find((c: { clientName: string }) => c.clientName === clientName);

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

async function optimizeRoutesForDay(
  date: string,
  employees: EmployeeScheduleSlot[],
  visits: Array<{ id: string; clientName: string; lat?: number; lng?: number; startTime: number; endTime: number; durationMinutes: number; priority: number; serviceType: string }>,
  settings: { maxTravelPerVisit: number },
) {
  logger.info('Optimizing routes', { date, employeeCount: employees.length, visitCount: visits.length });

  const employeeSchedules: EmployeeScheduleSlot[] = employees.map(emp => ({ ...emp, visits: [] }));
  const unassignedVisits = [...visits];

  unassignedVisits.sort((a, b) => a.priority - b.priority);

  for (const visit of visits) {
    if (!visit.lat || !visit.lng) continue;

    let bestEmployee: EmployeeScheduleSlot | null = null;
    let bestScore = -1;
    let bestInsertionIndex = 0;

    for (const employee of employeeSchedules) {
      const canFit = employee.timeWindows.some(
        window => visit.startTime >= window.start && visit.endTime <= window.end,
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
      bestEmployee.utilizationPercent = bestEmployee.contractedDailyHours > 0
        ? Math.round((bestEmployee.totalWorkTime / 60) / bestEmployee.contractedDailyHours * 100)
        : 0;

      const index = unassignedVisits.findIndex(v => v.id === visit.id);
      if (index > -1) unassignedVisits.splice(index, 1);
    }
  }

  const totalAssigned = employeeSchedules.reduce((sum, emp) => sum + emp.visits.length, 0);
  const totalTravelTime = employeeSchedules.reduce((sum, emp) => sum + emp.totalTravelTime, 0);
  const avgUtilization = employeeSchedules.length > 0
    ? Math.round(employeeSchedules.reduce((sum, emp) => sum + emp.utilizationPercent, 0) / employeeSchedules.length)
    : 0;
  const routeEfficiency = visits.length > 0 ? Math.round((totalAssigned / visits.length) * 100) : 0;

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
      const branchId = await resolveBranch(req);
      const { date } = req.body;
      if (!date) return res.status(400).json({ message: 'Date is required' });

      const [employees, visits] = await Promise.all([
        getAvailableEmployeesForDate(branchId, date),
        getUnassignedVisitsForDate(branchId, date),
      ]);

      const settings = { maxTravelPerVisit: 30 };
      const result = await optimizeRoutesForDay(date, employees, visits, settings);
      res.json(result);
    } catch (error) {
      logger.error('Auto schedule error', error);
      const message = safeErrorMessage(error, 'Auto scheduling failed');
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message });
    }
  });

  app.post('/api/schedule/auto-week', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const { startDate, endDate } = req.body;
      if (!startDate || !endDate) {
        return res.status(400).json({ message: 'startDate and endDate are required' });
      }

      const results = await getProcessingResults(branchId);
      if (!results) return res.status(404).json({ message: 'No processing results available' });

      const dates = Object.keys(results.employeesByDate || {})
        .filter(d => d >= startDate && d <= endDate)
        .sort();

      const settings = { maxTravelPerVisit: 30 };
      const weekResults = [];
      for (const date of dates) {
        const [employees, visits] = await Promise.all([
          getAvailableEmployeesForDate(branchId, date),
          getUnassignedVisitsForDate(branchId, date),
        ]);
        const dayResult = await optimizeRoutesForDay(date, employees, visits, settings);
        weekResults.push(dayResult);
      }

      const totalAssigned = weekResults.reduce((s, r) => s + r.metrics.totalAssignedVisits, 0);
      const totalUnassigned = weekResults.reduce((s, r) => s + r.metrics.totalUnassignedVisits, 0);
      const avgEfficiency = weekResults.length > 0
        ? Math.round(weekResults.reduce((s, r) => s + r.metrics.routeEfficiency, 0) / weekResults.length)
        : 0;

      res.json({
        days: weekResults,
        summary: {
          totalDays: weekResults.length,
          totalAssignedVisits: totalAssigned,
          totalUnassignedVisits: totalUnassigned,
          averageEfficiency: avgEfficiency,
        },
      });
    } catch (error) {
      logger.error('Auto week schedule error', error);
      const message = safeErrorMessage(error, 'Auto week scheduling failed');
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message });
    }
  });

  app.get('/api/schedule/week/:startDate', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const { startDate } = req.params;
      const { weekStart, weekEnd } = getCanonicalWeekBoundaries(startDate);
      const schedule = await storage.getWeeklyScheduleByWeek(branchId, weekStart, weekEnd);
      if (!schedule) {
        return res.status(404).json({ message: 'No schedule found for this week' });
      }
      res.json(schedule);
    } catch (error) {
      logger.error('Get schedule week error', error);
      const message = safeErrorMessage(error, 'Failed to get weekly schedule');
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message });
    }
  });

  app.post('/api/run-optimization/optimize', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const { date, settings = {} } = req.body;
      if (!date) return res.status(400).json({ message: 'Date is required' });

      const defaultSettings = { maxTravelPerVisit: 30, ...settings };
      const [employees, visits] = await Promise.all([
        getAvailableEmployeesForDate(branchId, date),
        getUnassignedVisitsForDate(branchId, date),
      ]);

      const result = await optimizeRoutesForDay(date, employees, visits, defaultSettings);
      res.json(result);
    } catch (error) {
      logger.error('Route optimization error', error);
      const message = safeErrorMessage(error, 'Route optimization failed');
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message });
    }
  });

  app.post('/api/auto-schedule', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const { startDate, endDate, settings = {} } = req.body;

      if (!startDate || !endDate) {
        return res.status(400).json({ message: 'startDate and endDate are required' });
      }

      const results = await getProcessingResults(branchId);
      if (!results) return res.status(404).json({ message: 'No processing results available' });

      const dates = Object.keys(results.employeesByDate || {})
        .filter(d => d >= startDate && d <= endDate)
        .sort();

      const defaultSettings = { maxTravelPerVisit: 30, ...settings };
      const allDayResults = [];
      for (const date of dates) {
        const [employees, visits] = await Promise.all([
          getAvailableEmployeesForDate(branchId, date),
          getUnassignedVisitsForDate(branchId, date),
        ]);
        const dayResult = await optimizeRoutesForDay(date, employees, visits, defaultSettings);
        allDayResults.push(dayResult);
      }

      const totalAssigned = allDayResults.reduce((s, r) => s + r.metrics.totalAssignedVisits, 0);
      const totalUnassigned = allDayResults.reduce((s, r) => s + r.metrics.totalUnassignedVisits, 0);
      const avgUtil = allDayResults.length > 0
        ? Math.round(allDayResults.reduce((s, r) => s + r.metrics.averageUtilization, 0) / allDayResults.length)
        : 0;

      res.json({
        schedule: allDayResults,
        summary: {
          totalDays: allDayResults.length,
          totalAssignedVisits: totalAssigned,
          totalUnassignedVisits: totalUnassigned,
          averageUtilization: avgUtil,
        },
      });
    } catch (error) {
      logger.error('Auto schedule error', error);
      const message = safeErrorMessage(error, 'Auto scheduling failed');
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message });
    }
  });

  app.post('/api/weekly-schedule/generate', requireAuth, requireRoleAtLeast('scheduler'), async (req, res) => {
    try {
      const { weekStartDate } = req.body;
      const branchId = await resolveBranch(req);

      if (!weekStartDate) {
        return res.status(400).json({ message: 'weekStartDate is required' });
      }

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
  });

  app.get('/api/locations', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const [employees, clients] = await Promise.all([
        storage.getAllEmployeeLocations(branchId),
        storage.getAllClientLocations(branchId),
      ]);

      const validEmployees = employees.filter(e => e.homeLat && e.homeLng);
      const validClients = clients.filter(c => c.lat && c.lng);

      res.json({
        employees: validEmployees,
        clients: validClients,
        fetchedAt: new Date().toISOString(),
        totalInUpload: employees.length,
        totalClientsInUpload: clients.length,
      });
    } catch (error) {
      logger.error('Error fetching locations', error);
      const message = safeErrorMessage(error, 'Failed to fetch location data');
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({
        error: message,
        details: safeErrorMessage(error, 'An error occurred'),
      });
    }
  });

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
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({
        message,
        error: safeErrorMessage(error, 'Unknown error'),
      });
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
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({
        message,
        error: safeErrorMessage(error, 'Unknown error'),
      });
    }
  });

  app.post('/api/weekly-schedule/save', requireAuth, requireRoleAtLeast('scheduler'), async (req, res) => {
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
      const statusCode = message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({
        message,
        error: safeErrorMessage(error, 'Unknown error'),
      });
    }
  });
}
