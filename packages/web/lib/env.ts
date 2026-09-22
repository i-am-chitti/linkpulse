/**
 * The env vars the browser bundle needs. NEXT_PUBLIC_* vars are inlined
 * at build time - see the Dockerfile's build-args.
 *
 * Empty string means same-origin: the browser calls its own address, and
 * Caddy routes /api/*, /health*, and short codes to the api container. The
 * production default, so a deployed domain can change with no rebuild.
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';

/**
 * Empty hides the widget; the API skips the check when its own
 * TURNSTILE_SECRET_KEY is unset - the two halves switch on together.
 */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
