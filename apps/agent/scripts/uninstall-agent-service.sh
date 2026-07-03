#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="tarmac-agent.service"
SERVICE_FILE="/etc/systemd/system/tarmac-agent.service"
ENV_FILE="/etc/tarmac-agent.env"
BIN_FILE="/usr/local/bin/tarmac-agent"
INSTALL_DIR="/opt/tarmac-agent-build"
WG_IFACE="tarmacwg0"
SSH_DIR="/var/lib/tarmac-agent/ssh"
WG_DIR="/var/lib/tarmac-agent/wireguard"

usage() {
  cat <<'EOF'
Usage:
  sudo bash uninstall-agent-service.sh

This script:
  - stops/disables tarmac-agent.service
  - removes WireGuard interface (tarmacwg0)
  - removes Tarmac managed SSH key block from authorized_keys
  - removes agent binaries/config/keys
  - notifies API to remove VLAN membership and distributed SSH keys
EOF
}

read_env_value() {
  local key="$1"
  if [[ ! -f "$ENV_FILE" ]]; then
    return 0
  fi
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE"
}

control_plane_api_base() {
  local ws_url="$1"
  local base="${ws_url%/agents-ws*}"
  if [[ "$base" == wss://* ]]; then
    echo "https://${base#wss://}"
    return 0
  fi
  if [[ "$base" == ws://* ]]; then
    echo "http://${base#ws://}"
    return 0
  fi
  echo ""
}

remove_managed_ssh_keys_block() {
  local target_user="$1"
  if ! id -u "$target_user" >/dev/null 2>&1; then
    return 0
  fi

  local home_dir
  home_dir="$(getent passwd "$target_user" | cut -d: -f6)"
  if [[ -z "$home_dir" ]]; then
    return 0
  fi

  local ssh_dir="${home_dir}/.ssh"
  local authorized_keys="${ssh_dir}/authorized_keys"
  if [[ ! -f "$authorized_keys" ]]; then
    return 0
  fi

  local tmp_file
  tmp_file="$(mktemp)"
  awk '
    BEGIN { skip = 0 }
    /^# BEGIN TARMAC MANAGED KEYS$/ { skip = 1; next }
    /^# END TARMAC MANAGED KEYS$/ { skip = 0; next }
    skip == 0 { print }
  ' "$authorized_keys" >"$tmp_file"
  install -m 0600 "$tmp_file" "$authorized_keys"
  rm -f "$tmp_file"

  if [[ "$(id -u)" -eq 0 ]]; then
    chown "$target_user:$target_user" "$authorized_keys" || true
  fi
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root (sudo)." >&2
  exit 1
fi

NODE_ID="$(read_env_value NODE_ID || true)"
CONTROL_PLANE_WS="$(read_env_value CONTROL_PLANE_WS || true)"
AGENT_TOKEN="$(read_env_value AGENT_TOKEN || true)"
AGENT_SSH_USER="$(read_env_value AGENT_SSH_USER || true)"
if [[ -z "$AGENT_SSH_USER" ]]; then
  AGENT_SSH_USER="root"
fi

systemctl disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true

if ip link show "$WG_IFACE" >/dev/null 2>&1; then
  ip link set "$WG_IFACE" down || true
  ip link delete dev "$WG_IFACE" || true
fi

remove_managed_ssh_keys_block "$AGENT_SSH_USER"

if [[ -n "$NODE_ID" && -n "$CONTROL_PLANE_WS" && -n "$AGENT_TOKEN" ]]; then
  API_BASE="$(control_plane_api_base "$CONTROL_PLANE_WS")"
  if [[ -n "$API_BASE" ]]; then
    curl -fsS -X POST "${API_BASE}/api/v1/agents/uninstall" \
      -H "Content-Type: application/json" \
      --data "{\"nodeId\":\"${NODE_ID}\",\"token\":\"${AGENT_TOKEN}\"}" >/dev/null || true
  fi
fi

rm -rf "$SSH_DIR" "$WG_DIR" "$INSTALL_DIR"
rm -f "$BIN_FILE" "$ENV_FILE" "$SERVICE_FILE"
systemctl daemon-reload

echo "tarmac-agent removed and VLAN/SSH artifacts cleaned."
