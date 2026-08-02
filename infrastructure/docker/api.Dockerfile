# syntax=docker/dockerfile:1
# Multi-stage build for apps/api. Built from the monorepo root so pnpm's
# workspace symlinks resolve; the runtime stage carries only compiled JS
# (packages/* dist/, apps/api dist/) and production node_modules — no
# TypeScript source, no dev tooling.

FROM node:22-alpine AS base
RUN corepack enable pnpm && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo

# --- deps: install with full lockfile, all workspaces (needed for build) ---
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/admin-web/package.json apps/admin-web/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY packages/notifications/package.json packages/notifications/package.json
COPY packages/pipeline/package.json packages/pipeline/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/testing/package.json packages/testing/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
RUN pnpm install --frozen-lockfile

# --- build: compile every workspace package + apps/api ---
FROM deps AS build
COPY . .
RUN pnpm --filter @hh/database exec prisma generate
RUN pnpm --filter @hh/api... build

# --- prod deps: install again, production-only, for a lean runtime image ---
FROM base AS prod-deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY packages/notifications/package.json packages/notifications/package.json
COPY packages/pipeline/package.json packages/pipeline/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile --prod --filter @hh/api...
# @prisma/client's generated output is a physical file tree tied to the
# exact node_modules instance it was generated into. The `build` stage
# above generates it, but this stage does a SEPARATE --prod install with
# its own node_modules — that copy of @prisma/client was never generated,
# so it throws "did not initialize" at runtime unless generated again here.
# `prisma` (the CLI) is a devDependency and isn't present in this --prod
# install, so fetch it ephemerally via dlx — it still generates into
# whatever @prisma/client is resolvable from this directory, i.e. this
# stage's own node_modules. Keep the pinned version in sync with the
# "prisma" devDependency range in packages/database/package.json.
COPY packages/database/prisma packages/database/prisma
RUN cd packages/database && pnpm dlx prisma@6.19.3 generate

# --- runtime ---
FROM node:22-alpine AS runtime
RUN apk add --no-cache dumb-init && addgroup -S app && adduser -S app -G app
WORKDIR /repo
ENV NODE_ENV=production
# pnpm gives every workspace package its OWN node_modules (symlinks into
# the root .pnpm store) for its declared deps — nothing is hoisted to the
# repo-root node_modules. Copying only the root + apps/api node_modules
# left every shared package unable to resolve its own dependencies at
# runtime (e.g. packages/config -> zod), so each package's node_modules
# must be copied individually. packages/notifications has no runtime deps
# of its own, so it has no node_modules to copy.
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/packages/domain/dist ./packages/domain/dist
COPY --from=build /repo/packages/domain/package.json ./packages/domain/package.json
COPY --from=prod-deps /repo/packages/domain/node_modules ./packages/domain/node_modules
COPY --from=build /repo/packages/database/dist ./packages/database/dist
COPY --from=build /repo/packages/database/package.json ./packages/database/package.json
COPY --from=build /repo/packages/database/prisma ./packages/database/prisma
COPY --from=prod-deps /repo/packages/database/node_modules ./packages/database/node_modules
COPY --from=build /repo/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /repo/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=prod-deps /repo/packages/contracts/node_modules ./packages/contracts/node_modules
# @nestjs/common is a peerDependency of packages/contracts (zod-validation.pipe
# uses UnprocessableEntityException) — same peer-resolution gap as packages/auth.
COPY --from=prod-deps /repo/apps/api/node_modules/@nestjs ./packages/contracts/node_modules/@nestjs
COPY --from=build /repo/packages/auth/dist ./packages/auth/dist
COPY --from=build /repo/packages/auth/package.json ./packages/auth/package.json
COPY --from=prod-deps /repo/packages/auth/node_modules ./packages/auth/node_modules
# @nestjs/common + @nestjs/core are peerDependencies of packages/auth — the
# filtered/prod pnpm install doesn't symlink peer deps into a workspace
# package's own node_modules, so copy them from apps/api's (which has them
# as real dependencies) or Node's directory-walk resolution fails.
COPY --from=prod-deps /repo/apps/api/node_modules/@nestjs ./packages/auth/node_modules/@nestjs
COPY --from=build /repo/packages/storage/dist ./packages/storage/dist
COPY --from=build /repo/packages/storage/package.json ./packages/storage/package.json
COPY --from=prod-deps /repo/packages/storage/node_modules ./packages/storage/node_modules
COPY --from=build /repo/packages/notifications/dist ./packages/notifications/dist
COPY --from=build /repo/packages/notifications/package.json ./packages/notifications/package.json
COPY --from=build /repo/packages/pipeline/dist ./packages/pipeline/dist
COPY --from=build /repo/packages/pipeline/package.json ./packages/pipeline/package.json
COPY --from=prod-deps /repo/packages/pipeline/node_modules ./packages/pipeline/node_modules
COPY --from=build /repo/packages/config/dist ./packages/config/dist
COPY --from=build /repo/packages/config/package.json ./packages/config/package.json
COPY --from=prod-deps /repo/packages/config/node_modules ./packages/config/node_modules
USER app
EXPOSE 3100
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/api/dist/main.js"]
