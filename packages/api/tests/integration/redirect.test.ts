// Covers the redirect hot path end to end against real Redis and Postgres,
// since the behaviour worth testing is the interaction between them: what gets
// cached, what does not, and what happens when the cache disagrees with the
// database.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { redis } from '../../src/lib/redis.js';

const app = createApp();

const cacheKey = (shortCode: string) => `url:${shortCode}`;

async function seedLink(
  overrides: Partial<{
    shortCode: string;
    originalUrl: string;
    isActive: boolean;
    expiresAt: Date | null;
  }> = {},
) {
  return prisma.link.create({
    data: {
      shortCode: overrides.shortCode ?? 'hot1234',
      originalUrl: overrides.originalUrl ?? 'https://example.com/destination',
      isActive: overrides.isActive ?? true,
      expiresAt: overrides.expiresAt ?? null,
    },
  });
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE users, links, clicks CASCADE');
  // Only this suite's keys, so a parallel dev server's cache survives.
  const keys = await redis.keys('url:*');
  if (keys.length > 0) await redis.del(...keys);
});

afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE users, links, clicks CASCADE');
  await prisma.$disconnect();
  await redis.quit();
});

describe('GET /:shortCode', () => {
  it('redirects to the destination with 302', async () => {
    await seedLink();

    const res = await request(app).get('/hot1234');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.com/destination');
  });

  it('forbids caching the redirect, so every click still reaches us', async () => {
    // A cacheable redirect would freeze the destination and stop click counting.
    await seedLink();

    const res = await request(app).get('/hot1234');

    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('populates the cache on a database read', async () => {
    const link = await seedLink();
    expect(await redis.get(cacheKey('hot1234'))).toBeNull();

    await request(app).get('/hot1234');

    const cached = await redis.get(cacheKey('hot1234'));
    expect(cached).not.toBeNull();
    expect(JSON.parse(cached!)).toEqual({
      u: 'https://example.com/destination',
      i: link.id,
    });
  });

  it('serves from cache without consulting the database', async () => {
    await seedLink();
    await request(app).get('/hot1234'); // warms the cache

    // Delete the row outright: a response now can only have come from Redis.
    await prisma.link.deleteMany({});

    const res = await request(app).get('/hot1234');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.com/destination');
  });

  it('gives the cached entry a TTL rather than leaving it forever', async () => {
    await seedLink();
    await request(app).get('/hot1234');

    const ttl = await redis.ttl(cacheKey('hot1234'));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(3600);
  });

  it('shortens the cache TTL to a link’s own expiry', async () => {
    // Otherwise a link expiring in 5 minutes would keep redirecting for an hour.
    await seedLink({ shortCode: 'soon123', expiresAt: new Date(Date.now() + 120_000) });

    await request(app).get('/soon123');

    const ttl = await redis.ttl(cacheKey('soon123'));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120);
  });
});

describe('GET /:shortCode when the link cannot be served', () => {
  it('404s an unknown code', async () => {
    const res = await request(app).get('/nosuch1');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('caches the absence, so a scanner cannot hammer Postgres', async () => {
    await request(app).get('/nosuch1');

    expect(JSON.parse((await redis.get(cacheKey('nosuch1')))!)).toEqual({ s: 'missing' });
    // Short TTL: creating this code shortly after must start working.
    const ttl = await redis.ttl(cacheKey('nosuch1'));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it('410s a deactivated link', async () => {
    await seedLink({ shortCode: 'off1234', isActive: false });

    const res = await request(app).get('/off1234');

    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('GONE');
  });

  it('410s an expired link', async () => {
    await seedLink({ shortCode: 'old1234', expiresAt: new Date(Date.now() - 1000) });

    const res = await request(app).get('/old1234');

    expect(res.status).toBe(410);
  });

  it('keeps 404 and 410 distinct through the cache', async () => {
    // A single negative sentinel would flatten these into one answer.
    await seedLink({ shortCode: 'off1234', isActive: false });

    await request(app).get('/off1234');
    await request(app).get('/nosuch1');

    expect(JSON.parse((await redis.get(cacheKey('off1234')))!)).toEqual({ s: 'gone' });
    expect(JSON.parse((await redis.get(cacheKey('nosuch1')))!)).toEqual({ s: 'missing' });

    expect((await request(app).get('/off1234')).status).toBe(410);
    expect((await request(app).get('/nosuch1')).status).toBe(404);
  });

  it.each(['/ab', '/favicon.ico', '/has%20space', `/${'a'.repeat(40)}`])(
    'rejects the malformed path %s without caching anything',
    async (path) => {
      const res = await request(app).get(path);

      expect(res.status).toBe(404);
      // The format gate runs before any I/O, so no key should exist.
      expect(await redis.keys('url:*')).toEqual([]);
    },
  );

  it('does not shadow /health, which is also a single segment', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
