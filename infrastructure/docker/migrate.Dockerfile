# syntax=docker/dockerfile:1
# One-shot migration runner: `prisma migrate deploy` against DATABASE_URL.
# Never runs on app boot (api/worker never migrate themselves) — this is the
# only image that touches the schema, invoked explicitly by the deploy
# script before api/worker/admin-web are (re)started.

FROM node:22-alpine AS base
RUN corepack enable pnpm && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/database/package.json packages/database/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
RUN pnpm install --frozen-lockfile --filter @hh/database

FROM deps AS runtime
COPY packages/database packages/database
WORKDIR /repo/packages/database
ENTRYPOINT ["pnpm", "exec", "prisma"]
CMD ["migrate", "deploy"]
