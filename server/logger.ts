import { Request } from 'express';

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

interface LogContext {
  branchId?: string;
  userId?: string;
  requestId?: string;
  [key: string]: any;
}

const isProduction = process.env.NODE_ENV === 'production';

class Logger {
  private context: LogContext = {};

  setContext(context: LogContext) {
    this.context = { ...this.context, ...context };
  }

  private formatMessage(level: LogLevel, message: string, meta?: any): string {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...this.context,
      ...meta
    };

    if (isProduction) {
      return JSON.stringify(logEntry);
    } else {
      const metaStr = meta ? `\n${JSON.stringify(meta, null, 2)}` : '';
      return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
    }
  }

  debug(message: string, meta?: any) {
    // Debug logs are disabled in all environments to prevent data leakage and noise
  }

  info(message: string, meta?: any) {
    // Info logs are only enabled in development
    if (!isProduction) {
      console.log(this.formatMessage(LogLevel.INFO, message, meta));
    }
  }

  warn(message: string, meta?: any) {
    console.warn(this.formatMessage(LogLevel.WARN, message, meta));
  }

  error(message: string, error?: Error | any, meta?: any) {
    const errorMeta = error instanceof Error ? {
      errorMessage: error.message,
      errorStack: isProduction ? undefined : error.stack,
      errorName: error.name,
      ...meta
    } : { error: isProduction ? String(error) : error, ...meta };

    console.error(this.formatMessage(LogLevel.ERROR, message, errorMeta));
  }

  logRequest(req: Request, duration: number, statusCode: number) {
    if (!isProduction) {
      this.info('HTTP Request', {
        method: req.method,
        path: req.path,
        duration: `${duration}ms`,
        statusCode
      });
    }
  }
}

export const logger = new Logger();
