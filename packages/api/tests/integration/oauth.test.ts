// createApp() pulls in config/env.js transitively, which computes its
// exported `env` once at first import - so the client id/secret vars must be
// stubbed before that first import happens, hence the dynamic imports below
// rather than this file's usual static ones. See oauthService.test.ts for
// the same constraint at the service layer.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.stubEnv('GITHUB_CLIENT_ID', 'test-github-client-id');
vi.stubEnv('GITHUB_CLIENT_SECRET', 'test-github-client-secret');
vi.stubEnv('GOOGLE_CLIENT_ID', 'test-google-client-id');
vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-google-client-secret');

const { createApp } = await import('../../src/app.js');
const { prisma } = await import('../../src/lib/prisma.js');
const { redis } = await import('../../src/lib/redis.js');

const app = createApp();

const STATE_COOKIE_NAME = 'linkpulse_oauth_state';
const REFRESH_COOKIE_NAME = 'linkpulse_refresh';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cookieValue(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((value) => value.startsWith(`${name}=`));
  return cookie?.split(';')[0]?.split('=')[1];
}

/** Drives GET /api/auth/oauth/github and returns its state cookie. */
async function startGithubFlow(): Promise<string> {
  const res = await request(app).get('/api/auth/oauth/github');
  expect(res.status).toBe(302);
  const state = cookieValue(res, STATE_COOKIE_NAME);
  if (!state) throw new Error('no oauth state cookie on start response');
  return state;
}

function mockGithubProfile(profile: { id: number; email: string; name?: string | null }): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url === 'https://github.com/login/oauth/access_token') {
      return jsonResponse(200, { access_token: 'gh-access-token' });
    }
    if (url === 'https://api.github.com/user') {
      return jsonResponse(200, {
        id: profile.id,
        name: profile.name ?? null,
        email: profile.email,
        avatar_url: null,
      });
    }
    throw new Error(`unexpected fetch during test: ${url}`);
  });
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE users, links, clicks, refresh_tokens CASCADE');
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE users, links, clicks, refresh_tokens CASCADE');
  await prisma.$disconnect();
  await redis.quit();
});

describe('GET /api/auth/oauth/:provider', () => {
  it('404s for an unknown provider', async () => {
    const res = await request(app).get('/api/auth/oauth/bitbucket');
    expect(res.status).toBe(404);
  });

  it('redirects to the provider, carrying a state cookie and matching query param', async () => {
    const res = await request(app).get('/api/auth/oauth/github');

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);

    const state = cookieValue(res, STATE_COOKIE_NAME);
    expect(state).toBeTruthy();
    expect(res.headers.location).toContain(`state=${state}`);
  });
});

describe('GET /api/auth/oauth/:provider/callback', () => {
  it('rejects a callback with no state cookie at all', async () => {
    const res = await request(app).get('/api/auth/oauth/github/callback?code=abc&state=anything');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/oauth/callback?error=invalid_state');
  });

  it('rejects a callback whose state does not match the cookie', async () => {
    const state = await startGithubFlow();

    const res = await request(app)
      .get('/api/auth/oauth/github/callback?code=abc&state=not-the-real-state')
      .set('Cookie', `${STATE_COOKIE_NAME}=${state}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/oauth/callback?error=invalid_state');
  });

  it('creates an account, sets the refresh cookie, and redirects to the frontend on success', async () => {
    const state = await startGithubFlow();
    mockGithubProfile({ id: 555, email: 'newuser@example.com', name: 'New User' });

    const res = await request(app)
      .get(`/api/auth/oauth/github/callback?code=real-code&state=${state}`)
      .set('Cookie', `${STATE_COOKIE_NAME}=${state}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('http://localhost:3000/oauth/callback');
    expect(cookieValue(res, REFRESH_COOKIE_NAME)).toBeTruthy();

    const user = await prisma.user.findUnique({ where: { email: 'newuser@example.com' } });
    expect(user).toMatchObject({ provider: 'GITHUB', providerId: '555', name: 'New User' });
  });

  it('logs an existing (provider, providerId) back in rather than creating a duplicate', async () => {
    const firstState = await startGithubFlow();
    mockGithubProfile({ id: 555, email: 'repeat@example.com' });
    await request(app)
      .get(`/api/auth/oauth/github/callback?code=code-1&state=${firstState}`)
      .set('Cookie', `${STATE_COOKIE_NAME}=${firstState}`);

    const secondState = await startGithubFlow();
    mockGithubProfile({ id: 555, email: 'repeat@example.com' });
    const res = await request(app)
      .get(`/api/auth/oauth/github/callback?code=code-2&state=${secondState}`)
      .set('Cookie', `${STATE_COOKIE_NAME}=${secondState}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('http://localhost:3000/oauth/callback');

    const users = await prisma.user.findMany({ where: { email: 'repeat@example.com' } });
    expect(users).toHaveLength(1);
  });

  it('refuses to attach a provider identity to an email already owned by a different sign-in method', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'taken@example.com', password: 'correct-horse-battery' });

    const state = await startGithubFlow();
    mockGithubProfile({ id: 999, email: 'taken@example.com' });

    const res = await request(app)
      .get(`/api/auth/oauth/github/callback?code=code&state=${state}`)
      .set('Cookie', `${STATE_COOKIE_NAME}=${state}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/oauth/callback?error=email_taken');
    expect(cookieValue(res, REFRESH_COOKIE_NAME)).toBeFalsy();

    const users = await prisma.user.findMany({ where: { email: 'taken@example.com' } });
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ provider: 'LOCAL' });
  });
});
