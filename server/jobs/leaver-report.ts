/**
 * Monthly Leaver Email Report
 *
 * Queries every branch for leavers whose lastWorkingDay falls in a given
 * calendar month, then sends a formatted HTML email + Excel attachment via Resend.
 *
 * FROM:       noreply@mail.sur-group.co.uk
 * RECIPIENTS: leaver_report_recipients table → LEAVER_REPORT_EMAILS env var → []
 */

import { Resend } from 'resend';
import ExcelJS from 'exceljs';
import { db } from '../infrastructure/db';
import { leavers, branches, leaverReportRecipients } from '@shared/schema';
import { eq, and, gte, lt } from 'drizzle-orm';
import { logger } from '../infrastructure/logger';

const FROM_ADDRESS = 'Care Capacity <noreply@mail.sur-group.co.uk>';

async function getRecipients(): Promise<string[]> {
  try {
    const rows = await db.select().from(leaverReportRecipients).orderBy(leaverReportRecipients.addedAt);
    if (rows.length > 0) return rows.map(r => r.email);
  } catch {
    // table may not exist yet on first deploy — fall through to env var
  }
  const raw = process.env.LEAVER_REPORT_EMAILS ?? '';
  return raw.split(',').map(e => e.trim()).filter(Boolean);
}

function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

function capitalize(s: string | null | undefined): string {
  if (!s) return '—';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface LeaverReportResult {
  month: string;
  branchesCovered: number;
  totalLeavers: number;
  recipients: string[];
  skipped: boolean;
  reason?: string;
}

// ── Excel generation ──────────────────────────────────────────────────────────

type BranchSection = { displayName: string; rows: typeof leavers.$inferSelect[] };

async function buildExcel(sections: BranchSection[], monthLabel: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Care Capacity Dashboard';
  wb.created = new Date();

  const HEADER_FILL: ExcelJS.Fill = {
    type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' },
  };
  const BRANCH_FILL: ExcelJS.Fill = {
    type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' },
  };
  const ALT_FILL: ExcelJS.Fill = {
    type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' },
  };
  const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  const BRANCH_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FF991B1B' }, size: 11 };
  const BORDER: Partial<ExcelJS.Borders> = {
    bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
  };

  // Summary sheet
  const summary = wb.addWorksheet('Summary');
  summary.columns = [
    { header: 'Branch', key: 'branch', width: 30 },
    { header: 'Leavers', key: 'leavers', width: 10 },
    { header: 'Total Hrs/Wk Lost', key: 'hours', width: 20 },
  ];

  const summaryHeader = summary.getRow(1);
  summaryHeader.font = HEADER_FONT;
  summaryHeader.fill = HEADER_FILL;
  summaryHeader.alignment = { vertical: 'middle', horizontal: 'left' };
  summaryHeader.height = 22;
  summary.views = [{ state: 'frozen', ySplit: 1 }];

  let totalHrsAll = 0;
  for (const sec of sections) {
    const hrs = sec.rows.reduce((s, l) => s + (l.isLic ? 0 : (l.weeklyHours ?? 0)), 0);
    totalHrsAll += hrs;
    const row = summary.addRow({ branch: sec.displayName, leavers: sec.rows.length, hours: hrs });
    row.border = BORDER;
    row.alignment = { vertical: 'middle' };
  }

  // Totals row
  const totRow = summary.addRow({ branch: 'TOTAL', leavers: sections.reduce((s, sec) => s + sec.rows.length, 0), hours: totalHrsAll });
  totRow.font = { bold: true };
  totRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };

  // Detail sheet — all leavers flat with branch column
  const detail = wb.addWorksheet(monthLabel.replace(/\s+/g, '_'));
  detail.columns = [
    { header: 'Branch',           key: 'branch',      width: 28 },
    { header: 'Name',             key: 'name',        width: 28 },
    { header: 'Employee No',      key: 'empNo',       width: 14 },
    { header: 'Type',             key: 'type',        width: 14 },
    { header: 'Desired Hrs/Wk',  key: 'wkHrs',       width: 16 },
    { header: 'Contracted Hrs',   key: 'ctHrs',       width: 16 },
    { header: 'Termination Day',  key: 'lastDay',     width: 18 },
    { header: 'Notes',            key: 'notes',       width: 40 },
  ];

  const detailHeader = detail.getRow(1);
  detailHeader.font = HEADER_FONT;
  detailHeader.fill = HEADER_FILL;
  detailHeader.alignment = { vertical: 'middle', horizontal: 'left' };
  detailHeader.height = 22;
  detail.views = [{ state: 'frozen', ySplit: 1 }];

  let rowIdx = 0;
  for (const sec of sections) {
    // Branch heading row
    const branchRow = detail.addRow({ branch: sec.displayName.toUpperCase(), name: '', empNo: '', type: '', wkHrs: '', ctHrs: '', lastDay: '', notes: '' });
    branchRow.font = BRANCH_FONT;
    branchRow.fill = BRANCH_FILL;
    branchRow.height = 20;

    for (const l of sec.rows) {
      const dataRow = detail.addRow({
        branch:  '',
        name:    l.employeeName,
        empNo:   l.employeeNo ?? '',
        type:    capitalize(l.employmentType),
        wkHrs:   l.isLic ? 'LIC' : (l.weeklyHours ?? ''),
        ctHrs:   l.contractedHours ?? '',
        lastDay: formatDate(l.lastWorkingDay),
        notes:   l.notes ?? '',
      });
      dataRow.border = BORDER;
      dataRow.alignment = { vertical: 'middle', wrapText: false };
      if (rowIdx % 2 === 0) dataRow.fill = ALT_FILL;
      rowIdx++;
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ── HTML email ────────────────────────────────────────────────────────────────

function buildHtml(sections: BranchSection[], monthLabel: string, totalLeavers: number): string {
  const totalHrs = sections.reduce((s, sec) => s + sec.rows.reduce((a, l) => a + (l.isLic ? 0 : (l.weeklyHours ?? 0)), 0), 0);

  const branchCards = sections.map(({ displayName, rows }) => {
    const sectionHrs = rows.reduce((s, l) => s + (l.isLic ? 0 : (l.weeklyHours ?? 0)), 0);
    const tableRows = rows.map((l, i) => `
      <tr style="background:${i % 2 === 0 ? '#fff' : '#f9fafb'}">
        <td style="padding:9px 14px;border-bottom:1px solid #f3f4f6;font-weight:500;color:#111827">${l.employeeName}</td>
        <td style="padding:9px 14px;border-bottom:1px solid #f3f4f6;font-family:monospace;font-size:12px;color:#374151">${l.employeeNo ?? '—'}</td>
        <td style="padding:9px 14px;border-bottom:1px solid #f3f4f6;color:#374151">${capitalize(l.employmentType)}</td>
        <td style="padding:9px 14px;border-bottom:1px solid #f3f4f6;text-align:right;color:#374151;font-weight:500">${l.isLic ? 'LIC' : l.weeklyHours != null ? `${l.weeklyHours}h` : '—'}</td>
        <td style="padding:9px 14px;border-bottom:1px solid #f3f4f6;text-align:right;color:#374151">${l.contractedHours != null ? `${l.contractedHours}h` : '—'}</td>
        <td style="padding:9px 14px;border-bottom:1px solid #f3f4f6;color:#dc2626;font-weight:500">${formatDate(l.lastWorkingDay)}</td>
        <td style="padding:9px 14px;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:12px">${l.notes || '—'}</td>
      </tr>`).join('');

    return `
    <div style="margin-bottom:28px;border-radius:8px;overflow:hidden;border:1px solid #fee2e2">
      <div style="background:#fef2f2;padding:12px 16px;display:flex;align-items:center;justify-content:space-between">
        <span style="font-weight:700;color:#991b1b;font-size:13px;text-transform:uppercase;letter-spacing:0.06em">${displayName}</span>
        <div style="display:flex;gap:16px">
          <span style="font-size:12px;color:#b91c1c;background:#fee2e2;padding:2px 10px;border-radius:99px;font-weight:600">${rows.length} ${rows.length === 1 ? 'leaver' : 'leavers'}</span>
          <span style="font-size:12px;color:#b91c1c;background:#fee2e2;padding:2px 10px;border-radius:99px;font-weight:600">${sectionHrs}h/wk</span>
        </div>
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        <thead>
          <tr style="background:#fff5f5">
            <th style="padding:8px 14px;text-align:left;font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #fecaca">Name</th>
            <th style="padding:8px 14px;text-align:left;font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #fecaca">Emp No</th>
            <th style="padding:8px 14px;text-align:left;font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #fecaca">Type</th>
            <th style="padding:8px 14px;text-align:right;font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #fecaca">Desired Hrs</th>
            <th style="padding:8px 14px;text-align:right;font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #fecaca">Contracted</th>
            <th style="padding:8px 14px;text-align:left;font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #fecaca">Last Day</th>
            <th style="padding:8px 14px;text-align:left;font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #fecaca">Notes</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`;
  }).join('');

  const statBox = (value: string, label: string, colour: string) => `
    <div style="flex:1;min-width:120px;background:${colour};border-radius:8px;padding:16px 20px;text-align:center">
      <div style="font-size:26px;font-weight:800;color:#111827;line-height:1">${value}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:4px;text-transform:uppercase;letter-spacing:0.06em">${label}</div>
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${monthLabel} Leavers Report — Home Instead</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,sans-serif">
<div style="max-width:820px;margin:32px auto;padding:0 16px 48px">

  <!-- Header -->
  <div style="background:#1e293b;border-radius:12px 12px 0 0;padding:28px 36px">
    <div style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#64748b;margin-bottom:8px">Home Instead · Care Capacity Dashboard</div>
    <h1 style="margin:0 0 6px;font-size:26px;font-weight:800;color:#fff;letter-spacing:-0.02em">${monthLabel} Leavers Report</h1>
    <p style="margin:0;font-size:14px;color:#94a3b8">Sent ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
  </div>

  <!-- Stats bar -->
  <div style="background:#fff;padding:20px 28px;display:flex;gap:12px;flex-wrap:wrap;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb">
    ${statBox(String(totalLeavers), 'Total Leavers', '#fef2f2')}
    ${statBox(`${totalHrs}h`, 'Hrs / Wk Lost', '#fef9f0')}
    ${statBox(String(sections.length), sections.length === 1 ? 'Branch Affected' : 'Branches Affected', '#f0fdf4')}
  </div>

  <!-- Body -->
  <div style="background:#fff;border-radius:0 0 12px 12px;padding:28px 28px 36px;border:1px solid #e5e7eb;border-top:none">
    <p style="margin:0 0 24px;font-size:13px;color:#6b7280">
      The Excel attachment contains a full breakdown with a summary tab and per-leaver detail.
    </p>

    ${branchCards}

    <div style="margin-top:32px;padding-top:20px;border-top:1px solid #f3f4f6">
      <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6">
        This report was generated automatically by the Care Capacity Dashboard on
        ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.
        It covers all branches and includes leavers whose last working day fell in ${monthLabel}.
        A full Excel export is attached.
      </p>
    </div>
  </div>

</div>
</body>
</html>`;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Build and send the leaver report for the given year/month (0-indexed month).
 * Defaults to the previous calendar month.
 */
export async function sendLeaverReport(
  targetYear?: number,
  targetMonth?: number,
): Promise<LeaverReportResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn('Leaver report: RESEND_API_KEY not set — skipping');
    return { month: '', branchesCovered: 0, totalLeavers: 0, recipients: [], skipped: true, reason: 'RESEND_API_KEY not configured' };
  }

  const resend = new Resend(apiKey);
  const recipients = await getRecipients();
  if (!recipients.length) {
    logger.warn('Leaver report: no recipients configured — skipping');
    return { month: '', branchesCovered: 0, totalLeavers: 0, recipients: [], skipped: true, reason: 'No recipients configured' };
  }

  // Determine the target month
  const now = new Date();
  const year  = targetYear  ?? (targetMonth !== undefined ? now.getUTCFullYear() : now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear());
  const month = targetMonth ?? (now.getUTCMonth() === 0 ? 11 : now.getUTCMonth() - 1);

  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const nextMonth  = month === 11
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 2).padStart(2, '0')}-01`;

  const monthLabel = new Date(monthStart + 'T00:00:00Z').toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });

  // Query all branches
  const allBranches = await db.select().from(branches);

  const sections: BranchSection[] = [];
  for (const branch of allBranches) {
    const rows = await db
      .select()
      .from(leavers)
      .where(
        and(
          eq(leavers.branchId, branch.id),
          gte(leavers.lastWorkingDay, monthStart),
          lt(leavers.lastWorkingDay, nextMonth),
        ),
      )
      .orderBy(leavers.lastWorkingDay);

    if (rows.length > 0) sections.push({ displayName: branch.displayName, rows });
  }

  const totalLeavers = sections.reduce((s, sec) => s + sec.rows.length, 0);

  if (totalLeavers === 0) {
    logger.info('Leaver report: no leavers found for month', { monthLabel });
    return { month: monthLabel, branchesCovered: 0, totalLeavers: 0, recipients, skipped: true, reason: 'No leavers recorded for this month' };
  }

  // Build HTML + Excel
  const [html, excelBuffer] = await Promise.all([
    Promise.resolve(buildHtml(sections, monthLabel, totalLeavers)),
    buildExcel(sections, monthLabel),
  ]);

  const filename = `${monthLabel.replace(/\s+/g, '_')}_Leavers_Report.xlsx`;

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: recipients,
    subject: `${monthLabel} Leavers Report — Home Instead`,
    html,
    attachments: [
      {
        filename,
        content: excelBuffer,
      },
    ],
  });

  if (error) {
    logger.error('Leaver report: Resend API error', undefined, { error });
    throw new Error(`Resend error: ${JSON.stringify(error)}`);
  }

  logger.info('Leaver report sent', { monthLabel, totalLeavers, branches: sections.length, recipients });

  return { month: monthLabel, branchesCovered: sections.length, totalLeavers, recipients, skipped: false };
}
