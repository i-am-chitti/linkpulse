import http from 'k6/http';
import { check, sleep } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:4001';

/**
 * Trend stats every scenario asks the summary to report, so
 * benchmarks/report.mjs always finds p(99) in the exported JSON - k6's
 * default set omits it.
 */
export const TREND_STATS = ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'];

/**
 * A disposable account for one benchmark run. Registering a brand-new user
 * per run is simpler than reusing one across runs would be, and it keeps
 * one run's seeded links from ever mixing with another's.
 */
export function registerBenchUser() {
  const email = `k6-bench-${Date.now()}-${Math.floor(Math.random() * 1e6)}@loadtest.local`;
  const res = http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify({ email, password: 'k6-benchmark-password-1', name: 'k6 benchmark' }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  if (res.status !== 201) {
    throw new Error(`benchmark user registration failed: ${res.status} ${res.body}`);
  }

  return res.json('accessToken');
}

export function authHeaders(token) {
  return { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };
}

/** Creates `count` real, owned links and returns their {id, shortCode} pairs. */
export function createLinks(token, count) {
  const links = [];
  for (let i = 0; i < count; i += 1) {
    const res = http.post(
      `${BASE_URL}/api/links`,
      JSON.stringify({ url: `https://example.com/k6-benchmark/seed/${i}` }),
      authHeaders(token),
    );
    if (res.status !== 201) {
      throw new Error(`seed link creation failed: ${res.status} ${res.body}`);
    }
    const body = res.json();
    links.push({ id: body.id, shortCode: body.shortCode });
  }
  return links;
}

/**
 * One GET per code, before the timed run starts. Primes the Redis
 * read-through cache so the measured run captures cache-hit latency, not the
 * one-time miss that populates it - see PROJECT_SPEC.md section 2.2.
 */
export function warmCache(codes) {
  for (const code of codes) {
    http.get(`${BASE_URL}/${code}`, { redirects: 0 });
  }
}

/** Fires `count` real redirects at one code, to give it genuine click volume. */
export function driveClicks(shortCode, count) {
  for (let i = 0; i < count; i += 1) {
    http.get(`${BASE_URL}/${shortCode}`, { redirects: 0 });
  }
}

/**
 * Polls until the async click worker has caught up, so the analytics query
 * this feeds runs over real rows rather than an empty table. Gives up after
 * `timeoutSeconds` and lets the caller proceed anyway - a slow worker should
 * not turn into a total inability to benchmark the read path.
 */
export function waitForClickCount(token, linkId, minCount, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const res = http.get(`${BASE_URL}/api/links/${linkId}`, authHeaders(token));
    if (res.status === 200 && res.json('clickCount') >= minCount) {
      return res.json('clickCount');
    }
    sleep(1);
  }
  return null;
}

export function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function checkStatus(res, expected, label) {
  return check(res, { [`${label}: status is ${expected}`]: (r) => r.status === expected });
}
