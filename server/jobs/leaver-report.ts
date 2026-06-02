/**
 * Monthly Leaver Email Report
 *
 * Queries every branch for leavers whose lastWorkingDay falls in a given
 * calendar month, then sends a formatted HTML email via Resend.
 *
 * FROM:      noreply@mail.sur-group.co.uk
 * RECIPIENTS: LEAVER_REPORT_EMAILS env var (comma-separated)
 */

import { Resend } from 'resend';
import { db } from '../infrastructure/db';
import { leavers, branches, leaverReportRecipients } from '@shared/schema';
import { eq, and, gte, lt } from 'drizzle-orm';
import { logger } from '../infrastructure/logger';

const FROM_ADDRESS = 'noreply@mail.sur-group.co.uk';

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

  // For each branch, fetch leavers in the target month (any status)
  type BranchSection = { displayName: string; rows: typeof leavers.$inferSelect[] };
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

    if (rows.length > 0) {
      sections.push({ displayName: branch.displayName, rows });
    }
  }

  const totalLeavers = sections.reduce((s, sec) => s + sec.rows.length, 0);

  if (totalLeavers === 0) {
    logger.info('Leaver report: no leavers found for month', { monthLabel });
    return {
      month: monthLabel,
      branchesCovered: 0,
      totalLeavers: 0,
      recipients,
      skipped: true,
      reason: 'No leavers recorded for this month',
    };
  }

  // Build HTML
  const branchSections = sections.map(({ displayName, rows }) => {
    const totalHrs = rows.reduce((s, l) => s + (l.weeklyHours ?? 0), 0);
    const rows_html = rows.map(l => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-weight:500">${l.employeeName}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-family:monospace;font-size:13px">${l.employeeNo ?? '—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6">${capitalize(l.employmentType)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:right">${l.weeklyHours ?? '—'}h</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:right">${l.contractedHours != null ? `${l.contractedHours}h` : '—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6">${formatDate(l.lastWorkingDay)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px">${l.notes || '—'}</td>
      </tr>`).join('');

    return `
      <div style="margin-bottom:32px">
        <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:10px 16px;margin-bottom:0;border-radius:4px 4px 0 0">
          <span style="font-weight:600;color:#991b1b;font-size:14px;text-transform:uppercase;letter-spacing:0.05em">${displayName}</span>
          <span style="color:#b91c1c;font-size:13px;margin-left:12px">${totalHrs}h/wk · ${rows.length} ${rows.length === 1 ? 'leaver' : 'leavers'}</span>
        </div>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #fecaca;border-top:none;border-radius:0 0 4px 4px;overflow:hidden">
          <thead>
            <tr style="background:#fff5f5">
              <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #fecaca">Name</th>
              <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #fecaca">Emp No</th>
              <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #fecaca">Type</th>
              <th style="padding:8px 12px;text-align:right;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #fecaca">Desired Hrs/wk</th>
              <th style="padding:8px 12px;text-align:right;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #fecaca">Contracted Hrs</th>
              <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #fecaca">Termination Day</th>
              <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #fecaca">Notes</th>
            </tr>
          </thead>
          <tbody>${rows_html}</tbody>
        </table>
      </div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:800px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.1);overflow:hidden">
      <!-- Header -->
      <div style="background:#1e293b;padding:24px 32px">
        <div style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:6px">Home Instead · Care Capacity Dashboard</div>
        <h1 style="margin:0;font-size:22px;font-weight:700;color:#fff">${monthLabel} Leavers Report</h1>
        <div style="margin-top:8px;font-size:14px;color:#94a3b8">${totalLeavers} ${totalLeavers === 1 ? 'leaver' : 'leavers'} across ${sections.length} ${sections.length === 1 ? 'branch' : 'branches'}</div>
      </div>
      <!-- Body -->
      <div style="padding:32px">
        ${branchSections}
        <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;border-top:1px solid #f3f4f6;padding-top:16px">
          This report was generated automatically by the Care Capacity Dashboard on ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.
          It covers all branches and includes leavers whose last working day fell in ${monthLabel}.
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: recipients,
    subject: `${monthLabel} Leavers Report — Home Instead`,
    html,
  });

  if (error) {
    logger.error('Leaver report: Resend API error', undefined, { error });
    throw new Error(`Resend error: ${JSON.stringify(error)}`);
  }

  logger.info('Leaver report sent', { monthLabel, totalLeavers, branches: sections.length, recipients });

  return {
    month: monthLabel,
    branchesCovered: sections.length,
    totalLeavers,
    recipients,
    skipped: false,
  };
}
