#!/usr/bin/env sh
set -eu

# Update an existing server copy of the repo by optionally pulling the latest
# code, running the preflight checks, taking a backup, deploying, and printing
# final stack status.

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)

. "${SCRIPT_DIR}/_common.sh"

PUBLIC_HOST=""
TLS_MODE="auto"
REMOTE_NAME="origin"
BRANCH_NAME=""
SKIP_PULL=0
SKIP_CHECK=0
SKIP_DOCTOR=0
SKIP_BACKUP=0
SKIP_BUILD=0

usage() {
  cat <<'EOF'
Usage:
  scripts/update.sh --public-host HOST [options]

Examples:
  scripts/update.sh --public-host memory.example.com
  scripts/update.sh --public-host 203.0.113.10 --tls internal
  scripts/update.sh --public-host memory.example.com --skip-pull
  scripts/update.sh --public-host memory.example.com --branch main

Options:
  --public-host HOST    Bare host or IP the stack should serve
  --tls MODE            auto or internal (default: auto)
  --remote NAME         Git remote to fetch/pull from (default: origin)
  --branch NAME         Branch to pull; defaults to the current branch
  --skip-pull           Skip git fetch/pull
  --skip-check          Skip scripts/check.sh
  --skip-doctor         Skip scripts/doctor.sh before deploy
  --skip-backup         Skip scripts/backup.sh before deploy
  --skip-build          Pass --skip-build through to scripts/deploy.sh

Behavior:
  - optionally fast-forward pulls the chosen branch from the chosen remote
  - runs repo checks
  - runs the operator doctor
  - writes a fresh backup
  - deploys the stack for the target host
  - prints final compose and health status
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --public-host)
      [ "$#" -ge 2 ] || fail "--public-host requires a value"
      PUBLIC_HOST="$2"
      shift 2
      ;;
    --tls)
      [ "$#" -ge 2 ] || fail "--tls requires a value"
      TLS_MODE="$2"
      shift 2
      ;;
    --remote)
      [ "$#" -ge 2 ] || fail "--remote requires a value"
      REMOTE_NAME="$2"
      shift 2
      ;;
    --branch)
      [ "$#" -ge 2 ] || fail "--branch requires a value"
      BRANCH_NAME="$2"
      shift 2
      ;;
    --skip-pull)
      SKIP_PULL=1
      shift
      ;;
    --skip-check)
      SKIP_CHECK=1
      shift
      ;;
    --skip-doctor)
      SKIP_DOCTOR=1
      shift
      ;;
    --skip-backup)
      SKIP_BACKUP=1
      shift
      ;;
    --skip-build)
      SKIP_BUILD=1
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

[ -n "${PUBLIC_HOST}" ] || fail "--public-host is required"
[ "${TLS_MODE}" = "auto" ] || [ "${TLS_MODE}" = "internal" ] || fail "--tls must be auto or internal"

cd "${REPO_ROOT}"

if [ "${SKIP_PULL}" -eq 0 ]; then
  git diff --quiet || fail "working tree has local changes; commit or stash before running update"
  git diff --cached --quiet || fail "index has staged changes; commit or stash before running update"

  if [ -z "${BRANCH_NAME}" ]; then
    BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
  fi

  [ "${BRANCH_NAME}" != "HEAD" ] || fail "detached HEAD; pass --branch explicitly or check out a branch first"

  info "Fetching ${REMOTE_NAME}/${BRANCH_NAME}"
  git fetch "${REMOTE_NAME}" "${BRANCH_NAME}"

  info "Fast-forwarding local branch"
  git pull --ff-only "${REMOTE_NAME}" "${BRANCH_NAME}"
else
  if [ -z "${BRANCH_NAME}" ]; then
    BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
  fi
  info "Skipping git pull on ${BRANCH_NAME}"
fi

if [ "${SKIP_CHECK}" -eq 0 ]; then
  info "Running repo checks"
  "${SCRIPT_DIR}/check.sh"
else
  info "Skipping repo checks"
fi

if [ "${SKIP_DOCTOR}" -eq 0 ]; then
  info "Running operator doctor"
  "${SCRIPT_DIR}/doctor.sh"
else
  info "Skipping operator doctor"
fi

if [ "${SKIP_BACKUP}" -eq 0 ]; then
  info "Creating backup snapshot"
  "${SCRIPT_DIR}/backup.sh"
else
  info "Skipping backup snapshot"
fi

info "Deploying stack"
if [ "${SKIP_BUILD}" -eq 1 ]; then
  "${SCRIPT_DIR}/deploy.sh" --public-host "${PUBLIC_HOST}" --tls "${TLS_MODE}" --skip-build
else
  "${SCRIPT_DIR}/deploy.sh" --public-host "${PUBLIC_HOST}" --tls "${TLS_MODE}"
fi

info "Printing final stack status"
  "${SCRIPT_DIR}/status.sh"

info "Update flow finished."
info "Open /ops/ and confirm the node is ready with no critical warnings."
