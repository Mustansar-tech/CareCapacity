
import { logger } from './logger';

interface Config {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  databaseUrl: string;
  defaultBranchId?: string;
  orsApiKey?: string;
  logLevel: string;
}

function validateConfig(): Config {
  const errors: string[] = [];

  // Required variables
  if (!process.env.DATABASE_URL) {
    errors.push('DATABASE_URL is required');
  }

  // Warn about missing optional but recommended variables
  if (!process.env.ORS_API_KEY) {
    logger.warn('ORS_API_KEY not set - route optimization will be limited');
  }

  if (!process.env.DEFAULT_BRANCH_ID && process.env.NODE_ENV === 'production') {
    logger.warn('DEFAULT_BRANCH_ID not set - users must always select a branch');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }

  const config: Config = {
    nodeEnv: (process.env.NODE_ENV as any) || 'development',
    port: parseInt(process.env.PORT || '5000', 10),
    databaseUrl: process.env.DATABASE_URL!,
    defaultBranchId: process.env.DEFAULT_BRANCH_ID,
    orsApiKey: process.env.ORS_API_KEY,
    logLevel: process.env.LOG_LEVEL || 'info'
  };

  logger.info('Configuration loaded successfully', {
    nodeEnv: config.nodeEnv,
    port: config.port,
    hasOrsApiKey: !!config.orsApiKey
  });

  return config;
}

export const config = validateConfig();
