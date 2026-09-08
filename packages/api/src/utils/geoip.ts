/**
 * IP to location, resolved offline.
 *
 * geoip-lite ships a copy of the MaxMind GeoLite2 ranges and loads them into
 * memory, so a lookup is a binary search over an in-process array rather than
 * a network call - microseconds, no external dependency, no API key.
 *
 * The cost is ~110 MB of RSS at import time. That is why this module is only
 * ever imported by the click worker: pulling it into the API process would put
 * 110 MB behind every redirect for data the redirect path never reads.
 */
import geoip from 'geoip-lite';

export interface GeoLocation {
  country: string | null;
  city: string | null;
}

const UNKNOWN_LOCATION: GeoLocation = { country: null, city: null };

/**
 * Strips the IPv4-mapped IPv6 prefix.
 *
 * Node reports IPv4 clients as ::ffff:203.0.113.5 when the socket is dual
 * stack, and the geo database is keyed on plain IPv4, so the mapped form
 * silently resolves to nothing.
 */
export function normalizeIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const trimmed = ip.trim();
  if (trimmed === '') return null;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  return mapped ? mapped[1]! : trimmed;
}

export function lookupLocation(ip: string | null): GeoLocation {
  if (!ip) return UNKNOWN_LOCATION;

  // Returns null for private ranges, loopback and addresses outside the data.
  const match = geoip.lookup(ip);
  if (!match) return UNKNOWN_LOCATION;

  return {
    country: match.country || null,
    // geoip-lite uses '' rather than null when it knows the country but not
    // the city, which would otherwise become an empty bar on the chart.
    city: match.city || null,
  };
}
