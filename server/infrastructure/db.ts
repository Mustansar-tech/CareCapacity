import pg from 'pg';
const { Pool } = pg;
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from "@shared/schema";
import { logger } from "./logger";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Detect whether this process is the background worker so we can apply
// a tighter pool cap without requiring separate DB modules.
const _isWorker =
  process.env.PM2_PROCESS_NAME === "care-capacity-worker" ||
  Boolean(process.argv[1]?.includes("worker"));

const _poolMax = _isWorker
  ? Number(process.env.WORKER_POOL_MAX || 3)
  : Number(process.env.PGPOOL_MAX || 7);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: _poolMax,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.on('error', (err) => {
  logger.warn('Database pool connection error (non-fatal)', { message: (err as Error).message });
});

export const db = drizzle({ client: pool, schema });

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

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (error) {
    logger.error('Database health check failed', { message: (error as Error).message });
    return false;
  }
}

if (process.env.NODE_ENV === 'production') {
  setInterval(async () => {
    const isHealthy = await checkDatabaseHealth();
    if (!isHealthy) {
      logger.warn('Database keep-alive ping failed');
    }
  }, 4 * 60 * 1000);
}
