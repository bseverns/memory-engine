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

while [ "$#" -gt 0 ]; do
  case "$1" in
    --from)
      [ "$#" -ge 2 ] || fail "--from requires a value"
      BACKUP_DIR="$2"
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

[ -n "${BACKUP_DIR}" ] || fail "--from is required"
[ -d "${BACKUP_DIR}" ] || fail "backup directory does not exist: ${BACKUP_DIR}"
[ -f "${BACKUP_DIR}/postgres.sql.gz" ] || fail "missing postgres.sql.gz in ${BACKUP_DIR}"
[ -f "${BACKUP_DIR}/minio-data.tgz" ] || fail "missing minio-data.tgz in ${BACKUP_DIR}"
[ -f "${ENV_FILE}" ] || fail ".env not found"

COMPOSE_BIN=$(detect_compose_bin)
POSTGRES_USER=$(get_env_value "${ENV_FILE}" POSTGRES_USER)
POSTGRES_DB=$(get_env_value "${ENV_FILE}" POSTGRES_DB)

info "Stopping worker services during restore"
sh -c "${COMPOSE_BIN} stop worker beat proxy"

info "Restoring Postgres from ${BACKUP_DIR}/postgres.sql.gz"
sh -c "${COMPOSE_BIN} exec -T db psql -U \"${POSTGRES_USER}\" -d postgres -c \"DROP DATABASE IF EXISTS ${POSTGRES_DB};\""
sh -c "${COMPOSE_BIN} exec -T db psql -U \"${POSTGRES_USER}\" -d postgres -c \"CREATE DATABASE ${POSTGRES_DB};\""
gunzip -c "${BACKUP_DIR}/postgres.sql.gz" | sh -c "${COMPOSE_BIN} exec -T db psql -U \"${POSTGRES_USER}\" -d \"${POSTGRES_DB}\""

info "Restoring MinIO object data from ${BACKUP_DIR}/minio-data.tgz"
sh -c "${COMPOSE_BIN} exec -T minio sh -c 'rm -rf /data/* && tar -C /data -xzf -'" < "${BACKUP_DIR}/minio-data.tgz"

info "Restarting services"
sh -c "${COMPOSE_BIN} up -d"

info "Restore finished."
