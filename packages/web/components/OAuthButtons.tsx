import { API_BASE_URL } from '../lib/env';

/**
 * Real cross-origin navigations, not fetch() calls: the OAuth dance needs the
 * browser itself to land on the provider's consent screen and later on the
 * API's callback route, which a client-side fetch could not do (and must
 * not - the provider's session cookies, and the state cookie the callback
 * checks, only ever travel with a real navigation).
 */
function oauthHref(provider: 'github' | 'google'): string {
  return `${API_BASE_URL}/api/auth/oauth/${provider}`;
}

const LINK_CLASS =
  'inline-flex w-full items-center justify-center gap-2 rounded-md border border-gray-300 ' +
  'bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50';

/** lucide-react ships no brand logos (GitHub's included), so both marks below are hand-drawn SVG. */
function GithubIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/** Minimal four-color Google "G" mark. */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 18 18" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.03l3-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58Z"
      />
    </svg>
  );
}

export function OAuthButtons() {
  return (
    <div className="flex flex-col gap-2">
      <div className="relative flex items-center py-1">
        <div className="flex-1 border-t border-gray-200" />
        <span className="px-3 text-xs text-gray-400">or continue with</span>
        <div className="flex-1 border-t border-gray-200" />
      </div>
      <a href={oauthHref('github')} className={LINK_CLASS}>
        <GithubIcon />
        GitHub
      </a>
      <a href={oauthHref('google')} className={LINK_CLASS}>
        <GoogleIcon />
        Google
      </a>
    </div>
  );
}
