// env vars must be stubbed before oauthService.ts (and config/env.js) first
// loads - config/env.ts computes its exported `env` once, at import time -
// hence the dynamic import below instead of a static one.
import { describe, expect, it, vi } from 'vitest';

vi.stubEnv('GITHUB_CLIENT_ID', 'test-github-client-id');
vi.stubEnv('GITHUB_CLIENT_SECRET', 'test-github-client-secret');
vi.stubEnv('GOOGLE_CLIENT_ID', 'test-google-client-id');
vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-google-client-secret');

const { buildAuthorizationUrl, isKnownProvider, resolveOAuthProfile } =
  await import('../../src/services/oauthService.js');

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('isKnownProvider', () => {
  it.each(['github', 'google'])('accepts %s', (provider) => {
    expect(isKnownProvider(provider)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isKnownProvider('bitbucket')).toBe(false);
  });
});

describe('buildAuthorizationUrl', () => {
  it('builds the GitHub authorize URL with client id, callback and state', () => {
    const url = new URL(buildAuthorizationUrl('github', 'the-state'));

    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('test-github-client-id');
    expect(url.searchParams.get('redirect_uri')).toMatch(/\/api\/auth\/oauth\/github\/callback$/);
    expect(url.searchParams.get('scope')).toBe('read:user user:email');
    expect(url.searchParams.get('state')).toBe('the-state');
  });

  it('builds the Google authorize URL, including response_type', () => {
    const url = new URL(buildAuthorizationUrl('google', 'other-state'));

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('test-google-client-id');
    expect(url.searchParams.get('redirect_uri')).toMatch(/\/api\/auth\/oauth\/google\/callback$/);
    expect(url.searchParams.get('response_type')).toBe('code');
  });
});

describe('resolveOAuthProfile: github', () => {
  it('normalizes a profile whose email is public on /user', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://github.com/login/oauth/access_token') {
        return jsonResponse(200, { access_token: 'gh-access-token' });
      }
      if (url === 'https://api.github.com/user') {
        return jsonResponse(200, {
          id: 42,
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          avatar_url: 'https://avatars.example.com/ada.png',
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await expect(resolveOAuthProfile('github', 'the-code')).resolves.toEqual({
      providerId: '42',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      avatarUrl: 'https://avatars.example.com/ada.png',
    });
  });

  it('falls back to /user/emails when the primary profile hides it', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://github.com/login/oauth/access_token') {
        return jsonResponse(200, { access_token: 'gh-access-token' });
      }
      if (url === 'https://api.github.com/user') {
        return jsonResponse(200, { id: 7, name: 'Grace Hopper', email: null, avatar_url: null });
      }
      if (url === 'https://api.github.com/user/emails') {
        return jsonResponse(200, [
          { email: 'secondary@example.com', primary: false, verified: true },
          { email: 'grace@example.com', primary: true, verified: true },
        ]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await expect(resolveOAuthProfile('github', 'the-code')).resolves.toMatchObject({
      email: 'grace@example.com',
    });
  });

  it('rejects an account with no verified email at all', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://github.com/login/oauth/access_token') {
        return jsonResponse(200, { access_token: 'gh-access-token' });
      }
      if (url === 'https://api.github.com/user') {
        return jsonResponse(200, { id: 9, name: null, email: null, avatar_url: null });
      }
      if (url === 'https://api.github.com/user/emails') {
        return jsonResponse(200, [
          { email: 'unverified@example.com', primary: true, verified: false },
        ]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await expect(resolveOAuthProfile('github', 'the-code')).rejects.toThrow(/verified email/i);
  });

  it('rejects when GitHub refuses the authorization code', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(400, { error: 'bad_verification_code' }),
    );

    await expect(resolveOAuthProfile('github', 'stale-code')).rejects.toThrow(/rejected/i);
  });
});

describe('resolveOAuthProfile: google', () => {
  it('normalizes a Google profile', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        return jsonResponse(200, { access_token: 'g-access-token' });
      }
      if (url === 'https://www.googleapis.com/oauth2/v3/userinfo') {
        return jsonResponse(200, {
          sub: 'google-sub-1',
          email: 'ada@example.com',
          email_verified: true,
          name: 'Ada Lovelace',
          picture: 'https://avatars.example.com/ada.png',
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await expect(resolveOAuthProfile('google', 'the-code')).resolves.toEqual({
      providerId: 'google-sub-1',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      avatarUrl: 'https://avatars.example.com/ada.png',
    });
  });

  it('rejects an unverified email', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        return jsonResponse(200, { access_token: 'g-access-token' });
      }
      return jsonResponse(200, {
        sub: 'google-sub-2',
        email: 'unverified@example.com',
        email_verified: false,
      });
    });

    await expect(resolveOAuthProfile('google', 'the-code')).rejects.toThrow(/verified email/i);
  });
});
