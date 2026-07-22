import { Server, Share2, HardDrive, RefreshCw, ArrowRightLeft, Network, Bell, Thermometer, BellOff } from 'lucide-react';
import { PageHeader } from '../../../components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card';

const CONCEPTS = [
  {
    icon: Server,
    title: 'Nœud',
    description:
      "Un nœud est un serveur physique ou virtuel enregistré dans Tarmac. Un petit agent tourne dessus et remonte en continu son état (CPU, RAM, disques, réseau). C'est la brique de base : tout le reste (partages, montages, réplication) s'organise entre nœuds.",
  },
  {
    icon: Share2,
    title: 'Partage NFS',
    description:
      "Un partage rend un dossier d'un nœud accessible par le réseau via le protocole NFS. Vous choisissez le dossier à exposer et les clients autorisés à y accéder (lecture seule, lecture/écriture, ou accès refusé).",
  },
  {
    icon: HardDrive,
    title: 'Montage',
    description:
      "Un montage attache un partage NFS (ou plusieurs sources de secours) à un dossier local sur un autre nœud, comme s'il s'agissait d'un disque local. Si la source principale tombe, une source de secours peut prendre le relais.",
  },
  {
    icon: RefreshCw,
    title: 'Pool & réplication',
    description:
      "Un pool regroupe plusieurs nœuds autour d'une même stratégie de stockage. La réplication copie les données d'un nœud primaire vers un ou plusieurs nœuds secondaires, pour la redondance ou la répartition de charge.",
  },
  {
    icon: ArrowRightLeft,
    title: 'Migration',
    description:
      "Une migration déplace un volume d'un endroit à un autre : entre deux nœuds Tarmac, ou depuis/vers un service externe (seedbox, Hetzner Storage Box). La progression du transfert est visible en direct.",
  },
  {
    icon: Network,
    title: 'Réseau privé (VLAN)',
    description:
      "Les nœuds peuvent être reliés sur un réseau privé dédié, isolé d'Internet. Tarmac permet de visualiser cette carte réseau et de tester la latence et la connectivité entre deux nœuds.",
  },
  {
    icon: Bell,
    title: 'Alertes',
    description:
      "Une règle de seuil (ex: CPU > 90%) est évaluée automatiquement chaque minute sur les nœuds ciblés. L'alerte créée se résout d'elle-même dès le retour sous le seuil, et peut être notifiée par e-mail, webhook ou Slack.",
  },
  {
    icon: Thermometer,
    title: 'Santé SMART',
    description:
      "Chaque disque physique est interrogé via smartctl (température, secteurs réalloués/en attente). Un disque qui passe en état critique déclenche une alerte et une migration de sécurisation suggérée vers le nœud le moins chargé — jamais démarrée automatiquement.",
  },
  {
    icon: BellOff,
    title: 'Fenêtre de maintenance',
    description:
      "Mettre un nœud « en silence » suspend temporairement ses alertes de règles et SMART, le temps d'une intervention planifiée, sans désactiver la supervision elle-même.",
  },
];

export default function ConceptsPage() {
  return (
    <div className="space-y-10">
      <PageHeader
        title="Concepts clés"
        description="Le vocabulaire de Tarmac, expliqué simplement — pas besoin d'être expert réseau pour s'y retrouver."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {CONCEPTS.map((concept) => (
          <Card key={concept.title}>
            <CardHeader>
              <div className="flex items-center gap-2.5">
                <concept.icon className="h-4 w-4 text-violet-400" />
                <CardTitle className="text-base">{concept.title}</CardTitle>
              </div>
              <CardDescription className="pt-1">{concept.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Comment ces briques s'articulent</h2>
        <p className="text-sm text-muted-foreground">
          Cinq scénarios types, du partage de fichiers simple à la remédiation automatique d'un disque défaillant.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Partage exposé, puis monté</CardTitle>
            <CardDescription>Deux nœuds interconnectés : un partage exposé sur l'un, monté sur l'autre.</CardDescription>
          </CardHeader>
          <CardContent>
            <svg viewBox="0 0 640 200" className="w-full" role="img" aria-label="Schéma d'un partage NFS monté entre deux nœuds interconnectés par VLAN">
              <defs>
                <marker id="arrow-share" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(139 92 246 / 0.7)" />
                </marker>
              </defs>

              <rect x="20" y="60" width="180" height="80" rx="16" fill="rgb(255 255 255 / 0.03)" stroke="rgb(255 255 255 / 0.1)" />
              <text x="110" y="95" textAnchor="middle" fill="rgb(244 244 245)" fontSize="14" fontWeight="600">Nœud A</text>
              <text x="110" y="115" textAnchor="middle" fill="rgb(161 161 170)" fontSize="11">Partage NFS /data</text>

              <rect x="440" y="60" width="180" height="80" rx="16" fill="rgb(255 255 255 / 0.03)" stroke="rgb(255 255 255 / 0.1)" />
              <text x="530" y="95" textAnchor="middle" fill="rgb(244 244 245)" fontSize="14" fontWeight="600">Nœud B</text>
              <text x="530" y="115" textAnchor="middle" fill="rgb(161 161 170)" fontSize="11">Montage /mnt/data</text>

              <line x1="200" y1="100" x2="435" y2="100" stroke="rgb(139 92 246 / 0.7)" strokeWidth="2" markerEnd="url(#arrow-share)" />
              <text x="320" y="85" textAnchor="middle" fill="rgb(196 181 253)" fontSize="11">NFS via VLAN privé</text>
            </svg>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pool en réplication miroir</CardTitle>
            <CardDescription>Un nœud primaire réplique en continu vers un ou plusieurs nœuds replica.</CardDescription>
          </CardHeader>
          <CardContent>
            <svg viewBox="0 0 640 200" className="w-full" role="img" aria-label="Schéma d'un pool en réplication miroir depuis un nœud primaire vers deux replicas">
              <defs>
                <marker id="arrow-pool" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(139 92 246 / 0.7)" />
                </marker>
              </defs>

              <rect x="20" y="60" width="180" height="80" rx="16" fill="rgb(255 255 255 / 0.03)" stroke="rgb(255 255 255 / 0.1)" />
              <text x="110" y="95" textAnchor="middle" fill="rgb(244 244 245)" fontSize="14" fontWeight="600">Nœud primaire</text>
              <text x="110" y="115" textAnchor="middle" fill="rgb(161 161 170)" fontSize="11">rôle : primary</text>

              <rect x="440" y="15" width="180" height="65" rx="16" fill="rgb(255 255 255 / 0.03)" stroke="rgb(255 255 255 / 0.1)" />
              <text x="530" y="42" textAnchor="middle" fill="rgb(244 244 245)" fontSize="13" fontWeight="600">Replica A</text>
              <text x="530" y="60" textAnchor="middle" fill="rgb(161 161 170)" fontSize="10">rôle : replica</text>

              <rect x="440" y="120" width="180" height="65" rx="16" fill="rgb(255 255 255 / 0.03)" stroke="rgb(255 255 255 / 0.1)" />
              <text x="530" y="147" textAnchor="middle" fill="rgb(244 244 245)" fontSize="13" fontWeight="600">Replica B</text>
              <text x="530" y="165" textAnchor="middle" fill="rgb(161 161 170)" fontSize="10">rôle : replica</text>

              <line x1="200" y1="90" x2="435" y2="48" stroke="rgb(139 92 246 / 0.7)" strokeWidth="2" markerEnd="url(#arrow-pool)" />
              <line x1="200" y1="110" x2="435" y2="152" stroke="rgb(139 92 246 / 0.7)" strokeWidth="2" markerEnd="url(#arrow-pool)" />
              <text x="300" y="105" textAnchor="middle" fill="rgb(196 181 253)" fontSize="11">réplication miroir</text>
            </svg>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Migration entre deux endroits</CardTitle>
            <CardDescription>La source peut être un nœud Tarmac, une seedbox ou un Storage Box.</CardDescription>
          </CardHeader>
          <CardContent>
            <svg viewBox="0 0 640 200" className="w-full" role="img" aria-label="Schéma d'une migration d'un volume depuis une source vers un nœud cible">
              <defs>
                <marker id="arrow-migration" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(139 92 246 / 0.7)" />
                </marker>
              </defs>

              <rect x="20" y="60" width="180" height="80" rx="16" fill="rgb(255 255 255 / 0.03)" stroke="rgb(255 255 255 / 0.1)" />
              <text x="110" y="95" textAnchor="middle" fill="rgb(244 244 245)" fontSize="14" fontWeight="600">Source</text>
              <text x="110" y="115" textAnchor="middle" fill="rgb(161 161 170)" fontSize="11">nœud, seedbox ou Storage Box</text>

              <rect x="440" y="60" width="180" height="80" rx="16" fill="rgb(255 255 255 / 0.03)" stroke="rgb(255 255 255 / 0.1)" />
              <text x="530" y="95" textAnchor="middle" fill="rgb(244 244 245)" fontSize="14" fontWeight="600">Nœud cible</text>
              <text x="530" y="115" textAnchor="middle" fill="rgb(161 161 170)" fontSize="11">destination du volume</text>

              <line x1="200" y1="100" x2="435" y2="100" stroke="rgb(139 92 246 / 0.7)" strokeWidth="2" markerEnd="url(#arrow-migration)" />
              <text x="320" y="85" textAnchor="middle" fill="rgb(196 181 253)" fontSize="11">transfert, progression en direct</text>
            </svg>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Réseau privé (VLAN)</CardTitle>
            <CardDescription>Les nœuds membres se voient entre eux et peuvent être testés deux à deux.</CardDescription>
          </CardHeader>
          <CardContent>
            <svg viewBox="0 0 640 200" className="w-full" role="img" aria-label="Schéma d'un maillage de trois nœuds reliés par un VLAN privé avec un test de latence">
              <line x1="110" y1="48" x2="530" y2="48" stroke="rgb(255 255 255 / 0.12)" strokeWidth="2" />
              <line x1="110" y1="48" x2="320" y2="158" stroke="rgb(255 255 255 / 0.12)" strokeWidth="2" />
              <line x1="530" y1="48" x2="320" y2="158" stroke="rgb(255 255 255 / 0.12)" strokeWidth="2" />
              <line x1="110" y1="48" x2="530" y2="48" stroke="rgb(139 92 246 / 0.7)" strokeWidth="2" strokeDasharray="5 5" />
              <text x="320" y="35" textAnchor="middle" fill="rgb(196 181 253)" fontSize="11">test : latence 2 ms</text>

              <rect x="30" y="18" width="160" height="60" rx="14" fill="rgb(255 255 255 / 0.03)" stroke="rgb(255 255 255 / 0.1)" />
              <text x="110" y="44" textAnchor="middle" fill="rgb(244 244 245)" fontSize="13" fontWeight="600">Nœud A</text>
              <text x="110" y="62" textAnchor="middle" fill="rgb(161 161 170)" fontSize="10">10.10.0.1</text>

              <rect x="450" y="18" width="160" height="60" rx="14" fill="rgb(255 255 255 / 0.03)" stroke="rgb(255 255 255 / 0.1)" />
              <text x="530" y="44" textAnchor="middle" fill="rgb(244 244 245)" fontSize="13" fontWeight="600">Nœud B</text>
              <text x="530" y="62" textAnchor="middle" fill="rgb(161 161 170)" fontSize="10">10.10.0.2</text>

              <rect x="240" y="128" width="160" height="60" rx="14" fill="rgb(255 255 255 / 0.03)" stroke="rgb(255 255 255 / 0.1)" />
              <text x="320" y="154" textAnchor="middle" fill="rgb(244 244 245)" fontSize="13" fontWeight="600">Nœud C</text>
              <text x="320" y="172" textAnchor="middle" fill="rgb(161 161 170)" fontSize="10">10.10.0.3</text>
            </svg>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alertes : d'une métrique à la remédiation</CardTitle>
          <CardDescription>
            Les règles de seuil sont évaluées chaque minute ; un disque SMART critique peut aussi déclencher une
            migration de sécurisation, toujours en attente de validation manuelle.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <svg viewBox="0 0 700 230" className="w-full" role="img" aria-label="Schéma du flux d'alerte, de la métrique surveillée à la notification, avec une branche vers une migration de sécurisation suggérée en cas de SMART critique">
            <defs>
              <marker id="arrow-alert" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(139 92 246 / 0.7)" />
              </marker>
            </defs>

            <rect x="10" y="55" width="150" height="70" rx="14" fill="rgb(255 255 255 / 0.03)" stroke="rgb(255 255 255 / 0.1)" />
            <text x="85" y="85" textAnchor="middle" fill="rgb(244 244 245)" fontSize="13" fontWeight="600">Métrique</text>
            <text x="85" y="102" textAnchor="middle" fill="rgb(161 161 170)" fontSize="10">cpu, ram, disk, SMART</text>

            <rect x="195" y="55" width="150" height="70" rx="14" fill="rgb(255 255 255 / 0.03)" stroke="rgb(255 255 255 / 0.1)" />
            <text x="270" y="85" textAnchor="middle" fill="rgb(244 244 245)" fontSize="13" fontWeight="600">Évaluateur</text>
            <text x="270" y="102" textAnchor="middle" fill="rgb(161 161 170)" fontSize="10">règles, toutes les 1 min</text>

            <rect x="380" y="55" width="150" height="70" rx="14" fill="rgb(255 255 255 / 0.03)" stroke="rgb(255 255 255 / 0.1)" />
            <text x="455" y="85" textAnchor="middle" fill="rgb(244 244 245)" fontSize="13" fontWeight="600">Alerte</text>
            <text x="455" y="102" textAnchor="middle" fill="rgb(161 161 170)" fontSize="10">créée, résolue si retour sous seuil</text>

            <rect x="565" y="55" width="130" height="70" rx="14" fill="rgb(255 255 255 / 0.03)" stroke="rgb(255 255 255 / 0.1)" />
            <text x="630" y="85" textAnchor="middle" fill="rgb(244 244 245)" fontSize="13" fontWeight="600">Notification</text>
            <text x="630" y="102" textAnchor="middle" fill="rgb(161 161 170)" fontSize="10">e-mail, webhook, Slack</text>

            <line x1="160" y1="90" x2="192" y2="90" stroke="rgb(139 92 246 / 0.7)" strokeWidth="2" markerEnd="url(#arrow-alert)" />
            <line x1="345" y1="90" x2="377" y2="90" stroke="rgb(139 92 246 / 0.7)" strokeWidth="2" markerEnd="url(#arrow-alert)" />
            <line x1="530" y1="90" x2="562" y2="90" stroke="rgb(139 92 246 / 0.7)" strokeWidth="2" markerEnd="url(#arrow-alert)" />

            <line x1="455" y1="125" x2="455" y2="163" stroke="rgb(244 63 94 / 0.6)" strokeWidth="2" markerEnd="url(#arrow-alert)" />
            <text x="500" y="148" textAnchor="middle" fill="rgb(253 164 175)" fontSize="10">si SMART critique</text>
            <rect x="380" y="165" width="150" height="55" rx="14" fill="rgb(244 63 94 / 0.06)" stroke="rgb(244 63 94 / 0.25)" />
            <text x="455" y="188" textAnchor="middle" fill="rgb(253 164 175)" fontSize="12" fontWeight="600">Migration suggérée</text>
            <text x="455" y="205" textAnchor="middle" fill="rgb(161 161 170)" fontSize="10">en attente — jamais auto-démarrée</text>
          </svg>
        </CardContent>
      </Card>
    </div>
  );
}
