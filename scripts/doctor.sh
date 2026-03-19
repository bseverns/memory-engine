#!/usr/bin/env sh
set -eu

# Operator doctor: check the deployment shape that most often causes confusing
# field failures before or during install.

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)

. "${SCRIPT_DIR}/_common.sh"

ENV_FILE="${REPO_ROOT}/.env"
ERRORS=0
WARNINGS=0

warn() {
  WARNINGS=$((WARNINGS + 1))
  printf '%s\n' "Warning: $*" >&2
}

record_error() {
  ERRORS=$((ERRORS + 1))
  printf '%s\n' "Error: $*" >&2
}

check_env_value() {
  key="$1"
  value=$(get_env_value "${ENV_FILE}" "${key}" || true)
  if [ -z "${value}" ]; then
    record_error "${key} is missing from .env"
    return
  fi
  info "OK: ${key} is set"
}

check_not_default() {
  key="$1"
  bad_value="$2"
  value=$(get_env_value "${ENV_FILE}" "${key}" || true)
  if [ "${value}" = "${bad_value}" ]; then
    record_error "${key} is still using the default value '${bad_value}'"
  fi
}

note_https_constraints() {
  site_address=$(get_env_value "${ENV_FILE}" "APP_SITE_ADDRESS" || true)
  tls_directive=$(get_env_value "${ENV_FILE}" "APP_TLS_DIRECTIVE" || true)
  csrf_origins=$(get_env_value "${ENV_FILE}" "DJANGO_CSRF_TRUSTED_ORIGINS" || true)

  if [ -z "${site_address}" ]; then
    warn "APP_SITE_ADDRESS is empty; Caddy will not have a clear public entrypoint."
    return
  fi

  case "${site_address}" in
    :*)
      warn "APP_SITE_ADDRESS=${site_address} is plain HTTP. Remote browsers will usually block microphone recording there."
      ;;
    *[0-9].[0-9]*)
      if [ -n "${tls_directive}" ]; then
        warn "IP-based HTTPS is configured with '${tls_directive}'. Recording can work only if the kiosk device trusts that certificate chain."
      else
        warn "APP_SITE_ADDRESS=${site_address} looks like an IP without TLS. Remote microphone capture will usually be blocked."
      fi
      ;;
    *)
      info "OK: APP_SITE_ADDRESS looks domain-based (${site_address})"
      ;;
  esac

  if [ -z "${csrf_origins}" ]; then
    record_error "DJANGO_CSRF_TRUSTED_ORIGINS is empty"
  else
    info "OK: DJANGO_CSRF_TRUSTED_ORIGINS is set"
  fi
}

check_compose_services() {
  compose_bin="$1"

  info "Compose services"
  if ! sh -c "${compose_bin} ps"; then
    record_error "docker compose ps failed"
    return
  fi

  if sh -c "${compose_bin} ps --services --filter status=running" | grep -qx "proxy"; then
    info "OK: proxy service is running"
  else
    warn "proxy service is not running"
  fi

  if sh -c "${compose_bin} ps --services --filter status=running" | grep -qx "api"; then
    info "OK: api service is running"
  else
    record_error "api service is not running"
    return
  fi

  health_payload=$(sh -c "${compose_bin} exec -T api curl -fsS http://localhost:8000/healthz" 2>/dev/null || true)
  if [ -z "${health_payload}" ]; then
    record_error "api is running but /healthz did not return success"
  else
    info "OK: /healthz responded"
    printf '%s\n' "${health_payload}"
    case "${health_payload}" in
      *'"storage":{"ok":true'*|*'"storage": {"ok": true'*)
        info "OK: healthz reports MinIO storage reachable from the API"
        ;;
      *)
        record_error "healthz did not report storage ok; MinIO reachability may be broken"
        ;;
    esac
  fi

  node_payload=$(sh -c "${compose_bin} exec -T api curl -fsS http://localhost:8000/api/v1/node/status" 2>/dev/null || true)
  if [ -z "${node_payload}" ]; then
    warn "Could not fetch /api/v1/node/status from inside the api container"
  else
    info "OK: /api/v1/node/status responded"
    printf '%s\n' "${node_payload}"
  fi
}

cd "${REPO_ROOT}"

info "Doctor: deployment and kiosk checks"

if [ ! -f "${ENV_FILE}" ]; then
  fail ".env is missing. Run scripts/first_boot.sh or copy .env.example first."
fi

info ""
info ".env checks"
check_env_value "DJANGO_SECRET_KEY"
check_env_value "POSTGRES_DB"
check_env_value "POSTGRES_USER"
check_env_value "POSTGRES_PASSWORD"
check_env_value "MINIO_ROOT_USER"
check_env_value "MINIO_ROOT_PASSWORD"
check_env_value "MINIO_ACCESS_KEY"
check_env_value "MINIO_SECRET_KEY"
check_env_value "DJANGO_ALLOWED_HOSTS"
check_env_value "DJANGO_CSRF_TRUSTED_ORIGINS"
check_not_default "DJANGO_SECRET_KEY" "dev-secret"
check_not_default "POSTGRES_PASSWORD" "postgres"
check_not_default "MINIO_ROOT_PASSWORD" "minioadmin"
check_not_default "MINIO_SECRET_KEY" "minioadmin"

info ""
info "Browser and HTTPS posture"
note_https_constraints

info ""
info "Compose and backend checks"
COMPOSE_BIN=$(detect_compose_bin)
check_compose_services "${COMPOSE_BIN}"

info ""
if [ "${ERRORS}" -gt 0 ]; then
  info "Doctor summary: ${ERRORS} error(s), ${WARNINGS} warning(s)."
  exit 1
fi

info "Doctor summary: no blocking errors, ${WARNINGS} warning(s)."
