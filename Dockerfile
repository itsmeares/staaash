FROM node:22-alpine AS base
RUN npm install -g pnpm@10.33.0 --no-fund --no-audit

# ── Install dependencies ──────────────────────────────────────────────────────
FROM base AS install
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/config/package.json ./packages/config/
COPY packages/db/package.json ./packages/db/
RUN pnpm install --frozen-lockfile

# ── Build ─────────────────────────────────────────────────────────────────────
FROM base AS build
WORKDIR /app
COPY --from=install /app /app
COPY . .
RUN pnpm run db:generate && pnpm build && pnpm --filter worker deploy --prod --legacy /deploy/worker

# ── Runner ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production

# Prisma CLI for running migrations on startup — version derived from db package
COPY --from=install /app/packages/db/package.json /tmp/db-pkg.json
RUN npm install -g "prisma@$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/tmp/db-pkg.json','utf8')).devDependencies.prisma)")" --no-fund --no-audit \
    && rm /tmp/db-pkg.json

# Next.js standalone server
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static

# Prisma schema + migrations (prisma migrate deploy reads ./prisma/)
COPY --from=build /app/packages/db/prisma ./prisma

# Worker (self-contained via pnpm deploy)
COPY --from=build /deploy/worker /worker

EXPOSE 2113
CMD ["sh", "-c", "prisma migrate deploy && node server.js"]
