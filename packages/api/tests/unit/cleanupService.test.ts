// The worker's periodic sweep, against real Postgres - service-level, not
// through the HTTP layer, since neither function has one of its own.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { purgeExpiredGuestLinks } from '../../src/services/cleanupService.js';
import { purgeExpiredRefreshTokens } from '../../src/services/authService.js';
import { prisma } from '../../src/lib/prisma.js';

const PAST = new Date(Date.now() - 60_000);
const FUTURE = new Date(Date.now() + 60_000);

async function makeUser() {
  return prisma.user.create({ data: { email: `${randomUUID()}@example.com` } });
}

function makeLink(overrides: Partial<Parameters<typeof prisma.link.create>[0]['data']> = {}) {
  return prisma.link.create({
    data: {
      shortCode: randomUUID().slice(0, 7),
      originalUrl: 'https://example.com',
      ...overrides,
    },
  });
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE users, links, clicks, refresh_tokens CASCADE');
});

afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE users, links, clicks, refresh_tokens CASCADE');
  await prisma.$disconnect();
});

describe('purgeExpiredGuestLinks', () => {
  it('deletes an expired guest link', async () => {
    const link = await makeLink({ expiresAt: PAST });

    const count = await purgeExpiredGuestLinks();

    expect(count).toBe(1);
    expect(await prisma.link.findUnique({ where: { id: link.id } })).toBeNull();
  });

  it('leaves a guest link that has not expired yet', async () => {
    const link = await makeLink({ expiresAt: FUTURE });

    await purgeExpiredGuestLinks();

    expect(await prisma.link.findUnique({ where: { id: link.id } })).not.toBeNull();
  });

  it('leaves a guest link with no expiry at all', async () => {
    const link = await makeLink({ expiresAt: null });

    await purgeExpiredGuestLinks();

    expect(await prisma.link.findUnique({ where: { id: link.id } })).not.toBeNull();
  });

  it('never touches an expired link that belongs to a real account', async () => {
    // The whole point of scoping to guest links: an owner's analytics
    // history must survive their link's expiry, unlike a guest link's.
    const user = await makeUser();
    const link = await makeLink({ expiresAt: PAST, userId: user.id });

    const count = await purgeExpiredGuestLinks();

    expect(count).toBe(0);
    expect(await prisma.link.findUnique({ where: { id: link.id } })).not.toBeNull();
  });

  it('cascades the click history of a purged guest link away with it', async () => {
    const link = await makeLink({ expiresAt: PAST });
    await prisma.click.create({
      data: { linkId: link.id, deviceType: 'DESKTOP', clickDate: new Date() },
    });

    await purgeExpiredGuestLinks();

    expect(await prisma.click.count({ where: { linkId: link.id } })).toBe(0);
  });
});

describe('purgeExpiredRefreshTokens', () => {
  async function makeToken(expiresAt: Date, userId: string) {
    return prisma.refreshToken.create({
      data: { tokenHash: randomUUID(), userId, familyId: randomUUID(), expiresAt },
    });
  }

  it('deletes an expired refresh token', async () => {
    const user = await makeUser();
    const token = await makeToken(PAST, user.id);

    const count = await purgeExpiredRefreshTokens();

    expect(count).toBe(1);
    expect(await prisma.refreshToken.findUnique({ where: { id: token.id } })).toBeNull();
  });

  it('leaves a refresh token that has not expired yet, revoked or not', async () => {
    const user = await makeUser();
    const token = await makeToken(FUTURE, user.id);

    await purgeExpiredRefreshTokens();

    expect(await prisma.refreshToken.findUnique({ where: { id: token.id } })).not.toBeNull();
  });
});
