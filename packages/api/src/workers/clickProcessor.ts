import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { lookupLocation, normalizeIp } from '../utils/geoip.js';
import { normalizeReferrer } from '../utils/referrer.js';
import { parseUserAgent } from '../utils/userAgent.js';
import type { ClickEvent } from '../services/clickQueue.js';

/** The UTC calendar day of an instant, matching the clicks.click_date column. */
function utcDay(instant: Date): Date {
  return new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()));
}

/** Enriches a raw event into the row shape, doing all the parsing work here. */
function toClickRow(event: ClickEvent) {
  const clickedAt = new Date(event.at);
  const ip = normalizeIp(event.ip);
  const { country, city } = lookupLocation(ip);
  const { deviceType, browser, os } = parseUserAgent(event.userAgent);

  return {
    linkId: event.linkId,
    ipAddress: ip,
    country,
    city,
    deviceType,
    browser,
    os,
    referrer: normalizeReferrer(event.referrer),
    clickedAt,
    clickDate: utcDay(clickedAt),
  };
}

/** Counts events per link, so each link's counter is bumped once per batch. */
function tallyByLink(events: ClickEvent[]): Map<string, number> {
  const tally = new Map<string, number>();
  for (const event of events) {
    tally.set(event.linkId, (tally.get(event.linkId) ?? 0) + 1);
  }
  return tally;
}

/**
 * Bumps every affected link's denormalized counter in one statement.
 *
 * A batch of 100 clicks usually spans far fewer links, so this joins against a
 * VALUES list rather than issuing an UPDATE per link. The increment is done in
 * SQL (`click_count + delta`) rather than by reading and writing back, so
 * concurrent workers cannot clobber each other's counts.
 */
function buildCounterUpdate(tally: Map<string, number>): Prisma.Sql {
  const rows = [...tally].map(
    ([linkId, delta]) => Prisma.sql`(CAST(${linkId} AS uuid), CAST(${delta} AS integer))`,
  );

  return Prisma.sql`
    UPDATE links
       SET click_count = links.click_count + delta.amount
      FROM (VALUES ${Prisma.join(rows)}) AS delta(link_id, amount)
     WHERE links.id = delta.link_id
  `;
}

export interface ProcessResult {
  /** Click rows written. Lower than the batch size when links were deleted. */
  inserted: number;
  /** Links whose counter was bumped. */
  linksTouched: number;
}

/**
 * Writes one batch of clicks.
 *
 * The insert and the counter update share a transaction, so click_count can
 * never drift away from the rows it is meant to summarise.
 *
 * skipDuplicates is not used and createMany does not validate foreign keys up
 * front, so a click for a link deleted since the redirect would abort the whole
 * transaction. Those events are filtered out first instead, letting one dead
 * link cost its own events rather than the entire batch.
 */
export async function processClickBatch(events: ClickEvent[]): Promise<ProcessResult> {
  if (events.length === 0) return { inserted: 0, linksTouched: 0 };

  const tally = tallyByLink(events);

  const liveLinks = await prisma.link.findMany({
    where: { id: { in: [...tally.keys()] } },
    select: { id: true },
  });
  const liveIds = new Set(liveLinks.map((link) => link.id));

  const writable = events.filter((event) => liveIds.has(event.linkId));
  const dropped = events.length - writable.length;
  if (dropped > 0) {
    logger.warn({ dropped }, 'discarded clicks for links that no longer exist');
  }

  if (writable.length === 0) return { inserted: 0, linksTouched: 0 };

  const writableTally = tallyByLink(writable);
  const rows = writable.map(toClickRow);

  await prisma.$transaction([
    prisma.click.createMany({ data: rows }),
    prisma.$executeRaw(buildCounterUpdate(writableTally)),
  ]);

  return { inserted: rows.length, linksTouched: writableTally.size };
}
