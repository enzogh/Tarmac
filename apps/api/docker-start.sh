#!/bin/sh
set -e

echo "Waiting for PostgreSQL to be ready..."
until npx prisma db push --schema apps/api/prisma/schema.prisma --accept-data-loss 2>&1; do
  echo "DB not ready, retrying in 3s..."
  sleep 3
done

echo "DB ready — starting Tarmac API..."
exec node apps/api/dist/main.js
