#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT_DIR/services/api"
INIT_SQL_FILE="$ROOT_DIR/infra/db/init.sql"
MIGRATIONS_DIR="$API_DIR/src/migrations"

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_NAME="${DB_NAME:-smart_factory_test}"
DB_USER="${DB_USER:-sfuser}"
DB_PASS="${DB_PASS:-sfpass}"
DB_ROOT_USER="${DB_ROOT_USER:-root}"
DB_ROOT_PASSWORD="${DB_ROOT_PASSWORD:-root}"

log() {
  printf '[prepare-api-test-db] %s\n' "$*"
}

run_mysql() {
  local user="$1"
  local password="$2"
  local sql_file="$3"

  MYSQL_PWD="$password" mysql \
    -h "$DB_HOST" \
    -P "$DB_PORT" \
    -u "$user" \
    "$DB_NAME" \
    < "$sql_file"
}

apply_init_schema() {
  if [[ ! -f "$INIT_SQL_FILE" ]]; then
    log "init schema file not found: $INIT_SQL_FILE"
    return 0
  fi

  log "applying init schema with app user"
  if run_mysql "$DB_USER" "$DB_PASS" "$INIT_SQL_FILE" 2>/dev/null; then
    return 0
  fi

  log "app user init failed, retrying with root"
  if run_mysql "$DB_ROOT_USER" "$DB_ROOT_PASSWORD" "$INIT_SQL_FILE"; then
    return 0
  fi

  log "init schema skipped"
}

apply_migrations() {
  shopt -s nullglob
  local files=("$MIGRATIONS_DIR"/*.sql)
  shopt -u nullglob

  if [[ "${#files[@]}" -eq 0 ]]; then
    log "no SQL migrations found in $MIGRATIONS_DIR"
    return 0
  fi

  local file
  for file in "${files[@]}"; do
    log "applying migration $(basename "$file")"
    run_mysql "$DB_USER" "$DB_PASS" "$file"
  done
}

apply_init_schema
apply_migrations

