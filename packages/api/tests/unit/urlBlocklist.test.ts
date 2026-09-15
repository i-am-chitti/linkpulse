import { describe, expect, it } from 'vitest';
import { assertUrlNotBlocked } from '../../src/lib/urlBlocklist.js';

// The default blocklist (see config/env.ts) is Google's own documented Safe
// Browsing test domains, and nothing in the ambient test env overrides
// URL_BLOCKLIST, so these exercise the real default rather than a stub.
describe('assertUrlNotBlocked', () => {
  it('throws for an exact blocked domain', () => {
    expect(() =>
      assertUrlNotBlocked('https://testsafebrowsing.appspot.com/s/malware.html'),
    ).toThrow(/blocklist/i);
  });

  it('throws for a subdomain of a blocked domain', () => {
    expect(() => assertUrlNotBlocked('https://evil.malware.testing.google.test/')).toThrow(
      /blocklist/i,
    );
  });

  it('does not block an unrelated domain', () => {
    expect(() => assertUrlNotBlocked('https://example.com/path')).not.toThrow();
  });

  it('does not treat a blocked domain as a substring match', () => {
    // A hostname that merely contains a blocked one as a substring, but is
    // not it or a subdomain of it, must not be blocked.
    expect(() =>
      assertUrlNotBlocked('https://notmalware.testing.google.test.example.com/'),
    ).not.toThrow();
  });

  it('is a no-op for an unparseable url, leaving that to schema validation', () => {
    expect(() => assertUrlNotBlocked('not-a-url')).not.toThrow();
  });
});
