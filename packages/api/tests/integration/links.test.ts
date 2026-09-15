// Owner-scoped link CRUD. The two things worth testing hardest are that one
// user can never touch another's links, and that every mutation drops the
// cached copy the redirect path reads.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { redis } from '../../src/lib/redis.js';

const app = createApp();

const cacheKey = (shortCode: string) => `url:${shortCode}`;

interface Actor {
  token: string;
  userId: string;
}

/**
 * Both helpers assert their own success.
 *
 * Without this, a failed setup call yields an error body with no id or token,
 * and the test fails much later with a bewildering 404 from a request built
 * out of `undefined`. Asserting here names the actual cause.
 */
async function signUp(email: string): Promise<Actor> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'correct-horse-battery' });

  expect(res.status, `signUp(${email}) failed: ${JSON.stringify(res.body)}`).toBe(201);

  return { token: res.body.accessToken, userId: res.body.user.id };
}

function asActor(actor: Actor) {
  return (req: request.Test) => req.set('Authorization', `Bearer ${actor.token}`);
}

/** Creates a link and asserts it worked. Use createLinkRaw to test failures. */
async function createLink(actor: Actor, body: Record<string, unknown>) {
  const res = await createLinkRaw(actor, body);
  expect(res.status, `createLink failed: ${JSON.stringify(res.body)}`).toBe(201);
  return res;
}

/** Creates a link without asserting, for the tests that expect a rejection. */
async function createLinkRaw(actor: Actor, body: Record<string, unknown>) {
  return asActor(actor)(request(app).post('/api/links')).send(body);
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE users, links, clicks, refresh_tokens CASCADE');
  const cached = await redis.keys('url:*');
  if (cached.length > 0) await redis.del(...cached);
});

afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE users, links, clicks, refresh_tokens CASCADE');
  await prisma.$disconnect();
  await redis.quit();
});

describe('authentication', () => {
  it.each([
    ['GET', '/api/links'],
    ['POST', '/api/links'],
    ['GET', '/api/links/01a0821f-a782-750e-b849-79ebacbbc6d2'],
    ['PATCH', '/api/links/01a0821f-a782-750e-b849-79ebacbbc6d2'],
    ['DELETE', '/api/links/01a0821f-a782-750e-b849-79ebacbbc6d2'],
  ])('rejects an anonymous %s %s', async (method, path) => {
    const res = await request(app)[method.toLowerCase() as 'get'](path);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/links', () => {
  it('creates a link owned by the caller', async () => {
    const actor = await signUp('owner@example.com');

    const res = await createLink(actor, { url: 'https://example.com/mine' });

    expect(res.status).toBe(201);
    const row = await prisma.link.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.userId).toBe(actor.userId);
  });

  it('does not expire an owned link by default, unlike a guest link', async () => {
    const actor = await signUp('owner@example.com');

    const res = await createLink(actor, { url: 'https://example.com/mine' });

    expect(res.body.expiresAt).toBeNull();
  });

  it('honours a custom alias and records that it was chosen', async () => {
    const actor = await signUp('owner@example.com');

    const res = await createLink(actor, {
      url: 'https://example.com/portfolio',
      customAlias: 'my-portfolio',
    });

    expect(res.status).toBe(201);
    expect(res.body.shortCode).toBe('my-portfolio');
    expect(res.body.shortUrl).toBe('http://localhost:4000/my-portfolio');
    const row = await prisma.link.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.isCustom).toBe(true);
  });

  it('makes a custom alias immediately redirect', async () => {
    const actor = await signUp('owner@example.com');
    await createLink(actor, { url: 'https://example.com/x', customAlias: 'go-here' });

    const res = await request(app).get('/go-here');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.com/x');
  });

  it('409s a taken alias rather than silently generating another code', async () => {
    const first = await signUp('first@example.com');
    const second = await signUp('second@example.com');
    await createLinkRaw(first, { url: 'https://example.com/a', customAlias: 'taken' });

    const res = await createLinkRaw(second, { url: 'https://example.com/b', customAlias: 'taken' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('refuses an alias that would shadow a real route', async () => {
    const actor = await signUp('owner@example.com');

    const res = await createLinkRaw(actor, { url: 'https://example.com', customAlias: 'health' });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty('customAlias');
  });

  it('accepts a future expiry', async () => {
    const actor = await signUp('owner@example.com');
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();

    const res = await createLink(actor, { url: 'https://example.com', expiresAt });

    expect(res.status).toBe(201);
    expect(new Date(res.body.expiresAt).getTime()).toBeCloseTo(new Date(expiresAt).getTime(), -3);
  });

  it('rejects a past expiry, which would create a dead link', async () => {
    const actor = await signUp('owner@example.com');

    const res = await createLinkRaw(actor, {
      url: 'https://example.com',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    expect(res.status).toBe(400);
  });

  it('rejects a non-http destination', async () => {
    const actor = await signUp('owner@example.com');

    const res = await createLinkRaw(actor, { url: 'javascript:alert(1)' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/links', () => {
  async function seedLinks(actor: Actor, count: number) {
    for (let i = 0; i < count; i += 1) {
      await createLink(actor, {
        url: `https://example.com/page-${i}`,
        customAlias: `alias-${String(i).padStart(2, '0')}`,
      });
    }
  }

  it('returns only the caller’s links', async () => {
    const mine = await signUp('mine@example.com');
    const theirs = await signUp('theirs@example.com');
    await createLink(mine, { url: 'https://example.com/mine' });
    await createLink(theirs, { url: 'https://example.com/theirs' });

    const res = await asActor(mine)(request(app).get('/api/links'));

    expect(res.body.total).toBe(1);
    expect(res.body.items[0].originalUrl).toBe('https://example.com/mine');
  });

  it('paginates, newest first', async () => {
    const actor = await signUp('owner@example.com');
    await seedLinks(actor, 25);

    const first = await asActor(actor)(request(app).get('/api/links?page=1&pageSize=10'));
    const last = await asActor(actor)(request(app).get('/api/links?page=3&pageSize=10'));

    expect(first.body).toMatchObject({ page: 1, pageSize: 10, total: 25, totalPages: 3 });
    expect(first.body.items).toHaveLength(10);
    // Newest first: alias-24 was created last.
    expect(first.body.items[0].shortCode).toBe('alias-24');
    expect(last.body.items).toHaveLength(5);
  });

  it('reports one page when the owner has no links', async () => {
    const actor = await signUp('owner@example.com');

    const res = await asActor(actor)(request(app).get('/api/links'));

    expect(res.body).toMatchObject({ total: 0, totalPages: 1, items: [] });
  });

  it('caps pageSize so a client cannot request the whole table', async () => {
    const actor = await signUp('owner@example.com');

    const res = await asActor(actor)(request(app).get('/api/links?pageSize=5000'));

    expect(res.status).toBe(400);
  });

  it('searches the destination url and the short code', async () => {
    const actor = await signUp('owner@example.com');
    await createLink(actor, { url: 'https://github.com/deepak', customAlias: 'gh-profile' });
    await createLink(actor, { url: 'https://example.com/other', customAlias: 'other-one' });

    const byUrl = await asActor(actor)(request(app).get('/api/links?search=github'));
    const byCode = await asActor(actor)(request(app).get('/api/links?search=gh-pro'));

    expect(byUrl.body.total).toBe(1);
    expect(byCode.body.total).toBe(1);
    expect(byCode.body.items[0].shortCode).toBe('gh-profile');
  });

  it('searches case-insensitively', async () => {
    const actor = await signUp('owner@example.com');
    await createLink(actor, { url: 'https://GitHub.com/deepak' });

    const res = await asActor(actor)(request(app).get('/api/links?search=github'));

    expect(res.body.total).toBe(1);
  });

  it('filters by active status', async () => {
    const actor = await signUp('owner@example.com');
    const kept = await createLink(actor, { url: 'https://example.com/on' });
    const disabled = await createLink(actor, { url: 'https://example.com/off' });
    await asActor(actor)(request(app).patch(`/api/links/${disabled.body.id}`)).send({
      isActive: false,
    });

    const active = await asActor(actor)(request(app).get('/api/links?isActive=true'));
    const inactive = await asActor(actor)(request(app).get('/api/links?isActive=false'));

    expect(active.body.items.map((l: { id: string }) => l.id)).toEqual([kept.body.id]);
    expect(inactive.body.items.map((l: { id: string }) => l.id)).toEqual([disabled.body.id]);
  });

  it('filters by createdFrom/createdTo, inclusive of both days', async () => {
    const actor = await signUp('owner@example.com');
    const inJanuary = await createLink(actor, { url: 'https://example.com/jan' });
    const inMarch = await createLink(actor, { url: 'https://example.com/mar' });
    // createdAt defaults to now() at insert time, so backdating it directly
    // is the only way to exercise a date filter without waiting real days.
    await prisma.link.update({
      where: { id: inJanuary.body.id },
      data: { createdAt: new Date('2026-01-15T12:00:00Z') },
    });
    await prisma.link.update({
      where: { id: inMarch.body.id },
      data: { createdAt: new Date('2026-03-15T12:00:00Z') },
    });

    const januaryOnly = await asActor(actor)(
      request(app).get('/api/links?createdFrom=2026-01-01&createdTo=2026-01-31'),
    );
    const fromFebOn = await asActor(actor)(request(app).get('/api/links?createdFrom=2026-02-01'));
    const exactDay = await asActor(actor)(
      request(app).get('/api/links?createdFrom=2026-01-15&createdTo=2026-01-15'),
    );

    expect(januaryOnly.body.items.map((l: { id: string }) => l.id)).toEqual([inJanuary.body.id]);
    expect(fromFebOn.body.items.map((l: { id: string }) => l.id)).toEqual([inMarch.body.id]);
    expect(exactDay.body.items.map((l: { id: string }) => l.id)).toEqual([inJanuary.body.id]);
  });

  it('rejects createdFrom after createdTo', async () => {
    const actor = await signUp('owner@example.com');

    const res = await asActor(actor)(
      request(app).get('/api/links?createdFrom=2026-02-01&createdTo=2026-01-01'),
    );

    expect(res.status).toBe(400);
  });
});

describe('GET /api/links/:id', () => {
  it('returns the caller’s own link', async () => {
    const actor = await signUp('owner@example.com');
    const created = await createLink(actor, { url: 'https://example.com/mine' });

    const res = await asActor(actor)(request(app).get(`/api/links/${created.body.id}`));

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
  });

  it('404s another user’s link rather than 403', async () => {
    // 403 would confirm the id exists, letting anyone probe for valid ids.
    const owner = await signUp('owner@example.com');
    const stranger = await signUp('stranger@example.com');
    const created = await createLink(owner, { url: 'https://example.com/private' });

    const res = await asActor(stranger)(request(app).get(`/api/links/${created.body.id}`));

    expect(res.status).toBe(404);
  });

  it('404s a well-formed but unknown id', async () => {
    const actor = await signUp('owner@example.com');

    const res = await asActor(actor)(
      request(app).get('/api/links/01a0821f-a782-750e-b849-000000000000'),
    );

    expect(res.status).toBe(404);
  });

  it('404s a malformed id instead of failing on the uuid cast', async () => {
    const actor = await signUp('owner@example.com');

    const res = await asActor(actor)(request(app).get('/api/links/not-a-uuid'));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('PATCH /api/links/:id', () => {
  it('changes the destination and invalidates the cached copy', async () => {
    // The important one: a stale cache entry would keep sending visitors to
    // the old destination for up to an hour after the edit.
    const actor = await signUp('owner@example.com');
    const created = await createLink(actor, {
      url: 'https://example.com/before',
      customAlias: 'edit-me',
    });

    // Warm the cache through a real redirect.
    await request(app).get('/edit-me');
    expect(await redis.get(cacheKey('edit-me'))).not.toBeNull();

    await asActor(actor)(request(app).patch(`/api/links/${created.body.id}`)).send({
      url: 'https://example.com/after',
    });

    expect(await redis.get(cacheKey('edit-me'))).toBeNull();
    const redirected = await request(app).get('/edit-me');
    expect(redirected.headers.location).toBe('https://example.com/after');
  });

  it('takes effect immediately when a link is deactivated', async () => {
    const actor = await signUp('owner@example.com');
    const created = await createLink(actor, {
      url: 'https://example.com/x',
      customAlias: 'switch-off',
    });
    await request(app).get('/switch-off');

    await asActor(actor)(request(app).patch(`/api/links/${created.body.id}`)).send({
      isActive: false,
    });

    expect((await request(app).get('/switch-off')).status).toBe(410);
  });

  it('clears the cached 410 when a link is reactivated', async () => {
    // Without invalidation the negative entry would keep serving 410 even
    // though the link is live again.
    const actor = await signUp('owner@example.com');
    const created = await createLink(actor, {
      url: 'https://example.com/x',
      customAlias: 'back-on',
    });
    await asActor(actor)(request(app).patch(`/api/links/${created.body.id}`)).send({
      isActive: false,
    });
    expect((await request(app).get('/back-on')).status).toBe(410);

    await asActor(actor)(request(app).patch(`/api/links/${created.body.id}`)).send({
      isActive: true,
    });

    expect((await request(app).get('/back-on')).status).toBe(302);
  });

  it('invalidates on an expiry change, whose old value clamped the cache ttl', async () => {
    const actor = await signUp('owner@example.com');
    const created = await createLink(actor, {
      url: 'https://example.com/x',
      customAlias: 'expiry-tweak',
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    });
    await request(app).get('/expiry-tweak');
    const ttlBefore = await redis.ttl(cacheKey('expiry-tweak'));
    expect(ttlBefore).toBeLessThanOrEqual(120);

    await asActor(actor)(request(app).patch(`/api/links/${created.body.id}`)).send({
      expiresAt: null,
    });

    expect(await redis.get(cacheKey('expiry-tweak'))).toBeNull();
    await request(app).get('/expiry-tweak');
    // Re-cached against no expiry, so back to the full TTL.
    expect(await redis.ttl(cacheKey('expiry-tweak'))).toBeGreaterThan(120);
  });

  it('clears an expiry with null', async () => {
    const actor = await signUp('owner@example.com');
    const created = await createLink(actor, {
      url: 'https://example.com',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    const res = await asActor(actor)(request(app).patch(`/api/links/${created.body.id}`)).send({
      expiresAt: null,
    });

    expect(res.body.expiresAt).toBeNull();
  });

  it('rejects an empty patch', async () => {
    const actor = await signUp('owner@example.com');
    const created = await createLink(actor, { url: 'https://example.com' });

    const res = await asActor(actor)(request(app).patch(`/api/links/${created.body.id}`)).send({});

    expect(res.status).toBe(400);
  });

  it('rejects a non-http destination on update', async () => {
    const actor = await signUp('owner@example.com');
    const created = await createLink(actor, { url: 'https://example.com' });

    const res = await asActor(actor)(request(app).patch(`/api/links/${created.body.id}`)).send({
      url: 'javascript:alert(1)',
    });

    expect(res.status).toBe(400);
  });

  it('cannot patch another user’s link', async () => {
    const owner = await signUp('owner@example.com');
    const stranger = await signUp('stranger@example.com');
    const created = await createLink(owner, { url: 'https://example.com/before' });

    const res = await asActor(stranger)(request(app).patch(`/api/links/${created.body.id}`)).send({
      url: 'https://evil.example.com',
    });

    expect(res.status).toBe(404);
    const row = await prisma.link.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.originalUrl).toBe('https://example.com/before');
  });
});

describe('DELETE /api/links/:id', () => {
  it('deletes the link and stops it redirecting from cache', async () => {
    const actor = await signUp('owner@example.com');
    const created = await createLink(actor, {
      url: 'https://example.com/x',
      customAlias: 'delete-me',
    });
    await request(app).get('/delete-me');
    expect(await redis.get(cacheKey('delete-me'))).not.toBeNull();

    const res = await asActor(actor)(request(app).delete(`/api/links/${created.body.id}`));

    expect(res.status).toBe(204);
    expect(await redis.get(cacheKey('delete-me'))).toBeNull();
    expect((await request(app).get('/delete-me')).status).toBe(404);
  });

  it('takes the link’s clicks with it', async () => {
    const actor = await signUp('owner@example.com');
    const created = await createLink(actor, { url: 'https://example.com' });
    await prisma.click.create({
      data: { linkId: created.body.id, clickDate: new Date('2026-09-01T00:00:00Z') },
    });

    await asActor(actor)(request(app).delete(`/api/links/${created.body.id}`));

    expect(await prisma.click.count()).toBe(0);
  });

  it('cannot delete another user’s link', async () => {
    const owner = await signUp('owner@example.com');
    const stranger = await signUp('stranger@example.com');
    const created = await createLink(owner, { url: 'https://example.com' });

    const res = await asActor(stranger)(request(app).delete(`/api/links/${created.body.id}`));

    expect(res.status).toBe(404);
    expect(await prisma.link.count()).toBe(1);
  });

  it('404s a second delete rather than reporting success twice', async () => {
    const actor = await signUp('owner@example.com');
    const created = await createLink(actor, { url: 'https://example.com' });
    await asActor(actor)(request(app).delete(`/api/links/${created.body.id}`));

    const res = await asActor(actor)(request(app).delete(`/api/links/${created.body.id}`));

    expect(res.status).toBe(404);
  });
});
