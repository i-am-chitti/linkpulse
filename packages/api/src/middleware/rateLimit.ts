import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { tooManyRequests } from '../lib/errors.js';
import { consumeRateLimit } from '../lib/rateLimiter.js';

export interface RateLimitOptions {
  /** Namespaces the bucket so unrelated routes never share a counter. */
  bucket: string;
  /**
   * Requests allowed per window for an anonymous caller, identified by IP.
   * Omit only for a route mounted behind requireAuth, where req.actor is
   * always set and this tier is unreachable.
   */
  anonLimit?: number;
  /**
   * Requests allowed per window once req.actor is set, identified by user id.
   * Omit for a route that is never authenticated (guest shortening, login).
   */
  userLimit?: number;
  /**
   * 'ip' keys on the IP even for an authenticated caller, for a budget that
   * must hold across every account one machine registers. Default 'actor'
   * keys on the user id once authenticated.
   */
  identify?: 'actor' | 'ip';
}

/**
 * Applies a sliding-window rate limit, tiered by whether the caller is
 * authenticated.
 *
 * Must run after optionalAuth/requireAuth on any route that wants the user
 * tier: the actor on req is what tells an authenticated caller apart from an
 * anonymous one sharing the same IP (e.g. behind NAT or a corporate proxy).
 *
 * req.ip, not the raw socket address: app.set('trust proxy', 1) makes it
 * X-Forwarded-For's first hop, so this limits the real client rather than
 * the reverse proxy every request arrives through.
 */
export function rateLimit(options: RateLimitOptions): RequestHandler {
  const { bucket, anonLimit, userLimit, identify = 'actor' } = options;

  if (anonLimit === undefined && userLimit === undefined) {
    // A setup-time mistake, not a request-time one: fail loudly at boot
    // rather than passing every request through unlimited.
    throw new Error(`rateLimit("${bucket}") needs at least one of anonLimit/userLimit`);
  }

  // Each falls back to the other, so a route that only ever hits one tier
  // (guest shortening is always anonymous; /api/links is always behind
  // requireAuth) does not need to state a number for the unreachable one.
  const effectiveAnonLimit = anonLimit ?? userLimit!;
  const effectiveUserLimit = userLimit ?? anonLimit!;

  return async (req, res, next) => {
    const authenticated = Boolean(req.actor);
    const limit = authenticated ? effectiveUserLimit : effectiveAnonLimit;
    const identifier =
      authenticated && identify === 'actor' ? `user:${req.actor!.id}` : `ip:${req.ip}`;

    const result = await consumeRateLimit(bucket, identifier, limit, env.RATE_LIMIT_WINDOW_SECONDS);

    // A route behind two limiters reports whichever has least headroom, not
    // whichever ran last.
    const remaining = Math.max(0, result.limit - result.count);
    const reported = res.get('X-RateLimit-Remaining');
    if (reported === undefined || remaining < Number(reported)) {
      res.set('X-RateLimit-Limit', String(result.limit));
      res.set('X-RateLimit-Remaining', String(remaining));
    }

    if (!result.allowed) {
      res.set('Retry-After', String(result.retryAfterSeconds));
      throw tooManyRequests(`Too many requests. Retry in ${result.retryAfterSeconds}s.`);
    }

    next();
  };
}
