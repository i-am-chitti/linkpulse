# LinkPulse

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
packages/web      Next.js dashboard                        (not yet scaffolded)
benchmarks/k6     load tests                               (not yet scaffolded)
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

## Status

- [x] Monorepo scaffold, shared schemas, API skeleton, Docker Compose
- [x] Prisma schema and migrations
- [x] Shorten + redirect with Redis read-through cache
- [x] Auth: email/password, JWT access tokens, rotating refresh tokens
- [ ] Link CRUD scoped to the owner
- [ ] OAuth (GitHub, Google)
- [x] Async click tracking (queue + worker)
- [ ] Analytics API and dashboard charts
- [ ] Sliding-window rate limiter
- [ ] Next.js dashboard
- [ ] k6 benchmarks
- [ ] CI/CD and deployment
