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
// A constant/ramping-VUs executor (the spec's own sample script, and this
// file's first version) conflates "how many clients are connected" with "how
// many requests per second arrive" - a naive closed loop of 500 VUs hammering
// with no pacing pushed well past 2,500 RPS but also self-induced queueing
// (P95 rose to ~170ms), because raising VUs is not the same lever as raising
// request rate. ramping-arrival-rate asks for the rate directly and lets k6
// allocate whatever VUs it needs to sustain it, which is what "prove the
// hot path sustains 2,500 RPS at P95 <50ms" actually means to measure.
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
