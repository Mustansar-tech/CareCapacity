// Sentry must be initialised before any other imports so it can instrument
// all downstream modules (HTTP, pg, etc.) from the start.
import "./infrastructure/sentry";
import { Sentry } from "./infrastructure/sentry";

import express from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { generalLimiter } from "./infrastructure/rate-limiter";
import { securityHeaders } from "./infrastructure/security";
import { logger } from "./infrastructure/logger";
import { seedAdminUser } from "./features/auth/auth";
import { migrateUsersToSupabase } from "./features/auth/migrate-to-supabase";
import { config } from "./config/index";
import { errorHandler } from "./middleware/error-handler";

// Augment session type
declare module 'express-session' {
  interface SessionData {
    userId?: string;
    userRole?: string;
    userEmail?: string;
    displayName?: string;
    msOAuthState?: string;
  }
}

const isProduction = process.env.NODE_ENV === 'production';

// CORS_ORIGIN is set when the frontend lives on a different origin (e.g. Vercel)
// from the API server (e.g. Hetzner/DigitalOcean). Leave unset for same-origin.
const corsOrigin = process.env.CORS_ORIGIN?.trim() || null;

const app = express();

// /api/health — always available, no auth needed (used by Hetzner health checks
// and uptime monitors). Registered before all middleware.
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "Care Capacity API" });
});

// Root health check — only when running as an API-only backend (i.e. the
// frontend is deployed separately on Vercel). In development and same-origin
// production, Vite/static serves the frontend at "/", so this must not run.
if (corsOrigin) {
  app.get("/", (_req, res) => {
    res.json({ status: "ok", service: "Care Capacity API" });
  });
}

// Trust proxy for secure cookies behind reverse proxy
if (isProduction) {
  app.set('trust proxy', 1);
}

// Cross-origin support — must come before all routes and session middleware
if (corsOrigin) {
  app.use(cors({
    origin: corsOrigin,
    credentials: true,          // allow cookies to be sent cross-origin
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));
  log(`CORS enabled for origin: ${corsOrigin}`);
}

app.use(securityHeaders);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

// Session setup using PostgreSQL store
const PgSession = connectPgSimple(session);
const sessionPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.SESSION_POOL_MAX || 3),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: {
    rejectUnauthorized: false,
  },
});

const SESSION_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

app.use(session({
  store: new PgSession({
    pool: sessionPool,
    tableName: 'session',
    createTableIfMissing: true,
    // Prune expired sessions from the DB every hour
    pruneSessionInterval: 60 * 60,
  }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,               // Reset expiry on every authenticated request
  cookie: {
    // When the frontend is on a different origin (Vercel), cookies must be
    // sameSite: 'none' + secure: true for browsers to send them cross-site.
    // For same-origin deployments, 'lax' is safer and works without HTTPS.
    secure: isProduction,
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_MS,
    sameSite: corsOrigin ? 'none' : 'lax',
  },
}));

if (isProduction) {
  app.use('/api', generalLimiter.middleware);
  log('Rate limiting enabled for production');
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);
  await seedAdminUser();
  await migrateUsersToSupabase();

  // Auto-close previous month's capacity snapshot if it hasn't been done yet.
  // Fire-and-forget — runs 8 s after startup to let DB connections settle.
  setTimeout(async () => {
    try {
      const { autoCloseForAllBranches } = await import('./repositories/capacity-outlook.repository');
      await autoCloseForAllBranches();
    } catch (err) {
      logger.error('monthly capacity auto-close startup error', err);
    }
  }, 8000);

  // Hourly check: auto-close the previous month on month rollover.
  // autoCloseForAllBranches is idempotent — does nothing if snapshot already exists.
  setInterval(async () => {
    try {
      const { autoCloseForAllBranches } = await import('./repositories/capacity-outlook.repository');
      await autoCloseForAllBranches();
    } catch (err) {
      logger.error('monthly capacity auto-close hourly error', err);
    }
  }, 60 * 60 * 1000);

  // Monthly leaver report scheduler — fires at 08:00 UTC daily, sends on the 1st.
  try {
    const { initLeaverReportScheduler } = await import('./jobs/leaver-report-scheduler');
    initLeaverReportScheduler();
  } catch (err) {
    logger.error('Failed to init leaver report scheduler', err);
  }

  // Run geo-sweeper in the background after startup to geocode any client
  // locations that have a postcode but are still missing lat/lng coordinates.
  // This is fire-and-forget — it does not block server startup.
  setTimeout(async () => {
    try {
      const { sweepMissingClientGeocode } = await import('./jobs/geo-sweeper');
      const result = await sweepMissingClientGeocode();
      if (result.total > 0) {
        log(`geo-sweeper on startup: ${result.geocoded}/${result.total} geocoded, ${result.failed} failed`);
      }
    } catch (err) {
      logger.error('geo-sweeper startup error', err);
    }
  }, 5000);

  // Serve the frontend:
  //  - Development: Vite dev server with HMR
  //  - Production, same-origin: serve the built dist/public
  //  - Production, split-origin (CORS_ORIGIN set): frontend is on Vercel,
  //    so the backend only serves the API — no static files needed.
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else if (!corsOrigin) {
    serveStatic(app);
  } else {
    log("Split-origin mode: frontend served by Vercel, API-only server");
  }

  // Sentry error handler — must come BEFORE the custom error handler so Sentry
  // captures the original exception before we transform the response.
  Sentry.setupExpressErrorHandler(app);

  // Global error handler — must be registered AFTER all routes and static
  // middleware so it catches errors from every layer (including sendFile failures)
  app.use(errorHandler);

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
  });

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    log(`${signal} received, starting graceful shutdown...`);

    // People Planner automation jobs can take 10–20 minutes per run.
    // Give active jobs up to 25 minutes to finish before forcing exit.
    // If no automation is running, 30 seconds is plenty.
    let forceTimeoutMs = 30_000;
    try {
      const { isRunning } = await import('./features/people-planner/automation-engine');
      if (isRunning()) {
        forceTimeoutMs = 25 * 60 * 1000; // 25 minutes
        log('People Planner automation is active — extending shutdown grace period to 25 minutes');
      }
    } catch {
      // Non-fatal — fall back to 30 s
    }

    server.close(() => {
      log('HTTP server closed');
      process.exit(0);
    });

    const forceTimer = setTimeout(() => {
      log('Forced shutdown after timeout');
      process.exit(1);
    }, forceTimeoutMs);

    // Don't let this timer keep the event loop alive if everything else exits.
    forceTimer.unref?.();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
})();

// ─── Global crash protection ──────────────────────────────────────────────────
// Playwright browser automation throws unhandled rejections on network/TLS
// failures. Without these handlers the entire Node process exits (exit status 1)
// which takes down the whole app for all users.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection — keeping process alive', undefined, {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — keeping process alive', err, {
    message: err.message,
    stack: err.stack,
  });
  Sentry.captureException(err);
});
