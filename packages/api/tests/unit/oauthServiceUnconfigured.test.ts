// A separate file from oauthService.test.ts, which stubs GITHUB/GOOGLE env
// vars: vitest isolates each file's module registry, so this file's plain
// static import sees the ambient (unset) test env instead.
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
