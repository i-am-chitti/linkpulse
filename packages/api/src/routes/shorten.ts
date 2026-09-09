import { Router } from 'express';
import { shortenGuestSchema } from '@linkpulse/shared';
import { env } from '../config/env.js';
import { toLinkDto } from '../lib/serialize.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { createGuestLink } from '../services/urlService.js';

export const shortenRouter: Router = Router();

/**
 * Guest shortening. No account, no custom alias, and the link expires in 24
 * hours - see PROJECT_SPEC.md section 2.1.
 *
 * Express 5 forwards a rejected promise to the error middleware on its own, so
 * there is no try/catch or asyncHandler wrapper here.
 */
shortenRouter.post(
  '/api/shorten',
  rateLimit({ bucket: 'create', anonLimit: env.RATE_LIMIT_ANON_CREATE_PER_MINUTE }),
  async (req, res) => {
    const { url } = shortenGuestSchema.parse(req.body);
    const link = await createGuestLink(url);

    res.status(201).json(toLinkDto(link));
  },
);
