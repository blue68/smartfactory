#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/check-inventory-warehouse-remediation-readiness.sh <mapping_csv_path>
EOF
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

CSV_PATH="$1"
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

log() {
  printf '[inventory-warehouse-readiness] %s\n' "$*"
}

READINESS_COUNTS="$(
  MYSQL_PWD="$DB_PASS" mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" --batch --raw --skip-column-names -e "
SELECT
  (SELECT COUNT(*) FROM warehouses WHERE tenant_id=${TENANT_ID}) AS total_wh,
  (SELECT COUNT(*) FROM warehouses WHERE tenant_id=${TENANT_ID} AND status='active') AS active_wh,
  (SELECT COUNT(*) FROM locations WHERE tenant_id=${TENANT_ID}) AS total_loc,
  (SELECT COUNT(*) FROM locations WHERE tenant_id=${TENANT_ID} AND status='active') AS active_loc,
  (SELECT COUNT(*) FROM warehouses WHERE tenant_id=${TENANT_ID} AND status='active' AND code <> 'DEFAULT') AS active_non_default_wh,
  (SELECT COUNT(*)
   FROM locations l
   INNER JOIN warehouses w
     ON w.id = l.warehouse_id
    AND w.tenant_id = l.tenant_id
   WHERE l.tenant_id=${TENANT_ID}
     AND l.status='active'
     AND NOT (w.code='DEFAULT' AND l.code='DEFAULT-UNKNOWN')
  ) AS active_non_default_loc;
"
)" || {
  log "database query failed (host=${DB_HOST} port=${DB_PORT} db=${DB_NAME})" >&2
  exit 2
}

read -r TOTAL_WH ACTIVE_WH TOTAL_LOC ACTIVE_LOC ACTIVE_NON_DEFAULT_WH ACTIVE_NON_DEFAULT_LOC <<<"$READINESS_COUNTS"

for metric in \
  "$TOTAL_WH" \
  "$ACTIVE_WH" \
  "$TOTAL_LOC" \
  "$ACTIVE_LOC" \
  "$ACTIVE_NON_DEFAULT_WH" \
  "$ACTIVE_NON_DEFAULT_LOC"; do
  if [[ ! "$metric" =~ ^[0-9]+$ ]]; then
    log "unexpected readiness metric payload: ${READINESS_COUNTS}" >&2
    exit 2
  fi
done

read -r CSV_TOTAL CSV_FILLED <<<"$(
  python3 - "$CSV_PATH" <<'PY'
import csv
import sys

path = sys.argv[1]
with open(path, newline="", encoding="utf-8-sig") as f:
    r = csv.DictReader(f)
    total = 0
    filled = 0
    for row in r:
        total += 1
        wh = (row.get("warehouse_code") or "").strip()
        loc = (row.get("location_code") or "").strip()
        if wh and loc:
            filled += 1
print(total, filled)
PY
)"

STATUS="READY"
REASONS=()

if [[ "$ACTIVE_NON_DEFAULT_WH" -eq 0 ]]; then
  STATUS="BLOCKED"
  REASONS+=("NO_ACTIVE_NON_DEFAULT_WAREHOUSE")
fi

if [[ "$ACTIVE_NON_DEFAULT_LOC" -eq 0 ]]; then
  STATUS="BLOCKED"
  REASONS+=("NO_ACTIVE_NON_DEFAULT_LOCATION")
fi

if [[ "$CSV_TOTAL" -eq 0 ]]; then
  STATUS="BLOCKED"
  REASONS+=("EMPTY_MAPPING_CSV")
fi

if [[ "$CSV_FILLED" -eq 0 ]]; then
  STATUS="BLOCKED"
  REASONS+=("NO_FILLED_MAPPING_ROWS")
fi

log "tenant_id=$TENANT_ID"
echo "status=${STATUS}"
echo "total_warehouses=${TOTAL_WH}"
echo "active_warehouses=${ACTIVE_WH}"
echo "total_locations=${TOTAL_LOC}"
echo "active_locations=${ACTIVE_LOC}"
echo "active_non_default_warehouses=${ACTIVE_NON_DEFAULT_WH}"
echo "active_non_default_locations=${ACTIVE_NON_DEFAULT_LOC}"
echo "mapping_csv_total_rows=${CSV_TOTAL}"
echo "mapping_csv_filled_rows=${CSV_FILLED}"

if [[ "${#REASONS[@]}" -gt 0 ]]; then
  echo "blocking_reasons=$(IFS=,; echo "${REASONS[*]}")"
fi
