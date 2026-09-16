import http from 'k6/http';
import { sleep } from 'k6';
import {
  BASE_URL,
  TREND_STATS,
  registerBenchUser,
  createLinks,
  authHeaders,
  driveClicks,
  waitForClickCount,
  checkStatus,
} from './lib/bench.js';

// Analytics Read: 30 VUs, 2 min flat, target >100 RPS with P95 <300ms - the
// one scenario here that is not cache-served: every request runs a real
// aggregation query.
export const options = {
  vus: 30,
  duration: '2m',
  setupTimeout: '60s',
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
  },
  summaryTrendStats: TREND_STATS,
};

const SEED_CLICKS = 300;
const SEED_CLICKS_TIMEOUT_SECONDS = 20;

export function setup() {
  const token = registerBenchUser();
  const [link] = createLinks(token, 1);

  // Real click volume, not an empty table: this drives the same
  // redirect -> queue -> worker -> clicks pipeline production traffic uses,
  // so the aggregation below runs over rows that exist for the same reason
  // real ones would.
  driveClicks(link.shortCode, SEED_CLICKS);
  waitForClickCount(token, link.id, SEED_CLICKS, SEED_CLICKS_TIMEOUT_SECONDS);

  return { token, linkId: link.id };
}

export default function (data) {
  const res = http.get(`${BASE_URL}/api/links/${data.linkId}/analytics`, authHeaders(data.token));

  checkStatus(res, 200, 'analytics');

  sleep(0.1);
}
