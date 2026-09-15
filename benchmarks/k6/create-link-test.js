import http from 'k6/http';
import { sleep } from 'k6';
import { BASE_URL, TREND_STATS, registerBenchUser, authHeaders, checkStatus } from './lib/bench.js';

// PROJECT_SPEC.md section 11.1: URL Creation.
// 50 VUs, 2 min flat, target >200 RPS with P95 <200ms.
export const options = {
  vus: 50,
  duration: '2m',
  thresholds: {
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
  },
  summaryTrendStats: TREND_STATS,
};

export function setup() {
  return { token: registerBenchUser() };
}

export default function (data) {
  const res = http.post(
    `${BASE_URL}/api/links`,
    JSON.stringify({ url: `https://example.com/k6-benchmark/create/${__VU}-${__ITER}` }),
    authHeaders(data.token),
  );

  checkStatus(res, 201, 'create');

  sleep(0.1);
}
