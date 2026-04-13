import { Request, Response } from 'express';
import { resolveBranch } from '../utils/helpers';
import * as geoRepo from '../repositories/geo.repository';
import * as capacityRepo from '../repositories/capacity.repository';
import { logger } from '../infrastructure/logger';

export async function employeeComparison(req: Request, res: Response): Promise<void> {
  const branchId = await resolveBranch(req);

  const allLocations = await geoRepo.getAllEmployeeLocations(branchId);
  const mapEmployees = new Set(allLocations.map(e => e.employeeName));

  const analysis = await capacityRepo.getLatestCapacityAnalysis(branchId);

  if (!analysis) {
    res.json({
      mapCount: mapEmployees.size,
      pickerCount: 0,
      mapEmployees: Array.from(mapEmployees).sort(),
      pickerEmployees: [],
      missingEmployees: Array.from(mapEmployees).sort(),
      message: 'No capacity analysis found yet',
    });
    return;
  }

  const employeeMap = new Map();
  const employeeWeeklyHoursMap = new Map();
  const adHocEmployees = new Set();

  Object.values(analysis.employeesByDate || {}).forEach((dayEmployees: any) => {
    dayEmployees.forEach((emp: any) => {
      if (emp.contractedDailyHours > 0) {
        const current = employeeWeeklyHoursMap.get(emp.employeeName) || 0;
        employeeWeeklyHoursMap.set(emp.employeeName, current + emp.contractedDailyHours);
      }
    });
  });

  Object.values(analysis.employeesByDate || {})
    .flat()
    .forEach((emp: any) => {
      if (emp.status === 'Ad-hoc') adHocEmployees.add(emp.employeeName);
      if (emp.timeWindows?.trim() !== '' && emp.status !== 'Ad-hoc' && (employeeWeeklyHoursMap.get(emp.employeeName) || 0) > 0) {
        const existing = employeeMap.get(emp.employeeName);
        if (!existing || emp.contractedDailyHours > (existing.contractedDailyHours || 0)) {
          employeeMap.set(emp.employeeName, emp);
        }
      }
    });

  const pickerEmployees = new Set(employeeMap.keys());
  const missingEmployees = Array.from(mapEmployees).filter(name => !pickerEmployees.has(name)).sort();

  const missingAnalysis = missingEmployees.map(name => {
    const daysInData = Object.entries(analysis.employeesByDate || {})
      .filter(([_, employees]) => (employees as any[]).some((e: any) => e.employeeName === name))
      .map(([date, employees]) => {
        const emp = (employees as any[]).find((e: any) => e.employeeName === name);
        return { date, status: emp?.status || 'Unknown', timeWindows: emp?.timeWindows || '-', contractedDailyHours: emp?.contractedDailyHours || 0 };
      });
    const ghSum = daysInData.reduce((sum, day) => sum + (day.contractedDailyHours || 0), 0);
    const hasTimeWindows = daysInData.some(day => day.timeWindows?.trim() !== '');
    const isAdHoc = adHocEmployees.has(name);
    const reasons = [];
    if (!hasTimeWindows) reasons.push('No time windows');
    if (isAdHoc) reasons.push('Ad-hoc status');
    if (ghSum <= 0) reasons.push('No guaranteed hours (GH = 0)');
    return { name, reasons: reasons.length > 0 ? reasons : ['Unknown reason'], guaranteedHours: ghSum, hasTimeWindows, isAdHoc, daysAppear: daysInData.length };
  });

  res.json({
    mapCount: mapEmployees.size,
    pickerCount: pickerEmployees.size,
    missingCount: missingEmployees.length,
    mapEmployees: Array.from(mapEmployees).sort(),
    pickerEmployees: Array.from(pickerEmployees).sort(),
    missingEmployees: missingAnalysis,
  });
}
