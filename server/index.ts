import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { generalLimiter } from "./rate-limiter";
import { securityHeaders } from "./security";
import { logger } from "./logger";
import { seedAdminUser } from "./auth";

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

app.use(session({
  store: new PgSession({
    pool: sessionPool,
    tableName: 'session',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || 'care-capacity-dashboard-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction,
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000, // 8 hours — typical care shift length
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

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const internalMessage = err.message || "Internal Server Error";

    logger.error(`HTTP ${status}: ${internalMessage}`, err);

    const clientMessage = isProduction
      ? (status >= 500 ? "Internal Server Error" : "Request failed")
      : internalMessage;

    res.status(status).json({ message: clientMessage });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

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
