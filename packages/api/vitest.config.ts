import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration tests touch a real Postgres/Redis; keep them serial so they
    // do not race on shared state.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: 'postgresql://linkpulse:linkpulse@localhost:5433/linkpulse_test',
      // Logical database 1, not 0.
      //
      // The dev stack's worker is usually running against database 0 and would
      // drain clicks:queue out from under these tests - and both would block on
      // BRPOP for the same key. A separate database isolates every key,
      // including the url:* cache, from whatever the dev stack is doing.
      REDIS_URL: 'redis://localhost:6381/1',
      // The schema's floor, not the 100k default: lets the queue-cap test
      // prove trimming works without pushing 100k events.
      CLICK_QUEUE_MAX_LENGTH: '100',
      // Fixed test secret; the real one comes from the environment.
      JWT_SECRET: 'test-only-secret-at-least-thirty-two-characters-long',
      // bcrypt's floor. 12 would add ~250ms to every auth test.
      BCRYPT_ROUNDS: '10',
    },
  },
});
