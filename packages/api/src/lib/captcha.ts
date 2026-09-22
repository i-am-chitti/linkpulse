import { env } from '../config/env.js';
import { logger } from './logger.js';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Optional like the OAuth providers: no secret, no challenge - so local dev and CI need no key. */
export function isCaptchaConfigured(): boolean {
  return Boolean(env.TURNSTILE_SECRET_KEY);
}

interface SiteVerifyResponse {
  success: boolean;
  'error-codes'?: string[];
}

/**
 * Fails closed, unlike the rate limiter's fail-open on a Redis outage: a
 * skipped limiter still bounds the damage, a skipped challenge leaves the
 * form it guards completely open.
 */
export async function verifyCaptchaToken(token: string, ip?: string): Promise<boolean> {
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY!, response: token });
  if (ip) body.set('remoteip', ip);

  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, 'turnstile siteverify returned a non-200');
      return false;
    }

    const data = (await res.json()) as SiteVerifyResponse;
    if (!data.success) {
      logger.info({ errorCodes: data['error-codes'] }, 'turnstile challenge rejected');
    }
    return data.success === true;
  } catch (error) {
    logger.warn({ err: error }, 'turnstile siteverify failed');
    return false;
  }
}
