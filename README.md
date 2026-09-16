# LinkPulse

[![CI](https://github.com/i-am-chitti/linkpulse/actions/workflows/ci.yml/badge.svg)](https://github.com/i-am-chitti/linkpulse/actions/workflows/ci.yml)

A production-shaped URL shortener with real-time click analytics, built to
demonstrate backend engineering: a Redis read-through cache on the redirect
hot path, an async click pipeline that never blocks a response, a
Lua-scripted sliding-window rate limiter, rotating refresh tokens with
reuse detection, and load-tested, root-caused performance numbers rather than
estimated ones.

The frontend (Next.js) exists to make the backend demonstrable end to end -
it is deliberately not the focus of this project.

**[Architecture and design decisions →](ARCHITECTURE.md)**

## Features

- **URL shortening** - auto-generated base62 codes, optional custom alias,
  optional expiry, collision retry.
- **Guest mode** - shorten with no account, right from the landing page;
  links expire in 24h and are swept from the database automatically.
- **Auth** - email/password (bcrypt) and OAuth (GitHub, Google), JWT access
  tokens held in memory only, httpOnly rotating refresh tokens with
  family-based reuse detection.
- **Link management** - owner-scoped CRUD, search, status and created-date
  filters, inline destination editing, active/inactive toggle.
- **Analytics** - clicks over time, unique visitors (IP-deduplicated per
  day), top countries, device and browser breakdown, top referrers, all
  served from real-time async-ingested click data.
- **Abuse protection** - a Redis Lua sliding-window rate limiter with
  separate anonymous/authenticated tiers per route, and a configurable
  malicious-URL blocklist checked on every create and edit.
- **Background maintenance** - expired guest links and stale refresh tokens
  purged automatically by the click worker.
- **CI/CD** - lint, typecheck, build and test on every push/PR; Docker
  images published to GHCR on merge to `main`.
- **Load-tested** - k6 scenarios for the redirect hot path, link creation,
  analytics reads, and a mixed workload, with real numbers and a diagnosed
  bottleneck, not just a pass/fail. See [Benchmarks](#benchmarks).

## Stack

| Layer                      | Choice                                      |
| -------------------------- | ------------------------------------------- |
| API                        | Node 22, Express 5, TypeScript              |
| Database                   | PostgreSQL 16 + Prisma 7                    |
| Cache / queue / rate limit | Redis 7                                     |
| Frontend                   | Next.js 16 (App Router), Tailwind, Recharts |
| Validation                 | Zod (schemas shared between API and web)    |
| Tests                      | Vitest + Supertest, k6 for load             |
| Infra                      | Docker Compose, GitHub Actions              |

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

# The same worker also sweeps expired guest links and stale refresh tokens,
# hourly (CLEANUP_INTERVAL_MINUTES) - on startup too, so restarting it forces
# an immediate sweep for a demo. Watch it happen:
docker compose restart worker && docker compose logs worker --tail 5
# {"...","purgedLinks":N,"purgedTokens":N,"msg":"cleanup sweep complete"}
# (only logged when something was actually purged)

# 11 guest-shorten requests from one IP trips the 10/min anonymous limit.
for i in $(seq 1 11); do
  curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:4001/api/shorten \
    -H 'content-type: application/json' -d '{"url":"https://example.com"}'
done
# 201 x10, then 429 with X-RateLimit-Remaining: 0 and Retry-After: <seconds>

# A blocklisted URL is refused on create and on edit (URL_BLOCKLIST in .env;
# defaults to Google's own Safe Browsing test domains).
curl -s -X POST localhost:4001/api/shorten -H 'content-type: application/json' \
  -d '{"url":"https://testsafebrowsing.appspot.com/s/malware.html"}'
# {"error":{"code":"BAD_REQUEST","message":"This URL is on the blocklist..."}}

# http://localhost:3000: guest shortening right on the landing page, no
# account - shorten a url, copy the result, follow it. It expires in 24h and
# has no analytics, per guest mode's limits.

# Register from there and land on /dashboard, reload (session survives via
# the httpOnly refresh cookie), sign out.

# On /dashboard: shorten a URL (optionally with a custom alias or expiry),
# search and filter the list by status or created-date range, edit a link's
# destination inline (pencil icon), toggle a link active/inactive, copy its
# short URL, delete it (requires a second confirming click).

# Click a link's analytics icon for clicks-over-time, top countries, device
# and browser breakdowns, and top referrers, over 7/30/90-day presets.

# "Continue with GitHub"/"Google" on /login or /register - real OAuth
# needs GITHUB_CLIENT_ID/SECRET or GOOGLE_CLIENT_ID/SECRET in .env (see
# .env.example for where to register an app); with neither set, the button
# still round-trips through the API and lands back on a real error page
# rather than a dead link.
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

## E2E / live verification

`docker-compose.e2e.yml` is a second, fully isolated stack - its own
Postgres, Redis, and containers, on ports 3001/4002/5434/6382 - for
browser-driven checks (Playwright, manual clicking around) that need a real
running app but must never touch the dev stack's database. It costs nothing
to reset and nothing to wipe, on purpose:

```bash
pnpm e2e:reset             # fresh containers, fresh database, migrations applied
pnpm e2e:clean             # truncate all data, keep the stack running
pnpm e2e:down              # stop everything and drop the volume
pnpm e2e:run -- <command>  # reset, run <command> against it, always tear down after
```

Needs no `.env` and no setup - `JWT_SECRET` is a fixed dummy value valid only
inside this stack. The dev stack and this can both be running at once:

```bash
pnpm docker:up    # dev stack up (docker compose up -d)
pnpm docker:down  # dev stack down, data preserved (no -v - the named volume survives)
```

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
More on this in [ARCHITECTURE.md](ARCHITECTURE.md#performance).

## Limitations

Honest gaps, not oversights left unmentioned:

- **Not deployed.** CI/CD builds and publishes Docker images to GHCR on every
  merge to `main`, but no cloud host is wired up - there's nothing to link to
  yet.
- **Single-node throughput ceiling.** The k6 results above found the redirect
  path's limit at one saturated CPU core on the single API process, not
  Redis or Postgres. Horizontal scaling (multiple API replicas behind a load
  balancer - the JWT/refresh design is already stateless, so this needs no
  sticky sessions) is the documented next step, not implemented here.
- **Blocklist is a static domain list**, not a live threat-intelligence feed
  or the Google Safe Browsing API - a deliberate scope choice for a
  self-contained project with no external API key requirement. See
  [ARCHITECTURE.md](ARCHITECTURE.md) for the reasoning.
- **OAuth is hand-rolled**, not NextAuth.js, to stay consistent with the
  Express API's own JWT/refresh-token session model rather than running two
  parallel auth systems.
- **No account linking.** Signing up with GitHub after registering with the
  same email via password (or vice versa) is rejected, not merged - the
  schema gives every user exactly one provider by design.
- **No dark mode**, no QR codes, no bulk shortening, no API keys, no
  webhooks - out of scope for what this project sets out to demonstrate.
- **No metrics/tracing backend.** Structured JSON logs (Pino) exist
  throughout; there is no Prometheus/Grafana/OpenTelemetry wiring.
