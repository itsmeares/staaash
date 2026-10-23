FROM node:24.22.1-alpine AS base
RUN corepack enable

# ── Install dependencies ──────────────────────────────────────────────────────
FROM base AS install
WORKDIR /app
# The image has no git, so the prepare script cannot install commit hooks.
ENV VP_GIT_HOOKS=0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/config/package.json ./packages/config/
COPY packages/db/package.json ./packages/db/
COPY packages/ui/package.json ./packages/ui/
RUN corepack install && pnpm install --frozen-lockfile

# ── Build ─────────────────────────────────────────────────────────────────────
FROM base AS build
WORKDIR /app
COPY --from=install /app /app
COPY . .
RUN pnpm run db:generate && pnpm build && \
    pnpm --filter web deploy --prod --legacy /deploy/web && \
    pnpm --filter worker deploy --prod --legacy /deploy/worker && \
    cp -r apps/worker/dist /deploy/worker/dist

# ── Runner ────────────────────────────────────────────────────────────────────
FROM node:24.22.1-alpine AS runner
RUN apk add --no-cache openssl ffmpeg
WORKDIR /app
ENV NODE_ENV=production

# Prisma CLI for running migrations on startup — version derived from db package
COPY --from=install /app/packages/db/package.json /tmp/db-pkg.json
RUN npm install -g "prisma@$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/tmp/db-pkg.json','utf8')).devDependencies.prisma)")" --no-fund --no-audit \
    && rm /tmp/db-pkg.json

# Web server and the built app it serves (self-contained via pnpm deploy)
COPY --from=build /deploy/web ./

# Prisma schema + migrations + config
COPY --from=build /app/packages/db/prisma ./prisma
COPY --from=build /app/packages/db/prisma.config.ts ./

# Worker (self-contained via pnpm deploy)
COPY --from=build /deploy/worker /worker

# prisma.config.ts imports prisma from /app/node_modules.
RUN ln -sf "$(npm root -g)/prisma" /app/node_modules/prisma

EXPOSE 2113
CMD ["sh", "-c", "prisma migrate deploy && node dist/server/main.mjs"]
