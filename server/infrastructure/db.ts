import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { sql } from 'drizzle-orm';
import ws from "ws";
import * as schema from "@shared/schema";
import { logger } from "./logger";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// For autoscale deployments, keep the pool small — multiple cold instances can
// compete for Neon's connection limit.  10 is plenty for a care-ops dashboard.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000, // Give Neon cold-start up to 15s
});

// Pool-level errors (e.g. idle WebSocket drops) are non-fatal and self-healing.
// Log at warn, not error, to avoid false alarms in production monitoring.
pool.on('error', (err) => {
  logger.warn('Database pool connection error (non-fatal)', { message: (err as Error).message });
});

export const db = drizzle({ client: pool, schema });

// Helper function for query retry logic
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      logger.error(`Database operation failed (attempt ${attempt}/${maxRetries})`, { error });

      if (attempt === maxRetries) {
        throw error;
      }

      const waitTime = delay * Math.pow(2, attempt - 1);
      logger.info(`Retrying database operation in ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  throw new Error('Database operation failed after all retries');
}

// Health check — uses a real SELECT 1 query through Drizzle so that Neon's
// compute wakes up and registers activity.  pool.connect()+release() alone
// does not count as activity from Neon's perspective, causing the compute to
// suspend between checks even when the interval is shorter than the idle timeout.
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (error) {
    logger.error('Database health check failed', { message: (error as Error).message });
    return false;
  }
}

// Periodic keep-alive in production.  Neon suspends compute after ~5 minutes
// of inactivity.  Running SELECT 1 every 4 minutes prevents cold-start latency
// for end users and keeps the pool connections alive.
if (process.env.NODE_ENV === 'production') {
  setInterval(async () => {
    const isHealthy = await checkDatabaseHealth();
    if (!isHealthy) {
      logger.warn('Database keep-alive ping failed — Neon may be cold-starting');
    }
  }, 4 * 60 * 1000); // Every 4 minutes
}
