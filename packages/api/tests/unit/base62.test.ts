import { describe, expect, it } from 'vitest';
import { BASE62_ALPHABET, SHORT_CODE_LENGTH } from '@linkpulse/shared';
import { generateShortCode } from '../../src/utils/base62.js';

describe('generateShortCode', () => {
  it('defaults to the configured length', () => {
    expect(generateShortCode()).toHaveLength(SHORT_CODE_LENGTH);
  });

  it('honours an explicit length', () => {
    expect(generateShortCode(12)).toHaveLength(12);
  });

  it('only ever emits alphabet characters', () => {
    const alphabet = new Set(BASE62_ALPHABET);
    for (const char of generateShortCode(500)) {
      expect(alphabet.has(char)).toBe(true);
    }
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects the invalid length %s', (length) => {
    expect(() => generateShortCode(length)).toThrow(RangeError);
  });

  it('does not repeat itself across many draws', () => {
    const codes = new Set(Array.from({ length: 5_000 }, () => generateShortCode()));
    // 5k draws from 3.5e12 possibilities: a collision here means the generator
    // is broken, not unlucky.
    expect(codes.size).toBe(5_000);
  });

  it('distributes characters near-uniformly, catching modulo bias', () => {
    // Without rejection sampling the first 8 characters of the alphabet would
    // appear ~3% more often than the rest. Chi-square would be cleaner, but a
    // spread bound is enough to catch a regression to `byte % 62`.
    const counts = new Map<string, number>();
    const sample = generateShortCode(62_000);
    for (const char of sample) {
      counts.set(char, (counts.get(char) ?? 0) + 1);
    }

    expect(counts.size).toBe(BASE62_ALPHABET.length);

    const expected = sample.length / BASE62_ALPHABET.length;
    for (const [char, count] of counts) {
      // ±20% tolerance: wide enough not to flake, tight enough that a biased
      // generator's ~+3% skew plus its deficit elsewhere still trips it over
      // repeated runs.
      expect(count, `character ${char}`).toBeGreaterThan(expected * 0.8);
      expect(count, `character ${char}`).toBeLessThan(expected * 1.2);
    }
  });
});
