import { Router } from 'express';
import { createLinkSchema, listLinksQuerySchema, updateLinkSchema } from '@linkpulse/shared';
import { notFound } from '../lib/errors.js';
import { toLinkDto } from '../lib/serialize.js';
import { actorOf } from '../middleware/auth.js';
import { deleteLink, getLink, listLinks, updateLink } from '../services/linkService.js';
import { createLink } from '../services/urlService.js';

export const linksRouter: Router = Router();

/**
 * Every route here is owner-scoped. Authentication and rate limiting are
 * applied once, in app.ts, before either this router or analyticsRouter -
 * not here per router.
 *
 * That is not just tidiness: a router-level `.use(path, ...)` matches any
 * request whose path starts with that prefix, even one this router has no
 * terminal route for. Guarding '/api/links' identically in both linksRouter
 * and analyticsRouter meant a request to an analytics-only path (which falls
 * through linksRouter's unmatched routes before reaching analyticsRouter)
 * paid the rate limit twice - silently halving the real per-user quota.
 */

/**
 * Ids are UUIDs. Postgres raises a type error on a malformed one, which would
 * surface as a 500 for what is really just a bad path parameter, so the shape
 * is checked before it reaches the database.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function linkIdFrom(rawId: string): string {
  if (!UUID_PATTERN.test(rawId)) throw notFound('No such link');
  return rawId;
}

/** Create a link with the full feature set: custom alias, chosen expiry. */
linksRouter.post('/api/links', async (req, res) => {
  const input = createLinkSchema.parse(req.body);
  const actor = actorOf(req);

  const link = await createLink({
    url: input.url,
    userId: actor.id,
    customAlias: input.customAlias,
    expiresAt: input.expiresAt ?? null,
  });

  res.status(201).json(toLinkDto(link));
});

linksRouter.get('/api/links', async (req, res) => {
  const query = listLinksQuerySchema.parse(req.query);
  const page = await listLinks(actorOf(req).id, query);

  res.json({ ...page, items: page.items.map(toLinkDto) });
});

linksRouter.get('/api/links/:id', async (req, res) => {
  const link = await getLink(actorOf(req).id, linkIdFrom(req.params.id));
  res.json(toLinkDto(link));
});

linksRouter.patch('/api/links/:id', async (req, res) => {
  const patch = updateLinkSchema.parse(req.body);
  const link = await updateLink(actorOf(req).id, linkIdFrom(req.params.id), patch);

  res.json(toLinkDto(link));
});

linksRouter.delete('/api/links/:id', async (req, res) => {
  await deleteLink(actorOf(req).id, linkIdFrom(req.params.id));
  res.status(204).end();
});
