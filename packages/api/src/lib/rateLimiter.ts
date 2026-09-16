import type { ClientContext } from 'ioredis';
import { redis } from './redis.js';
import { logger } from './logger.js';

/**
 * Sliding Window Counter rate limiter.
 *
 * Approximates a true sliding window by blending two fixed windows: the
 * current one exactly, the previous one weighted by how much of it still
 * overlaps the trailing window ending now. A caller who maxed out the tail of
 * the previous window is still bounded, unlike a plain fixed-window counter
 * that lets them burst again the instant the clock ticks over.
 *
 * KEYS[1] = current window counter key
 * KEYS[2] = previous window counter key
 * ARGV[1] = limit (max requests per window)
 * ARGV[2] = elapsed fraction of the current window, 0..1
 * ARGV[3] = key TTL in seconds (must outlive two windows)
 *
 * Returns { allowed 0|1, weighted count rounded to the nearest integer }.
 *
 * Embedded as a string and loaded once via defineCommand, rather than kept as
 * a .lua file: a separate file needs a copy step in the tsc build, in tsx dev
 * mode, and in the Dockerfile, just to save a few lines of syntax highlighting.
 *
 * Runs as one EVALSHA round trip. Split into a GET, a compare, and a
 * conditional INCR from Node, two concurrent requests could both read the
 * count just under the limit and both be allowed - this script closes that
 * race by making the whole decision atomic on the Redis side.
 */
const SLIDING_WINDOW_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local previous = tonumber(redis.call('GET', KEYS[2]) or '0')
local limit = tonumber(ARGV[1])
local elapsed = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

local weighted = previous * (1 - elapsed) + current

if weighted >= limit then
  return { 0, math.floor(weighted + 0.5) }
end

current = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ttl)

return { 1, math.floor(weighted + 0.5) + 1 }
`;

declare module 'ioredis' {
  // The generic parameter must match ioredis's own declaration exactly - name,
  // constraint and default - or TypeScript rejects the merge (TS2428) and
  // every other RedisCommander method silently stops resolving, not just
  // this one. ClientContext is ioredis's own type for that constraint.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Context's name is fixed by the merge requirement above, not a free choice
  interface RedisCommander<Context extends ClientContext = { type: 'default' }> {
    slidingWindowRateLimit(
      currentKey: string,
      previousKey: string,
      limit: number,
      elapsed: number,
      ttlSeconds: number,
    ): Promise<[allowed: number, count: number]>;
  }
}

redis.defineCommand('slidingWindowRateLimit', {
  numberOfKeys: 2,
  lua: SLIDING_WINDOW_SCRIPT,
});

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  /** Estimated requests counted in the trailing window, including this one if allowed. */
  count: number;
  /** Seconds until the caller should retry. Only meaningful when rejected. */
  retryAfterSeconds: number;
}

/**
 * Consumes one request against a bucket's sliding window.
 *
 * Fails open on a Redis error: rate limiting exists to protect Redis and
 * Postgres from abusive load, so a caller cannot be blocked by the failure of
 * the very dependency the limit is meant to protect. The same trade-off
 * cacheService makes - see its module comment.
 */
export async function consumeRateLimit(
  bucket: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const windowIndex = Math.floor(now / windowMs);
  const elapsed = (now - windowIndex * windowMs) / windowMs;

  const currentKey = `rate:${bucket}:${identifier}:${windowIndex}`;
  const previousKey = `rate:${bucket}:${identifier}:${windowIndex - 1}`;
  // Must outlive two windows so the previous key is still there when the next
  // window reads it as its "previous".
  const ttl = windowSeconds * 2;

  try {
    const [allowed, count] = await redis.slidingWindowRateLimit(
      currentKey,
      previousKey,
      limit,
      elapsed,
      ttl,
    );

    const isAllowed = allowed === 1;

    return {
      allowed: isAllowed,
      limit,
      count,
      // 0 when allowed: unambiguously "not applicable", so a caller cannot
      // set a Retry-After header without checking `allowed` first. Otherwise
      // approximate - the current window's remaining time, rounded up - which
      // is exact enough for a hint without tracking per-request timestamps.
      retryAfterSeconds: isAllowed ? 0 : Math.max(1, Math.ceil(windowSeconds * (1 - elapsed))),
    };
  } catch (error) {
    logger.warn({ err: error, bucket, identifier }, 'rate limit check failed, failing open');
    return { allowed: true, limit, count: 0, retryAfterSeconds: 0 };
  }
}
