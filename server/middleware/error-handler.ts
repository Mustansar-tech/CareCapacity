import { Request, Response, NextFunction } from 'express';
import { logger } from '../infrastructure/logger';

const isProduction = process.env.NODE_ENV === 'production';

export interface AppError extends Error {
  status?: number;
  statusCode?: number;
  code?: string;
}

export function createAppError(message: string, statusCode = 500): AppError {
  const err: AppError = new Error(message);
  err.statusCode = statusCode;
  return err;
}

export function errorHandler(
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const status = err.status ?? err.statusCode ?? 500;
  const internalMessage = err.message || 'Internal Server Error';

  logger.error(`HTTP ${status}: ${internalMessage}`, err);

  const clientMessage = isProduction
    ? (status >= 500 ? 'Internal Server Error' : 'Request failed')
    : internalMessage;

  res.status(status).json({ message: clientMessage });
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
