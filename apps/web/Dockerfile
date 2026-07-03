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
RUN npm install
COPY . .
RUN npm --workspace @tarmac/shared run build
RUN npm --workspace @tarmac/web run build

FROM node:20-bookworm
WORKDIR /app
COPY --from=builder /app /app
EXPOSE 3000
CMD ["npm", "--workspace", "@tarmac/web", "run", "start"]
