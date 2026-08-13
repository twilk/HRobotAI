# apps/web/Dockerfile — kontekst build = root monorepo (compose: context: .).
# Next.js standalone: build w Linuksie (symlinki pnpm działają), obraz runtime = server.js + minimalne deps.
FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN corepack enable

########## builder ##########
FROM base AS builder
ENV NEXT_OUTPUT_STANDALONE=1
# manifesty + lockfile (cache warstwy install)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/web/package.json            apps/web/
COPY apps/control-plane/package.json  apps/control-plane/
COPY apps/tenant-runtime/package.json apps/tenant-runtime/
COPY packages/config/package.json     packages/config/
COPY packages/db/package.json         packages/db/
COPY packages/shared/package.json     packages/shared/
# prisma schema potrzebny w postinstall (@hrobot/db:db:generate)
COPY packages/db/prisma packages/db/prisma
RUN pnpm install --frozen-lockfile
# źródło + build standalone
COPY . .
RUN pnpm -F @hrobot/web build

########## runtime ##########
FROM base AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
# standalone mirroruje strukturę monorepo (outputFileTracingRoot=root):
#   .next/standalone/  → node_modules + apps/web/server.js
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static     ./apps/web/.next/static
# (apps/web nie ma katalogu public/ — brak COPY; dodać, gdy pojawią się statyczne assety)
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
