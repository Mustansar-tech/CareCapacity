import type { Express, Request, Response } from 'express';
import { storage } from '../../storage';
import { logger } from '../../infrastructure/logger';
import { auditLog } from './auth';
import crypto from 'crypto';

const TENANT_ID  = () => process.env.AZURE_TENANT_ID!;
const CLIENT_ID  = () => process.env.AZURE_CLIENT_ID!;
const CLIENT_SEC = () => process.env.AZURE_CLIENT_SECRET!;

/** Public base URL of the frontend (no trailing slash). */
function frontendUrl(): string {
  // Replit dev: use the stable public dev domain
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  // Production: FRONTEND_URL env var, or canonical domain as final fallback
  return (process.env.FRONTEND_URL || 'https://carecapacity.sur-group.co.uk').replace(/\/$/, '');
}

function callbackUrl(): string {
  return `${frontendUrl()}/api/auth/microsoft/callback`;
}

export function registerMicrosoftAuthRoutes(app: Express) {
  if (!process.env.AZURE_CLIENT_ID || !process.env.AZURE_TENANT_ID || !process.env.AZURE_CLIENT_SECRET) {
    logger.warn('Microsoft OAuth not configured — AZURE_CLIENT_ID / AZURE_TENANT_ID / AZURE_CLIENT_SECRET missing');
    return;
  }

  const cb = callbackUrl();
  logger.info(`Microsoft OAuth callback URL: ${cb}`);

  // ── Step 1: redirect to Microsoft login ────────────────────────────────────
  app.get('/api/auth/microsoft', (req: Request, res: Response) => {
    const state = crypto.randomBytes(20).toString('hex');
    req.session.msOAuthState = state;

    const params = new URLSearchParams({
      client_id:     CLIENT_ID(),
      response_type: 'code',
      redirect_uri:  cb,
      scope:         'openid profile email',
      state,
      response_mode: 'query',
      prompt:        'select_account',   // always show the MS account picker
    });

    req.session.save((err) => {
      if (err) logger.error('Microsoft OAuth: session save error before redirect', err);
      res.redirect(
        `https://login.microsoftonline.com/${TENANT_ID()}/oauth2/v2.0/authorize?${params.toString()}`
      );
    });
  });

  // ── Step 2: handle Microsoft callback ─────────────────────────────────────
  app.get('/api/auth/microsoft/callback', async (req: Request, res: Response) => {
    const { code, state, error, error_description } = req.query as Record<string, string>;

    const fe = frontendUrl();

    // Microsoft returned an error
    if (error) {
      logger.warn('Microsoft OAuth: provider error', { error, error_description });
      return res.redirect(`${fe}/login?error=ms_auth_failed`);
    }

    // CSRF / state check
    const savedState = req.session.msOAuthState;
    if (!state || !savedState || state !== savedState) {
      logger.warn('Microsoft OAuth: state mismatch', {
        received: state,
        expected: savedState,
        sessionId: req.sessionID,
        hasCookie: !!req.headers.cookie,
      });
      return res.redirect(`${fe}/login?error=ms_auth_failed`);
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
            redirect_uri:  cb,
            grant_type:    'authorization_code',
          }),
        }
      );

      const tokenData = await tokenRes.json() as Record<string, string>;

      if (!tokenRes.ok || !tokenData.id_token) {
        logger.error('Microsoft OAuth: token exchange failed', {
          status: tokenRes.status,
          error: tokenData.error,
          description: tokenData.error_description,
        });
        return res.redirect(`${fe}/login?error=ms_auth_failed`);
      }

      // Decode id_token payload
      const payloadB64 = tokenData.id_token.split('.')[1];
      const payload = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf-8')
      ) as Record<string, string>;

      const email = (payload.preferred_username || payload.email || payload.upn || '').toLowerCase();

      if (!email) {
        logger.warn('Microsoft OAuth: no email in token payload', { keys: Object.keys(payload) });
        return res.redirect(`${fe}/login?error=ms_no_email`);
      }

      logger.info('Microsoft OAuth: token decoded', { email });

      // Look up existing user
      const user = await storage.getUserByEmail(email);
      if (!user || !user.isActive) {
        logger.warn('Microsoft OAuth: no active account', { email });
        return res.redirect(`${fe}/login?error=ms_no_account&email=${encodeURIComponent(email)}`);
      }

      // Create session — identical to the email/password login flow
      req.session.userId      = user.id;
      req.session.userRole    = user.role;
      req.session.userEmail   = user.email;
      req.session.displayName = user.displayName;
      req.session.touch();

      await new Promise<void>((resolve) => {
        req.session.save(async (err) => {
          if (err) {
            logger.error('Microsoft OAuth: session save error', err);
            res.redirect(`${fe}/login?error=ms_auth_failed`);
          } else {
            await auditLog(user.id, user.email, null, 'LOGIN', `Microsoft SSO login from ${req.ip}`);
            logger.info('Microsoft OAuth: login success', { email, userId: user.id });
            res.redirect(`${fe}/app/dashboard`);
          }
          resolve();
        });
      });
    } catch (err) {
      logger.error('Microsoft OAuth: callback exception', err);
      return res.redirect(`${fe}/login?error=ms_auth_failed`);
    }
  });
}
