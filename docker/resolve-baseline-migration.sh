#!/bin/sh
# One-time, one-way step required before the first deploy that switches
# docker-start.sh from `prisma db push` to `prisma migrate deploy`
# (see apps/api/prisma/migrations/).
#
# This server's database already has every table from years of `db push` -
# it just has no migration history. This script tells Prisma "the baseline
# migration's tables already exist, don't try to CREATE them again", by
# recording apps/api/prisma/migrations/0_baseline as already-applied in the
# `_prisma_migrations` bookkeeping table. It does NOT run the baseline
# migration's SQL, and it does NOT touch any of your actual data (Node,
# Share, User, etc. rows are untouched).
#
# Run this ONCE, on this server, from the docker/ directory, BEFORE
# deploying the new API image (the one whose docker-start.sh calls
# `migrate deploy`). Safe to re-run: if the baseline is already resolved,
# it says so and exits cleanly instead of erroring.
#
# Usage: ./resolve-baseline-migration.sh [-y]
#   -y   skip the confirmation prompt (for non-interactive use)

set -e

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

SKIP_CONFIRM=0
if [ "$1" = "-y" ] || [ "$1" = "--yes" ]; then
  SKIP_CONFIRM=1
fi

if [ ! -f docker-compose.yml ]; then
  echo "Erreur : docker-compose.yml introuvable dans $SCRIPT_DIR" >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "Erreur : $SCRIPT_DIR/.env introuvable - ce script doit tourner à côté de la vraie" >&2
  echo "config de prod (mêmes identifiants Postgres que le déploiement en cours)." >&2
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "Erreur : ni 'docker compose' ni 'docker-compose' n'est disponible sur cet hôte." >&2
  exit 1
fi

echo "== Résolution de la migration baseline Prisma =="
echo
echo "Ceci va :"
echo "  1. (Re)construire l'image api à partir du code actuel (contient désormais"
echo "     apps/api/prisma/migrations/)."
echo "  2. Se connecter à la base Postgres de ce déploiement (service 'postgres'"
echo "     de ce docker-compose.yml, donc vos vraies données de prod)."
echo "  3. Marquer la migration '0_baseline' comme déjà appliquée, sans exécuter"
echo "     son SQL et sans modifier la moindre ligne de vos tables."
echo

if [ "$SKIP_CONFIRM" -ne 1 ]; then
  printf "Continuer ? [y/N] "
  read -r REPLY
  case "$REPLY" in
    [yY]|[yY][eE][sS]) ;;
    *) echo "Annulé."; exit 1 ;;
  esac
fi

echo
echo "-> S'assure que Postgres tourne..."
$DC up -d postgres
echo

echo "-> Construction de l'image api à jour..."
$DC build api
echo

echo "-> État des migrations avant intervention :"
$DC run --rm --no-deps api npx prisma migrate status --schema apps/api/prisma/schema.prisma || true
echo

echo "-> Marquage de 0_baseline comme déjà appliquée..."
if $DC run --rm --no-deps api npx prisma migrate resolve --applied 0_baseline --schema apps/api/prisma/schema.prisma; then
  echo
  echo "OK : baseline résolue."
else
  echo
  echo "La commande a échoué - si le message ci-dessus dit que 0_baseline est déjà"
  echo "marquée comme appliquée, c'est normal (script déjà exécuté avant), rien de"
  echo "plus à faire. Sinon, ne déployez pas la nouvelle image tant que ce n'est"
  echo "pas résolu : redémarrer l'ancienne image continuera de fonctionner avec"
  echo "'db push' comme avant, sans aucun risque pour les données existantes."
  exit 1
fi

echo
echo "-> État des migrations après intervention :"
$DC run --rm --no-deps api npx prisma migrate status --schema apps/api/prisma/schema.prisma || true

echo
echo "Terminé. Vous pouvez maintenant déployer normalement (ex: '$DC up -d')."
echo "Le prochain démarrage du conteneur api exécutera 'prisma migrate deploy',"
echo "qui appliquera la migration add_workspace (crée le workspace 'Default' et"
echo "y rattache tous les nœuds/shares/etc. existants automatiquement)."
