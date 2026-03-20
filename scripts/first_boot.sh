#!/usr/bin/env sh
set -eu

# Stamp out development defaults in .env and optionally hand off to deploy.sh.

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
ENV_FILE="${REPO_ROOT}/.env"
ENV_EXAMPLE="${REPO_ROOT}/.env.example"

. "${SCRIPT_DIR}/_common.sh"

PUBLIC_HOST=""
TLS_MODE="auto"
NODE_NAME_VALUE=""
NODE_LOCATION_VALUE=""
RUN_DEPLOY=0

usage() {
  cat <<'EOF'
Usage:
  scripts/first_boot.sh --public-host HOST [--tls auto|internal] [--node-name NAME] [--node-location TEXT] [--deploy]

Examples:
  scripts/first_boot.sh --public-host 203.0.113.10 --deploy
  scripts/first_boot.sh --public-host 203.0.113.10 --tls internal --node-name "Room Memory"
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
    --node-name)
      [ "$#" -ge 2 ] || fail "--node-name requires a value"
      NODE_NAME_VALUE="$2"
      shift 2
      ;;
    --node-location)
      [ "$#" -ge 2 ] || fail "--node-location requires a value"
      NODE_LOCATION_VALUE="$2"
      shift 2
      ;;
    --deploy)
      RUN_DEPLOY=1
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

if [ ! -f "${ENV_FILE}" ]; then
  [ -f "${ENV_EXAMPLE}" ] || fail ".env.example not found"
  cp "${ENV_EXAMPLE}" "${ENV_FILE}"
  printf '%s\n' "Created .env from .env.example"
fi

generate_secret() {
  python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(36))
PY
}

ensure_secret() {
  key="$1"
  current_value=$(get_env_value "${ENV_FILE}" "${key}")
  shift
  needs_update=0

  if [ -z "${current_value}" ]; then
    needs_update=1
  else
    for default_value in "$@"; do
      if [ "${current_value}" = "${default_value}" ]; then
        needs_update=1
      fi
    done
  fi

  if [ "${needs_update}" -eq 1 ]; then
    upsert_env_value "${ENV_FILE}" "${key}" "$(generate_secret)"
    printf '%s\n' "Generated ${key}"
  fi
}

ensure_secret DJANGO_SECRET_KEY "dev-secret-change-me" "dev-secret"
ensure_secret OPS_SHARED_SECRET "change-me-ops-secret"
ensure_secret POSTGRES_PASSWORD "memory_engine"
ensure_secret MINIO_ROOT_PASSWORD "minioadmin123"
ensure_secret MINIO_SECRET_KEY "minioadmin123"

if [ "$(get_env_value "${ENV_FILE}" MINIO_ACCESS_KEY)" = "minioadmin" ] || [ -z "$(get_env_value "${ENV_FILE}" MINIO_ACCESS_KEY)" ]; then
  upsert_env_value "${ENV_FILE}" MINIO_ACCESS_KEY "memoryengine"
fi

if [ "$(get_env_value "${ENV_FILE}" MINIO_ROOT_USER)" = "minioadmin" ] || [ -z "$(get_env_value "${ENV_FILE}" MINIO_ROOT_USER)" ]; then
  upsert_env_value "${ENV_FILE}" MINIO_ROOT_USER "memoryengine"
fi

if [ -z "$(get_env_value "${ENV_FILE}" DEV_SUPERUSER_PASSWORD)" ] || [ "$(get_env_value "${ENV_FILE}" DEV_SUPERUSER_PASSWORD)" = "admin" ]; then
  upsert_env_value "${ENV_FILE}" DEV_SUPERUSER_PASSWORD "$(generate_secret)"
fi

if [ -n "${NODE_NAME_VALUE}" ]; then
  upsert_env_value "${ENV_FILE}" NODE_NAME "${NODE_NAME_VALUE}"
fi

if [ -n "${NODE_LOCATION_VALUE}" ]; then
  upsert_env_value "${ENV_FILE}" NODE_LOCATION_HINT "${NODE_LOCATION_VALUE}"
fi

printf '%s\n' "Initial secret and node configuration complete."
printf '%s\n' "Next step:"
printf '  %s\n' "./scripts/deploy.sh --public-host ${PUBLIC_HOST} --tls ${TLS_MODE}"

if [ "${RUN_DEPLOY}" -eq 1 ]; then
  exec "${REPO_ROOT}/scripts/deploy.sh" --public-host "${PUBLIC_HOST}" --tls "${TLS_MODE}"
fi
