#!/usr/bin/env sh
set -eu

# Remove regenerable local caches and browser-test byproducts without touching
# source files, backups, or screenshots unless asked.

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)

. "${SCRIPT_DIR}/_common.sh"

include_screenshots=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --include-screenshots)
      include_screenshots=1
      ;;
    -h|--help)
      cat <<'EOF'
Usage: ./scripts/clean_local.sh [--include-screenshots]

Removes local byproducts that are safe to regenerate:
- api/.test-cache/
- test-results/
- test-results/coverage/
- playwright-report/
- .playwright/
- Python __pycache__/ directories outside .venv and node_modules

Optional:
- --include-screenshots  Also remove artifacts/screenshots/
EOF
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
  shift
done

cd "${REPO_ROOT}"

remove_path() {
  target="$1"
  if [ -e "${target}" ]; then
    rm -rf "${target}"
    info "Removed ${target}"
  fi
}

remove_path "api/.test-cache"
remove_path "test-results"
remove_path "playwright-report"
remove_path ".playwright"

find . \
  -type d \
  -name '__pycache__' \
  ! -path './.venv/*' \
  ! -path './node_modules/*' \
  -print | while IFS= read -r cache_dir; do
    rm -rf "${cache_dir}"
    info "Removed ${cache_dir}"
  done

if [ "${include_screenshots}" -eq 1 ]; then
  remove_path "artifacts/screenshots"
fi

info "Local cache cleanup complete."
