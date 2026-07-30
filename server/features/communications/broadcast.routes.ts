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

export interface FeatureCard { emoji: string; title: string; desc: string; }

export interface BroadcastPayload {
  subject:        string;
  headline:       string;
  subheadline?:   string;
  releaseVersion?: string;
  body:           string;
  featureCards?:  FeatureCard[];
  bullets?:       string[];      // "Included in this release" checklist
  screenshotUrl?: string;
  comingNext?:    string[];      // roadmap items
  ctaText?:       string;
  ctaUrl?:        string;
  previewText?:   string;
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
  const F        = `Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif`;
  const preview  = p.previewText || p.headline;
  const year     = new Date().getFullYear();
  const release  = p.releaseVersion || new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toUpperCase();
  const updates  = (p.bullets?.filter(Boolean).length ?? 0) + (p.featureCards?.length ?? 0);

  // ── Feature cards HTML ──
  const featureCardsHtml = p.featureCards && p.featureCards.length > 0
    ? `<tr><td style="padding:0 0 0 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
               style="margin:0;background:#f8fafc;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">
          <tr>
            <td style="padding:10px 44px 8px;">
              <p style="margin:0;font-family:${F};font-size:10px;font-weight:700;color:#059669;letter-spacing:0.10em;text-transform:uppercase;">What's New</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 36px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  ${p.featureCards.slice(0,3).map((c,i,arr) => `
                  <td width="${Math.floor(100/arr.length)}%" valign="top"
                      style="padding:16px 12px;text-align:center;${i < arr.length-1 ? 'border-right:1px solid #e2e8f0;' : ''}">
                    <div style="font-size:30px;line-height:1;margin-bottom:10px;">${c.emoji || '⚡'}</div>
                    <p style="margin:0 0 6px;font-family:${F};font-size:13px;font-weight:700;color:#0c1628;">${c.title}</p>
                    <p style="margin:0;font-family:${F};font-size:12px;color:#64748b;line-height:1.5;">${c.desc}</p>
                  </td>`).join('')}
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td></tr>`
    : '';

  // ── Screenshot HTML ──
  const screenshotHtml = p.screenshotUrl
    ? `<tr><td style="background:#fff;padding:32px 44px;">
        <p style="margin:0 0 12px;font-family:${F};font-size:10px;font-weight:700;color:#059669;letter-spacing:0.10em;text-transform:uppercase;">Platform Preview</p>
        <img src="${p.screenshotUrl}" width="512" alt="Platform screenshot"
             style="display:block;width:100%;max-width:512px;border-radius:8px;border:1px solid #e2e8f0;" />
        <p style="margin:10px 0 0;font-family:${F};font-size:12px;color:#94a3b8;line-height:1.5;">
          Enhanced dashboard visibility, cleaner navigation and a more secure experience.
        </p>
      </td></tr>`
    : '';

  // ── Release notes (highlights) ──
  const bulletsHtml = p.bullets && p.bullets.filter(Boolean).length > 0
    ? `<tr><td style="background:#fff;padding:0 44px 32px;">
        <p style="margin:0 0 14px;font-family:${F};font-size:10px;font-weight:700;color:#059669;letter-spacing:0.10em;text-transform:uppercase;">Included in this Release</p>
        ${p.bullets.filter(Boolean).map((b,i,arr) => `
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
               style="${i < arr.length-1 ? 'border-bottom:1px solid #f1f5f9;' : ''}margin-bottom:0;">
          <tr>
            <td width="28" valign="middle" style="padding:9px 0;">
              <div style="width:20px;height:20px;background:#059669;border-radius:5px;text-align:center;line-height:20px;font-size:11px;color:#fff;font-weight:700;">✓</div>
            </td>
            <td style="font-family:${F};font-size:14px;color:#374151;font-weight:500;padding:9px 0 9px 8px;line-height:1.4;">${b}</td>
          </tr>
        </table>`).join('')}
      </td></tr>`
    : '';

  // ── Coming Next (roadmap) ──
  const comingNextHtml = p.comingNext && p.comingNext.filter(Boolean).length > 0
    ? `<tr><td style="background:#f8fafc;padding:28px 44px;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">
        <p style="margin:0 0 14px;font-family:${F};font-size:10px;font-weight:700;color:#64748b;letter-spacing:0.10em;text-transform:uppercase;">Coming Next</p>
        ${p.comingNext.filter(Boolean).map(item => `
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;">
          <tr>
            <td width="20" valign="top" style="padding-top:3px;font-family:${F};font-size:14px;color:#94a3b8;">→</td>
            <td style="font-family:${F};font-size:13px;color:#64748b;padding-left:6px;line-height:1.5;">${item}</td>
          </tr>
        </table>`).join('')}
      </td></tr>`
    : '';

  // ── CTA ──
  const ctaLabel = p.ctaText || 'Launch Care Capacity →';
  const ctaTarget = p.ctaUrl || DASHBOARD_URL;
  const ctaHtml = `<tr><td style="background:#fff;padding:36px 44px 40px;text-align:center;">
    <a href="${ctaTarget}"
       style="display:inline-block;background:linear-gradient(90deg,#059669,#10b981);color:#ffffff;font-family:${F};font-size:16px;font-weight:700;text-decoration:none;padding:18px 44px;border-radius:14px;letter-spacing:0.01em;box-shadow:0 12px 30px rgba(16,185,129,0.30);">
      ${ctaLabel}
    </a>
  </td></tr>`;

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
      <td bgcolor="#0c1628" style="background:#0c1628;padding:52px 44px 44px;">

        <!-- Release badge -->
        <p style="margin:0 0 20px;display:inline-block;font-family:${F};font-size:10px;font-weight:700;color:#34d399;letter-spacing:0.15em;text-transform:uppercase;background:rgba(52,211,153,0.08);border:1px solid rgba(52,211,153,0.25);padding:5px 12px;border-radius:20px;">
          RELEASE ${release}
        </p>

        <!-- Headline -->
        <h1 style="margin:0 0 16px;font-family:${F};font-size:46px;font-weight:900;color:#ffffff;line-height:1.05;letter-spacing:-0.04em;">${p.headline}</h1>

        <!-- Subheadline -->
        <p style="margin:0 0 36px;font-family:${F};font-size:18px;color:#94a3b8;line-height:1.55;max-width:480px;">
          ${p.subheadline || 'Faster access, stronger security and a better platform experience.'}
        </p>

        <!-- Metrics strip -->
        <table cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px 20px;text-align:center;">
              <p style="margin:0;font-family:${F};font-size:22px;font-weight:800;color:#34d399;line-height:1;">Live</p>
              <p style="margin:4px 0 0;font-family:${F};font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">Status</p>
            </td>
            <td style="width:12px;"></td>
            <td style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px 20px;text-align:center;">
              <p style="margin:0;font-family:${F};font-size:20px;font-weight:800;color:#fff;line-height:1;">${release}</p>
              <p style="margin:4px 0 0;font-family:${F};font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">Release</p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
    <!-- hero glow line -->
    <tr><td style="background:linear-gradient(90deg,transparent,rgba(5,150,105,0.4),transparent);height:1px;line-height:1px;font-size:1px;">&nbsp;</td></tr>

    <!-- ── Body / What's New ── -->
    <tr>
      <td style="background:#ffffff;padding:40px 44px 28px;">
        <p style="margin:0 0 8px;font-family:${F};font-size:10px;font-weight:700;color:#059669;letter-spacing:0.10em;text-transform:uppercase;">What's New</p>
        <p style="margin:0 0 28px;font-family:${F};font-size:15px;color:#374151;line-height:1.6;">Hi ${recipientName},</p>
        ${parseBody(p.body)}
      </td>
    </tr>

    <!-- ── Feature cards ── -->
    ${featureCardsHtml}

    <!-- ── Screenshot ── -->
    ${screenshotHtml}

    <!-- ── Release notes ── -->
    ${bulletsHtml}

    <!-- ── Coming Next ── -->
    ${comingNextHtml}

    <!-- ── Footer ── -->
    <tr>
      <td bgcolor="#0c1628" style="background:#0c1628;padding:36px 44px;text-align:center;">
        <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 14px;">
          <tr>
            <td style="background:#059669;width:26px;height:26px;border-radius:7px;text-align:center;line-height:26px;font-size:13px;vertical-align:middle;">⚡</td>
            <td style="padding-left:9px;vertical-align:middle;">
              <span style="font-family:${F};font-size:14px;font-weight:800;color:#ffffff;letter-spacing:0.06em;text-transform:uppercase;">CARE CAPACITY</span>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 16px;font-family:${F};font-size:12px;color:#64748b;line-height:1.5;">Workforce Intelligence Platform</p>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">
          <tr><td style="height:1px;background:rgba(255,255,255,0.06);"></td></tr>
        </table>
        <!-- Buttons row -->
        <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 16px;">
          <tr>
            <td style="padding-right:10px;">
              <a href="${ctaTarget}"
                 style="display:inline-block;font-family:${F};font-size:13px;font-weight:600;color:#34d399;text-decoration:none;border:1px solid rgba(52,211,153,0.35);border-radius:8px;padding:9px 20px;letter-spacing:0.01em;">
                ${ctaLabel}
              </a>
            </td>
            <td>
              <a href="mailto:${REPLY_TO}"
                 style="display:inline-block;font-family:${F};font-size:13px;font-weight:600;color:#34d399;text-decoration:none;border:1px solid rgba(52,211,153,0.35);border-radius:8px;padding:9px 20px;letter-spacing:0.01em;">
                Contact Us
              </a>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 4px;font-family:${F};font-size:11px;color:#334155;line-height:1.5;">
          Built by the Digital &amp; Technology Team
        </p>
        <p style="margin:6px 0 0;font-family:${F};font-size:10px;color:#1e293b;line-height:1.5;">
          © ${year} Home Instead – Scottish Group
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
    const { subject, headline, subheadline, releaseVersion, body, featureCards, bullets, screenshotUrl, comingNext, ctaText, ctaUrl, previewText } = req.body as BroadcastPayload;

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
