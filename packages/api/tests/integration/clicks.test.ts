// End-to-end click tracking: a redirect enqueues, the worker drains, and the
// rows plus the denormalized counter land together.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { redis } from '../../src/lib/redis.js';
import {
  CLICK_QUEUE_KEY,
  dequeueClicks,
  enqueueClick,
  queueLength,
  type ClickEvent,
} from '../../src/services/clickQueue.js';
import { processClickBatch } from '../../src/workers/clickProcessor.js';

const app = createApp();

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

async function seedLink(shortCode = 'click01') {
  return prisma.link.create({
    data: { shortCode, originalUrl: `https://example.com/${shortCode}` },
  });
}

function eventFor(linkId: string, overrides: Partial<ClickEvent> = {}): ClickEvent {
  return {
    linkId,
    ip: '8.8.8.8',
    userAgent: CHROME_MAC,
    referrer: 'https://twitter.com/x/status/1',
    at: new Date().toISOString(),
    ...overrides,
  };
}

/** Drains the queue the way the worker does, without running the worker loop. */
async function drain(): Promise<number> {
  let total = 0;
  for (;;) {
    const events = await redis.rpop(CLICK_QUEUE_KEY, 100);
    if (!events || events.length === 0) break;
    const parsed = events.map((raw) => JSON.parse(raw) as ClickEvent);
    total += (await processClickBatch(parsed)).inserted;
  }
  return total;
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE users, links, clicks CASCADE');
  await redis.del(CLICK_QUEUE_KEY);
  const cached = await redis.keys('url:*');
  if (cached.length > 0) await redis.del(...cached);
});

afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE users, links, clicks CASCADE');
  await redis.del(CLICK_QUEUE_KEY);
  await prisma.$disconnect();
  await redis.quit();
});

describe('the redirect path', () => {
  it('queues a click without writing to Postgres first', async () => {
    const link = await seedLink();

    await request(app).get('/click01').set('user-agent', CHROME_MAC);

    // The response is served before the write; the row appears only after the
    // worker runs.
    await expect.poll(() => queueLength()).toBe(1);
    expect(await prisma.click.count()).toBe(0);
    expect(link.clickCount).toBe(0);
  });

  it('captures the request fields the worker needs', async () => {
    const link = await seedLink();

    await request(app)
      .get('/click01')
      .set('user-agent', CHROME_MAC)
      .set('referer', 'https://news.ycombinator.com/item?id=1');

    await expect.poll(() => queueLength()).toBe(1);
    const [event] = await dequeueClicks(10);

    expect(event).toMatchObject({
      linkId: link.id,
      userAgent: CHROME_MAC,
      referrer: 'https://news.ycombinator.com/item?id=1',
    });
    expect(new Date(event!.at).getTime()).toBeGreaterThan(Date.now() - 10_000);
  });

  it('does not queue a click for a 404', async () => {
    await request(app).get('/nosuch1');

    expect(await queueLength()).toBe(0);
  });

  it('does not queue a click for a disabled link', async () => {
    await prisma.link.create({
      data: { shortCode: 'off1234', originalUrl: 'https://example.com', isActive: false },
    });

    const res = await request(app).get('/off1234');

    expect(res.status).toBe(410);
    expect(await queueLength()).toBe(0);
  });

  it('bounds the queue so a stopped worker cannot exhaust redis', async () => {
    // CLICK_QUEUE_MAX_LENGTH is pinned to 100 for this suite; see vitest.config.ts.
    const link = await seedLink();
    const event = eventFor(link.id);
    for (let i = 0; i < 130; i += 1) {
      await enqueueClick(event);
    }

    expect(await queueLength()).toBe(100);
  });
});

describe('processClickBatch', () => {
  it('enriches a raw event into a full analytics row', async () => {
    const link = await seedLink();
    await enqueueClick(eventFor(link.id));

    const result = await processClickBatch(await dequeueClicks(10));
    expect(result).toEqual({ inserted: 1, linksTouched: 1 });

    const click = await prisma.click.findFirstOrThrow({ where: { linkId: link.id } });
    expect(click.country).toBe('US');
    expect(click.deviceType).toBe('DESKTOP');
    expect(click.browser).toBe('Chrome');
    expect(click.os).toBe('macOS');
    // Stored as the host, not the full URL with its query string.
    expect(click.referrer).toBe('twitter.com');
    expect(click.ipAddress).toBe('8.8.8.8');
  });

  it('derives click_date as the UTC day of the click', async () => {
    const link = await seedLink();
    // Late-evening UTC: a local-time conversion would file this on the 2nd.
    await enqueueClick(eventFor(link.id, { at: '2026-09-01T23:30:00.000Z' }));

    await processClickBatch(await dequeueClicks(10));

    const click = await prisma.click.findFirstOrThrow({ where: { linkId: link.id } });
    expect(click.clickDate.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('increments click_count once per event, in one statement', async () => {
    const link = await seedLink();
    for (let i = 0; i < 7; i += 1) {
      await enqueueClick(eventFor(link.id));
    }

    const result = await processClickBatch(await dequeueClicks(100));

    expect(result).toEqual({ inserted: 7, linksTouched: 1 });
    const updated = await prisma.link.findUniqueOrThrow({ where: { id: link.id } });
    expect(updated.clickCount).toBe(7);
  });

  it('splits counters correctly across links in one batch', async () => {
    const first = await seedLink('multi01');
    const second = await seedLink('multi02');

    await Promise.all([
      enqueueClick(eventFor(first.id)),
      enqueueClick(eventFor(first.id)),
      enqueueClick(eventFor(second.id)),
    ]);

    const result = await processClickBatch(await dequeueClicks(100));
    expect(result).toEqual({ inserted: 3, linksTouched: 2 });

    expect((await prisma.link.findUniqueOrThrow({ where: { id: first.id } })).clickCount).toBe(2);
    expect((await prisma.link.findUniqueOrThrow({ where: { id: second.id } })).clickCount).toBe(1);
  });

  it('accumulates across batches instead of overwriting', async () => {
    const link = await seedLink();

    for (const round of [3, 4]) {
      for (let i = 0; i < round; i += 1) await enqueueClick(eventFor(link.id));
      await processClickBatch(await dequeueClicks(100));
    }

    const updated = await prisma.link.findUniqueOrThrow({ where: { id: link.id } });
    expect(updated.clickCount).toBe(7);
  });

  it('drops events for a deleted link rather than failing the batch', async () => {
    // A link can be deleted between the redirect and the worker draining it.
    // The foreign key would abort the transaction and lose every good event.
    const survivor = await seedLink('alive01');
    const doomed = await seedLink('dead001');

    await enqueueClick(eventFor(survivor.id));
    await enqueueClick(eventFor(doomed.id));
    await prisma.link.delete({ where: { id: doomed.id } });

    const result = await processClickBatch(await dequeueClicks(100));

    expect(result).toEqual({ inserted: 1, linksTouched: 1 });
    expect(await prisma.click.count()).toBe(1);
  });

  it('records a private-ip click with no location rather than skipping it', async () => {
    const link = await seedLink();
    await enqueueClick(eventFor(link.id, { ip: '10.1.2.3' }));

    await processClickBatch(await dequeueClicks(10));

    const click = await prisma.click.findFirstOrThrow({ where: { linkId: link.id } });
    expect(click.country).toBeNull();
    expect(click.ipAddress).toBe('10.1.2.3');
  });

  it('is a no-op on an empty batch', async () => {
    expect(await processClickBatch([])).toEqual({ inserted: 0, linksTouched: 0 });
  });

  it('survives a malformed queue entry', async () => {
    const link = await seedLink();
    await redis.lpush(CLICK_QUEUE_KEY, 'not-json-at-all');
    await enqueueClick(eventFor(link.id));

    const events = await dequeueClicks(100);

    // The bad entry is discarded; the good one still processes.
    expect(events).toHaveLength(1);
    expect((await processClickBatch(events)).inserted).toBe(1);
  });
});

describe('redirect to counted click, end to end', () => {
  it('counts three real redirects once the worker drains', async () => {
    const link = await seedLink();

    for (let i = 0; i < 3; i += 1) {
      const res = await request(app).get('/click01').set('user-agent', CHROME_MAC);
      expect(res.status).toBe(302);
    }

    await expect.poll(() => queueLength()).toBe(3);
    expect(await drain()).toBe(3);

    const updated = await prisma.link.findUniqueOrThrow({ where: { id: link.id } });
    expect(updated.clickCount).toBe(3);
    expect(await prisma.click.count({ where: { linkId: link.id } })).toBe(3);
  });
});
