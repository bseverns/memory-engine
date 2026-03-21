#!/usr/bin/env sh
set -eu

# Disposable compose-backed release proof:
# - boots an isolated stack on non-default ports
# - waits for /healthz and /readyz
# - runs the browser release smoke flow
# - tears the disposable stack down unless asked to keep it

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)

. "${SCRIPT_DIR}/_common.sh"

ENV_FILE="${REPO_ROOT}/.env"
ENV_EXAMPLE_FILE="${REPO_ROOT}/.env.example"
PROJECT_NAME="memory_engine_release_smoke"
BASE_URL="http://127.0.0.1:18080"
OPS_SECRET="${RELEASE_SMOKE_OPS_SECRET:-test-ops-secret}"
KEEP_UP=0
GENERATED_ENV=0

usage() {
  cat <<'EOF'
Usage:
  scripts/release_smoke.sh [--keep-up]

Behavior:
  - starts an isolated compose project on localhost:18080
  - waits for /healthz and /readyz through the proxy
  - runs the Playwright release smoke spec against that live stack
  - tears the disposable project down unless --keep-up is passed
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --keep-up)
      KEEP_UP=1
      shift
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

if [ ! -f "${ENV_FILE}" ]; then
  if [ -f "${ENV_EXAMPLE_FILE}" ]; then
    info ".env is missing; generating a temporary smoke env from .env.example"
    cp "${ENV_EXAMPLE_FILE}" "${ENV_FILE}"
    GENERATED_ENV=1
  else
    fail ".env is missing. Copy .env.example first."
  fi
fi

cd "${REPO_ROOT}"

COMPOSE_BIN=$(detect_compose_bin)

compose_smoke() {
  run_compose -p "${PROJECT_NAME}" -f docker-compose.yml -f docker-compose.release-smoke.yml "$@"
}

cleanup() {
  if [ "${GENERATED_ENV}" -eq 1 ]; then
    rm -f "${ENV_FILE}"
  fi
  if [ "${KEEP_UP}" -eq 1 ]; then
    info "Keeping disposable smoke stack running under project ${PROJECT_NAME}."
    return
  fi
  info "Tearing down disposable smoke stack"
  compose_smoke down -v --remove-orphans >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

wait_for_url() {
  label="$1"
  url="$2"
  attempts="${3:-60}"
  delay_seconds="${4:-2}"
  attempt=1
  while [ "${attempt}" -le "${attempts}" ]; do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      info "OK: ${label}"
      return 0
    fi
    sleep "${delay_seconds}"
    attempt=$((attempt + 1))
  done
  fail "${label} did not become ready at ${url}"
}

info "Resetting disposable smoke project"
compose_smoke down -v --remove-orphans >/dev/null 2>&1 || true

info "Starting disposable smoke stack"
compose_smoke up -d --build

info "Waiting for narrow API health"
wait_for_url "/healthz" "${BASE_URL}/healthz" 60 2

info "Waiting for broader cluster readiness"
wait_for_url "/readyz" "${BASE_URL}/readyz" 60 2

info "Running release smoke browser flow"
PLAYWRIGHT_DISABLE_WEBSERVER=1 \
PLAYWRIGHT_BASE_URL="${BASE_URL}" \
PLAYWRIGHT_OPS_SECRET="${OPS_SECRET}" \
npm run test:browser -- browser-tests/release-smoke.spec.js --project=chromium

info "Release smoke passed."
