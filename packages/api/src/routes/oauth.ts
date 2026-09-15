import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Response } from 'express';
import { env, isProduction } from '../config/env.js';
import { AppError, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { loginWithOAuth } from '../services/authService.js';
import {
  buildAuthorizationUrl,
  isKnownProvider,
  resolveOAuthProfile,
} from '../services/oauthService.js';
import type { OAuthProviderName } from '../services/oauthService.js';
import { authRateLimit, setRefreshCookie } from './auth.js';

export const oauthRouter: Router = Router();

const STATE_COOKIE = 'linkpulse_oauth_state';
// Narrower than the refresh cookie's /api/auth: this value is worthless
// outside the two routes below and should never travel further than that.
const STATE_COOKIE_PATH = '/api/auth/oauth';

function stateCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: STATE_COOKIE_PATH,
    // Generous for a real login (provider consent screens are slow to click
    // through), short enough that a stale value left over from an abandoned
    // attempt is worthless well before anyone could reuse it.
    maxAge: 10 * 60 * 1000,
  };
}

function providerFrom(rawProvider: string): OAuthProviderName {
  if (!isKnownProvider(rawProvider)) throw notFound('Unknown OAuth provider');
  return rawProvider;
}

/** Sends the browser to /oauth/callback with a short code, not a raw error. */
function redirectWithError(res: Response, code: string): void {
  const url = new URL('/oauth/callback', env.WEB_ORIGIN);
  url.searchParams.set('error', code);
  res.redirect(302, url.toString());
}

/**
 * Starts the flow: mint anti-CSRF state, stash it in a short-lived cookie,
 * send the browser to the provider's own consent screen.
 */
oauthRouter.get<{ provider: string }>('/api/auth/oauth/:provider', authRateLimit, (req, res) => {
  const provider = providerFrom(req.params.provider);
  const state = randomBytes(24).toString('base64url');

  // Caught here, not left to the default JSON error handler: a browser
  // followed a real <a href> to get here, so a raw JSON body would be a
  // dead end rather than something the frontend's error page can show.
  let authorizationUrl: string;
  try {
    authorizationUrl = buildAuthorizationUrl(provider, state);
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 503) {
      redirectWithError(res, 'provider_not_configured');
      return;
    }
    throw error;
  }

  res.cookie(STATE_COOKIE, state, stateCookieOptions());
  res.redirect(302, authorizationUrl);
});

/**
 * Where the provider sends the browser back. Never returns JSON: by the time
 * this runs, we are mid full-page-navigation, not answering a fetch() the
 * frontend could inspect - every outcome, success or failure, is a redirect
 * back to the one frontend page built to handle both (/oauth/callback).
 */
oauthRouter.get<{ provider: string }>(
  '/api/auth/oauth/:provider/callback',
  authRateLimit,
  async (req, res) => {
    const provider = providerFrom(req.params.provider);

    const expectedState = req.cookies?.[STATE_COOKIE] as string | undefined;
    res.clearCookie(STATE_COOKIE, { path: STATE_COOKIE_PATH });

    const state = req.query.state;
    const code = req.query.code;

    // Compared even when one side is missing/malformed: a bare "state
    // differs" check would let an absent cookie (typeof undefined) slip
    // through if it ever happened to equal an absent query param.
    if (!expectedState || typeof state !== 'string' || state !== expectedState) {
      redirectWithError(res, 'invalid_state');
      return;
    }
    if (typeof code !== 'string' || !code) {
      redirectWithError(res, 'missing_code');
      return;
    }

    try {
      const profile = await resolveOAuthProfile(provider, code);
      const session = await loginWithOAuth(provider === 'github' ? 'GITHUB' : 'GOOGLE', profile);

      setRefreshCookie(res, session);
      res.redirect(302, new URL('/oauth/callback', env.WEB_ORIGIN).toString());
    } catch (error) {
      logger.warn({ err: error, provider }, 'oauth callback failed');

      if (error instanceof AppError && error.statusCode === 409) {
        redirectWithError(res, 'email_taken');
        return;
      }
      if (error instanceof AppError && error.statusCode === 503) {
        redirectWithError(res, 'provider_not_configured');
        return;
      }
      redirectWithError(res, 'oauth_failed');
    }
  },
);
