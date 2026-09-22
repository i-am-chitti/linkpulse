# Development

Setup, the day-to-day scripts, and how to verify a change actually works.
Project overview: [README.md](README.md). Design reasoning: [ARCHITECTURE.md](ARCHITECTURE.md).

## Getting started

Requires Node >= 24 (see `.nvmrc`), pnpm >= 10 and Docker.

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
pnpm docker:up
```

## Scripts

| Command                     | Effect                                                                        |
| --------------------------- | ----------------------------------------------------------------------------- |
| `pnpm dev`                  | Run every package in watch mode                                               |
| `pnpm build`                | Build all packages in dependency order                                        |
| `pnpm test`                 | Run all test suites                                                           |
| `pnpm typecheck`            | Type-check without emitting                                                   |
| `pnpm lint`                 | ESLint across the workspace                                                   |
| `pnpm lint:fix`             | ESLint across the workspace, applying autofixes                               |
| `pnpm format`               | Prettier write                                                                |
| `pnpm format:check`         | Prettier check only, no writes (what CI runs)                                 |
| `pnpm docker:up`            | Dev stack up (`docker compose up -d`)                                         |
| `pnpm docker:down`          | Dev stack down, data preserved (no `-v` - the named volume survives)          |
| `pnpm e2e:reset`            | Isolated e2e stack: fresh containers, fresh database, migrations applied      |
| `pnpm e2e:clean`            | Isolated e2e stack: truncate all data, keep it running                        |
| `pnpm e2e:down`             | Isolated e2e stack: stop everything and drop the volume                       |
| `pnpm e2e:run -- <command>` | Isolated e2e stack: reset, run `<command>` against it, always tear down after |

## E2E

Two different things answer "does this actually work," for two different
situations.

### Local walkthrough

Run against the dev stack (`pnpm docker:up`) to confirm a change behaves
correctly end to end:

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
# an immediate sweep, useful when testing a cleanup-related change:
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
```

`/health` is dependency-free (liveness) so an orchestrator will not restart a
healthy process during a brief Redis blip. `/health/ready` checks dependencies
(readiness) so a load balancer can drain an instance that cannot serve traffic.

For the UI itself (guest mode, dashboard, analytics, OAuth buttons), see
[SCREENSHOTS.md](SCREENSHOTS.md) or just open `http://localhost:3000`.
OAuth needs `GITHUB_CLIENT_ID`/`SECRET` or `GOOGLE_CLIENT_ID`/`SECRET` in
`.env` (see `.env.example`) - unset, the buttons still round-trip through
the API and land on a real error page rather than a dead link.

The register, login and guest-shorten forms can be put behind a Cloudflare
Turnstile challenge. Both halves switch on together: `TURNSTILE_SECRET_KEY`
in `.env` for the API, and `TURNSTILE_SITE_KEY` for the web build arg
(inlined as `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, so it needs a rebuild, not
just a restart). Unset - the default for local dev and CI - the widget is
not rendered and the API skips the check, so no Cloudflare account is needed
to run this project.

### Isolated e2e stack

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
inside this stack. The dev stack and this can both be running at once.
