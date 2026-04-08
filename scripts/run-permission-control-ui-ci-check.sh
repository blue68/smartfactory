#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-smoke}"

log() {
  printf '[permission-control-ui-ci-check] %s\n' "$*"
}

cleanup_stack() {
  (
    cd "$ROOT_DIR"
    docker compose down -v >/dev/null 2>&1 || true
  )
  log "local stack cleaned"
}

run_check() {
  local mode="$1"

  trap cleanup_stack EXIT

  cd "$ROOT_DIR"

  log "preparing real-browser UI stack"
  bash "$ROOT_DIR/scripts/prepare-real-browser-ui-ci.sh"

  log "verifying platform_super_admin bootstrap"
  npm run test:permission-control:bootstrap

  log "running permission-control ${mode} suite"
  case "$mode" in
    smoke)
      npm run test:permission-control:ui:smoke
      ;;
    regression)
      npm run test:permission-control:ui:regression
      ;;
    full)
      npm run test:permission-control:ui
      ;;
    *)
      log "unsupported mode: $mode"
      log "expected one of: smoke | regression | full"
      return 1
      ;;
  esac

  log "permission-control ${mode} suite passed"
}

run_check "$MODE"
