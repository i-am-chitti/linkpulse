import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { unauthorized } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';

export interface AuthenticatedActor {
  id: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireAuth, and by optionalAuth when a valid token is present. */
      actor?: AuthenticatedActor;
    }
  }
}

/** Reads a bearer token, tolerating case and extra whitespace. */
function bearerToken(req: Request): string | null {
  const header = req.get('authorization');
  if (!header) return null;

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

/** Rejects the request unless it carries a valid access token. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const token = bearerToken(req);
  if (!token) {
    throw unauthorized('Authentication required');
  }

  const claims = verifyAccessToken(token);
  req.actor = { id: claims.sub, email: claims.email };
  next();
};

/**
 * Attaches the actor when a valid token is present, and otherwise proceeds
 * anonymously. For routes that behave differently for guests rather than
 * refusing them - a higher rate limit, an owned link instead of a guest one.
 *
 * A malformed or expired token is treated as absent rather than as an error:
 * the route works for anonymous callers, so failing here would make a stale
 * token worse than no token at all.
 */
export const optionalAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const token = bearerToken(req);
  if (!token) return next();

  try {
    const claims = verifyAccessToken(token);
    req.actor = { id: claims.sub, email: claims.email };
  } catch {
    // Deliberately ignored; see above.
  }

  next();
};

/** The authenticated actor, for handlers mounted behind requireAuth. */
export function actorOf(req: Request): AuthenticatedActor {
  if (!req.actor) {
    // A programming error: the route was mounted without requireAuth.
    throw unauthorized('Authentication required');
  }
  return req.actor;
}
