#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${NAS_PROJECT_ROOT:-/mnt/pool/docker/biz-reporting}"
COMPOSE_FILE="$ROOT/compose.yml"
ENV_FILE="$ROOT/.env"
BACKUP_DIR="$ROOT/backups/mysql"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
output="$BACKUP_DIR/${DB_DATABASE}-${stamp}.sql.gz"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T mysql \
  mysqldump --single-transaction --routines --events --triggers \
  --default-character-set=utf8mb4 \
  -u"$DB_USERNAME" -p"$DB_PASSWORD" "$DB_DATABASE" | gzip -9 > "$output"

echo "Backup created: $output"
