import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { redis } from '../../src/lib/redis.js';
import { hashRefreshToken } from '../../src/lib/tokens.js';

const app = createApp();

const CREDENTIALS = { email: 'owner@example.com', password: 'correct-horse-battery' };

/** Pulls the refresh cookie value out of a Set-Cookie header. */
function refreshCookieFrom(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((value) => value.startsWith('linkpulse_refresh='));
  if (!cookie) throw new Error('no refresh cookie on response');
  return cookie.split(';')[0]!.split('=')[1]!;
}

function cookieAttributes(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((value) => value.startsWith('linkpulse_refresh=')) ?? '';
}

async function registerUser(overrides: Partial<typeof CREDENTIALS> = {}) {
  return request(app)
    .post('/api/auth/register')
    .send({ ...CREDENTIALS, ...overrides });
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE users, links, clicks, refresh_tokens CASCADE');
});

afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE users, links, clicks, refresh_tokens CASCADE');
  await prisma.$disconnect();
  await redis.quit();
});

describe('POST /api/auth/register', () => {
  it('creates an account and issues a session', async () => {
    const res = await registerUser();

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('owner@example.com');
    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.body.expiresIn).toBe(900);
  });

  it('never returns the password hash', async () => {
    const res = await registerUser();

    expect(JSON.stringify(res.body)).not.toContain('$2b$');
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  it('keeps the refresh token out of the json body', async () => {
    // It belongs in an httpOnly cookie; in the body, XSS could read it.
    const res = await registerUser();

    expect(res.body).not.toHaveProperty('refreshToken');
    expect(refreshCookieFrom(res)).toBeTypeOf('string');
  });

  it('marks the refresh cookie httpOnly and scopes it to the auth path', async () => {
    const attributes = cookieAttributes(await registerUser());

    expect(attributes).toContain('HttpOnly');
    // Scoped so the browser does not attach it to every redirect.
    expect(attributes).toContain('Path=/api/auth');
    expect(attributes).toMatch(/SameSite=Lax/i);
  });

  it('stores only a digest of the refresh token', async () => {
    const res = await registerUser();
    const token = refreshCookieFrom(res);

    const stored = await prisma.refreshToken.findFirstOrThrow();
    expect(stored.tokenHash).toBe(hashRefreshToken(token));
    // A leaked table must not yield usable tokens.
    expect(stored.tokenHash).not.toBe(token);
  });

  it('hashes the password with bcrypt rather than storing it', async () => {
    await registerUser();

    const user = await prisma.user.findFirstOrThrow();
    expect(user.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(user.passwordHash).not.toBe(CREDENTIALS.password);
  });

  it('lowercases the email so casing cannot create a second account', async () => {
    const res = await registerUser({ email: 'Owner@Example.COM' });

    expect(res.body.user.email).toBe('owner@example.com');
  });

  it('rejects a duplicate email with 409', async () => {
    await registerUser();
    const res = await registerUser();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it.each([
    ['a short password', { password: 'short' }],
    ['a malformed email', { email: 'not-an-email' }],
  ])('rejects %s', async (_label, overrides) => {
    const res = await registerUser(overrides);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/auth/login', () => {
  it('issues a session for correct credentials', async () => {
    await registerUser();

    const res = await request(app).post('/api/auth/login').send(CREDENTIALS);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf('string');
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    // Otherwise the response enumerates which addresses are registered.
    await registerUser();

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ ...CREDENTIALS, password: 'wrong-password' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: CREDENTIALS.password });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  it('accepts a differently-cased email', async () => {
    await registerUser();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ ...CREDENTIALS, email: 'OWNER@EXAMPLE.COM' });

    expect(res.status).toBe(200);
  });

  it('starts a separate family per login', async () => {
    await registerUser();
    await request(app).post('/api/auth/login').send(CREDENTIALS);

    const families = await prisma.refreshToken.findMany({ select: { familyId: true } });
    expect(new Set(families.map((row) => row.familyId)).size).toBe(2);
  });
});

describe('POST /api/auth/refresh', () => {
  it('exchanges a refresh token for a new session', async () => {
    const token = refreshCookieFrom(await registerUser());

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `linkpulse_refresh=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf('string');
  });

  it('rotates the token, revoking the one presented', async () => {
    const first = refreshCookieFrom(await registerUser());

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `linkpulse_refresh=${first}`);
    const second = refreshCookieFrom(res);

    expect(second).not.toBe(first);
    const old = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(first) },
    });
    expect(old.revokedAt).not.toBeNull();
  });

  it('keeps the rotated token in the same family', async () => {
    const first = refreshCookieFrom(await registerUser());
    const second = refreshCookieFrom(
      await request(app).post('/api/auth/refresh').set('Cookie', `linkpulse_refresh=${first}`),
    );

    const rows = await prisma.refreshToken.findMany({
      where: { tokenHash: { in: [hashRefreshToken(first), hashRefreshToken(second)] } },
    });
    expect(new Set(rows.map((row) => row.familyId)).size).toBe(1);
  });

  it('revokes the whole family when a rotated token is reused', async () => {
    // The signature security feature: reuse means two parties hold the token
    // and we cannot tell which is the attacker, so neither keeps the session.
    const first = refreshCookieFrom(await registerUser());
    const second = refreshCookieFrom(
      await request(app).post('/api/auth/refresh').set('Cookie', `linkpulse_refresh=${first}`),
    );

    const replay = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `linkpulse_refresh=${first}`);

    expect(replay.status).toBe(401);

    // The legitimate client's current token is dead too.
    const afterReuse = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `linkpulse_refresh=${second}`);
    expect(afterReuse.status).toBe(401);

    const live = await prisma.refreshToken.count({ where: { revokedAt: null } });
    expect(live).toBe(0);
  });

  it('rejects an expired refresh token', async () => {
    const token = refreshCookieFrom(await registerUser());
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashRefreshToken(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `linkpulse_refresh=${token}`);

    expect(res.status).toBe(401);
  });

  it.each([
    ['a forged token', 'not-a-real-token'],
    ['no token at all', ''],
  ])('rejects %s', async (_label, token) => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `linkpulse_refresh=${token}`);

    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the session and clears the cookie', async () => {
    const token = refreshCookieFrom(await registerUser());

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `linkpulse_refresh=${token}`);

    expect(res.status).toBe(204);
    const reuse = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `linkpulse_refresh=${token}`);
    expect(reuse.status).toBe(401);
  });

  it('is idempotent, and silent about unknown tokens', async () => {
    const first = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', 'linkpulse_refresh=never-existed');
    const second = await request(app).post('/api/auth/logout');

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the authenticated user', async () => {
    const { body } = await registerUser();

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('owner@example.com');
  });

  it.each([
    ['no header', undefined],
    ['a malformed header', 'NotBearer abc'],
    ['a forged token', 'Bearer not.a.jwt'],
  ])('rejects %s with 401', async (_label, header) => {
    const req = request(app).get('/api/auth/me');
    if (header) req.set('Authorization', header);

    expect((await req).status).toBe(401);
  });

  it('accepts a lowercase bearer scheme', async () => {
    const { body } = await registerUser();

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `bearer ${body.accessToken}`);

    expect(res.status).toBe(200);
  });

  it('404s when the account was deleted after the token was issued', async () => {
    const { body } = await registerUser();
    await prisma.user.deleteMany({});

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`);

    expect(res.status).toBe(404);
  });

  it('rejects a token signed with the wrong secret', async () => {
    // Guards the algorithms pin: a token we did not sign must never verify.
    const forged = [
      Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ sub: 'someone', email: 'a@b.c' })).toString('base64url'),
      '',
    ].join('.');

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`);

    expect(res.status).toBe(401);
  });
});

describe('access token claims', () => {
  it('carries the user id as the subject and the configured lifetime', async () => {
    const { body } = await registerUser();
    const [, payload] = body.accessToken.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());

    const user = await prisma.user.findFirstOrThrow();
    expect(claims.sub).toBe(user.id);
    expect(claims.exp - claims.iat).toBe(900);
  });
});
