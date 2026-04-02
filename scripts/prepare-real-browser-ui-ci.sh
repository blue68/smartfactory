#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

log() {
  printf '[real-browser-ui-ci] %s\n' "$*"
}

write_ci_env() {
  log "writing CI .env"
  cat > .env <<EOF
APP_NAME=${APP_NAME:-SmartFactory}
WEB_PORT=${WEB_PORT:-80}
LOG_LEVEL=${LOG_LEVEL:-info}
DB_ROOT_PASSWORD=${DB_ROOT_PASSWORD:-ci_root_password_2026}
DB_NAME=${DB_NAME:-smart_factory}
DB_USER=${DB_USER:-sf_app}
DB_PASS=${DB_PASS:-ci_db_password_2026}
DB_POOL_SIZE=${DB_POOL_SIZE:-10}
REDIS_PASSWORD=${REDIS_PASSWORD:-ci_redis_password_2026}
JWT_SECRET=${JWT_SECRET:-ci-test-secret-do-not-use-in-prod-32c}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET:-ci-test-refresh-secret-32chars}
JWT_EXPIRES_IN=${JWT_EXPIRES_IN:-7d}
CORS_ORIGINS=${CORS_ORIGINS:-http://localhost}
AI_ENGINE_URL=${AI_ENGINE_URL:-}
OPENAI_API_KEY=${OPENAI_API_KEY:-}
EOF
}

write_ci_env

log "rebuilding local stack"
bash "$ROOT_DIR/scripts/redeploy-local.sh"

log "real-browser UI CI stack ready"
