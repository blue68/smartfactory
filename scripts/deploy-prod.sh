#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.prod.yml)
APP_REF="${1:-}"
SKIP_FETCH="${SKIP_FETCH:-0}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-180}"

log() {
  printf '[deploy-prod] %s\n' "$*"
}

die() {
  printf '[deploy-prod] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

wait_container_healthy() {
  local name="$1"
  local timeout="$2"
  local waited=0

  while (( waited < timeout )); do
    local state
    state="$(docker inspect -f '{{.State.Status}}' "$name" 2>/dev/null || true)"
    if [[ "$state" != "running" ]]; then
      sleep 5
      waited=$((waited + 5))
      continue
    fi

    local health
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name" 2>/dev/null || true)"
    if [[ "$health" == "healthy" || "$health" == "none" ]]; then
      log "$name is $state/$health"
      return 0
    fi

    sleep 5
    waited=$((waited + 5))
  done

  docker ps -a --filter "name=^${name}$" --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
  die "timeout waiting for $name to become healthy"
}

check_required_env() {
  local required_vars=(
    DB_ROOT_PASSWORD
    DB_NAME
    DB_USER
    DB_PASS
    REDIS_PASSWORD
    JWT_SECRET
    JWT_REFRESH_SECRET
  )

  local var
  for var in "${required_vars[@]}"; do
    if [[ -z "${!var:-}" ]]; then
      die "missing required env: $var"
    fi
  done

  if [[ "${FILE_STORAGE_DRIVER:-local}" == "oss" ]]; then
    local oss_vars=(
      OSS_ACCESS_KEY_ID
      OSS_ACCESS_KEY_SECRET
      OSS_BUCKET
      OSS_ENDPOINT
    )
    for var in "${oss_vars[@]}"; do
      if [[ -z "${!var:-}" ]]; then
        die "FILE_STORAGE_DRIVER=oss requires $var"
      fi
    done
  fi
}

ensure_clean_checkout() {
  local status
  status="$(git status --porcelain)"
  if [[ -n "$status" ]]; then
    die "working tree is dirty; commit or stash changes before switching refs"
  fi
}

checkout_ref_if_needed() {
  local ref="$1"
  [[ -z "$ref" ]] && return 0

  ensure_clean_checkout

  if [[ "$SKIP_FETCH" != "1" ]]; then
    log "fetching latest refs and tags"
    git fetch origin --tags
  fi

  log "checking out $ref"
  git checkout "$ref"
}

compose() {
  docker compose "${COMPOSE_FILES[@]}" "$@"
}

show_release_context() {
  log "project root: $ROOT_DIR"
  log "current ref: $(git rev-parse --short HEAD)"
  log "docker compose files: ${COMPOSE_FILES[*]}"
  log "file storage driver: ${FILE_STORAGE_DRIVER:-local}"
  log "web port: ${WEB_PORT:-80}"
}

main() {
  require_command git
  require_command docker
  require_command bash
  require_command curl

  [[ -f "$ROOT_DIR/.env" ]] || die ".env not found; copy .env.example to .env first"

  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a

  checkout_ref_if_needed "$APP_REF"
  check_required_env
  show_release_context

  log "starting mysql and redis"
  compose up -d mysql redis
  wait_container_healthy "sf_mysql" "$HEALTH_TIMEOUT_SECONDS"
  wait_container_healthy "sf_redis" "$HEALTH_TIMEOUT_SECONDS"

  log "running database migrations"
  bash "$ROOT_DIR/infra/db/migrate.sh"

  log "building and starting api/web"
  compose up -d --build api web
  wait_container_healthy "sf_api" "$HEALTH_TIMEOUT_SECONDS"
  wait_container_healthy "sf_web" "$HEALTH_TIMEOUT_SECONDS"

  log "health checks"
  curl -fsS "http://127.0.0.1:${WEB_PORT:-80}/health" >/dev/null
  docker exec sf_api wget -qO- http://127.0.0.1:3000/health >/dev/null

  log "deployment complete"
  log "next: open docs/consumable-fixed-asset-final-release-checklist.md and run production smoke checks"
}

main "$@"
