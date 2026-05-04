import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { generalLimiter } from "./infrastructure/rate-limiter";
import { securityHeaders } from "./infrastructure/security";
import { logger } from "./infrastructure/logger";
import { seedAdminUser } from "./features/auth/auth";
import { config } from "./config/index";
import { errorHandler } from "./middleware/error-handler";

// Augment session type
declare module 'express-session' {
  interface SessionData {
    userId?: string;
    userRole?: string;
    userEmail?: string;
    displayName?: string;
  }
}

const isProduction = process.env.NODE_ENV === 'production';
const app = express();

// Trust all proxy hops (Replit uses a multi-layer reverse proxy in production).
// This ensures req.protocol / req.ip are set from X-Forwarded-Proto / X-Forwarded-For.
// Note: HTTP→HTTPS redirection is handled at the edge by Replit's load balancer,
// so we do NOT add an enforceHttps middleware here — it would break internal
// health-check probes that hit the container directly over plain HTTP.
app.set('trust proxy', true);

app.use(securityHeaders);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

// Session setup using PostgreSQL store
const PgSession = connectPgSimple(session);
const sessionPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

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
    secure: isProduction,
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_MS,
    sameSite: 'lax',
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

  // Register static file serving / Vite HMR BEFORE listen so the catch-all
  // route is in place when the first request arrives.
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Global error handler — must be registered AFTER all routes and static
  // middleware so it catches errors from every layer (including sendFile failures)
  app.use(errorHandler);

  // Start listening FIRST so Replit's deployment health-check probe (GET /)
  // gets an immediate 200 from the static file handler.  DB-dependent work
  // (seed, geo-sweeper) runs afterwards in the background and does NOT block
  // the server from becoming ready.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
  });

  // --- background initialisation (non-blocking) ---

  // Seed the admin user.  Runs after listen so a slow/hibernating Neon DB
  // wake-up does not delay the health-check response.
  seedAdminUser().catch((err) =>
    logger.error('seedAdminUser error', err)
  );

  // Geocode any clients that have a postcode but no lat/lng.
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

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    log(`${signal} received, starting graceful shutdown...`);
    
    server.close(() => {
      log('HTTP server closed');
      process.exit(0);
    });

    // Force shutdown after 30 seconds
    setTimeout(() => {
      log('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
})();

// ─── Global crash protection ──────────────────────────────────────────────────
// Playwright browser automation throws unhandled rejections on network/TLS
// failures. Without these handlers the entire Node process exits (exit status 1)
// which takes down the whole app for all users.
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection — keeping process alive', undefined, {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — keeping process alive', err, {
    message: err.message,
    stack: err.stack,
  });
});
