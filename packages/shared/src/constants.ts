/** Base62 alphabet used for short codes. Order is not significant. */
export const BASE62_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** 62^7 == ~3.5 trillion combinations. See PROJECT_SPEC.md section 8. */
export const SHORT_CODE_LENGTH = 7;

/** How long a resolved URL stays in the Redis read-through cache. */
export const URL_CACHE_TTL_SECONDS = 3600;

/** Guest links are ephemeral: no analytics, no custom alias. */
export const GUEST_LINK_TTL_HOURS = 24;

/**
 * Paths served by the app itself. A custom alias may never shadow one of these,
 * or the alias would take precedence over a real route.
 */
export const RESERVED_SHORT_CODES: readonly string[] = [
  'api',
  'health',
  'dashboard',
  'login',
  'logout',
  'register',
  'settings',
  'admin',
  'about',
  'pricing',
  'docs',
  'static',
  '_next',
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
];

export const CUSTOM_ALIAS_MIN_LENGTH = 3;
export const CUSTOM_ALIAS_MAX_LENGTH = 32;

/** Max length we accept for a destination URL. Postgres text is unbounded; this is a sanity bound. */
export const MAX_URL_LENGTH = 2048;

/** Pagination bounds for GET /api/links. */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Days a raw click IP is retained before the retention job nulls it out. */
export const IP_RETENTION_DAYS = 30;
