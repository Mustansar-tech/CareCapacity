import type { Express } from 'express';
import { storage } from '../storage';
import { logger } from '../logger';
import { safeErrorMessage, resolveBranch } from '../utils/helpers';

export function registerDebugRoutes(app: Express): void {
  app.get('/api/debug/employee-comparison', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);

      const allLocations = await storage.getAllEmployeeLocations(branchId);
      const mapEmployees = new Set(allLocations.map(e => e.employeeName));

      const analysis = await storage.getLatestCapacityAnalysis(branchId);

      if (!analysis) {
        return res.json({
          mapCount: mapEmployees.size,
          pickerCount: 0,
          mapEmployees: Array.from(mapEmployees).sort(),
          pickerEmployees: [],
          missingEmployees: Array.from(mapEmployees).sort(),
          message: 'No capacity analysis found yet',
        });
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

          if (
            emp.timeWindows &&
            emp.timeWindows.trim() !== '' &&
            emp.status !== 'Ad-hoc' &&
            (employeeWeeklyHoursMap.get(emp.employeeName) || 0) > 0
          ) {
            const existing = employeeMap.get(emp.employeeName);
            if (!existing || emp.contractedDailyHours > (existing.contractedDailyHours || 0)) {
              employeeMap.set(emp.employeeName, emp);
            }
          }
        });

      const pickerEmployees = new Set(employeeMap.keys());
      const missingEmployees = Array.from(mapEmployees)
        .filter(name => !pickerEmployees.has(name))
        .sort();

      const missingAnalysis = missingEmployees.map(name => {
        const daysInData = Object.entries(analysis.employeesByDate || {})
          .filter(([_, employees]) =>
            (employees as any[]).some((e: any) => e.employeeName === name)
          )
          .map(([date, employees]) => {
            const emp = (employees as any[]).find((e: any) => e.employeeName === name);
            return {
              date,
              status: emp?.status || 'Unknown',
              timeWindows: emp?.timeWindows || '-',
              contractedDailyHours: emp?.contractedDailyHours || 0,
            };
          });

        const ghSum = daysInData.reduce((sum, day) => sum + (day.contractedDailyHours || 0), 0);
        const hasTimeWindows = daysInData.some(day => day.timeWindows && day.timeWindows.trim() !== '');
        const isAdHoc = adHocEmployees.has(name);

        const reasons = [];
        if (!hasTimeWindows) reasons.push('No time windows');
        if (isAdHoc) reasons.push('Ad-hoc status');
        if (ghSum <= 0) reasons.push('No guaranteed hours (GH = 0)');

        return {
          name,
          reasons: reasons.length > 0 ? reasons : ['Unknown reason'],
          guaranteedHours: ghSum,
          hasTimeWindows,
          isAdHoc,
          daysAppear: daysInData.length,
        };
      });

      res.json({
        mapCount: mapEmployees.size,
        pickerCount: pickerEmployees.size,
        missingCount: missingEmployees.length,
        mapEmployees: Array.from(mapEmployees).sort(),
        pickerEmployees: Array.from(pickerEmployees).sort(),
        missingEmployees: missingAnalysis,
      });
    } catch (error) {
      logger.error('Error comparing employees', error);
      const message = safeErrorMessage(error, 'Failed to compare employees');
      res.status(500).json({ error: message });
    }
  });
}
