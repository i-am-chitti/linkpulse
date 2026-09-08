import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';

/**
 * What the redirect captures. Deliberately raw: parsing the user agent and
 * resolving the IP happen in the worker, so the hot path only serialises the
 * few strings it already has in hand.
 */
export interface ClickEvent {
  linkId: string;
  ip: string | null;
  userAgent: string | null;
  referrer: string | null;
  /** ISO-8601 instant of the click. */
  at: string;
}

export const CLICK_QUEUE_KEY = 'clicks:queue';

/**
 * Records a click without making the visitor wait for it.
 *
 * Never awaited by the redirect: the response is already on the wire by the
 * time this runs, and a click that fails to enqueue is a lost analytics row,
 * not a failed redirect. Errors are logged and swallowed for that reason.
 *
 * The queue is capped. If the worker stops, an uncapped list would grow until
 * Redis hit its maxmemory limit and started evicting - and since the same Redis
 * holds the URL cache and rate-limit counters, that would turn a stalled
 * worker into a site-wide outage. Trimming keeps the newest events and drops
 * the oldest, which is the right way round: recent analytics matter more, and
 * bounded memory matters more than either.
 */
export async function enqueueClick(event: ClickEvent): Promise<void> {
  try {
    await redis
      .multi()
      .lpush(CLICK_QUEUE_KEY, JSON.stringify(event))
      .ltrim(CLICK_QUEUE_KEY, 0, env.CLICK_QUEUE_MAX_LENGTH - 1)
      .exec();
  } catch (error) {
    logger.warn({ err: error, linkId: event.linkId }, 'failed to enqueue click');
  }
}

/**
 * Takes up to `count` events off the queue.
 *
 * RPOP against an LPUSH producer makes this FIFO, so events are processed in
 * roughly the order they happened.
 *
 * This is at-most-once: the events are gone from Redis before they are
 * written, so a crash mid-batch loses that batch. That is a deliberate trade -
 * at-least-once would need a processing list or a consumer group, and the cost
 * of the simpler design is a handful of analytics rows on an unclean shutdown,
 * never a wrong redirect. Redis Streams with a consumer group is the upgrade
 * path if those rows ever need to be exact.
 */
export async function dequeueClicks(count: number): Promise<ClickEvent[]> {
  const popped = await redis.rpop(CLICK_QUEUE_KEY, count);
  if (popped && popped.length > 0) return parseEvents(popped);

  // Nothing waiting: block briefly rather than spinning on an empty queue.
  const blocked = await redis.brpop(CLICK_QUEUE_KEY, env.CLICK_BLOCK_SECONDS);
  if (!blocked) return [];

  // One arrived; sweep up anything that landed alongside it.
  const alongside = await redis.rpop(CLICK_QUEUE_KEY, count - 1);
  return parseEvents([blocked[1], ...(alongside ?? [])]);
}

export async function queueLength(): Promise<number> {
  return redis.llen(CLICK_QUEUE_KEY);
}

function parseEvents(raw: string[]): ClickEvent[] {
  const events: ClickEvent[] = [];

  for (const entry of raw) {
    try {
      events.push(JSON.parse(entry) as ClickEvent);
    } catch {
      // A single malformed entry must not poison the whole batch.
      logger.warn({ entry }, 'discarding unparseable click event');
    }
  }

  return events;
}
