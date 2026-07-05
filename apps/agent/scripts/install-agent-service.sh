#!/usr/bin/env bash
set -euo pipefail

NODE_ID=""
CONTROL_PLANE_WS=""
AGENT_TOKEN=""
AGENT_REF="main"
REPO_URL="https://github.com/enzogh/Tarmac.git"
SSH_USER=""
INSTALL_DIR="/opt/tarmac-agent-build"
SERVICE_FILE="/etc/systemd/system/tarmac-agent.service"
ENV_FILE="/etc/tarmac-agent.env"
BIN_FILE="/usr/local/bin/tarmac-agent"

to_https_repo_url() {
  local input="$1"
  if [[ "$input" =~ ^git@github\.com:(.+)$ ]]; then
    echo "https://github.com/${BASH_REMATCH[1]}"
    return 0
  fi
  if [[ "$input" =~ ^ssh://git@github\.com/(.+)$ ]]; then
    echo "https://github.com/${BASH_REMATCH[1]}"
    return 0
  fi
  echo "$input"
}

clone_repo() {
  local repo_url="$1"
  local clone_output=""
  local clone_cmd=(git clone --depth 1 --branch "$AGENT_REF" "$repo_url" "$INSTALL_DIR")

  if command -v timeout >/dev/null 2>&1; then
    if ! clone_output="$(GIT_TERMINAL_PROMPT=0 timeout 120 "${clone_cmd[@]}" 2>&1)"; then
      echo "$clone_output" >&2
      return 1
    fi
  else
    if ! clone_output="$(GIT_TERMINAL_PROMPT=0 "${clone_cmd[@]}" 2>&1)"; then
      echo "$clone_output" >&2
      return 1
    fi
  fi
  return 0
}

usage() {
  cat <<'EOF'
Usage:
  sudo bash install-agent-service.sh \
    --node-id <node-id> \
    --control-plane-ws <ws-url> \
    --agent-token <shared-token> \
    [--ssh-user <ssh-user>] \
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
    --ssh-user)
      SSH_USER="${2:-}"
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

if [[ -z "$SSH_USER" ]]; then
  if id -u ubuntu >/dev/null 2>&1; then
    SSH_USER="ubuntu"
  else
    SSH_USER="root"
  fi
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
  rsync \
  nfs-common \
  cifs-utils \
  sshpass \
  wireguard-tools \
  iproute2 \
  util-linux

rm -rf "$INSTALL_DIR"
if ! clone_repo "$REPO_URL"; then
  FALLBACK_REPO_URL="$(to_https_repo_url "$REPO_URL")"
  if [[ "$FALLBACK_REPO_URL" != "$REPO_URL" ]]; then
    echo "Primary clone failed, retrying with HTTPS repository URL..." >&2
    rm -rf "$INSTALL_DIR"
    if ! clone_repo "$FALLBACK_REPO_URL"; then
      echo "Repository clone failed for both SSH and HTTPS URLs." >&2
      exit 1
    fi
  else
    echo "Repository clone failed." >&2
    exit 1
  fi
fi

pushd "$INSTALL_DIR/apps/agent" >/dev/null
COMMIT_SHA="$(git -C "$INSTALL_DIR" rev-parse --short HEAD 2>/dev/null || echo dev)"
go build -ldflags "-X main.agentVersion=${COMMIT_SHA}" -o "$BIN_FILE" .
popd >/dev/null

install -m 0644 "$INSTALL_DIR/apps/agent/systemd/tarmac-agent.service" "$SERVICE_FILE"

cat >"$ENV_FILE" <<EOF
NODE_ID=${NODE_ID}
CONTROL_PLANE_WS=${CONTROL_PLANE_WS}
AGENT_TOKEN=${AGENT_TOKEN}
AGENT_SSH_USER=${SSH_USER}
EOF
chmod 0600 "$ENV_FILE"

systemctl daemon-reload
systemctl enable --now tarmac-agent.service
systemctl restart tarmac-agent.service

echo "tarmac-agent.service installed and running."
