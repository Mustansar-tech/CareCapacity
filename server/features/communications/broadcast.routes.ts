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

// ── Markdown-lite body parser ──────────────────────────────────────────────────
// Supports: # H1  ## H2  ### eyebrow  **bold**  _italic_  - bullets  --- rule
function parseBody(raw: string): string {
  if (!raw.trim()) return '';
  const F = `Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif`;
  const inline = (s: string) =>
    s.replace(/\*\*(.+?)\*\*/g, `<strong style="color:#0c1628;font-weight:700;">$1</strong>`)
     .replace(/_(.+?)_/g, `<em>$1</em>`);

  return raw.split(/\n{2,}/).map(block => {
    const t = block.trim();
    if (!t) return '';

    if (t === '---')
      return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
        <tr><td style="height:1px;background:#f1f5f9;"></td></tr></table>`;

    if (t.startsWith('### '))
      return `<p style="margin:20px 0 8px;font-family:${F};font-size:10px;font-weight:700;letter-spacing:0.10em;text-transform:uppercase;color:#059669;">${inline(t.slice(4))}</p>`;

    if (t.startsWith('## '))
      return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 10px;">
        <tr>
          <td width="3" style="background:#059669;border-radius:2px;">&nbsp;</td>
          <td style="padding-left:12px;font-family:${F};font-size:16px;font-weight:700;color:#0c1628;line-height:1.35;">${inline(t.slice(3))}</td>
        </tr></table>`;

    if (t.startsWith('# '))
      return `<h1 style="margin:28px 0 12px;font-family:${F};font-size:22px;font-weight:800;color:#0c1628;line-height:1.2;letter-spacing:-0.025em;">${inline(t.slice(2))}</h1>`;

    const lines = t.split('\n');
    if (lines.every(l => /^[-*]\s/.test(l.trim()))) {
      const items = lines.map(l =>
        `<tr>
          <td width="20" valign="top" style="padding-top:7px;">
            <div style="width:6px;height:6px;background:#059669;border-radius:50%;"></div>
          </td>
          <td style="font-family:${F};font-size:14px;color:#4b5563;line-height:1.75;padding-bottom:8px;border-bottom:1px solid #f8fafc;">${inline(l.trim().replace(/^[-*]\s/, ''))}</td>
        </tr>`
      ).join('');
      return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 18px;">${items}</table>`;
    }

    return `<p style="margin:0 0 18px;font-family:${F};font-size:15px;color:#4b5563;line-height:1.8;">${inline(lines.join('<br>'))}</p>`;
  }).join('');
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

  const F = `Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif`;
  const month = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toUpperCase();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${p.subject}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#f0f2f5;-webkit-font-smoothing:antialiased;">

<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preview}&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;</div>

<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f0f2f5">
<tr><td align="center" style="padding:40px 16px 56px;">

  <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06),0 20px 60px rgba(0,0,0,0.10);">

    <!-- ── Accent stripe ── -->
    <tr>
      <td style="background:linear-gradient(90deg,#059669,#10b981,#34d399);height:3px;line-height:3px;font-size:3px;">&nbsp;</td>
    </tr>

    <!-- ── Logo row ── -->
    <tr>
      <td style="background:#ffffff;padding:20px 36px 18px;border-bottom:1px solid #f4f6f8;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td valign="middle">
              <table cellpadding="0" cellspacing="0" border="0"><tr>
                <td valign="middle" style="line-height:0;">
                  <img src="${LOGO_URL}" width="30" height="31" alt="" style="display:block;border:0;border-radius:7px;" />
                </td>
                <td style="padding-left:11px;vertical-align:middle;">
                  <span style="font-family:${F};font-size:14px;font-weight:700;color:#0c1628;letter-spacing:-0.02em;display:block;line-height:1;">Care Capacity</span>
                  <span style="font-family:${F};font-size:10px;color:#94a3b8;display:block;margin-top:3px;font-weight:400;">Workforce Intelligence Platform</span>
                </td>
              </tr></table>
            </td>
            <td align="right" valign="middle">
              <span style="font-family:${F};font-size:10px;font-weight:600;color:#059669;background:#f0fdf4;padding:4px 10px;border-radius:20px;border:1px solid #bbf7d0;letter-spacing:0.05em;text-transform:uppercase;">Platform Update</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- ── Hero ── -->
    <tr>
      <td bgcolor="#0c1628" style="background:#0c1628;padding:52px 44px 48px;">
        <p style="margin:0 0 18px;font-family:${F};font-size:11px;font-weight:600;color:#34d399;letter-spacing:0.10em;text-transform:uppercase;">${month}</p>
        <h1 style="margin:0 0 18px;font-family:${F};font-size:34px;font-weight:800;color:#ffffff;line-height:1.1;letter-spacing:-0.04em;">${p.headline}</h1>
        <p style="margin:0;font-family:${F};font-size:14px;color:#64748b;line-height:1.65;">What's new, what's changed, and what's coming to Care Capacity.</p>
      </td>
    </tr>
    <!-- hero bottom border -->
    <tr><td style="background:linear-gradient(90deg,transparent,rgba(5,150,105,0.35),transparent);height:1px;line-height:1px;font-size:1px;">&nbsp;</td></tr>

    <!-- ── Body ── -->
    <tr>
      <td style="background:#ffffff;padding:44px 44px 32px;">
        <p style="margin:0 0 28px;font-family:${F};font-size:15px;color:#374151;line-height:1.6;">Hi ${recipientName},</p>
        ${parseBody(p.body)}
        ${bulletsHtml}
      </td>
    </tr>

    <!-- ── CTA ── -->
    <tr>
      <td style="background:#ffffff;padding:4px 44px 44px;text-align:center;">
        ${ctaHtml}
      </td>
    </tr>

    <!-- ── Footer ── -->
    <tr>
      <td bgcolor="#0c1628" style="background:#0c1628;padding:32px 44px;text-align:center;">
        <!-- Logo -->
        <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 16px;">
          <tr>
            <td style="background:#059669;width:24px;height:24px;border-radius:6px;text-align:center;line-height:24px;font-size:12px;vertical-align:middle;">⚡</td>
            <td style="padding-left:8px;vertical-align:middle;">
              <span style="font-family:${F};font-size:13px;font-weight:700;color:#ffffff;letter-spacing:0.05em;text-transform:uppercase;">CARE CAPACITY</span>
            </td>
          </tr>
        </table>
        <!-- Divider -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
          <tr><td style="height:1px;background:rgba(255,255,255,0.06);"></td></tr>
        </table>
        <p style="margin:0 0 6px;font-family:${F};font-size:11px;color:#475569;line-height:1.6;">
          Questions? Reply to this email — we read every one.
        </p>
        <p style="margin:0;font-family:${F};font-size:10px;color:#334155;line-height:1.5;">
          © ${year} Home Instead – Scottish Group &nbsp;·&nbsp; Workforce Intelligence Platform
        </p>
      </td>
    </tr>

  </table>
</td></tr>
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
