import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { generalLimiter } from "./rate-limiter";
import { securityHeaders } from "./security";
import { logger } from "./logger";
import { seedAdminUser } from "./auth";
import { config } from "./config";
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

// Trust proxy for secure cookies behind reverse proxy
if (isProduction) {
  app.set('trust proxy', 1);
}

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
  await seedAdminUser();

  // Run geo-sweeper in the background after startup to geocode any client
  // locations that have a postcode but are still missing lat/lng coordinates.
  // This is fire-and-forget — it does not block server startup.
  setTimeout(async () => {
    try {
      const { sweepMissingClientGeocode } = await import('./geo-sweeper');
      const result = await sweepMissingClientGeocode();
      if (result.total > 0) {
        log(`geo-sweeper on startup: ${result.geocoded}/${result.total} geocoded, ${result.failed} failed`);
      }
    } catch (err) {
      logger.error('geo-sweeper startup error', err);
    }
  }, 5000);

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

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
