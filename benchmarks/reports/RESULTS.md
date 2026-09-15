# k6 Load Test Results

Generated 2026-09-15T06:03:21.544Z.

Run with `docker-compose.loadtest.yml` layered over the base stack (elevated
rate limits only, so the limiter never throttles the load generator itself -
see that file and `benchmarks/README.md`).

| Scenario | Endpoint | Target | Achieved RPS | P50 | P95 | P99 | Errors | Thresholds |
|---|---|---|---|---|---|---|---|---|
| Redirect Throughput | `GET /:shortCode` | >2,500 RPS, P95 <50ms | 2077.4 | 0.8ms | 40.0ms | 109.7ms | 0.00% | ✅ passed |
| URL Creation | `POST /api/links` | >200 RPS, P95 <200ms | 457.4 | 7.2ms | 19.0ms | 29.6ms | 0.00% | ✅ passed |
| Analytics Read | `GET /api/links/:id/analytics` | >100 RPS, P95 <300ms | 280.3 | 5.0ms | 13.4ms | 27.6ms | 0.00% | ✅ passed |
| Mixed Workload | `80% redirect / 15% create / 5% analytics` | Stable under load | 1824.1 | 4.2ms | 30.3ms | 89.7ms | 0.00% | ✅ passed |

## Notes

- **Redirect Throughput uses a `ramping-arrival-rate` executor**, not a fixed
  VU count: it asks k6 for a request rate directly (ramp to, then hold,
  2,500 req/s) and lets k6 allocate whatever VUs that takes. An earlier,
  naive constant-VUs version of this test (500 VUs in a closed loop, no
  pacing) pushed well past 2,500 RPS but also self-induced queueing - P95
  rose to ~170ms - because raising concurrent VUs is not the same lever as
  raising request rate.
- **The redirect scenario's "Achieved RPS" is a whole-run average**,
  diluted by its 40s of ramp-up/ramp-down; the reported P95, by contrast,
  is trustworthy as a read on sustained-target behavior, since the 2-minute
  hold at the 2,500 req/s target supplies about 80% of that run’s requests.
- **Diagnosed bottleneck above ~2,500 RPS: one CPU core, not Redis or
  Postgres.** Pushing the target rate to 3,000 req/s sustained tipped P95
  past the 50ms threshold; sampling `docker stats` during that run showed
  the `api` container pinned at ~110-130% CPU (one core saturated) while
  `redis` and `postgres` sat at 20-26%. The single Node.js API process is
  the ceiling, not the cache or the database. Horizontal scaling (multiple
  API replicas behind a load balancer - the JWT access tokens are already
  stateless, so this needs no sticky sessions) is the documented next step
  past this ceiling, not implemented here as it is outside load-testing scope.
