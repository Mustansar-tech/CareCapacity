/**
 * Broadcast Email — admin-only endpoint to send a platform update
 * to all active users via Resend.
 *
 * POST /api/admin/broadcast-email
 * Body: { subject, headline, body, bullets?, ctaText?, ctaUrl?, previewText? }
 */

import type { Express, Request, Response } from 'express';
import { Resend } from 'resend';
import { requireAuth } from '../auth/auth';
import { requireRole } from '../auth/auth';
import { storage } from '../../storage';
import { logger } from '../../infrastructure/logger';

const FROM_ADDRESS = 'Care Capacity <noreply@mail.sur-group.co.uk>';

export interface BroadcastPayload {
  subject: string;
  headline: string;
  body: string;
  bullets?: string[];
  ctaText?: string;
  ctaUrl?: string;
  previewText?: string;
}

// ── HTML template ─────────────────────────────────────────────────────────────
function renderEmail(p: BroadcastPayload, recipientName: string): string {
  const preview = p.previewText || p.headline;
  const year = new Date().getFullYear();

  const bulletsHtml = p.bullets && p.bullets.length > 0
    ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px;">
        <tr><td>
          ${p.bullets.map(b => `
          <table width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="margin-bottom:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
            <tr>
              <td width="46" valign="middle" style="padding:12px 4px 12px 14px;">
                <div style="width:22px;height:22px;background:linear-gradient(135deg,#059669,#10b981);border-radius:6px;text-align:center;line-height:22px;">
                  <span style="color:#ffffff;font-size:12px;font-weight:700;">✓</span>
                </div>
              </td>
              <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:500;color:#1e293b;line-height:1.5;padding:12px 14px 12px 4px;">
                ${b}
              </td>
            </tr>
          </table>`).join('')}
        </td></tr>
      </table>`
    : '';

  const ctaHtml = p.ctaText
    ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 8px;">
        <tr>
          <td align="center">
            <a href="${p.ctaUrl || '#'}"
               style="display:inline-block;background:linear-gradient(135deg,#059669,#10b981);color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:700;text-decoration:none;padding:14px 34px;border-radius:9px;letter-spacing:0.01em;box-shadow:0 4px 14px rgba(5,150,105,0.3);">
              ${p.ctaText} &rarr;
            </a>
          </td>
        </tr>
      </table>`
    : '';

  // Convert newlines in body to paragraphs
  const bodyParagraphs = p.body
    .split(/\n{2,}/)
    .filter(s => s.trim())
    .map(para => `<p style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;color:#374151;line-height:1.75;">${para.replace(/\n/g, '<br>')}</p>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${p.subject}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#e8eaf0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

<!-- Preview text (hidden) -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preview}&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;</div>

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#e8eaf0;min-height:100vh;">
  <tr>
    <td align="center" style="padding:40px 16px;">

      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

        <!-- ── Top nav bar ── -->
        <tr>
          <td style="background:#1a1d23;border-radius:10px 10px 0 0;padding:14px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="middle">
                  <table cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="background:linear-gradient(135deg,#059669,#10b981);width:30px;height:30px;border-radius:7px;text-align:center;line-height:30px;font-size:15px;vertical-align:middle;">⚡</td>
                      <td style="padding-left:10px;vertical-align:middle;">
                        <span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;display:block;">Care Capacity</span>
                        <span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:10px;color:#6b7280;display:block;margin-top:1px;">Workforce Intelligence Platform</span>
                      </td>
                    </tr>
                  </table>
                </td>
                <td align="right" valign="middle">
                  <span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:10px;font-weight:600;color:#10b981;background:rgba(16,185,129,0.12);padding:3px 10px;border-radius:20px;border:1px solid rgba(16,185,129,0.25);letter-spacing:0.05em;text-transform:uppercase;">Platform Update</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ── Hero ── -->
        <tr>
          <td style="background:linear-gradient(145deg,#0f172a 0%,#1e293b 60%,#0d3b2e 100%);padding:36px 36px 32px;">
            <p style="margin:0 0 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#10b981;">
              New from Care Capacity
            </p>
            <h1 style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:26px;font-weight:800;color:#ffffff;line-height:1.2;letter-spacing:-0.03em;">
              ${p.headline}
            </h1>
            <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#94a3b8;line-height:1.5;">
              Hi ${recipientName} — here's what's new for you.
            </p>
          </td>
        </tr>

        <!-- ── Body ── -->
        <tr>
          <td style="background:#ffffff;padding:32px 36px 36px;">

            ${bodyParagraphs}
            ${bulletsHtml}
            ${ctaHtml}

          </td>
        </tr>

        <!-- ── Footer ── -->
        <tr>
          <td style="background:#f8fafc;padding:18px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td>
                  <p style="margin:0 0 3px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:11px;color:#9ca3af;line-height:1.5;">
                    You're receiving this as a Care Capacity platform member.
                  </p>
                  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:11px;color:#9ca3af;line-height:1.5;">
                    © ${year} Home Instead – Scottish Group &nbsp;·&nbsp; Workforce Intelligence Platform
                  </p>
                </td>
                <td align="right" valign="middle" style="padding-left:16px;">
                  <div style="width:26px;height:26px;background:linear-gradient(135deg,#059669,#10b981);border-radius:7px;text-align:center;line-height:26px;font-size:13px;">⚡</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// ── Route registration ─────────────────────────────────────────────────────────
export function registerBroadcastRoutes(app: Express) {
  // GET — preview recipients count
  app.get('/api/admin/broadcast-email/recipients', requireAuth, requireRole('admin'), async (_req: Request, res: Response) => {
    try {
      const allUsers = await storage.getAllUsers();
      const active = allUsers.filter(u => u.isActive);
      res.json({ count: active.length, emails: active.map(u => ({ email: u.email, name: u.displayName })) });
    } catch (err) {
      logger.error('Broadcast recipients error', err);
      res.status(500).json({ message: 'Failed to fetch recipients' });
    }
  });

  // POST — send the broadcast
  app.post('/api/admin/broadcast-email', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    const { subject, headline, body, bullets, ctaText, ctaUrl, previewText } = req.body as BroadcastPayload;

    if (!subject?.trim() || !headline?.trim() || !body?.trim()) {
      return res.status(400).json({ message: 'subject, headline and body are required' });
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ message: 'RESEND_API_KEY not configured' });
    }

    try {
      const allUsers = await storage.getAllUsers();
      const recipients = allUsers.filter(u => u.isActive);

      if (recipients.length === 0) {
        return res.status(400).json({ message: 'No active users to send to' });
      }

      const resend = new Resend(apiKey);
      const results: { email: string; ok: boolean; error?: string }[] = [];

      // Send individually so each gets a personalised greeting
      for (const user of recipients) {
        const html = renderEmail(
          { subject, headline, body, bullets, ctaText, ctaUrl, previewText },
          user.displayName || user.email.split('@')[0]
        );

        const { error } = await resend.emails.send({
          from: FROM_ADDRESS,
          to: user.email,
          subject,
          html,
        });

        results.push({ email: user.email, ok: !error, error: error?.message });
      }

      const sent = results.filter(r => r.ok).length;
      const failed = results.filter(r => !r.ok);

      logger.info('Broadcast email sent', {
        subject,
        sent,
        failed: failed.length,
        sentBy: req.session.userEmail,
      });

      res.json({
        sent,
        failed: failed.length,
        failedList: failed,
        total: recipients.length,
      });
    } catch (err) {
      logger.error('Broadcast email error', err);
      res.status(500).json({ message: 'Failed to send broadcast email' });
    }
  });
}
