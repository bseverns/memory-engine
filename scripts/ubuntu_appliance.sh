#!/usr/bin/env sh
set -eu

# Configure the reference Ubuntu host for appliance-style operation:
# - narrow firewall defaults
# - restart-on-boot systemd service for the compose stack

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)

. "${SCRIPT_DIR}/_common.sh"

SSH_PORT="22"
SERVICE_NAME="memory-engine-compose"
SERVICE_USER="${SUDO_USER:-$(id -un)}"
SKIP_FIREWALL=0
SKIP_SERVICE=0
START_NOW=0

usage() {
  cat <<'EOF'
Usage:
  sudo ./scripts/ubuntu_appliance.sh [--ssh-port PORT] [--service-name NAME] [--service-user USER] [--skip-firewall] [--skip-service] [--start-now]

Examples:
  sudo ./scripts/ubuntu_appliance.sh
  sudo ./scripts/ubuntu_appliance.sh --ssh-port 2222 --start-now
  sudo ./scripts/ubuntu_appliance.sh --service-name room-memory --service-user kiosk

Behavior:
  - enables a narrow `ufw` posture for SSH, HTTP, and HTTPS
  - writes a systemd unit that runs `docker compose up -d --remove-orphans` in this repo
  - enables Docker and the compose unit for restart-on-boot
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --ssh-port)
      [ "$#" -ge 2 ] || fail "--ssh-port requires a value"
      SSH_PORT="$2"
      shift 2
      ;;
    --service-name)
      [ "$#" -ge 2 ] || fail "--service-name requires a value"
      SERVICE_NAME="$2"
      shift 2
      ;;
    --service-user)
      [ "$#" -ge 2 ] || fail "--service-user requires a value"
      SERVICE_USER="$2"
      shift 2
      ;;
    --skip-firewall)
      SKIP_FIREWALL=1
      shift
      ;;
    --skip-service)
      SKIP_SERVICE=1
      shift
      ;;
    --start-now)
      START_NOW=1
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

[ "$(id -u)" -eq 0 ] || fail "run this script with sudo or as root"
[ -d "${REPO_ROOT}" ] || fail "repo root not found"
command -v systemctl >/dev/null 2>&1 || fail "systemctl is required"
command -v docker >/dev/null 2>&1 || fail "docker is required before this script can configure restart-on-boot"

if [ -r /etc/os-release ]; then
  # This script is intentionally narrow: it exists to make the current Ubuntu
  # appliance recipe repeatable, not to generalize host setup across distros.
  os_id=$(awk -F= '$1 == "ID" { gsub(/"/, "", $2); print $2 }' /etc/os-release)
  version_id=$(awk -F= '$1 == "VERSION_ID" { gsub(/"/, "", $2); print $2 }' /etc/os-release)
  [ "${os_id}" = "ubuntu" ] || fail "this script only supports Ubuntu hosts"
  case "${version_id}" in
    24.04*) ;;
    *)
      warn "Ubuntu ${version_id} detected. This stack currently standardizes on 24.04.x LTS."
      ;;
  esac
fi

service_home=$(getent passwd "${SERVICE_USER}" | awk -F: 'NR==1 { print $6 }')
[ -n "${service_home}" ] || fail "could not resolve a home directory for ${SERVICE_USER}"
service_gid=$(getent passwd "${SERVICE_USER}" | awk -F: 'NR==1 { print $4 }')
service_group=$(getent group "${service_gid}" | awk -F: 'NR==1 { print $1 }')
[ -n "${service_group}" ] || fail "could not resolve a primary group for ${SERVICE_USER}"

if [ "${SKIP_FIREWALL}" -ne 1 ]; then
  command -v ufw >/dev/null 2>&1 || fail "ufw is required unless --skip-firewall is set"
  info "Configuring ufw for SSH, HTTP, and HTTPS"
  ufw allow "${SSH_PORT}/tcp"
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
fi

if [ "${SKIP_SERVICE}" -ne 1 ]; then
  unit_path="/etc/systemd/system/${SERVICE_NAME}.service"
  info "Writing ${unit_path}"
  cat > "${unit_path}" <<EOF
[Unit]
Description=Memory Engine docker compose stack
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
User=${SERVICE_USER}
Group=${service_group}
WorkingDirectory=${REPO_ROOT}
Environment=HOME=${service_home}
ExecStart=/bin/sh -lc 'docker compose up -d --remove-orphans'
ExecStop=/bin/sh -lc 'docker compose down'
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable docker
  systemctl enable "${SERVICE_NAME}.service"

  if [ "${START_NOW}" -eq 1 ]; then
    info "Starting ${SERVICE_NAME}.service now"
    systemctl start "${SERVICE_NAME}.service"
  fi
fi

info "Ubuntu appliance posture updated."
if [ "${SKIP_SERVICE}" -ne 1 ]; then
  info "Service: ${SERVICE_NAME}.service"
fi
if [ "${SKIP_FIREWALL}" -ne 1 ]; then
  info "Firewall: SSH ${SSH_PORT}/tcp plus HTTP/HTTPS allowed"
fi
