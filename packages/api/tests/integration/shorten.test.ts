import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { GUEST_LINK_TTL_HOURS, SHORT_CODE_LENGTH } from '@linkpulse/shared';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { redis } from '../../src/lib/redis.js';

const app = createApp();

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE users, links, clicks CASCADE');
});

afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE users, links, clicks CASCADE');
  await prisma.$disconnect();
  await redis.quit();
});

describe('POST /api/shorten', () => {
  it('creates a link and returns the resolvable short url', async () => {
    const res = await request(app)
      .post('/api/shorten')
      .send({ url: 'https://example.com/a/very/long/path?with=params' });

    expect(res.status).toBe(201);
    expect(res.body.shortCode).toHaveLength(SHORT_CODE_LENGTH);
    expect(res.body.originalUrl).toBe('https://example.com/a/very/long/path?with=params');
    expect(res.body.clickCount).toBe(0);
    expect(res.body.isActive).toBe(true);
    expect(res.body.shortUrl).toBe(`http://localhost:4000/${res.body.shortCode}`);
  });

  it('produces a code that immediately redirects', async () => {
    const created = await request(app)
      .post('/api/shorten')
      .send({ url: 'https://example.com/target' });

    const redirected = await request(app).get(`/${created.body.shortCode}`);

    expect(redirected.status).toBe(302);
    expect(redirected.headers.location).toBe('https://example.com/target');
  });

  it('expires a guest link after the guest TTL', async () => {
    const res = await request(app).post('/api/shorten').send({ url: 'https://example.com' });

    const expiresAt = new Date(res.body.expiresAt).getTime();
    const expected = Date.now() + GUEST_LINK_TTL_HOURS * 60 * 60 * 1000;
    // Generous window: this asserts "about 24 hours", not a precise instant.
    expect(Math.abs(expiresAt - expected)).toBeLessThan(60_000);
  });

  it('leaves the link unowned, since guests have no account', async () => {
    const res = await request(app).post('/api/shorten').send({ url: 'https://example.com' });

    const row = await prisma.link.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.userId).toBeNull();
    expect(row.isCustom).toBe(false);
  });

  it('ignores a customAlias a guest tries to claim', async () => {
    const res = await request(app)
      .post('/api/shorten')
      .send({ url: 'https://example.com', customAlias: 'premium-name' });

    expect(res.status).toBe(201);
    expect(res.body.shortCode).not.toBe('premium-name');
    expect(res.body.shortCode).toHaveLength(SHORT_CODE_LENGTH);
  });

  it('gives every request a distinct code', async () => {
    const codes = await Promise.all(
      Array.from({ length: 25 }, () =>
        request(app)
          .post('/api/shorten')
          .send({ url: 'https://example.com' })
          .then((res) => res.body.shortCode),
      ),
    );

    expect(new Set(codes).size).toBe(25);
  });

  it.each([
    ['a non-http scheme', 'javascript:alert(1)'],
    ['a relative path', '/not/absolute'],
    ['a bare hostname', 'example.com'],
    ['an empty string', ''],
  ])('rejects %s with a field-level error', async (_label, url) => {
    const res = await request(app).post('/api/shorten').send({ url });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toHaveProperty('url');
  });

  it('rejects a missing body', async () => {
    const res = await request(app).post('/api/shorten').send({});

    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty('url');
  });

  it('refuses a url on the blocklist', async () => {
    const res = await request(app)
      .post('/api/shorten')
      .send({ url: 'https://testsafebrowsing.appspot.com/s/malware.html' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/blocklist/i);
  });
});
