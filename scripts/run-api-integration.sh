#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT_DIR/services/api"
API_LOG_FILE="${API_LOG_FILE:-/tmp/sf-api-integration.log}"
REUSE_EXISTING_API="${REUSE_EXISTING_API:-0}"
TEST_DEFAULT_TARGET="${TEST_DEFAULT_TARGET:-tests/integration/}"
STARTED_API=0
API_PID=""
PORT=""
API_URL=""
HEALTH_URL=""

log() {
  printf '[api-integration] %s\n' "$*"
}

load_repo_env() {
  if [[ -f "$ROOT_DIR/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT_DIR/.env"
    set +a
  fi
}

prepare_env() {
  export NODE_ENV="${NODE_ENV:-test}"
  export PORT="${PORT:-3100}"
  export DB_HOST="${DB_HOST:-127.0.0.1}"
  export DB_PORT="${DB_PORT:-3307}"
  export DB_USER="${DB_USER:-sf_app}"
  export DB_PASSWORD="${DB_PASSWORD:-${DB_PASS:-TestApp2026!Secure}}"
  export DB_PASS="${DB_PASS:-$DB_PASSWORD}"
  export DB_NAME="${DB_NAME:-smart_factory}"
  export JWT_SECRET="${JWT_SECRET:-local-test-jwt-secret-key-2026-smartfactory-at-least-32-chars}"
  export TEST_JWT_SECRET="${TEST_JWT_SECRET:-$JWT_SECRET}"
  API_URL="${TEST_API_URL:-http://localhost:${PORT}}"
  HEALTH_URL="${API_URL%/}/health"
  export TEST_API_URL="$API_URL"
  export UPLOAD_DIR="${UPLOAD_DIR:-/tmp/uploads}"
}

cleanup() {
  if [[ "$STARTED_API" -eq 1 && -n "$API_PID" ]]; then
    log "stopping local API (pid=$API_PID)"
    kill "$API_PID" >/dev/null 2>&1 || true
    wait "$API_PID" >/dev/null 2>&1 || true
  fi
}

wait_for_health() {
  local retries="${1:-60}"
  local delay_seconds="${2:-1}"

  for _ in $(seq 1 "$retries"); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay_seconds"
  done

  return 1
}

start_api_if_needed() {
  if [[ "$REUSE_EXISTING_API" == "1" ]] && curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    log "using existing API at $API_URL"
    return 0
  fi

  log "building API"
  (
    cd "$API_DIR"
    npm run build
  )

  log "starting API on $API_URL"
  (
    cd "$API_DIR"
    node dist/index.js
  ) >"$API_LOG_FILE" 2>&1 &
  API_PID="$!"
  STARTED_API=1

  if wait_for_health 60 1; then
    log "API is healthy"
    return 0
  fi

  log "API failed to become healthy, recent log:"
  tail -n 120 "$API_LOG_FILE" || true
  return 1
}

run_jest() {
  local timeout="${TEST_TIMEOUT_MS:-60000}"
  local -a args=("$@")

  if [[ "${#args[@]}" -eq 0 ]]; then
    args=("$TEST_DEFAULT_TARGET")
  fi

  (
    cd "$API_DIR"
    npx jest "${args[@]}" --runInBand --testTimeout="$timeout"
  )
}

trap cleanup EXIT

load_repo_env
prepare_env
mkdir -p "$UPLOAD_DIR"
start_api_if_needed

log "running integration tests against $API_URL"
run_jest "$@"
