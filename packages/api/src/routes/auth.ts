import { Router } from 'express';
import { loginSchema, registerSchema } from '@linkpulse/shared';
import { isProduction } from '../config/env.js';
import { requireAuth, actorOf } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { notFound } from '../lib/errors.js';
import { login, logout, refresh, register, toPublicUser } from '../services/authService.js';
import type { IssuedSession } from '../services/authService.js';
import type { Response } from 'express';

export const authRouter: Router = Router();

/**
 * Path-scoped on purpose.
 *
 * The refresh cookie is only ever needed by the two endpoints below, so
 * scoping it keeps the browser from attaching a long-lived credential to every
 * redirect and API call the user makes.
 */
const REFRESH_COOKIE = 'linkpulse_refresh';
const REFRESH_COOKIE_PATH = '/api/auth';

function setRefreshCookie(res: Response, session: IssuedSession): void {
  res.cookie(REFRESH_COOKIE, session.refreshToken, {
    httpOnly: true,
    // Never readable by JavaScript, so XSS cannot lift the session.
    secure: isProduction,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

/** Sends the session, keeping the refresh token out of the JSON body. */
function sendSession(res: Response, status: number, session: IssuedSession): void {
  setRefreshCookie(res, session);
  res.status(status).json({
    user: session.user,
    accessToken: session.accessToken,
    expiresIn: session.expiresIn,
  });
}

authRouter.post('/api/auth/register', async (req, res) => {
  const input = registerSchema.parse(req.body);
  sendSession(res, 201, await register(input));
});

authRouter.post('/api/auth/login', async (req, res) => {
  const input = loginSchema.parse(req.body);
  sendSession(res, 200, await login(input));
});

authRouter.post('/api/auth/refresh', async (req, res) => {
  // Cookie first; the body is accepted so non-browser clients can refresh too.
  const token = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? req.body?.refreshToken;
  sendSession(res, 200, await refresh(String(token ?? '')));
});

authRouter.post('/api/auth/logout', async (req, res) => {
  await logout(req.cookies?.[REFRESH_COOKIE] as string | undefined);
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  // 204 whether or not a session existed: logout is idempotent.
  res.status(204).end();
});

authRouter.get('/api/auth/me', requireAuth, async (req, res) => {
  const actor = actorOf(req);
  const user = await prisma.user.findUnique({ where: { id: actor.id } });

  // The token verified, but the account is gone - deleted since it was issued.
  if (!user) throw notFound('Account no longer exists');

  res.json(toPublicUser(user));
});
