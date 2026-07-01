FROM node:20-bookworm AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install
COPY . .
RUN npm --workspace @tarmac/shared run build
RUN npm --workspace @tarmac/api run prisma:generate
RUN npm --workspace @tarmac/api run build

FROM node:20-bookworm
WORKDIR /app
COPY --from=builder /app /app
EXPOSE 3001
CMD ["sh", "-c", "npx prisma db push --schema apps/api/prisma/schema.prisma --accept-data-loss && node apps/api/dist/main.js"]
