# syntax=docker/dockerfile:1
FROM node:20-bookworm AS builder
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ARG NEXT_PUBLIC_APP_VERSION=dev-local
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm --workspace @tarmac/shared run build
# .git is excluded from the build context (see .dockerignore), so the git
# SHA can't be detected in-container anymore — it must be passed in via the
# NEXT_PUBLIC_APP_VERSION build arg, computed on the host (docker/deploy.sh
# does this from the real .git checkout, outside Docker entirely).
RUN --mount=type=cache,target=/app/apps/web/.next/cache \
    npm --workspace @tarmac/web run build

# Runtime: Next's standalone server (only the files the app actually needs,
# traced at build time) plus its static assets, as an unprivileged user.
FROM node:20-bookworm-slim
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
