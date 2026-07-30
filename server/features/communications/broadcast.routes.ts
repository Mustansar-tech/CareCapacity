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

const FROM_ADDRESS  = 'Care Capacity <noreply@mail.sur-group.co.uk>';
const REPLY_TO      = 'mustansar.hussain@sg.homeinstead.co.uk';
const DASHBOARD_URL = 'https://carecapacity.sur-group.co.uk/login';
const LOGO_URL      = 'https://carecapacity.sur-group.co.uk/favicon.png';

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

  // Feature highlight cards (bullets)
  const bulletsHtml = p.bullets && p.bullets.length > 0
    ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;">
        <tr>
          <td style="background:#f0f4ff;border-radius:10px;padding:22px 24px;">
            <p style="margin:0 0 4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#1d4ed8;">Platform Updates</p>
            <p style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:17px;font-weight:700;color:#1e293b;line-height:1.3;">What's Changed</p>
            ${p.bullets.map(b => `
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:6px;">
              <tr>
                <td width="20" valign="top" style="padding-top:3px;">
                  <span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;">✅</span>
                </td>
                <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#374151;line-height:1.6;padding-left:8px;">${b}</td>
              </tr>
            </table>`).join('')}
          </td>
        </tr>
      </table>`
    : '';

  // CTA buttons — always includes "Go to Dashboard"; custom button is secondary
  const ctaHtml = `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 0;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" border="0">
          <tr>
            ${p.ctaText ? `
            <td style="padding-right:12px;">
              <a href="${p.ctaUrl || DASHBOARD_URL}"
                 style="display:inline-block;background:#1e293b;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:600;text-decoration:none;padding:13px 26px;border-radius:8px;letter-spacing:0.01em;">
                ${p.ctaText}
              </a>
            </td>` : ''}
            <td>
              <a href="${DASHBOARD_URL}"
                 style="display:inline-block;background:#ffffff;color:#1e293b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:600;text-decoration:none;padding:12px 26px;border-radius:8px;letter-spacing:0.01em;border:2px solid #1e293b;">
                Go to Dashboard
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;

  // Body paragraphs
  const bodyParagraphs = p.body
    .split(/\n{2,}/)
    .filter(s => s.trim())
    .map(para => `<p style="margin:0 0 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:16px;color:#374151;line-height:1.75;">${para.replace(/\n/g, '<br>')}</p>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${p.subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

<!-- Hidden preview text -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preview}&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;</div>

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;">
  <tr>
    <td align="center" style="padding:40px 16px 48px;">

      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

        <!-- ── Logo pre-header ── -->
        <tr>
          <td style="background:#ffffff;padding:24px 36px 20px;border-radius:12px 12px 0 0;border-bottom:1px solid #f1f5f9;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="middle">
                  <img src="${LOGO_URL}" width="38" height="39" alt="Care Capacity" style="display:block;border:0;border-radius:6px;" />
                </td>
                <td style="padding-left:12px;vertical-align:middle;">
                  <span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:16px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;">Care Capacity</span>
                  <span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:11px;color:#94a3b8;display:block;margin-top:1px;">Workforce Intelligence Platform</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ── Hero ── -->
        <tr>
          <td style="background:#1e3a5f;padding:44px 36px 40px;">
            <h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:32px;font-weight:800;color:#ffffff;line-height:1.15;letter-spacing:-0.03em;">
              ${p.headline}
            </h1>
            <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;color:#93c5fd;line-height:1.6;">
              What's new, what's changed, and what's coming.
            </p>
          </td>
        </tr>

        <!-- ── Body ── -->
        <tr>
          <td style="background:#ffffff;padding:36px 36px 40px;">

            <p style="margin:0 0 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;color:#64748b;">
              Hi ${recipientName},
            </p>

            ${bodyParagraphs}
            ${bulletsHtml}
            ${ctaHtml}

          </td>
        </tr>

        <!-- ── Footer ── -->
        <tr>
          <td style="background:#1e3a5f;padding:28px 36px;border-radius:0 0 12px 12px;text-align:center;">
            <p style="margin:0 0 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;font-weight:700;color:#ffffff;letter-spacing:0.06em;text-transform:uppercase;">
              CARE CAPACITY
            </p>
            <p style="margin:0 0 10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#93c5fd;line-height:1.6;">
              Questions? Reply to this email and we'll get back to you.
            </p>
            <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:11px;color:#475569;line-height:1.5;">
              © ${year} Home Instead – Scottish Group &nbsp;·&nbsp; Workforce Intelligence Platform
            </p>
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
          replyTo: REPLY_TO,
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
