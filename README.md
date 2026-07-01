# Tarmac MVP+V1

Monorepo Tarmac:
- `apps/api` (NestJS + Prisma + PostgreSQL)
- `apps/web` (Next.js App Router)
- `apps/agent` (Go)
- `packages/shared` (types + Zod)

## Prérequis
- Node.js 20+
- npm 10+
- Go 1.22+
- Docker + Docker Compose

## Variables d'environnement
### API (`apps/api/.env`)
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tarmac`
- `JWT_SECRET=change-me`
- `AGENT_SHARED_TOKEN=agent-secret`
- `PORT=3001`

### Web (`apps/web/.env.local`)
- `NEXT_PUBLIC_API_URL=http://localhost:3001`

### Agent
- `CONTROL_PLANE_WS=ws://localhost:3001/agents-ws`
- `AGENT_TOKEN=agent-secret`
- `NODE_ID=<id-node>`

## Démarrage
```bash
npm install
docker compose -f docker/docker-compose.yml up -d postgres redis
npm --workspace @tarmac/api run prisma:migrate:dev
npm run seed
npm run dev
```

## Build / lint
```bash
npm run lint
npm run build
cd apps/agent && go build ./...
```

## Seed admin
- email: `admin@tarmac.local`
- mot de passe: `admin123`

## Agent Go
```bash
cd apps/agent
go mod tidy
go run .
```
L'agent envoie:
- `agent.heartbeat` en temps réel (cpu/ram/disk/network/io)
- `agent.state_report` avec volumes réels (capacité totale + occupation actuelle)
- support `command.apply_mount` avec:
  - source principale + sources fallback (multi NFS)
  - `targetPath` unique (ex: `/data/movies`)
  - `fsType` et `mountOptions` personnalisables

### Installer l'agent comme service systemd (Ubuntu 22.04)
```bash
curl -fsSL https://raw.githubusercontent.com/enzogh/Tarmac/main/apps/agent/scripts/install-agent-service.sh | sudo bash -s -- \
  --node-id "<NODE_ID>" \
  --control-plane-ws "ws://<API_HOST>:3001/agents-ws" \
  --agent-token "<AGENT_SHARED_TOKEN>"
```
Le script installe automatiquement les dépendances nécessaires (`golang-go`, `nfs-common`, `cifs-utils`, `util-linux`), compile l'agent, puis active `tarmac-agent.service` avec auto-restart.

## API V1 (préfixe `/api/v1`)
Auth:
- `POST /auth/login`

Core:
- `GET/POST/PATCH/DELETE /nodes`
- `GET /nodes/:id/metrics`
- `GET/POST/PATCH/DELETE /shares`
- `GET /shares/:id/clients`
- `POST /shares/:id/clients`
- `PATCH /shares/:id/clients/:clientId`
- `DELETE /shares/:id/clients/:clientId`
- `GET/POST/PATCH/DELETE /mounts`
- `POST /mounts/:id/remount`

V1 storage/orchestration:
- `GET/POST/PATCH/DELETE /pools`
- `POST /pools/:id/members`
- `PATCH /pools/:id/members/:nodeId`
- `DELETE /pools/:id/members/:nodeId`
- `GET/POST/PATCH/DELETE /alert-rules`
- `GET/POST /alerts`
- `POST /alerts/:id/ack`
- `POST /alerts/:id/resolve`
- `GET/POST/PATCH/DELETE /notification-channels`
- `POST /notification-channels/:id/test`
- `GET /topology`
- `GET /storage/forecast`
- `GET /storage/overview` (`?nodeId=<id>` optionnel pour filtrer un nœud)
- `GET/POST/PATCH /migrations`
- `POST /migrations/:id/start`
- `POST /migrations/:id/complete`
- `GET/POST/PATCH/DELETE /sync-jobs`
- `GET /sync-jobs/runs`
- `GET /sync-jobs/:id/runs`
- `POST /sync-jobs/:id/runs`
- `GET /audit-logs`

La boucle de reconciliation inclut désormais shares, mounts et pool_members en `pending` et reste safe si un agent est offline.
