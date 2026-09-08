/**
 * Click processing worker.
 *
 * A separate entry point, and a separate container, from the API. Two reasons:
 * the geo database it loads costs ~110 MB of RSS that the redirect path has no
 * use for, and a batch of database writes should never compete for event-loop
 * time with the latency-critical redirect.
 */
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { closeDatabase } from './lib/prisma.js';
import { closeRedis } from './lib/redis.js';
import { dequeueClicks, queueLength } from './services/clickQueue.js';
import { processClickBatch } from './workers/clickProcessor.js';

let running = true;
/** Held so shutdown can wait for an in-flight batch instead of tearing it up. */
let inFlight: Promise<unknown> = Promise.resolve();

async function runLoop(): Promise<void> {
  logger.info({ batchSize: env.CLICK_BATCH_SIZE }, 'click worker started');

  while (running) {
    try {
      // dequeueClicks blocks for CLICK_BLOCK_SECONDS when the queue is empty,
      // so an idle worker costs one Redis call every few seconds, not a spin.
      const events = await dequeueClicks(env.CLICK_BATCH_SIZE);
      if (events.length === 0) continue;

      inFlight = processClickBatch(events);
      const { inserted, linksTouched } = (await inFlight) as Awaited<
        ReturnType<typeof processClickBatch>
      >;

      logger.debug({ inserted, linksTouched }, 'click batch processed');
    } catch (error) {
      if (!running) break;
      logger.error({ err: error }, 'click batch failed');
      // Back off briefly so a persistent fault does not become a hot loop.
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  logger.info('click worker loop exited');
}

async function shutdown(signal: string): Promise<void> {
  if (!running) return;
  running = false;
  logger.info({ signal }, 'click worker shutting down');

  const forceExit = setTimeout(() => {
    logger.error('worker shutdown timed out, forcing exit');
    process.exit(1);
  }, 15_000);
  forceExit.unref();

  // Let the current batch commit; abandoning it would lose those clicks.
  await inFlight.catch(() => undefined);

  const remaining = await queueLength().catch(() => -1);
  if (remaining > 0) {
    logger.warn({ remaining }, 'exiting with clicks still queued');
  }

  await Promise.allSettled([closeRedis(), closeDatabase()]);
  logger.info('click worker stopped');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled rejection in click worker');
  void shutdown('unhandledRejection');
});

await runLoop();
