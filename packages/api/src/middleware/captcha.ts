import type { RequestHandler } from 'express';
import { badRequest } from '../lib/errors.js';
import { isCaptchaConfigured, verifyCaptchaToken } from '../lib/captcha.js';

/**
 * A solved Turnstile challenge on the anonymous browser forms. Guards the
 * forms only - a caller skipping the browser is bounded by the rate limits
 * and link quota instead (ARCHITECTURE.md).
 *
 * Read off req.body, not through the route's Zod schema: captchaToken is a
 * transport concern, not part of the register/shorten input.
 */
export function requireCaptcha(): RequestHandler {
  return async (req, _res, next) => {
    if (!isCaptchaConfigured()) return next();

    const token = (req.body as { captchaToken?: unknown } | undefined)?.captchaToken;
    if (typeof token !== 'string' || token === '') {
      throw badRequest('Captcha verification is required.');
    }

    if (!(await verifyCaptchaToken(token, req.ip))) {
      throw badRequest('Captcha verification failed. Please try again.');
    }

    next();
  };
}
