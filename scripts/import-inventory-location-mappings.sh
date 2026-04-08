#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/import-inventory-location-mappings.sh <mapping_csv_path> [--apply]

Notes:
  - CSV header must be:
    entity_type,sku_code,source_note,warehouse_code,location_code,status,candidate_count
  - Default mode is validation-only; pass --apply to upsert mappings.
EOF
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

CSV_PATH="$1"
MODE="${2:---validate}"
if [[ "$MODE" != "--validate" && "$MODE" != "--apply" ]]; then
  usage
  exit 1
fi

if [[ ! -f "$CSV_PATH" ]]; then
  echo "mapping csv not found: $CSV_PATH" >&2
  exit 1
fi

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
OPERATOR_ID="${OPERATOR_ID:-0}"
OUTPUT_DIR="${OUTPUT_DIR:-docs/v3/release-logs/inventory-warehouse/mapping-import-$(date '+%Y%m%d-%H%M%S')}"

mkdir -p "$OUTPUT_DIR"
CSV_ABS="$(cd "$(dirname "$CSV_PATH")" && pwd)/$(basename "$CSV_PATH")"
MYSQL_CMD=(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME")

log() {
  printf '[import-inventory-location-mappings] %s\n' "$*"
}

SEED_SQL_FILE="$(mktemp)"
trap 'rm -f "$SEED_SQL_FILE"' EXIT

python3 - "$CSV_ABS" > "$SEED_SQL_FILE" <<'PY'
import csv
import sys

path = sys.argv[1]
expected = [
    "entity_type",
    "sku_code",
    "source_note",
    "warehouse_code",
    "location_code",
    "status",
    "candidate_count",
]

def as_sql(value: str | None) -> str:
    if value is None:
        return "NULL"
    v = value.strip()
    if v == "":
        return "NULL"
    return "'" + v.replace("\\", "\\\\").replace("'", "''") + "'"

with open(path, newline="", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    if reader.fieldnames is None:
        raise SystemExit("CSV header missing")
    missing = [c for c in expected if c not in reader.fieldnames]
    if missing:
        raise SystemExit(
            "CSV header invalid, missing columns: " + ",".join(missing)
        )

    rows = []
    for row in reader:
        rows.append(
            "(" + ",".join(as_sql(row.get(c)) for c in expected) + ")"
        )

if not rows:
    print("SELECT 'EMPTY_CSV' AS message;")
else:
    print(
        "INSERT INTO tmp_inventory_location_mapping_import "
        "(entity_type, sku_code, source_note, warehouse_code, location_code, status, candidate_count) VALUES"
    )
    print(",\n".join(rows) + ";")
PY

VALIDATION_OUT="$OUTPUT_DIR/validation.out.txt"
APPLY_OUT="$OUTPUT_DIR/apply.out.txt"

log "csv=$CSV_ABS"
log "mode=$MODE tenant_id=$TENANT_ID operator_id=$OPERATOR_ID"

{
  cat <<SQL
SET @tenant_id := ${TENANT_ID};
SET @operator_id := ${OPERATOR_ID};

DROP TEMPORARY TABLE IF EXISTS tmp_inventory_location_mapping_import;
CREATE TEMPORARY TABLE tmp_inventory_location_mapping_import (
  entity_type VARCHAR(64) NULL,
  sku_code VARCHAR(64) NULL,
  source_note VARCHAR(255) NULL,
  warehouse_code VARCHAR(64) NULL,
  location_code VARCHAR(64) NULL,
  status VARCHAR(32) NULL,
  candidate_count VARCHAR(32) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SQL
  cat "$SEED_SQL_FILE"
  cat <<'SQL'
UPDATE tmp_inventory_location_mapping_import
SET status = 'active'
WHERE status IS NULL OR status = '';

SELECT 'total_rows' AS metric, COUNT(*) AS value
FROM tmp_inventory_location_mapping_import;

SELECT 'missing_required_rows' AS metric, COUNT(*) AS value
FROM tmp_inventory_location_mapping_import
WHERE sku_code IS NULL
   OR source_note IS NULL
   OR warehouse_code IS NULL
   OR location_code IS NULL;

SELECT 'invalid_status_rows' AS metric, COUNT(*) AS value
FROM tmp_inventory_location_mapping_import
WHERE status NOT IN ('active', 'inactive');

SELECT 'missing_warehouse_master_rows' AS metric, COUNT(*) AS value
FROM tmp_inventory_location_mapping_import t
LEFT JOIN warehouses w
  ON w.tenant_id = @tenant_id
 AND w.code = t.warehouse_code
WHERE t.warehouse_code IS NOT NULL
  AND w.id IS NULL;

SELECT 'missing_location_master_rows' AS metric, COUNT(*) AS value
FROM tmp_inventory_location_mapping_import t
LEFT JOIN warehouses w
  ON w.tenant_id = @tenant_id
 AND w.code = t.warehouse_code
LEFT JOIN locations l
  ON l.tenant_id = @tenant_id
 AND l.warehouse_id = w.id
 AND l.code = t.location_code
WHERE t.warehouse_code IS NOT NULL
  AND t.location_code IS NOT NULL
  AND l.id IS NULL;

SELECT 'active_master_compatible_rows' AS metric, COUNT(*) AS value
FROM tmp_inventory_location_mapping_import t
INNER JOIN warehouses w
  ON w.tenant_id = @tenant_id
 AND w.code = t.warehouse_code
 AND w.status = 'active'
INNER JOIN locations l
  ON l.tenant_id = @tenant_id
 AND l.warehouse_id = w.id
 AND l.code = t.location_code
 AND l.status = 'active'
WHERE t.sku_code IS NOT NULL
  AND t.source_note IS NOT NULL
  AND t.status IN ('active', 'inactive');

SELECT
  t.sku_code,
  t.source_note,
  t.warehouse_code,
  t.location_code,
  t.status,
  CASE
    WHEN t.sku_code IS NULL OR t.source_note IS NULL OR t.warehouse_code IS NULL OR t.location_code IS NULL
      THEN 'MISSING_REQUIRED'
    WHEN t.status NOT IN ('active', 'inactive')
      THEN 'INVALID_STATUS'
    WHEN w.id IS NULL
      THEN 'WAREHOUSE_NOT_FOUND'
    WHEN l.id IS NULL
      THEN 'LOCATION_NOT_FOUND'
    WHEN w.status <> 'active' OR l.status <> 'active'
      THEN 'INACTIVE_MASTER'
    ELSE 'OK'
  END AS validation_result
FROM tmp_inventory_location_mapping_import t
LEFT JOIN warehouses w
  ON w.tenant_id = @tenant_id
 AND w.code = t.warehouse_code
LEFT JOIN locations l
  ON l.tenant_id = @tenant_id
 AND l.warehouse_id = w.id
 AND l.code = t.location_code
ORDER BY validation_result DESC, t.sku_code, t.source_note
LIMIT 300;
SQL
} | MYSQL_PWD="$DB_PASS" "${MYSQL_CMD[@]}" --table > "$VALIDATION_OUT"

if [[ "$MODE" == "--apply" ]]; then
  log "applying mappings"
  {
    cat <<SQL
SET @tenant_id := ${TENANT_ID};
SET @operator_id := ${OPERATOR_ID};

DROP TEMPORARY TABLE IF EXISTS tmp_inventory_location_mapping_import;
CREATE TEMPORARY TABLE tmp_inventory_location_mapping_import (
  entity_type VARCHAR(64) NULL,
  sku_code VARCHAR(64) NULL,
  source_note VARCHAR(255) NULL,
  warehouse_code VARCHAR(64) NULL,
  location_code VARCHAR(64) NULL,
  status VARCHAR(32) NULL,
  candidate_count VARCHAR(32) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SQL
    cat "$SEED_SQL_FILE"
    cat <<'SQL'
UPDATE tmp_inventory_location_mapping_import
SET status = 'active'
WHERE status IS NULL OR status = '';

INSERT INTO inventory_location_mappings
  (tenant_id, sku_code, source_note, warehouse_code, location_code, status, created_by, updated_by)
SELECT
  @tenant_id,
  t.sku_code,
  t.source_note,
  t.warehouse_code,
  t.location_code,
  t.status,
  @operator_id,
  @operator_id
FROM tmp_inventory_location_mapping_import t
INNER JOIN warehouses w
  ON w.tenant_id = @tenant_id
 AND w.code = t.warehouse_code
 AND w.status = 'active'
INNER JOIN locations l
  ON l.tenant_id = @tenant_id
 AND l.warehouse_id = w.id
 AND l.code = t.location_code
 AND l.status = 'active'
WHERE t.sku_code IS NOT NULL
  AND t.source_note IS NOT NULL
  AND t.status IN ('active', 'inactive')
ON DUPLICATE KEY UPDATE
  warehouse_code = VALUES(warehouse_code),
  location_code = VALUES(location_code),
  status = VALUES(status),
  updated_by = VALUES(updated_by),
  updated_at = NOW(3);

SELECT ROW_COUNT() AS upsert_row_count;
SELECT COUNT(*) AS total_mapping_rows
FROM inventory_location_mappings
WHERE tenant_id = @tenant_id;
SQL
  } | MYSQL_PWD="$DB_PASS" "${MYSQL_CMD[@]}" --table > "$APPLY_OUT"
fi

log "validation_out=$VALIDATION_OUT"
if [[ "$MODE" == "--apply" ]]; then
  log "apply_out=$APPLY_OUT"
fi
echo "$OUTPUT_DIR"
