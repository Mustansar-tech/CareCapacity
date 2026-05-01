import { Request, Response, NextFunction } from 'express';

// ─── HTTPS enforcement ────────────────────────────────────────────────────────

/**
 * Redirect plain-HTTP requests to HTTPS in production.
 * Relies on `trust proxy` being set so req.protocol reflects X-Forwarded-Proto.
 */
export function enforceHttps(req: Request, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV !== 'production') return next();
  // req.protocol is 'http' when Replit's reverse-proxy forwarded an HTTP request
  if (req.protocol === 'http') {
    const httpsUrl = `https://${req.get('host')}${req.originalUrl}`;
    return res.redirect(301, httpsUrl);
  }
  next();
}

// ─── Security headers ─────────────────────────────────────────────────────────

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // Prevent MIME-type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions policy — lock down browser features not needed by this app
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), payment=(), usb=(), bluetooth=()'
  );

  // Strict-Transport-Security — tell browsers to use HTTPS only for 1 year.
  // `preload` qualifies the domain for inclusion in browser HSTS preload lists
  // so future visitors always get HTTPS even on first visit.
  if (process.env.NODE_ENV === 'production') {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }

  // Content-Security-Policy
  // Notes:
  // • 'unsafe-inline' is required for Vite/React (inline styles + event attrs).
  // • 'unsafe-eval' is NOT included — not needed at runtime.
  // • ws:/wss: added to connect-src for Vite HMR in development.
  const connectSrc = process.env.NODE_ENV === 'production'
    ? "'self' https://api.openrouteservice.org https://api.traveltimeapp.com"
    : "'self' ws: wss: https://api.openrouteservice.org https://api.traveltimeapp.com";

  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      `connect-src ${connectSrc}`,
      "frame-ancestors 'none'",
    ].join('; ')
  );

  // Cross-origin resource policy
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

  next();
}

// ─── Input sanitisation ───────────────────────────────────────────────────────

export function sanitizeInput(input: unknown): unknown {
  if (typeof input === 'string') {
    return input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '');
  }
  if (Array.isArray(input)) return input.map(sanitizeInput);
  if (typeof input === 'object' && input !== null) {
    const sanitized: Record<string, unknown> = {};
    for (const key in input as Record<string, unknown>) {
      sanitized[key] = sanitizeInput((input as Record<string, unknown>)[key]);
    }
    return sanitized;
  }
  return input;
}
