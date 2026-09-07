import { URL_CACHE_TTL_SECONDS } from '@linkpulse/shared';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';

/** What the redirect path needs: where to send the visitor, and what to bill the click to. */
export interface CachedLink {
  id: string;
  originalUrl: string;
}

/**
 * Why absent links are cached too.
 *
 * Caching only successful lookups leaves a hole: a client hammering random
 * codes misses on every request and lands every one of them on Postgres. That
 * is cache penetration, and it turns a cheap 404 into the most expensive route
 * on the service. Storing the negative result bounds that to one query per
 * code per minute.
 *
 * "Missing" and "gone" are stored separately so the cached answer keeps the
 * distinction between 404 and 410 rather than flattening both.
 */
type CachedState = { s: 'missing' } | { s: 'gone' };
type CachedPayload = { u: string; i: string } | CachedState;

export type CacheLookup =
  | { state: 'hit'; link: CachedLink }
  | { state: 'missing' }
  | { state: 'gone' }
  /** Nothing cached; the caller must consult Postgres. */
  | { state: 'uncached' };

/** Absent-link entries expire fast, so fixing a link is visible within a minute. */
const NEGATIVE_TTL_SECONDS = 60;

const cacheKey = (shortCode: string): string => `url:${shortCode}`;

/**
 * Seconds an entry may live: the standard TTL, shortened when the link expires
 * sooner, so an expired link is never served from cache after its expiry.
 */
function resolveTtl(expiresAt: Date | null): number {
  if (!expiresAt) return URL_CACHE_TTL_SECONDS;
  const secondsUntilExpiry = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  return Math.min(URL_CACHE_TTL_SECONDS, secondsUntilExpiry);
}

export async function getCachedLink(shortCode: string): Promise<CacheLookup> {
  let raw: string | null;

  try {
    raw = await redis.get(cacheKey(shortCode));
  } catch (error) {
    // Redis is a cache, not a source of truth: degrade to a database read.
    logger.warn({ err: error, shortCode }, 'cache read failed');
    return { state: 'uncached' };
  }

  if (raw === null) return { state: 'uncached' };

  let payload: CachedPayload;
  try {
    payload = JSON.parse(raw) as CachedPayload;
  } catch {
    // A corrupt entry should not break the request; treat it as a miss.
    logger.warn({ shortCode }, 'discarding unparseable cache entry');
    void invalidateLink(shortCode);
    return { state: 'uncached' };
  }

  if ('s' in payload) {
    return payload.s === 'gone' ? { state: 'gone' } : { state: 'missing' };
  }

  return { state: 'hit', link: { id: payload.i, originalUrl: payload.u } };
}

export async function cacheLink(
  shortCode: string,
  link: CachedLink,
  expiresAt: Date | null,
): Promise<void> {
  const ttl = resolveTtl(expiresAt);
  // Already expired: there is nothing worth caching.
  if (ttl <= 0) return;

  const payload: CachedPayload = { u: link.originalUrl, i: link.id };
  await write(shortCode, payload, ttl);
}

/** Records that a code resolves to nothing, so repeats do not reach Postgres. */
export async function cacheMissingLink(shortCode: string): Promise<void> {
  await write(shortCode, { s: 'missing' }, NEGATIVE_TTL_SECONDS);
}

/** Records that a code exists but is disabled or expired: a cached 410. */
export async function cacheGoneLink(shortCode: string): Promise<void> {
  await write(shortCode, { s: 'gone' }, NEGATIVE_TTL_SECONDS);
}

/**
 * Drops an entry. Called whenever a link's destination, active flag or expiry
 * changes, since the cached copy would otherwise keep serving the old answer
 * for up to an hour.
 */
export async function invalidateLink(shortCode: string): Promise<void> {
  try {
    await redis.del(cacheKey(shortCode));
  } catch (error) {
    logger.warn({ err: error, shortCode }, 'cache invalidation failed');
  }
}

async function write(shortCode: string, payload: CachedPayload, ttl: number): Promise<void> {
  try {
    await redis.set(cacheKey(shortCode), JSON.stringify(payload), 'EX', ttl);
  } catch (error) {
    // A failed write costs a database read next time; it is not a request error.
    logger.warn({ err: error, shortCode }, 'cache write failed');
  }
}
