#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3307}"
DB_NAME="${DB_NAME:-smart_factory}"
DB_USER="${DB_USER:-sf_app}"
DB_PASS="${DB_PASS:-}"
TENANT_ID="${TENANT_ID:-1}"
WINDOW_DAYS="${WINDOW_DAYS:-1}"
RATIO_THRESHOLD="${RATIO_THRESHOLD:-3.00}"
OUTPUT_DIR="${OUTPUT_DIR:-docs/v3/release-logs/inventory-warehouse/$(date '+%Y%m%d-%H%M%S')}"

log() {
  printf '[inventory-warehouse-audit] %s\n' "$*"
}

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

mkdir -p "$OUTPUT_DIR"
MYSQL_CMD=(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME")

run_sql_file() {
  local file="$1"
  local out="$2"
  log "running $(basename "$file") -> $out"
  MYSQL_PWD="$DB_PASS" "${MYSQL_CMD[@]}" --table \
    < "$file" \
    > "$out"
}

run_sql_file "docs/v3/sql/inventory-warehouse-postcheck.sql" "$OUTPUT_DIR/postcheck.out.txt"
run_sql_file "docs/v3/sql/inventory-warehouse-daily-audit.sql" "$OUTPUT_DIR/daily-audit.out.txt"

log "collecting summarized metrics"
MYSQL_PWD="$DB_PASS" "${MYSQL_CMD[@]}" --batch --raw -e "
SET @tenant_id = ${TENANT_ID};
SET @ratio_threshold = ${RATIO_THRESHOLD};
SET @window_start = DATE_SUB(CURDATE(), INTERVAL ${WINDOW_DAYS} DAY);
SET @window_end = CURDATE();

SELECT 'inventory_invalid_binding' AS metric, COUNT(*) AS value
FROM inventory inv
LEFT JOIN warehouses w
  ON w.id = inv.warehouse_id
 AND w.tenant_id = inv.tenant_id
LEFT JOIN locations l
  ON l.id = inv.location_id
 AND l.tenant_id = inv.tenant_id
WHERE inv.tenant_id = @tenant_id
  AND (
    inv.warehouse_id IS NULL
    OR inv.location_id IS NULL
    OR w.id IS NULL
    OR l.id IS NULL
    OR l.warehouse_id <> inv.warehouse_id
    OR w.status <> 'active'
    OR l.status <> 'active'
  );

SELECT 'tx_invalid_binding_daily' AS metric, COUNT(*) AS value
FROM inventory_transactions it
LEFT JOIN warehouses w
  ON w.id = it.warehouse_id
 AND w.tenant_id = it.tenant_id
LEFT JOIN locations l
  ON l.id = it.location_id
 AND l.tenant_id = it.tenant_id
WHERE it.tenant_id = @tenant_id
  AND it.created_at >= @window_start
  AND it.created_at < @window_end
  AND (
    it.warehouse_id IS NULL
    OR it.location_id IS NULL
    OR w.id IS NULL
    OR l.id IS NULL
    OR l.warehouse_id <> it.warehouse_id
    OR w.status <> 'active'
    OR l.status <> 'active'
  );

SELECT
  'default_ratio_pct' AS metric,
  ROUND(
    CASE
      WHEN SUM(inv.qty_on_hand) = 0 THEN 0
      ELSE SUM(CASE WHEN w.code = 'DEFAULT' AND l.code = 'DEFAULT-UNKNOWN' THEN inv.qty_on_hand ELSE 0 END)
           / SUM(inv.qty_on_hand) * 100
    END, 4
  ) AS value
FROM inventory inv
LEFT JOIN warehouses w
  ON w.id = inv.warehouse_id
 AND w.tenant_id = inv.tenant_id
LEFT JOIN locations l
  ON l.id = inv.location_id
 AND l.tenant_id = inv.tenant_id
WHERE inv.tenant_id = @tenant_id;

SELECT
  'default_ratio_verdict' AS metric,
  CASE
    WHEN (
      CASE
        WHEN SUM(inv.qty_on_hand) = 0 THEN 0
        ELSE SUM(CASE WHEN w.code = 'DEFAULT' AND l.code = 'DEFAULT-UNKNOWN' THEN inv.qty_on_hand ELSE 0 END)
             / SUM(inv.qty_on_hand) * 100
      END
    ) < @ratio_threshold THEN 'PASS'
    ELSE 'FAIL'
  END AS value
FROM inventory inv
LEFT JOIN warehouses w
  ON w.id = inv.warehouse_id
 AND w.tenant_id = inv.tenant_id
LEFT JOIN locations l
  ON l.id = inv.location_id
 AND l.tenant_id = inv.tenant_id
WHERE inv.tenant_id = @tenant_id;

SELECT 'default_tx_count_daily' AS metric, COUNT(*) AS value
FROM inventory_transactions it
INNER JOIN warehouses w
  ON w.id = it.warehouse_id
 AND w.tenant_id = it.tenant_id
INNER JOIN locations l
  ON l.id = it.location_id
 AND l.tenant_id = it.tenant_id
WHERE it.tenant_id = @tenant_id
  AND it.created_at >= @window_start
  AND it.created_at < @window_end
  AND w.code = 'DEFAULT'
  AND l.code = 'DEFAULT-UNKNOWN';

SELECT 'default_tx_count_total' AS metric, COUNT(*) AS value
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
" > "$OUTPUT_DIR/metrics.tsv"

log "done"
log "output_dir=$OUTPUT_DIR"
cat "$OUTPUT_DIR/metrics.tsv"
