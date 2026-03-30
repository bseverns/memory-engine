#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "${SCRIPT_DIR}/_common.sh"

ROLE=""
BASE_URL=""
FULL_URL=""
BROWSER_BIN=""
PRINT_ONLY=0

usage() {
  cat <<'EOF'
Usage:
  scripts/browser_kiosk.sh --role kiosk|room|ops --base-url URL [--browser PATH] [--print]
  scripts/browser_kiosk.sh --url URL [--browser PATH] [--print]

Examples:
  scripts/browser_kiosk.sh --role kiosk --base-url https://memory.example.com
  scripts/browser_kiosk.sh --role room --base-url https://memory.example.com --print
  scripts/browser_kiosk.sh --url https://memory.example.com/room/

Notes:
  This script only launches Chromium with a repeatable flag set.
  For Leonardo or keyboard HID use, the OS still needs auto-login,
  crash/restore prompts disabled, and the kiosk window returned to
  the front after reboot.
EOF
}

detect_browser() {
  for candidate in chromium-browser chromium google-chrome google-chrome-stable; do
    if command -v "${candidate}" >/dev/null 2>&1; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  fail "No Chromium-compatible browser found. Pass --browser PATH explicitly."
}

trim_trailing_slash() {
  value="$1"
  while [ "${value}" != "/" ] && [ "${value%/}" != "${value}" ]; do
    value=${value%/}
  done
  printf '%s\n' "${value}"
}

resolve_role_url() {
  role="$1"
  base_url=$(trim_trailing_slash "$2")
  case "${role}" in
    kiosk)
      printf '%s\n' "${base_url}/kiosk/"
      ;;
    room)
      printf '%s\n' "${base_url}/room/"
      ;;
    ops)
      printf '%s\n' "${base_url}/ops/"
      ;;
    *)
      fail "--role must be kiosk, room, or ops"
      ;;
  esac
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --role)
      [ "$#" -ge 2 ] || fail "--role requires a value"
      ROLE="$2"
      shift 2
      ;;
    --base-url)
      [ "$#" -ge 2 ] || fail "--base-url requires a value"
      BASE_URL="$2"
      shift 2
      ;;
    --url)
      [ "$#" -ge 2 ] || fail "--url requires a value"
      FULL_URL="$2"
      shift 2
      ;;
    --browser)
      [ "$#" -ge 2 ] || fail "--browser requires a value"
      BROWSER_BIN="$2"
      shift 2
      ;;
    --print)
      PRINT_ONLY=1
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

if [ -n "${ROLE}" ]; then
  [ -n "${BASE_URL}" ] || fail "--base-url is required when --role is used"
  FULL_URL=$(resolve_role_url "${ROLE}" "${BASE_URL}")
fi

[ -n "${FULL_URL}" ] || fail "Provide either --url or (--role with --base-url)"

if [ -z "${BROWSER_BIN}" ]; then
  BROWSER_BIN=$(detect_browser)
fi

COMMON_FLAGS="
  --kiosk
  --no-first-run
  --disable-session-crashed-bubble
  --disable-infobars
  --overscroll-history-navigation=0
  --disable-features=Translate,MediaRouter
"

ROOM_FLAGS="
  --autoplay-policy=no-user-gesture-required
  --disable-background-media-suspend
  --disable-renderer-backgrounding
"

build_command() {
  target_role="${1:-}"
  printf '%s' "${BROWSER_BIN}"
  for flag in ${COMMON_FLAGS}; do
    printf ' %s' "${flag}"
  done
  if [ "${target_role}" = "room" ] || printf '%s' "${FULL_URL}" | grep -q '/room/\{0,1\}$'; then
    for flag in ${ROOM_FLAGS}; do
      printf ' %s' "${flag}"
    done
  fi
  printf ' %s\n' "${FULL_URL}"
}

COMMAND=$(build_command "${ROLE}")

if [ "${PRINT_ONLY}" -eq 1 ]; then
  printf '%s\n' "${COMMAND}"
  exit 0
fi

info "Launching ${FULL_URL} via ${BROWSER_BIN}"

if [ "${ROLE}" = "room" ] || printf '%s' "${FULL_URL}" | grep -q '/room/\{0,1\}$'; then
  info "Room playback flags include autoplay hardening for unattended boot."
fi

exec sh -c "${COMMAND}"
