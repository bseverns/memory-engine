#!/usr/bin/env sh
set -eu

# Snapshot the current Postgres database and MinIO object data into a
# timestamped backup folder under ./backups.

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
ENV_FILE="${REPO_ROOT}/.env"
BACKUP_ROOT="${REPO_ROOT}/backups"
STAMP=$(date +"%Y%m%d-%H%M%S")
DEST_DIR="${BACKUP_ROOT}/${STAMP}"
PRINT_PATH=0

. "${SCRIPT_DIR}/_common.sh"

usage() {
  cat <<'EOF'
Usage:
  scripts/backup.sh [--print-path]

Behavior:
  - dumps Postgres into a timestamped folder under backups/
  - archives MinIO object data into the same folder
  - writes a simple manifest for later restore or export
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --print-path)
      PRINT_PATH=1
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

mkdir -p "${DEST_DIR}"

info "Backing up Postgres to ${DEST_DIR}/postgres.sql.gz"
sh -c "${COMPOSE_BIN} exec -T db pg_dump -U \"${POSTGRES_USER}\" -d \"${POSTGRES_DB}\"" | gzip > "${DEST_DIR}/postgres.sql.gz"

info "Backing up MinIO object data to ${DEST_DIR}/minio-data.tgz"
sh -c "${COMPOSE_BIN} exec -T minio sh -c 'tar -C /data -czf - .'" > "${DEST_DIR}/minio-data.tgz"

cat > "${DEST_DIR}/manifest.txt" <<EOF
created_at=${STAMP}
postgres_dump=postgres.sql.gz
minio_archive=minio-data.tgz
EOF

info "Backup finished: ${DEST_DIR}"
if [ "${PRINT_PATH}" -eq 1 ]; then
  printf '%s\n' "${DEST_DIR}"
fi
