#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3307}"
DB_NAME="${DB_NAME:-smart_factory}"
DB_USER="${DB_USER:-sf_app}"
DB_PASS="${DB_PASS:-${DB_PASSWORD:-TestApp2026!Secure}}"

APP_BASE_URL="${APP_BASE_URL:-http://127.0.0.1}"
API_BASE_URL="${API_BASE_URL:-${APP_BASE_URL%/}/api}"

VERIFY_USERNAME="${1:-platform_root_bootstrap_verify_$(date +%s)}"
VERIFY_PASSWORD="${2:-Dev123!2026}"
VERIFY_REAL_NAME="${3:-Bootstrap校验平台管理员}"

CREATED_USER_ID=""

log() {
  printf '[verify-platform-super-admin-bootstrap] %s\n' "$*"
}

sql_escape() {
  printf '%s' "$1" | sed "s/'/''/g"
}

mysql_query() {
  local sql="$1"
  MYSQL_PWD="$DB_PASS" mysql \
    -h "$DB_HOST" \
    -P "$DB_PORT" \
    -u "$DB_USER" \
    -D "$DB_NAME" \
    --batch \
    --skip-column-names \
    -e "$sql"
}

cleanup_verify_user() {
  if [[ -z "$CREATED_USER_ID" ]]; then
    CREATED_USER_ID="$(mysql_query "SELECT id FROM users WHERE tenant_id = 0 AND username = '$(sql_escape "$VERIFY_USERNAME")' LIMIT 1" || true)"
  fi

  if [[ -z "$CREATED_USER_ID" ]]; then
    return 0
  fi

  if [[ "$(mysql_query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'user_role_assignments'" || true)" != "0" ]]; then
    mysql_query "DELETE FROM user_role_assignments WHERE tenant_id = 0 AND user_id = ${CREATED_USER_ID};" || true
  fi

  if [[ "$(mysql_query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'user_roles'" || true)" != "0" ]]; then
    mysql_query "DELETE FROM user_roles WHERE tenant_id = 0 AND user_id = ${CREATED_USER_ID};" || true
  fi

  mysql_query "DELETE FROM users WHERE tenant_id = 0 AND id = ${CREATED_USER_ID};" || true
  log "cleaned up verify user id=${CREATED_USER_ID}"
}

verify_db_state() {
  local user_row assignment_count
  user_row="$(mysql_query "SELECT CONCAT(id, ':', tenant_id, ':', status) FROM users WHERE tenant_id = 0 AND username = '$(sql_escape "$VERIFY_USERNAME")' LIMIT 1")"
  if [[ -z "$user_row" ]]; then
    log "verify user was not created"
    return 1
  fi

  CREATED_USER_ID="${user_row%%:*}"
  local user_tenant_status="${user_row#*:}"
  if [[ "$user_tenant_status" != "0:active" ]]; then
    log "unexpected user row state: $user_row"
    return 1
  fi

  if [[ "$(mysql_query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'user_role_assignments'")" != "0" ]]; then
    assignment_count="$(mysql_query "SELECT COUNT(*) FROM user_role_assignments WHERE tenant_id = 0 AND user_id = ${CREATED_USER_ID} AND is_primary = 1 AND assignment_status = 'active'")"
  else
    assignment_count="$(mysql_query "SELECT COUNT(*) FROM user_roles WHERE tenant_id = 0 AND user_id = ${CREATED_USER_ID}")"
  fi

  if [[ "$assignment_count" != "1" ]]; then
    log "unexpected role assignment count: $assignment_count"
    return 1
  fi

  local permission_count
  permission_count="$(mysql_query "
    SELECT COUNT(DISTINCT permission_key)
    FROM role_permissions rp
    INNER JOIN roles r ON r.id = rp.role_id
    WHERE rp.tenant_id = 0
      AND r.tenant_id = 0
      AND r.code = 'platform_super_admin'
      AND rp.permission_key IN ('system.tenant.manage', 'platform.tenant.switch', 'system.audit.view');
  ")"
  if [[ "$permission_count" != "3" ]]; then
    log "platform role permission seed is incomplete: $permission_count"
    return 1
  fi
}

verify_login_response() {
  local response_file http_code
  response_file="$(mktemp "${TMPDIR:-/tmp}/platform-bootstrap-login.XXXXXX")"

  http_code="$(
    curl -sS \
      -o "$response_file" \
      -w '%{http_code}' \
      -X POST "${API_BASE_URL%/}/auth/login" \
      -H 'Content-Type: application/json' \
      --data "{\"loginMode\":\"platform\",\"username\":\"${VERIFY_USERNAME}\",\"password\":\"${VERIFY_PASSWORD}\"}"
  )"

  if [[ "$http_code" != "200" ]]; then
    log "unexpected login status: $http_code"
    cat "$response_file"
    rm -f "$response_file"
    return 1
  fi

  node - "$response_file" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
const response = JSON.parse(fs.readFileSync(path, 'utf8'));
const payload = response?.data;
const user = payload?.user;
if (!payload || !user) {
  throw new Error('Missing response.data');
}
if (user.scopeLevel !== 'platform') {
  throw new Error(`Unexpected scopeLevel: ${user.scopeLevel}`);
}
if (user.originTenantId !== 0) {
  throw new Error(`Unexpected originTenantId: ${user.originTenantId}`);
}
if (user.contextTenantId !== null) {
  throw new Error(`Unexpected contextTenantId: ${user.contextTenantId}`);
}
if (user.tenantId !== 0) {
  throw new Error(`Unexpected tenantId: ${user.tenantId}`);
}
const actionCodes = payload.permissionSnapshot?.actionCodes ?? [];
for (const required of ['system.tenant.manage', 'platform.tenant.switch', 'system.audit.view']) {
  if (!actionCodes.includes(required)) {
    throw new Error(`Missing action code: ${required}`);
  }
}
NODE

  rm -f "$response_file"
}

main() {
  trap cleanup_verify_user EXIT

  log "target api=${API_BASE_URL%/}"
  log "target db=${DB_HOST}:${DB_PORT}/${DB_NAME}"
  log "bootstrapping verify user=${VERIFY_USERNAME}"

  bash "$ROOT_DIR/scripts/bootstrap-platform-super-admin.sh" \
    "$VERIFY_USERNAME" \
    "$VERIFY_PASSWORD" \
    "$VERIFY_REAL_NAME"

  verify_db_state
  verify_login_response

  log "bootstrap verification passed"
}

main "$@"
