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
      /**
       * Effectively unlimited, not the production defaults.
       *
       * Every anonymous supertest call in this suite shares one IP
       * (127.0.0.1), so shorten.test.ts alone issues ~35 POST /api/shorten
       * calls in one run - already past the real 10/min default - and
       * auth.test.ts's ~30 register/login calls blow past the real 20/min
       * auth budget. None of those files know about rate limiting; they
       * were not written expecting a shared per-IP quota.
       *
       * The limiter's actual logic (the sliding window blend, 429 + Retry-
       * After, fail-open on a Redis error) is exercised by
       * tests/unit/rateLimiter.test.ts and tests/unit/rateLimitMiddleware.test.ts
       * against small, explicit, per-test limits that never touch this env.
       * These high values just keep it out of every other file's way.
       */
      RATE_LIMIT_ANON_CREATE_PER_MINUTE: '100000',
      RATE_LIMIT_ANON_REDIRECT_PER_MINUTE: '100000',
      RATE_LIMIT_USER_API_PER_MINUTE: '100000',
      RATE_LIMIT_USER_REDIRECT_PER_MINUTE: '100000',
      RATE_LIMIT_AUTH_PER_MINUTE: '100000',
      RATE_LIMIT_CREATE_PER_IP_PER_MINUTE: '100000',
      // Small enough that links.test.ts can seed up to it in one createMany.
      MAX_LINKS_PER_USER: '40',
    },
  },
});
