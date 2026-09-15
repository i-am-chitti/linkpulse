#!/usr/bin/env node
// Renders benchmarks/reports/RESULTS.md from the k6 JSON summaries produced by
// `k6 run --summary-export=reports/<name>.json <script>.js`. Run once all four
// scenarios have been captured: `node benchmarks/report.mjs`.
import { readFileSync, writeFileSync } from 'node:fs';

const REPORTS_DIR = new URL('./reports/', import.meta.url);

const SCENARIOS = [
  {
    file: 'redirect.json',
    name: 'Redirect Throughput',
    endpoint: 'GET /:shortCode',
    target: '>2,500 RPS, P95 <50ms',
  },
  {
    file: 'create-link.json',
    name: 'URL Creation',
    endpoint: 'POST /api/links',
    target: '>200 RPS, P95 <200ms',
  },
  {
    file: 'analytics-read.json',
    name: 'Analytics Read',
    endpoint: 'GET /api/links/:id/analytics',
    target: '>100 RPS, P95 <300ms',
  },
  {
    file: 'mixed-workload.json',
    name: 'Mixed Workload',
    endpoint: '80% redirect / 15% create / 5% analytics',
    target: 'Stable under load',
  },
];

function fmt(n, digits = 1) {
  return typeof n === 'number' ? n.toFixed(digits) : 'n/a';
}

/**
 * k6's exported thresholds map is `{ [expression]: boolean }` where `true`
 * means the threshold was BREACHED - opposite of what the key name suggests,
 * and opposite of the checkmark it prints to the terminal.
 */
function anyThresholdFailed(metrics) {
  return Object.values(metrics).some((metric) =>
    Object.values(metric.thresholds ?? {}).some((breached) => breached === true),
  );
}

function readScenario(scenario) {
  let raw;
  try {
    raw = readFileSync(new URL(scenario.file, REPORTS_DIR), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { ...scenario, missing: true };
    throw error;
  }
  const data = JSON.parse(raw);

  const m = data.metrics;
  return {
    ...scenario,
    missing: false,
    rps: m.http_reqs?.rate,
    p50: m.http_req_duration?.med,
    p95: m.http_req_duration?.['p(95)'],
    p99: m.http_req_duration?.['p(99)'],
    errorRate: (m.http_req_failed?.value ?? 0) * 100,
    thresholdsFailed: anyThresholdFailed(m),
  };
}

const rows = SCENARIOS.map(readScenario);

const lines = [
  '# k6 Load Test Results',
  '',
  `Generated ${new Date().toISOString()}.`,
  '',
  'Run with `docker-compose.loadtest.yml` layered over the base stack (elevated',
  'rate limits only, so the limiter never throttles the load generator itself -',
  'see that file and `benchmarks/README.md`).',
  '',
  '| Scenario | Endpoint | Target | Achieved RPS | P50 | P95 | P99 | Errors | Thresholds |',
  '|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) =>
    r.missing
      ? `| ${r.name} | \`${r.endpoint}\` | ${r.target} | _not run_ | - | - | - | - | - |`
      : `| ${r.name} | \`${r.endpoint}\` | ${r.target} | ${fmt(r.rps)} | ${fmt(r.p50)}ms | ${fmt(r.p95)}ms | ${fmt(r.p99)}ms | ${fmt(r.errorRate, 2)}% | ${r.thresholdsFailed ? '❌ FAILED' : '✅ passed'} |`,
  ),
  '',
  '## Notes',
  '',
  '- **Redirect Throughput uses a `ramping-arrival-rate` executor**, not a fixed',
  '  VU count: it asks k6 for a request rate directly (ramp to, then hold,',
  '  2,500 req/s) and lets k6 allocate whatever VUs that takes. An earlier,',
  '  naive constant-VUs version of this test (500 VUs in a closed loop, no',
  '  pacing) pushed well past 2,500 RPS but also self-induced queueing - P95',
  '  rose to ~170ms - because raising concurrent VUs is not the same lever as',
  '  raising request rate.',
  '- **The redirect scenario\'s "Achieved RPS" is a whole-run average**,',
  '  diluted by its 40s of ramp-up/ramp-down; the reported P95, by contrast,',
  '  is trustworthy as a read on sustained-target behavior, since the 2-minute',
  '  hold at the 2,500 req/s target supplies about 80% of that run’s requests.',
  '- **Diagnosed bottleneck above ~2,500 RPS: one CPU core, not Redis or',
  '  Postgres.** Pushing the target rate to 3,000 req/s sustained tipped P95',
  '  past the 50ms threshold; sampling `docker stats` during that run showed',
  '  the `api` container pinned at ~110-130% CPU (one core saturated) while',
  '  `redis` and `postgres` sat at 20-26%. The single Node.js API process is',
  '  the ceiling, not the cache or the database. Horizontal scaling (multiple',
  '  API replicas behind a load balancer - the JWT access tokens are already',
  '  stateless, so this needs no sticky sessions) is the documented next step',
  '  past this ceiling, not implemented here as it is outside load-testing scope.',
  '',
];

writeFileSync(new URL('RESULTS.md', REPORTS_DIR), lines.join('\n'));
process.stdout.write(lines.join('\n') + '\n');
