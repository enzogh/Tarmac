#!/bin/sh
# Wrapper around `docker compose up -d --build` that stamps the build with
# the current commit SHA. GITHUB_SHA has to come from *outside* the Docker
# build context (.git is excluded from it, see ../.dockerignore), so it's
# computed here, on the host, from the real checkout.
set -eu

cd "$(dirname "$0")"

GITHUB_SHA="$(git -C .. rev-parse --short HEAD 2>/dev/null || echo dev-local)"
export GITHUB_SHA

echo "Deploying Tarmac at commit $GITHUB_SHA..."
docker compose up -d --build
