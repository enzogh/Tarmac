<div align="center">

<img src="apps/web/public/tarmac-mark.svg" alt="Tarmac" width="104" height="104">

# Tarmac

**Control plane pour flottes de serveurs Linux.**

Stockage, réseau overlay WireGuard, DNS autoritaire, réplication et supervision —
pilotés depuis une seule interface, appliqués sur les nœuds par un agent Go.

<img src="https://img.shields.io/badge/Next.js-14-000000?style=flat-square&logo=nextdotjs&logoColor=white" alt="Next.js 14">
<img src="https://img.shields.io/badge/NestJS-10-E0234E?style=flat-square&logo=nestjs&logoColor=white" alt="NestJS 10">
<img src="https://img.shields.io/badge/Go-1.22+-00ADD8?style=flat-square&logo=go&logoColor=white" alt="Go 1.22+">
<img src="https://img.shields.io/badge/PostgreSQL-Prisma-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL + Prisma">

</div>

---

## Sommaire

- [Ce que fait Tarmac](#ce-que-fait-tarmac)
- [Fonctionnalités](#fonctionnalités)
- [Architecture](#architecture)
- [Structure du dépôt](#structure-du-dépôt)
- [Démarrage rapide](#démarrage-rapide)
- [Variables d'environnement](#variables-denvironnement)
- [L'agent](#lagent)
- [API](#api)
- [Déploiement Docker](#déploiement-docker)
- [Développement](#développement)

## Ce que fait Tarmac

Tarmac gère une flotte de serveurs Linux comme un ensemble cohérent plutôt que
machine par machine. On déclare l'état voulu depuis l'interface — ce partage NFS,
ce montage, ce lien overlay, cette zone DNS, ce job de réplication — et un agent
Go installé sur chaque nœud l'applique réellement : `exportfs`, `mount`,
`wg set`, PowerDNS, `rsync`. Une boucle de réconciliation rattrape les ressources
restées en `pending`, y compris celles d'un nœud qui était hors ligne au moment
de la demande.

Dans l'autre sens, chaque agent remonte en continu ses métriques (CPU, RAM,
disque, réseau, I/O), l'état réel de ses volumes, la santé SMART de ses disques
et la qualité de ses liens overlay, ce qui alimente la supervision, les alertes
et les vues topologiques.

## Fonctionnalités

**Stockage**
- Partages NFS et clients autorisés par CIDR, appliqués via `exportfs` et `/etc/exports`
- Montages NFS / CIFS / rclone-SFTP avec sources de secours, persistés dans `/etc/fstab`
- Pools regroupant plusieurs nœuds, avec rôles de membres
- Inventaire des volumes réels (capacité, occupation), typage des disques (NVMe / SSD / HDD) et résolution des membres d'un RAID logiciel
- Prévision de remplissage (`/storage/forecast`) et vue d'ensemble par nœud

**Réseau overlay**
- Maillage WireGuard entre nœuds, clés et endpoints gérés par l'agent
- Segmentation régionale : au-delà de deux régions, un nœud « passerelle » par région relie les régions entre elles, le maillage complet restant intra-région
- Métriques par lien : débit, âge du dernier handshake, latence, perte de paquets
- Tests à la demande, `ping` comme `traceroute`, exécutés en direct sur l'agent
- Historique des liens sur 1 h / 24 h / 7 j avec pourcentage de disponibilité, purgé après 30 jours
- Graphe topologique et carte du monde, positions de nœuds déplaçables et mémorisées

**DNS**
- Zones autoritaires servies par PowerDNS, maîtres comme esclaves (AXFR, TSIG)
- DNSSEC, enregistrements géolocalisés via une base GeoIP mmdb construite et rafraîchie par l'agent
- Résolution interne `*.tarmac.local` avec repli sur `/etc/hosts`
- Détection et résolution assistée des conflits sur le port 53 (systemd-resolved, dnsmasq…)

**Réplication**
- Jobs de synchronisation `rsync` avec remontée de progression en pourcentage et arrêt à la demande
- Tâches de migration de données, avec listing des dossiers d'un nœud en direct
- Sources distantes SSH / SFTP, y compris Storage Box

**Supervision et alertes**
- Règles d'alerte par métrique et par seuil, acquittement et résolution
- Alertes par email via le relais SMTP interne, regroupées en un seul message quand elles arrivent ensemble
- Canaux de notification configurables et testables
- Santé SMART par disque, avec les disques virtualisés sans données exploitables classés « inconnu » plutôt que « critique »
- Journaux d'agent et journal d'audit

**Organisation**
- Workspaces multiples avec appartenances et rôles
- SSO OIDC (Authentik) : les groupes portés par les claims décident de l'accès aux workspaces
- JWT avec rotation de secret sans couper les sessions en cours

## Architecture

```mermaid
flowchart LR
    U(["Navigateur"]) --> W["apps/web<br/>Next.js 14"]
    W -- REST /api/v1 --> A["apps/api<br/>NestJS 10"]
    A --> P[("PostgreSQL<br/>Prisma")]
    A --> R[("Redis")]
    A <-- "WebSocket /agents-ws" --> N1["apps/agent<br/>nœud 1"]
    A <-- "WebSocket /agents-ws" --> N2["apps/agent<br/>nœud 2"]
    A <-- "WebSocket /agents-ws" --> N3["apps/agent<br/>nœud N"]
    N1 <-- WireGuard --> N2
    N2 <-- WireGuard --> N3
    N1 <-- WireGuard --> N3
```

L'agent est le seul à écrire sur les nœuds. Il ouvre lui-même la connexion
WebSocket vers le control plane — aucun port entrant à exposer sur les nœuds —
et la maintient avec reconnexion et backoff. Le control plane y pousse des
commandes (`command.apply_mount`, `command.apply_overlay`,
`command.apply_dns_zone`, `command.run_rsync`…) et reçoit en retour
heartbeats, rapports d'état, progression des commandes et journaux.

## Structure du dépôt

```
apps/
  api/        NestJS + Prisma + PostgreSQL — API /api/v1, WebSocket agents, réconciliation
  web/        Next.js App Router — interface, dashboard par workspace, docs intégrées
  agent/      Go — agent installé sur chaque nœud (systemd)
packages/
  shared/     Types partagés + schémas Zod
docker/       docker-compose, entrypoint PostgreSQL, script de déploiement
docs/         Documentation d'exploitation
```

## Démarrage rapide

### Prérequis

Node.js 20+, npm 10+, Go 1.22+, Docker et Docker Compose.

### Installation

```bash
npm install
docker compose -f docker/docker-compose.yml up -d postgres redis
npm --workspace @tarmac/api run prisma:migrate:dev
npm run seed
npm run dev
```

`npm run dev` lance l'API sur `:3001` et le web sur `:3000`.

### Compte de démonstration

Après `npm run seed` :

| Email | Mot de passe |
| --- | --- |
| `admin@tarmac.local` | `admin123` |

## Variables d'environnement

**API** — `apps/api/.env`

| Variable | Exemple |
| --- | --- |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/tarmac` |
| `JWT_SECRET` | `change-me` |
| `AGENT_SHARED_TOKEN` | `agent-secret` |
| `PORT` | `3001` |

**Web** — `apps/web/.env.local`

| Variable | Exemple |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` |
| `NEXT_PUBLIC_APP_VERSION` | `dev-local` |

**Agent** — environnement du service

| Variable | Exemple |
| --- | --- |
| `CONTROL_PLANE_WS` | `ws://localhost:3001/agents-ws` |
| `AGENT_TOKEN` | `agent-secret` |
| `NODE_ID` | identifiant du nœud côté Tarmac |

En déploiement Docker, tout passe par `docker/.env` :
[`docker/.env.example`](docker/.env.example) documente chaque variable, dont le
SSO Authentik (`AUTHENTIK_*`), le relais SMTP et le regroupement des emails
d'alerte (`SMTP_*`, `ALERT_EMAIL_*`), et les adresses d'écoute.

## L'agent

### En local

```bash
cd apps/agent
go mod tidy
go run .
```

### Ce qu'il remonte

- `agent.heartbeat` toutes les 5 s : CPU, RAM, disque, réseau, I/O, métriques de liens overlay
- `agent.state_report` toutes les 20 s : volumes réels (capacité et occupation) et rapports SMART
- `agent.log` : ses propres journaux, visibles dans l'interface sans ouvrir de SSH
- `command_progress` / `command_result` pour chaque commande reçue

Les collectes coûteuses sont découplées du rythme de remontée : la présence des
binaires, la topologie des disques, les données SMART et les sondes de latence
overlay sont mises en cache et rafraîchies en arrière-plan, et les sondes des
pairs injoignables ralentissent d'elles-mêmes.

### Installer l'agent comme service systemd (Ubuntu 22.04)

Sur une image Ubuntu cloud (OVH par exemple), connectez-vous en `ubuntu` puis
passez root — sur un VPS avec SSH root activé, la connexion root directe suffit :

```bash
ssh ubuntu@<SERVER_IP>
sudo -i
```

```bash
curl -fsSL https://raw.githubusercontent.com/enzogh/Tarmac/main/apps/agent/scripts/install-agent-service.sh | sudo bash -s -- \
  --node-id "<NODE_ID>" \
  --control-plane-ws "ws://<API_HOST>:3001/agents-ws" \
  --agent-token "<AGENT_SHARED_TOKEN>" \
  --ssh-user "ubuntu"
```

Le script installe les dépendances (`golang-go`, `nfs-common`, `cifs-utils`,
`util-linux`), clone le dépôt (avec repli HTTPS si le clone SSH échoue),
compile l'agent et active `tarmac-agent.service` avec redémarrage automatique.
`--ssh-user` est optionnel : à défaut, `ubuntu` s'il existe, sinon `root`.

Détails et désinstallation : [`docs/installation-service-agent.md`](docs/installation-service-agent.md).

## API

Préfixe `/api/v1`. La référence complète, endpoint par endpoint, est servie par
l'application elle-même sur `/docs/api`.

| Domaine | Endpoints |
| --- | --- |
| Auth | `/auth/login`, `/auth/profile`, `/auth/profile/test-email`, `/auth/sso/callback` |
| Nœuds | `/nodes`, `/nodes/:id/metrics` |
| Stockage | `/shares`, `/shares/:id/clients`, `/mounts`, `/mounts/:id/remount`, `/pools`, `/storage/overview`, `/storage/forecast` |
| Réseau | `/vlan`, `/vlan/join`, `/vlan/:id/members`, `/vlan/:id/connections`, `/vlan/:id/status`, `/vlan/:id/history`, `/vlan/:id/test`, `/topology` |
| DNS | `/dns/groups`, `/dns/groups/:id/members`, `/dns/zones`, `/dns/zones/:id/records`, `/dns/zones/:id/dnssec`, `/dns/internal` |
| Réplication | `/sync-jobs`, `/sync-jobs/:id/runs`, `/migrations`, `/migrations/directories` |
| Alertes | `/alert-rules`, `/alerts`, `/alerts/:id/ack`, `/alerts/:id/resolve`, `/notification-channels` |
| Exploitation | `/audit-logs`, `/agent-logs`, `/workspaces` |

## Déploiement Docker

```bash
./docker/deploy.sh
```

Le script calcule `GITHUB_SHA` depuis le checkout local avant de lancer
`docker compose up -d --build`, ce qui alimente la version affichée en bas à
droite de chaque page. `.git` n'est pas envoyé au contexte de build (voir
[`.dockerignore`](.dockerignore)), donc cette valeur doit venir de l'extérieur :
de la CI, ou de `deploy.sh`. Sans elle, la version retombe sur `dev-local`.

Équivalent explicite :

```bash
GITHUB_SHA=$(git rev-parse --short HEAD) docker compose -f docker/docker-compose.yml up -d --build
```

**Persistance.** PostgreSQL dans `docker/data/postgres`, Redis dans
`docker/data/redis` ; un `up --build` ou un redémarrage conserve les données.
PostgreSQL n'est publié qu'en local par défaut (`POSTGRES_BIND=127.0.0.1`) pour
éviter une exposition directe sur Internet. Si `POSTGRES_PASSWORD` change après
la première initialisation, le volume garde l'ancien mot de passe : le wrapper
`docker/postgres-entrypoint-tarmac.sh` réapplique celui configuré au
redémarrage, ce qui évite les `password authentication failed for user
"postgres"` côté Prisma.

## Développement

```bash
npm run lint                      # tsc --noEmit sur api et web
npm run build                     # build des workspaces
cd apps/agent && go build ./...   # compilation de l'agent
cd apps/agent && go test ./...    # tests de l'agent
```

La boucle de réconciliation reprend les shares, mounts et pool_members restés
en `pending` et reste sans effet de bord si l'agent visé est hors ligne.
