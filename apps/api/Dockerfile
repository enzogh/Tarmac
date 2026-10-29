# syntax=docker/dockerfile:1
FROM node:20-bookworm AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm --workspace @tarmac/shared run build
RUN npm --workspace @tarmac/api run prisma:generate
RUN npm --workspace @tarmac/api run build

# Runtime: only the API's production dependencies (no web app, no build
# tooling, no sources), as an unprivileged user.
FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --workspace @tarmac/api --ignore-scripts
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY apps/api/prisma apps/api/prisma
RUN npx prisma generate --schema apps/api/prisma/schema.prisma && rm -rf /root/.cache /root/.npm/_npx
COPY --from=builder /app/apps/api/dist apps/api/dist
COPY apps/api/docker-start.sh apps/api/docker-start.sh
# Files stay owned by root (read-only for the app): the API never writes
# under /app, and a recursive chown would duplicate every file in a new layer.
USER node
EXPOSE 3001
CMD ["sh", "apps/api/docker-start.sh"]
