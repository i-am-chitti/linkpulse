import { prisma } from '../lib/prisma.js';

/**
 * Deletes guest links (userId null) past their expiry. Clicks cascade away
 * with them via the schema's ON DELETE CASCADE.
 *
 * Scoped to guest links only, not every expired link: an authenticated
 * user's expired link already 410s on redirect (see urlService.resolveShortCode),
 * but its row - and any analytics history it accumulated before expiring -
 * stays until the owner explicitly deletes it via DELETE /api/links/:id.
 * Silently destroying someone's click history because a date passed would be
 * a surprising, undisclosed data-retention policy; a guest link has no owner
 * to surprise and, per guest mode's own rules, no analytics to lose.
 */
export async function purgeExpiredGuestLinks(): Promise<number> {
  const { count } = await prisma.link.deleteMany({
    where: { userId: null, expiresAt: { lt: new Date() } },
  });
  return count;
}
