#!/bin/sh
set -e

TARGET_DB_NAME=$(node -e "
const raw = process.env.DATABASE_URL;
if (!raw) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const url = new URL(raw);
const dbName = url.pathname.replace(/^\//, '');
if (!dbName) {
  console.error('DATABASE_URL must include a database name');
  process.exit(1);
}
if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(dbName)) {
  console.error('DATABASE_URL contains an unsupported database name');
  process.exit(1);
}
process.stdout.write(dbName);
")

ADMIN_DATABASE_URL=$(node -e "
const raw = process.env.DATABASE_URL;
if (!raw) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const url = new URL(raw);
url.pathname = '/postgres';
process.stdout.write(url.toString());
")

echo "Ensuring PostgreSQL database '$TARGET_DB_NAME' exists..."
while true; do
  set +e
  create_output=$(printf 'CREATE DATABASE "%s";' "$TARGET_DB_NAME" | npx prisma db execute --url "$ADMIN_DATABASE_URL" --stdin 2>&1)
  create_status=$?
  set -e

  if [ "$create_status" -eq 0 ]; then
    echo "Database '$TARGET_DB_NAME' created."
    break
  fi

  if printf '%s' "$create_output" | grep -qi 'already exists'; then
    echo "Database '$TARGET_DB_NAME' already exists."
    break
  fi

  if printf '%s' "$create_output" | grep -Eqi "can't reach database server|connection refused|database system is starting up"; then
    echo "PostgreSQL not ready, retrying in 3s..."
    sleep 3
    continue
  fi

  echo "$create_output"
  exit "$create_status"
done

echo "Migrating away deprecated VlanConnectionTest.testType values (if any)..."
set +e
migrate_test_types_output=$(printf '%s' 'UPDATE "VlanConnectionTest" SET "testType" = '"'"'ping'"'"' WHERE "testType"::text IN ('"'"'connectivity'"'"', '"'"'latency'"'"');' | npx prisma db execute --url "$DATABASE_URL" --stdin 2>&1)
migrate_test_types_status=$?
set -e
if [ "$migrate_test_types_status" -ne 0 ] && ! printf '%s' "$migrate_test_types_output" | grep -qi 'does not exist'; then
  # Table not existing yet (fresh install, schema not pushed at all) is fine —
  # anything else here is unexpected and worth surfacing before the schema push.
  echo "$migrate_test_types_output"
fi

# One-way door: schema changes now go through versioned migrations
# (apps/api/prisma/migrations/), never `prisma db push` again against this
# database — db push --accept-data-loss can silently drop/truncate columns,
# which is fine for a schema with no migration history but not once real
# migrations (with backfill steps like add_workspace) are the source of truth.
echo "Applying Prisma migrations..."
until npx prisma migrate deploy --schema apps/api/prisma/schema.prisma 2>&1; do
  echo "DB migration failed, retrying in 3s..."
  sleep 3
done

echo "DB ready — starting Tarmac API..."
exec node apps/api/dist/main.js
