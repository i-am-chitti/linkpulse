# k6 Load Tests

Four scenarios from [`PROJECT_SPEC.md` section 11.1](../docs/PROJECT_SPEC.md#11-benchmarking-plan-k6-load-testing), each fully
self-contained: its `setup()` registers a throwaway benchmark user, seeds the
real links (and, for the analytics scenario, real click volume) it needs, and
returns that data to every VU. Nothing to seed by hand first.

| Script                   | Scenario            | Profile                                                  | Target                |
| ------------------------ | ------------------- | -------------------------------------------------------- | --------------------- |
| `redirect-load-test.js`  | Redirect Throughput | ramp to, then hold, 2,500 req/s for 2 min                | >2,500 RPS, P95 <50ms |
| `create-link-test.js`    | URL Creation        | 50 VUs, 2 min                                            | >200 RPS, P95 <200ms  |
| `analytics-read-test.js` | Analytics Read      | 30 VUs, 2 min                                            | >100 RPS, P95 <300ms  |
| `mixed-workload-test.js` | Mixed Workload      | 200 VUs, 5 min, 80% redirect / 15% create / 5% analytics | Stable under load     |

## Running

Install k6 once (`brew install k6`, or see <https://k6.io/docs/get-started/installation/>).

Start the stack with the benchmarking overlay, which raises the rate limiter's
ceilings so it never throttles the load generator itself - see
[`docker-compose.loadtest.yml`](../docker-compose.loadtest.yml) for exactly why
and by how much:

```bash
docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d --build api
```

Then, from `benchmarks/k6/`:

```bash
k6 run --summary-export ../reports/redirect.json redirect-load-test.js
k6 run --summary-export ../reports/create-link.json create-link-test.js
k6 run --summary-export ../reports/analytics-read.json analytics-read-test.js
k6 run --summary-export ../reports/mixed-workload.json mixed-workload-test.js
```

Then render the results table:

```bash
node ../report.mjs   # writes benchmarks/reports/RESULTS.md
```

`BASE_URL` defaults to `http://localhost:4001` (this repo's default host port
for the api service); override it with `k6 run -e BASE_URL=... <script>.js` to
point at a different stack.

**Afterwards**, switch the api service back to production-shaped rate limits:

```bash
docker compose up -d --build api
```

## Why an overlay file, not a `.env` edit

The elevated limits are a property of _running a benchmark_, not of any one
developer's machine - a `.env` edit is local, easy to forget to revert, and
invisible to anyone else who wants to reproduce a result. The overlay is
committed, self-documenting, and only ever touches the one thing the load
generator's own traffic pattern actually requires raising: see the comment
in `docker-compose.loadtest.yml` for the full reasoning.

## Results

See [`reports/RESULTS.md`](reports/RESULTS.md) for the latest run, including
the diagnosed single-core CPU ceiling above the redirect target and why the
"Achieved RPS" figure there is a whole-run average rather than the sustained
rate at target. The raw k6 JSON summaries themselves (`reports/*.json`) are
not committed - regenerate them with the commands above.
