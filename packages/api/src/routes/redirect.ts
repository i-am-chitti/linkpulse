import { Router } from 'express';
import { SHORT_CODE_PATTERN } from '@linkpulse/shared';
import { gone, notFound } from '../lib/errors.js';
import { resolveShortCode } from '../services/urlService.js';

export const redirectRouter: Router = Router();

/**
 * The hot path. Everything here is in service of latency:
 *
 * - the format gate rejects junk before any I/O happens
 * - resolution is read-through, so a cache hit costs one Redis GET
 * - nothing is awaited that the response does not depend on
 *
 * Must be mounted last: `/:shortCode` matches a single segment and would
 * otherwise shadow /health.
 */
redirectRouter.get('/:shortCode', async (req, res) => {
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
});
