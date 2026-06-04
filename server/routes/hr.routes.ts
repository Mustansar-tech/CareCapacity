import type { Express } from 'express';
import { requireAuth, requireRoleAtLeast, auditLog } from '../features/auth/auth';
import { resolveBranch } from '../utils/helpers';
import { asyncHandler, createAppError } from '../middleware/error-handler';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import * as hrRepo from '../repositories/hr.repository';
import * as capacityRepo from '../repositories/capacity.repository';

const manualEntrySchema = z.object({
  branchId: z.string().min(1),
  employeeKey: z.string().min(1),
  employeeName: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.string().min(1),
  notes: z.string().optional().nullable(),
});

const bulkManualEntrySchema = z.object({
  branchId: z.string().min(1),
  employeeKeys: z.array(z.object({
    employeeKey: z.string().min(1),
    employeeName: z.string().min(1),
  })).min(1),
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1),
  status: z.string().min(1),
  notes: z.string().optional().nullable(),
});

export function registerHrRoutes(app: Express): void {

  app.get('/api/hr/calendar', requireAuth, asyncHandler(async (req, res) => {
    const branchId = await resolveBranch(req);
    const year = parseInt(req.query.year as string, 10);
    const month = parseInt(req.query.month as string, 10);

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      throw createAppError('Valid year and month (1-12) are required', 400);
    }

    const records = await hrRepo.getCalendarMonth(branchId, year, month);
    res.json(records);
  }));

  app.get('/api/hr/employee/:employeeKey/summary', requireAuth, asyncHandler(async (req, res) => {
    const branchId = await resolveBranch(req);
    const { employeeKey } = req.params;
    const year = parseInt((req.query.year as string) || String(new Date().getFullYear()), 10);
    const month = parseInt((req.query.month as string) || String(new Date().getMonth() + 1), 10);
    const summary = await hrRepo.getEmployeeSummary(branchId, decodeURIComponent(employeeKey), year, month);
    res.json(summary);
  }));

  app.get('/api/hr/employee/:employeeKey', requireAuth, asyncHandler(async (req, res) => {
    const branchId = await resolveBranch(req);
    const { employeeKey } = req.params;
    const offset = Math.max(0, parseInt((req.query.offset as string) || '0', 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '50', 10)));
    const result = await hrRepo.getEmployeeHistory(branchId, decodeURIComponent(employeeKey), offset, limit);
    res.json(result);
  }));

  app.post('/api/hr/manual', requireAuth, requireRoleAtLeast('scheduler'), asyncHandler(async (req, res) => {
    const parsed = manualEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      throw createAppError(parsed.error.errors[0]?.message ?? 'Invalid input', 400);
    }
    const branchId = await resolveBranch(req);
    if (parsed.data.branchId !== branchId) {
      throw createAppError('Branch mismatch', 403);
    }
    const row = await hrRepo.createManualEntry({ ...parsed.data, source: 'manual' });
    await auditLog(
      req.session?.userId ?? null,
      req.session?.userEmail ?? null,
      branchId,
      'hr_manual_entry_created',
      `${parsed.data.employeeName} — ${parsed.data.date} — ${parsed.data.status}`,
    );
    res.status(201).json(row);
  }));

  app.put('/api/hr/manual/:id', requireAuth, requireRoleAtLeast('scheduler'), asyncHandler(async (req, res) => {
    const branchId = await resolveBranch(req);
    const { id } = req.params;
    const bodySchema = z.object({
      status: z.string().min(1).optional(),
      notes: z.string().optional().nullable(),
      employeeName: z.string().min(1).optional(),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw createAppError(parsed.error.errors[0]?.message ?? 'Invalid input', 400);
    }
    const updated = await hrRepo.updateManualEntry(id, branchId, parsed.data);
    if (!updated) throw createAppError('Entry not found or cannot be edited', 404);
    await auditLog(
      req.session?.userId ?? null,
      req.session?.userEmail ?? null,
      branchId,
      'hr_manual_entry_updated',
      `id=${id}`,
    );
    res.json(updated);
  }));

  app.delete('/api/hr/manual/:id', requireAuth, requireRoleAtLeast('scheduler'), asyncHandler(async (req, res) => {
    const branchId = await resolveBranch(req);
    const { id } = req.params;
    const deleted = await hrRepo.deleteManualEntry(id, branchId);
    if (!deleted) throw createAppError('Entry not found or cannot be deleted', 404);
    await auditLog(
      req.session?.userId ?? null,
      req.session?.userEmail ?? null,
      branchId,
      'hr_manual_entry_deleted',
      `id=${id}`,
    );
    res.json({ success: true });
  }));

  app.post('/api/hr/manual/bulk', requireAuth, requireRoleAtLeast('scheduler'), asyncHandler(async (req, res) => {
    const parsed = bulkManualEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      throw createAppError(parsed.error.errors[0]?.message ?? 'Invalid input', 400);
    }
    const branchId = await resolveBranch(req);
    if (parsed.data.branchId !== branchId) {
      throw createAppError('Branch mismatch', 403);
    }
    const records = parsed.data.employeeKeys.flatMap(emp =>
      parsed.data.dates.map(date => ({
        branchId,
        employeeKey: emp.employeeKey,
        employeeName: emp.employeeName,
        date,
        status: parsed.data.status,
        notes: parsed.data.notes ?? null,
        source: 'manual' as const,
      })),
    );
    const count = await hrRepo.createBulkManualEntries(records);
    await auditLog(
      req.session?.userId ?? null,
      req.session?.userEmail ?? null,
      branchId,
      'hr_bulk_manual_entries_created',
      `${records.length} entries — ${parsed.data.status}`,
    );
    res.status(201).json({ created: count });
  }));

  // Backfill workforce calendar from all saved capacity analyses
  app.post('/api/hr/backfill', requireAuth, requireRoleAtLeast('scheduler'), asyncHandler(async (req, res) => {
    const branchId = await resolveBranch(req);
    const analyses = await capacityRepo.getAllCapacityAnalyses(branchId);
    if (analyses.length === 0) {
      return res.json({ weeks: 0, rows: 0 });
    }
    let totalRows = 0;
    for (const analysis of analyses) {
      const before = totalRows;
      await hrRepo.syncHrCalendarFromResult(branchId, {
        dailySummary: analysis.dailySummary as Array<{ date: string }>,
        employeesByDate: analysis.employeesByDate as Record<string, Array<{
          employeeName: string; status: string; notes?: string | null; contractedDailyHours?: number | null;
        }>>,
        employeeSummaryByDate: analysis.employeeSummaryByDate as Record<string, Array<{ employeeName: string; transportMode?: string }>>,
      });
      // count rows added (approximate — just sum daily employee counts)
      const ebd = analysis.employeesByDate as Record<string, unknown[]>;
      totalRows += Object.values(ebd).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
    }
    await auditLog(
      req.session?.userId ?? null,
      req.session?.userEmail ?? null,
      branchId,
      'hr_backfill',
      `${analyses.length} weeks backfilled`,
    );
    res.json({ weeks: analyses.length, rows: totalRows });
  }));

  app.get('/api/hr/export', requireAuth, asyncHandler(async (req, res) => {
    const branchId = await resolveBranch(req);
    const year = parseInt(req.query.year as string, 10);
    const month = parseInt(req.query.month as string, 10);

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      throw createAppError('Valid year and month required', 400);
    }

    const records = await hrRepo.getCalendarMonth(branchId, year, month);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Care Capacity Dashboard';
    wb.created = new Date();

    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const days = Array.from({ length: lastDay }, (_, i) => {
      const d = i + 1;
      return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    });

    // Build key→name map (unique by employeeKey to avoid name-collision bugs)
    const employeeMap = new Map<string, string>(); // employeeKey → employeeName
    for (const r of records) employeeMap.set(r.employeeKey, r.employeeName);
    const sortedEmployees = Array.from(employeeMap.entries())
      .sort((a, b) => a[1].localeCompare(b[1]));

    const byKey = new Map<string, Map<string, { status: string; source: string; notes: string | null }>>();
    for (const r of records) {
      if (!byKey.has(r.employeeKey)) byKey.set(r.employeeKey, new Map());
      byKey.get(r.employeeKey)!.set(r.date, { status: r.status, source: r.source, notes: r.notes ?? null });
    }

    const calSheet = wb.addWorksheet('Calendar');
    calSheet.addRow(['Employee', ...days.map(d => {
      const dt = new Date(d + 'T00:00:00Z');
      return `${dt.getUTCDate()} ${dt.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}`;
    })]);
    calSheet.getRow(1).font = { bold: true };
    calSheet.getColumn(1).width = 30;
    for (let col = 2; col <= days.length + 1; col++) {
      calSheet.getColumn(col).width = 10;
    }

    for (const [empKey, empName] of sortedEmployees) {
      const dayMap = byKey.get(empKey);
      const row = [empName, ...days.map(d => dayMap?.get(d)?.status ?? '')];
      calSheet.addRow(row);
    }

    const rawSheet = wb.addWorksheet('Raw Records');
    rawSheet.addRow(['Employee', 'Employee Key', 'Date', 'Status', 'Source', 'Notes']);
    rawSheet.getRow(1).font = { bold: true };
    rawSheet.columns = [
      { width: 30 }, { width: 25 }, { width: 14 }, { width: 22 }, { width: 12 }, { width: 40 },
    ];
    // Filter strictly to this month's dates (exclude ±1 day boundary records)
    const { start: monthStart, end: monthEnd } = { start: days[0], end: days[days.length - 1] };
    const monthRecords = records.filter(r => r.date >= monthStart && r.date <= monthEnd);
    for (const r of monthRecords.sort((a, b) => a.employeeName.localeCompare(b.employeeName) || a.date.localeCompare(b.date))) {
      rawSheet.addRow([r.employeeName, r.employeeKey, r.date, r.status, r.source, r.notes ?? '']);
    }

    const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Workforce_${monthLabel.replace(' ', '_')}.xlsx"`);
    const buffer = await wb.xlsx.writeBuffer();
    res.send(buffer);
  }));
}
