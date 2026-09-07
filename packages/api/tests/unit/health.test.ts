import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { closeRedis } from '../../src/lib/redis.js';

const app = createApp();

// The Redis client connects eagerly, which would keep the event loop alive.
afterAll(async () => {
  await closeRedis();
});

describe('GET /health', () => {
  it('reports ok without touching any dependency', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
  });
});

describe('GET /health/ready', () => {
  it('reports the state of each dependency it checks', async () => {
    const res = await request(app).get('/health/ready');

    // 200 when Redis is up, 503 when it is not; both are correct answers, so
    // assert the contract rather than the environment.
    expect([200, 503]).toContain(res.status);
    expect(res.body.checks).toHaveProperty('redis');
    expect(res.body.status).toBe(res.status === 200 ? 'ready' : 'degraded');
  });
});

describe('unmatched routes', () => {
  it('returns the standard error envelope', async () => {
    const res = await request(app).get('/definitely-not-a-route');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Cannot GET /definitely-not-a-route' },
    });
  });

  it('does not leak the framework in headers', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
