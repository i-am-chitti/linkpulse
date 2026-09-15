/**
 * Owner-scoped link operations, for the dashboard.
 *
 * Separate from urlService, which owns the redirect hot path. The split is
 * deliberate: everything here runs a handful of times per page load and may
 * take its time, while resolveShortCode runs thousands of times a second.
 */
import type { ListLinksQuery, Paginated, UpdateLinkInput } from '@linkpulse/shared';
import { Prisma } from './../generated/prisma/client.js';
import type { Link } from './../generated/prisma/client.js';
import { notFound } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { invalidateLink } from './cacheService.js';

/** Prisma's "record required but not found". */
const RECORD_NOT_FOUND = 'P2025';

/**
 * Ownership is enforced in the WHERE clause, and a link owned by someone else
 * is reported as 404 rather than 403.
 *
 * 403 would confirm that the id exists, letting anyone probe for valid link
 * ids. 404 tells an unauthorised caller nothing it did not already know.
 */
function ownedBy(userId: string, id: string) {
  return { id, userId };
}

export async function listLinks(userId: string, query: ListLinksQuery): Promise<Paginated<Link>> {
  const where: Prisma.LinkWhereInput = { userId };

  if (query.search) {
    /**
     * Substring search across both the code and the destination.
     *
     * This compiles to ILIKE '%term%', which cannot use a B-tree index and so
     * scans the user's links. Fine at dashboard scale - the query is already
     * restricted to one owner. A pg_trgm GIN index is the fix if a single
     * account ever holds enough links for it to matter.
     */
    where.OR = [
      { shortCode: { contains: query.search, mode: 'insensitive' } },
      { originalUrl: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  if (query.isActive !== undefined) {
    where.isActive = query.isActive;
  }

  // createdTo's day is inclusive, so the upper bound is the start of the
  // *next* UTC day - createdAt is a precise timestamp, not a calendar day
  // column, so "on or before 2026-03-05" means "before 2026-03-06T00:00:00Z".
  if (query.createdFrom || query.createdTo) {
    where.createdAt = {
      ...(query.createdFrom ? { gte: new Date(`${query.createdFrom}T00:00:00.000Z`) } : {}),
      ...(query.createdTo
        ? { lt: new Date(new Date(`${query.createdTo}T00:00:00.000Z`).getTime() + 86_400_000) }
        : {}),
    };
  }

  // One transaction so the count cannot disagree with the page contents.
  const [total, items] = await prisma.$transaction([
    prisma.link.count({ where }),
    prisma.link.findMany({
      where,
      // Matches the (user_id, created_at DESC) index.
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function getLink(userId: string, id: string): Promise<Link> {
  const link = await prisma.link.findFirst({ where: ownedBy(userId, id) });
  if (!link) throw notFound('No such link');
  return link;
}

/**
 * Applies a partial update and drops the cached copy.
 *
 * The invalidation is the whole point of doing this through a service. Every
 * field this endpoint can change is one the redirect path caches:
 *
 * - originalUrl: a stale entry would keep sending visitors to the old target
 * - isActive:    deactivating would not take effect for up to an hour, and
 *                reactivating would stay blocked by the cached 410
 * - expiresAt:   the cached TTL was clamped to the *previous* expiry
 *
 * So the cache is dropped on any successful update rather than only when the
 * URL changes - there is no version of this where a stale entry is acceptable,
 * and one extra DEL is cheaper than reasoning about which fields are safe.
 */
export async function updateLink(
  userId: string,
  id: string,
  patch: UpdateLinkInput,
): Promise<Link> {
  // Scoped read first: it both enforces ownership and gets the short code,
  // which is the cache key and is not part of the patch.
  const existing = await prisma.link.findFirst({
    where: ownedBy(userId, id),
    select: { id: true, shortCode: true },
  });
  if (!existing) throw notFound('No such link');

  const data: Prisma.LinkUpdateInput = {};
  if (patch.url !== undefined) data.originalUrl = patch.url;
  if (patch.isActive !== undefined) data.isActive = patch.isActive;
  if (patch.expiresAt !== undefined) data.expiresAt = patch.expiresAt;

  try {
    const updated = await prisma.link.update({ where: { id: existing.id }, data });
    await invalidateLink(existing.shortCode);
    return updated;
  } catch (error) {
    // Deleted in the window between the read above and this write.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === RECORD_NOT_FOUND) {
      throw notFound('No such link');
    }
    throw error;
  }
}

/**
 * Deletes a link and drops its cached entry.
 *
 * Clicks go with it via ON DELETE CASCADE. Without the invalidation the code
 * would keep redirecting from cache until its TTL expired, despite the row
 * being gone.
 */
export async function deleteLink(userId: string, id: string): Promise<void> {
  const existing = await prisma.link.findFirst({
    where: ownedBy(userId, id),
    select: { id: true, shortCode: true },
  });
  if (!existing) throw notFound('No such link');

  const { count } = await prisma.link.deleteMany({ where: ownedBy(userId, id) });
  if (count === 0) throw notFound('No such link');

  await invalidateLink(existing.shortCode);
}
