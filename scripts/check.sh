#!/usr/bin/env sh
set -eu

# Run the fast syntax and repo-hygiene checks that are practical before
# deployment or handoff. This is the quickest "did I break the repo?" pass.

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)

. "${SCRIPT_DIR}/_common.sh"

cd "${REPO_ROOT}"

PYTHON_BIN=python3
if [ -x "${REPO_ROOT}/.venv/bin/python" ]; then
  PYTHON_BIN="${REPO_ROOT}/.venv/bin/python"
fi

info "Checking browser script syntax"
find api/engine/static -type f -name '*.js' | sort | while IFS= read -r script_path; do
  node --check "${script_path}"
done

info "Checking Python syntax"
"${PYTHON_BIN}" -m py_compile $(find api -type f -name '*.py' | sort)

info "Running Django behavior tests"
"${PYTHON_BIN}" api/manage.py test --settings memory_engine.settings_test

info "Checking shell script syntax"
sh -n scripts/*.sh api/entrypoint.sh

info "Checking git patch hygiene"
git diff --check

info "All checks passed."
