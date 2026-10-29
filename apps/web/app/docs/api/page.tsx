import {
  BrickWallFire,
  Lock,
  Server,
  Share2,
  HardDrive,
  RefreshCw,
  ArrowRightLeft,
  Repeat,
  Network,
  Database,
  Bell,
  History,
  Cpu,
  Code2,
  Globe,
  LayoutGrid,
  ScrollText,
  Info,
  ShieldCheck,
  KeyRound,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '../../../components/PageHeader';
import { Callout } from '../../../components/Callout';
import { SectionLabel } from '../../../components/SectionLabel';
import { AnimatedGradientText } from '../../../components/ui/animated-gradient-text';
import { Badge } from '../../../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card';
import { cn } from '../../../lib/utils';
import type { ApiKeyResource, ApiKeyScope } from '../../../lib/api';
import { API_KEY_RESOURCES, RESOURCE_BY_ID } from '../../../lib/api-key-permissions';
import { ApiPermissionsTable, moduleAnchor } from '../../../components/docs/ApiPermissionsTable';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

type Endpoint = {
  method: Method;
  path: string;
  auth?: 'public' | 'token';
  // Scope an API key needs, when it differs from the module's default
  // (GET = read, anything else = write) - e.g. a POST that only reads.
  apiScope?: ApiKeyScope;
  body?: string;
  description: string;
  isNew?: boolean;
};

type Module = {
  name: string;
  base: string;
  icon: LucideIcon;
  description: string;
  // Whole module added recently — badged once on the module rather than on
  // each of its endpoints, which would just be a wall of green.
  isNew?: boolean;
  endpoints: Endpoint[];
};

// Which key permission opens each module, straight from the catalogue the
// key editor uses - the two can't drift apart.
const MODULE_RESOURCE: Record<string, ApiKeyResource> = Object.fromEntries(
  API_KEY_RESOURCES.flatMap((resource) => resource.modules.map((module) => [module, resource.id])),
);

// null = session only (or its own dedicated auth): no API key reaches it.
function endpointScope(module: Module, endpoint: Endpoint): ApiKeyScope | null {
  if (endpoint.auth) return null;
  if (endpoint.apiScope) return endpoint.apiScope;
  const resource = MODULE_RESOURCE[module.name];
  if (!resource) return null;
  return `${resource}:${endpoint.method === 'GET' ? 'read' : 'write'}`;
}

const METHOD_VARIANT: Record<Method, 'info' | 'success' | 'warning' | 'destructive'> = {
  GET: 'info',
  POST: 'success',
  PATCH: 'warning',
  DELETE: 'destructive',
};

const MODULES: Module[] = [
  {
    name: 'Authentification',
    base: '/auth',
    icon: Lock,
    description: "Connexion, session et profil de l'administrateur.",
    endpoints: [
      {
        method: 'POST',
        path: '/auth/login',
        auth: 'public',
        body: 'email, password',
        description:
          'Vérifie les identifiants et pose un cookie de session httpOnly (aucun jeton renvoyé dans la réponse). Limité à 5 tentatives/min par IP.',
      },
      {
        method: 'POST',
        path: '/auth/logout',
        body: 'aucun',
        description: 'Efface le cookie de session côté serveur.',
        isNew: true,
      },
      { method: 'GET', path: '/auth/profile', description: "Profil de l'utilisateur authentifié." },
      {
        method: 'PATCH',
        path: '/auth/profile',
        body: 'email?, currentPassword?, newPassword?',
        description: "Met à jour l'e-mail et/ou le mot de passe (l'ancien mot de passe est requis pour en changer).",
      },
      {
        method: 'GET',
        path: '/auth/sso/login',
        auth: 'public',
        description: "Démarre la connexion Authentik (OIDC + PKCE) et redirige vers le fournisseur d'identité.",
        isNew: true,
      },
      {
        method: 'GET',
        path: '/auth/sso/silent',
        auth: 'public',
        description:
"Même flux, mais sans interaction (prompt=none) : utilisé au chargement de l'interface pour reprendre une session Authentik existante sans écran de connexion.",
        isNew: true,
      },
      {
        method: 'GET',
        path: '/auth/sso/callback',
        auth: 'public',
        description:
"Retour du fournisseur d'identité : échange le code, crée ou retrouve le compte, synchronise les workspaces déduits des groupes Authentik, puis pose le cookie de session.",
        isNew: true,
      },
    ],
  },
  {
    name: 'Workspaces',
    base: '/workspaces',
    isNew: true,
    icon: LayoutGrid,
    description:
"Flottes cloisonnées : chaque workspace a son sous-réseau privé, ses ressources et ses membres. L'en-tête X-Workspace-Id sélectionne celui sur lequel porte la requête.",
    endpoints: [
      {
        method: 'GET',
        path: '/workspaces',
        description: "Liste les workspaces accessibles à l'appelant (tous, pour un administrateur de plateforme).",
      },
      {
        method: 'POST',
        path: '/workspaces',
        body: 'name',
        description:
"Crée un workspace, lui alloue un sous-réseau privé libre et provisionne son VLAN. Réservé aux administrateurs de plateforme.",
      },
      {
        method: 'PATCH',
        path: '/workspaces/:id',
        body: 'name?, slug?, ssoGroupClaim?',
        description:
"Renomme le workspace, change son identifiant d'URL (slug) et/ou le groupe Authentik qui accorde automatiquement l'accès. L'ancien slug reste une redirection et ne peut être repris par aucun autre workspace ; les agents ne sont pas concernés. Administrateur du workspace ou de plateforme.",
      },
      { method: 'GET', path: '/workspaces/users', description: 'Liste tous les comptes (administrateur de plateforme).' },
      { method: 'GET', path: '/workspaces/:id/members', description: "Liste les membres d'un workspace, avec leur rôle (owner ou member) et leurs permissions." },
      {
        method: 'POST',
        path: '/workspaces/:id/members/:userId',
        description: "Rattache un compte existant par son identifiant (administrateur de plateforme).",
      },
      {
        method: 'POST',
        path: '/workspaces/:id/invite',
        body: 'email, role?, permissions?',
        description:
"Ajoute par e-mail un compte déjà existant, avec son rôle : owner (administrateur) ou member, dont les permissions reprennent les scopes des clés API (ex. nodes:read, dns:write). Aucun e-mail n'est envoyé, l'accès est immédiat.",
      },
      {
        method: 'PATCH',
        path: '/workspaces/:id/members/:userId',
        body: 'role?, permissions?',
        description:
"Change le rôle ou les permissions d'un membre. Impossible sur soi-même, et le dernier administrateur ne peut pas être rétrogradé. Tracé dans le journal.",
        isNew: true,
      },
      { method: 'DELETE', path: '/workspaces/:id/members/:userId', description: "Retire un membre (un administrateur ne peut pas se retirer lui-même)." },
      {
        method: 'DELETE',
        path: '/workspaces/:id',
        description: "Supprime le workspace, uniquement s'il est réellement vide (aucun nœud, partage, zone ni tâche).",
      },
    ],
  },
  {
    name: 'Nœuds',
    base: '/nodes',
    icon: Server,
    description: 'Enregistrement, onboarding et supervision des serveurs de la flotte.',
    endpoints: [
      { method: 'GET', path: '/nodes', description: 'Liste tous les nœuds.' },
      { method: 'POST', path: '/nodes', body: 'name, role, status?', description: 'Enregistre un nœud manuellement (sans onboarding SSH).' },
      { method: 'POST', path: '/nodes/onboarding/start', body: 'name, provider, hostIp, sshUsername, authMethod? (password | key), sshPassword | sshPrivateKey, sshKeyPassphrase?, sudoPassword?', description: "Démarre l'onboarding guidé : connexion SSH et préparation de la clé de déploiement." },
      { method: 'POST', path: '/nodes/onboarding/:id/install', body: 'deployKeyConfirmed', description: "Finalise l'onboarding une fois la clé de déploiement confirmée." },
      {
        method: 'PATCH',
        path: '/nodes/:id',
        body: 'name?, role?, status?, dnsHostname?, locationCity?, locationCountry?, locationCountryCode?, locationLat?, locationLng?, graphX?, graphY?',
        description:
"Met à jour un nœud (statut, rôle, localisation). graphX/graphY et locationLat/locationLng mémorisent respectivement la position glissée sur le graphe topologique et sur la carte du monde (envoyer null pour réinitialiser). dnsHostname personnalise le nom du nœud en <nom>.tarmac.local sur le DNS interne.",
      },
      { method: 'DELETE', path: '/nodes/:id', description: 'Supprime un nœud.' },
      { method: 'POST', path: '/nodes/:id/rotate-token', description: "Régénère le jeton d'authentification de l'agent pour ce nœud." },
      { method: 'POST', path: '/nodes/rotate-tokens', description: "Régénère les jetons d'agent pour tous les nœuds." },
      {
        method: 'POST',
        path: '/nodes/:id/mute',
        body: 'minutes',
        description: 'Met les alertes automatiques (règles de seuil, SMART) en silence pour ce nœud le temps indiqué (fenêtre de maintenance).',
        isNew: true,
      },
      { method: 'POST', path: '/nodes/:id/unmute', description: 'Réactive les alertes avant la fin de la fenêtre de silence.', isNew: true },
      { method: 'GET', path: '/nodes/activity?range=', description: "Flux d'activité de la flotte, avec état SMART par disque (défaut: 1h)." },
      { method: 'GET', path: '/nodes/:id/metrics?range=', description: "Historique de métriques d'un nœud (défaut: 1h)." },
      {
        method: 'GET',
        path: '/nodes/:id/disks/:diskName/smart-history',
        description: 'Historique des relevés SMART (température, secteurs réalloués/en attente) pour un disque physique donné.',
        isNew: true,
      },
    ],
  },
  {
    name: 'Agents',
    base: '/agents',
    icon: Cpu,
    description: "Contrôle à distance de l'agent installé sur chaque nœud.",
    endpoints: [
      {
        method: 'POST',
        path: '/agents/:nodeId/update',
        body: 'ref?, repoUrl?, serviceName?',
        description: "Recompile l'agent depuis le dépôt et redémarre le service sur le nœud (utilisé aussi par « Mettre à jour tous les agents », qui appelle cette route en parallèle sur chaque nœud en ligne). Avec une clé API, seul ref est accepté : le dépôt configuré ne peut pas être remplacé.",
      },
      {
        method: 'POST',
        path: '/agents/uninstall',
        auth: 'token',
        body: 'nodeId, token',
        description: "Route interne appelée par l'agent lui-même lors de sa désinstallation, authentifiée par un jeton dédié (pas le cookie de session).",
      },
    ],
  },
  {
    name: 'Partages NFS',
    base: '/shares',
    icon: Share2,
    description: 'Partages exposés par un nœud et contrôle des accès clients.',
    endpoints: [
      { method: 'GET', path: '/shares', description: 'Liste les partages.' },
      { method: 'POST', path: '/shares', body: 'name, path, nodeId?', description: 'Crée un partage NFS.' },
      { method: 'PATCH', path: '/shares/:id', body: 'name?, path?, nodeId?, status?', description: 'Met à jour un partage.' },
      { method: 'DELETE', path: '/shares/:id', description: 'Supprime un partage.' },
      { method: 'POST', path: '/shares/:id/reapply', description: "Réapplique la configuration du partage sur l'agent du nœud (après une erreur, par exemple)." },
      { method: 'GET', path: '/shares/:id/clients', description: "Liste les accès clients d'un partage." },
      { method: 'POST', path: '/shares/:id/clients', body: 'clientId, access', description: 'Ajoute ou met à jour un accès client (ro, rw, deny).' },
      { method: 'PATCH', path: '/shares/:id/clients/:clientId', body: 'access', description: "Change le niveau d'accès d'un client." },
      { method: 'DELETE', path: '/shares/:id/clients/:clientId', description: "Retire l'accès d'un client." },
    ],
  },
  {
    name: 'Montages',
    base: '/mounts',
    icon: HardDrive,
    description: 'Montage de sources NFS, CIFS ou SFTP (rclone) sur un nœud.',
    endpoints: [
      { method: 'GET', path: '/mounts', description: 'Liste les montages.' },
      { method: 'POST', path: '/mounts', body: 'name, sourcePath, additionalSources?, targetPath, fsType?, mountOptions?, nodeId?, remoteHost?, remoteUser?, remoteSshPort?', description: 'Crée un montage (NFS, CIFS, ou rclone-sftp pour un hôte distant).' },
      { method: 'PATCH', path: '/mounts/:id', body: '(idem create) + status?', description: 'Met à jour un montage.' },
      { method: 'POST', path: '/mounts/:id/remount', description: 'Déclenche un remontage sur le nœud cible.' },
      { method: 'DELETE', path: '/mounts/:id', description: 'Supprime un montage.' },
    ],
  },
  {
    name: 'Pools & réplication',
    base: '/pools',
    icon: RefreshCw,
    description: "Regroupement de nœuds autour d'une stratégie de stockage partagée.",
    endpoints: [
      { method: 'GET', path: '/pools', description: 'Liste les pools.' },
      { method: 'POST', path: '/pools', body: 'name, strategy, status?', description: 'Crée un pool.' },
      { method: 'PATCH', path: '/pools/:id', body: 'name?, strategy?, status?', description: 'Met à jour un pool.' },
      { method: 'DELETE', path: '/pools/:id', description: 'Supprime un pool.' },
      { method: 'POST', path: '/pools/:id/members', body: 'nodeId, role, status', description: 'Ajoute ou met à jour un membre du pool (primary/replica).' },
      { method: 'PATCH', path: '/pools/:id/members/:nodeId', body: 'role, status', description: "Met à jour le rôle/statut d'un membre." },
      { method: 'DELETE', path: '/pools/:id/members/:nodeId', description: 'Retire un membre du pool.' },
    ],
  },
  {
    name: 'Migrations',
    base: '/migrations',
    icon: ArrowRightLeft,
    description: 'Déplacement de volumes entre nœuds, seedbox ou Storage Box — y compris les migrations de sécurisation suggérées automatiquement.',
    endpoints: [
      { method: 'GET', path: '/migrations', description: 'Liste les migrations, y compris celles suggérées automatiquement (préfixe [Auto]) suite à un disque SMART critique.' },
      { method: 'GET', path: '/migrations/directories?nodeId=&basePath=', description: "Liste les dossiers d'un nœud (via l'agent)." },
      { method: 'GET', path: '/migrations/directories/scan?nodeId=&basePath=&maxEntries=', description: 'Scanne les dossiers avec une limite de résultats.' },
      { method: 'POST', path: '/migrations/directories/remote', apiScope: 'storage:read', body: 'nodeId, host, username, password?, basePath?, port?, endpointType?', description: 'Liste les dossiers sur un endpoint distant (seedbox / Storage Box) via un nœud relais.' },
      { method: 'POST', path: '/migrations', body: 'name, source*, target*, sourceKind?, targetKind?, ...', description: 'Crée une migration.' },
      { method: 'PATCH', path: '/migrations/:id', body: 'name?, notes?, status?, progress?', description: 'Met à jour une migration.' },
      { method: 'POST', path: '/migrations/:id/start', description: 'Démarre le transfert. Les migrations suggérées automatiquement restent en attente tant que ce n’est pas appelé — rien ne se lance tout seul.' },
      { method: 'POST', path: '/migrations/:id/retry', description: 'Relance une migration en échec.' },
      { method: 'POST', path: '/migrations/:id/stop', description: 'Arrête une migration en cours.' },
      { method: 'POST', path: '/migrations/:id/complete', description: 'Marque la migration comme terminée.' },
      { method: 'DELETE', path: '/migrations/:id', description: 'Supprime une migration en attente.' },
    ],
  },
  {
    name: 'Tâches de synchronisation',
    base: '/sync-jobs',
    icon: Repeat,
    description: 'Tâches planifiées de type rsync entre deux chemins, déclenchables aussi depuis un outil externe.',
    endpoints: [
      { method: 'GET', path: '/sync-jobs', description: 'Liste les tâches de synchronisation.' },
      { method: 'POST', path: '/sync-jobs', body: 'name, sourcePath, targetPath, schedule, nodeId?, sourceHost?, sourceUser?, sourceSshPort?', description: 'Crée une tâche planifiée.' },
      { method: 'PATCH', path: '/sync-jobs/:id', body: 'name?, sourcePath?, targetPath?, schedule?, nodeId?, status?', description: 'Met à jour une tâche.' },
      { method: 'DELETE', path: '/sync-jobs/:id', description: 'Supprime une tâche.' },
      { method: 'GET', path: '/sync-jobs/runs', description: "Historique d'exécution, toutes tâches confondues." },
      { method: 'GET', path: '/sync-jobs/:id/runs', description: "Historique d'exécution d'une tâche." },
      { method: 'POST', path: '/sync-jobs/:id/runs', description: 'Déclenche une exécution immédiate.' },
      { method: 'POST', path: '/sync-jobs/:id/trigger-token/rotate', description: 'Régénère le jeton externe de la tâche (affiché une seule fois ; l’ancien est immédiatement invalidé).' },
      {
        method: 'POST',
        path: '/sync-jobs/:id/trigger?relativePath=',
        auth: 'token',
        description: "Déclenche la tâche depuis un outil externe (ex: script « on completion » de qBittorrent). Authentifié par l'en-tête X-Trigger-Token, pas par cookie de session. relativePath limite la synchro à un sous-dossier.",
      },
    ],
  },
  {
    name: 'Réseau (VLAN)',
    base: '/vlan',
    icon: Network,
    description: 'Réseau privé entre nœuds, segmentation régionale par passerelles, carte du monde et tests de connectivité (ping, traceroute).',
    endpoints: [
      { method: 'GET', path: '/vlan', description: 'Récupère (ou crée) le VLAN par défaut de la flotte.' },
      { method: 'POST', path: '/vlan/join', body: 'nodeId, vlanName?', description: 'Rattache un nœud au VLAN.' },
      { method: 'GET', path: '/vlan/:vlanId/members', description: 'Liste les membres du VLAN, chacun enrichi de sa région géographique déduite (europe, north-america, asia, …).' },
      { method: 'GET', path: '/vlan/:vlanId/connections', description: 'Liste les connexions inter-nœuds du VLAN.' },
      { method: 'GET', path: '/vlan/:vlanId/status', description: 'État de santé global du VLAN.' },
      {
        method: 'GET',
        path: '/vlan/:vlanId/history?source=&target=&range=',
        description: "Historique des échantillons de latence/perte de paquets entre deux nœuds (1h/24h/7d, 500 points max) et le pourcentage de disponibilité (uptime) sur la période.",
        isNew: true,
      },
      { method: 'GET', path: '/vlan/:vlanId/tests', description: 'Historique des tests de connectivité (ping et traceroute).' },
      {
        method: 'POST',
        path: '/vlan/:vlanId/test',
        body: 'initiatorNodeId, targetNodeId, testType (ping | traceroute)',
        description: 'Lance un test entre deux nœuds membres. « ping » mesure latence/perte de paquets via le lien VLAN existant ; « traceroute » interroge l’agent du nœud initiateur en temps réel et renvoie le détail saut par saut.',
      },
      {
        method: 'POST',
        path: '/vlan/:vlanId/members/:nodeId/gateway',
        body: 'enabled',
        description: "Désigne (ou retire) ce nœud comme passerelle régionale : au-delà de deux régions géographiques, seules les passerelles se relient entre régions, les autres nœuds restent en maillage complet au sein de leur région. Un seul nœud passerelle par région et par VLAN ; en activer un remplace l'ancien. Déclenche une reconfiguration WireGuard sur toute la flotte.",
        isNew: true,
      },
      { method: 'POST', path: '/vlan/heartbeat', body: 'nodeId, vlanId?', description: 'Enregistre un battement de vie VLAN pour un nœud.' },
    ],
  },
  {
    name: 'DNS',
    base: '/dns',
    isNew: true,
    icon: Globe,
    description:
"Serveurs DNS de la flotte (PowerDNS), zones faisant autorité, enregistrements, DNSSEC et délégation — ainsi que le résolveur interne *.tarmac.local.",
    endpoints: [
      { method: 'GET', path: '/dns/groups', description: 'Liste les groupes DNS, avec leurs membres et leurs zones.' },
      { method: 'POST', path: '/dns/groups', body: 'name', description: 'Crée un groupe de serveurs DNS.' },
      { method: 'PATCH', path: '/dns/groups/:id', body: 'name?', description: 'Renomme un groupe.' },
      {
        method: 'DELETE',
        path: '/dns/groups/:id',
        description: "Supprime un groupe — refusé tant qu'il lui reste une zone. Désinstalle PowerDNS sur chaque membre.",
      },
      {
        method: 'POST',
        path: '/dns/groups/:id/members',
        body: 'nodeId, role (primary | secondary), status?',
        description: "Ajoute un serveur au groupe (1 primaire + 3 secondaires maximum) et provisionne PowerDNS sur le nœud.",
      },
      { method: 'PATCH', path: '/dns/groups/:id/members/:nodeId', body: 'role?, status?', description: "Change le rôle ou le statut d'un membre." },
      { method: 'DELETE', path: '/dns/groups/:id/members/:nodeId', description: 'Retire un serveur du groupe et nettoie sa configuration DNS.' },
      {
        method: 'POST',
        path: '/dns/groups/:id/members/:nodeId/maintenance',
        body: 'upgrade?',
        description:
          "Met à jour PowerDNS sur ce serveur (upgrade: true), avec sauvegarde et retour automatique à la version actuelle en cas d'échec, ou relance une maintenance que l'agent a abandonnée.",
      },
      {
        method: 'POST',
        path: '/dns/groups/:id/members/:nodeId/resolve-port-conflict',
        description:
"Demande au nœud de libérer le port 53 occupé par un autre résolveur (systemd-resolved, PowerDNS installé hors Tarmac…), puis relance le provisionnement.",
      },
      { method: 'GET', path: '/dns/zones?groupId=', description: 'Liste les zones, avec leurs enregistrements et les valeurs rattachées à un nœud.' },
      { method: 'POST', path: '/dns/zones', body: 'groupId, name, dnssecEnabled?', description: 'Crée une zone sur le groupe indiqué (DNSSEC activé par défaut).' },
      {
        method: 'PATCH',
        path: '/dns/zones/:id',
        body: 'dnssecEnabled',
        description: 'Active ou désactive DNSSEC sur la zone. Désactiver supprime ses clés : retirez d’abord l’enregistrement DS chez le registrar s’il y est publié.',
      },
      { method: 'POST', path: '/dns/zones/:id/reapply', description: 'Repousse la zone complète sur tous les serveurs du groupe.' },
      { method: 'DELETE', path: '/dns/zones/:id', description: 'Supprime la zone, y compris sur les serveurs secondaires qui en détiennent une copie.' },
      {
        method: 'GET',
        path: '/dns/zones/:id/dnssec',
        description: "Clés DS/DNSKEY à publier chez le registrar, lues en direct sur le serveur primaire (jamais stockées côté control plane).",
      },
      {
        method: 'GET',
        path: '/dns/zones/:id/delegation',
        description: "Serveurs de noms à déclarer (ns1/ns2…), leurs glue records, et le dernier résultat de vérification de la délégation.",
      },
      { method: 'POST', path: '/dns/zones/:id/delegation/check', apiScope: 'dns:read', description: 'Relance immédiatement la vérification de la délégation depuis Internet.' },
      {
        method: 'POST',
        path: '/dns/zones/:id/records',
        body: 'name, type, ttl?, isGeo?, values[] (content, nodeId?, priority?)',
        description:
"Crée ou met à jour un enregistrement. isGeo rend la réponse géolocalisée (le nœud le plus proche du demandeur) ; nodeId rattache une valeur à un nœud de la flotte.",
      },
      { method: 'DELETE', path: '/dns/zones/:id/records/:recordId', description: 'Supprime un enregistrement.' },
      { method: 'GET', path: '/dns/nodes/:nodeId/records', description: 'Recherche inverse : quels enregistrements pointent vers ce nœud.' },
      { method: 'GET', path: '/dns/internal', description: 'État du résolveur interne du workspace (nœud désigné, statut, noms servis).' },
      {
        method: 'POST',
        path: '/dns/internal/:nodeId',
        description: "Désigne ce nœud comme résolveur interne *.tarmac.local et diffuse la route DNS à toute la flotte.",
      },
      { method: 'DELETE', path: '/dns/internal', description: 'Retire le résolveur interne et nettoie la configuration des nœuds.' },
      {
        method: 'POST',
        path: '/dns/internal/forwarder/:nodeId/resolve-conflict',
        description: "Libère le port du transitaire interne quand un autre service DNS a été installé par-dessus.",
      },
    ],
  },
  {
    name: 'Pare-feu',
    base: '/firewall',
    icon: BrickWallFire,
    description:
      "Qui peut joindre vos serveurs, entre eux (réseau privé) et depuis Internet. Les règles sont appliquées par l'agent de chaque serveur ; les blocages passent toujours avant les autorisations.",
    endpoints: [
      {
        method: 'GET',
        path: '/firewall',
        description: 'État complet : réglages, serveurs (mode Internet, ports en écoute, état d’application), règles, flux autorisés par Tarmac, matrice « qui joint qui ».',
      },
      {
        method: 'PATCH',
        path: '/firewall/settings',
        body: 'meshMode?, publicPing?, sshGuard?, sshLimit?',
        description:
          'Mode du réseau privé (open, observe, enforce), réponse au ping, protection anti-verrouillage SSH et limite des tentatives SSH depuis Internet.',
        isNew: true,
      },
      { method: 'PATCH', path: '/firewall/nodes', body: 'nodeIds, publicMode', description: 'Filtrage Internet de plusieurs serveurs d’un coup (open, observe, enforce).' },
      {
        method: 'POST',
        path: '/firewall/rules',
        body: 'scope, action, name, sourceKind, sourceNodeIds?, sourceLabels?, sourceCidrs?, targetKind, targetNodeIds?, targetLabels?, protocol, ports, expiresAt?',
        description: 'Crée une règle. scope : mesh ou public ; action : allow ou deny ; ports : "22", "8000-8100".',
      },
      { method: 'PATCH', path: '/firewall/rules/:id', description: 'Met à jour une règle (dont enabled pour la désactiver).' },
      { method: 'DELETE', path: '/firewall/rules/:id', description: 'Supprime une règle.' },
      {
        method: 'POST',
        path: '/firewall/test',
        body: 'scope, targetNodeId, sourceNodeId?, sourceIp?, protocol, port?',
        description: 'Simule une connexion et dit si elle passerait, et pourquoi. Lecture seule (permission firewall:read).',
      },
      { method: 'GET', path: '/firewall/events?hours=&scope=&verdict=&nodeId=', description: 'Connexions refusées, ou qui le seraient en mode observation (14 jours au plus).' },
      { method: 'GET', path: '/firewall/events/timeline?hours=&scope=&nodeId=', description: 'Tentatives par heure, pour un graphique.' },
      {
        method: 'GET',
        path: '/firewall/events/export?hours=&scope=&verdict=&nodeId=&format=',
        description: 'Export de l’activité, en csv ou json (téléchargement).',
        isNew: true,
      },
      {
        method: 'POST',
        path: '/firewall/events/:id/dismiss',
        description: 'Marque une connexion comme vue : elle n’est plus comptée parmi celles à examiner, même quand elle revient. DELETE pour annuler.',
        isNew: true,
      },
    ],
  },
  {
    name: 'VPN',
    base: '/vpn',
    icon: ShieldCheck,
    isNew: true,
    description:
      "Profils WireGuard : un appareil se connecte par un nœud d'entrée et sort sur Internet par le nœud de sortie choisi, modifiable à chaud.",
    endpoints: [
      {
        method: 'GET',
        path: '/vpn/gateways',
        apiScope: 'vpn:read',
        description:
          "Nœuds du workspace avec leur éligibilité comme entrée/sortie (raison si indisponible), profils portés, clients connectés et état de synchronisation.",
      },
      {
        method: 'GET',
        path: '/vpn/profiles',
        apiScope: 'vpn:read',
        description:
          'Profils avec route effective (entryNode, exitNode), état de déploiement (deployment.status) et session (connected, lastHandshakeAt, rxBytes, txBytes). Jamais de clé privée.',
      },
      { method: 'GET', path: '/vpn/profiles/:id', apiScope: 'vpn:read', description: "Détail d'un profil." },
      {
        method: 'POST',
        path: '/vpn/profiles',
        apiScope: 'vpn:write',
        body: 'name, entryNodeId, mode? (full | private), exitNodeId?, description?, dns?, expiresAt?, publicKey?',
        description:
          "Crée un profil et renvoie sa configuration WireGuard (config). Sans exitNodeId, la sortie se fait par le nœud d'entrée. Avec publicKey, la clé privée n'est jamais connue de Tarmac.",
      },
      {
        method: 'PATCH',
        path: '/vpn/profiles/:id',
        apiScope: 'vpn:write',
        body: 'name?, description?, mode?, entryNodeId?, exitNodeId?, dns?, enabled?, expiresAt?',
        description: "Modifie un profil. Changer entryNodeId attribue une nouvelle adresse : la configuration doit être réimportée.",
      },
      {
        method: 'POST',
        path: '/vpn/profiles/:id/exit',
        apiScope: 'vpn:write',
        body: 'exitNodeId (null = sortie directe par le nœud d’entrée)',
        description:
          "Bascule la sortie Internet à chaud : seul le routage des nœuds change, l'appareil reste connecté et sort avec la nouvelle IP en moins d'une seconde.",
      },
      {
        method: 'POST',
        path: '/vpn/profiles/:id/rotate-keys',
        apiScope: 'vpn:write',
        body: 'publicKey?',
        description: "Régénère les clés (appareil perdu, fichier diffusé) : l'ancienne configuration cesse immédiatement de fonctionner.",
      },
      { method: 'DELETE', path: '/vpn/profiles/:id', apiScope: 'vpn:write', description: "Supprime le profil et déconnecte l'appareil." },
      {
        method: 'GET',
        path: '/vpn/profiles/:id/config',
        apiScope: 'vpn:write',
        description: 'Configuration WireGuard en JSON ({ filename, config, complete }).',
      },
      {
        method: 'GET',
        path: '/vpn/profiles/:id/config.conf',
        apiScope: 'vpn:write',
        description: 'La même configuration en fichier .conf prêt à importer (curl -OJ).',
      },
    ],
  },
  {
    name: 'Clés API',
    base: '/api-keys',
    icon: KeyRound,
    isNew: true,
    description:
      "Clés d'accès programmatique d'un workspace, gérées par ses gérants (propriétaires ou administrateurs de plateforme) avec une session uniquement : une clé ne peut jamais créer ni élargir une clé.",
    endpoints: [
      { method: 'GET', path: '/api-keys', description: 'Clés du workspace (préfixe, permissions, dernière utilisation) — jamais le secret.' },
      {
        method: 'GET',
        path: '/api-keys/scopes',
        description: 'Permissions disponibles : <module>:read et <module>:write pour nodes, storage, network, dns, vpn, alerts, et logs:read.',
        isNew: true,
      },
      {
        method: 'POST',
        path: '/api-keys',
        body: 'name, scopes[], expiresAt?',
        description: 'Crée une clé ; le jeton complet (tmk_…) est renvoyé une seule fois.',
      },
      {
        method: 'PATCH',
        path: '/api-keys/:id',
        body: 'name?, scopes[]?, expiresAt? (null = jamais)',
        description:
          "Modifie le nom, les permissions ou l'expiration sans changer le secret : les intégrations continuent de fonctionner, et une permission retirée est refusée dès l'appel suivant.",
        isNew: true,
      },
      { method: 'POST', path: '/api-keys/:id/revoke', description: 'Révoque la clé immédiatement.' },
      { method: 'DELETE', path: '/api-keys/:id', description: 'Supprime la clé.' },
    ],
  },
  {
    name: 'Stockage',
    base: '/storage',
    icon: Database,
    description: "Vue d'ensemble et prévisions de capacité.",
    endpoints: [
      { method: 'GET', path: '/storage/forecast?nodeId=', description: "Prévision de remplissage disque (ratio d'usage, date estimée de saturation)." },
      { method: 'GET', path: '/storage/overview?nodeId=', description: 'Capacité, usage disque et débit réseau agrégés.' },
    ],
  },
  {
    name: 'Alertes',
    base: '/alerts, /alert-rules, /notification-channels',
    icon: Bell,
    description: 'Règles de seuils évaluées automatiquement, alertes déclenchées et canaux de notification.',
    endpoints: [
      {
        method: 'GET',
        path: '/alert-rules',
        description: 'Liste les règles. Chaque règle activée est évaluée chaque minute contre la dernière métrique (cpu, ram, disk) du ou des nœuds ciblés.',
      },
      { method: 'POST', path: '/alert-rules', body: 'name, metric, comparator, threshold, severity, enabled?, nodeId?, notificationChannelId?', description: 'Crée une règle de seuil.' },
      { method: 'PATCH', path: '/alert-rules/:id', description: 'Met à jour une règle.' },
      { method: 'DELETE', path: '/alert-rules/:id', description: 'Supprime une règle.' },
      { method: 'GET', path: '/alerts', description: 'Liste les alertes (déclenchées par une règle, un disque SMART dégradé, ou manuellement).' },
      { method: 'POST', path: '/alerts', body: 'ruleId?, nodeId?, message, severity', description: 'Déclenche une alerte manuellement.' },
      { method: 'POST', path: '/alerts/:id/ack', description: "Accuse réception d'une alerte." },
      { method: 'POST', path: '/alerts/:id/resolve', description: 'Résout une alerte. Les alertes de règle se résolvent aussi automatiquement dès que la métrique repasse sous le seuil.' },
      { method: 'DELETE', path: '/alerts/:id', description: 'Supprime une alerte.' },
      { method: 'GET', path: '/alerts/export?from=&to=&format=', description: 'Export des alertes sur une période (30 derniers jours par défaut), en csv ou json.', isNew: true },
      { method: 'GET', path: '/notification-channels', description: 'Liste les canaux (e-mail, webhook, Slack).' },
      { method: 'POST', path: '/notification-channels', body: 'name, type, target, enabled?', description: 'Crée un canal de notification.' },
      { method: 'PATCH', path: '/notification-channels/:id', description: 'Met à jour un canal.' },
      { method: 'DELETE', path: '/notification-channels/:id', description: 'Supprime un canal.' },
      { method: 'POST', path: '/notification-channels/:id/test', description: 'Envoie une notification de test.' },
    ],
  },
  {
    name: 'Journal',
    base: '/audit-logs, /agent-logs',
    icon: ScrollText,
    description:
"Les deux flux de l'écran Journal : les actions d'administration et les logs remontés par les agents. Tous deux filtrables et exportables.",
    endpoints: [
      {
        method: 'GET',
        path: '/audit-logs?before=&from=&limit=&actorUserId=&action=&resourceType=&q=',
        description: "Historique d'actions, paginé et filtrable par acteur, type d'action, ressource ou recherche libre (défaut: 200).",
      },
      {
        method: 'GET',
        path: '/audit-logs/export?from=&to=&format=',
        description: "Export du journal d'actions sur une période, en csv ou json (téléchargement).",
        isNew: true,
      },
      {
        method: 'GET',
        path: '/agent-logs?nodeId=&level=&before=&from=&limit=',
        description: 'Logs remontés par les agents, filtrables par nœud, niveau et période.',
        isNew: true,
      },
      {
        method: 'GET',
        path: '/agent-logs/export?from=&to=&format=&nodeId=',
        description: 'Export des logs agents sur une période, en csv ou json (téléchargement).',
        isNew: true,
      },
    ],
  },
  {
    name: 'Topologie',
    base: '/topology',
    icon: History,
    description: 'Vue graphe de la flotte.',
    endpoints: [{ method: 'GET', path: '/topology', description: 'Graphe nœuds / pools / partages / montages.' }],
  },
  {
    name: 'Système',
    base: '/system',
    icon: Info,
    description: "Informations sur l'installation elle-même.",
    endpoints: [
      {
        method: 'GET',
        path: '/system/version',
        auth: 'public',
        description:
"Version du control plane, servie sans session : c'est la référence unique affichée dans l'interface et comparée à la version de chaque agent.",
        isNew: true,
      },
    ],
  },
];

export default function ApiReferencePage() {
  return (
    <div className="space-y-10">
      <PageHeader
        title="Référence API"
        description="Toutes les routes REST exposées par l'API Tarmac, préfixées par /api/v1."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="">
          <CardContent className="pt-6 text-sm">
            <p className="font-medium text-foreground">URL de base</p>
            <code className="mt-1 block text-xs text-muted-foreground">https://votre-api/api/v1</code>
          </CardContent>
        </Card>
        <Card className="">
          <CardContent className="pt-6 text-sm">
            <p className="font-medium text-foreground">Authentification</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Cookie de session httpOnly posé par <code>POST /auth/login</code> (5 tentatives/min max) ou par le retour
              SSO Authentik, envoyé automatiquement par le navigateur. Aucun jeton à gérer côté client — toutes les
              routes ci-dessous l'exigent, sauf mention « publique » ou « jeton dédié ».
            </p>
          </CardContent>
        </Card>
        <Card className="">
          <CardContent className="pt-6 text-sm">
            <p className="flex items-center gap-2 font-medium text-foreground">
              Workspace
              <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-300">
                Nouveau
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              L'en-tête <code>X-Workspace-Id</code> choisit le workspace sur lequel porte la requête ; sans lui, un
              workspace par défaut est retenu. Toute route de ressource est filtrée sur ce workspace — y compris pour un
              administrateur de plateforme.
            </p>
          </CardContent>
        </Card>
        <Card className="">
          <CardContent className="pt-6 text-sm">
            <p className="flex items-center gap-2 font-medium text-foreground">
              Clés API
              <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-300">
                Nouveau
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Pour l'automatisation : <code>Authorization: Bearer tmk_…</code>. Une clé est liée à un seul workspace
              (pas besoin de <code>X-Workspace-Id</code>) et ouvre chaque route marquée « Clé API » dont elle a la
              permission — voir le tableau des permissions ci-dessous. Créées et modifiables par les gérants du
              workspace depuis Administration → Clés API.
            </p>
          </CardContent>
        </Card>
        <Card className="">
          <CardContent className="pt-6 text-sm">
            <p className="font-medium text-foreground">Validation</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Les corps de requête sont validés et transformés automatiquement ; tout champ inconnu est rejeté (400).
            </p>
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <SectionLabel>Sommaire</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {MODULES.map((module) => (
            <a
              key={module.name}
              href={`#${moduleAnchor(module.name)}`}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-violet-500/40 hover:text-violet-200"
            >
              <module.icon className="h-3.5 w-3.5 text-muted-foreground" />
              {module.name}
              <span className={cn('text-zinc-600', module.isNew && 'text-emerald-400/70')}>{module.endpoints.length}</span>
            </a>
          ))}
        </div>
      </section>

      <section id="permissions-cles-api" className="scroll-mt-24 space-y-3">
        <SectionLabel>Permissions des clés API</SectionLabel>
        <ApiPermissionsTable linkModules />
      </section>

      <Callout>
        Deux canaux temps réel doublent ces routes REST. Les agents installés sur chaque nœud utilisent{' '}
        <code>/agents-ws</code> (authentifié par un jeton d'agent) pour remonter l'état matériel et recevoir des
        commandes — montage, migration, configuration DNS, mise à jour. Le navigateur, lui, ouvre{' '}
        <code>/live-ws?workspaceId=…</code> avec le cookie de session pour recevoir en direct les nouvelles entrées de
        journal, les logs d'agents et les battements de cœur des nœuds du workspace affiché.
      </Callout>

      <div className="space-y-6">
        {MODULES.map((module) => (
          <Card
            key={module.name}
            id={moduleAnchor(module.name)}
            className="scroll-mt-24 overflow-hidden transition-colors hover:border-border"
          >
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-600/15 text-primary">
                    <module.icon className="h-4 w-4" />
                  </div>
                  <CardTitle>{module.name}</CardTitle>
                  {module.isNew && (
                    <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-300">
                      Nouveau
                    </span>
                  )}
                  {MODULE_RESOURCE[module.name] ? (
                    <a href="#permissions-cles-api">
                      <Badge variant="info" className="gap-1 px-1.5 py-0 text-[10px]">
                        <KeyRound className="h-3 w-3" />
                        {RESOURCE_BY_ID[MODULE_RESOURCE[module.name]].label}
                      </Badge>
                    </a>
                  ) : (
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-muted-foreground">
                      Session uniquement
                    </Badge>
                  )}
                </div>
                <code className="text-xs text-muted-foreground">{module.base}</code>
              </div>
              <CardDescription className="pl-12">{module.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {module.endpoints.map((endpoint) => {
                const scope = endpointScope(module, endpoint);
                return (
                <div
                  key={`${endpoint.method}-${endpoint.path}`}
                  className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="flex shrink-0 items-start gap-2 sm:w-80">
                    <Badge variant={METHOD_VARIANT[endpoint.method]} className={cn('w-16 shrink-0 justify-center font-mono')}>
                      {endpoint.method}
                    </Badge>
                    <code className="break-all text-xs leading-5 text-foreground/90">{endpoint.path}</code>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {endpoint.isNew && (
                        <Badge variant="success" className="px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide">
                          Nouveau
                        </Badge>
                      )}
                      {endpoint.auth === 'public' && (
                        <Badge variant="outline" className="px-1.5 py-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Publique
                        </Badge>
                      )}
                      {endpoint.auth === 'token' && (
                        <Badge variant="outline" className="px-1.5 py-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Jeton dédié
                        </Badge>
                      )}
                      {scope && (
                        <Badge variant="info" className="px-1.5 py-0 font-mono text-[10px]">
                          Clé API · {scope}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{endpoint.description}</p>
                    {endpoint.body && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        <span className="text-zinc-600">Corps : </span>
                        {endpoint.body}
                      </p>
                    )}
                  </div>
                </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
