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
- `NEXT_PUBLIC_APP_VERSION=dev-local`

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

## Version affichée (toutes les pages)
- Le web affiche `Version <valeur>` en bas à droite sur toutes les pages.
- En Docker Compose, la version est alimentée par `GITHUB_SHA` (commit du build). Sans lui, elle retombe sur `dev-local`.
- `.git` n'est pas envoyé au build Docker (voir `.dockerignore`), donc `GITHUB_SHA` doit être fourni de l'extérieur : soit par la CI (`GITHUB_SHA` du push), soit en déploiement manuel via `docker/deploy.sh`, qui le calcule depuis le checkout local avant de lancer `docker compose up -d --build`.

Déploiement manuel (recommandé, au lieu d'appeler `docker compose` directement) :
```bash
./docker/deploy.sh
```

Équivalent explicite :
```bash
GITHUB_SHA=$(git rev-parse --short HEAD) docker compose -f docker/docker-compose.yml up -d --build
```

## Persistance locale Docker
- Données PostgreSQL persistées dans `docker/data/postgres`
- Données Redis persistées dans `docker/data/redis`
- PostgreSQL est publié en local uniquement par défaut (`POSTGRES_BIND=127.0.0.1`) pour éviter une exposition Internet directe.
- Un `docker compose up --build` ou redémarrage conserve les données existantes.
- Si vous changez `POSTGRES_PASSWORD` après la première initialisation, le volume existant garde l'ancien mot de passe.  
  Le wrapper `docker/postgres-entrypoint-tarmac.sh` réapplique désormais le mot de passe configuré au redémarrage pour éviter les erreurs Prisma (`password authentication failed for user "postgres"`).
- Placez vos variables Docker dans `docker/.env` (exemple: `docker/.env.example`), notamment `NEXT_PUBLIC_API_URL`.

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
- support `command.list_directories` pour remonter en direct les dossiers d'un nœud
- support `command.run_rsync` réel avec remontée de progression en pourcentage

### Installer l'agent comme service systemd (Ubuntu 22.04)
Sur OVH (image Ubuntu cloud), connectez-vous d'abord en `ubuntu`, puis passez root:
```bash
ssh ubuntu@<SERVER_IP>
sudo -i
```

Sur d'autres VPS avec SSH root activé, la connexion root directe fonctionne.

Commande d'installation:
```bash
curl -fsSL https://raw.githubusercontent.com/enzogh/Tarmac/main/apps/agent/scripts/install-agent-service.sh | sudo bash -s -- \
  --node-id "<NODE_ID>" \
  --control-plane-ws "ws://<API_HOST>:3001/agents-ws" \
  --agent-token "<AGENT_SHARED_TOKEN>" \
  --ssh-user "ubuntu"
```
`--ssh-user` est optionnel. Si omis, l'install choisit automatiquement `ubuntu` (si l'utilisateur existe), sinon `root`.
Le script installe automatiquement les dépendances nécessaires (`golang-go`, `nfs-common`, `cifs-utils`, `util-linux`), clone le repo (avec fallback HTTPS si un clone SSH échoue), compile l'agent, puis active `tarmac-agent.service` avec auto-restart.

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
- `GET /migrations/directories` (`?nodeId=<id>&basePath=/chemin`) pour lister les dossiers live d'un serveur
- `POST /migrations/:id/start`
- `POST /migrations/:id/complete`
- `GET/POST/PATCH/DELETE /sync-jobs`
- `GET /sync-jobs/runs`
- `GET /sync-jobs/:id/runs`
- `POST /sync-jobs/:id/runs`
- `GET /audit-logs`

Réseau (VLAN) :
- `GET /vlan` (récupère/crée le VLAN par défaut)
- `POST /vlan/join`
- `GET /vlan/:vlanId/members` (chaque membre est enrichi de sa région géographique)
- `GET /vlan/:vlanId/connections`
- `GET /vlan/:vlanId/status`
- `GET /vlan/:vlanId/history` (`?source=&target=&range=1h|24h|7d`) — historique de latence/perte de paquets + uptime %
- `GET /vlan/:vlanId/tests`
- `POST /vlan/:vlanId/test` (`testType: ping | traceroute`)
- `POST /vlan/:vlanId/members/:nodeId/gateway` — désigne/retire un nœud comme passerelle régionale
- `POST /vlan/heartbeat`

La boucle de reconciliation inclut désormais shares, mounts et pool_members en `pending` et reste safe si un agent est offline.

## Nouveautés récentes

- **Carte du monde** : vue géographique de la flotte (`/dashboard/network`, onglet Carte), en complément du graphe topologique. Positions de nœuds déplaçables à la souris et mémorisées côté serveur (`graphX`/`graphY` sur le graphe, `locationLat`/`locationLng` sur la carte).
- **Segmentation régionale du VLAN** : au-delà de deux régions géographiques, un maillage WireGuard complet devient coûteux. Un nœud par région peut être désigné « passerelle » (`POST /vlan/:vlanId/members/:nodeId/gateway`) ; seules les passerelles se relient entre régions, le reste du mesh est inchangé (maillage complet intra-région, comme avant).
- **Traceroute** : en plus du test ping existant, `POST /vlan/:vlanId/test` avec `testType: "traceroute"` interroge l'agent en temps réel et remonte le détail saut par saut.
- **Historique des liens VLAN** : `GET /vlan/:vlanId/history` renvoie jusqu'à 500 échantillons de latence/perte de paquets sur 1h/24h/7j, ainsi qu'un pourcentage de disponibilité (uptime), purgés automatiquement après 30 jours.
- **Fiabilisation SMART** : un disque virtualisé (VPS) sans données SMART exploitables est désormais classé « inconnu » plutôt que « critique », pour éviter les faux positifs sur les disques virtio.
- **Alertes actives** : le tableau de bord ne compte plus les alertes déjà résolues dans le total « alertes actives ».
