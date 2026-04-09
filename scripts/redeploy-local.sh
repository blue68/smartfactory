#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

STACK_CONTAINERS=(sf_mysql sf_redis sf_api sf_web)
MAX_BUILD_RETRIES=2
HEALTH_TIMEOUT_SECONDS=180

log() {
  printf '[redeploy] %s\n' "$*"
}

wait_container_healthy() {
  local name="$1"
  local timeout="$2"
  local waited=0

  while (( waited < timeout )); do
    local state
    state="$(docker inspect -f '{{.State.Status}}' "$name" 2>/dev/null || true)"
    if [[ "$state" != "running" ]]; then
      sleep 2
      waited=$((waited + 2))
      continue
    fi

    local health
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name" 2>/dev/null || true)"
    if [[ "$health" == "healthy" || "$health" == "none" ]]; then
      log "$name is $state/$health"
      return 0
    fi

    sleep 2
    waited=$((waited + 2))
  done

  log "timeout waiting for $name to become healthy"
  docker ps -a --filter "name=^${name}$" --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
  return 1
}

log "stopping old stack"
docker compose down

build_ok=0
for attempt in $(seq 1 "$MAX_BUILD_RETRIES"); do
  log "starting fresh stack (attempt ${attempt}/${MAX_BUILD_RETRIES})"
  if docker compose up -d --build; then
    build_ok=1
    break
  fi
  log "build/start failed on attempt ${attempt}"
done

if [[ "$build_ok" -ne 1 ]]; then
  log "failed to rebuild stack after ${MAX_BUILD_RETRIES} attempts"
  exit 1
fi

log "waiting container health"
wait_container_healthy "sf_mysql" "$HEALTH_TIMEOUT_SECONDS"

log "applying local schema sync"
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi
export MYSQL_PWD="${DB_PASS:-}"
mysql -h 127.0.0.1 -P 3307 -u "${DB_USER:-sf_app}" "${DB_NAME:-smart_factory}" \
  < "$ROOT_DIR/services/api/src/migrations/V2_schema_fixes.sql"
mysql -h 127.0.0.1 -P 3307 -u "${DB_USER:-sf_app}" "${DB_NAME:-smart_factory}" \
  < "$ROOT_DIR/services/api/src/migrations/V2_sprint1_r06_task_exceptions.sql"
mysql -h 127.0.0.1 -P 3307 -u "${DB_USER:-sf_app}" "${DB_NAME:-smart_factory}" \
  < "$ROOT_DIR/services/api/src/migrations/V2_p04_r06_gaps.sql"
mysql -h 127.0.0.1 -P 3307 -u "${DB_USER:-sf_app}" "${DB_NAME:-smart_factory}" \
  < "$ROOT_DIR/services/api/src/migrations/V2_p0_batch2_gaps.sql"
mysql -h 127.0.0.1 -P 3307 -u "${DB_USER:-sf_app}" "${DB_NAME:-smart_factory}" \
  < "$ROOT_DIR/services/api/src/migrations/V2_p1_notifications.sql"
mysql -h 127.0.0.1 -P 3307 -u "${DB_USER:-sf_app}" "${DB_NAME:-smart_factory}" \
  < "$ROOT_DIR/services/api/src/migrations/V3_workstation_types.sql"
mysql -h 127.0.0.1 -P 3307 -u "${DB_USER:-sf_app}" "${DB_NAME:-smart_factory}" \
  < "$ROOT_DIR/services/api/src/migrations/V2_sprint1_r01_r05.sql"
mysql -h 127.0.0.1 -P 3307 -u "${DB_USER:-sf_app}" "${DB_NAME:-smart_factory}" \
  < "$ROOT_DIR/services/api/src/migrations/V2_sprint1b_r07_r08.sql"
mysql -h 127.0.0.1 -P 3307 -u "${DB_USER:-sf_app}" "${DB_NAME:-smart_factory}" \
  < "$ROOT_DIR/services/api/src/migrations/M20260329_half_finished_phase1.sql"
mysql -h 127.0.0.1 -P 3307 -u "${DB_USER:-sf_app}" "${DB_NAME:-smart_factory}" \
  < "$ROOT_DIR/services/api/src/migrations/M20260329_phase2_scheduler_operations.sql"
mysql -h 127.0.0.1 -P 3307 -u "${DB_USER:-sf_app}" "${DB_NAME:-smart_factory}" \
  < "$ROOT_DIR/services/api/src/migrations/V2_sprint4_schedule_tables.sql"
mysql -h 127.0.0.1 -P 3307 -u "${DB_USER:-sf_app}" "${DB_NAME:-smart_factory}" \
  < "$ROOT_DIR/services/api/src/migrations/V7_purchase_settlements.sql"
mysql -h 127.0.0.1 -P 3307 -u "${DB_USER:-sf_app}" "${DB_NAME:-smart_factory}" \
  < "$ROOT_DIR/infra/db/local-dev-schema-sync.sql"
mysql -h 127.0.0.1 -P 3307 -u "${DB_USER:-sf_app}" "${DB_NAME:-smart_factory}" \
  < "$ROOT_DIR/services/api/src/migrations/V8_purchase_dye_lot.sql"
mysql -h 127.0.0.1 -P 3307 -u "${DB_USER:-sf_app}" "${DB_NAME:-smart_factory}" \
  < "$ROOT_DIR/services/api/src/migrations/V9_process_step_workstation_link.sql"
mysql -h 127.0.0.1 -P 3307 -u "${DB_USER:-sf_app}" "${DB_NAME:-smart_factory}" \
  < "$ROOT_DIR/services/api/src/migrations/V2_f105_f707_analytics.sql"
mysql -h 127.0.0.1 -P 3307 -u "${DB_USER:-sf_app}" "${DB_NAME:-smart_factory}" \
  < "$ROOT_DIR/services/api/src/migrations/M20260403_inventory_warehouse_alignment.sql"
mysql -h 127.0.0.1 -P 3307 -u "${DB_USER:-sf_app}" "${DB_NAME:-smart_factory}" \
  < "$ROOT_DIR/services/api/src/migrations/M20260407_location_rack_compat.sql"
mysql -h 127.0.0.1 -P 3307 -u "${DB_USER:-sf_app}" "${DB_NAME:-smart_factory}" \
  < "$ROOT_DIR/services/api/src/migrations/M20260408_access_control_phase1.sql"
mysql -h 127.0.0.1 -P 3307 -u "${DB_USER:-sf_app}" "${DB_NAME:-smart_factory}" \
  < "$ROOT_DIR/services/api/src/migrations/M20260409_access_control_business_permissions.sql"
mysql -h 127.0.0.1 -P 3307 -u "${DB_USER:-sf_app}" "${DB_NAME:-smart_factory}" \
  < "$ROOT_DIR/services/api/src/migrations/M20260409_inventory_daily_snapshot_warehouse_scope.sql"
mysql -h 127.0.0.1 -P 3307 -u "${DB_USER:-sf_app}" "${DB_NAME:-smart_factory}" \
  < "$ROOT_DIR/services/api/src/migrations/M20260409_production_task_inventory_flow.sql"
mysql -h 127.0.0.1 -P 3307 -u "${DB_USER:-sf_app}" "${DB_NAME:-smart_factory}" \
  < "$ROOT_DIR/services/api/src/migrations/M20260410_incoming_inspection_actual_stock_qty.sql"
mysql -h 127.0.0.1 -P 3307 -u "${DB_USER:-sf_app}" "${DB_NAME:-smart_factory}" \
  < "$ROOT_DIR/infra/db/local-dev-accounts.sql"
unset MYSQL_PWD

log "bootstrapping local platform super admin"
bash "$ROOT_DIR/scripts/bootstrap-platform-super-admin.sh"

for c in sf_redis sf_api sf_web; do
  wait_container_healthy "$c" "$HEALTH_TIMEOUT_SECONDS"
done

log "final status"
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | (head -n 1; rg '^sf_' || true)

log "done"
