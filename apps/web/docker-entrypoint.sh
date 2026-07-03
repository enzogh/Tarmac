#!/bin/sh
set -eu

if [ "${NEXT_PUBLIC_APP_VERSION:-dev-local}" = "dev-local" ] && [ -f /app/.git-version ]; then
  NEXT_PUBLIC_APP_VERSION="$(cat /app/.git-version)"
  export NEXT_PUBLIC_APP_VERSION
fi

exec "$@"
