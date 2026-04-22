#!/usr/bin/env sh
set -eu

# Package an existing backup snapshot into a single archival tarball with a
# manifest and checksums for easier handoff or migration.

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
BACKUP_ROOT="${REPO_ROOT}/backups"
EXPORT_ROOT="${REPO_ROOT}/exports"

. "${SCRIPT_DIR}/_common.sh"

usage() {
  cat <<'EOF'
Usage:
  scripts/export_bundle.sh --from /path/to/backup-dir
  scripts/export_bundle.sh --latest
  scripts/export_bundle.sh --latest --to-usb /mount/point

Behavior:
  - packages one backup snapshot into exports/
  - writes a bundle manifest, checksums, and import instructions
  - produces a .tgz that can be moved off-machine
  - optionally copies the archive to a mounted USB path and verifies checksum
EOF
}

BACKUP_DIR=""
USE_LATEST=0
USB_DEST=""
PRINT_PATH=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --from)
      [ "$#" -ge 2 ] || fail "--from requires a value"
      BACKUP_DIR="$2"
      shift 2
      ;;
    --latest)
      USE_LATEST=1
      shift
      ;;
    --to-usb)
      [ "$#" -ge 2 ] || fail "--to-usb requires a value"
      USB_DEST="$2"
      shift 2
      ;;
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

if [ "${USE_LATEST}" -eq 1 ]; then
  BACKUP_DIR=$(find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1)
fi

[ -n "${BACKUP_DIR}" ] || fail "provide --from or --latest"
[ -d "${BACKUP_DIR}" ] || fail "backup directory does not exist: ${BACKUP_DIR}"
[ -f "${BACKUP_DIR}/postgres.sql.gz" ] || fail "missing postgres.sql.gz in ${BACKUP_DIR}"
[ -f "${BACKUP_DIR}/minio-data.tgz" ] || fail "missing minio-data.tgz in ${BACKUP_DIR}"
if [ -n "${USB_DEST}" ]; then
  [ -d "${USB_DEST}" ] || fail "USB destination does not exist: ${USB_DEST}"
  [ "${USB_DEST}" != "/" ] || fail "refusing to use / as USB destination"
  [ -w "${USB_DEST}" ] || fail "USB destination is not writable: ${USB_DEST}"
fi

STAMP=$(date +"%Y%m%d-%H%M%S")
BUNDLE_DIR="${EXPORT_ROOT}/memory-engine-export-${STAMP}"
ARCHIVE_PATH="${BUNDLE_DIR}.tgz"

mkdir -p "${BUNDLE_DIR}"
cp "${BACKUP_DIR}/postgres.sql.gz" "${BUNDLE_DIR}/"
cp "${BACKUP_DIR}/minio-data.tgz" "${BUNDLE_DIR}/"
if [ -f "${BACKUP_DIR}/manifest.txt" ]; then
  cp "${BACKUP_DIR}/manifest.txt" "${BUNDLE_DIR}/source-manifest.txt"
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  COMPOSE_BIN="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_BIN="docker-compose"
else
  COMPOSE_BIN=""
fi

if [ -n "${COMPOSE_BIN}" ] && compose_service_running "api"; then
  run_compose exec -T api python manage.py artifact_summary > "${BUNDLE_DIR}/artifact-summary.json" 2>/dev/null || true
fi
if [ -f "${BUNDLE_DIR}/artifact-summary.json" ]; then
  cp "${BUNDLE_DIR}/artifact-summary.json" "${BUNDLE_DIR}/anonymized-stats.json"
fi

GIT_HEAD=$(git -C "${REPO_ROOT}" rev-parse HEAD 2>/dev/null || printf '%s' "unknown")

cat > "${BUNDLE_DIR}/IMPORT-INSTRUCTIONS.txt" <<EOF
Memory Engine export bundle
===========================

This bundle can be unpacked and restored as a backup directory because it
contains the same required core files:

- postgres.sql.gz
- minio-data.tgz

Recommended handoff steps:

1. Unpack the archive:
   tar -xzf $(basename "${ARCHIVE_PATH}")

2. Change into the unpacked bundle directory:
   cd $(basename "${BUNDLE_DIR}")

3. Verify checksums before import:
   sha256sum -c CHECKSUMS.txt

   If this machine does not have sha256sum, use:
   shasum -a 256 -c CHECKSUMS.txt

4. On the destination node, restore from the unpacked bundle directory:
   ./scripts/restore.sh --from /absolute/path/to/$(basename "${BUNDLE_DIR}")

Notes:

- source-manifest.txt is copied from the original backup when available.
- anonymized-stats.json is included only when the API container was reachable at export time.
- artifact-summary.json is kept as a compatibility alias of anonymized-stats.json.
- bundle-manifest.txt records the source backup path and git revision from the exporting node.
EOF

cat > "${BUNDLE_DIR}/bundle-manifest.txt" <<EOF
bundle_format_version=1
created_at=${STAMP}
source_backup_dir=${BACKUP_DIR}
source_git_head=${GIT_HEAD}
postgres_dump=postgres.sql.gz
minio_archive=minio-data.tgz
import_instructions=IMPORT-INSTRUCTIONS.txt
artifact_summary=$( [ -f "${BUNDLE_DIR}/artifact-summary.json" ] && printf '%s' "artifact-summary.json" || printf '%s' "not-included" )
anonymized_stats=$( [ -f "${BUNDLE_DIR}/anonymized-stats.json" ] && printf '%s' "anonymized-stats.json" || printf '%s' "not-included" )
source_manifest=$( [ -f "${BUNDLE_DIR}/source-manifest.txt" ] && printf '%s' "source-manifest.txt" || printf '%s' "not-included" )
EOF

(
  cd "${BUNDLE_DIR}"
  CHECKSUM_TARGETS="postgres.sql.gz minio-data.tgz bundle-manifest.txt IMPORT-INSTRUCTIONS.txt"
  if [ -f source-manifest.txt ]; then
    CHECKSUM_TARGETS="${CHECKSUM_TARGETS} source-manifest.txt"
  fi
  if [ -f artifact-summary.json ]; then
    CHECKSUM_TARGETS="${CHECKSUM_TARGETS} artifact-summary.json"
  fi
  if [ -f anonymized-stats.json ]; then
    CHECKSUM_TARGETS="${CHECKSUM_TARGETS} anonymized-stats.json"
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum ${CHECKSUM_TARGETS} > CHECKSUMS.txt
  else
    shasum -a 256 ${CHECKSUM_TARGETS} > CHECKSUMS.txt
  fi
)

tar -C "${EXPORT_ROOT}" -czf "${ARCHIVE_PATH}" "$(basename "${BUNDLE_DIR}")"

sha256_file() {
  file_path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${file_path}" | awk '{print $1}'
  else
    shasum -a 256 "${file_path}" | awk '{print $1}'
  fi
}

if [ -n "${USB_DEST}" ]; then
  archive_size_bytes=$(wc -c < "${ARCHIVE_PATH}" | tr -d ' ')
  available_kb=$(df -Pk "${USB_DEST}" | awk 'NR==2 {print $4}')
  required_kb=$(( (archive_size_bytes + 1023) / 1024 ))
  required_with_margin_kb=$(( required_kb + 1024 ))
  if [ "${available_kb}" -lt "${required_with_margin_kb}" ]; then
    fail "not enough free space at ${USB_DEST} (need ~${required_with_margin_kb} KB, have ${available_kb} KB)"
  fi

  dest_archive="${USB_DEST}/$(basename "${ARCHIVE_PATH}")"
  cp "${ARCHIVE_PATH}" "${dest_archive}"
  if sync "${dest_archive}" >/dev/null 2>&1; then
    :
  else
    sync >/dev/null 2>&1 || true
  fi

  source_sha=$(sha256_file "${ARCHIVE_PATH}")
  dest_sha=$(sha256_file "${dest_archive}")
  [ "${source_sha}" = "${dest_sha}" ] || fail "USB copy checksum mismatch for ${dest_archive}"
  printf '%s  %s\n' "${dest_sha}" "$(basename "${dest_archive}")" > "${dest_archive}.sha256"

  info "USB copy created: ${dest_archive}"
  info "USB checksum file: ${dest_archive}.sha256"
  log_operator_event "export_bundle.usb_copied" "export-script" "Copied export bundle to USB path ${USB_DEST}"
fi

log_operator_event "export_bundle.created" "export-script" "Created export bundle ${ARCHIVE_PATH}"

info "Export bundle created: ${ARCHIVE_PATH}"
if [ "${PRINT_PATH}" -eq 1 ]; then
  printf '%s\n' "${ARCHIVE_PATH}"
fi
