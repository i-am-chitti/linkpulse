// The sliding-window algorithm itself, against real Redis. Explicit small
// limits and a fresh, randomised bucket per test, so this suite is immune to
// whatever the ambient RATE_LIMIT_* env is set to for everything else.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { consumeRateLimit } from '../../src/lib/rateLimiter.js';
import { redis } from '../../src/lib/redis.js';

/** A bucket+identifier pair no other test can collide with. */
function freshBucket() {
  return { bucket: `test-${randomUUID()}`, identifier: 'probe' };
}

/**
 * Every other test file's beforeEach does an async Postgres round trip before
 * ever touching Redis, which happens to give the connection time to finish
 * its handshake. This file's first action is a direct consumeRateLimit call,
 * so without this it can race the connection: enableOfflineQueue is false
 * (see redis.ts), so a command issued before 'ready' is rejected outright
 * rather than queued.
 */
beforeAll(async () => {
  if (redis.status === 'ready') return;
  await new Promise<void>((resolve, reject) => {
    redis.once('ready', resolve);
    redis.once('error', reject);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await redis.quit();
});

describe('consumeRateLimit', () => {
  it('allows requests up to the limit and rejects the next one', async () => {
    const { bucket, identifier } = freshBucket();

    const results = await Promise.all(
      Array.from({ length: 3 }, () => consumeRateLimit(bucket, identifier, 3, 60)),
    );
    // Sequentially, so the 4th definitely observes the first 3 committed.
    const fourth = await consumeRateLimit(bucket, identifier, 3, 60);

    expect(results.every((r) => r.allowed)).toBe(true);
    expect(fourth.allowed).toBe(false);
  });

  it('is atomic under concurrent requests, admitting exactly the limit', async () => {
    // The reason this runs through a Lua script rather than GET-then-INCR
    // from Node: that would race, and concurrent callers could all read the
    // count just under the limit and all be let through.
    const { bucket, identifier } = freshBucket();

    const results = await Promise.all(
      Array.from({ length: 25 }, () => consumeRateLimit(bucket, identifier, 10, 60)),
    );

    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    expect(results.filter((r) => !r.allowed)).toHaveLength(15);
  });

  it('keeps separate buckets fully independent', async () => {
    const a = freshBucket();
    const b = freshBucket();

    for (let i = 0; i < 3; i += 1) await consumeRateLimit(a.bucket, a.identifier, 3, 60);
    const bResult = await consumeRateLimit(b.bucket, b.identifier, 3, 60);

    expect(bResult.allowed).toBe(true);
  });

  it('keeps separate identifiers in the same bucket independent', async () => {
    const { bucket } = freshBucket();

    for (let i = 0; i < 3; i += 1) await consumeRateLimit(bucket, 'alice', 3, 60);
    const bob = await consumeRateLimit(bucket, 'bob', 3, 60);

    expect(bob.allowed).toBe(true);
  });

  it('reports a positive Retry-After only once rejected', async () => {
    const { bucket, identifier } = freshBucket();

    const allowed = await consumeRateLimit(bucket, identifier, 1, 60);
    const rejected = await consumeRateLimit(bucket, identifier, 1, 60);

    expect(allowed.retryAfterSeconds).toBe(0);
    expect(rejected.retryAfterSeconds).toBeGreaterThan(0);
    expect(rejected.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('blends the previous window in proportion to its remaining overlap', async () => {
    // This is the property that makes it a *sliding* window rather than a
    // plain fixed one: a caller who maxed out the tail of the previous
    // window should still be bounded just after the clock ticks over, not
    // handed a fresh quota.
    const { bucket, identifier } = freshBucket();
    const windowSeconds = 60;
    const windowMs = windowSeconds * 1000;

    // Land 100ms into a window: the previous window is still ~98% weighted.
    const windowIndex = 1_000; // arbitrary, deterministic
    const now = windowIndex * windowMs + 100;
    vi.useFakeTimers();
    vi.setSystemTime(now);

    // Seed the previous window well past the limit, so the blend blocks with
    // margin regardless of exactly how many ms into the window "now" lands.
    await redis.set(`rate:${bucket}:${identifier}:${windowIndex - 1}`, '10', 'EX', 120);

    const result = await consumeRateLimit(bucket, identifier, 5, windowSeconds);

    expect(result.allowed).toBe(false);
  });

  it('lets the full quota back in once the previous window has decayed away', async () => {
    const { bucket, identifier } = freshBucket();
    const windowSeconds = 60;
    const windowMs = windowSeconds * 1000;
    const windowIndex = 2_000;

    // Land just before the window ends: the previous window's weight is ~0.
    const now = windowIndex * windowMs + windowMs - 100;
    vi.useFakeTimers();
    vi.setSystemTime(now);

    await redis.set(`rate:${bucket}:${identifier}:${windowIndex - 1}`, '5', 'EX', 120);

    const result = await consumeRateLimit(bucket, identifier, 5, windowSeconds);

    expect(result.allowed).toBe(true);
  });

  it('fails open when Redis errors, rather than blocking real traffic', async () => {
    // Rate limiting exists to protect Redis/Postgres from abusive load; a
    // caller cannot be blocked by the failure of the dependency the limit
    // itself relies on. Mirrors cacheService's failure philosophy.
    const { bucket, identifier } = freshBucket();
    const spy = vi
      .spyOn(redis, 'slidingWindowRateLimit')
      .mockRejectedValueOnce(new Error('redis is down'));

    const result = await consumeRateLimit(bucket, identifier, 1, 60);

    expect(result.allowed).toBe(true);
    spy.mockRestore();
  });
});
