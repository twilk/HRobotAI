# syntax=docker/dockerfile:1
# Multi-stage image for @hrobot/tenant-runtime in the pnpm + turbo monorepo.
# Build context MUST be the repo root:
#   docker compose --profile full build tenant-runtime   (compose sets context: .)
#   docker build -f apps/tenant-runtime/Dockerfile -t hrobot-tenant-runtime .
#
# Node 22 is required: the app is CommonJS but imports @hrobot/db which is
# ESM ("type":"module"), so the runtime relies on Node 22's require(esm) support.

ARG NODE_VERSION=22-bookworm-slim

########## base ##########
FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

########## builder ##########
FROM base AS builder
# Native-module toolchain (bcrypt -> node-gyp) + openssl for Prisma engines.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copy manifests first so the install layer caches on lockfile changes only.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/control-plane/package.json  apps/control-plane/
COPY apps/tenant-runtime/package.json apps/tenant-runtime/
COPY packages/config/package.json     packages/config/
COPY packages/db/package.json         packages/db/
COPY packages/shared/package.json     packages/shared/
# The root postinstall runs `turbo run db:generate`, which needs the Prisma schemas.
COPY packages/db/prisma packages/db/prisma
RUN pnpm install --frozen-lockfile

# Source, then build: turbo runs db:generate -> ^build -> `nest build`.
COPY . .
RUN pnpm run build
# bcrypt native sanity check — run from the app dir so pnpm resolves the app's own bcrypt.
RUN cd apps/tenant-runtime \
 && node -e "const b=require('bcrypt'); if(!b.compareSync('x', b.hashSync('x',4))) process.exit(1); console.log('bcrypt native ok')"

########## runner ##########
FROM base AS runner
ARG APP_DIR=apps/tenant-runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=builder /app ./
WORKDIR /app/${APP_DIR}
EXPOSE 3000
# main.ts reads PORT (default 3000) and boots HTTP + the RabbitMQ microservice.
CMD ["node", "dist/main"]
