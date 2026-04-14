#!/usr/bin/env bash
# =============================================================================
# 数据库迁移脚本
# 按文件名排序依次执行 services/api/src/migrations/*.sql
#
# 使用方式:
#   bash infra/db/migrate.sh              # 使用 .env 中的数据库配置
#   DB_HOST=127.0.0.1 bash infra/db/migrate.sh  # 覆盖单个变量
#
# 幂等保证:
#   migration_history 表记录已执行的迁移文件名，跳过重复执行
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATIONS_DIR="$PROJECT_ROOT/services/api/src/migrations"

# 从 .env 加载环境变量（如果存在且未被覆盖）
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  source "$PROJECT_ROOT/.env"
  set +a
fi

# Docker Compose 容器内默认走 mysql:3306；宿主机直接执行时回退到 127.0.0.1:3307
DB_HOST="${DB_HOST:-mysql}"
DB_PORT="${DB_PORT:-3306}"
DB_HOST_FALLBACK="${DB_HOST_FALLBACK:-127.0.0.1}"
DB_PORT_FALLBACK="${DB_PORT_FALLBACK:-3307}"
DB_NAME="${DB_NAME:-smart_factory}"
DB_USER="${DB_USER:-sf_app}"
DB_PASS="${DB_PASS:-}"

# 使用 MYSQL_PWD 环境变量传递密码，避免命令行暴露（ENV-01）
export MYSQL_PWD="$DB_PASS"

build_mysql_cmd() {
  MYSQL_CMD="mysql -h $DB_HOST -P $DB_PORT -u $DB_USER"
}

build_mysql_cmd

echo "=== Database Migration ==="
echo "Host: $DB_HOST:$DB_PORT  DB: $DB_NAME"

# 等待数据库就绪（最多 30 秒）
ready=0
for i in $(seq 1 6); do
  if $MYSQL_CMD -e "SELECT 1" "$DB_NAME" > /dev/null 2>&1; then
    ready=1
    break
  fi
  if [ "$i" = "3" ] && [ "${DB_HOST:-mysql}" = "mysql" ] && [ "${DB_PORT:-3306}" = "3306" ]; then
    DB_HOST="$DB_HOST_FALLBACK"
    DB_PORT="$DB_PORT_FALLBACK"
    build_mysql_cmd
    echo "Switching to host fallback: $DB_HOST:$DB_PORT"
  fi
  echo "Waiting for MySQL... ($i/6)"
  sleep 5
done

if [ "$ready" != "1" ]; then
  echo "Failed to connect to MySQL at $DB_HOST:$DB_PORT"
  exit 1
fi

# 创建迁移记录表（幂等）
$MYSQL_CMD "$DB_NAME" <<'SQL'
CREATE TABLE IF NOT EXISTS migration_history (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  filename    VARCHAR(255) NOT NULL UNIQUE,
  applied_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
SQL

# 检查迁移目录
if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "No migrations directory found: $MIGRATIONS_DIR"
  exit 0
fi

# 按文件名排序执行
applied=0
skipped=0

for sql_file in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
  filename="$(basename "$sql_file")"

  # 检查是否已执行
  exists=$($MYSQL_CMD -N -e "SELECT COUNT(*) FROM migration_history WHERE filename='$filename'" "$DB_NAME" 2>/dev/null)

  if [ "$exists" = "1" ]; then
    skipped=$((skipped + 1))
    continue
  fi

  echo "Applying: $filename ..."
  $MYSQL_CMD "$DB_NAME" < "$sql_file"

  # 记录已执行
  $MYSQL_CMD -e "INSERT INTO migration_history (filename) VALUES ('$filename')" "$DB_NAME"
  applied=$((applied + 1))
  echo "  ✓ Done"
done

echo "=== Migration complete: $applied applied, $skipped skipped ==="
