import http from 'k6/http';
import { sleep } from 'k6';
import {
  BASE_URL,
  TREND_STATS,
  registerBenchUser,
  createLinks,
  warmCache,
  authHeaders,
  driveClicks,
  waitForClickCount,
  randomItem,
  checkStatus,
} from './lib/bench.js';

// Mixed Workload: 200 VUs, 5 min, 80% redirect / 15% create / 5% analytics
// read. Target is "stable under load", not a throughput number - so the
// only hard threshold is a bounded error rate, and RPS/latency are
// reported, not gated.
export const options = {
  vus: 200,
  duration: '5m',
  setupTimeout: '60s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
  },
  summaryTrendStats: TREND_STATS,
};

const SEED_LINK_COUNT = 20;
const SEED_CLICKS = 300;
const SEED_CLICKS_TIMEOUT_SECONDS = 20;

export function setup() {
  const token = registerBenchUser();
  const links = createLinks(token, SEED_LINK_COUNT);
  const codes = links.map((link) => link.shortCode);
  warmCache(codes);

  // Reuses the first seed link for the analytics slice, same as
  // analytics-read-test.js, so that 5% of traffic hits a real aggregation.
  const analyticsLink = links[0];
  driveClicks(analyticsLink.shortCode, SEED_CLICKS);
  waitForClickCount(token, analyticsLink.id, SEED_CLICKS, SEED_CLICKS_TIMEOUT_SECONDS);

  return { token, codes, analyticsLinkId: analyticsLink.id };
}

export default function (data) {
  const roll = Math.random();

  if (roll < 0.8) {
    const res = http.get(`${BASE_URL}/${randomItem(data.codes)}`, { redirects: 0 });
    checkStatus(res, 302, 'redirect');
  } else if (roll < 0.95) {
    const res = http.post(
      `${BASE_URL}/api/links`,
      JSON.stringify({ url: `https://example.com/k6-benchmark/mixed/${__VU}-${__ITER}` }),
      authHeaders(data.token),
    );
    checkStatus(res, 201, 'create');
  } else {
    const res = http.get(
      `${BASE_URL}/api/links/${data.analyticsLinkId}/analytics`,
      authHeaders(data.token),
    );
    checkStatus(res, 200, 'analytics');
  }

  sleep(0.1);
}
