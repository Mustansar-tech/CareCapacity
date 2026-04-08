import type { Express } from 'express';
import type { Server } from 'http';
import { configureApp } from './app';

// Re-export getLatestGuaranteedBuffer so existing callers (auto-scheduler, etc.) keep working
export { getLatestGuaranteedBuffer } from './routes/state';

export async function registerRoutes(app: Express): Promise<Server> {
  return configureApp(app);
}
