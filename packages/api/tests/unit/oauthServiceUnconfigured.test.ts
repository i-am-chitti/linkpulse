// Deliberately a separate file from oauthService.test.ts: that file stubs
// GITHUB/GOOGLE client env vars before its first import, and vitest isolates
// each test file's module registry, so this file's plain static import sees
// the ambient test env instead - which, like a real deployment that never
// registered an OAuth app, leaves these unset.
import { describe, expect, it } from 'vitest';
import { buildAuthorizationUrl, resolveOAuthProfile } from '../../src/services/oauthService.js';

describe('an unconfigured provider', () => {
  it('refuses to build an authorization URL', () => {
    expect(() => buildAuthorizationUrl('github', 'state')).toThrowError(/not configured/i);
  });

  it('refuses to resolve a profile', async () => {
    await expect(resolveOAuthProfile('google', 'some-code')).rejects.toThrow(/not configured/i);
  });
});
