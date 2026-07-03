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

echo "Applying Prisma schema..."
until npx prisma db push --schema apps/api/prisma/schema.prisma --accept-data-loss 2>&1; do
  echo "DB schema push failed, retrying in 3s..."
  sleep 3
done

echo "DB ready — starting Tarmac API..."
exec node apps/api/dist/main.js
