// The middleware itself, on a tiny standalone app rather than the real one -
// this proves the wiring (headers, 429 shape, anon-vs-user identifier
// resolution) with explicit small limits that bypass RATE_LIMIT_* env
// entirely, so it is unaffected by whatever that env is set to for the rest
// of the suite.
import { randomUUID } from 'node:crypto';
import express from 'express';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { rateLimit } from '../../src/middleware/rateLimit.js';
import { redis } from '../../src/lib/redis.js';

/**
 * Sets req.actor from a test-only header instead of a real JWT, so these
 * tests exercise rateLimit's authenticated branch without depending on
 * lib/tokens.js.
 */
function fakeActor(req: express.Request, _res: express.Response, next: express.NextFunction) {
  const userId = req.get('x-test-user');
  if (userId) req.actor = { id: userId, email: `${userId}@example.com` };
  next();
}

function buildApp(bucket: string, anonLimit: number, userLimit?: number): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(fakeActor);
  app.get('/probe', rateLimit({ bucket, anonLimit, userLimit }), (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

beforeAll(async () => {
  if (redis.status === 'ready') return;
  await new Promise<void>((resolve, reject) => {
    redis.once('ready', resolve);
    redis.once('error', reject);
  });
});

afterAll(async () => {
  await redis.quit();
});

describe('rateLimit middleware', () => {
  it('sets X-RateLimit-Limit and a decrementing X-RateLimit-Remaining', async () => {
    const app = buildApp(`mw-${randomUUID()}`, 3);

    const first = await request(app).get('/probe');
    const second = await request(app).get('/probe');

    expect(first.headers['x-ratelimit-limit']).toBe('3');
    expect(first.headers['x-ratelimit-remaining']).toBe('2');
    expect(second.headers['x-ratelimit-remaining']).toBe('1');
  });

  it('returns 429 with Retry-After once the limit is exceeded', async () => {
    const app = buildApp(`mw-${randomUUID()}`, 2);

    await request(app).get('/probe');
    await request(app).get('/probe');
    const third = await request(app).get('/probe');

    expect(third.status).toBe(429);
    expect(third.headers).toHaveProperty('retry-after');
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('reports the error through the standard envelope', async () => {
    const app = buildApp(`mw-${randomUUID()}`, 1);
    await request(app).get('/probe');

    const res = await request(app).get('/probe');

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
  });

  it('never lets X-RateLimit-Remaining go negative', async () => {
    const app = buildApp(`mw-${randomUUID()}`, 1);
    await request(app).get('/probe');

    const res = await request(app).get('/probe');

    expect(res.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('identifies an anonymous caller by ip', async () => {
    const app = buildApp(`mw-${randomUUID()}`, 1, 5);

    await request(app).get('/probe').set('X-Forwarded-For', '10.0.0.1');
    const secondFromSameIp = await request(app).get('/probe').set('X-Forwarded-For', '10.0.0.1');
    const fromDifferentIp = await request(app).get('/probe').set('X-Forwarded-For', '10.0.0.2');

    expect(secondFromSameIp.status).toBe(429);
    expect(fromDifferentIp.status).toBe(200);
  });

  it('identifies an authenticated caller by user id, not ip', async () => {
    // Same IP for both users: if identification fell back to ip, the second
    // user would inherit the first user's exhausted quota.
    const app = buildApp(`mw-${randomUUID()}`, 100, 1);

    const alice = await request(app)
      .get('/probe')
      .set('X-Forwarded-For', '10.0.0.5')
      .set('X-Test-User', 'alice');
    const aliceAgain = await request(app)
      .get('/probe')
      .set('X-Forwarded-For', '10.0.0.5')
      .set('X-Test-User', 'alice');
    const bob = await request(app)
      .get('/probe')
      .set('X-Forwarded-For', '10.0.0.5')
      .set('X-Test-User', 'bob');

    expect(alice.status).toBe(200);
    expect(aliceAgain.status).toBe(429);
    expect(bob.status).toBe(200);
  });

  it('draws the authenticated tier from a separate quota than the anonymous one', async () => {
    const app = buildApp(`mw-${randomUUID()}`, 1, 1);

    // Exhaust the anonymous bucket for this IP.
    await request(app).get('/probe').set('X-Forwarded-For', '10.0.0.9');
    const anonRejected = await request(app).get('/probe').set('X-Forwarded-For', '10.0.0.9');

    // The same IP, now authenticated, draws from its own untouched quota.
    const authed = await request(app)
      .get('/probe')
      .set('X-Forwarded-For', '10.0.0.9')
      .set('X-Test-User', 'carol');

    expect(anonRejected.status).toBe(429);
    expect(authed.status).toBe(200);
  });

  it('falls back to the other tier’s number when only one is configured', async () => {
    // /api/links is always behind requireAuth, so it never states an
    // anonLimit; /api/shorten is never authenticated, so it never states a
    // userLimit. Both still need a well-defined limit for the unreachable tier.
    const anonOnly = buildApp(`mw-${randomUUID()}`, 2);
    const userOnly = buildApp(`mw-${randomUUID()}`, 2);

    const res = await request(anonOnly).get('/probe');
    expect(res.headers['x-ratelimit-limit']).toBe('2');

    const authedRes = await request(userOnly).get('/probe').set('X-Test-User', 'dave');
    expect(authedRes.headers['x-ratelimit-limit']).toBe('2');
  });

  it('throws at setup time if neither limit is configured', () => {
    expect(() => rateLimit({ bucket: 'broken' })).toThrow(/needs at least one/);
  });
});
