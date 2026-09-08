import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  refreshTokenMatches,
  signAccessToken,
  verifyAccessToken,
} from '../../src/lib/tokens.js';
import { env } from '../../src/config/env.js';

const CLAIMS = { sub: 'user-1', email: 'a@example.com' };

describe('access tokens', () => {
  it('round-trips its claims', () => {
    expect(verifyAccessToken(signAccessToken(CLAIMS))).toMatchObject(CLAIMS);
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign(CLAIMS, env.JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '-1s',
    });

    expect(() => verifyAccessToken(expired)).toThrowError(/expired/i);
  });

  it('rejects a token signed with a different secret', () => {
    const foreign = jwt.sign(CLAIMS, 'a-completely-different-secret-value-here', {
      algorithm: 'HS256',
    });

    expect(() => verifyAccessToken(foreign)).toThrowError(/invalid/i);
  });

  it('rejects an unsigned alg:none token', () => {
    // Without the algorithms pin, jsonwebtoken would honour the header's own
    // claim of "none" and accept this as valid.
    const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
      'base64url',
    )}.${Buffer.from(JSON.stringify(CLAIMS)).toString('base64url')}.`;

    expect(() => verifyAccessToken(unsigned)).toThrow();
  });

  it('rejects a tampered payload', () => {
    const [header, , signature] = signAccessToken(CLAIMS).split('.');
    const swapped = Buffer.from(JSON.stringify({ sub: 'someone-else' })).toString('base64url');

    expect(() => verifyAccessToken(`${header}.${swapped}.${signature}`)).toThrow();
  });

  it.each(['', 'not-a-jwt', 'a.b.c'])('rejects the malformed token %p', (token) => {
    expect(() => verifyAccessToken(token)).toThrow();
  });
});

describe('refresh tokens', () => {
  it('generates a distinct high-entropy token each time', () => {
    const tokens = new Set(Array.from({ length: 1000 }, generateRefreshToken));

    expect(tokens.size).toBe(1000);
    // 32 bytes base64url, so 43 characters with no padding.
    expect(generateRefreshToken()).toMatch(/^[\w-]{43}$/);
  });

  it('hashes deterministically', () => {
    const token = generateRefreshToken();

    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
    expect(hashRefreshToken(token)).toHaveLength(64);
    expect(hashRefreshToken(token)).not.toBe(token);
  });

  it('matches a token against its own digest', () => {
    const token = generateRefreshToken();

    expect(refreshTokenMatches(token, hashRefreshToken(token))).toBe(true);
    expect(refreshTokenMatches(token, hashRefreshToken(generateRefreshToken()))).toBe(false);
  });

  it('does not throw on a wrong-length digest', () => {
    // timingSafeEqual throws on mismatched buffer lengths, which would turn a
    // malformed input into a 500.
    expect(refreshTokenMatches(generateRefreshToken(), 'abc123')).toBe(false);
  });

  it('expires the configured number of days out', () => {
    const days = (refreshTokenExpiry().getTime() - Date.now()) / 86_400_000;

    expect(days).toBeCloseTo(env.REFRESH_TOKEN_TTL_DAYS, 1);
  });
});
