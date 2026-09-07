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
packages/web      Next.js dashboard                        (not yet scaffolded)
benchmarks/k6     load tests                               (not yet scaffolded)
```

## Getting started

Requires Node >= 22, pnpm >= 10 and Docker.

```bash
pnpm install
cp .env.example .env

# Infra only; run the API on the host for a fast reload loop.
docker compose up -d postgres redis
pnpm dev
```

Or bring up the whole stack, API included:

```bash
docker compose up -d
```

### Verify

```bash
curl -s localhost:4000/health          # {"status":"ok","uptime":3}
curl -s localhost:4000/health/ready    # {"status":"ready","checks":{"redis":true}}
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
- [ ] Prisma schema and migrations
- [ ] Shorten + redirect with Redis read-through cache
- [ ] Auth (email/password JWT)
- [ ] Async click tracking and analytics API
- [ ] Sliding-window rate limiter
- [ ] Next.js dashboard
- [ ] k6 benchmarks
- [ ] CI/CD and deployment
