# syntax=docker/dockerfile:1

# Workspace-aware multi-stage build, mirroring packages/api/Dockerfile. The
# runtime stage is simpler here: Next's `output: 'standalone'` already traces
# a pruned node_modules into .next/standalone, so there is no second
# `pnpm install --prod` to run.
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/web packages/web
# NEXT_PUBLIC_* vars are inlined into the browser bundle at build time, not
# read at container start - a build arg is the only way to configure this.
ARG NEXT_PUBLIC_API_URL=http://localhost:4001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# shared must be built first: web imports its emitted .d.ts and .js.
RUN pnpm --filter @linkpulse/shared build && pnpm --filter @linkpulse/web build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/packages/web/.next/standalone ./
COPY --from=build /repo/packages/web/.next/static packages/web/.next/static

USER node
EXPOSE 3000
ENV PORT=3000
# The standalone server binds to `process.env.HOSTNAME || '0.0.0.0'`, and
# Docker sets HOSTNAME to the container id by default, which would leave the
# server unreachable on the loopback address the healthcheck below uses.
ENV HOSTNAME=0.0.0.0
CMD ["node", "packages/web/server.js"]
