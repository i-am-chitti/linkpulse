import { env } from '../config/env.js';
import { serviceUnavailable, unauthorized } from '../lib/errors.js';

export type OAuthProviderName = 'github' | 'google';

export interface OAuthProfile {
  providerId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

interface ProviderConfig {
  clientId: string | undefined;
  clientSecret: string | undefined;
  authorizeUrl: string;
  scope: string;
}

const PROVIDERS: Record<OAuthProviderName, ProviderConfig> = {
  github: {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    // user:email, not just read:user: many GitHub accounts keep their email
    // private, which moves it from the /user response to a separate endpoint
    // this scope is what makes reachable at all.
    scope: 'read:user user:email',
  },
  google: {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    scope: 'openid email profile',
  },
};

export function isKnownProvider(value: string): value is OAuthProviderName {
  return value === 'github' || value === 'google';
}

/**
 * Both id and secret, or neither: a provider with no app registered on it
 * 503s at the route rather than failing the whole API at boot, since - unlike
 * JWT_SECRET - there is no expectation every deployment configures both.
 */
function requireConfig(provider: OAuthProviderName): { clientId: string; clientSecret: string } {
  const config = PROVIDERS[provider];
  if (!config.clientId || !config.clientSecret) {
    throw serviceUnavailable(`${provider} sign-in is not configured on this server`);
  }
  return { clientId: config.clientId, clientSecret: config.clientSecret };
}

function callbackUrl(provider: OAuthProviderName): string {
  return `${env.APP_BASE_URL}/api/auth/oauth/${provider}/callback`;
}

/** Where the browser is sent to let the user grant access. */
export function buildAuthorizationUrl(provider: OAuthProviderName, state: string): string {
  const { clientId } = requireConfig(provider);
  const config = PROVIDERS[provider];

  const url = new URL(config.authorizeUrl);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', callbackUrl(provider));
  url.searchParams.set('scope', config.scope);
  url.searchParams.set('state', state);
  if (provider === 'google') {
    url.searchParams.set('response_type', 'code');
  }
  return url.toString();
}

async function exchangeGithubCode(
  code: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: callbackUrl('github'),
    }),
  });

  if (!res.ok) throw unauthorized('GitHub rejected the authorization code');
  const body = (await res.json()) as { access_token?: string; error?: string };
  if (!body.access_token) {
    throw unauthorized(body.error ?? 'GitHub did not return an access token');
  }
  return body.access_token;
}

async function fetchGithubProfile(accessToken: string): Promise<OAuthProfile> {
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' };

  const userRes = await fetch('https://api.github.com/user', { headers });
  if (!userRes.ok) throw unauthorized('Could not fetch the GitHub profile');
  const user = (await userRes.json()) as {
    id: number;
    name: string | null;
    email: string | null;
    avatar_url: string | null;
  };

  let email = user.email;
  if (!email) {
    // A private-by-default email is absent from /user entirely; only this
    // separate, scope-gated endpoint can see it.
    const emailsRes = await fetch('https://api.github.com/user/emails', { headers });
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;
      email = emails.find((entry) => entry.primary && entry.verified)?.email ?? null;
    }
  }

  if (!email) throw unauthorized('GitHub account has no verified email to sign in with');

  return { providerId: String(user.id), email, name: user.name, avatarUrl: user.avatar_url };
}

async function exchangeGoogleCode(
  code: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: callbackUrl('google'),
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) throw unauthorized('Google rejected the authorization code');
  const body = (await res.json()) as { access_token?: string; error?: string };
  if (!body.access_token) {
    throw unauthorized(body.error ?? 'Google did not return an access token');
  }
  return body.access_token;
}

async function fetchGoogleProfile(accessToken: string): Promise<OAuthProfile> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw unauthorized('Could not fetch the Google profile');

  const profile = (await res.json()) as {
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };

  if (!profile.email || profile.email_verified === false) {
    throw unauthorized('Google account has no verified email to sign in with');
  }

  return {
    providerId: profile.sub,
    email: profile.email,
    name: profile.name ?? null,
    avatarUrl: profile.picture ?? null,
  };
}

/** Exchanges an authorization code for the caller's normalized profile. */
export async function resolveOAuthProfile(
  provider: OAuthProviderName,
  code: string,
): Promise<OAuthProfile> {
  const { clientId, clientSecret } = requireConfig(provider);

  if (provider === 'github') {
    const accessToken = await exchangeGithubCode(code, clientId, clientSecret);
    return fetchGithubProfile(accessToken);
  }

  const accessToken = await exchangeGoogleCode(code, clientId, clientSecret);
  return fetchGoogleProfile(accessToken);
}
