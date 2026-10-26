#!/usr/bin/env bash
# Restauration d'essai d'une sauvegarde de backup-db.sh, dans un Postgres
# jetable (jamais la base de production) : télécharge, déchiffre, restaure,
# puis vérifie que les tables essentielles sont là et non vides.
# Une sauvegarde qu'on n'a jamais restaurée n'est pas une sauvegarde.
#
# Usage : docker/restore-test.sh [nom-du-fichier]   (défaut : la plus récente)
# Code de sortie non nul si la restauration ou une vérification échoue.
set -euo pipefail

cd "$(dirname "$0")"
# .env n'est pas sourcé (valeurs non quotées, ex. SMTP_FROM) : seules les
# clés utiles en sont lues, l'environnement garde la priorité.
env_get() {
  eval "current=\${$1:-}"
  # shellcheck disable=SC2154
  if [ -n "$current" ]; then printf '%s' "$current"; return; fi
  [ -f .env ] && sed -n "s/^$1=//p" .env | tail -n 1
}
BACKUP_RCLONE_DEST="$(env_get BACKUP_RCLONE_DEST)"
BACKUP_PASSPHRASE_FILE="$(env_get BACKUP_PASSPHRASE_FILE)"

: "${BACKUP_RCLONE_DEST:?BACKUP_RCLONE_DEST must be set}"
: "${BACKUP_PASSPHRASE_FILE:?BACKUP_PASSPHRASE_FILE must be set}"
RESTORE_IMAGE="${RESTORE_IMAGE:-postgres:16-alpine}"

NAME="${1:-$(rclone lsf --include 'tarmac-*.dump.gpg' "$BACKUP_RCLONE_DEST" | sort | tail -n 1)}"
[ -n "$NAME" ] || { echo "aucune sauvegarde dans $BACKUP_RCLONE_DEST" >&2; exit 1; }

WORK="$(mktemp -d)"
CONTAINER="tarmac-restore-test-$$"
cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "[$(date -u +%FT%TZ)] test de restauration de $NAME"
rclone copyto "$BACKUP_RCLONE_DEST/$NAME" "$WORK/$NAME"
gpg --batch --quiet --decrypt --passphrase-file "$BACKUP_PASSPHRASE_FILE" -o "$WORK/tarmac.dump" "$WORK/$NAME"

# Pas de port publié : ce conteneur n'est joignable que par docker exec.
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=restore-test -e POSTGRES_DB=tarmac "$RESTORE_IMAGE" >/dev/null
i=0
until docker exec "$CONTAINER" pg_isready -U postgres -d tarmac >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -lt 60 ] || { echo "le Postgres jetable ne démarre pas" >&2; exit 1; }
  sleep 1
done
# pg_isready répond pendant l'initdb ; on attend la vraie instance.
sleep 2

docker cp "$WORK/tarmac.dump" "$CONTAINER:/tmp/tarmac.dump"
docker exec "$CONTAINER" pg_restore -U postgres -d tarmac --no-owner --exit-on-error /tmp/tarmac.dump

query() {
  docker exec "$CONTAINER" psql -U postgres -d tarmac -Atc "$1"
}

FAILED=0
for table in Workspace User Node _prisma_migrations; do
  count="$(query "select count(*) from \"$table\"" 2>/dev/null || echo ERR)"
  if [ "$count" = "ERR" ] || [ "$count" = "0" ]; then
    echo "  ✗ $table : $count" >&2
    FAILED=1
  else
    echo "  ✓ $table : $count ligne(s)"
  fi
done
for table in VpnProfile DnsServerGroup DnsZone Share Mount AuditLog; do
  echo "  · $table : $(query "select count(*) from \"$table\"" 2>/dev/null || echo absente)"
done
# Les secrets doivent être arrivés chiffrés (voir common/secret-box.ts).
plain="$(query "select count(*) from \"VpnProfile\" where \"presharedKey\" not like 'enc:v1:%'" 2>/dev/null || echo 0)"
[ "$plain" = "0" ] || echo "  ! $plain profil(s) VPN avec des clés encore en clair dans la sauvegarde" >&2

if [ "$FAILED" -ne 0 ]; then
  echo "[$(date -u +%FT%TZ)] ÉCHEC du test de restauration de $NAME" >&2
  exit 1
fi
echo "[$(date -u +%FT%TZ)] restauration de $NAME vérifiée"
