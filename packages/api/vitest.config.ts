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
      REDIS_URL: 'redis://localhost:6381',
      // The schema's floor, not the 100k default: lets the queue-cap test
      // prove trimming works without pushing 100k events.
      CLICK_QUEUE_MAX_LENGTH: '100',
    },
  },
});
