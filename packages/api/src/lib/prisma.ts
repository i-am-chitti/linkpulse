import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env, isProduction } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Prisma 7 requires a driver adapter; the connection string no longer comes
 * from schema.prisma. Using node-postgres means the pool is ours to size.
 *
 * Pool sizing matters for the redirect path: Postgres is only touched on a
 * cache miss, so a small pool is plenty, and keeping it small stops a traffic
 * spike from opening hundreds of backends and starving the database.
 */
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  // Fail rather than queue forever when every connection is busy.
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});

export const prisma = new PrismaClient({
  adapter,
  log: isProduction ? [] : [{ emit: 'event', level: 'warn' }],
});

if (!isProduction) {
  prisma.$on('warn', (event) => {
    logger.warn({ prisma: event }, 'prisma warning');
  });
}

/** True when Postgres answers. Used by the readiness probe. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.warn({ err: error }, 'database ping failed');
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  await prisma.$disconnect();
}
