import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { closeDatabase } from './lib/prisma.js';
import { closeRedis } from './lib/redis.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'linkpulse api listening');
});

/**
 * Graceful shutdown: stop accepting connections, let in-flight requests finish,
 * then release Redis and the Postgres pool. Without this, a deploy would drop
 * live redirects and leak backends.
 */
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  // Hard stop if a hung connection keeps the server from closing.
  const forceExit = setTimeout(() => {
    logger.error('graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(async (err) => {
    if (err) logger.error({ err }, 'error while closing http server');
    await Promise.allSettled([closeRedis(), closeDatabase()]);
    logger.info('shutdown complete');
    process.exit(err ? 1 : 0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled promise rejection');
  void shutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  void shutdown('uncaughtException');
});
