import { GUEST_LINK_TTL_HOURS, RESERVED_SHORT_CODES } from '@linkpulse/shared';
import { Prisma } from '../generated/prisma/client.js';
import type { Link } from '../generated/prisma/client.js';
import { prisma } from '../lib/prisma.js';
import { conflict } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { assertUrlNotBlocked } from '../lib/urlBlocklist.js';
import { generateShortCode } from '../utils/base62.js';
import {
  cacheGoneLink,
  cacheLink,
  cacheMissingLink,
  getCachedLink,
  invalidateLink,
  type CachedLink,
} from './cacheService.js';

/** Postgres unique-constraint violation, surfaced by Prisma. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * Attempts before giving up on finding a free code.
 *
 * At 62^7 possibilities a single collision is already vanishingly unlikely, so
 * this is a guard against a systemic fault (a broken generator, a code space
 * far smaller than configured), not an expected retry path.
 */
const MAX_CODE_ATTEMPTS = 5;

export type ResolveResult =
  | { status: 'found'; link: CachedLink; source: 'cache' | 'database' }
  /** No such code. */
  | { status: 'missing' }
  /** The code exists but is disabled or past its expiry. */
  | { status: 'gone' };

/**
 * Resolves a short code for the redirect path.
 *
 * Read-through: Redis first, Postgres only on a miss, and the result is written
 * back either way. This is the hot path, so it does the minimum possible work
 * and selects only the four columns the decision needs.
 */
export async function resolveShortCode(shortCode: string): Promise<ResolveResult> {
  const cached = await getCachedLink(shortCode);

  switch (cached.state) {
    case 'hit':
      return { status: 'found', link: cached.link, source: 'cache' };
    case 'missing':
      return { status: 'missing' };
    case 'gone':
      return { status: 'gone' };
    case 'uncached':
      break;
  }

  const link = await prisma.link.findUnique({
    where: { shortCode },
    select: { id: true, originalUrl: true, isActive: true, expiresAt: true },
  });

  if (!link) {
    await cacheMissingLink(shortCode);
    return { status: 'missing' };
  }

  const isExpired = link.expiresAt !== null && link.expiresAt.getTime() <= Date.now();
  if (!link.isActive || isExpired) {
    await cacheGoneLink(shortCode);
    return { status: 'gone' };
  }

  const resolved: CachedLink = { id: link.id, originalUrl: link.originalUrl };
  await cacheLink(shortCode, resolved, link.expiresAt);

  return { status: 'found', link: resolved, source: 'database' };
}

export interface CreateLinkOptions {
  url: string;
  userId?: string | null;
  customAlias?: string | undefined;
  expiresAt?: Date | null;
}

/**
 * Creates a link, retrying on the astronomically unlikely code collision.
 *
 * A custom alias is never retried: the user asked for that exact code, so a
 * clash is a 409 they need to see, not something to paper over.
 */
export async function createLink(options: CreateLinkOptions): Promise<Link> {
  const { url, userId = null, customAlias, expiresAt = null } = options;

  assertUrlNotBlocked(url);

  if (customAlias) {
    // Belt and braces: the validator rejects reserved aliases, but this is the
    // last gate before a route-shadowing code reaches the database.
    if (RESERVED_SHORT_CODES.includes(customAlias.toLowerCase())) {
      throw conflict('That alias is reserved by the application');
    }

    try {
      return await insertLink({ shortCode: customAlias, url, userId, expiresAt, isCustom: true });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict(`The alias "${customAlias}" is already taken`);
      }
      throw error;
    }
  }

  for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt += 1) {
    const shortCode = generateShortCode();

    try {
      return await insertLink({ shortCode, url, userId, expiresAt, isCustom: false });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      logger.warn({ shortCode, attempt }, 'short code collision, regenerating');
    }
  }

  throw new Error(`could not allocate a unique short code after ${MAX_CODE_ATTEMPTS} attempts`);
}

/** Guest links are unowned and short-lived; see PROJECT_SPEC.md section 2.1. */
export async function createGuestLink(url: string): Promise<Link> {
  const expiresAt = new Date(Date.now() + GUEST_LINK_TTL_HOURS * 60 * 60 * 1000);
  return createLink({ url, userId: null, expiresAt });
}

function insertLink(input: {
  shortCode: string;
  url: string;
  userId: string | null;
  expiresAt: Date | null;
  isCustom: boolean;
}): Promise<Link> {
  return prisma.link.create({
    data: {
      shortCode: input.shortCode,
      originalUrl: input.url,
      userId: input.userId,
      expiresAt: input.expiresAt,
      isCustom: input.isCustom,
    },
  });
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION;
}

export { invalidateLink };
