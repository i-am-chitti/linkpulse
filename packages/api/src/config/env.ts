import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

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
