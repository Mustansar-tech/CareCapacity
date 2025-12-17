
import { Request, Response, NextFunction } from 'express';

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

class RateLimiter {
  private store: RateLimitStore = {};
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number = 100, windowMs: number = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    
    // Cleanup old entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  private cleanup() {
    const now = Date.now();
    Object.keys(this.store).forEach(key => {
      if (this.store[key].resetTime < now) {
        delete this.store[key];
      }
    });
  }

  private getKey(req: Request): string {
    // Use IP address or authenticated user ID
    const forwarded = req.headers['x-forwarded-for'];
    const ip = typeof forwarded === 'string' 
      ? forwarded.split(',')[0].trim()
      : req.socket.remoteAddress || 'unknown';
    
    return `${ip}:${req.path}`;
  }

  public middleware = (req: Request, res: Response, next: NextFunction) => {
    const key = this.getKey(req);
    const now = Date.now();

    if (!this.store[key] || this.store[key].resetTime < now) {
      this.store[key] = {
        count: 1,
        resetTime: now + this.windowMs
      };
      return next();
    }

    this.store[key].count++;

    if (this.store[key].count > this.maxRequests) {
      const retryAfter = Math.ceil((this.store[key].resetTime - now) / 1000);
      res.set('Retry-After', retryAfter.toString());
      res.set('X-RateLimit-Limit', this.maxRequests.toString());
      res.set('X-RateLimit-Remaining', '0');
      res.set('X-RateLimit-Reset', this.store[key].resetTime.toString());
      
      return res.status(429).json({
        message: 'Too many requests, please try again later.',
        retryAfter
      });
    }

    res.set('X-RateLimit-Limit', this.maxRequests.toString());
    res.set('X-RateLimit-Remaining', (this.maxRequests - this.store[key].count).toString());
    res.set('X-RateLimit-Reset', this.store[key].resetTime.toString());
    
    next();
  };
}

// Different limits for different route types
export const generalLimiter = new RateLimiter(100, 60000); // 100 req/min
export const uploadLimiter = new RateLimiter(10, 60000); // 10 uploads/min
export const geocodingLimiter = new RateLimiter(50, 60000); // 50 geocode requests/min
