#!/usr/bin/env sh

# Shared helpers for operator-facing scripts.
# Keep this file POSIX-sh compatible so it can be sourced from any of the
# maintenance scripts without assuming bash.

fail() {
  printf '%s\n' "Error: $*" >&2
  exit 1
}

info() {
  printf '%s\n' "$*"
}

detect_compose_bin() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    printf '%s\n' "docker compose"
    return 0
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    printf '%s\n' "docker-compose"
    return 0
  fi
  fail "docker compose is not installed on this machine"
}

get_env_value() {
  env_file="$1"
  key="$2"
  awk -F= -v target="${key}" '
    $0 !~ /^[[:space:]]*#/ && $1 == target {
      sub(/^[^=]*=/, "", $0)
      print $0
      exit
    }
  ' "${env_file}"
}

upsert_env_value() {
  env_file="$1"
  key="$2"
  value="$3"
  tmp_file="${env_file}.tmp"
  awk -v target="${key}" -v replacement="${key}=${value}" '
    BEGIN { updated = 0 }
    $0 !~ /^[[:space:]]*#/ && $0 ~ ("^" target "=") {
      print replacement
      updated = 1
      next
    }
    { print }
    END {
      if (!updated) print replacement
    }
  ' "${env_file}" > "${tmp_file}"
  mv "${tmp_file}" "${env_file}"
}
