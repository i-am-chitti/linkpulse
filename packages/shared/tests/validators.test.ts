import { describe, expect, it } from 'vitest';
import {
  analyticsQuerySchema,
  createLinkSchema,
  shortenGuestSchema,
  customAliasSchema,
  destinationUrlSchema,
  listLinksQuerySchema,
  updateLinkSchema,
} from '../src/validators.js';
import { MAX_URL_LENGTH } from '../src/constants.js';

describe('destinationUrlSchema', () => {
  it.each([
    'https://example.com',
    'http://example.com/a/b?c=d#e',
    'https://sub.example.co.uk:8443/path',
  ])('accepts %s', (url) => {
    expect(destinationUrlSchema.safeParse(url).success).toBe(true);
  });

  it.each([
    // These are the reason we don't use zod's built-in url check.
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'file:///etc/passwd',
    'ftp://example.com',
    // Not absolute.
    'example.com',
    '/relative/path',
    '',
  ])('rejects %s', (url) => {
    expect(destinationUrlSchema.safeParse(url).success).toBe(false);
  });

  it('trims surrounding whitespace', () => {
    expect(destinationUrlSchema.parse('  https://example.com  ')).toBe('https://example.com');
  });

  it(`rejects URLs longer than ${MAX_URL_LENGTH} characters`, () => {
    const tooLong = `https://example.com/${'a'.repeat(MAX_URL_LENGTH)}`;
    expect(destinationUrlSchema.safeParse(tooLong).success).toBe(false);
  });
});

describe('customAliasSchema', () => {
  it.each(['my-link', 'My_Link_2', 'abc'])('accepts %s', (alias) => {
    expect(customAliasSchema.safeParse(alias).success).toBe(true);
  });

  it.each([
    'ab', // shorter than the 3-char minimum
    'a'.repeat(33), // longer than the 32-char maximum
    'has space',
    'has/slash',
    'has.dot',
    'emoji-🚀',
  ])('rejects %s', (alias) => {
    expect(customAliasSchema.safeParse(alias).success).toBe(false);
  });

  it.each(['api', 'API', 'dashboard', 'login', '_next'])(
    'rejects the reserved route %s regardless of case',
    (alias) => {
      expect(customAliasSchema.safeParse(alias).success).toBe(false);
    },
  );
});

describe('createLinkSchema', () => {
  it('accepts a bare url', () => {
    const result = createLinkSchema.safeParse({ url: 'https://example.com' });
    expect(result.success).toBe(true);
  });

  it('coerces an ISO expiry string to a Date', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const result = createLinkSchema.parse({ url: 'https://example.com', expiresAt: future });
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it('rejects an expiry in the past, which would create a dead link', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const result = createLinkSchema.safeParse({ url: 'https://example.com', expiresAt: past });
    expect(result.success).toBe(false);
  });

  it('reports the failing field so the client can highlight it', () => {
    const result = createLinkSchema.safeParse({ url: 'nope', customAlias: 'ab' });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((issue) => issue.path.join('.')).sort();
    expect(paths).toEqual(['customAlias', 'url']);
  });
});

describe('updateLinkSchema', () => {
  it('rejects an empty body', () => {
    expect(updateLinkSchema.safeParse({}).success).toBe(false);
  });

  it('allows clearing the expiry with null', () => {
    expect(updateLinkSchema.safeParse({ expiresAt: null }).success).toBe(true);
  });

  it('accepts a partial update', () => {
    expect(updateLinkSchema.safeParse({ isActive: false }).success).toBe(true);
  });
});

describe('listLinksQuerySchema', () => {
  it('applies defaults when the query string is empty', () => {
    expect(listLinksQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 20 });
  });

  it('coerces numeric strings from the query string', () => {
    expect(listLinksQuerySchema.parse({ page: '3', pageSize: '50' })).toMatchObject({
      page: 3,
      pageSize: 50,
    });
  });

  it('rejects a pageSize above the cap so a client cannot ask for the whole table', () => {
    expect(listLinksQuerySchema.safeParse({ pageSize: '5000' }).success).toBe(false);
  });

  it('parses isActive from a query-string boolean', () => {
    expect(listLinksQuerySchema.parse({ isActive: 'true' }).isActive).toBe(true);
    expect(listLinksQuerySchema.parse({ isActive: 'false' }).isActive).toBe(false);
  });
});

describe('shortenGuestSchema', () => {
  it('accepts a url', () => {
    expect(shortenGuestSchema.safeParse({ url: 'https://example.com' }).success).toBe(true);
  });

  it('strips a customAlias rather than honouring it', () => {
    // Guests must not be able to claim aliases by sending the field anyway.
    const result = shortenGuestSchema.parse({
      url: 'https://example.com',
      customAlias: 'premium-name',
    });
    expect(result).toEqual({ url: 'https://example.com' });
  });

  it('rejects a non-http scheme just like the authenticated schema', () => {
    expect(shortenGuestSchema.safeParse({ url: 'javascript:alert(1)' }).success).toBe(false);
  });
});

describe('analyticsQuerySchema', () => {
  it('defaults to the trailing 30 days, inclusive', () => {
    const { from, to } = analyticsQuerySchema.parse({});

    const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
    expect(span).toBe(29);
    expect(to).toBe(new Date().toISOString().slice(0, 10));
  });

  it('accepts an explicit range', () => {
    expect(analyticsQuerySchema.parse({ from: '2026-09-01', to: '2026-09-07' })).toEqual({
      from: '2026-09-01',
      to: '2026-09-07',
    });
  });

  it('back-fills "from" when only "to" is given', () => {
    const { from } = analyticsQuerySchema.parse({ to: '2026-09-30' });
    expect(from).toBe('2026-09-01');
  });

  it('accepts a single-day range', () => {
    expect(analyticsQuerySchema.safeParse({ from: '2026-09-01', to: '2026-09-01' }).success).toBe(
      true,
    );
  });

  it('rejects an inverted range', () => {
    const result = analyticsQuerySchema.safeParse({ from: '2026-09-07', to: '2026-09-01' });
    expect(result.success).toBe(false);
  });

  it('rejects a range longer than the cap', () => {
    // Unbounded ranges would let one request group years of clicks.
    const result = analyticsQuerySchema.safeParse({ from: '2024-01-01', to: '2026-09-01' });
    expect(result.success).toBe(false);
  });

  it.each([
    ['a non-padded date', '2026-9-1'],
    ['a day that does not exist', '2026-02-30'],
    ['a timestamp', '2026-09-01T00:00:00Z'],
    ['nonsense', 'yesterday'],
  ])('rejects %s', (_label, from) => {
    expect(analyticsQuerySchema.safeParse({ from }).success).toBe(false);
  });
});
