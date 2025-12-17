
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

class Logger {
  private context: LogContext = {};

  setContext(context: LogContext) {
    this.context = { ...this.context, ...context };
  }

  private formatMessage(level: LogLevel, message: string, meta?: any) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...this.context,
      ...meta
    };

    if (process.env.NODE_ENV === 'production') {
      // JSON format for log aggregation services (Datadog, CloudWatch, etc.)
      return JSON.stringify(logEntry);
    } else {
      // Human-readable format for development
      const metaStr = meta ? `\n${JSON.stringify(meta, null, 2)}` : '';
      return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
    }
  }

  debug(message: string, meta?: any) {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(this.formatMessage(LogLevel.DEBUG, message, meta));
    }
  }

  info(message: string, meta?: any) {
    console.log(this.formatMessage(LogLevel.INFO, message, meta));
  }

  warn(message: string, meta?: any) {
    console.warn(this.formatMessage(LogLevel.WARN, message, meta));
  }

  error(message: string, error?: Error | any, meta?: any) {
    const errorMeta = error instanceof Error ? {
      errorMessage: error.message,
      errorStack: error.stack,
      errorName: error.name,
      ...meta
    } : { error, ...meta };

    console.error(this.formatMessage(LogLevel.ERROR, message, errorMeta));
  }

  // Request logging helper
  logRequest(req: Request, duration: number, statusCode: number) {
    this.info('HTTP Request', {
      method: req.method,
      path: req.path,
      duration: `${duration}ms`,
      statusCode,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
  }
}

export const logger = new Logger();
