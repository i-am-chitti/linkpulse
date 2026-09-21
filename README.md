# LinkPulse

[![CI](https://github.com/i-am-chitti/linkpulse/actions/workflows/ci.yml/badge.svg)](https://github.com/i-am-chitti/linkpulse/actions/workflows/ci.yml)

**Live: [linkpulse.thedeepak.dev](https://linkpulse.thedeepak.dev)** · [Screenshots →](SCREENSHOTS.md)

A production-shaped URL shortener with real-time click analytics, built to
demonstrate backend engineering: a Redis read-through cache on the redirect
hot path, an async click pipeline that never blocks a response, a
Lua-scripted sliding-window rate limiter, rotating refresh tokens with
reuse detection, and load-tested, root-caused performance numbers rather than
estimated ones.

The frontend (Next.js) exists to make the backend demonstrable end to end -
it is deliberately not the focus of this project.

**[Architecture and design decisions →](ARCHITECTURE.md)** ·
**[Development guide →](DEVELOPMENT.md)** (setup, scripts, E2E)

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
- **Analytics** - clicks over time, unique visitors (IP-deduplicated over
  the selected window), top countries, device and browser breakdown, top referrers, all
  served from real-time async-ingested click data.
- **Abuse protection** - a Redis Lua sliding-window rate limiter with
  separate anonymous/authenticated tiers per route, and a configurable
  malicious-URL blocklist checked on every create and edit.
- **Background maintenance** - expired guest links and stale refresh tokens
  purged automatically by the click worker.
- **CI/CD** - lint, typecheck, build and test on every push/PR; Docker
  images published to GHCR on merge to `main`; deploy via a manually
  triggered GitHub Actions workflow.
- **Load-tested** - k6 scenarios for the redirect hot path, link creation,
  analytics reads, and a mixed workload, with real numbers and a diagnosed
  bottleneck, not just a pass/fail. See [Benchmarks](#benchmarks).

## Stack

| Layer                      | Choice                                      |
| -------------------------- | ------------------------------------------- |
| API                        | Node 24, Express 5, TypeScript              |
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

Two processes run from `api`: `src/index.ts` serves HTTP, `src/worker.ts`
drains the click queue - see [ARCHITECTURE.md](ARCHITECTURE.md#async-click-processing-a-separate-worker-process)
for why they're split.

## Quick start

```bash
pnpm install
cp .env.example .env        # generate JWT_SECRET: openssl rand -hex 32
pnpm docker:up               # full stack, including the API
```

Full setup (fast host reload loop, test DB, all the curl-based verification
commands) and the day-to-day scripts reference: **[DEVELOPMENT.md](DEVELOPMENT.md)**.

## Deployment

Live on a single AWS EC2 instance behind Caddy (automatic HTTPS), with an
external Neon Postgres so the database never has to move if the compute
host does. Deployed by a manually-triggered GitHub Actions workflow
(`.github/workflows/deploy.yml`) that reads secrets from GitHub, not a
local file. Full reasoning: [ARCHITECTURE.md](ARCHITECTURE.md).

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
notes. More on this in [ARCHITECTURE.md](ARCHITECTURE.md#performance).

## Limitations

Honest gaps, not oversights left unmentioned:

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

## License

[MIT](LICENSE)
