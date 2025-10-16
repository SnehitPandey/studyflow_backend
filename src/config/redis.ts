import Redis from 'ioredis';
import { env } from './env.js';
import type { Logger } from 'pino';

// This is the singleton instance
let redisInstance: Redis | null = null;

/**
 * Creates and returns a singleton Redis client instance.
 * Event listeners are attached only once.
 */
export const connectToRedis = (logger?: Logger): Redis => {
  if (!redisInstance) {
    // FIX: 'ioredis' is a default export, so this is the correct way to import and instantiate it.
    const redis = new Redis(env.REDIS_URL, {
      retryStrategy: (times) => Math.min(times * 50, 2000), // Standard retry strategy
      maxRetriesPerRequest: 3,
      lazyConnect: true, // Recommended: connect explicitly
      password: env.REDIS_PASSWORD, // Pass password directly (it's ok if it's undefined)
    });

    redis.on('connect', () => {
      logger?.info('✅ Connected to Redis');
    });

    redis.on('error', (err: Error) => {
      logger?.error({ error: err }, '❌ Redis connection error');
    });

    redis.on('close', () => {
      logger?.warn('⚠️ Redis connection closed');
    });

    // Explicitly connect and handle initial connection error
    redis.connect().catch((err: Error) => {
      logger?.fatal({ error: err }, '❌ Failed to establish initial Redis connection');
      // In a real app, you might want to process.exit(1) here if Redis is critical
    });

    redisInstance = redis;
  }

  return redisInstance;
};

/**
 * Disconnects the singleton Redis client.
 */
export const disconnectFromRedis = async (logger?: Logger): Promise<void> => {
  if (redisInstance) {
    await redisInstance.quit(); // Use quit for graceful shutdown
    redisInstance = null;
    logger?.info('Disconnected from Redis');
  }
};

// Export the instance itself for direct use if needed (optional)
export { redisInstance as redis };
