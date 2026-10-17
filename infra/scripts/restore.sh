#!/usr/bin/env bash
# Restauração de um backup gerado por backup.sh.
#   bash infra/scripts/restore.sh <diretório> --verify   # restaura em bancos temporários, compara e descarta
#   bash infra/scripts/restore.sh <diretório> --apply    # SUBSTITUI os dados atuais (pede confirmação)
set -euo pipefail
cd "$(dirname "$0")/../.."

SRC="${1:?informe o diretório do backup}"
MODE="${2:---verify}"
PROJECT="${COMPOSE_PROJECT_NAME:-aero}"
TAR_IMAGE="caddy:2.10.2-alpine"

test -f "$SRC/aero.sql.gz" && test -f "$SRC/wa_gateway.sql.gz" || { echo "backup incompleto em $SRC"; exit 1; }
if [ -f "$SRC/SHA256SUMS" ]; then (cd "$SRC" && sha256sum -c --quiet SHA256SUMS) && echo "[restore] checksums ok"; fi

mysql_exec() { docker compose exec -T mysql sh -c "exec mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" $*" 2>/dev/null; }
count_rows() { mysql_exec "-N -e \"SELECT table_name, table_rows FROM information_schema.tables WHERE table_schema='$1' ORDER BY table_name\""; }
exact_counts() {
  local db="$1"
  for t in $(mysql_exec "-N -e \"SELECT table_name FROM information_schema.tables WHERE table_schema='$db' ORDER BY table_name\""); do
    echo "$t $(mysql_exec "-N -e \"SELECT COUNT(*) FROM \\\`$db\\\`.\\\`$t\\\`\"")"
  done
}

if [ "$MODE" = "--verify" ]; then
  for DB in aero wa_gateway; do
    TMP="restorecheck_$DB"
    echo "[verify] importando $DB em $TMP"
    mysql_exec "-e 'DROP DATABASE IF EXISTS $TMP; CREATE DATABASE $TMP'"
    gunzip -c "$SRC/$DB.sql.gz" | sed -e "s/^CREATE DATABASE.*\`$DB\`.*;\$//" -e "s/^USE \`$DB\`;\$/USE \`$TMP\`;/" | docker compose exec -T mysql sh -c "exec mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\"" 2>/dev/null
    exact_counts "$TMP" > "/tmp/aero-restore-$DB.txt"
    TABLES=$(wc -l < "/tmp/aero-restore-$DB.txt")
    ROWS=$(awk '{s+=$2} END {print s+0}' "/tmp/aero-restore-$DB.txt")
    echo "[verify] $DB: $TABLES tabelas, $ROWS linhas restauradas"
    test "$TABLES" -gt 0
    mysql_exec "-e 'DROP DATABASE $TMP'"
  done
  for f in "$SRC"/*.tgz; do [ -e "$f" ] && gzip -t "$f" && echo "[verify] arquivo íntegro: $(basename "$f")"; done
  echo "[verify] backup restaurável. Nenhum dado atual foi alterado."
  exit 0
fi

if [ "$MODE" != "--apply" ]; then echo "modo inválido: use --verify ou --apply"; exit 1; fi
read -r -p "Isto SUBSTITUI os dados atuais do aero e a sessão do WhatsApp. Digite 'restaurar' para continuar: " OK
[ "$OK" = "restaurar" ] || { echo "cancelado"; exit 1; }

echo "[restore] parando serviços que escrevem dados"
docker compose stop api worker wa-gateway web
for DB in aero wa_gateway; do
  echo "[restore] importando $DB"
  gunzip -c "$SRC/$DB.sql.gz" | docker compose exec -T mysql sh -c "exec mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\"" 2>/dev/null
done
for VOL in aero_media wa_data wa_uploads wa_media; do
  if [ -f "$SRC/$VOL.tgz" ]; then
    NAME="${PROJECT}_${VOL}"
    echo "[restore] volume $NAME"
    docker volume create "$NAME" >/dev/null
    MSYS_NO_PATHCONV=1 docker run --rm -v "$NAME:/v" -v "$(pwd)/$SRC:/b:ro" "$TAR_IMAGE" sh -c "rm -rf /v/* /v/.[!.]* 2>/dev/null; tar xzf /b/$VOL.tgz -C /v"
  fi
done
echo "[restore] subindo serviços (migrations pendentes são aplicadas pela API)"
docker compose up -d
echo "[restore] concluído. Confira Configurações › Diagnóstico e a conexão do WhatsApp."
