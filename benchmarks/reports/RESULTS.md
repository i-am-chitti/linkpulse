# k6 Load Test Results

Generated 2026-09-15T06:03:21.544Z.

Run **locally**: k6 and the whole Docker Compose stack (api, worker, Redis,
Postgres) on one developer machine, with `docker-compose.loadtest.yml`
layered over the base stack (elevated rate limits only, so the limiter never
throttles the load generator itself - see that file and
`benchmarks/README.md`). Not a measurement of the live deployment.

Machine: Apple M2 Pro (6 performance + 4 efficiency cores), 16 GB RAM.

| Scenario | Endpoint | Target | Achieved RPS | P50 | P95 | P99 | Errors | Thresholds |
|---|---|---|---|---|---|---|---|---|
| Redirect Throughput | `GET /:shortCode` | >2,500 RPS, P95 <50ms | 2077.4 | 0.8ms | 40.0ms | 109.7ms | 0.00% | ✅ passed |
| URL Creation | `POST /api/links` | >200 RPS, P95 <200ms | 457.4 | 7.2ms | 19.0ms | 29.6ms | 0.00% | ✅ passed |
| Analytics Read | `GET /api/links/:id/analytics` | >100 RPS, P95 <300ms | 280.3 | 5.0ms | 13.4ms | 27.6ms | 0.00% | ✅ passed |
| Mixed Workload | `80% redirect / 15% create / 5% analytics` | Stable under load | 1824.1 | 4.2ms | 30.3ms | 89.7ms | 0.00% | ✅ passed |

## Notes

- **Redirect Throughput uses a `ramping-arrival-rate` executor**, not a fixed
  VU count: it asks k6 for a request rate directly (ramp to, then hold,
  2,500 req/s) and lets k6 allocate whatever VUs that takes - raising VU
  count is not the same lever as raising request rate.
- **"Achieved RPS" for that scenario is a whole-run average**, diluted by
  its 40s of ramp-up/ramp-down; the reported P95 is the trustworthy figure,
  since the 2-minute hold at the 2,500 req/s target supplies ~80% of the
  run's requests.
- **Bottleneck above ~2,500 RPS is one CPU core, not Redis or Postgres**:
  `docker stats` during a 3,000 req/s run showed the `api` container at
  ~110-130% CPU while `redis`/`postgres` sat at 20-26%. Horizontal scaling
  (multiple API replicas behind a load balancer - JWT access tokens are
  already stateless, so no sticky sessions needed) is the next step past
  this ceiling; not implemented here, outside load-testing scope.
