import { Request, Response } from 'express';
import { getCanonicalWeekBoundaries, type ProcessingResult } from '@shared/schema';
import { resolveBranch } from '../utils/helpers';
import * as capacityRepo from '../repositories/capacity.repository';
import * as scheduleRepo from '../repositories/schedule.repository';
import * as geoRepo from '../repositories/geo.repository';
import { logger } from '../infrastructure/logger';

function parseTimeWindowsForRouting(windows: string): Array<{ start: number; end: number }> {
  if (!windows) return [];
  return windows.split(',').map(w => w.trim()).filter(w => w).map(range => {
    const match = range.match(/(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/);
    if (!match) return null;
    return { start: parseInt(match[1]) * 60 + parseInt(match[2]), end: parseInt(match[3]) * 60 + parseInt(match[4]) };
  }).filter((w): w is { start: number; end: number } => w !== null);
}

function timeStringToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  let time = timeStr;
  if (timeStr.includes('T')) time = timeStr.split('T')[1].split(':').slice(0, 2).join(':');
  const [hours, minutes] = time.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function calcTravel(from: { lat: number; lng: number }, to: { lat: number; lng: number }, mode: string): number {
  const R = 6371;
  const dLat = (to.lat - from.lat) * Math.PI / 180;
  const dLon = (to.lng - from.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(from.lat * Math.PI / 180) * Math.cos(to.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.2;
  if (mode === 'walking') return Math.max(2, Math.round((distance / 5) * 60));
  if (mode === 'public') return Math.max(15, Math.round((distance / 15) * 60 + 15));
  return Math.max(5, Math.round((distance / 35) * 60));
}

function travelBefore(visit: any, employee: any, idx: number): number {
  const prev = idx === 0 ? { lat: employee.homeLat, lng: employee.homeLng } : employee.visits[idx - 1];
  return calcTravel(prev, { lat: visit.lat, lng: visit.lng }, employee.transportMode);
}

function travelAfter(visit: any, employee: any, idx: number): number {
  const next = idx >= employee.visits.length ? { lat: employee.homeLat, lng: employee.homeLng } : employee.visits[idx];
  return calcTravel({ lat: visit.lat, lng: visit.lng }, next, employee.transportMode);
}

function insertionScore(visit: any, employee: any, idx: number, settings: any): number {
  const total = travelBefore(visit, employee, idx) + travelAfter(visit, employee, idx);
  if (total > settings.maxTravelPerVisit) return 0;
  const utilization = employee.contractedDailyHours > 0 ? employee.totalWorkTime / 60 / employee.contractedDailyHours : 0;
  return (
    (1 - total / (settings.maxTravelPerVisit * 2)) * 0.4 +
    (employee.timeWindows.some((w: any) => visit.startTime >= w.start && visit.endTime <= w.end) ? 1 : 0) * 0.3 +
    (utilization < 0.8 ? 1 : Math.max(0, 1 - (utilization - 0.8) / 0.2)) * 0.2 +
    ((4 - visit.priority) / 3) * 0.1
  );
}

async function getProcessingResults(branchId: string): Promise<ProcessingResult | null> {
  try {
    const analyses = await capacityRepo.getAllCapacityAnalyses(branchId);
    if (analyses.length === 0) return null;
    return analyses[0] as ProcessingResult;
  } catch (error) {
    logger.error('Error getting processing results', error);
    return null;
  }
}

async function getAvailableEmployeesForDate(branchId: string, date: string) {
  const results = await getProcessingResults(branchId);
  if (!results) return [];
  const employeesForDate = (results as any).employeesByDate?.[date] || [];
  const employeeLocations = (results as any).employeeLocations || [];
  return employeesForDate
    .filter((emp: any) => ['Available', 'Partial Availability'].includes(emp.status))
    .map((emp: any) => {
      const location = employeeLocations.find((loc: any) => loc.employeeName === emp.employeeName);
      return {
        employeeName: emp.employeeName,
        homeLat: location?.homeLat ? Number(location.homeLat) : 55.9533,
        homeLng: location?.homeLng ? Number(location.homeLng) : -3.1883,
        transportMode: (location?.transportMode?.toLowerCase() || 'car').includes('car') ? 'car' : 'walking',
        timeWindows: parseTimeWindowsForRouting(emp.timeWindows),
        contractedDailyHours: emp.contractedDailyHours,
        visits: [],
        totalTravelTime: 0,
        totalWorkTime: 0,
        utilizationPercent: 0,
      };
    });
}

async function getUnassignedVisitsForDate(branchId: string, date: string) {
  const visits = await geoRepo.listVisitsBetween(branchId, date, date);
  const results = await getProcessingResults(branchId);
  const clientLocations = (results as any)?.clientLocations || [];
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
}

function optimizeRoutes(date: string, employees: any[], visits: any[], settings: any) {
  const schedules = employees.map(emp => ({ ...emp, visits: [] }));
  const unassigned = [...visits];
  unassigned.sort((a, b) => a.priority - b.priority);
  for (const visit of visits) {
    if (!visit.lat || !visit.lng) continue;
    let bestEmp = null, bestScore = -1, bestIdx = 0;
    for (const emp of schedules) {
      if (!emp.timeWindows.some((w: any) => visit.startTime >= w.start && visit.endTime <= w.end)) continue;
      for (let i = 0; i <= emp.visits.length; i++) {
        const score = insertionScore(visit, emp, i, settings);
        if (score > bestScore) { bestScore = score; bestEmp = emp; bestIdx = i; }
      }
    }
    if (bestEmp && bestScore > 0) {
      const tb = travelBefore(visit, bestEmp, bestIdx), ta = travelAfter(visit, bestEmp, bestIdx);
      bestEmp.visits.splice(bestIdx, 0, { ...visit, employeeName: bestEmp.employeeName, actualStartTime: visit.startTime, actualEndTime: visit.endTime, travelTimeBefore: tb, travelTimeAfter: ta, score: bestScore });
      bestEmp.totalTravelTime += tb + ta;
      bestEmp.totalWorkTime += visit.durationMinutes;
      bestEmp.utilizationPercent = bestEmp.contractedDailyHours > 0 ? Math.round((bestEmp.totalWorkTime / 60 / bestEmp.contractedDailyHours) * 100) : 0;
      const idx = unassigned.findIndex(v => v.id === visit.id);
      if (idx > -1) unassigned.splice(idx, 1);
    }
  }
  const totalAssigned = schedules.reduce((s, e) => s + e.visits.length, 0);
  const totalTravel = schedules.reduce((s, e) => s + e.totalTravelTime, 0);
  return {
    date, employees: schedules, unassignedVisits: unassigned,
    metrics: {
      totalAssignedVisits: totalAssigned,
      totalUnassignedVisits: unassigned.length,
      averageUtilization: schedules.length > 0 ? Math.round(schedules.reduce((s, e) => s + e.utilizationPercent, 0) / schedules.length) : 0,
      totalTravelTime: totalTravel,
      routeEfficiency: visits.length > 0 ? Math.round((totalAssigned / visits.length) * 100) : 0,
    },
  };
}

export async function autoScheduleDay(req: Request, res: Response): Promise<void> {
  const { date } = req.body;
  const branchId = await resolveBranch(req);
  if (!date) { res.status(400).json({ error: 'Date is required' }); return; }
  logger.info('Generating schedule for day', { date, branchId });
  const { autoScheduler } = await import('../jobs/auto-scheduler');
  const schedule = await autoScheduler.scheduleDay(date, branchId);
  res.json(schedule);
}

export async function autoScheduleWeek(req: Request, res: Response): Promise<void> {
  const { startDate } = req.body;
  const branchId = await resolveBranch(req);
  if (!startDate) { res.status(400).json({ error: 'Start date is required' }); return; }
  logger.info('Generating schedule for week', { startDate, branchId });
  const { autoScheduler } = await import('../jobs/auto-scheduler');
  const weekSchedule = await autoScheduler.scheduleWeek(startDate, branchId);
  res.json(weekSchedule);
}

export async function getWeekSchedule(req: Request, res: Response): Promise<void> {
  const { startDate } = req.params;
  const branchId = await resolveBranch(req);
  const { autoScheduler } = await import('../jobs/auto-scheduler');
  const weekSchedule = await autoScheduler.getWeekSchedule(startDate, branchId);
  res.json(weekSchedule);
}

export async function runOptimization(req: Request, res: Response): Promise<void> {
  const { date } = req.body;
  const branchId = await resolveBranch(req);
  if (!date) { res.status(400).json({ error: 'Date is required' }); return; }
  logger.info('Starting run optimization', { date, branchId });
  const { autoScheduler } = await import('../jobs/auto-scheduler');
  const result = await autoScheduler.scheduleDay(date, branchId);
  res.json(result);
}

export async function autoSchedule(req: Request, res: Response): Promise<void> {
  const branchId = await resolveBranch(req);
  const { date, settings } = req.body;
  if (!date) { res.status(400).json({ error: 'Date is required' }); return; }
  logger.info('Starting route optimization', { date, branchId });
  const employees = await getAvailableEmployeesForDate(branchId, date);
  const visits = await getUnassignedVisitsForDate(branchId, date);
  if (employees.length === 0 || visits.length === 0) {
    res.json({ date, employees: [], unassignedVisits: visits, metrics: { totalAssignedVisits: 0, totalUnassignedVisits: visits.length, averageUtilization: 0, totalTravelTime: 0, routeEfficiency: 0 } });
    return;
  }
  res.json(optimizeRoutes(date, employees, visits, settings));
}

export async function generateWeeklySchedule(req: Request, res: Response): Promise<void> {
  const { weekStartDate } = req.body;
  const branchId = await resolveBranch(req);
  if (!weekStartDate) { res.status(400).json({ message: 'weekStartDate is required' }); return; }
  const { weekStart, weekEnd } = getCanonicalWeekBoundaries(weekStartDate);
  const latestData = await capacityRepo.getLatestCapacityAnalysis(branchId);
  if (!latestData) {
    res.status(404).json({ message: `No processed data available for branch ${branchId}. Please process files first.` });
    return;
  }
  const savedSchedule = await scheduleRepo.saveWeeklySchedule({
    branchId, weekStartDate: weekStart, weekEndDate: weekEnd,
    scheduleData: { employees: [], weekDates: [] },
    unallocatedVisits: [],
    metrics: { totalVisitsAssigned: 0, totalVisitsUnallocated: 0, averageTravelTimePerVisit: 0, employeesUtilized: 0 },
  });
  res.json(savedSchedule);
}

export async function getLatestWeeklySchedule(req: Request, res: Response): Promise<void> {
  const branchId = await resolveBranch(req);
  const latestSchedule = await scheduleRepo.getLatestWeeklySchedule(branchId);
  if (!latestSchedule) { res.status(404).json({ message: 'No weekly schedules found' }); return; }
  res.json(latestSchedule);
}

export async function getWeeklyScheduleByDate(req: Request, res: Response): Promise<void> {
  const branchId = await resolveBranch(req);
  const { weekStartDate } = req.params;
  const { weekStart, weekEnd } = getCanonicalWeekBoundaries(weekStartDate);
  const schedule = await scheduleRepo.getWeeklyScheduleByWeek(branchId, weekStart, weekEnd);
  if (!schedule) { res.status(404).json({ message: 'Schedule not found for this week' }); return; }
  res.json(schedule);
}

export async function saveWeeklySchedule(req: Request, res: Response): Promise<void> {
  const branchId = await resolveBranch(req);
  const { weekStartDate, weekEndDate, scheduleData, unallocatedVisits, metrics } = req.body;
  if (!weekStartDate || !weekEndDate || !scheduleData || !metrics) {
    res.status(400).json({ message: 'Missing required fields' }); return;
  }
  const savedSchedule = await scheduleRepo.saveWeeklySchedule({
    branchId, weekStartDate, weekEndDate, scheduleData,
    unallocatedVisits: unallocatedVisits || [], metrics,
  });
  res.json(savedSchedule);
}
