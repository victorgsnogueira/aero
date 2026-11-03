FROM node:24.11.0-bookworm-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/mcp/package.json apps/mcp/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

FROM deps AS web-build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
COPY assets assets
RUN npm run build -w @aero/web

FROM node:24.11.0-bookworm-slim AS api-deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/mcp/package.json apps/mcp/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --no-audit --no-fund -w @aero/api -w @aero/shared --include-workspace-root=false

FROM node:24.11.0-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=api-deps /repo/node_modules ./node_modules
COPY package.json ./
COPY packages/shared packages/shared
COPY apps/api/package.json apps/api/package.json
COPY apps/api/src apps/api/src
COPY apps/api/drizzle apps/api/drizzle
RUN mkdir -p /data/media && chown -R node:node /data
WORKDIR /repo/apps/api
USER node
EXPOSE 3100

FROM caddy:2.10.2-alpine AS web
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /repo/apps/web/dist /srv
