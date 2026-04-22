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

check_known_value() {
  key="$1"
  value="$2"
  allowed_values="$3"
  [ -n "${value}" ] || {
    record_error "${key} is missing from .env"
    return
  }

  for candidate in ${allowed_values}; do
    if [ "${candidate}" = "${value}" ]; then
      info "OK: ${key}=${value}"
      return
    fi
  done

  record_error "${key}=${value} is not recognized (${allowed_values})"
}

csv_has_value() {
  csv="$1"
  needle="$2"
  old_ifs=$IFS
  IFS=','
  for value in ${csv}; do
    trimmed=$(printf '%s' "${value}" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
    if [ "${trimmed}" = "${needle}" ]; then
      IFS=$old_ifs
      return 0
    fi
  done
  IFS=$old_ifs
  return 1
}

parse_site_host() {
  site_address="$1"
  printf '%s' "${site_address}" | sed 's#^[^:]*://##; s#/.*$##; s/:.*$##'
}

infer_tls_mode() {
  site_address=$(get_env_value "${ENV_FILE}" "APP_SITE_ADDRESS" || true)
  tls_directive=$(get_env_value "${ENV_FILE}" "APP_TLS_DIRECTIVE" || true)

  case "${site_address}" in
    https://*)
      printf '%s\n' "1"
      return
      ;;
    http://*)
      printf '%s\n' "0"
      return
      ;;
    :*|"")
      printf '%s\n' "0"
      return
      ;;
  esac

  if [ -n "${tls_directive}" ]; then
    printf '%s\n' "1"
    return
  fi

  site_host=$(parse_site_host "${site_address}")
  if printf '%s\n' "${site_host}" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
    printf '%s\n' "0"
    return
  fi

  printf '%s\n' "1"
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

check_public_host_alignment() {
  site_address=$(get_env_value "${ENV_FILE}" "APP_SITE_ADDRESS" || true)
  allowed_hosts=$(get_env_value "${ENV_FILE}" "DJANGO_ALLOWED_HOSTS" || true)
  csrf_origins=$(get_env_value "${ENV_FILE}" "DJANGO_CSRF_TRUSTED_ORIGINS" || true)

  case "${site_address}" in
    ""|:*)
      return
      ;;
  esac

  site_host=$(parse_site_host "${site_address}")
  [ -n "${site_host}" ] || {
    warn "Could not parse APP_SITE_ADDRESS host from '${site_address}'"
    return
  }

  if ! csv_has_value "${allowed_hosts}" "*" && ! csv_has_value "${allowed_hosts}" "${site_host}"; then
    record_error "DJANGO_ALLOWED_HOSTS does not include APP_SITE_ADDRESS host '${site_host}'"
  else
    info "OK: DJANGO_ALLOWED_HOSTS includes ${site_host}"
  fi

  tls_mode=$(infer_tls_mode)
  scheme="http"
  if [ "${tls_mode}" = "1" ]; then
    scheme="https"
  fi

  case "${site_address}" in
    http://*|https://*)
      expected_origin=$(printf '%s' "${site_address}" | sed 's#/$##')
      ;;
    *)
      expected_origin="${scheme}://${site_address}"
      ;;
  esac

  if ! csv_has_value "${csrf_origins}" "${expected_origin}"; then
    record_error "DJANGO_CSRF_TRUSTED_ORIGINS does not include expected origin '${expected_origin}'"
  else
    info "OK: DJANGO_CSRF_TRUSTED_ORIGINS includes ${expected_origin}"
  fi
}

check_tls_cookie_alignment() {
  tls_mode=$(infer_tls_mode)
  secure_redirect=$(get_env_value "${ENV_FILE}" "DJANGO_SECURE_SSL_REDIRECT" || true)
  session_secure=$(get_env_value "${ENV_FILE}" "DJANGO_SESSION_COOKIE_SECURE" || true)
  csrf_secure=$(get_env_value "${ENV_FILE}" "DJANGO_CSRF_COOKIE_SECURE" || true)

  if [ "${tls_mode}" = "1" ]; then
    [ "${secure_redirect}" = "1" ] || record_error "DJANGO_SECURE_SSL_REDIRECT should be 1 when TLS mode is expected"
    [ "${session_secure}" = "1" ] || record_error "DJANGO_SESSION_COOKIE_SECURE should be 1 when TLS mode is expected"
    [ "${csrf_secure}" = "1" ] || record_error "DJANGO_CSRF_COOKIE_SECURE should be 1 when TLS mode is expected"
  else
    [ "${secure_redirect}" = "1" ] && warn "DJANGO_SECURE_SSL_REDIRECT=1 while APP_SITE_ADDRESS is not in TLS mode"
    [ "${session_secure}" = "1" ] && warn "DJANGO_SESSION_COOKIE_SECURE=1 while APP_SITE_ADDRESS is not in TLS mode"
    [ "${csrf_secure}" = "1" ] && warn "DJANGO_CSRF_COOKIE_SECURE=1 while APP_SITE_ADDRESS is not in TLS mode"
  fi
}

check_image_posture() {
  minio_server_image=$(get_env_value "${ENV_FILE}" "MINIO_SERVER_IMAGE" || true)
  minio_mc_image=$(get_env_value "${ENV_FILE}" "MINIO_MC_IMAGE" || true)
  caddy_image=$(get_env_value "${ENV_FILE}" "CADDY_IMAGE" || true)
  postgres_image=$(get_env_value "${ENV_FILE}" "POSTGRES_IMAGE" || true)
  redis_image=$(get_env_value "${ENV_FILE}" "REDIS_IMAGE" || true)

  for pair in \
    "MINIO_SERVER_IMAGE:${minio_server_image}" \
    "MINIO_MC_IMAGE:${minio_mc_image}"; do
    key=$(printf '%s' "${pair}" | cut -d: -f1)
    value=$(printf '%s' "${pair}" | cut -d: -f2-)
    if [ -z "${value}" ]; then
      warn "${key} is not set in .env"
      continue
    fi
    case "${value}" in
      *:latest)
        record_error "${key} uses ':latest' (${value}); pin this to an explicit release tag"
        ;;
      *)
        info "OK: ${key} is pinned to ${value}"
        ;;
    esac
  done

  [ "${caddy_image}" = "caddy:2" ] && warn "CADDY_IMAGE is using a broad major tag (caddy:2). Prefer a pinned patch tag."
  [ "${postgres_image}" = "postgres:16" ] && warn "POSTGRES_IMAGE is using a broad major tag (postgres:16). Prefer a pinned patch tag."
  [ "${redis_image}" = "redis:7" ] && warn "REDIS_IMAGE is using a broad major tag (redis:7). Prefer a pinned patch tag."
}

check_presence_sensor_posture() {
  presence_enabled=$(get_env_value "${ENV_FILE}" "PRESENCE_SENSING_ENABLED" || true)
  case "$(printf '%s' "${presence_enabled}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on)
      ;;
    *)
      info "OK: presence sensing is disabled in .env"
      return
      ;;
  esac

  camera_device=$(get_env_value "${ENV_FILE}" "PRESENCE_CAMERA_DEVICE" || true)
  camera_source=$(get_env_value "${ENV_FILE}" "PRESENCE_CAMERA_SOURCE" || true)

  if [ -z "${camera_device}" ]; then
    record_error "PRESENCE_CAMERA_DEVICE is required when presence sensing is enabled"
  elif printf '%s' "${camera_device}" | grep -Eq '^[0-9]+$'; then
    record_error "PRESENCE_CAMERA_DEVICE=${camera_device} looks numeric; compose device mapping expects a host path like /dev/video0"
  elif printf '%s' "${camera_device}" | grep -Eq '^/'; then
    info "OK: PRESENCE_CAMERA_DEVICE looks like a host device path (${camera_device})"
  else
    warn "PRESENCE_CAMERA_DEVICE=${camera_device} does not look like an absolute device path"
  fi

  if [ -z "${camera_source}" ]; then
    warn "PRESENCE_CAMERA_SOURCE is not set; sensor will fall back to PRESENCE_CAMERA_DEVICE"
  elif printf '%s' "${camera_source}" | grep -Eq '^[0-9]+$'; then
    info "OK: PRESENCE_CAMERA_SOURCE uses numeric OpenCV index (${camera_source})"
  else
    info "OK: PRESENCE_CAMERA_SOURCE is set (${camera_source})"
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

  ready_payload=$(sh -c "${compose_bin} exec -T api curl -fsS http://localhost:8000/readyz" 2>/dev/null || true)
  if [ -z "${ready_payload}" ]; then
    warn "api is running but /readyz did not return success; worker/beat or broader cluster readiness may be degraded"
  else
    info "OK: /readyz responded"
    printf '%s\n' "${ready_payload}"

    heartbeat_report=$(sh -c "${compose_bin} exec -T api python -c \"import json,urllib.request; data=json.load(urllib.request.urlopen('http://localhost:8000/readyz')); comps=data.get('components',{});\
for name in ('worker','beat','presence'):\
 c=comps.get(name,{}) or {};\
 print(name + '|' + ('ok' if c.get('ok') else 'bad') + '|' + str(c.get('enabled','')) + '|' + str(c.get('stale_seconds','')) + '|' + str(c.get('error','')).replace('\\n',' '))\"" 2>/dev/null || true)

    if [ -z "${heartbeat_report}" ]; then
      warn "Could not parse worker/beat/presence heartbeat details from /readyz"
    else
      old_ifs=$IFS
      IFS='
'
      for report_line in ${heartbeat_report}; do
        IFS='|' read -r component_name component_state component_enabled stale_seconds component_error <<EOF
${report_line}
EOF
        if [ "${component_name}" = "presence" ] && [ "${component_enabled}" != "True" ] && [ "${component_enabled}" != "true" ] && [ "${component_enabled}" != "1" ]; then
          info "OK: presence sensing is disabled"
          continue
        fi
        if [ "${component_state}" = "ok" ]; then
          if [ -n "${stale_seconds}" ] && [ "${stale_seconds}" != "None" ]; then
            info "OK: ${component_name} heartbeat fresh (${stale_seconds}s old)"
          else
            info "OK: ${component_name} heartbeat fresh"
          fi
        else
          record_error "${component_name} heartbeat is stale or missing (${component_error})"
        fi
      done
      IFS=$old_ifs
    fi
  fi

  node_payload=$(sh -c "${compose_bin} exec -T api curl -fsS http://localhost:8000/api/v1/node/status" 2>/dev/null || true)
  if [ -z "${node_payload}" ]; then
    warn "Could not fetch /api/v1/node/status from inside the api container"
  else
    info "OK: /api/v1/node/status responded"
    printf '%s\n' "${node_payload}"
  fi

  ops_storage_path=$(get_env_value "${ENV_FILE}" "OPS_STORAGE_PATH" || true)
  if [ -z "${ops_storage_path}" ]; then
    ops_storage_path="/"
    warn "OPS_STORAGE_PATH is unset in .env; Django defaults this to '/'"
  fi
  if [ "${ops_storage_path}" = "/" ]; then
    warn "OPS_STORAGE_PATH is '/'; disk warnings are based on the root filesystem"
  fi

  if sh -c "${compose_bin} exec -T api test -d \"${ops_storage_path}\"" >/dev/null 2>&1; then
    df_line=$(sh -c "${compose_bin} exec -T api df -Pk \"${ops_storage_path}\" | tail -n 1" 2>/dev/null || true)
    info "OK: OPS_STORAGE_PATH exists in api container (${ops_storage_path})"
    [ -n "${df_line}" ] && info "OPS_STORAGE_PATH filesystem: ${df_line}"
  else
    record_error "OPS_STORAGE_PATH does not exist in api container: ${ops_storage_path}"
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
check_env_value "ENGINE_DEPLOYMENT"
check_env_value "INSTALLATION_PROFILE"
check_not_default "DJANGO_SECRET_KEY" "dev-secret"
check_not_default "POSTGRES_PASSWORD" "postgres"
check_not_default "MINIO_ROOT_PASSWORD" "minioadmin"
check_not_default "MINIO_SECRET_KEY" "minioadmin"

engine_deployment=$(get_env_value "${ENV_FILE}" "ENGINE_DEPLOYMENT" || true)
installation_profile=$(get_env_value "${ENV_FILE}" "INSTALLATION_PROFILE" || true)
check_known_value "ENGINE_DEPLOYMENT" "${engine_deployment}" "memory question prompt repair witness oracle"
check_known_value "INSTALLATION_PROFILE" "${installation_profile}" "custom quiet_gallery shared_lab active_exhibit"
check_presence_sensor_posture

info ""
info "Browser and HTTPS posture"
note_https_constraints
check_public_host_alignment
check_tls_cookie_alignment

info ""
info "Image posture"
check_image_posture

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
