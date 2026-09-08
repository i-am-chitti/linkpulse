import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import type { PublicUser } from '@linkpulse/shared';
import { Prisma } from '../generated/prisma/client.js';
import type { User } from '../generated/prisma/client.js';
import { env } from '../config/env.js';
import { conflict, unauthorized } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from '../lib/tokens.js';

const UNIQUE_VIOLATION = 'P2002';

export interface IssuedSession {
  user: PublicUser;
  accessToken: string;
  /** Returned to be set as an httpOnly cookie; never sent in a JSON body. */
  refreshToken: string;
  expiresIn: number;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    provider: user.provider.toLowerCase() as PublicUser['provider'],
    createdAt: user.createdAt.toISOString(),
  };
}

/** Issues an access token plus a fresh refresh token in the given family. */
async function issueSession(user: User, familyId: string): Promise<IssuedSession> {
  const refreshToken = generateRefreshToken();

  await prisma.refreshToken.create({
    data: {
      tokenHash: hashRefreshToken(refreshToken),
      userId: user.id,
      familyId,
      expiresAt: refreshTokenExpiry(),
    },
  });

  return {
    user: toPublicUser(user),
    accessToken: signAccessToken({ sub: user.id, email: user.email }),
    refreshToken,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  };
}

export async function register(input: {
  email: string;
  password: string;
  name?: string | undefined;
}): Promise<IssuedSession> {
  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);

  try {
    const user = await prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        name: input.name ?? null,
        passwordHash,
        provider: 'LOCAL',
      },
    });

    // A new login starts a new family.
    return await issueSession(user, randomUUID());
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
      throw conflict('An account with that email already exists');
    }
    throw error;
  }
}

/**
 * Verifies credentials.
 *
 * The same error is returned whether the email is unknown or the password is
 * wrong, so the response cannot be used to enumerate registered addresses. A
 * hash is also computed for an unknown email, so the timing does not give the
 * answer away either.
 */
export async function login(input: { email: string; password: string }): Promise<IssuedSession> {
  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });

  if (!user?.passwordHash) {
    // Burn comparable time. Also covers an OAuth account with no password,
    // which must not be loggable-into with an empty one.
    await bcrypt.compare(
      input.password,
      '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv',
    );
    throw unauthorized('Incorrect email or password');
  }

  if (!(await bcrypt.compare(input.password, user.passwordHash))) {
    throw unauthorized('Incorrect email or password');
  }

  return issueSession(user, randomUUID());
}

/**
 * Rotates a refresh token.
 *
 * Every refresh consumes its token and issues a new one, so a stolen token is
 * only useful until the legitimate client next refreshes. Presenting a token
 * that was already rotated means two parties hold it and we cannot tell which
 * is legitimate, so the whole family is revoked.
 */
export async function refresh(token: string): Promise<IssuedSession> {
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(token) },
    include: { user: true },
  });

  if (!existing) {
    throw unauthorized('Invalid refresh token');
  }

  if (existing.revokedAt) {
    // Reuse of a rotated token: assume compromise and end every session in
    // this chain rather than guessing which holder is the attacker.
    await prisma.refreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    logger.warn(
      { userId: existing.userId, familyId: existing.familyId },
      'refresh token reuse detected, family revoked',
    );
    throw unauthorized('Refresh token has been revoked');
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw unauthorized('Refresh token has expired');
  }

  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
  });

  return issueSession(existing.user, existing.familyId);
}

/**
 * Revokes the session a refresh token belongs to.
 *
 * The whole family goes, not just the presented token: logging out should end
 * the session, and leaving the rest of the chain live would not.
 *
 * Succeeds silently for an unknown token - logout is idempotent, and a caller
 * should not learn whether a token was real.
 */
export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;

  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(token) },
    select: { familyId: true },
  });
  if (!existing) return;

  await prisma.refreshToken.updateMany({
    where: { familyId: existing.familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Drops rows past their expiry. Nothing can authenticate with them. */
export async function purgeExpiredRefreshTokens(): Promise<number> {
  const { count } = await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
