import { PageHeader } from '../../../components/PageHeader';
import { Callout } from '../../../components/Callout';
import { Badge } from '../../../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card';
import { cn } from '../../../lib/utils';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

type Endpoint = {
  method: Method;
  path: string;
  auth?: 'public' | 'agent';
  body?: string;
  description: string;
};

type Module = {
  name: string;
  base: string;
  description: string;
  endpoints: Endpoint[];
};

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
    description: "Connexion et gestion du profil de l'administrateur connecté.",
    endpoints: [
      { method: 'POST', path: '/auth/login', auth: 'public', body: 'email, password', description: 'Vérifie les identifiants et renvoie un jeton JWT.' },
      { method: 'GET', path: '/auth/profile', description: "Profil de l'utilisateur authentifié." },
      { method: 'PATCH', path: '/auth/profile', body: 'email?, currentPassword?, newPassword?', description: "Met à jour l'e-mail et/ou le mot de passe (l'ancien mot de passe est requis pour en changer)." },
    ],
  },
  {
    name: 'Nœuds',
    base: '/nodes',
    description: 'Enregistrement, onboarding et supervision des serveurs de la flotte.',
    endpoints: [
      { method: 'GET', path: '/nodes', description: 'Liste tous les nœuds.' },
      { method: 'POST', path: '/nodes', body: 'name, role, status?', description: 'Enregistre un nœud manuellement (sans onboarding SSH).' },
      { method: 'POST', path: '/nodes/onboarding/start', body: 'name, role, provider, hostIp, sshUsername, sshPassword, repoUrl?, repoRef?', description: "Démarre l'onboarding guidé : connexion SSH et préparation de la clé de déploiement." },
      { method: 'POST', path: '/nodes/onboarding/:id/install', body: 'deployKeyConfirmed', description: "Finalise l'onboarding une fois la clé de déploiement confirmée." },
      { method: 'PATCH', path: '/nodes/:id', body: 'name?, role?, status?, locationCity?, locationCountry?, locationCountryCode?', description: "Met à jour un nœud (statut, rôle, localisation)." },
      { method: 'DELETE', path: '/nodes/:id', description: 'Supprime un nœud.' },
      { method: 'POST', path: '/nodes/:id/rotate-token', description: "Régénère le jeton d'authentification de l'agent pour ce nœud." },
      { method: 'POST', path: '/nodes/rotate-tokens', description: "Régénère les jetons d'agent pour tous les nœuds." },
      { method: 'GET', path: '/nodes/activity?range=', description: "Flux d'activité de la flotte (défaut: 1h)." },
      { method: 'GET', path: '/nodes/:id/metrics?range=', description: "Historique de métriques d'un nœud (défaut: 1h)." },
    ],
  },
  {
    name: 'Partages NFS',
    base: '/shares',
    description: 'Partages exposés par un nœud et contrôle des accès clients.',
    endpoints: [
      { method: 'GET', path: '/shares', description: 'Liste les partages.' },
      { method: 'POST', path: '/shares', body: 'name, path, nodeId?', description: 'Crée un partage NFS.' },
      { method: 'PATCH', path: '/shares/:id', body: 'name?, path?, nodeId?, status?', description: 'Met à jour un partage.' },
      { method: 'DELETE', path: '/shares/:id', description: 'Supprime un partage.' },
      { method: 'GET', path: '/shares/:id/clients', description: "Liste les accès clients d'un partage." },
      { method: 'POST', path: '/shares/:id/clients', body: 'clientId, access', description: 'Ajoute ou met à jour un accès client (ro, rw, deny).' },
      { method: 'PATCH', path: '/shares/:id/clients/:clientId', body: 'access', description: "Change le niveau d'accès d'un client." },
      { method: 'DELETE', path: '/shares/:id/clients/:clientId', description: "Retire l'accès d'un client." },
    ],
  },
  {
    name: 'Montages',
    base: '/mounts',
    description: 'Montage de sources NFS (avec sources de secours) sur un nœud.',
    endpoints: [
      { method: 'GET', path: '/mounts', description: 'Liste les montages.' },
      { method: 'POST', path: '/mounts', body: 'name, sourcePath, additionalSources?, targetPath, fsType?, mountOptions?, nodeId?', description: 'Crée un montage.' },
      { method: 'PATCH', path: '/mounts/:id', body: '(idem create) + status?', description: 'Met à jour un montage.' },
      { method: 'POST', path: '/mounts/:id/remount', description: 'Déclenche un remontage sur le nœud cible.' },
      { method: 'DELETE', path: '/mounts/:id', description: 'Supprime un montage.' },
    ],
  },
  {
    name: 'Pools & réplication',
    base: '/pools',
    description: 'Regroupement de nœuds autour d\'une stratégie de stockage partagée.',
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
    description: 'Déplacement de volumes entre nœuds, seedbox ou Storage Box.',
    endpoints: [
      { method: 'GET', path: '/migrations', description: 'Liste les migrations.' },
      { method: 'GET', path: '/migrations/directories?nodeId=&basePath=', description: "Liste les dossiers d'un nœud (via l'agent)." },
      { method: 'GET', path: '/migrations/directories/scan?nodeId=&basePath=&maxEntries=', description: 'Scanne les dossiers avec une limite de résultats.' },
      { method: 'POST', path: '/migrations/directories/remote', body: 'nodeId, host, username, password?, basePath?, port?, endpointType?', description: 'Liste les dossiers sur un endpoint distant (seedbox / Storage Box) via un nœud relais.' },
      { method: 'POST', path: '/migrations', body: 'name, source*, target*, sourceKind?, targetKind?, ...', description: 'Crée une migration.' },
      { method: 'PATCH', path: '/migrations/:id', body: 'name?, notes?, status?, progress?', description: 'Met à jour une migration.' },
      { method: 'POST', path: '/migrations/:id/start', description: 'Démarre le transfert.' },
      { method: 'POST', path: '/migrations/:id/retry', description: 'Relance une migration en échec.' },
      { method: 'POST', path: '/migrations/:id/stop', description: 'Arrête une migration en cours.' },
      { method: 'POST', path: '/migrations/:id/complete', description: 'Marque la migration comme terminée.' },
      { method: 'DELETE', path: '/migrations/:id', description: 'Supprime une migration en attente.' },
    ],
  },
  {
    name: 'Tâches de synchronisation',
    base: '/sync-jobs',
    description: 'Tâches planifiées de type rsync entre deux chemins.',
    endpoints: [
      { method: 'GET', path: '/sync-jobs', description: 'Liste les tâches de synchronisation.' },
      { method: 'POST', path: '/sync-jobs', body: 'name, sourcePath, targetPath, schedule, nodeId?', description: 'Crée une tâche planifiée.' },
      { method: 'PATCH', path: '/sync-jobs/:id', body: 'name?, sourcePath?, targetPath?, schedule?, nodeId?, status?', description: 'Met à jour une tâche.' },
      { method: 'DELETE', path: '/sync-jobs/:id', description: 'Supprime une tâche.' },
      { method: 'GET', path: '/sync-jobs/runs', description: "Historique d'exécution, toutes tâches confondues." },
      { method: 'GET', path: '/sync-jobs/:id/runs', description: "Historique d'exécution d'une tâche." },
      { method: 'POST', path: '/sync-jobs/:id/runs', description: 'Déclenche une exécution immédiate.' },
    ],
  },
  {
    name: 'Réseau (VLAN)',
    base: '/vlan',
    description: 'Réseau privé entre nœuds et tests de connectivité.',
    endpoints: [
      { method: 'GET', path: '/vlan', description: 'Récupère (ou crée) le VLAN par défaut de la flotte.' },
      { method: 'POST', path: '/vlan/join', body: 'nodeId, vlanName?', description: 'Rattache un nœud au VLAN.' },
      { method: 'GET', path: '/vlan/:vlanId/members', description: 'Liste les membres du VLAN.' },
      { method: 'GET', path: '/vlan/:vlanId/connections', description: 'Liste les connexions inter-nœuds du VLAN.' },
      { method: 'GET', path: '/vlan/:vlanId/status', description: 'État de santé global du VLAN.' },
      { method: 'GET', path: '/vlan/:vlanId/tests', description: 'Historique des tests de connectivité.' },
      { method: 'POST', path: '/vlan/:vlanId/test', body: 'initiatorNodeId, targetNodeId, testType', description: 'Lance un test (ping, connectivité, latence) entre deux nœuds membres.' },
      { method: 'POST', path: '/vlan/heartbeat', body: 'nodeId, vlanId?', description: 'Enregistre un battement de vie VLAN pour un nœud.' },
    ],
  },
  {
    name: 'Stockage',
    base: '/storage',
    description: "Vue d'ensemble et prévisions de capacité.",
    endpoints: [
      { method: 'GET', path: '/storage/forecast?nodeId=', description: "Prévision de remplissage disque (ratio d'usage, date estimée de saturation)." },
      { method: 'GET', path: '/storage/overview?nodeId=', description: 'Capacité, usage disque et débit réseau agrégés.' },
    ],
  },
  {
    name: 'Alertes',
    base: '/alerts, /alert-rules, /notification-channels',
    description: 'Règles de seuils, alertes déclenchées et canaux de notification.',
    endpoints: [
      { method: 'GET', path: '/alert-rules', description: 'Liste les règles.' },
      { method: 'POST', path: '/alert-rules', body: 'name, metric, comparator, threshold, severity, enabled?, nodeId?, notificationChannelId?', description: 'Crée une règle de seuil.' },
      { method: 'PATCH', path: '/alert-rules/:id', description: 'Met à jour une règle.' },
      { method: 'DELETE', path: '/alert-rules/:id', description: 'Supprime une règle.' },
      { method: 'GET', path: '/alerts', description: 'Liste les alertes.' },
      { method: 'POST', path: '/alerts', body: 'ruleId?, nodeId?, message, severity', description: 'Déclenche une alerte.' },
      { method: 'POST', path: '/alerts/:id/ack', description: "Accuse réception d'une alerte." },
      { method: 'POST', path: '/alerts/:id/resolve', description: 'Résout une alerte.' },
      { method: 'DELETE', path: '/alerts/:id', description: 'Supprime une alerte.' },
      { method: 'GET', path: '/notification-channels', description: 'Liste les canaux (e-mail, webhook, Slack).' },
      { method: 'POST', path: '/notification-channels', body: 'name, type, target, enabled?', description: 'Crée un canal de notification.' },
      { method: 'PATCH', path: '/notification-channels/:id', description: 'Met à jour un canal.' },
      { method: 'DELETE', path: '/notification-channels/:id', description: 'Supprime un canal.' },
      { method: 'POST', path: '/notification-channels/:id/test', description: 'Envoie une notification de test.' },
    ],
  },
  {
    name: 'Topologie & audit',
    base: '/topology, /audit-logs',
    description: 'Vue graphe de la flotte et historique des actions.',
    endpoints: [
      { method: 'GET', path: '/topology', description: 'Graphe nœuds / pools / partages / montages.' },
      { method: 'GET', path: '/audit-logs?limit=', description: "Historique d'actions récentes (défaut: 200)." },
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6 text-sm">
            <p className="font-medium text-foreground">URL de base</p>
            <code className="mt-1 block text-xs text-muted-foreground">https://votre-api/api/v1</code>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-sm">
            <p className="font-medium text-foreground">Authentification</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Bearer JWT, obtenu via <code>POST /auth/login</code>. Toutes les routes ci-dessous l'exigent, sauf
              mention « publique ».
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-sm">
            <p className="font-medium text-foreground">Validation</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Les corps de requête sont validés et transformés automatiquement ; tout champ inconnu est rejeté (400).
            </p>
          </CardContent>
        </Card>
      </div>

      <Callout>
        Les agents installés sur chaque nœud communiquent via un canal temps réel dédié (WebSocket, chemin{' '}
        <code>/agents-ws</code>) plutôt que par ces routes REST — ils remontent l'état matériel et reçoivent des
        commandes (montage, migration, mise à jour). Ce canal utilise un jeton d'agent, pas le JWT utilisateur.
      </Callout>

      <div className="space-y-6">
        {MODULES.map((module) => (
          <Card key={module.name}>
            <CardHeader>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <CardTitle>{module.name}</CardTitle>
                <code className="text-xs text-muted-foreground">{module.base}</code>
              </div>
              <CardDescription>{module.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {module.endpoints.map((endpoint) => (
                <div
                  key={`${endpoint.method}-${endpoint.path}`}
                  className="flex flex-col gap-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="flex shrink-0 items-center gap-2 sm:w-72">
                    <Badge variant={METHOD_VARIANT[endpoint.method]} className={cn('w-16 shrink-0 justify-center font-mono')}>
                      {endpoint.method}
                    </Badge>
                    <code className="truncate text-xs text-foreground/90">{endpoint.path}</code>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-muted-foreground">{endpoint.description}</p>
                    {endpoint.body && (
                      <p className="mt-0.5 truncate text-xs text-zinc-500">
                        <span className="text-zinc-600">Corps : </span>
                        {endpoint.body}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
