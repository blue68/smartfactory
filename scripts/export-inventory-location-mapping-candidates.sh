#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3307}"
DB_NAME="${DB_NAME:-smart_factory}"
DB_USER="${DB_USER:-sf_app}"
DB_PASS="${DB_PASS:-}"
TENANT_ID="${TENANT_ID:-1}"
OUTPUT_PATH="${1:-docs/v3/sql/inventory-location-mapping-candidates-$(date '+%Y%m%d-%H%M%S').csv}"

mkdir -p "$(dirname "$OUTPUT_PATH")"

log() {
  printf '[export-inventory-location-mapping-candidates] %s\n' "$*"
}

log "exporting candidates for tenant_id=${TENANT_ID} -> ${OUTPUT_PATH}"

{
  echo 'entity_type,sku_code,source_note,warehouse_code,location_code,status,candidate_count'
  MYSQL_PWD="$DB_PASS" mysql \
    -h "$DB_HOST" \
    -P "$DB_PORT" \
    -u "$DB_USER" \
    "$DB_NAME" \
    --batch \
    --raw \
    --skip-column-names \
    -e "
SELECT CONCAT(
  '\"', REPLACE(COALESCE(mur.entity_type, ''), '\"', '\"\"'), '\",',
  '\"', REPLACE(COALESCE(mur.sku_code, ''), '\"', '\"\"'), '\",',
  '\"', REPLACE(COALESCE(mur.source_note, ''), '\"', '\"\"'), '\",',
  '\"\",',
  '\"\",',
  '\"active\",',
  '\"', COUNT(*), '\"'
) AS csv_line
FROM migration_unmapped_records mur
WHERE mur.tenant_id = ${TENANT_ID}
GROUP BY mur.entity_type, mur.sku_code, mur.source_note
ORDER BY COUNT(*) DESC, mur.entity_type ASC, mur.sku_code ASC, mur.source_note ASC;
"
} > "$OUTPUT_PATH"

log "done"
echo "$OUTPUT_PATH"
