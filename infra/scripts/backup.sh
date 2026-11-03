#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

PROJECT="${COMPOSE_PROJECT_NAME:-aero}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${1:-backups/$STAMP}"
TAR_IMAGE="caddy:2.10.2-alpine"
mkdir -p "$DEST"
chmod 700 "$DEST" || true

echo "[backup] destino: $DEST"
for DB in aero wa_gateway; do
  echo "[backup] dump $DB"
  docker compose exec -T mysql sh -c "exec mysqldump -uroot -p\"\$MYSQL_ROOT_PASSWORD\" --single-transaction --routines --triggers --hex-blob --set-gtid-purged=OFF --databases $DB" 2>/dev/null | gzip -9 > "$DEST/$DB.sql.gz"
  test -s "$DEST/$DB.sql.gz"
done

for VOL in aero_media wa_data wa_uploads wa_media; do
  NAME="${PROJECT}_${VOL}"
  if docker volume inspect "$NAME" >/dev/null 2>&1; then
    echo "[backup] volume $NAME"
    MSYS_NO_PATHCONV=1 docker run --rm -v "$NAME:/v:ro" -v "$(pwd)/$DEST:/b" "$TAR_IMAGE" tar czf "/b/$VOL.tgz" -C /v .
  fi
done

{
  echo "created_at=$STAMP"
  echo "git_commit=$(git rev-parse --short HEAD 2>/dev/null || echo desconhecido)"
  echo "migrations=$(ls apps/api/drizzle/*.sql | xargs -n1 basename | tr '\n' ' ')"
  echo "wa_akg_image=$(docker compose config --images 2>/dev/null | grep wa-gateway | head -1)"
} > "$DEST/MANIFEST"
(cd "$DEST" && sha256sum ./*.gz ./*.tgz MANIFEST 2>/dev/null > SHA256SUMS || true)
echo "[backup] concluído: $(du -sh "$DEST" | cut -f1)"
