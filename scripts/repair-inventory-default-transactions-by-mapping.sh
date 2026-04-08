#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/repair-inventory-default-transactions-by-mapping.sh [--apply] [--repair-tag <tag>]

Notes:
  - Default mode is dry-run (no updates).
  - With --apply, updates default-bound inventory_transactions that can be resolved by active mappings.

Environment overrides:
  TENANT_ID=1
  OPERATOR_ID=0
  DB_HOST=127.0.0.1
  DB_PORT=3307
  DB_NAME=smart_factory
  DB_USER=sf_app
  DB_PASS=...
USAGE
}

APPLY_MODE=0
REPAIR_TAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      APPLY_MODE=1
      shift
      ;;
    --repair-tag)
      if [[ $# -lt 2 ]]; then
        usage
        exit 1
      fi
      REPAIR_TAG="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 1
      ;;
  esac
done

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
REPAIR_TAG="${REPAIR_TAG:-RESIDUAL_$(date '+%Y%m%d%H%M%S')}"

log() {
  printf '[repair-inventory-default-transactions-by-mapping] %s\n' "$*"
}

log "tenant_id=${TENANT_ID} apply_mode=${APPLY_MODE} repair_tag=${REPAIR_TAG}"

MYSQL_CMD=(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" --table)

run_preview_sql() {
  MYSQL_PWD="$DB_PASS" "${MYSQL_CMD[@]}" <<SQL
SET @tenant_id := ${TENANT_ID};

SELECT COUNT(*) AS default_tx_count_total_before
FROM inventory_transactions it
INNER JOIN warehouses w
  ON w.id = it.warehouse_id
 AND w.tenant_id = it.tenant_id
INNER JOIN locations l
  ON l.id = it.location_id
 AND l.tenant_id = it.tenant_id
WHERE it.tenant_id = @tenant_id
  AND w.code = 'DEFAULT'
  AND l.code = 'DEFAULT-UNKNOWN';

DROP TEMPORARY TABLE IF EXISTS tmp_default_tx_residual_candidates;
CREATE TEMPORARY TABLE tmp_default_tx_residual_candidates AS
SELECT
  it.id AS tx_id,
  it.sku_id,
  s.sku_code,
  COALESCE(NULLIF(it.reference_no, ''), NULLIF(it.notes, ''), '__EMPTY__') AS source_note,
  tw.id AS target_warehouse_id,
  tl.id AS target_location_id,
  tw.code AS target_warehouse_code,
  tl.code AS target_location_code
FROM inventory_transactions it
INNER JOIN warehouses cw
  ON cw.id = it.warehouse_id
 AND cw.tenant_id = it.tenant_id
INNER JOIN locations cl
  ON cl.id = it.location_id
 AND cl.tenant_id = it.tenant_id
LEFT JOIN skus s
  ON s.id = it.sku_id
 AND s.tenant_id = it.tenant_id
INNER JOIN inventory_location_mappings m
  ON m.tenant_id = it.tenant_id
 AND m.status = 'active'
 AND m.sku_code = (COALESCE(s.sku_code, '__UNKNOWN__') COLLATE utf8mb4_unicode_ci)
 AND m.source_note = (COALESCE(NULLIF(it.reference_no, ''), NULLIF(it.notes, ''), '__EMPTY__') COLLATE utf8mb4_unicode_ci)
INNER JOIN warehouses tw
  ON tw.tenant_id = it.tenant_id
 AND tw.code = m.warehouse_code
 AND tw.status = 'active'
INNER JOIN locations tl
  ON tl.tenant_id = it.tenant_id
 AND tl.warehouse_id = tw.id
 AND tl.code = m.location_code
 AND tl.status = 'active'
WHERE it.tenant_id = @tenant_id
  AND cw.code = 'DEFAULT'
  AND cl.code = 'DEFAULT-UNKNOWN';

SELECT
  COUNT(*) AS candidate_tx_rows,
  COUNT(DISTINCT sku_id) AS candidate_sku_rows
FROM tmp_default_tx_residual_candidates;

SELECT
  tx_id,
  sku_id,
  sku_code,
  source_note,
  target_warehouse_code,
  target_location_code
FROM tmp_default_tx_residual_candidates
ORDER BY tx_id ASC
LIMIT 100;
SQL
}

run_apply_sql() {
  MYSQL_PWD="$DB_PASS" "${MYSQL_CMD[@]}" <<SQL
SET @tenant_id := ${TENANT_ID};
SET @operator_id := ${OPERATOR_ID};
SET @repair_tag := '${REPAIR_TAG}';

DROP TEMPORARY TABLE IF EXISTS tmp_default_tx_residual_candidates;
CREATE TEMPORARY TABLE tmp_default_tx_residual_candidates AS
SELECT
  it.id AS tx_id,
  tw.id AS target_warehouse_id,
  tl.id AS target_location_id
FROM inventory_transactions it
INNER JOIN warehouses cw
  ON cw.id = it.warehouse_id
 AND cw.tenant_id = it.tenant_id
INNER JOIN locations cl
  ON cl.id = it.location_id
 AND cl.tenant_id = it.tenant_id
LEFT JOIN skus s
  ON s.id = it.sku_id
 AND s.tenant_id = it.tenant_id
INNER JOIN inventory_location_mappings m
  ON m.tenant_id = it.tenant_id
 AND m.status = 'active'
 AND m.sku_code = (COALESCE(s.sku_code, '__UNKNOWN__') COLLATE utf8mb4_unicode_ci)
 AND m.source_note = (COALESCE(NULLIF(it.reference_no, ''), NULLIF(it.notes, ''), '__EMPTY__') COLLATE utf8mb4_unicode_ci)
INNER JOIN warehouses tw
  ON tw.tenant_id = it.tenant_id
 AND tw.code = m.warehouse_code
 AND tw.status = 'active'
INNER JOIN locations tl
  ON tl.tenant_id = it.tenant_id
 AND tl.warehouse_id = tw.id
 AND tl.code = m.location_code
 AND tl.status = 'active'
WHERE it.tenant_id = @tenant_id
  AND cw.code = 'DEFAULT'
  AND cl.code = 'DEFAULT-UNKNOWN';

UPDATE inventory_transactions it
INNER JOIN tmp_default_tx_residual_candidates c
  ON c.tx_id = it.id
SET
  it.warehouse_id = c.target_warehouse_id,
  it.location_id = c.target_location_id,
  it.source_ref = CONCAT('repair:residual-default:', @repair_tag),
  it.updated_by = @operator_id;

SELECT ROW_COUNT() AS repaired_default_tx_rows;

SELECT COUNT(*) AS default_tx_count_total_after
FROM inventory_transactions it
INNER JOIN warehouses w
  ON w.id = it.warehouse_id
 AND w.tenant_id = it.tenant_id
INNER JOIN locations l
  ON l.id = it.location_id
 AND l.tenant_id = it.tenant_id
WHERE it.tenant_id = @tenant_id
  AND w.code = 'DEFAULT'
  AND l.code = 'DEFAULT-UNKNOWN';
SQL
}

run_preview_sql

if [[ "$APPLY_MODE" -eq 1 ]]; then
  run_apply_sql
else
  log "dry-run only (use --apply to execute updates)"
fi

log "done"
