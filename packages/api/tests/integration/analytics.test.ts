// Analytics aggregation against real Postgres. The clicks are inserted
// directly rather than driven through redirects, so each test controls the
// exact shape of the data it is asserting on.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { redis } from '../../src/lib/redis.js';
import type { DeviceType } from '../../src/generated/prisma/enums.js';

const app = createApp();

interface Actor {
  token: string;
  userId: string;
}

async function signUp(email: string): Promise<Actor> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'correct-horse-battery' });

  expect(res.status, `signUp(${email}) failed: ${JSON.stringify(res.body)}`).toBe(201);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

function get(actor: Actor, path: string) {
  return request(app).get(path).set('Authorization', `Bearer ${actor.token}`);
}

async function seedLink(actor: Actor, shortCode = 'stats01') {
  return prisma.link.create({
    data: { shortCode, originalUrl: 'https://example.com/tracked', userId: actor.userId },
  });
}

interface ClickSpec {
  day: string;
  ip?: string | null;
  country?: string | null;
  city?: string | null;
  device?: DeviceType;
  browser?: string | null;
  referrer?: string | null;
  at?: string;
}

async function seedClicks(linkId: string, specs: ClickSpec[]) {
  await prisma.click.createMany({
    data: specs.map((spec) => ({
      linkId,
      ipAddress: spec.ip === undefined ? '8.8.8.8' : spec.ip,
      country: spec.country ?? null,
      city: spec.city ?? null,
      deviceType: spec.device ?? 'DESKTOP',
      browser: spec.browser ?? null,
      referrer: spec.referrer ?? null,
      clickedAt: new Date(spec.at ?? `${spec.day}T12:00:00.000Z`),
      clickDate: new Date(`${spec.day}T00:00:00.000Z`),
    })),
  });
}

/** Today in UTC, so tests that rely on CURRENT_DATE stay stable. */
function utcToday(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE users, links, clicks, refresh_tokens CASCADE');
  const cached = await redis.keys('url:*');
  if (cached.length > 0) await redis.del(...cached);
});

afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE users, links, clicks, refresh_tokens CASCADE');
  await prisma.$disconnect();
  await redis.quit();
});

describe('access control', () => {
  it.each(['/analytics', '/analytics/summary'])(
    'rejects anonymous access to %s',
    async (suffix) => {
      const actor = await signUp('owner@example.com');
      const link = await seedLink(actor);

      const res = await request(app).get(`/api/links/${link.id}${suffix}`);

      expect(res.status).toBe(401);
    },
  );

  it.each(['/analytics', '/analytics/summary'])(
    '404s another user’s link on %s',
    async (suffix) => {
      const owner = await signUp('owner@example.com');
      const stranger = await signUp('stranger@example.com');
      const link = await seedLink(owner);

      const res = await get(stranger, `/api/links/${link.id}${suffix}`);

      expect(res.status).toBe(404);
    },
  );

  it('404s a guest link, which nobody owns', async () => {
    // This is how "guest mode has no analytics" is enforced: by ownership,
    // not by a separate rule that could be forgotten.
    const actor = await signUp('owner@example.com');
    const guestLink = await prisma.link.create({
      data: { shortCode: 'guest01', originalUrl: 'https://example.com', userId: null },
    });

    const res = await get(actor, `/api/links/${guestLink.id}/analytics`);

    expect(res.status).toBe(404);
  });

  it('404s a malformed id rather than failing on the uuid cast', async () => {
    const actor = await signUp('owner@example.com');

    expect((await get(actor, '/api/links/not-a-uuid/analytics')).status).toBe(404);
  });
});

describe('GET /api/links/:id/analytics', () => {
  it('reports totals and distinct visitors separately', async () => {
    const actor = await signUp('owner@example.com');
    const link = await seedLink(actor);
    await seedClicks(link.id, [
      { day: '2026-09-01', ip: '8.8.8.8' },
      { day: '2026-09-01', ip: '8.8.8.8' },
      { day: '2026-09-02', ip: '1.1.1.1' },
      { day: '2026-09-02', ip: '9.9.9.9' },
    ]);

    const res = await get(actor, `/api/links/${link.id}/analytics?from=2026-09-01&to=2026-09-07`);

    expect(res.status).toBe(200);
    expect(res.body.totalClicks).toBe(4);
    expect(res.body.uniqueVisitors).toBe(3);
    expect(res.body.period).toEqual({ from: '2026-09-01', to: '2026-09-07' });
  });

  it('returns numbers, not stringified bigints', async () => {
    // Postgres COUNT is bigint; without the ::int casts these would serialise
    // as strings or throw outright.
    const actor = await signUp('owner@example.com');
    const link = await seedLink(actor);
    await seedClicks(link.id, [{ day: '2026-09-01' }]);

    const res = await get(actor, `/api/links/${link.id}/analytics?from=2026-09-01&to=2026-09-01`);

    expect(res.body.totalClicks).toBeTypeOf('number');
    expect(res.body.clicksByDay[0].clicks).toBeTypeOf('number');
    expect(res.body.topCountries[0]?.clicks).toBeTypeOf('number');
  });

  it('emits a row for every day in the range, including quiet ones', async () => {
    // The chart needs a zero, not a gap.
    const actor = await signUp('owner@example.com');
    const link = await seedLink(actor);
    await seedClicks(link.id, [
      { day: '2026-09-01' },
      { day: '2026-09-01' },
      { day: '2026-09-04' },
    ]);

    const res = await get(actor, `/api/links/${link.id}/analytics?from=2026-09-01&to=2026-09-05`);

    expect(res.body.clicksByDay).toEqual([
      { date: '2026-09-01', clicks: 2 },
      { date: '2026-09-02', clicks: 0 },
      { date: '2026-09-03', clicks: 0 },
      { date: '2026-09-04', clicks: 1 },
      { date: '2026-09-05', clicks: 0 },
    ]);
  });

  it('excludes clicks outside the requested window', async () => {
    const actor = await signUp('owner@example.com');
    const link = await seedLink(actor);
    await seedClicks(link.id, [
      { day: '2026-08-31' },
      { day: '2026-09-01' },
      { day: '2026-09-08' },
    ]);

    const res = await get(actor, `/api/links/${link.id}/analytics?from=2026-09-01&to=2026-09-07`);

    expect(res.body.totalClicks).toBe(1);
  });

  it('includes both boundary days', async () => {
    const actor = await signUp('owner@example.com');
    const link = await seedLink(actor);
    await seedClicks(link.id, [{ day: '2026-09-01' }, { day: '2026-09-07' }]);

    const res = await get(actor, `/api/links/${link.id}/analytics?from=2026-09-01&to=2026-09-07`);

    expect(res.body.totalClicks).toBe(2);
  });

  it('ranks countries and labels missing ones', async () => {
    const actor = await signUp('owner@example.com');
    const link = await seedLink(actor);
    await seedClicks(link.id, [
      { day: '2026-09-01', country: 'IN' },
      { day: '2026-09-01', country: 'IN' },
      { day: '2026-09-01', country: 'IN' },
      { day: '2026-09-01', country: 'US' },
      { day: '2026-09-01', country: null },
    ]);

    const res = await get(actor, `/api/links/${link.id}/analytics?from=2026-09-01&to=2026-09-01`);

    expect(res.body.topCountries).toEqual([
      { country: 'IN', clicks: 3 },
      { country: 'US', clicks: 1 },
      { country: 'Unknown', clicks: 1 },
    ]);
  });

  it('zero-fills every device bucket so the chart always has all slices', async () => {
    const actor = await signUp('owner@example.com');
    const link = await seedLink(actor);
    await seedClicks(link.id, [
      { day: '2026-09-01', device: 'MOBILE' },
      { day: '2026-09-01', device: 'MOBILE' },
      { day: '2026-09-01', device: 'DESKTOP' },
    ]);

    const res = await get(actor, `/api/links/${link.id}/analytics?from=2026-09-01&to=2026-09-01`);

    // Lowercase keys: the column is an uppercase enum, the contract is not.
    expect(res.body.deviceBreakdown).toEqual({
      mobile: 2,
      desktop: 1,
      tablet: 0,
      unknown: 0,
    });
  });

  it('collapses the browser long tail into Other, and the shares still add up', async () => {
    const actor = await signUp('owner@example.com');
    const link = await seedLink(actor);
    // 11 distinct browsers against a top-10 cut, so exactly one falls outside.
    const browsers = Array.from({ length: 11 }, (_, i) => `Browser${String(i).padStart(2, '0')}`);
    await seedClicks(
      link.id,
      browsers.flatMap((browser, i) =>
        // Descending counts, so the last browser is the one cut.
        Array.from({ length: 11 - i }, () => ({ day: '2026-09-01', browser })),
      ),
    );

    const res = await get(actor, `/api/links/${link.id}/analytics?from=2026-09-01&to=2026-09-01`);

    const breakdown = res.body.browserBreakdown as Record<string, number>;
    expect(breakdown.Other).toBe(1);
    const summed = Object.values(breakdown).reduce((a, b) => a + b, 0);
    expect(summed).toBe(res.body.totalClicks);
  });

  it('omits Other when nothing falls outside the top slice', async () => {
    const actor = await signUp('owner@example.com');
    const link = await seedLink(actor);
    await seedClicks(link.id, [
      { day: '2026-09-01', browser: 'Chrome' },
      { day: '2026-09-01', browser: 'Safari' },
    ]);

    const res = await get(actor, `/api/links/${link.id}/analytics?from=2026-09-01&to=2026-09-01`);

    expect(res.body.browserBreakdown).toEqual({ Chrome: 1, Safari: 1 });
  });

  it('labels a null referrer as direct', async () => {
    const actor = await signUp('owner@example.com');
    const link = await seedLink(actor);
    await seedClicks(link.id, [
      { day: '2026-09-01', referrer: 'twitter.com' },
      { day: '2026-09-01', referrer: 'twitter.com' },
      { day: '2026-09-01', referrer: null },
    ]);

    const res = await get(actor, `/api/links/${link.id}/analytics?from=2026-09-01&to=2026-09-01`);

    expect(res.body.topReferrers).toEqual([
      { referrer: 'twitter.com', clicks: 2 },
      { referrer: 'direct', clicks: 1 },
    ]);
  });

  it('orders ties deterministically rather than by planner whim', async () => {
    const actor = await signUp('owner@example.com');
    const link = await seedLink(actor);
    await seedClicks(link.id, [
      { day: '2026-09-01', country: 'ZW' },
      { day: '2026-09-01', country: 'AU' },
      { day: '2026-09-01', country: 'MX' },
    ]);

    const res = await get(actor, `/api/links/${link.id}/analytics?from=2026-09-01&to=2026-09-01`);

    // All tied on 1, so the label breaks the tie ascending.
    expect(res.body.topCountries.map((c: { country: string }) => c.country)).toEqual([
      'AU',
      'MX',
      'ZW',
    ]);
  });

  it('returns an empty but well-formed payload for a link with no clicks', async () => {
    const actor = await signUp('owner@example.com');
    const link = await seedLink(actor);

    const res = await get(actor, `/api/links/${link.id}/analytics?from=2026-09-01&to=2026-09-02`);

    expect(res.body).toMatchObject({
      totalClicks: 0,
      uniqueVisitors: 0,
      topCountries: [],
      topReferrers: [],
      browserBreakdown: {},
      deviceBreakdown: { mobile: 0, desktop: 0, tablet: 0, unknown: 0 },
    });
    // The day series is still complete.
    expect(res.body.clicksByDay).toEqual([
      { date: '2026-09-01', clicks: 0 },
      { date: '2026-09-02', clicks: 0 },
    ]);
  });

  it('counts a click whose ip was nulled by retention, but not as unique', async () => {
    const actor = await signUp('owner@example.com');
    const link = await seedLink(actor);
    await seedClicks(link.id, [
      { day: '2026-09-01', ip: null, country: 'IN', device: 'MOBILE' },
      { day: '2026-09-01', ip: '8.8.8.8', country: 'IN' },
    ]);

    const res = await get(actor, `/api/links/${link.id}/analytics?from=2026-09-01&to=2026-09-01`);

    expect(res.body.totalClicks).toBe(2);
    // COUNT(DISTINCT ip_address) skips nulls; the derived country survives.
    expect(res.body.uniqueVisitors).toBe(1);
    expect(res.body.topCountries).toEqual([{ country: 'IN', clicks: 2 }]);
  });

  it('never mixes in another link’s clicks', async () => {
    const actor = await signUp('owner@example.com');
    const mine = await seedLink(actor, 'mine001');
    const other = await seedLink(actor, 'other01');
    await seedClicks(mine.id, [{ day: '2026-09-01' }]);
    await seedClicks(other.id, [{ day: '2026-09-01' }, { day: '2026-09-01' }]);

    const res = await get(actor, `/api/links/${mine.id}/analytics?from=2026-09-01&to=2026-09-01`);

    expect(res.body.totalClicks).toBe(1);
  });

  it('defaults to the trailing 30 days when no range is given', async () => {
    const actor = await signUp('owner@example.com');
    const link = await seedLink(actor);
    await seedClicks(link.id, [{ day: utcToday() }, { day: utcToday(-40) }]);

    const res = await get(actor, `/api/links/${link.id}/analytics`);

    expect(res.body.totalClicks).toBe(1);
    expect(res.body.clicksByDay).toHaveLength(30);
  });

  it.each([
    ['an inverted range', 'from=2026-09-07&to=2026-09-01'],
    ['an over-long range', 'from=2024-01-01&to=2026-09-01'],
    ['a malformed date', 'from=2026-9-1'],
  ])('rejects %s', async (_label, query) => {
    const actor = await signUp('owner@example.com');
    const link = await seedLink(actor);

    const res = await get(actor, `/api/links/${link.id}/analytics?${query}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/links/:id/analytics/summary', () => {
  it('reports all-time totals and the rolling windows', async () => {
    const actor = await signUp('owner@example.com');
    const link = await seedLink(actor);
    await seedClicks(link.id, [
      { day: utcToday(), ip: '8.8.8.8' },
      { day: utcToday(-3), ip: '8.8.8.8' },
      { day: utcToday(-20), ip: '1.1.1.1' },
      { day: utcToday(-100), ip: '9.9.9.9' },
    ]);

    const res = await get(actor, `/api/links/${link.id}/analytics/summary`);

    expect(res.status).toBe(200);
    expect(res.body.totalClicks).toBe(4);
    expect(res.body.uniqueVisitors).toBe(3);
    expect(res.body.clicksLast7Days).toBe(2);
    expect(res.body.clicksLast30Days).toBe(3);
  });

  it('names the leading country, referrer and device', async () => {
    const actor = await signUp('owner@example.com');
    const link = await seedLink(actor);
    await seedClicks(link.id, [
      { day: utcToday(), country: 'IN', referrer: 'twitter.com', device: 'MOBILE' },
      { day: utcToday(), country: 'IN', referrer: 'twitter.com', device: 'MOBILE' },
      { day: utcToday(), country: 'US', referrer: null, device: 'DESKTOP' },
    ]);

    const res = await get(actor, `/api/links/${link.id}/analytics/summary`);

    expect(res.body.topCountry).toBe('IN');
    expect(res.body.topReferrer).toBe('twitter.com');
    expect(res.body.topDevice).toBe('mobile');
  });

  it('reports the most recent click time', async () => {
    const actor = await signUp('owner@example.com');
    const link = await seedLink(actor);
    await seedClicks(link.id, [
      { day: '2026-09-01', at: '2026-09-01T08:00:00.000Z' },
      { day: '2026-09-01', at: '2026-09-01T18:30:00.000Z' },
    ]);

    const res = await get(actor, `/api/links/${link.id}/analytics/summary`);

    expect(res.body.lastClickedAt).toBe('2026-09-01T18:30:00.000Z');
  });

  it('returns zeroes and nulls for a link that has never been clicked', async () => {
    const actor = await signUp('owner@example.com');
    const link = await seedLink(actor);

    const res = await get(actor, `/api/links/${link.id}/analytics/summary`);

    expect(res.body).toMatchObject({
      totalClicks: 0,
      uniqueVisitors: 0,
      clicksLast7Days: 0,
      clicksLast30Days: 0,
      topCountry: null,
      topReferrer: null,
      topDevice: null,
      lastClickedAt: null,
    });
  });

  it('ignores countries that are entirely unknown rather than reporting Unknown', async () => {
    const actor = await signUp('owner@example.com');
    const link = await seedLink(actor);
    await seedClicks(link.id, [{ day: utcToday(), country: null }]);

    const res = await get(actor, `/api/links/${link.id}/analytics/summary`);

    expect(res.body.topCountry).toBeNull();
  });
});

describe('the index the aggregations depend on', () => {
  it('covers link_id, click_date and ip_address in that order', () => {
    /**
     * Asserted by definition rather than by EXPLAIN.
     *
     * Every query in analyticsService filters on (link_id, click_date), and
     * unique visitors additionally reads ip_address - so with these three
     * columns in this order Postgres can answer them from the index alone,
     * with no heap fetches. Measured on 200k rows, that is an Index Only Scan
     * with Heap Fetches: 0.
     *
     * A plan assertion would be the more direct test, but plans legitimately
     * change with table size and statistics, so it would flake on the small
     * fixtures these tests use. The column order is the actual contract.
     */
    return expect(
      prisma.$queryRaw<Array<{ indexdef: string }>>`
        SELECT indexdef FROM pg_indexes
         WHERE tablename = 'clicks'
           AND indexname = 'clicks_link_id_click_date_ip_address_idx'
      `,
    ).resolves.toEqual([
      expect.objectContaining({
        indexdef: expect.stringContaining('(link_id, click_date, ip_address)'),
      }),
    ]);
  });
});
