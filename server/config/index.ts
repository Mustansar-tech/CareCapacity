
import { logger } from '../infrastructure/logger';

interface Config {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  databaseUrl: string;
  sessionSecret: string;
  defaultBranchId?: string;
  orsApiKey?: string;
  logLevel: string;
}

function validateConfig(): Config {
  const errors: string[] = [];
  const isProduction = process.env.NODE_ENV === 'production';

  // Required variables (all environments)
  if (!process.env.DATABASE_URL) {
    errors.push('DATABASE_URL is required');
  }

  // SESSION_SECRET must be set in production; in development a fallback is allowed
  // but we warn loudly so it doesn't go unnoticed.
  if (!process.env.SESSION_SECRET) {
    if (isProduction) {
      errors.push('SESSION_SECRET is required in production');
    } else {
      logger.warn('SESSION_SECRET not set — using insecure development fallback. Set this env var before deploying.');
    }
  }

  // Warn about missing optional but recommended variables
  if (!process.env.ORS_API_KEY) {
    logger.warn('ORS_API_KEY not set - route optimization will be limited');
  }

  if (!process.env.DEFAULT_BRANCH_ID && isProduction) {
    logger.warn('DEFAULT_BRANCH_ID not set - users must always select a branch');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }

  const config: Config = {
    nodeEnv: (process.env.NODE_ENV as any) || 'development',
    port: parseInt(process.env.PORT || '5000', 10),
    databaseUrl: process.env.DATABASE_URL!,
    sessionSecret: process.env.SESSION_SECRET || 'care-capacity-dashboard-secret-key-change-in-production',
    defaultBranchId: process.env.DEFAULT_BRANCH_ID,
    orsApiKey: process.env.ORS_API_KEY,
    logLevel: process.env.LOG_LEVEL || 'info'
  };

  return config;
}

export const config = validateConfig();
