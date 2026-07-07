import { Server, Share2, HardDrive, RefreshCw, ArrowRightLeft, Network, Bell } from 'lucide-react';
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
      "Une alerte se déclenche quand une métrique dépasse un seuil que vous avez défini (ex: espace disque > 90%). Elle peut être accusée réception, résolue, et notifiée par e-mail, webhook ou Slack.",
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

      <Card>
        <CardHeader>
          <CardTitle>Comment ces briques s'articulent</CardTitle>
          <CardDescription>
            Exemple : deux nœuds interconnectés, un partage exposé sur l'un et monté sur l'autre.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <svg viewBox="0 0 640 200" className="w-full" role="img" aria-label="Schéma d'un partage NFS monté entre deux nœuds interconnectés par VLAN">
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(139 92 246 / 0.7)" />
              </marker>
            </defs>

            <rect x="20" y="60" width="180" height="80" rx="16" fill="rgb(255 255 255 / 0.03)" stroke="rgb(255 255 255 / 0.1)" />
            <text x="110" y="95" textAnchor="middle" fill="rgb(244 244 245)" fontSize="14" fontWeight="600">Nœud A</text>
            <text x="110" y="115" textAnchor="middle" fill="rgb(161 161 170)" fontSize="11">Partage NFS /data</text>

            <rect x="440" y="60" width="180" height="80" rx="16" fill="rgb(255 255 255 / 0.03)" stroke="rgb(255 255 255 / 0.1)" />
            <text x="530" y="95" textAnchor="middle" fill="rgb(244 244 245)" fontSize="14" fontWeight="600">Nœud B</text>
            <text x="530" y="115" textAnchor="middle" fill="rgb(161 161 170)" fontSize="11">Montage /mnt/data</text>

            <line x1="200" y1="100" x2="435" y2="100" stroke="rgb(139 92 246 / 0.7)" strokeWidth="2" markerEnd="url(#arrow)" />
            <text x="320" y="85" textAnchor="middle" fill="rgb(196 181 253)" fontSize="11">NFS via VLAN privé</text>
          </svg>
        </CardContent>
      </Card>
    </div>
  );
}
