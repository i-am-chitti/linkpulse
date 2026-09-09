import type { ApiErrorBody } from '@linkpulse/shared';
import { API_BASE_URL } from './env';

/** Thrown for any non-2xx response, carrying the server's own error shape. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, string[]>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error.code;
    if (body.error.details) this.details = body.error.details;
  }
}

/**
 * Holds the access token in memory only, not localStorage.
 *
 * A token in localStorage is readable by any script on the page, so a single
 * XSS anywhere turns into a stolen session; an in-memory value survives only
 * as long as the tab. The refresh cookie (httpOnly, set by the API) is what
 * makes that survivable across a reload - see restoreSession in auth.tsx.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Query string params, appended and filtered of undefined/null. */
  params?: Record<string, string | number | boolean | undefined>;
  /** Skip the automatic refresh-and-retry on a 401 - used by refresh itself. */
  skipAuthRetry?: boolean;
}

function buildUrl(path: string, params?: RequestOptions['params']): string {
  const url = new URL(path, API_BASE_URL);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Exchanges the httpOnly refresh cookie for a new access token.
 *
 * Deduplicated: several requests can 401 around the same moment (a page that
 * fires off a handful of queries on load), and each must not fire its own
 * refresh - the API's rotation would revoke every refresh after the first to
 * land, failing all the others.
 */
async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(buildUrl('/api/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) return false;
        const data = (await res.json()) as { accessToken: string };
        setAccessToken(data.accessToken);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/**
 * The one function every API call goes through.
 *
 * `credentials: 'include'` on every request, not just auth ones: the refresh
 * cookie is path-scoped to /api/auth, so sending it elsewhere is a no-op, and
 * this way there is exactly one fetch policy to reason about rather than a
 * per-call decision that is easy to get wrong.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, params, skipAuthRetry = false } = options;

  const headers = new Headers({ 'content-type': 'application/json' });
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);

  const response = await fetch(buildUrl(path, params), {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 && !skipAuthRetry) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return apiFetch<T>(path, { ...options, skipAuthRetry: true });
    }
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = (await response.json().catch(() => null)) as T | ApiErrorBody | null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      (payload as ApiErrorBody) ?? {
        error: { code: 'UNKNOWN', message: response.statusText || 'Request failed' },
      },
    );
  }

  return payload as T;
}
