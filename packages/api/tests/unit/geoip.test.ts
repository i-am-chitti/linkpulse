import { describe, expect, it } from 'vitest';
import { lookupLocation, normalizeIp } from '../../src/utils/geoip.js';

describe('normalizeIp', () => {
  it('strips the IPv4-mapped IPv6 prefix', () => {
    // Node reports IPv4 clients this way on a dual-stack socket, and the geo
    // database is keyed on plain IPv4, so the mapped form resolves to nothing.
    expect(normalizeIp('::ffff:203.0.113.5')).toBe('203.0.113.5');
    expect(normalizeIp('::FFFF:8.8.8.8')).toBe('8.8.8.8');
  });

  it('leaves a plain address alone', () => {
    expect(normalizeIp('203.0.113.5')).toBe('203.0.113.5');
  });

  it('leaves a genuine IPv6 address alone', () => {
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
  });

  it.each([null, undefined, '', '   '])('returns null for %p', (value) => {
    expect(normalizeIp(value)).toBeNull();
  });
});

describe('lookupLocation', () => {
  it('resolves a public address to a country', () => {
    expect(lookupLocation('8.8.8.8').country).toBe('US');
  });

  it('resolves an IPv4-mapped address once normalised', () => {
    const ip = normalizeIp('::ffff:8.8.8.8');
    expect(lookupLocation(ip).country).toBe('US');
  });

  it.each(['10.0.0.1', '192.168.1.1', '127.0.0.1'])(
    'returns no location for the private address %s',
    (ip) => {
      expect(lookupLocation(ip)).toEqual({ country: null, city: null });
    },
  );

  it('returns no location for a null ip', () => {
    expect(lookupLocation(null)).toEqual({ country: null, city: null });
  });

  it('normalises an unknown city to null rather than an empty string', () => {
    // geoip-lite uses '' when it knows the country but not the city, which
    // would otherwise render as a blank bar on the chart.
    const result = lookupLocation('8.8.8.8');
    expect(result.city === null || result.city.length > 0).toBe(true);
  });
});
