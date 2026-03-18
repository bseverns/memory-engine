#!/usr/bin/env sh
set -eu

# Run the fast syntax and repo-hygiene checks that are practical before
# deployment or handoff. This is the quickest "did I break the repo?" pass.

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)

. "${SCRIPT_DIR}/_common.sh"

cd "${REPO_ROOT}"

info "Checking browser script syntax"
node --check api/engine/static/engine/kiosk.js

info "Checking Python syntax"
python3 -m py_compile $(find api -type f -name '*.py' | sort)

info "Checking shell script syntax"
sh -n scripts/*.sh api/entrypoint.sh

info "Checking git patch hygiene"
git diff --check

info "All checks passed."
