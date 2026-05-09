#!/usr/bin/env sh
set -eu

# Create a dated proof-run note for real steward/participant rehearsals.
# This script scaffolds evidence capture only; it does not claim the proof ran.

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)

. "${SCRIPT_DIR}/_common.sh"

PROOF_TARGET=""
RUNNER=""
DEPLOYMENT_KIND=""
INSTALLATION_PROFILE=""
OUT_DIR="${REPO_ROOT}/test-results/proof-runs"

usage() {
  cat <<'EOF'
Usage:
  scripts/proof_run_note.sh --target "receipt revocation comprehension" --runner "non-author steward"
  scripts/proof_run_note.sh --target "restore handoff" --deployment memory --profile shared_lab

Behavior:
  - writes a Markdown note under test-results/proof-runs/
  - pre-fills date, commit SHA, deployment fields, and evidence prompts
  - leaves pass/fail and observations blank for a real rehearsal
EOF
}

slugify() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed 's/[^a-z0-9][^a-z0-9]*/-/g; s/^-//; s/-$//'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target)
      [ "$#" -ge 2 ] || fail "--target requires a value"
      PROOF_TARGET="$2"
      shift 2
      ;;
    --runner)
      [ "$#" -ge 2 ] || fail "--runner requires a value"
      RUNNER="$2"
      shift 2
      ;;
    --deployment)
      [ "$#" -ge 2 ] || fail "--deployment requires a value"
      DEPLOYMENT_KIND="$2"
      shift 2
      ;;
    --profile)
      [ "$#" -ge 2 ] || fail "--profile requires a value"
      INSTALLATION_PROFILE="$2"
      shift 2
      ;;
    --out-dir)
      [ "$#" -ge 2 ] || fail "--out-dir requires a value"
      OUT_DIR="$2"
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

[ -n "${PROOF_TARGET}" ] || fail "provide --target"

RUN_DATE=$(date +"%Y-%m-%d")
RUN_STAMP=$(date +"%Y%m%d-%H%M%S")
TARGET_SLUG=$(slugify "${PROOF_TARGET}")
[ -n "${TARGET_SLUG}" ] || TARGET_SLUG="proof-run"
GIT_HEAD=$(git -C "${REPO_ROOT}" rev-parse HEAD 2>/dev/null || printf '%s' "unknown")
OUTPUT_PATH="${OUT_DIR}/${RUN_STAMP}-${TARGET_SLUG}.md"

mkdir -p "${OUT_DIR}"

cat > "${OUTPUT_PATH}" <<EOF
# Memory Engine Proof Run: ${PROOF_TARGET}

This note is for real rehearsal evidence. It is not an automated test result.

## Run Facts

- Date: ${RUN_DATE}
- Commit / build SHA: ${GIT_HEAD}
- Proof target: ${PROOF_TARGET}
- Deployment kind: ${DEPLOYMENT_KIND:-}
- Installation profile: ${INSTALLATION_PROFILE:-}
- Runner / steward: ${RUNNER:-}
- Was the runner already familiar with the stack?:
- Machine / host notes:

## Surface Path Exercised

- Participant recording station \`/kiosk/\`:
- Listening surface \`/room/\`:
- Operator Lite \`/ops/\`:
- Operator Bench \`/ops/bench/\`:
- Public revocation path \`/revoke/\`:
- Backup/export/restore command path:

## Evidence Captured

- Screenshots or photos:
- Logs or command output paths:
- Backup path:
- Export bundle path:
- USB copy path, if any:
- Receipt/revocation code handling notes:

## Observations

- What passed:
- What partially passed:
- What failed:
- What confused the participant or steward:
- What required verbal help:
- What should change before the next public run:

## Result

- Status: TODO
- One concrete follow-up:

## Boundary Note

Do not fill this in from unit tests alone. This proof requires real steward or
participant rehearsal for comprehension, handoff, timing, and trust posture.
EOF

info "Proof-run note created: ${OUTPUT_PATH}"
