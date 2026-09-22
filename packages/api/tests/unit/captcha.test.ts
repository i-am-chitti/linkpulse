// TURNSTILE_SECRET_KEY must be stubbed before config/env.js first loads,
// hence the dynamic import - same reasoning as oauthService.test.ts. The
// unconfigured case needs its own file: vitest isolates module registries
// per file, not per test.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('TURNSTILE_SECRET_KEY', 'test-turnstile-secret');

const { isCaptchaConfigured, verifyCaptchaToken } = await import('../../src/lib/captcha.js');
const { requireCaptcha } = await import('../../src/middleware/captcha.js');

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('verifyCaptchaToken', () => {
  it('posts the secret, token and caller ip to Cloudflare', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(200, { success: true }));

    await verifyCaptchaToken('the-token', '203.0.113.5');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(VERIFY_URL);
    const body = new URLSearchParams(init.body as string);
    expect(body.get('secret')).toBe('test-turnstile-secret');
    expect(body.get('response')).toBe('the-token');
    expect(body.get('remoteip')).toBe('203.0.113.5');
  });

  it('accepts a successful verification', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, { success: true }));

    await expect(verifyCaptchaToken('good')).resolves.toBe(true);
  });

  it('rejects an unsuccessful verification', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, { success: false, 'error-codes': ['invalid-input-response'] }),
    );

    await expect(verifyCaptchaToken('bad')).resolves.toBe(false);
  });

  it('fails closed on a non-200 from Cloudflare', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(500, {}));

    await expect(verifyCaptchaToken('any')).resolves.toBe(false);
  });

  it('fails closed when the request itself throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(verifyCaptchaToken('any')).resolves.toBe(false);
  });
});

describe('requireCaptcha, configured', () => {
  function runMiddleware(body: unknown) {
    const next = vi.fn();
    const req = { body, ip: '203.0.113.5' } as never;
    return { next, result: requireCaptcha()(req, {} as never, next) };
  }

  it('reports itself configured', () => {
    expect(isCaptchaConfigured()).toBe(true);
  });

  it('rejects a request with no token, without calling Cloudflare', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const { result } = runMiddleware({ email: 'a@example.com' });

    await expect(result).rejects.toThrow(/captcha verification is required/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an empty token', async () => {
    const { result } = runMiddleware({ captchaToken: '' });

    await expect(result).rejects.toThrow(/captcha verification is required/i);
  });

  it('rejects a token Cloudflare refuses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, { success: false }));

    const { result } = runMiddleware({ captchaToken: 'stale' });

    await expect(result).rejects.toThrow(/captcha verification failed/i);
  });

  it('calls next() on a token Cloudflare accepts', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, { success: true }));

    const { next, result } = runMiddleware({ captchaToken: 'solved' });
    await result;

    expect(next).toHaveBeenCalledOnce();
  });
});
