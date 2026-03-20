#!/usr/bin/env sh
set -eu

# Publish the stack for a specific public host and write the host-related
# Django/Caddy settings into .env before bringing compose up.

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
ENV_FILE="${REPO_ROOT}/.env"
ENV_EXAMPLE="${REPO_ROOT}/.env.example"

. "${SCRIPT_DIR}/_common.sh"

PUBLIC_HOST=""
TLS_MODE="auto"
SKIP_BUILD=0

usage() {
  cat <<'EOF'
Usage:
  scripts/deploy.sh --public-host HOST [--tls auto|internal] [--skip-build]

Examples:
  scripts/deploy.sh --public-host 203.0.113.10
  scripts/deploy.sh --public-host 203.0.113.10 --tls internal
  scripts/deploy.sh --public-host memory.example.com

Behavior:
  - creates .env from .env.example if needed
  - writes the public host / CSRF / cookie settings into .env
  - refuses to deploy if obvious dev secrets are still present
  - runs docker compose up
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --public-host)
      [ "$#" -ge 2 ] || fail "--public-host requires a value"
      PUBLIC_HOST="$2"
      shift 2
      ;;
    --tls)
      [ "$#" -ge 2 ] || fail "--tls requires a value"
      TLS_MODE="$2"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=1
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

[ -n "${PUBLIC_HOST}" ] || fail "--public-host is required"
[ "${TLS_MODE}" = "auto" ] || [ "${TLS_MODE}" = "internal" ] || fail "--tls must be auto or internal"

case "${PUBLIC_HOST}" in
  http://*|https://*|*/*)
    fail "--public-host must be a bare host or IP without scheme or path"
    ;;
esac

COMPOSE_BIN=$(detect_compose_bin)

if [ ! -f "${ENV_FILE}" ]; then
  [ -f "${ENV_EXAMPLE}" ] || fail ".env.example not found"
  cp "${ENV_EXAMPLE}" "${ENV_FILE}"
  info "Created .env from .env.example"
fi

is_ipv4() {
  printf '%s' "$1" | awk -F. '
    NF != 4 { exit 1 }
    {
      for (i = 1; i <= 4; i++) {
        if ($i !~ /^[0-9]+$/) exit 1
        if ($i < 0 || $i > 255) exit 1
      }
    }
  '
}

build_allowed_hosts() {
  host="$1"
  printf '%s\n' "${host},localhost,127.0.0.1"
}

if [ "${TLS_MODE}" = "internal" ]; then
  APP_TLS_DIRECTIVE="tls internal"
  EXTERNAL_SCHEME="https"
  SECURE_FLAG="1"
else
  APP_TLS_DIRECTIVE=""
  if is_ipv4 "${PUBLIC_HOST}"; then
    EXTERNAL_SCHEME="http"
    SECURE_FLAG="0"
  else
    EXTERNAL_SCHEME="https"
    SECURE_FLAG="1"
  fi
fi

DJANGO_ALLOWED_HOSTS=$(build_allowed_hosts "${PUBLIC_HOST}")
DJANGO_CSRF_TRUSTED_ORIGINS="${EXTERNAL_SCHEME}://${PUBLIC_HOST},http://localhost,http://127.0.0.1"

upsert_env_value "${ENV_FILE}" DJANGO_DEBUG 0
upsert_env_value "${ENV_FILE}" DEV_CREATE_SUPERUSER 0
upsert_env_value "${ENV_FILE}" APP_SITE_ADDRESS "${PUBLIC_HOST}"
upsert_env_value "${ENV_FILE}" APP_TLS_DIRECTIVE "${APP_TLS_DIRECTIVE}"
upsert_env_value "${ENV_FILE}" DJANGO_ALLOWED_HOSTS "${DJANGO_ALLOWED_HOSTS}"
upsert_env_value "${ENV_FILE}" DJANGO_CSRF_TRUSTED_ORIGINS "${DJANGO_CSRF_TRUSTED_ORIGINS}"
upsert_env_value "${ENV_FILE}" DJANGO_SECURE_SSL_REDIRECT "${SECURE_FLAG}"
upsert_env_value "${ENV_FILE}" DJANGO_SESSION_COOKIE_SECURE "${SECURE_FLAG}"
upsert_env_value "${ENV_FILE}" DJANGO_CSRF_COOKIE_SECURE "${SECURE_FLAG}"

require_not_default() {
  key="$1"
  current_value=$(get_env_value "${ENV_FILE}" "${key}")
  [ -n "${current_value}" ] || fail "${key} is empty in .env"
  shift
  for disallowed in "$@"; do
    if [ "${current_value}" = "${disallowed}" ]; then
      fail "${key} is still set to a development default in .env"
    fi
  done
}

require_not_default DJANGO_SECRET_KEY "dev-secret-change-me" "dev-secret"
require_not_default OPS_SHARED_SECRET "change-me-ops-secret"
require_not_default POSTGRES_PASSWORD "memory_engine"
require_not_default MINIO_ROOT_PASSWORD "minioadmin123"
require_not_default MINIO_SECRET_KEY "minioadmin123"

info "Using public host: ${PUBLIC_HOST}"
info "TLS mode: ${TLS_MODE}"
info "External URL: ${EXTERNAL_SCHEME}://${PUBLIC_HOST}/kiosk/"

cd "${REPO_ROOT}"

if [ "${SKIP_BUILD}" -eq 1 ]; then
  sh -c "${COMPOSE_BIN} up -d"
else
  sh -c "${COMPOSE_BIN} up --build -d"
fi

sh -c "${COMPOSE_BIN} ps"

info "Deployment finished."
info "Kiosk URL: ${EXTERNAL_SCHEME}://${PUBLIC_HOST}/kiosk/"
if [ "${EXTERNAL_SCHEME}" = "http" ]; then
  info "Note: browser microphone access may still be blocked over plain HTTP on a remote IP."
fi
