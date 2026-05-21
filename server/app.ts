import type { Express, Request, Response, NextFunction } from 'express';
import { createServer, type Server } from 'http';
import { storage } from './storage';
import { logger } from './infrastructure/logger';
import { requireAuth } from './features/auth/auth';
import { registerAuthRoutes } from './features/auth/auth.routes';
import { registerPeoplePlannerRoutes } from './features/people-planner/automation-routes';
import { registerProcessRoutes } from './routes/process';
import { registerHistoryRoutes } from './routes/history';
import { registerVisitsRoutes } from './routes/visits';
import { registerScheduleRoutes } from './routes/schedule';
import { registerGeoRoutes } from './routes/geo';
import { registerTravelTimesRoutes } from './routes/travel-times';
import { registerBdMatcherRoutes } from './routes/bd-matcher';
import { registerEnquiriesRoutes } from './routes/enquiries';
import { registerDebugRoutes } from './routes/debug';
import { registerCapacityOutlookRoutes } from './routes/capacity-outlook';

const PUBLIC_API_PATHS = ['/auth/', '/branches', '/cron/sync'];

function globalAuthGuard(req: Request, res: Response, next: NextFunction) {
  const path = req.path;
  if (PUBLIC_API_PATHS.some(p => path === p || path.startsWith(p))) {
    return next();
  }
  return requireAuth(req, res, next);
}

export async function configureApp(app: Express): Promise<Server> {
  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain');
    res.send('User-agent: *\nDisallow: /api/\nDisallow: /health\nAllow: /\n');
  });

  app.use('/api', globalAuthGuard);

  registerAuthRoutes(app);

  if (process.env.ACCESS_EMAIL) {
    registerPeoplePlannerRoutes(app);
    // Scheduler is now handled by the worker process (server/worker.ts).
    // On Hetzner + PM2, care-capacity-worker arms the Monday timers.
    // In development, run `tsx server/worker.ts` alongside the dev server.
  }

  app.get('/health', async (_req, res) => {
    try {
      const { checkDatabaseHealth } = await import('./infrastructure/db');
      const dbHealthy = await checkDatabaseHealth();
      const health = {
        status: dbHealthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: dbHealthy ? 'connected' : 'disconnected',
      };
      res.status(dbHealthy ? 200 : 503).json(health);
    } catch (error) {
      logger.error('Health check failed', error);
      res.status(500).json({ status: 'error' });
    }
  });

  app.get('/api/branches', async (_req, res) => {
    try {
      const branches = await storage.getAllBranches();
      res.json(branches);
    } catch (error) {
      logger.error('Error fetching branches', error);
      res.status(500).json({ message: 'Failed to fetch branches' });
    }
  });

  registerProcessRoutes(app);
  registerHistoryRoutes(app);
  registerVisitsRoutes(app);
  registerScheduleRoutes(app);
  registerGeoRoutes(app);
  registerTravelTimesRoutes(app);
  registerBdMatcherRoutes(app);
  registerEnquiriesRoutes(app);
  registerDebugRoutes(app);
  registerCapacityOutlookRoutes(app);

  return createServer(app);
}
