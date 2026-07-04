#!/bin/sh
set -eu

sql_escape_literal() {
  printf "%s" "$1" | sed "s/'/''/g"
}

: "${PGDATA:=/var/lib/postgresql/data}"
POSTGRES_PASSWORD_ESCAPED="$(sql_escape_literal "${POSTGRES_PASSWORD:-postgres}")"

# Self-heal for persistent clusters where role attributes were altered.
# Runs before the standard Postgres entrypoint startup.
if [ -f "$PGDATA/global/pg_control" ] || [ -f "$PGDATA/PG_VERSION" ]; then
  echo "Tarmac: enforcing postgres role LOGIN/SUPERUSER/password in existing cluster at $PGDATA..."
  if [ "$(id -u)" = "0" ]; then
    gosu postgres postgres --single -D "$PGDATA" postgres <<SQL
ALTER ROLE postgres WITH LOGIN SUPERUSER PASSWORD '$POSTGRES_PASSWORD_ESCAPED';
SQL
  else
    postgres --single -D "$PGDATA" postgres <<SQL
ALTER ROLE postgres WITH LOGIN SUPERUSER PASSWORD '$POSTGRES_PASSWORD_ESCAPED';
SQL
  fi
fi

exec /usr/local/bin/docker-entrypoint.sh "$@"
