#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT_DIR/services/api"

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3307}"
DB_NAME="${DB_NAME:-smart_factory}"
DB_USER="${DB_USER:-sf_app}"
DB_PASS="${DB_PASS:-${DB_PASSWORD:-TestApp2026!Secure}}"

PLATFORM_USERNAME="${1:-${PLATFORM_ADMIN_USERNAME:-platform_root_dev}}"
PLATFORM_PASSWORD="${2:-${PLATFORM_ADMIN_PASSWORD:-Dev123!2026}}"
PLATFORM_REAL_NAME="${3:-${PLATFORM_ADMIN_REAL_NAME:-平台超级管理员}}"

log() {
  printf '[bootstrap-platform-super-admin] %s\n' "$*"
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

table_exists() {
  local table_name="$1"
  [[ "$(mysql_query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '$(sql_escape "$table_name")'")" != "0" ]]
}

column_exists() {
  local table_name="$1"
  local column_name="$2"
  [[ "$(mysql_query "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '$(sql_escape "$table_name")' AND column_name = '$(sql_escape "$column_name")'")" != "0" ]]
}

generate_password_hash() {
  (
    cd "$API_DIR"
    node -e "const bcrypt=require('bcrypt'); bcrypt.hash(process.argv[1],10).then(v=>process.stdout.write(v));" "$PLATFORM_PASSWORD"
  )
}

ensure_platform_role() {
  local has_role_type="$1"
  local has_role_scope="$2"
  local has_status="$3"
  local has_priority="$4"
  local has_data_scope_template="$5"
  local has_assignable="$6"
  local has_permissions="$7"
  local has_created_by="$8"
  local has_updated_by="$9"

  local columns="tenant_id, code, name, description, created_at, updated_at"
  local values="0, 'platform_super_admin', '平台超级管理员', '平台态登录与显式租户代管专用角色', NOW(3), NOW(3)"
  local updates="name = VALUES(name), description = VALUES(description), updated_at = NOW(3)"

  if [[ "$has_role_type" == "1" ]]; then
    columns+=", role_type"
    values+=", 'system'"
    updates+=", role_type = VALUES(role_type)"
  fi
  if [[ "$has_status" == "1" ]]; then
    columns+=", status"
    values+=", 'active'"
    updates+=", status = VALUES(status)"
  fi
  if [[ "$has_role_scope" == "1" ]]; then
    columns+=", role_scope"
    values+=", 'platform'"
    updates+=", role_scope = VALUES(role_scope)"
  fi
  if [[ "$has_priority" == "1" ]]; then
    columns+=", priority"
    values+=", 999"
    updates+=", priority = VALUES(priority)"
  fi
  if [[ "$has_data_scope_template" == "1" ]]; then
    columns+=", data_scope_template"
    values+=", 'all'"
    updates+=", data_scope_template = VALUES(data_scope_template)"
  fi
  if [[ "$has_assignable" == "1" ]]; then
    columns+=", assignable"
    values+=", 1"
    updates+=", assignable = VALUES(assignable)"
  fi
  if [[ "$has_permissions" == "1" ]]; then
    columns+=", permissions"
    values+=", JSON_ARRAY()"
    updates+=", permissions = VALUES(permissions)"
  fi
  if [[ "$has_created_by" == "1" ]]; then
    columns+=", created_by"
    values+=", 0"
  fi
  if [[ "$has_updated_by" == "1" ]]; then
    columns+=", updated_by"
    values+=", 0"
    updates+=", updated_by = VALUES(updated_by)"
  fi

  mysql_query "
    INSERT INTO roles (${columns})
    VALUES (${values})
    ON DUPLICATE KEY UPDATE ${updates};
  "
}

ensure_platform_user() {
  local password_hash="$1"
  local esc_username esc_real_name esc_password_hash
  esc_username="$(sql_escape "$PLATFORM_USERNAME")"
  esc_real_name="$(sql_escape "$PLATFORM_REAL_NAME")"
  esc_password_hash="$(sql_escape "$password_hash")"

  mysql_query "
    INSERT INTO users (tenant_id, username, password_hash, real_name, status, created_by, updated_by, created_at, updated_at)
    VALUES (0, '${esc_username}', '${esc_password_hash}', '${esc_real_name}', 'active', 0, 0, NOW(3), NOW(3))
    ON DUPLICATE KEY UPDATE
      password_hash = VALUES(password_hash),
      real_name = VALUES(real_name),
      status = VALUES(status),
      updated_by = VALUES(updated_by),
      updated_at = NOW(3);
  "
}

ensure_platform_permissions() {
  if ! table_exists "role_permissions" || ! table_exists "permission_actions" || ! table_exists "permission_menus"; then
    return 0
  fi

  mysql_query "
    INSERT INTO role_permissions (tenant_id, role_id, permission_type, permission_key, permission_ref_id, created_by)
    SELECT 0, r.id, 'menu', pm.code, pm.id, 0
    FROM roles r
    INNER JOIN permission_menus pm ON pm.tenant_id = 0
    WHERE r.tenant_id = 0
      AND r.code = 'platform_super_admin'
      AND pm.code IN ('system.management', 'system.tenant.config')
    ON DUPLICATE KEY UPDATE permission_ref_id = VALUES(permission_ref_id);
  "

  mysql_query "
    INSERT INTO role_permissions (tenant_id, role_id, permission_type, permission_key, permission_ref_id, created_by)
    SELECT 0, r.id, 'action', pa.code, pa.id, 0
    FROM roles r
    INNER JOIN permission_actions pa ON pa.tenant_id = 0
    WHERE r.tenant_id = 0
      AND r.code = 'platform_super_admin'
      AND pa.code IN ('system.tenant.manage', 'platform.tenant.switch', 'system.audit.view')
    ON DUPLICATE KEY UPDATE permission_ref_id = VALUES(permission_ref_id);
  "
}

ensure_platform_assignment() {
  local user_id role_id
  user_id="$(mysql_query "SELECT id FROM users WHERE tenant_id = 0 AND username = '$(sql_escape "$PLATFORM_USERNAME")' LIMIT 1")"
  role_id="$(mysql_query "SELECT id FROM roles WHERE tenant_id = 0 AND code = 'platform_super_admin' LIMIT 1")"

  if [[ -z "$user_id" || -z "$role_id" ]]; then
    log "failed to resolve platform user or role after insert"
    return 1
  fi

  if table_exists "user_role_assignments"; then
    local columns="tenant_id, user_id, role_id, is_primary, effective_from, effective_to, assignment_status, source_type, remark, created_by, updated_by, created_at, updated_at"
    local values="0, ${user_id}, ${role_id}, 1, NULL, NULL, 'active', 'manual', 'bootstrap platform super admin', 0, 0, NOW(3), NOW(3)"
    local updates="is_primary = VALUES(is_primary), assignment_status = VALUES(assignment_status), updated_by = VALUES(updated_by), updated_at = NOW(3)"

    if column_exists "user_role_assignments" "role_scope"; then
      columns="tenant_id, user_id, role_id, role_scope, is_primary, effective_from, effective_to, assignment_status, source_type, remark, created_by, updated_by, created_at, updated_at"
      values="0, ${user_id}, ${role_id}, 'platform', 1, NULL, NULL, 'active', 'manual', 'bootstrap platform super admin', 0, 0, NOW(3), NOW(3)"
      updates="role_scope = VALUES(role_scope), is_primary = VALUES(is_primary), assignment_status = VALUES(assignment_status), updated_by = VALUES(updated_by), updated_at = NOW(3)"
    fi

    mysql_query "
      INSERT INTO user_role_assignments (${columns})
      VALUES (${values})
      ON DUPLICATE KEY UPDATE ${updates};
    "
    return 0
  fi

  if table_exists "user_roles"; then
    mysql_query "
      INSERT IGNORE INTO user_roles (tenant_id, user_id, role_id, created_at, created_by)
      VALUES (0, ${user_id}, ${role_id}, NOW(3), 0);
    "
  fi
}

print_summary() {
  mysql_query "
    SELECT CONCAT('user=', u.username, ', tenant_id=', u.tenant_id, ', role=', r.code)
    FROM users u
    INNER JOIN roles r ON r.tenant_id = 0 AND r.code = 'platform_super_admin'
    WHERE u.tenant_id = 0
      AND u.username = '$(sql_escape "$PLATFORM_USERNAME")'
    LIMIT 1;
  "
}

main() {
  log "target db=${DB_HOST}:${DB_PORT}/${DB_NAME}"
  log "bootstrapping username=${PLATFORM_USERNAME}"

  local password_hash
  password_hash="$(generate_password_hash)"

  ensure_platform_role \
    "$(column_exists "roles" "role_type" && echo 1 || echo 0)" \
    "$(column_exists "roles" "role_scope" && echo 1 || echo 0)" \
    "$(column_exists "roles" "status" && echo 1 || echo 0)" \
    "$(column_exists "roles" "priority" && echo 1 || echo 0)" \
    "$(column_exists "roles" "data_scope_template" && echo 1 || echo 0)" \
    "$(column_exists "roles" "assignable" && echo 1 || echo 0)" \
    "$(column_exists "roles" "permissions" && echo 1 || echo 0)" \
    "$(column_exists "roles" "created_by" && echo 1 || echo 0)" \
    "$(column_exists "roles" "updated_by" && echo 1 || echo 0)"
  ensure_platform_user "$password_hash"
  ensure_platform_permissions
  ensure_platform_assignment

  log "bootstrap completed"
  print_summary || true
  log "login payload: {\"loginMode\":\"platform\",\"username\":\"${PLATFORM_USERNAME}\",\"password\":\"${PLATFORM_PASSWORD}\"}"
}

main "$@"
