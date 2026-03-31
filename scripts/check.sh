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

PYTHON_VERSION=$("${PYTHON_BIN}" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
info "Using Python ${PYTHON_VERSION} via ${PYTHON_BIN}"
if [ "${PYTHON_VERSION}" != "3.12" ]; then
  info "Note: the officially supported runtime is Docker / the api image on Python 3.12. Local host Python ${PYTHON_VERSION} is a best-effort maintenance path."
fi

info "Checking browser script syntax"
find api/engine/static -type f -name '*.js' | sort | while IFS= read -r script_path; do
  node --check "${script_path}"
done

rm -rf test-results/coverage
mkdir -p test-results/coverage/node-v8

info "Running frontend tests with coverage thresholds"
NODE_V8_COVERAGE=test-results/coverage/node-v8 npm run test:frontend:coverage

info "Checking Python syntax"
"${PYTHON_BIN}" -m py_compile $(find api -type f -name '*.py' | sort)

info "Running Django behavior tests with coverage"
COVERAGE_FILE=test-results/coverage/.coverage "${PYTHON_BIN}" -m coverage run api/manage.py test --settings memory_engine.settings_test
COVERAGE_FILE=test-results/coverage/.coverage "${PYTHON_BIN}" -m coverage report
COVERAGE_FILE=test-results/coverage/.coverage "${PYTHON_BIN}" -m coverage json -o test-results/coverage/python-coverage.json
COVERAGE_FILE=test-results/coverage/.coverage "${PYTHON_BIN}" -m coverage xml -o test-results/coverage/python-coverage.xml
COVERAGE_FILE=test-results/coverage/.coverage "${PYTHON_BIN}" -m coverage html -d test-results/coverage/python-html
"${PYTHON_BIN}" scripts/check_python_coverage.py test-results/coverage/python-coverage.json --lines 80 --branches 60

info "Running browser check subset"
npm run test:browser:check

info "Checking shell script syntax"
sh -n scripts/*.sh api/entrypoint.sh

info "Checking git patch hygiene"
git diff --check

info "All checks passed."
