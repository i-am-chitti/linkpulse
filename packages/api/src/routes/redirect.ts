import { Router } from 'express';
import { SHORT_CODE_PATTERN } from '@linkpulse/shared';
import { env } from '../config/env.js';
import { gone, notFound } from '../lib/errors.js';
import { optionalAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { enqueueClick } from '../services/clickQueue.js';
import { resolveShortCode } from '../services/urlService.js';

export const redirectRouter: Router = Router();

/**
 * The hot path. Everything here is in service of latency:
 *
 * - the format gate rejects junk before any I/O happens
 * - resolution is read-through, so a cache hit costs one Redis GET
 * - the click is queued after the response, never before
 *
 * Must be mounted last: `/:shortCode` matches a single segment and would
 * otherwise shadow /health.
 */
/**
 * optionalAuth before rateLimit: a browser click never carries a bearer
 * token, so in practice every redirect is rate-limited on the anonymous
 * tier - the authenticated tier exists for a programmatic caller that
 * attaches one, per spec section 2.3.
 */
// The explicit param type is needed because mixing several middleware in
// one array defeats Express 5's route-string param inference, which would
// otherwise leave req.params.shortCode typed as string | string[] | undefined.
redirectRouter.get<{ shortCode: string }>(
  '/:shortCode',
  optionalAuth,
  rateLimit({
    bucket: 'redirect',
    anonLimit: env.RATE_LIMIT_ANON_REDIRECT_PER_MINUTE,
    userLimit: env.RATE_LIMIT_USER_REDIRECT_PER_MINUTE,
  }),
  async (req, res) => {
    const { shortCode } = req.params;

    // Cheaper than a cache lookup, and stops scanners from filling the negative
    // cache with keys that could never be valid.
    if (!SHORT_CODE_PATTERN.test(shortCode)) {
      throw notFound('No such link');
    }

    const result = await resolveShortCode(shortCode);

    if (result.status === 'missing') {
      throw notFound('No such link');
    }

    if (result.status === 'gone') {
      throw gone('This link has been disabled or has expired');
    }

    /**
     * 302, not 301, and explicitly uncacheable.
     *
     * A 301 is a permanent redirect: browsers cache it, often indefinitely, so
     * subsequent clicks never reach the service. That would both freeze the
     * destination (breaking "edit destination URL") and silently stop counting
     * clicks - the analytics this project exists to show.
     */
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.redirect(302, result.link.originalUrl);

    /**
     * Click tracking, off the critical path.
     *
     * Read the request fields before yielding, then queue after the response has
     * been handed to the client. Not awaited, and deliberately so: the visitor's
     * redirect must not wait on Redis, and a click that fails to enqueue is a
     * lost analytics row rather than a failed redirect. enqueueClick swallows and
     * logs its own errors, so the floating promise cannot reject.
     */
    void enqueueClick({
      linkId: result.link.id,
      // req.ip honours X-Forwarded-For because app.set('trust proxy', 1).
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
      referrer: req.get('referer') ?? req.get('referrer') ?? null,
      at: new Date().toISOString(),
    });
  },
);
