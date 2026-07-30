import type { Express, Request, Response } from 'express';
import { storage } from '../../storage';
import { logger } from '../../infrastructure/logger';
import { auditLog } from './auth';
import crypto from 'crypto';

const TENANT_ID  = () => process.env.AZURE_TENANT_ID!;
const CLIENT_ID  = () => process.env.AZURE_CLIENT_ID!;
const CLIENT_SEC = () => process.env.AZURE_CLIENT_SECRET!;

function callbackUrl(req: Request): string {
  const base = process.env.FRONTEND_URL || 'https://carecapacity.sur-group.co.uk';
  return `${base}/api/auth/microsoft/callback`;
}

export function registerMicrosoftAuthRoutes(app: Express) {
  if (!process.env.AZURE_CLIENT_ID || !process.env.AZURE_TENANT_ID || !process.env.AZURE_CLIENT_SECRET) {
    logger.warn('Microsoft OAuth not configured — AZURE_CLIENT_ID / AZURE_TENANT_ID / AZURE_CLIENT_SECRET missing');
    return;
  }

  // ── Step 1: redirect to Microsoft login ────────────────────────────────────
  app.get('/api/auth/microsoft', (req: Request, res: Response) => {
    const state = crypto.randomBytes(20).toString('hex');
    req.session.msOAuthState = state;

    const params = new URLSearchParams({
      client_id:     CLIENT_ID(),
      response_type: 'code',
      redirect_uri:  callbackUrl(req),
      scope:         'openid profile email',
      state,
      response_mode: 'query',
    });

    req.session.save(() => {
      res.redirect(
        `https://login.microsoftonline.com/${TENANT_ID()}/oauth2/v2.0/authorize?${params.toString()}`
      );
    });
  });

  // ── Step 2: handle Microsoft callback ─────────────────────────────────────
  app.get('/api/auth/microsoft/callback', async (req: Request, res: Response) => {
    const { code, state, error } = req.query as Record<string, string>;

    if (error) {
      logger.warn('Microsoft OAuth error', { error });
      return res.redirect('/login?error=ms_auth_failed');
    }

    // CSRF check
    if (!state || state !== req.session.msOAuthState) {
      logger.warn('Microsoft OAuth state mismatch');
      return res.redirect('/login?error=ms_auth_failed');
    }
    delete req.session.msOAuthState;

    try {
      // Exchange authorisation code for tokens
      const tokenRes = await fetch(
        `https://login.microsoftonline.com/${TENANT_ID()}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id:     CLIENT_ID(),
            client_secret: CLIENT_SEC(),
            code,
            redirect_uri:  callbackUrl(req),
            grant_type:    'authorization_code',
          }),
        }
      );

      const tokenData = await tokenRes.json() as Record<string, string>;

      if (!tokenRes.ok || !tokenData.id_token) {
        logger.error('Microsoft token exchange failed', tokenData);
        return res.redirect('/login?error=ms_auth_failed');
      }

      // Decode id_token payload (no signature verification needed — we just
      // exchanged a server-side code; Azure issued the token directly to us)
      const payloadB64 = tokenData.id_token.split('.')[1];
      const payload = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf-8')
      ) as Record<string, string>;

      const email = (payload.preferred_username || payload.email || payload.upn || '').toLowerCase();

      if (!email) {
        logger.warn('Microsoft OAuth: no email in token payload', payload);
        return res.redirect('/login?error=ms_no_email');
      }

      // Look up existing user
      const user = await storage.getUserByEmail(email);
      if (!user || !user.isActive) {
        logger.warn('Microsoft OAuth: no active account for email', { email });
        return res.redirect(`/login?error=ms_no_account&email=${encodeURIComponent(email)}`);
      }

      // Create session — same as the email/password login flow
      req.session.userId      = user.id;
      req.session.userRole    = user.role;
      req.session.userEmail   = user.email;
      req.session.displayName = user.displayName;
      req.session.touch();

      await new Promise<void>((resolve) => {
        req.session.save(async (err) => {
          if (err) {
            logger.error('Microsoft OAuth session save error', err);
            res.redirect('/login?error=ms_auth_failed');
          } else {
            await auditLog(user.id, user.email, null, 'LOGIN', `Microsoft SSO login from ${req.ip}`);
            res.redirect('/app/dashboard');
          }
          resolve();
        });
      });
    } catch (err) {
      logger.error('Microsoft OAuth callback error', err);
      return res.redirect('/login?error=ms_auth_failed');
    }
  });
}
