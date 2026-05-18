/**
 * Sentry initialisation — must be imported before any other server code.
 *
 * Activated only when SENTRY_DSN is set in the environment.
 * sendDefaultPii is false so cookies, IPs and user identifiers are never
 * transmitted. beforeSend additionally scrubs any sensitive fields that may
 * appear in request bodies (passwords, tokens, People Planner credentials).
 */
import * as Sentry from '@sentry/node';

const SENSITIVE_BODY_KEYS = new Set([
  'password', 'newPassword', 'confirmPassword',
  'accessToken', 'token', 'secret', 'apiKey', 'api_key',
  'credentials', 'cookie', 'authorization',
  // People Planner account fields
  'ppPassword', 'ppEmail', 'access_password',
]);

const dsn = process.env.SENTRY_DSN?.trim();
const environment = process.env.APP_ENV || process.env.NODE_ENV || 'development';

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    sendDefaultPii: false,

    beforeSend(event) {
      // Strip cookie headers
      if (event.request?.headers) {
        const h = event.request.headers as Record<string, string>;
        if (h['cookie'])        h['cookie'] = '[Filtered]';
        if (h['authorization']) h['authorization'] = '[Filtered]';
      }
      if (event.request?.cookies) {
        event.request.cookies = {};
      }

      // Strip sensitive fields from request body
      if (event.request?.data && typeof event.request.data === 'object') {
        const body = { ...(event.request.data as Record<string, unknown>) };
        for (const key of Object.keys(body)) {
          if (SENSITIVE_BODY_KEYS.has(key.toLowerCase())) {
            body[key] = '[Filtered]';
          }
        }
        event.request.data = body;
      }

      return event;
    },
  });
}

export { Sentry };
export const sentryEnabled = !!dsn;
