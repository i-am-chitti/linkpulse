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
  'Run **locally**: k6 and the whole Docker Compose stack (api, worker, Redis,',
  'Postgres) on one developer machine, with `docker-compose.loadtest.yml`',
  'layered over the base stack (elevated rate limits only, so the limiter never',
  'throttles the load generator itself - see that file and',
  '`benchmarks/README.md`). Not a measurement of the live deployment.',
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
  '  2,500 req/s) and lets k6 allocate whatever VUs that takes - raising VU',
  '  count is not the same lever as raising request rate.',
  '- **"Achieved RPS" for that scenario is a whole-run average**, diluted by',
  '  its 40s of ramp-up/ramp-down; the reported P95 is the trustworthy figure,',
  '  since the 2-minute hold at the 2,500 req/s target supplies ~80% of the',
  "  run's requests.",
  '- **Bottleneck above ~2,500 RPS is one CPU core, not Redis or Postgres**:',
  '  `docker stats` during a 3,000 req/s run showed the `api` container at',
  '  ~110-130% CPU while `redis`/`postgres` sat at 20-26%. Horizontal scaling',
  '  (multiple API replicas behind a load balancer - JWT access tokens are',
  '  already stateless, so no sticky sessions needed) is the next step past',
  '  this ceiling; not implemented here, outside load-testing scope.',
  '',
];

writeFileSync(new URL('RESULTS.md', REPORTS_DIR), lines.join('\n'));
process.stdout.write(lines.join('\n') + '\n');
