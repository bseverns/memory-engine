#!/usr/bin/env sh
set -eu

# Summarize compose service state and the backend readiness payload so operators
# can answer "is the stack up?" without reconstructing commands from memory.

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)

. "${SCRIPT_DIR}/_common.sh"

TAIL_LINES=40
LOG_SERVICE=""

usage() {
  cat <<'EOF'
Usage:
  scripts/status.sh [--logs SERVICE] [--tail N]

Examples:
  scripts/status.sh
  scripts/status.sh --logs api
  scripts/status.sh --logs worker --tail 80

Behavior:
  - prints docker compose service status
  - prints /healthz and /readyz from inside the api container when available
  - optionally tails logs for one service
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --logs)
      [ "$#" -ge 2 ] || fail "--logs requires a service name"
      LOG_SERVICE="$2"
      shift 2
      ;;
    --tail)
      [ "$#" -ge 2 ] || fail "--tail requires a number"
      TAIL_LINES="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

COMPOSE_BIN=$(detect_compose_bin)

cd "${REPO_ROOT}"

info "Compose services"
sh -c "${COMPOSE_BIN} ps"

printf '\n'
info "API health"
if sh -c "${COMPOSE_BIN} ps --services --filter status=running" | grep -qx "api"; then
  if sh -c "${COMPOSE_BIN} exec -T api curl -fsS http://localhost:8000/healthz"; then
    :
  else
    info "The api container is running, but /healthz did not return success."
  fi
  printf '\n'
  info "Cluster readiness"
  if sh -c "${COMPOSE_BIN} exec -T api curl -fsS http://localhost:8000/readyz"; then
    :
  else
    info "The api container is running, but /readyz did not return success."
  fi
else
  info "The api container is not currently running."
fi

if [ -n "${LOG_SERVICE}" ]; then
  printf '\n'
  info "Recent logs for ${LOG_SERVICE}"
  sh -c "${COMPOSE_BIN} logs --tail ${TAIL_LINES} ${LOG_SERVICE}"
fi
