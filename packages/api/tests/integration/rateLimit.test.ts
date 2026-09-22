// Confirms each real route is wired to its intended rate-limit bucket and
// tier. RATE_LIMIT_* is set very high in vitest.config.ts so
// the rest of the suite (which shares one IP across dozens of files) is
// unaffected; every test here uses its own X-Forwarded-For or fresh user so
// it is unaffected by that too. The sliding-window algorithm itself and the
// 429/Retry-After path are covered by tests/unit/rateLimiter.test.ts and
// tests/unit/rateLimitMiddleware.test.ts against small explicit limits.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/lib/prisma.js';
import { redis } from '../../src/lib/redis.js';

const app = createApp();

let ipCounter = 0;
/** A fresh, never-reused IP per test, so no test can inherit another's quota. */
function freshIp(): string {
  ipCounter += 1;
  return `10.99.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

async function registerFrom(ip: string) {
  const res = await request(app)
    .post('/api/auth/register')
    .set('X-Forwarded-For', ip)
    .send({ email: `${crypto.randomUUID()}@example.com`, password: 'correct-horse-battery' });
  expect(res.status, `register failed: ${JSON.stringify(res.body)}`).toBe(201);
  return res.body.accessToken as string;
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE users, links, clicks, refresh_tokens CASCADE');
  /**
   * Every test here uses a fresh, but deterministic, IP: freshIp()'s counter
   * always restarts at 1 for a new process. Two `pnpm vitest run`s of just
   * this file within the same real-world minute would otherwise generate the
   * identical identifier sequence and inherit the previous run's counts from
   * the same sliding window - which is exactly what happened while writing
   * this file. Flushing at the start of every test, not just once per file,
   * also protects the parallel-request tests below from window-boundary
   * timing rather than only from cross-run leakage.
   */
  const rateKeys = await redis.keys('rate:*');
  if (rateKeys.length > 0) await redis.del(...rateKeys);
});

afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE users, links, clicks, refresh_tokens CASCADE');
  await prisma.$disconnect();
  await redis.quit();
});

describe('POST /api/shorten - anonymous create tier', () => {
  it('reports the configured anon-create limit', async () => {
    const res = await request(app)
      .post('/api/shorten')
      .set('X-Forwarded-For', freshIp())
      .send({ url: 'https://example.com' });

    expect(res.headers['x-ratelimit-limit']).toBe(String(env.RATE_LIMIT_ANON_CREATE_PER_MINUTE));
  });

  it('decrements per IP independently', async () => {
    const ipA = freshIp();
    const ipB = freshIp();

    const first = await request(app)
      .post('/api/shorten')
      .set('X-Forwarded-For', ipA)
      .send({ url: 'https://example.com' });
    const second = await request(app)
      .post('/api/shorten')
      .set('X-Forwarded-For', ipA)
      .send({ url: 'https://example.com' });
    const otherIp = await request(app)
      .post('/api/shorten')
      .set('X-Forwarded-For', ipB)
      .send({ url: 'https://example.com' });

    const firstRemaining = Number(first.headers['x-ratelimit-remaining']);
    expect(Number(second.headers['x-ratelimit-remaining'])).toBe(firstRemaining - 1);
    expect(Number(otherIp.headers['x-ratelimit-remaining'])).toBe(firstRemaining);
  });
});

describe('GET /:shortCode - redirect tier', () => {
  async function seedLink(shortCode: string) {
    await prisma.link.create({ data: { shortCode, originalUrl: 'https://example.com/x' } });
  }

  it('reports the anonymous redirect limit with no Authorization header', async () => {
    await seedLink('rlk1');

    const res = await request(app).get('/rlk1').set('X-Forwarded-For', freshIp());

    // Status asserted too, not just the header: a header can be present on a
    // 404 as easily as a 302, so checking only the header would not confirm
    // the redirect actually happened.
    expect(res.status).toBe(302);
    expect(res.headers['x-ratelimit-limit']).toBe(String(env.RATE_LIMIT_ANON_REDIRECT_PER_MINUTE));
  });

  it('reports the higher authenticated redirect limit with a bearer token', async () => {
    await seedLink('rlk2');
    const token = await registerFrom(freshIp());

    const res = await request(app)
      .get('/rlk2')
      .set('X-Forwarded-For', freshIp())
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(302);
    expect(res.headers['x-ratelimit-limit']).toBe(String(env.RATE_LIMIT_USER_REDIRECT_PER_MINUTE));
  });

  it('draws the anonymous and authenticated tiers from separate quotas on the same ip', async () => {
    await seedLink('rlk3');
    const ip = freshIp();
    const token = await registerFrom(freshIp());

    const anon = await request(app).get('/rlk3').set('X-Forwarded-For', ip);
    const authed = await request(app)
      .get('/rlk3')
      .set('X-Forwarded-For', ip)
      .set('Authorization', `Bearer ${token}`);

    expect(anon.status).toBe(302);
    expect(authed.status).toBe(302);
    // Both first calls on their own tier: full quota minus one, not minus two.
    expect(Number(anon.headers['x-ratelimit-remaining'])).toBe(
      env.RATE_LIMIT_ANON_REDIRECT_PER_MINUTE - 1,
    );
    expect(Number(authed.headers['x-ratelimit-remaining'])).toBe(
      env.RATE_LIMIT_USER_REDIRECT_PER_MINUTE - 1,
    );
  });

  it('a malformed bearer token is treated as anonymous, not as an error', async () => {
    await seedLink('rlk4');

    const res = await request(app)
      .get('/rlk4')
      .set('X-Forwarded-For', freshIp())
      .set('Authorization', 'Bearer not-a-real-token');

    expect(res.status).toBe(302);
    expect(res.headers['x-ratelimit-limit']).toBe(String(env.RATE_LIMIT_ANON_REDIRECT_PER_MINUTE));
  });
});

describe('/api/links* - shared authenticated api tier', () => {
  it('reports the configured user-api limit', async () => {
    const token = await registerFrom(freshIp());

    const res = await request(app).get('/api/links').set('Authorization', `Bearer ${token}`);

    expect(res.headers['x-ratelimit-limit']).toBe(String(env.RATE_LIMIT_USER_API_PER_MINUTE));
  });

  it('is scoped per user, so a second user keeps a full quota', async () => {
    const tokenA = await registerFrom(freshIp());
    const tokenB = await registerFrom(freshIp());

    await request(app).get('/api/links').set('Authorization', `Bearer ${tokenA}`);
    const bRes = await request(app).get('/api/links').set('Authorization', `Bearer ${tokenB}`);

    expect(Number(bRes.headers['x-ratelimit-remaining'])).toBe(
      env.RATE_LIMIT_USER_API_PER_MINUTE - 1,
    );
  });

  it('shares one bucket across different /api/links routes for the same user', async () => {
    // Spec section 5.2 lists the same 50/min for every one of these routes -
    // one limit under several names, not several independent ones.
    const token = await registerFrom(freshIp());
    const auth = `Bearer ${token}`;

    const created = await request(app)
      .post('/api/links')
      .set('Authorization', auth)
      .send({ url: 'https://example.com' });
    const listed = await request(app).get('/api/links').set('Authorization', auth);
    const summary = await request(app)
      .get(`/api/links/${created.body.id}/analytics/summary`)
      .set('Authorization', auth);

    const createdRemaining = Number(created.headers['x-ratelimit-remaining']);
    expect(Number(listed.headers['x-ratelimit-remaining'])).toBe(createdRemaining - 1);
    expect(Number(summary.headers['x-ratelimit-remaining'])).toBe(createdRemaining - 2);
  });

  it('rejects an unauthenticated call before it ever reaches the limiter', async () => {
    const res = await request(app).get('/api/links');

    expect(res.status).toBe(401);
    expect(res.headers).not.toHaveProperty('x-ratelimit-limit');
  });
});

describe('POST /api/links - per-IP create budget across accounts', () => {
  async function createFrom(ip: string, token: string) {
    return request(app)
      .post('/api/links')
      .set('X-Forwarded-For', ip)
      .set('Authorization', `Bearer ${token}`)
      .send({ url: 'https://example.com' });
  }

  it('charges one IP for creates made by different accounts', async () => {
    const ip = freshIp();
    const tokenA = await registerFrom(freshIp());
    const tokenB = await registerFrom(freshIp());

    const first = await createFrom(ip, tokenA);
    const second = await createFrom(ip, tokenB);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    // Read the bucket directly: the response headers report the tighter of
    // the two limiters on this route, which is not necessarily this one.
    const keys = await redis.keys(`rate:create-ip:ip:${ip}:*`);
    expect(keys.length).toBeGreaterThan(0);
    const counts = await Promise.all(keys.map((k) => redis.get(k)));
    expect(counts.map(Number).reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('does not charge a different IP', async () => {
    const token = await registerFrom(freshIp());
    const ipA = freshIp();
    const ipB = freshIp();

    await createFrom(ipA, token);
    await createFrom(ipB, token);

    const keysB = await redis.keys(`rate:create-ip:ip:${ipB}:*`);
    const counts = await Promise.all(keysB.map((k) => redis.get(k)));
    expect(counts.map(Number).reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe('/api/auth/* - shared auth tier', () => {
  it('reports the configured auth limit on register', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('X-Forwarded-For', freshIp())
      .send({ email: `${crypto.randomUUID()}@example.com`, password: 'correct-horse-battery' });

    expect(res.headers['x-ratelimit-limit']).toBe(String(env.RATE_LIMIT_AUTH_PER_MINUTE));
  });

  it('shares the bucket between register and login for the same ip', async () => {
    const ip = freshIp();
    const email = `${crypto.randomUUID()}@example.com`;

    const registered = await request(app)
      .post('/api/auth/register')
      .set('X-Forwarded-For', ip)
      .send({ email, password: 'correct-horse-battery' });
    const loggedIn = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email, password: 'correct-horse-battery' });

    expect(Number(loggedIn.headers['x-ratelimit-remaining'])).toBe(
      Number(registered.headers['x-ratelimit-remaining']) - 1,
    );
  });

  it('does not rate limit logout', async () => {
    // Logout has nothing worth protecting against brute force.
    const res = await request(app).post('/api/auth/logout').set('X-Forwarded-For', freshIp());

    expect(res.headers).not.toHaveProperty('x-ratelimit-limit');
  });
});
