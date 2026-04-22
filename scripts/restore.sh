#!/usr/bin/env sh
set -eu

# Restore a backup directory into the current stack. This is intentionally
# explicit because it replaces the current Postgres and MinIO contents.

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
ENV_FILE="${REPO_ROOT}/.env"

. "${SCRIPT_DIR}/_common.sh"

usage() {
  cat <<'EOF'
Usage:
  scripts/restore.sh --from /path/to/backup-directory

Restores:
  - Postgres from postgres.sql.gz
  - MinIO object data from minio-data.tgz

Warning:
  This replaces the current database contents and MinIO object store.
EOF
}

BACKUP_DIR=""
CONFIRMED=0
SKIP_SNAPSHOT=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --from)
      [ "$#" -ge 2 ] || fail "--from requires a value"
      BACKUP_DIR="$2"
      shift 2
      ;;
    --yes)
      CONFIRMED=1
      shift
      ;;
    --skip-snapshot)
      SKIP_SNAPSHOT=1
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

[ -n "${BACKUP_DIR}" ] || fail "--from is required"
[ -d "${BACKUP_DIR}" ] || fail "backup directory does not exist: ${BACKUP_DIR}"
[ -f "${BACKUP_DIR}/postgres.sql.gz" ] || fail "missing postgres.sql.gz in ${BACKUP_DIR}"
[ -f "${BACKUP_DIR}/minio-data.tgz" ] || fail "missing minio-data.tgz in ${BACKUP_DIR}"
[ -f "${ENV_FILE}" ] || fail ".env not found"

COMPOSE_BIN=$(detect_compose_bin)
POSTGRES_USER=$(get_env_value "${ENV_FILE}" POSTGRES_USER)
POSTGRES_DB=$(get_env_value "${ENV_FILE}" POSTGRES_DB)

if [ "${CONFIRMED}" -ne 1 ]; then
  info "Restore will replace the current Postgres database and MinIO object data."
  printf '%s' "Type RESTORE to continue: "
  read -r confirmation
  [ "${confirmation}" = "RESTORE" ] || fail "restore cancelled"
fi

PRE_RESTORE_SNAPSHOT=""
if [ "${SKIP_SNAPSHOT}" -ne 1 ]; then
  info "Creating a pre-restore snapshot of the current stack"
  PRE_RESTORE_SNAPSHOT=$("${REPO_ROOT}/scripts/backup.sh" --consistent --print-path | tail -n 1)
  info "Pre-restore snapshot: ${PRE_RESTORE_SNAPSHOT}"
fi

log_operator_event "restore.started" "restore-script" "Restoring backup ${BACKUP_DIR}"

info "Stopping API and worker services during restore"
sh -c "${COMPOSE_BIN} stop proxy worker beat api"

info "Restoring Postgres from ${BACKUP_DIR}/postgres.sql.gz"
sh -c "${COMPOSE_BIN} exec -T db psql -U \"${POSTGRES_USER}\" -d postgres -c \"DROP DATABASE IF EXISTS ${POSTGRES_DB};\""
sh -c "${COMPOSE_BIN} exec -T db psql -U \"${POSTGRES_USER}\" -d postgres -c \"CREATE DATABASE ${POSTGRES_DB};\""
gunzip -c "${BACKUP_DIR}/postgres.sql.gz" | sh -c "${COMPOSE_BIN} exec -T db psql -U \"${POSTGRES_USER}\" -d \"${POSTGRES_DB}\""

info "Restoring MinIO object data from ${BACKUP_DIR}/minio-data.tgz"
MINIO_CONTAINER_ID=$(sh -c "${COMPOSE_BIN} ps -q minio" | head -n 1)
[ -n "${MINIO_CONTAINER_ID}" ] || fail "could not determine minio container id"
MINIO_STAGE_DIR=$(mktemp -d "${REPO_ROOT}/.restore-minio.XXXXXX")
tar -C "${MINIO_STAGE_DIR}" -xzf "${BACKUP_DIR}/minio-data.tgz"
docker exec "${MINIO_CONTAINER_ID}" sh -c 'rm -rf /data/*'
docker cp "${MINIO_STAGE_DIR}/." "${MINIO_CONTAINER_ID}:/data/"
rm -rf "${MINIO_STAGE_DIR}"

info "Restarting services"
sh -c "${COMPOSE_BIN} up -d"

log_operator_event "restore.completed" "restore-script" "Restored backup ${BACKUP_DIR}"

info "Restore finished."
if [ -n "${PRE_RESTORE_SNAPSHOT}" ]; then
  info "Pre-restore snapshot saved at: ${PRE_RESTORE_SNAPSHOT}"
fi
