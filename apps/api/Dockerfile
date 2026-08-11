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

FROM node:20-bookworm
WORKDIR /app
COPY --from=builder /app /app
RUN chmod +x apps/api/docker-start.sh
EXPOSE 3001
CMD ["sh", "apps/api/docker-start.sh"]
