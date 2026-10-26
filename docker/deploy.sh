#!/bin/sh
# Wrapper around `docker compose up -d --build` that stamps the build with
# the current commit SHA. GITHUB_SHA has to come from *outside* the Docker
# build context (.git is excluded from it, see ../.dockerignore), so it's
# computed here, on the host, from the real checkout.
set -eu

cd "$(dirname "$0")"

GITHUB_SHA="$(git -C .. rev-parse --short HEAD 2>/dev/null || echo dev-local)"
export GITHUB_SHA

# Clé de chiffrement des secrets au repos : générée une seule fois. La perdre
# rend illisibles les clés privées des profils VPN déjà créés, d'où la copie
# à garder hors de cet hôte (gestionnaire de mots de passe, coffre).
if [ -f .env ] && ! grep -q '^TARMAC_SECRETS_KEY=.' .env; then
  printf '\n# Chiffrement des secrets au repos (clés VPN, TSIG). À sauvegarder hors de cet hôte.\nTARMAC_SECRETS_KEY=%s\n' "$(openssl rand -base64 32)" >> .env
  echo "TARMAC_SECRETS_KEY généré dans docker/.env : copiez-le dans votre coffre, il n'est pas dans les sauvegardes de la base."
fi

echo "Deploying Tarmac at commit $GITHUB_SHA..."
docker compose up -d --build
