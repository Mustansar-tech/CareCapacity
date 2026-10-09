import type { Request, Response, NextFunction } from 'express';
import { RoutingError } from '../features/travel/routing-error';
import { withRoutingDeadline } from '../features/travel/safe-routing-request';
import { withIsolatedTravelService } from '../features/travel/travel-time-service';

export function safeTravel(
  handler: (req: Request, res: Response) => Promise<void>,
  timeoutMs = 90000,
) {
  return async (req: Request, res: Response, _next: NextFunction) => {
    const cancellation = new AbortController();
    const timer = setTimeout(() => cancellation.abort(), timeoutMs);
    const closed = () => { if (!res.writableEnded) cancellation.abort(); };
    res.once('close', closed);
    try {
      await withRoutingDeadline(cancellation.signal, () => withIsolatedTravelService(() => handler(req, res)), timeoutMs);
    } catch (error) {
      if (!(error instanceof RoutingError)) throw error;
      if (!res.headersSent && !res.destroyed) {
        if (error.retryAfterSeconds) res.setHeader('Retry-After', error.retryAfterSeconds);
        res.status(error.statusCode).json({ message: error.message, code: error.code });
      }
    } finally {
      clearTimeout(timer);
      res.off('close', closed);
    }
  };
}
