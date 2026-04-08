#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/bootstrap-inventory-warehouse-master-data.sh [warehouse_code] [warehouse_name] [location_code] [location_name]

Defaults:
  warehouse_code = WH-DRILL-A
  warehouse_name = 演练仓A
  location_code  = LOC-DRILL-A01
  location_name  = 演练库位A01

Environment overrides:
  TENANT_ID=1
  OPERATOR_ID=0
  DB_HOST=127.0.0.1
  DB_PORT=3307
  DB_NAME=smart_factory
  DB_USER=sf_app
  DB_PASS=...
  WAREHOUSE_TYPE=physical
  PLANT_CODE=DRILL
  LOCATION_LEVEL=1
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
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
WAREHOUSE_TYPE="${WAREHOUSE_TYPE:-physical}"
PLANT_CODE="${PLANT_CODE:-DRILL}"
LOCATION_LEVEL="${LOCATION_LEVEL:-1}"

WAREHOUSE_CODE="${1:-WH-DRILL-A}"
WAREHOUSE_NAME="${2:-演练仓A}"
LOCATION_CODE="${3:-LOC-DRILL-A01}"
LOCATION_NAME="${4:-演练库位A01}"

sql_escape() {
  printf "%s" "$1" | sed "s/'/''/g"
}

WH_CODE_ESC="$(sql_escape "$WAREHOUSE_CODE")"
WH_NAME_ESC="$(sql_escape "$WAREHOUSE_NAME")"
LOC_CODE_ESC="$(sql_escape "$LOCATION_CODE")"
LOC_NAME_ESC="$(sql_escape "$LOCATION_NAME")"
WH_TYPE_ESC="$(sql_escape "$WAREHOUSE_TYPE")"
PLANT_CODE_ESC="$(sql_escape "$PLANT_CODE")"

log() {
  printf '[bootstrap-inventory-warehouse-master-data] %s\n' "$*"
}

log "tenant_id=${TENANT_ID} warehouse=${WAREHOUSE_CODE} location=${LOCATION_CODE}"

MYSQL_PWD="$DB_PASS" mysql \
  -h "$DB_HOST" \
  -P "$DB_PORT" \
  -u "$DB_USER" \
  "$DB_NAME" \
  --table <<SQL
SET @tenant_id := ${TENANT_ID};
SET @operator_id := ${OPERATOR_ID};
SET @warehouse_code := '${WH_CODE_ESC}';
SET @warehouse_name := '${WH_NAME_ESC}';
SET @warehouse_type := '${WH_TYPE_ESC}';
SET @plant_code := '${PLANT_CODE_ESC}';
SET @location_code := '${LOC_CODE_ESC}';
SET @location_name := '${LOC_NAME_ESC}';
SET @location_level := ${LOCATION_LEVEL};

INSERT INTO warehouses
  (tenant_id, code, name, type, plant_code, status, created_by, updated_by)
VALUES
  (@tenant_id, @warehouse_code, @warehouse_name, @warehouse_type, @plant_code, 'active', @operator_id, @operator_id)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  type = VALUES(type),
  plant_code = VALUES(plant_code),
  status = 'active',
  updated_by = VALUES(updated_by),
  updated_at = NOW(3);

SELECT id INTO @warehouse_id
FROM warehouses
WHERE tenant_id = @tenant_id
  AND code = (@warehouse_code COLLATE utf8mb4_unicode_ci)
LIMIT 1;

INSERT INTO locations
  (tenant_id, warehouse_id, code, name, level, parent_id, status, created_by, updated_by)
VALUES
  (@tenant_id, @warehouse_id, @location_code, @location_name, @location_level, NULL, 'active', @operator_id, @operator_id)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  level = VALUES(level),
  status = 'active',
  updated_by = VALUES(updated_by),
  updated_at = NOW(3);

SELECT
  w.id AS warehouse_id,
  w.code AS warehouse_code,
  w.name AS warehouse_name,
  w.status AS warehouse_status,
  l.id AS location_id,
  l.code AS location_code,
  l.name AS location_name,
  l.status AS location_status
FROM warehouses w
INNER JOIN locations l
  ON l.tenant_id = w.tenant_id
 AND l.warehouse_id = w.id
WHERE w.tenant_id = @tenant_id
  AND w.code = (@warehouse_code COLLATE utf8mb4_unicode_ci)
  AND l.code = (@location_code COLLATE utf8mb4_unicode_ci)
LIMIT 1;
SQL

log "done"
