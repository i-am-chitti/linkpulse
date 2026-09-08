import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { unauthorized } from './errors.js';

export interface AccessTokenClaims {
  /** User id. */
  sub: string;
  email: string;
}

/**
 * Signs a short-lived access token.
 *
 * HS256 rather than RS256: there is one service issuing and one verifying, so
 * asymmetric keys would add key distribution for no benefit here.
 */
export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  });
}

/** Verifies an access token, or throws a 401. */
export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      // Pinned: without it a caller could present alg:none, or an RS256 token
      // whose "public key" is our HMAC secret, and be trusted.
      algorithms: ['HS256'],
    });

    if (typeof payload === 'string' || !payload.sub) {
      throw unauthorized('Malformed token');
    }

    return { sub: payload.sub, email: String(payload.email ?? '') };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw unauthorized('Access token has expired');
    }
    throw unauthorized('Invalid access token');
  }
}

/**
 * A new refresh token: 32 random bytes, base64url.
 *
 * Opaque rather than a JWT. A refresh always has to check the database for
 * revocation anyway, so a signature would prove nothing extra - and an opaque
 * string cannot leak claims or be accepted on a signature alone.
 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only the digest is ever stored, so a leaked table yields no live sessions. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison, for callers matching a digest they already hold. */
export function refreshTokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashRefreshToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function refreshTokenExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
