#!/bin/sh
set -e

# Self-heal for persistent clusters where role attributes were altered.
# Runs before the standard Postgres entrypoint startup.
if [ -n "${PGDATA:-}" ] && [ -f "$PGDATA/global/pg_control" ]; then
  echo "Tarmac: enforcing postgres role LOGIN flag in existing cluster..."
  if [ "$(id -u)" = "0" ]; then
    gosu postgres postgres --single -D "$PGDATA" postgres <<SQL >/dev/null
ALTER ROLE postgres WITH LOGIN SUPERUSER PASSWORD '${POSTGRES_PASSWORD:-postgres}';
SQL
  else
    postgres --single -D "$PGDATA" postgres <<SQL >/dev/null
ALTER ROLE postgres WITH LOGIN SUPERUSER PASSWORD '${POSTGRES_PASSWORD:-postgres}';
SQL
  fi
fi

exec /usr/local/bin/docker-entrypoint.sh "$@"
