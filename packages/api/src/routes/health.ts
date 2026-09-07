import { Router } from 'express';
import { pingRedis } from '../lib/redis.js';

// Annotated explicitly: the inferred type is not nameable across pnpm's
// nested store layout (TS2742).
export const healthRouter: Router = Router();

/**
 * Liveness: is the process up? Deliberately dependency-free so an orchestrator
 * does not restart a healthy API just because Redis is briefly down.
 */
healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()) });
});

/**
 * Readiness: should this instance receive traffic? Checks dependencies, so a
 * load balancer can drain an instance that cannot serve requests properly.
 */
healthRouter.get('/health/ready', async (_req, res) => {
  const redisOk = await pingRedis();
  const checks = { redis: redisOk };
  const ready = Object.values(checks).every(Boolean);

  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'degraded', checks });
});
