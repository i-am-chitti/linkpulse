import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /**
   * Postgres connections this instance may hold. Small on purpose: the
   * redirect path hits Postgres only on a cache miss, and a large pool per
   * instance multiplies into backend exhaustion once instances scale out.
   */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  /**
   * Signing key for access tokens.
   *
   * The 32-character floor is deliberate: HS256 with a short secret is
   * brute-forceable offline, and a weak secret here forges any session.
   */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  /**
   * Access token lifetime. Short, because nothing can revoke one before it
   * expires - revocation lives on the refresh token, which is stored.
   */
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
  /** Refresh token lifetime, and so the longest a session can idle. */
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /**
   * bcrypt cost factor. 12 is ~250ms per hash on current hardware: slow enough
   * to make offline cracking expensive, fast enough for a login request.
   */
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  /**
   * Sliding-window duration. Every per-minute limit below is "per this many
   * seconds", so changing it rescales every limit rather than just one.
   */
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3600).default(60),
  /** Unauthenticated POST /api/shorten. Spec section 2.3. */
  RATE_LIMIT_ANON_CREATE_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(10),
  /** Unauthenticated GET /:shortCode. Spec section 2.3. */
  RATE_LIMIT_ANON_REDIRECT_PER_MINUTE: z.coerce.number().int().min(1).max(1_000_000).default(100),
  /**
   * Authenticated API traffic. One shared bucket per user rather than one per
   * endpoint: spec section 5.2 lists the same 50/min for every /api/links*
   * route, which is one limit wearing several names, not several limits.
   */
  RATE_LIMIT_USER_API_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(50),
  /** Redirects made with a bearer token attached. Spec section 2.3. */
  RATE_LIMIT_USER_REDIRECT_PER_MINUTE: z.coerce.number().int().min(1).max(1_000_000).default(500),
  /**
   * Not in the spec: register/login/refresh share this per-IP budget, tighter
   * than plain link creation, as a floor against credential stuffing.
   */
  RATE_LIMIT_AUTH_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(20),

  /**
   * Clicks the worker writes per transaction. Larger batches amortise the
   * round trip but hold the transaction open longer.
   */
  CLICK_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
  /**
   * Longest the worker blocks on an empty queue before looping. Bounds how
   * long a shutdown signal waits to be noticed.
   */
  CLICK_BLOCK_SECONDS: z.coerce.number().int().min(1).max(60).default(5),
  /**
   * Hard cap on queued clicks. Without it a stopped worker would grow the list
   * until Redis hit maxmemory and began evicting the URL cache and rate-limit
   * counters, turning a stalled worker into a site-wide outage.
   */
  CLICK_QUEUE_MAX_LENGTH: z.coerce.number().int().min(100).max(10_000_000).default(100_000),

  /**
   * Origin the short links are served from, used to build shortUrl in responses.
   *
   * Named APP_BASE_URL, not BASE_URL: Vite reserves BASE_URL for its public
   * base path and injects '/' into process.env under Vitest, silently
   * overriding whatever we set.
   */
  APP_BASE_URL: z.url().default('http://localhost:4000'),
  /** Comma-separated list of origins allowed to call the API from a browser. */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
});

/**
 * Drops empty values so schema defaults actually apply.
 *
 * An unset variable is not reliably `undefined`: `FOO=` in a .env file, a
 * compose `FOO:` with no value, and some test runners all yield `''`, which
 * would fail validation instead of falling back to the default.
 */
function readProcessEnv(): Record<string, string> {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string' && value.trim() !== '') {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

/**
 * Parsed once at import time so a misconfigured container crashes on boot
 * rather than on the first request that happens to need the missing value.
 */
function loadEnv() {
  const result = envSchema.safeParse(readProcessEnv());

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return result.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

export type Env = typeof env;
