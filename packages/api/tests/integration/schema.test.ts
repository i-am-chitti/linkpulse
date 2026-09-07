// Exercises the schema against a real Postgres, because the things worth
// checking here are database behaviours Prisma's types cannot express:
// constraints, cascades, and whether the unique-visitor index actually
// supports the aggregation it exists for.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import { Prisma } from '../../src/generated/prisma/client.js';

const UTC_DAY = new Date('2026-09-01T00:00:00.000Z');

async function truncateAll(): Promise<void> {
  // CASCADE follows the foreign keys, so clicks and links go with users.
  await prisma.$executeRawUnsafe('TRUNCATE TABLE users, links, clicks CASCADE');
}

function expectUniqueViolation(error: unknown): void {
  expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  expect((error as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');
}

beforeEach(truncateAll);

afterAll(async () => {
  await truncateAll();
  await prisma.$disconnect();
});

describe('links', () => {
  it('applies the defaults a freshly shortened link relies on', async () => {
    const link = await prisma.link.create({
      data: { shortCode: 'abc1234', originalUrl: 'https://example.com' },
    });

    expect(link.isActive).toBe(true);
    expect(link.clickCount).toBe(0);
    expect(link.isCustom).toBe(false);
    expect(link.expiresAt).toBeNull();
    expect(link.userId).toBeNull();
  });

  it('rejects a duplicate short code, which is what makes collision retry safe', async () => {
    await prisma.link.create({
      data: { shortCode: 'dupe123', originalUrl: 'https://example.com/one' },
    });

    try {
      await prisma.link.create({
        data: { shortCode: 'dupe123', originalUrl: 'https://example.com/two' },
      });
      expect.unreachable('a duplicate short code should not be insertable');
    } catch (error) {
      expectUniqueViolation(error);
    }
  });

  it('treats short codes as case-sensitive, so Abc1234 and abc1234 coexist', async () => {
    await prisma.link.create({
      data: { shortCode: 'abc1234', originalUrl: 'https://example.com/lower' },
    });
    const upper = await prisma.link.create({
      data: { shortCode: 'Abc1234', originalUrl: 'https://example.com/upper' },
    });

    expect(upper.shortCode).toBe('Abc1234');
    expect(await prisma.link.count()).toBe(2);
  });

  it('allows an unowned link, which is how guest mode stores its links', async () => {
    const link = await prisma.link.create({
      data: { shortCode: 'guest01', originalUrl: 'https://example.com', userId: null },
    });

    expect(link.userId).toBeNull();
  });
});

describe('users', () => {
  it('rejects a duplicate email', async () => {
    await prisma.user.create({ data: { email: 'a@example.com' } });

    try {
      await prisma.user.create({ data: { email: 'a@example.com' } });
      expect.unreachable('a duplicate email should not be insertable');
    } catch (error) {
      expectUniqueViolation(error);
    }
  });

  it('rejects a second account for the same external identity', async () => {
    await prisma.user.create({
      data: { email: 'gh1@example.com', provider: 'GITHUB', providerId: '12345' },
    });

    try {
      await prisma.user.create({
        data: { email: 'gh2@example.com', provider: 'GITHUB', providerId: '12345' },
      });
      expect.unreachable('a duplicate provider identity should not be insertable');
    } catch (error) {
      expectUniqueViolation(error);
    }
  });

  it('still allows many local accounts, whose providerId is null', async () => {
    // Postgres treats nulls as distinct in a unique index, so the
    // (provider, providerId) constraint does not collapse local signups.
    await prisma.user.create({ data: { email: 'l1@example.com' } });
    await prisma.user.create({ data: { email: 'l2@example.com' } });

    expect(await prisma.user.count({ where: { provider: 'LOCAL' } })).toBe(2);
  });
});

describe('clicks', () => {
  async function seedLink() {
    return prisma.link.create({
      data: { shortCode: 'clicks1', originalUrl: 'https://example.com' },
    });
  }

  it('records repeat clicks from one visitor instead of collapsing them', async () => {
    // The reason (link_id, click_date, ip_address) is a plain index and not a
    // unique constraint: a constraint here would silently drop real traffic.
    const link = await seedLink();

    await prisma.click.createMany({
      data: [
        { linkId: link.id, ipAddress: '203.0.113.5', clickDate: UTC_DAY },
        { linkId: link.id, ipAddress: '203.0.113.5', clickDate: UTC_DAY },
        { linkId: link.id, ipAddress: '203.0.113.5', clickDate: UTC_DAY },
      ],
    });

    expect(await prisma.click.count({ where: { linkId: link.id } })).toBe(3);
  });

  it('separates total clicks from unique visitors in one aggregation', async () => {
    const link = await seedLink();

    await prisma.click.createMany({
      data: [
        { linkId: link.id, ipAddress: '203.0.113.5', clickDate: UTC_DAY },
        { linkId: link.id, ipAddress: '203.0.113.5', clickDate: UTC_DAY },
        { linkId: link.id, ipAddress: '203.0.113.9', clickDate: UTC_DAY },
        { linkId: link.id, ipAddress: '198.51.100.2', clickDate: UTC_DAY },
      ],
    });

    const [row] = await prisma.$queryRaw<Array<{ total: number; unique_visitors: number }>>`
      SELECT COUNT(*)::int AS total,
             COUNT(DISTINCT ip_address)::int AS unique_visitors
      FROM clicks
      WHERE link_id = CAST(${link.id} AS uuid)
        AND click_date = CAST(${'2026-09-01'} AS date)
    `;

    expect(row).toEqual({ total: 4, unique_visitors: 3 });
  });

  it('keeps derived analytics after the retention job nulls the ip', async () => {
    const link = await seedLink();
    await prisma.click.create({
      data: {
        linkId: link.id,
        ipAddress: '203.0.113.5',
        country: 'IN',
        city: 'Pune',
        deviceType: 'MOBILE',
        browser: 'Chrome',
        clickDate: UTC_DAY,
      },
    });

    await prisma.click.updateMany({ where: { linkId: link.id }, data: { ipAddress: null } });

    const click = await prisma.click.findFirstOrThrow({ where: { linkId: link.id } });
    expect(click.ipAddress).toBeNull();
    // The columns the dashboard actually charts are untouched.
    expect(click.country).toBe('IN');
    expect(click.deviceType).toBe('MOBILE');
    expect(click.browser).toBe('Chrome');
  });

  it('stores clicked_at with its time zone offset intact', async () => {
    const link = await seedLink();
    const instant = new Date('2026-09-01T18:30:00.000Z');

    await prisma.click.create({
      data: { linkId: link.id, clickedAt: instant, clickDate: UTC_DAY },
    });

    const click = await prisma.click.findFirstOrThrow({ where: { linkId: link.id } });
    expect(click.clickedAt.toISOString()).toBe('2026-09-01T18:30:00.000Z');
  });
});

describe('cascades', () => {
  it('removes a link’s clicks when the link is deleted', async () => {
    const link = await prisma.link.create({
      data: { shortCode: 'cascad1', originalUrl: 'https://example.com' },
    });
    await prisma.click.create({ data: { linkId: link.id, clickDate: UTC_DAY } });

    await prisma.link.delete({ where: { id: link.id } });

    expect(await prisma.click.count()).toBe(0);
  });

  it('removes a user’s links, and their clicks, when the user is deleted', async () => {
    const user = await prisma.user.create({ data: { email: 'owner@example.com' } });
    const link = await prisma.link.create({
      data: { shortCode: 'cascad2', originalUrl: 'https://example.com', userId: user.id },
    });
    await prisma.click.create({ data: { linkId: link.id, clickDate: UTC_DAY } });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.link.count()).toBe(0);
    expect(await prisma.click.count()).toBe(0);
  });
});

describe('indexes', () => {
  it('uses the composite index for the unique-visitor aggregation', async () => {
    // Guards the index against being dropped or reordered in a later migration:
    // without it this query degrades to a sequential scan as clicks grow.
    const link = await prisma.link.create({
      data: { shortCode: 'explain', originalUrl: 'https://example.com' },
    });

    const plan = await prisma.$queryRaw<Array<{ 'QUERY PLAN': string }>>`
      EXPLAIN (COSTS OFF)
      SELECT COUNT(DISTINCT ip_address)
      FROM clicks
      WHERE link_id = CAST(${link.id} AS uuid)
        AND click_date = CAST(${'2026-09-01'} AS date)
    `;

    const text = plan.map((row) => row['QUERY PLAN']).join('\n');
    expect(text).toContain('clicks_link_id_click_date_ip_address_idx');
  });
});
