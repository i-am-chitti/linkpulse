import http from 'k6/http';
import {
  BASE_URL,
  TREND_STATS,
  registerBenchUser,
  createLinks,
  warmCache,
  randomItem,
  checkStatus,
} from './lib/bench.js';

// PROJECT_SPEC.md section 11.1: Redirect Throughput, target >2,500 RPS with
// P95 <50ms.
//
// ramping-arrival-rate, not a VU-based executor: it asks for the request
// rate directly and lets k6 allocate whatever VUs sustaining it needs. A
// constant/ramping-VUs executor conflates "clients connected" with "requests
// per second" - raising VU count is not the same lever as raising rate, and
// self-induced queueing from an oversized VU pool would misreport the hot
// path's own latency.
export const options = {
  scenarios: {
    redirect_throughput: {
      executor: 'ramping-arrival-rate',
      timeUnit: '1s',
      startRate: 0,
      preAllocatedVUs: 300,
      maxVUs: 1000,
      stages: [
        { target: 1250, duration: '20s' },
        { target: 2500, duration: '20s' },
        { target: 2500, duration: '2m' }, // sustained at the target rate
        { target: 0, duration: '20s' },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<50'],
    http_req_failed: ['rate<0.01'],
  },
  summaryTrendStats: TREND_STATS,
};

const SEED_LINK_COUNT = 20;

export function setup() {
  const token = registerBenchUser();
  const links = createLinks(token, SEED_LINK_COUNT);
  const codes = links.map((link) => link.shortCode);
  warmCache(codes);
  return { codes };
}

// No think-time sleep: the arrival-rate executor already controls request
// rate directly, so a per-iteration sleep here would only fight the executor
// for no benefit, unlike the other three scenarios' VU-based executors.
export default function (data) {
  const code = randomItem(data.codes);
  const res = http.get(`${BASE_URL}/${code}`, { redirects: 0 });

  checkStatus(res, 302, 'redirect');
}
