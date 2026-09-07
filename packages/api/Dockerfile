# syntax=docker/dockerfile:1

# Workspace-aware multi-stage build. The dependency layer is keyed only on the
# manifests, so editing source does not re-run `pnpm install`.
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/api packages/api
# `prisma generate` runs as part of the api build and never opens a connection,
# but prisma.config.ts requires the variable to exist. A placeholder is enough.
ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder
# shared must be built first: api imports its emitted .d.ts and .js.
RUN pnpm --filter @linkpulse/shared build && pnpm --filter @linkpulse/api build

FROM base AS runtime
ENV NODE_ENV=production
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
# Reinstall without devDependencies so the runtime image ships no toolchain.
RUN pnpm install --frozen-lockfile --prod && pnpm store prune
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/packages/api/dist packages/api/dist

USER node
EXPOSE 4000
CMD ["node", "packages/api/dist/index.js"]
