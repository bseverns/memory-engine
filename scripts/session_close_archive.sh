#!/usr/bin/env sh
set -eu

# End-of-session steward archive helper:
# 1) capture a consistent backup snapshot
# 2) package it as an export bundle
# 3) optionally copy the export to a mounted USB path
#
# This script is intentionally host-run. It does not require or expose a
# privileged API execution path from /ops/.

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)

. "${SCRIPT_DIR}/_common.sh"

USB_DEST=""
PRINT_PATHS=0

usage() {
  cat <<'EOF'
Usage:
  scripts/session_close_archive.sh
  scripts/session_close_archive.sh --to-usb /absolute/mount/path
  scripts/session_close_archive.sh --print-paths

Behavior:
  - runs scripts/backup.sh --consistent
  - runs scripts/export_bundle.sh for that new snapshot
  - optionally copies/checksums the export to a mounted USB path

Output:
  - always prints human-readable backup/export paths
  - with --print-paths, also prints KEY=VALUE lines for automation
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --to-usb)
      [ "$#" -ge 2 ] || fail "--to-usb requires a value"
      USB_DEST="$2"
      shift 2
      ;;
    --print-paths)
      PRINT_PATHS=1
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

info "Creating consistent end-of-session backup snapshot"
BACKUP_DIR=$("${SCRIPT_DIR}/backup.sh" --consistent --print-path | tail -n 1)
[ -d "${BACKUP_DIR}" ] || fail "backup path missing: ${BACKUP_DIR}"

info "Packaging export bundle from backup snapshot"
if [ -n "${USB_DEST}" ]; then
  EXPORT_ARCHIVE=$("${SCRIPT_DIR}/export_bundle.sh" --from "${BACKUP_DIR}" --to-usb "${USB_DEST}" --print-path | tail -n 1)
else
  EXPORT_ARCHIVE=$("${SCRIPT_DIR}/export_bundle.sh" --from "${BACKUP_DIR}" --print-path | tail -n 1)
fi
[ -f "${EXPORT_ARCHIVE}" ] || fail "export archive missing: ${EXPORT_ARCHIVE}"

info "Session close archive complete"
info "Backup snapshot: ${BACKUP_DIR}"
info "Export bundle: ${EXPORT_ARCHIVE}"
if [ -n "${USB_DEST}" ]; then
  info "USB destination: ${USB_DEST}"
fi

if [ "${PRINT_PATHS}" -eq 1 ]; then
  printf 'BACKUP_DIR=%s\n' "${BACKUP_DIR}"
  printf 'EXPORT_ARCHIVE=%s\n' "${EXPORT_ARCHIVE}"
  if [ -n "${USB_DEST}" ]; then
    printf 'USB_DEST=%s\n' "${USB_DEST}"
  fi
fi
