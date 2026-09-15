# LinkPulse

[![CI](https://github.com/i-am-chitti/linkpulse/actions/workflows/ci.yml/badge.svg)](https://github.com/i-am-chitti/linkpulse/actions/workflows/ci.yml)

A high-performance URL shortener with real-time click analytics. Redirects are
served from a Redis read-through cache, click events are processed off the hot
path by a background worker, and abuse is bounded by a sliding-window rate
limiter implemented as a Redis Lua script.

Full design in [`docs/PROJECT_SPEC.md`](docs/PROJECT_SPEC.md).

## Stack

| Layer                      | Choice                                         |
| -------------------------- | ---------------------------------------------- |
| API                        | Node 22, Express 5, TypeScript                 |
| Database                   | PostgreSQL 16 + Prisma                         |
| Cache / queue / rate limit | Redis 7                                        |
| Frontend                   | Next.js 14 (App Router), TailwindCSS, Recharts |
| Validation                 | Zod (schemas shared between API and web)       |
| Tests                      | Vitest + Supertest, k6 for load                |
| Infra                      | Docker Compose, GitHub Actions                 |

## Layout

```
packages/shared   types, constants and Zod schemas used by both api and web
packages/api      Express API: redirects, link CRUD, analytics, auth
  prisma/         schema and migrations
  src/generated/  Prisma client, generated - gitignored
packages/web      Next.js dashboard: auth pages, protected layout
benchmarks/k6     load tests: redirect, create, analytics, mixed workload
```

Two processes run from the `api` package: `src/index.ts` serves HTTP, and
`src/worker.ts` drains the click queue. They are separate because the worker
loads a ~110 MB in-memory geo database that the redirect path never reads -
measured live, the api container holds ~50 MB against the worker's ~170 MB.

## Getting started

Requires Node >= 22, pnpm >= 10 and Docker.

```bash
pnpm install
cp .env.example .env

# Infra only; run the API on the host for a fast reload loop.
docker compose up -d postgres redis

pnpm --filter @linkpulse/api db:migrate      # apply migrations
pnpm --filter @linkpulse/api test:db:setup   # create + migrate the test database

cp packages/web/.env.example packages/web/.env.local   # once
pnpm dev
```

Host ports default to 4001 (api), 5433 (postgres) and 6381 (redis) so the stack
coexists with other local services; override `API_PORT`, `POSTGRES_PORT` and
`REDIS_PORT` in `.env` if those collide too.

`JWT_SECRET` has no default and compose refuses to start without it. Generate
one with `openssl rand -hex 32`.

Tests use Postgres database `linkpulse_test` and **Redis logical database 1**,
so `pnpm test` is safe to run while the dev stack is up - otherwise the running
worker would drain `clicks:queue` out from under the click tests.

Or bring up the whole stack, API included:

```bash
docker compose up -d
```

### Verify

```bash
curl -s localhost:4001/health
# {"status":"ok","uptime":3}

curl -s localhost:4001/health/ready
# {"status":"ready","checks":{"database":true,"redis":true}}

# Shorten a URL, then follow it.
CODE=$(curl -s -X POST localhost:4001/api/shorten \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com/long/path"}' | jq -r .shortCode)

curl -sI localhost:4001/$CODE | head -3
# HTTP/1.1 302 Found
# Cache-Control: no-store, no-cache, must-revalidate
# Location: https://example.com/long/path

# Clicks are queued off the hot path, then drained by the worker.
docker compose exec redis redis-cli LLEN clicks:queue
docker compose exec postgres psql -U linkpulse -d linkpulse \
  -c 'SELECT device_type, browser, country, referrer, count(*)
        FROM clicks GROUP BY 1,2,3,4 ORDER BY 5 DESC;'

# 11 guest-shorten requests from one IP trips the 10/min anonymous limit.
for i in $(seq 1 11); do
  curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:4001/api/shorten \
    -H 'content-type: application/json' -d '{"url":"https://example.com"}'
done
# 201 x10, then 429 with X-RateLimit-Remaining: 0 and Retry-After: <seconds>

# Dashboard, at http://localhost:3000: register, land on /dashboard, reload
# (session survives via the httpOnly refresh cookie), sign out.

# On /dashboard: shorten a URL (optionally with a custom alias or expiry),
# search and filter the list, toggle a link active/inactive, copy its short
# URL, delete it (requires a second confirming click).

# Click a link's analytics icon for clicks-over-time, top countries, device
# and browser breakdowns, and top referrers, over 7/30/90-day presets.
```

`/health` is dependency-free (liveness) so an orchestrator will not restart a
healthy process during a brief Redis blip. `/health/ready` checks dependencies
(readiness) so a load balancer can drain an instance that cannot serve traffic.

## Scripts

| Command          | Effect                                 |
| ---------------- | -------------------------------------- |
| `pnpm dev`       | Run every package in watch mode        |
| `pnpm build`     | Build all packages in dependency order |
| `pnpm test`      | Run all test suites                    |
| `pnpm typecheck` | Type-check without emitting            |
| `pnpm lint`      | ESLint across the workspace            |
| `pnpm format`    | Prettier write                         |

## Benchmarks

k6 load tests against the redirect hot path, link creation, analytics reads,
and a mixed workload. Full setup and how to reproduce: [`benchmarks/README.md`](benchmarks/README.md).
Latest run:

| Scenario                                             | Target                | Achieved RPS                   | P95  | Errors |
| ---------------------------------------------------- | --------------------- | ------------------------------ | ---- | ------ |
| Redirect Throughput (`GET /:shortCode`)              | >2,500 RPS, P95 <50ms | 2,077 (2,500 sustained target) | 40ms | 0%     |
| URL Creation (`POST /api/links`)                     | >200 RPS, P95 <200ms  | 457                            | 19ms | 0%     |
| Analytics Read (`GET /api/links/:id/analytics`)      | >100 RPS, P95 <300ms  | 280                            | 13ms | 0%     |
| Mixed Workload (80% redirect / 15% create / 5% read) | Stable under load     | 1,824                          | 30ms | 0%     |

Diagnosed with `docker stats` while pushing past the redirect target: the
ceiling above ~2,500 RPS is one saturated CPU core on the single Node.js api
process (~110-130% CPU), not Redis or Postgres (20-26% CPU each) - see
[`benchmarks/reports/RESULTS.md`](benchmarks/reports/RESULTS.md) for the full
notes, including why the redirect row's RPS figure is a whole-run average
diluted by ramp-up/down while its P95 reflects the sustained-target phase.

## Status

- [x] Monorepo scaffold, shared schemas, API skeleton, Docker Compose
- [x] Prisma schema and migrations
- [x] Shorten + redirect with Redis read-through cache
- [x] Auth: email/password, JWT access tokens, rotating refresh tokens
- [x] Link CRUD scoped to the owner, with cache invalidation
- [ ] OAuth (GitHub, Google)
- [x] Async click tracking (queue + worker)
- [x] Analytics API (time series and breakdowns)
- [x] Dashboard charts
- [x] Sliding-window rate limiter (Redis Lua, per-IP and per-user tiers)
- [x] Next.js dashboard shell: auth pages, protected layout, session restore
- [x] Link list, search/filter/pagination, create form, per-row actions
- [x] Per-link analytics: clicks over time, top countries, devices, browsers, referrers
- [x] CI/CD: lint, typecheck, build and test on every push/PR; Docker images published to GHCR on merge to main
- [x] k6 benchmarks
