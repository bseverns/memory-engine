#!/usr/bin/env sh
set -eu

# Snapshot Postgres and MinIO object data into a timestamped backup folder
# under ./backups. Supports quick and consistent backup modes.

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
ENV_FILE="${REPO_ROOT}/.env"
BACKUP_ROOT="${REPO_ROOT}/backups"
STAMP=$(date +"%Y%m%d-%H%M%S")
DEST_DIR="${BACKUP_ROOT}/${STAMP}"
PRINT_PATH=0
CONSISTENT_MODE=0

. "${SCRIPT_DIR}/_common.sh"

usage() {
  cat <<'EOF'
Usage:
  scripts/backup.sh [--print-path] [--consistent]

Behavior:
  - dumps Postgres into a timestamped folder under backups/
  - archives MinIO object data into the same folder
  - writes a manifest and checksums for later restore or export

Modes:
  - quick (default): capture while services continue running
  - consistent (--consistent): briefly stop ingress/background writers first
EOF
}

sanitize_identity() {
  raw="$1"
  printf '%s' "${raw}" \
    | tr '[:upper:]' '[:lower:]' \
    | tr -cs 'a-z0-9._-' '-' \
    | sed 's/^-*//; s/-*$//'
}

write_checksum() {
  file_name="$1"
  output_file="$2"
  if command -v sha256sum >/dev/null 2>&1; then
    checksum=$(sha256sum "${file_name}" | awk '{print $1}')
  else
    checksum=$(shasum -a 256 "${file_name}" | awk '{print $1}')
  fi
  printf '%s  %s\n' "${checksum}" "$(basename "${file_name}")" >> "${output_file}"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --print-path)
      PRINT_PATH=1
      shift
      ;;
    --consistent)
      CONSISTENT_MODE=1
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

COMPOSE_BIN=$(detect_compose_bin)

[ -f "${ENV_FILE}" ] || fail ".env not found"
POSTGRES_USER=$(get_env_value "${ENV_FILE}" POSTGRES_USER)
POSTGRES_DB=$(get_env_value "${ENV_FILE}" POSTGRES_DB)
ENGINE_DEPLOYMENT=$(get_env_value "${ENV_FILE}" ENGINE_DEPLOYMENT || true)
INSTALLATION_PROFILE=$(get_env_value "${ENV_FILE}" INSTALLATION_PROFILE || true)
NODE_NAME=$(get_env_value "${ENV_FILE}" NODE_NAME || true)
APP_SITE_ADDRESS=$(get_env_value "${ENV_FILE}" APP_SITE_ADDRESS || true)

BACKUP_MODE="quick"
STOPPED_SERVICES=""

restart_stopped_services() {
  if [ -z "${STOPPED_SERVICES}" ]; then
    return
  fi
  info "Restarting services stopped for consistent backup: ${STOPPED_SERVICES}"
  sh -c "${COMPOSE_BIN} up -d ${STOPPED_SERVICES}" >/dev/null 2>&1 || true
  STOPPED_SERVICES=""
}

if [ "${CONSISTENT_MODE}" -eq 1 ]; then
  BACKUP_MODE="consistent"
  trap restart_stopped_services EXIT INT TERM
  RUNNING_SERVICES=$(sh -c "${COMPOSE_BIN} ps --services --filter status=running" 2>/dev/null || true)
  for service_name in proxy api worker beat; do
    if printf '%s\n' "${RUNNING_SERVICES}" | grep -qx "${service_name}"; then
      if [ -z "${STOPPED_SERVICES}" ]; then
        STOPPED_SERVICES="${service_name}"
      else
        STOPPED_SERVICES="${STOPPED_SERVICES} ${service_name}"
      fi
    fi
  done
  if [ -n "${STOPPED_SERVICES}" ]; then
    info "Consistent backup mode: stopping write-path services (${STOPPED_SERVICES})"
    sh -c "${COMPOSE_BIN} stop ${STOPPED_SERVICES}"
  else
    info "Consistent backup mode: no write-path services currently running"
  fi
fi

mkdir -p "${DEST_DIR}"

info "Backing up Postgres to ${DEST_DIR}/postgres.sql.gz"
sh -c "${COMPOSE_BIN} exec -T db pg_dump -U \"${POSTGRES_USER}\" -d \"${POSTGRES_DB}\"" | gzip > "${DEST_DIR}/postgres.sql.gz"

info "Backing up MinIO object data to ${DEST_DIR}/minio-data.tgz"
MINIO_CONTAINER_ID=$(sh -c "${COMPOSE_BIN} ps -q minio" | head -n 1)
[ -n "${MINIO_CONTAINER_ID}" ] || fail "could not determine minio container id"
MINIO_STAGE_DIR="${DEST_DIR}/.minio-stage"
mkdir -p "${MINIO_STAGE_DIR}"
docker cp "${MINIO_CONTAINER_ID}:/data/." "${MINIO_STAGE_DIR}/"
tar -C "${MINIO_STAGE_DIR}" -czf "${DEST_DIR}/minio-data.tgz" .
rm -rf "${MINIO_STAGE_DIR}"

GIT_HEAD=$(git -C "${REPO_ROOT}" rev-parse HEAD 2>/dev/null || printf '%s' "unknown")
GIT_DESCRIBE=$(git -C "${REPO_ROOT}" describe --tags --always --dirty 2>/dev/null || printf '%s' "unknown")
NODE_IDENTITY_SANITIZED=$(sanitize_identity "${NODE_NAME:-node}")
if [ -z "${NODE_IDENTITY_SANITIZED}" ]; then
  NODE_IDENTITY_SANITIZED="node"
fi

cat > "${DEST_DIR}/manifest.txt" <<EOF
manifest_version=2
created_at=${STAMP}
backup_mode=${BACKUP_MODE}
postgres_dump=postgres.sql.gz
minio_archive=minio-data.tgz
sha256sums=sha256sums.txt
git_head=${GIT_HEAD}
git_describe=${GIT_DESCRIBE}
engine_deployment=${ENGINE_DEPLOYMENT:-unknown}
installation_profile=${INSTALLATION_PROFILE:-unknown}
node_identity=${NODE_IDENTITY_SANITIZED}
app_site_address=${APP_SITE_ADDRESS:-}
EOF

CHECKSUM_FILE="${DEST_DIR}/sha256sums.txt"
: > "${CHECKSUM_FILE}"
write_checksum "${DEST_DIR}/postgres.sql.gz" "${CHECKSUM_FILE}"
write_checksum "${DEST_DIR}/minio-data.tgz" "${CHECKSUM_FILE}"
write_checksum "${DEST_DIR}/manifest.txt" "${CHECKSUM_FILE}"

if [ "${CONSISTENT_MODE}" -eq 1 ]; then
  restart_stopped_services
  trap - EXIT INT TERM
fi

info "Backup finished: ${DEST_DIR}"
if [ "${PRINT_PATH}" -eq 1 ]; then
  printf '%s\n' "${DEST_DIR}"
fi
