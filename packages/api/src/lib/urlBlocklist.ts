import { env } from '../config/env.js';
import { badRequest } from './errors.js';

/**
 * Hostname match, not substring: blocking "evil.com" must not also block
 * "notevil.com", while still catching "sub.evil.com".
 */
function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return env.URL_BLOCKLIST.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

/**
 * Blocks known-malicious destinations at write time. Called on every link
 * create and every destination edit - never on the redirect hot path, which
 * only ever reads a URL that already passed this check once at creation.
 */
export function assertUrlNotBlocked(url: string): void {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    // destinationUrlSchema already rejects an unparseable URL before this
    // ever runs; nothing to block if somehow it didn't.
    return;
  }

  if (isBlockedHostname(hostname)) {
    throw badRequest('This URL is on the blocklist and cannot be shortened');
  }
}
