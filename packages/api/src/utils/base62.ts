import { randomBytes } from 'node:crypto';
import { BASE62_ALPHABET, SHORT_CODE_LENGTH } from '@linkpulse/shared';

const ALPHABET_SIZE = BASE62_ALPHABET.length;

/**
 * Largest multiple of 62 that fits in a byte (248).
 *
 * 256 is not divisible by 62, so `byte % 62` would map 8 extra values onto the
 * first 8 characters, making them ~3% more likely than the rest. Bytes at or
 * above this limit are discarded instead - rejection sampling.
 */
const REJECTION_LIMIT = Math.floor(256 / ALPHABET_SIZE) * ALPHABET_SIZE;

/**
 * A random base62 short code.
 *
 * Random rather than a base62-encoded counter, as the spec suggests. A counter
 * makes codes sequential, which means anyone holding one link can enumerate
 * every other link on the service by incrementing it. The collision cost is
 * negligible: 62^7 is ~3.5 trillion, so retries are effectively never needed.
 */
export function generateShortCode(length: number = SHORT_CODE_LENGTH): string {
  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError(`short code length must be a positive integer, got ${length}`);
  }

  const code: string[] = [];

  // Over-fetch so a batch of rejected bytes rarely costs another syscall.
  while (code.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= REJECTION_LIMIT) continue;
      code.push(BASE62_ALPHABET[byte % ALPHABET_SIZE]!);
      if (code.length === length) break;
    }
  }

  return code.join('');
}
