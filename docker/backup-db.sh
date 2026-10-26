#!/usr/bin/env bash
# Sauvegarde chiffrée et externalisée de la base Tarmac.
#
#   pg_dump (format custom) -> gpg symétrique (AES256) -> rclone vers un
#   stockage hors de cet hôte, puis purge des sauvegardes trop anciennes et,
#   avec --verify, restauration d'essai de ce qui vient d'être envoyé.
#
# La base tourne sur un nœud de la flotte : si ce nœud est perdu, seule une
# copie ailleurs permet de repartir. Variables (dans docker/.env) :
#   BACKUP_RCLONE_DEST        obligatoire, ex. storagebox:tarmac-backups
#   BACKUP_PASSPHRASE_FILE    obligatoire, fichier contenant la phrase gpg
#                             (à garder aussi hors de cet hôte, avec
#                             TARMAC_SECRETS_KEY)
#   BACKUP_RETENTION_DAYS     défaut 30
#   BACKUP_INCLUDE_TELEMETRY  1 pour inclure les métriques/SMART/journaux
#                             agents (plusieurs Go), défaut 0 : la structure
#                             de ces tables est sauvegardée, pas leurs lignes
#
# Usage : docker/backup-db.sh [--verify]
# Cron conseillé : 15 3 * * * /root/.apps/Tarmac/docker/backup-db.sh --verify >> /var/log/tarmac-backup.log 2>&1
set -euo pipefail
VERIFY="${1:-}"

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

: "${BACKUP_RCLONE_DEST:?BACKUP_RCLONE_DEST must be set (ex. storagebox:tarmac-backups)}"
: "${BACKUP_PASSPHRASE_FILE:?BACKUP_PASSPHRASE_FILE must be set}"
RETENTION_DAYS="$(env_get BACKUP_RETENTION_DAYS)"; RETENTION_DAYS="${RETENTION_DAYS:-30}"
INCLUDE_TELEMETRY="$(env_get BACKUP_INCLUDE_TELEMETRY)"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-docker-postgres-1}"
DB="$(env_get POSTGRES_DB)"; DB="${DB:-tarmac}"
DB_USER="$(env_get POSTGRES_USER)"; DB_USER="${DB_USER:-postgres}"

[ -r "$BACKUP_PASSPHRASE_FILE" ] || { echo "phrase de chiffrement illisible : $BACKUP_PASSPHRASE_FILE" >&2; exit 1; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="tarmac-$STAMP.dump.gpg"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

EXCLUDES=()
if [ "${INCLUDE_TELEMETRY:-0}" != "1" ]; then
  # Guillemets inclus : sans eux pg_dump met le motif en minuscules.
  for table in MetricSample SmartReport VlanConnectionSample AgentLog; do
    EXCLUDES+=("--exclude-table-data=\"$table\"")
  done
fi

echo "[$(date -u +%FT%TZ)] dump de $DB"
# pipefail : un pg_dump en échec fait échouer le script au lieu d'envoyer
# un fichier tronqué.
docker exec "$POSTGRES_CONTAINER" pg_dump -U "$DB_USER" -d "$DB" -Fc -Z 6 "${EXCLUDES[@]}" \
  | gpg --batch --yes --quiet --symmetric --cipher-algo AES256 --passphrase-file "$BACKUP_PASSPHRASE_FILE" -o "$WORK/$NAME"

SIZE="$(du -h "$WORK/$NAME" | cut -f1)"
echo "[$(date -u +%FT%TZ)] envoi $NAME ($SIZE) vers $BACKUP_RCLONE_DEST"
rclone copyto "$WORK/$NAME" "$BACKUP_RCLONE_DEST/$NAME"
# Une copie présente côté destination avec la bonne taille, sinon échec.
rclone check --size-only --one-way "$WORK" "$BACKUP_RCLONE_DEST" --include "$NAME" >/dev/null

rclone delete --min-age "${RETENTION_DAYS}d" --include 'tarmac-*.dump.gpg' "$BACKUP_RCLONE_DEST"

if [ "$VERIFY" = "--verify" ]; then
  ./restore-test.sh "$NAME"
fi
echo "[$(date -u +%FT%TZ)] sauvegarde terminée : $NAME"
