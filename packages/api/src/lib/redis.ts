import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Redis is a cache and a rate-limit store, never a source of truth. Every call
 * site must survive it being unavailable by falling through to Postgres.
 *
 * Hence the aggressive failure settings: a redirect that waits on a dead Redis
 * is strictly worse than one that skips the cache and queries the database.
 */
export const redis = new Redis(env.REDIS_URL, {
  // Fail a command instead of buffering it while disconnected.
  enableOfflineQueue: false,
  // One retry, then surface the error to the caller.
  maxRetriesPerRequest: 1,
  connectTimeout: 1000,
  // Cap reconnect backoff so a long outage does not leave us idle for minutes.
  retryStrategy: (attempt) => Math.min(attempt * 200, 3000),
});

redis.on('error', (error: Error) => {
  // Logged at warn, not error: a cache outage is degraded service, not an outage.
  logger.warn({ err: error }, 'redis error');
});

redis.on('connect', () => {
  logger.info('redis connected');
});

/** True when Redis is reachable. Used by the readiness probe. */
export async function pingRedis(): Promise<boolean> {
  try {
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
}
