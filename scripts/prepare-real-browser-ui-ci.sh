#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_BACKUP_FILE=""
RESTORE_ENV_ON_EXIT=0

log() {
  printf '[real-browser-ui-ci] %s\n' "$*"
}

backup_existing_env() {
  if [[ -f .env ]]; then
    ENV_BACKUP_FILE="$(mktemp "${TMPDIR:-/tmp}/smartfactory-real-browser-ui-env.XXXXXX")"
    cp .env "$ENV_BACKUP_FILE"
    RESTORE_ENV_ON_EXIT=1
    log "backed up existing .env to $ENV_BACKUP_FILE"
  fi
}

restore_existing_env() {
  if [[ "$RESTORE_ENV_ON_EXIT" -eq 1 && -n "$ENV_BACKUP_FILE" && -f "$ENV_BACKUP_FILE" ]]; then
    cp "$ENV_BACKUP_FILE" .env
    rm -f "$ENV_BACKUP_FILE"
    log "restored original .env"
  fi
}

write_ci_env() {
  if [[ -f .env ]]; then
    log "loading existing .env defaults"
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
  fi

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

trap restore_existing_env EXIT

backup_existing_env
write_ci_env

log "rebuilding local stack"
bash "$ROOT_DIR/scripts/redeploy-local.sh"

log "real-browser UI CI stack ready"
