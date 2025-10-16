import rateLimit from 'express-rate-limit';
import { connectToRedis } from '../config/redis.js';
import type { Request, Response } from 'express';

// Redis store for rate limiting
class RedisRateLimitStore {
  private redis = connectToRedis();
  private keyGenerator: (req: Request) => string;
  private windowMs: number;

  constructor(keyGenerator: (req: Request) => string, windowMs: number) {
    this.keyGenerator = keyGenerator;
    this.windowMs = windowMs;
  }

  async increment(req: Request): Promise<{ totalHits: number; resetTime?: Date }> {
    const key = `rate-limit:${this.keyGenerator(req)}`;
    const windowStart = Math.floor(Date.now() / this.windowMs) * this.windowMs;
    const windowKey = `${key}:${windowStart}`;

    try {
      const count = await this.redis.incr(windowKey);
      
      // Set expiration on first request in window
      if (count === 1) {
        await this.redis.expire(windowKey, Math.ceil(this.windowMs / 1000));
      }

      const resetTime = new Date(windowStart + this.windowMs);
      
      return {
        totalHits: count,
        resetTime,
      };
    } catch (error) {
      // If Redis fails, allow the request
      console.error('Rate limiting Redis error:', error);
      return { totalHits: 1 };
    }
  }

  async decrement(req: Request): Promise<void> {
    // Not implemented for sliding window, but required by interface
  }

  async resetAll(): Promise<void> {
    // Not needed for our implementation
  }
}

// AI-specific rate limiter with higher restrictions
export const aiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each user to 20 AI requests per windowMs
  message: {
    error: 'Too many AI requests',
    message: 'You have exceeded the AI request limit. Please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    // Use user ID if authenticated, otherwise IP
    return req.user?.id || req.ip;
  },
  store: new RedisRateLimitStore(
    (req: Request) => req.user?.id || req.ip,
    15 * 60 * 1000
  ) as any,
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: 'Rate limit exceeded',
      message: 'Too many AI requests. Please try again later.',
      retryAfter: res.get('Retry-After'),
      limit: res.get('X-RateLimit-Limit'),
      remaining: res.get('X-RateLimit-Remaining'),
      reset: res.get('X-RateLimit-Reset'),
    });
  },
});

// General API rate limiter (more permissive)
export const generalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests',
    message: 'You have made too many requests. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.ip,
});
