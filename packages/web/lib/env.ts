/**
 * The only env var the browser bundle needs. NEXT_PUBLIC_* vars are inlined
 * at build time, so this must be set before `next build`, not just at
 * container start - see the Dockerfile's build-arg for how that's handled.
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';
