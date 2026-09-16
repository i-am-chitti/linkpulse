import { Router } from 'express';
import { analyticsQuerySchema } from '@linkpulse/shared';
import { notFound } from '../lib/errors.js';
import { actorOf } from '../middleware/auth.js';
import { getLinkAnalytics, getLinkAnalyticsSummary } from '../services/analyticsService.js';
import { getLink } from '../services/linkService.js';

export const analyticsRouter: Router = Router();

/**
 * Authentication and rate limiting are applied once for the whole '/api/links'
 * prefix in app.ts, ahead of this router and linksRouter - see the comment in
 * links.ts for why.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function linkIdFrom(rawId: string): string {
  if (!UUID_PATTERN.test(rawId)) throw notFound('No such link');
  return rawId;
}

/**
 * Ownership is checked before any aggregation runs.
 *
 * getLink throws 404 for a link the caller does not own, so this also settles
 * guest links: they have no owner, so nobody can read their analytics - which
 * is the "guest mode has no analytics" rule from spec section 2.1, enforced by
 * the data model rather than by a separate check.
 */
async function assertOwnership(userId: string, linkId: string): Promise<void> {
  await getLink(userId, linkId);
}

analyticsRouter.get('/api/links/:id/analytics', async (req, res) => {
  const linkId = linkIdFrom(req.params.id);
  const range = analyticsQuerySchema.parse(req.query);

  await assertOwnership(actorOf(req).id, linkId);

  res.json(await getLinkAnalytics(linkId, range));
});

analyticsRouter.get('/api/links/:id/analytics/summary', async (req, res) => {
  const linkId = linkIdFrom(req.params.id);

  await assertOwnership(actorOf(req).id, linkId);

  res.json(await getLinkAnalyticsSummary(linkId));
});
