// apiFetch is the one chokepoint every request goes through, so its retry
// and error-mapping behaviour is worth testing directly rather than trusting
// it by way of whatever component happens to call it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, ApiError, getAccessToken, setAccessToken } from '../lib/api';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  setAccessToken(null);
  vi.restoreAllMocks();
});

afterEach(() => {
  setAccessToken(null);
});

describe('apiFetch', () => {
  it('attaches the access token as a bearer header when set', async () => {
    setAccessToken('token-123');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, {}));

    await apiFetch('/api/links');

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init!.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer token-123');
  });

  it('sends no authorization header when logged out', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, {}));

    await apiFetch('/api/links');

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init!.headers as Headers;
    expect(headers.has('authorization')).toBe(false);
  });

  it('always sends credentials, so the refresh cookie can ride along', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, {}));

    await apiFetch('/api/links');

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init!.credentials).toBe('include');
  });

  it('returns the parsed body on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, { hello: 'world' }));

    await expect(apiFetch('/api/links')).resolves.toEqual({ hello: 'world' });
  });

  it('returns undefined for a 204, which has no body to parse', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    await expect(apiFetch('/api/links')).resolves.toBeUndefined();
  });

  it('throws ApiError with the server’s code and message on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(409, { error: { code: 'CONFLICT', message: 'Already taken' } }),
    );

    const error = await apiFetch('/api/links').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) throw error;
    expect(error.status).toBe(409);
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('Already taken');
  });

  it('falls back to a generic error when the body is not JSON', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('<html>502</html>', { status: 502, statusText: 'Bad Gateway' }),
      );
    void fetchMock;

    const error = await apiFetch('/api/links').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) throw error;
    expect(error.status).toBe(502);
  });

  it('appends query params, dropping undefined and null', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, {}));

    await apiFetch('/api/links', { params: { page: 2, search: undefined, isActive: false } });

    const [url] = fetchMock.mock.calls[0]!;
    const parsed = new URL(String(url));
    expect(parsed.searchParams.get('page')).toBe('2');
    expect(parsed.searchParams.has('search')).toBe(false);
    expect(parsed.searchParams.get('isActive')).toBe('false');
  });

  describe('on a 401', () => {
    it('refreshes once and retries the original request', async () => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }))
        .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'fresh-token' }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      const result = await apiFetch('/api/links');

      expect(result).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(getAccessToken()).toBe('fresh-token');
    });

    it('surfaces the original 401 when the refresh itself fails', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }))
        .mockResolvedValueOnce(
          jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }),
        );

      const error = await apiFetch('/api/links').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApiError);
      if (!(error instanceof ApiError)) throw error;
      expect(error.status).toBe(401);
    });

    it('deduplicates concurrent refreshes into a single call', async () => {
      // Several queries can 401 around the same moment; each firing its own
      // refresh would race the API's rotation, and every refresh past the
      // first would fail because the first already revoked the token.
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }))
        .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }))
        .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'fresh-token' }))
        .mockResolvedValueOnce(jsonResponse(200, { first: true }))
        .mockResolvedValueOnce(jsonResponse(200, { second: true }));

      const [a, b] = await Promise.all([apiFetch('/api/a'), apiFetch('/api/b')]);

      expect(a).toEqual({ first: true });
      expect(b).toEqual({ second: true });
      const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/api/auth/refresh'),
      );
      expect(refreshCalls).toHaveLength(1);
    });

    it('does not retry a 401 from the refresh call itself', async () => {
      // skipAuthRetry: without it, a failed refresh 401ing would try to
      // refresh its own refresh, forever.
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }));

      await apiFetch('/api/auth/refresh', { method: 'POST', skipAuthRetry: true }).catch(
        () => undefined,
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
