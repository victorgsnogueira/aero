#!/bin/sh
# Inicialização do WA-AKG no aero.
# 1) Sincroniza o schema Prisma do gateway no banco PRÓPRIO dele (wa_gateway).
#    O projeto não publica migrations versionadas, apenas `prisma db push`.
#    Sem --accept-data-loss: alterações destrutivas fazem a inicialização falhar
#    em vez de apagar dados silenciosamente.
# 2) Provisiona o usuário técnico e a chave de API usada pelo backend do aero.
# 3) Inicia o servidor do gateway.
set -eu

: "${DATABASE_URL:?DATABASE_URL obrigatório}"
: "${AUTH_SECRET:?AUTH_SECRET obrigatório}"
: "${AERO_API_KEY:?AERO_API_KEY obrigatório}"
: "${ADMIN_EMAIL:?ADMIN_EMAIL obrigatório}"
: "${ADMIN_PASSWORD:?ADMIN_PASSWORD obrigatório}"

echo "[aero] prisma db push (banco do gateway)"
npx prisma db push --skip-generate

echo "[aero] provisionando usuário técnico"
node /app/scripts/aero-provision.cjs

echo "[aero] iniciando WA-AKG"
exec node node_modules/tsx/dist/cli.mjs src/server/index.ts
