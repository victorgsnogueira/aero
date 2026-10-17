# WA-AKG (gateway WhatsApp baseado em Baileys) construído a partir de um commit fixado.
# Diferenças em relação ao Dockerfile original do projeto:
# - Node 24 LTS (bookworm-slim) em vez de node:26-alpine;
# - sem credenciais/admin padrão: o provisionamento usa variáveis obrigatórias;
# - inicialização própria (entrypoint.sh) que provisiona a chave de API do aero;
# - Swagger público desabilitado e nenhuma porta publicada pelo compose base;
# - correção do mapa de status de mensagens (patch-status-map.cjs).

ARG WA_AKG_REPO=https://github.com/mrifqidaffaaditya/WA-AKG.git
# v1.6.3 (estável). A 1.7.0 ainda é beta.
ARG WA_AKG_COMMIT=627a69fc0cc24b2a1e61f67c8c820ee0bc460f0a

FROM node:24.11.0-bookworm-slim AS source
ARG WA_AKG_REPO
ARG WA_AKG_COMMIT
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git init -q . && git remote add origin "$WA_AKG_REPO" \
  && git fetch -q --depth 1 origin "$WA_AKG_COMMIT" \
  && git checkout -q FETCH_HEAD \
  && test "$(git rev-parse HEAD)" = "$WA_AKG_COMMIT" \
  && rm -rf .git

FROM node:24.11.0-bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=source /src/package*.json ./
COPY --from=source /src/patches ./patches/
COPY --from=source /src/prisma ./prisma/
RUN npm ci --legacy-peer-deps --foreground-scripts && npm cache clean --force
COPY --from=source /src/ ./
# Correção do mapa de status de mensagens (ver patch-status-map.cjs)
COPY patch-status-map.cjs /tmp/patch-status-map.cjs
RUN node /tmp/patch-status-map.cjs src/modules/whatsapp/store/index.ts
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build
# Sem `npm prune`: no npm atual ele falha com o opcional @tailwindcss/oxide-wasm32-wasi.
# Mantemos as dependências completas (inclui tsx e prisma CLI necessários em runtime).
RUN test -x node_modules/.bin/tsx && test -x node_modules/.bin/prisma

FROM node:24.11.0-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/public ./public
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/tsconfig.server.json ./
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/scripts ./scripts
COPY provision.cjs /app/scripts/aero-provision.cjs
COPY entrypoint.sh /aero/entrypoint.sh
RUN chmod +x /aero/entrypoint.sh && mkdir -p /app/data /app/uploads /app/public/media && chown -R node:node /app /aero
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=5 \
  CMD curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/docs | grep -qE '^(200|401|302|307)$' || exit 1
ENTRYPOINT ["/aero/entrypoint.sh"]
