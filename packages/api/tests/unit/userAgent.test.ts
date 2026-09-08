import { describe, expect, it } from 'vitest';
import { parseUserAgent } from '../../src/utils/userAgent.js';
import { normalizeReferrer } from '../../src/utils/referrer.js';

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const CHROME_IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1';
const FIREFOX_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0';

describe('parseUserAgent', () => {
  it('classifies a desktop browser as desktop, not unknown', () => {
    // ua-parser leaves device.type unset for desktops, so a naive mapping files
    // most real traffic under "unknown".
    const result = parseUserAgent(CHROME_MAC);

    expect(result.deviceType).toBe('DESKTOP');
    expect(result.browser).toBe('Chrome');
    expect(result.os).toBe('macOS');
  });

  it('classifies a phone as mobile', () => {
    expect(parseUserAgent(SAFARI_IPHONE)).toMatchObject({
      deviceType: 'MOBILE',
      browser: 'Mobile Safari',
      os: 'iOS',
    });
  });

  it('distinguishes a tablet from a phone', () => {
    expect(parseUserAgent(CHROME_IPAD).deviceType).toBe('TABLET');
  });

  it('reads windows and firefox', () => {
    expect(parseUserAgent(FIREFOX_WINDOWS)).toMatchObject({
      deviceType: 'DESKTOP',
      browser: 'Firefox',
      os: 'Windows',
    });
  });

  it.each([null, ''])('returns unknown for the absent user agent %p', (value) => {
    expect(parseUserAgent(value)).toEqual({
      deviceType: 'UNKNOWN',
      browser: null,
      os: null,
    });
  });

  it('returns unknown rather than guessing at unrecognisable input', () => {
    const result = parseUserAgent('!!!not-a-user-agent!!!');

    expect(result.deviceType).toBe('UNKNOWN');
    expect(result.browser).toBeNull();
  });

  it('does not label a bot as desktop', () => {
    // curl has no device type and no browser name; calling it desktop would
    // inflate the desktop share with automated traffic.
    const result = parseUserAgent('curl/8.7.1');
    expect(result.deviceType).toBe('UNKNOWN');
  });
});

describe('normalizeReferrer', () => {
  it('reduces a referrer to its host', () => {
    expect(normalizeReferrer('https://twitter.com/someone/status/123')).toBe('twitter.com');
  });

  it('drops query strings, which carry campaign and session identifiers', () => {
    expect(normalizeReferrer('https://google.com/search?q=secret+query&sid=abc')).toBe(
      'google.com',
    );
  });

  it.each([null, undefined, '', 'not a url'])(
    'returns null for %p, the storage form of "direct"',
    (value) => {
      expect(normalizeReferrer(value)).toBeNull();
    },
  );
});
