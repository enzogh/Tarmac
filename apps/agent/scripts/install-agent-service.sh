#!/usr/bin/env bash
set -euo pipefail

NODE_ID=""
CONTROL_PLANE_WS=""
AGENT_TOKEN=""
AGENT_REF="main"
REPO_URL="https://github.com/enzogh/Tarmac.git"
INSTALL_DIR="/opt/tarmac-agent-build"
SERVICE_FILE="/etc/systemd/system/tarmac-agent.service"
ENV_FILE="/etc/tarmac-agent.env"
BIN_FILE="/usr/local/bin/tarmac-agent"

usage() {
  cat <<'EOF'
Usage:
  sudo bash install-agent-service.sh \
    --node-id <node-id> \
    --control-plane-ws <ws-url> \
    --agent-token <shared-token> \
    [--agent-ref <git-ref>] \
    [--repo-url <git-url>]

Example:
  sudo bash install-agent-service.sh \
    --node-id storage-1 \
    --control-plane-ws ws://10.0.0.5:3001/agents-ws \
    --agent-token agent-secret
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --node-id)
      NODE_ID="${2:-}"
      shift 2
      ;;
    --control-plane-ws)
      CONTROL_PLANE_WS="${2:-}"
      shift 2
      ;;
    --agent-token)
      AGENT_TOKEN="${2:-}"
      shift 2
      ;;
    --agent-ref)
      AGENT_REF="${2:-}"
      shift 2
      ;;
    --repo-url)
      REPO_URL="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$NODE_ID" || -z "$CONTROL_PLANE_WS" || -z "$AGENT_TOKEN" ]]; then
  echo "Missing required arguments." >&2
  usage
  exit 1
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root (sudo)." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  git \
  golang-go \
  nfs-common \
  cifs-utils \
  util-linux

rm -rf "$INSTALL_DIR"
git clone --depth 1 --branch "$AGENT_REF" "$REPO_URL" "$INSTALL_DIR"

pushd "$INSTALL_DIR/apps/agent" >/dev/null
go build -o "$BIN_FILE" .
popd >/dev/null

install -m 0644 "$INSTALL_DIR/apps/agent/systemd/tarmac-agent.service" "$SERVICE_FILE"

cat >"$ENV_FILE" <<EOF
NODE_ID=${NODE_ID}
CONTROL_PLANE_WS=${CONTROL_PLANE_WS}
AGENT_TOKEN=${AGENT_TOKEN}
EOF
chmod 0600 "$ENV_FILE"

systemctl daemon-reload
systemctl enable --now tarmac-agent.service
systemctl restart tarmac-agent.service

echo "tarmac-agent.service installed and running."
