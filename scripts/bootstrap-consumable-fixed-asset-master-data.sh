#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/bootstrap-consumable-fixed-asset-master-data.sh

Environment overrides:
  TENANT_ID=1
  OPERATOR_ID=0
  DB_HOST=127.0.0.1
  DB_PORT=3307
  DB_NAME=smart_factory
  DB_USER=sf_app
  DB_PASS=...
  PLANT_CODE=DEFAULT

  CONSUMABLE_WAREHOUSE_CODE=WH-CONS
  CONSUMABLE_WAREHOUSE_NAME=损耗品仓
  CONSUMABLE_LOCATION_CODE=LOC-CONS-01
  CONSUMABLE_LOCATION_NAME=损耗品默认库位

  ASSET_PENDING_WAREHOUSE_CODE=WH-AST-PEND
  ASSET_PENDING_WAREHOUSE_NAME=资产待验收仓
  ASSET_PENDING_LOCATION_CODE=LOC-AST-PEND-01
  ASSET_PENDING_LOCATION_NAME=资产待验收默认库位

  ASSET_WAREHOUSE_CODE=WH-AST
  ASSET_WAREHOUSE_NAME=资产仓
  ASSET_LOCATION_CODE=LOC-AST-01
  ASSET_LOCATION_NAME=资产默认库位
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
PLANT_CODE="${PLANT_CODE:-DEFAULT}"

CONSUMABLE_WAREHOUSE_CODE="${CONSUMABLE_WAREHOUSE_CODE:-WH-CONS}"
CONSUMABLE_WAREHOUSE_NAME="${CONSUMABLE_WAREHOUSE_NAME:-损耗品仓}"
CONSUMABLE_LOCATION_CODE="${CONSUMABLE_LOCATION_CODE:-LOC-CONS-01}"
CONSUMABLE_LOCATION_NAME="${CONSUMABLE_LOCATION_NAME:-损耗品默认库位}"

ASSET_PENDING_WAREHOUSE_CODE="${ASSET_PENDING_WAREHOUSE_CODE:-WH-AST-PEND}"
ASSET_PENDING_WAREHOUSE_NAME="${ASSET_PENDING_WAREHOUSE_NAME:-资产待验收仓}"
ASSET_PENDING_LOCATION_CODE="${ASSET_PENDING_LOCATION_CODE:-LOC-AST-PEND-01}"
ASSET_PENDING_LOCATION_NAME="${ASSET_PENDING_LOCATION_NAME:-资产待验收默认库位}"

ASSET_WAREHOUSE_CODE="${ASSET_WAREHOUSE_CODE:-WH-AST}"
ASSET_WAREHOUSE_NAME="${ASSET_WAREHOUSE_NAME:-资产仓}"
ASSET_LOCATION_CODE="${ASSET_LOCATION_CODE:-LOC-AST-01}"
ASSET_LOCATION_NAME="${ASSET_LOCATION_NAME:-资产默认库位}"

sql_escape() {
  printf "%s" "$1" | sed "s/'/''/g"
}

log() {
  printf '[bootstrap-consumable-fixed-asset-master-data] %s\n' "$*"
}

PLANT_CODE_ESC="$(sql_escape "$PLANT_CODE")"
CONS_WH_CODE_ESC="$(sql_escape "$CONSUMABLE_WAREHOUSE_CODE")"
CONS_WH_NAME_ESC="$(sql_escape "$CONSUMABLE_WAREHOUSE_NAME")"
CONS_LOC_CODE_ESC="$(sql_escape "$CONSUMABLE_LOCATION_CODE")"
CONS_LOC_NAME_ESC="$(sql_escape "$CONSUMABLE_LOCATION_NAME")"
ASTP_WH_CODE_ESC="$(sql_escape "$ASSET_PENDING_WAREHOUSE_CODE")"
ASTP_WH_NAME_ESC="$(sql_escape "$ASSET_PENDING_WAREHOUSE_NAME")"
ASTP_LOC_CODE_ESC="$(sql_escape "$ASSET_PENDING_LOCATION_CODE")"
ASTP_LOC_NAME_ESC="$(sql_escape "$ASSET_PENDING_LOCATION_NAME")"
AST_WH_CODE_ESC="$(sql_escape "$ASSET_WAREHOUSE_CODE")"
AST_WH_NAME_ESC="$(sql_escape "$ASSET_WAREHOUSE_NAME")"
AST_LOC_CODE_ESC="$(sql_escape "$ASSET_LOCATION_CODE")"
AST_LOC_NAME_ESC="$(sql_escape "$ASSET_LOCATION_NAME")"

log "tenant_id=${TENANT_ID} operator_id=${OPERATOR_ID}"

MYSQL_PWD="$DB_PASS" mysql \
  -h "$DB_HOST" \
  -P "$DB_PORT" \
  -u "$DB_USER" \
  "$DB_NAME" \
  --table <<SQL
SET @tenant_id := ${TENANT_ID};
SET @operator_id := ${OPERATOR_ID};
SET @plant_code := '${PLANT_CODE_ESC}';

SET @cons_wh_code := '${CONS_WH_CODE_ESC}';
SET @cons_wh_name := '${CONS_WH_NAME_ESC}';
SET @cons_loc_code := '${CONS_LOC_CODE_ESC}';
SET @cons_loc_name := '${CONS_LOC_NAME_ESC}';

SET @astp_wh_code := '${ASTP_WH_CODE_ESC}';
SET @astp_wh_name := '${ASTP_WH_NAME_ESC}';
SET @astp_loc_code := '${ASTP_LOC_CODE_ESC}';
SET @astp_loc_name := '${ASTP_LOC_NAME_ESC}';

SET @ast_wh_code := '${AST_WH_CODE_ESC}';
SET @ast_wh_name := '${AST_WH_NAME_ESC}';
SET @ast_loc_code := '${AST_LOC_CODE_ESC}';
SET @ast_loc_name := '${AST_LOC_NAME_ESC}';

INSERT INTO warehouses
  (tenant_id, code, name, type, plant_code, status, created_by, updated_by)
VALUES
  (@tenant_id, @cons_wh_code, @cons_wh_name, 'consumable', @plant_code, 'active', @operator_id, @operator_id),
  (@tenant_id, @astp_wh_code, @astp_wh_name, 'asset_pending', @plant_code, 'active', @operator_id, @operator_id),
  (@tenant_id, @ast_wh_code, @ast_wh_name, 'asset', @plant_code, 'active', @operator_id, @operator_id)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  type = VALUES(type),
  plant_code = VALUES(plant_code),
  status = 'active',
  updated_by = VALUES(updated_by),
  updated_at = NOW(3);

SELECT id INTO @cons_wh_id
FROM warehouses
WHERE tenant_id = @tenant_id
  AND code = (@cons_wh_code COLLATE utf8mb4_unicode_ci)
LIMIT 1;

SELECT id INTO @astp_wh_id
FROM warehouses
WHERE tenant_id = @tenant_id
  AND code = (@astp_wh_code COLLATE utf8mb4_unicode_ci)
LIMIT 1;

SELECT id INTO @ast_wh_id
FROM warehouses
WHERE tenant_id = @tenant_id
  AND code = (@ast_wh_code COLLATE utf8mb4_unicode_ci)
LIMIT 1;

INSERT INTO locations
  (tenant_id, warehouse_id, code, name, level, parent_id, status, created_by, updated_by)
VALUES
  (@tenant_id, @cons_wh_id, @cons_loc_code, @cons_loc_name, 1, NULL, 'active', @operator_id, @operator_id),
  (@tenant_id, @astp_wh_id, @astp_loc_code, @astp_loc_name, 1, NULL, 'active', @operator_id, @operator_id),
  (@tenant_id, @ast_wh_id, @ast_loc_code, @ast_loc_name, 1, NULL, 'active', @operator_id, @operator_id)
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
  w.type AS warehouse_type,
  l.id AS location_id,
  l.code AS location_code,
  l.name AS location_name
FROM warehouses w
INNER JOIN locations l
  ON l.tenant_id = w.tenant_id
 AND l.warehouse_id = w.id
WHERE w.tenant_id = @tenant_id
  AND w.code IN (@cons_wh_code, @astp_wh_code, @ast_wh_code)
  AND (
    (w.code = @cons_wh_code AND l.code = @cons_loc_code)
    OR (w.code = @astp_wh_code AND l.code = @astp_loc_code)
    OR (w.code = @ast_wh_code AND l.code = @ast_loc_code)
  )
ORDER BY FIELD(w.code, @cons_wh_code, @astp_wh_code, @ast_wh_code);
SQL

log "done"
