import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { logger } from "./logger";
import { registerAuthRoutes } from './auth-routes';
import { registerPeoplePlannerRoutes } from './people-planner/automation-routes';
import { registerProcessRoutes } from './routes/process';
import { registerHistoryRoutes } from './routes/history';
import { registerVisitsRoutes } from './routes/visits';
import { registerScheduleRoutes } from './routes/schedule';
import { registerGeoRoutes } from './routes/geo';
import { registerTravelTimesRoutes } from './routes/travel-times';
import { registerBdMatcherRoutes } from './routes/bd-matcher';
import { registerEnquiriesRoutes } from './routes/enquiries';
import { registerDebugRoutes } from './routes/debug';

// Re-export getLatestGuaranteedBuffer so existing callers (auto-scheduler, etc.) keep working
export { getLatestGuaranteedBuffer } from './routes/state';

export async function registerRoutes(app: Express): Promise<Server> {

  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain');
    res.send('User-agent: *\nDisallow: /api/\nDisallow: /health\nAllow: /\n');
  });

  registerAuthRoutes(app);

  if (process.env.ACCESS_EMAIL) {
    registerPeoplePlannerRoutes(app);
  }

  app.get('/health', async (_req, res) => {
    try {
      const { checkDatabaseHealth } = await import('./db');
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

  const httpServer = createServer(app);
  return httpServer;
}
