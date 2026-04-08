#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/run-inventory-warehouse-remediation.sh <mapping_csv_path>

Environment overrides:
  TENANT_ID=1
  OPERATOR_ID=0
  DB_HOST=127.0.0.1
  DB_PORT=3307
  DB_NAME=smart_factory
  DB_USER=sf_app
  DB_PASS=...
  BATCH_NO=DRILL_YYYYMMDDHHMMSS   # optional
EOF
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

MAPPING_CSV="$1"
if [[ ! -f "$MAPPING_CSV" ]]; then
  echo "mapping csv not found: $MAPPING_CSV" >&2
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
BATCH_NO="${BATCH_NO:-DRILL_$(date '+%Y%m%d%H%M%S')}"
OUTPUT_DIR="${OUTPUT_DIR:-docs/v3/release-logs/inventory-warehouse/remediation-$(date '+%Y%m%d-%H%M%S')}"

mkdir -p "$OUTPUT_DIR"
MYSQL_CMD=(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME")

log() {
  printf '[run-inventory-warehouse-remediation] %s\n' "$*"
}

log "start tenant_id=$TENANT_ID operator_id=$OPERATOR_ID batch_no=$BATCH_NO"
log "output_dir=$OUTPUT_DIR"

log "step1: import mappings"
IMPORT_OUT_DIR="$OUTPUT_DIR/mapping-import"
OUTPUT_DIR="$IMPORT_OUT_DIR" TENANT_ID="$TENANT_ID" OPERATOR_ID="$OPERATOR_ID" \
  ./scripts/import-inventory-location-mappings.sh "$MAPPING_CSV" --apply \
  > "$OUTPUT_DIR/import-step.out.txt"

log "step2: run mapping drill"
{
  printf "SET @tenant_id = %s;\n" "$TENANT_ID"
  printf "SET @operator_id = %s;\n" "$OPERATOR_ID"
  printf "SET @batch_no = '%s';\n" "$BATCH_NO"
  cat docs/v3/sql/inventory-warehouse-mapping-drill.sql
} | MYSQL_PWD="$DB_PASS" "${MYSQL_CMD[@]}" --table > "$OUTPUT_DIR/mapping-drill.out.txt"

log "step3: run default-location repair by mapping"
{
  printf "SET @tenant_id = %s;\n" "$TENANT_ID"
  printf "SET @operator_id = %s;\n" "$OPERATOR_ID"
  printf "SET @batch_no = '%s';\n" "$BATCH_NO"
  cat docs/v3/sql/inventory-default-location-repair-by-mapping.sql
} | MYSQL_PWD="$DB_PASS" "${MYSQL_CMD[@]}" --table > "$OUTPUT_DIR/default-location-repair.out.txt"

log "step3.5: repair residual default transactions by mapping"
TENANT_ID="$TENANT_ID" OPERATOR_ID="$OPERATOR_ID" DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_NAME="$DB_NAME" DB_USER="$DB_USER" DB_PASS="$DB_PASS" \
  ./scripts/repair-inventory-default-transactions-by-mapping.sh --apply --repair-tag "$BATCH_NO" \
  > "$OUTPUT_DIR/residual-default-tx-repair.out.txt"

log "step4: run audit"
OUTPUT_DIR="$OUTPUT_DIR/audit" TENANT_ID="$TENANT_ID" DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_NAME="$DB_NAME" DB_USER="$DB_USER" DB_PASS="$DB_PASS" \
  ./scripts/run-inventory-warehouse-audit.sh \
  > "$OUTPUT_DIR/audit-step.out.txt"

log "done"
echo "$OUTPUT_DIR"
