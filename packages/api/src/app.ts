import type { IncomingMessage } from 'node:http';
import express from 'express';
import type { Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env, isTest } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { analyticsRouter } from './routes/analytics.js';
import { authRouter } from './routes/auth.js';
import { healthRouter } from './routes/health.js';
import { linksRouter } from './routes/links.js';
import { redirectRouter } from './routes/redirect.js';
import { shortenRouter } from './routes/shorten.js';

export function createApp(): Express {
  const app = express();

  /**
   * We sit behind Nginx in production, so the socket peer is the proxy, not the
   * visitor. Without this, req.ip is the proxy address and both per-IP rate
   * limiting and click geolocation would collapse onto a single "user".
   *
   * Value 1 = trust exactly one proxy hop. Trusting all hops would let a client
   * spoof X-Forwarded-For and bypass rate limits.
   */
  app.set('trust proxy', 1);
  // Don't advertise the framework.
  app.disable('x-powered-by');
  // Short codes are case-sensitive: /Abc123 and /abc123 are different links.
  app.set('case sensitive routing', true);

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));

  if (!isTest) {
    app.use(
      pinoHttp({
        logger,
        // Health checks would otherwise dominate the logs.
        autoLogging: {
          ignore: (req: IncomingMessage) => req.url?.startsWith('/health') ?? false,
        },
      }),
    );
  }

  // Payloads are small JSON objects; a tight limit is free DoS protection.
  app.use(express.json({ limit: '16kb' }));
  // The refresh token travels as an httpOnly cookie.
  app.use(cookieParser());

  app.use(healthRouter);
  app.use(authRouter);
  app.use(linksRouter);
  app.use(analyticsRouter);
  app.use(shortenRouter);

  // Last: /:shortCode matches any single path segment, so anything mounted
  // after it would be unreachable.
  app.use(redirectRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
