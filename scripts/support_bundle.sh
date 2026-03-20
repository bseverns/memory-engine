#!/usr/bin/env sh
set -eu

# Gather the operator-facing diagnostics that are safe to hand off for remote
# troubleshooting without giving direct server access.

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
ENV_FILE="${REPO_ROOT}/.env"
SUPPORT_ROOT="${REPO_ROOT}/support-bundles"
TAIL_LINES=200

. "${SCRIPT_DIR}/_common.sh"

usage() {
  cat <<'EOF'
Usage:
  scripts/support_bundle.sh [--tail N]

Behavior:
  - captures compose status, doctor output, health JSON, and recent service logs
  - writes a redacted .env snapshot when available
  - packages the result into support-bundles/
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --tail)
      [ "$#" -ge 2 ] || fail "--tail requires a value"
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
STAMP=$(date +"%Y%m%d-%H%M%S")
BUNDLE_DIR="${SUPPORT_ROOT}/memory-engine-support-${STAMP}"
ARCHIVE_PATH="${BUNDLE_DIR}.tgz"

mkdir -p "${BUNDLE_DIR}/logs"

run_compose ps > "${BUNDLE_DIR}/compose-ps.txt" 2>&1 || true
"${REPO_ROOT}/scripts/status.sh" > "${BUNDLE_DIR}/status.txt" 2>&1 || true
"${REPO_ROOT}/scripts/doctor.sh" > "${BUNDLE_DIR}/doctor.txt" 2>&1 || true

if [ -f "${ENV_FILE}" ]; then
  write_redacted_env "${ENV_FILE}" "${BUNDLE_DIR}/env.redacted"
fi

if compose_service_running "api"; then
  run_compose exec -T api curl -fsS http://localhost:8000/healthz > "${BUNDLE_DIR}/healthz.json" 2>&1 || true
fi

for service_name in api worker beat proxy db redis minio; do
  run_compose logs --tail "${TAIL_LINES}" "${service_name}" > "${BUNDLE_DIR}/logs/${service_name}.log" 2>&1 || true
done

cat > "${BUNDLE_DIR}/manifest.txt" <<EOF
created_at=${STAMP}
log_tail_lines=${TAIL_LINES}
includes_redacted_env=$( [ -f "${BUNDLE_DIR}/env.redacted" ] && printf 'yes' || printf 'no' )
EOF

tar -C "${SUPPORT_ROOT}" -czf "${ARCHIVE_PATH}" "$(basename "${BUNDLE_DIR}")"

log_operator_event "support_bundle.created" "support-bundle-script" "Created support bundle ${ARCHIVE_PATH}"

info "Support bundle created: ${ARCHIVE_PATH}"
