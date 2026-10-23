import {
  Server,
  Share2,
  HardDrive,
  RefreshCw,
  ArrowRightLeft,
  Network,
  Bell,
  Thermometer,
  BellOff,
  Globe,
  Waypoints,
  LayoutGrid,
  KeyRound,
  Repeat,
  ScrollText,
  Cpu,
  Boxes,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '../../../components/PageHeader';
import { SectionLabel } from '../../../components/SectionLabel';
import { AnimatedGradientText } from '../../../components/ui/animated-gradient-text';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card';
import { Diagram, DBox, DFrame, DLink, DNote } from '../../../components/docs/Diagram';

type Concept = { icon: LucideIcon; title: string; description: string; isNew?: boolean; href?: string };

const SECTIONS: { label: string; concepts: Concept[] }[] = [
  {
    label: 'Organisation',
    concepts: [
      {
        icon: LayoutGrid,
        title: 'Workspace',
        isNew: true,
        href: '/docs/workspaces',
        description:
"Un workspace est une flotte complète et cloisonnée : ses nœuds, son sous-réseau privé, ses partages, ses zones DNS et son journal n'existent que pour lui. L'adresse du tableau de bord commence par l'identifiant du workspace, et on bascule de l'un à l'autre depuis le sélecteur en haut de la barre latérale.",
      },
      {
        icon: KeyRound,
        title: 'Membres & connexion SSO',
        isNew: true,
        href: '/docs/workspaces',
        description:
"On se connecte soit par e-mail/mot de passe, soit via Authentik (OpenID Connect). Un workspace a un propriétaire, des membres, et peut se voir rattacher un groupe Authentik : toute personne appartenant à ce groupe devient membre automatiquement à sa prochaine connexion.",
      },
    ],
  },
  {
    label: 'Infrastructure',
    concepts: [
      {
        icon: Server,
        title: 'Nœud',
        description:
"Un nœud est un serveur physique ou virtuel enregistré dans Tarmac. Un petit agent tourne dessus et remonte en continu son état (CPU, RAM, disques, réseau). C'est la brique de base : tout le reste — partages, montages, réplication, DNS — s'organise entre nœuds.",
      },
      {
        icon: Cpu,
        title: 'Agent',
        description:
"Le programme installé sur chaque nœud. Il ouvre lui-même une connexion sortante vers le control plane (aucun port entrant à ouvrir), remonte la télémétrie et exécute les commandes reçues : monter un partage, lancer une migration, configurer WireGuard ou PowerDNS. Sa version est comparée à celle du control plane, et il se met à jour à distance en un clic.",
      },
      {
        icon: Thermometer,
        title: 'Santé SMART',
        description:
"Chaque disque physique est interrogé via smartctl (température, secteurs réalloués/en attente). Un disque qui passe en état critique déclenche une alerte et une migration de sécurisation suggérée vers le nœud le moins chargé — jamais démarrée automatiquement. Un disque virtualisé (VPS) sans données SMART réelles est classé « inconnu », jamais « critique » par défaut.",
      },
      {
        icon: BellOff,
        title: 'Fenêtre de maintenance',
        description:
"Mettre un nœud « en silence » suspend temporairement ses alertes de règles et SMART, le temps d'une intervention planifiée, sans désactiver la supervision elle-même.",
      },
    ],
  },
  {
    label: 'Stockage',
    concepts: [
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
"Un montage attache une source distante — NFS, CIFS, ou SFTP via rclone — à un dossier local sur un nœud, comme s'il s'agissait d'un disque local. Plusieurs sources de secours peuvent être déclarées : si la principale tombe, une autre prend le relais.",
      },
      {
        icon: RefreshCw,
        title: 'Pool & réplication',
        description:
"Un pool regroupe plusieurs nœuds autour d'une même stratégie de stockage. La réplication copie les données d'un nœud primaire vers un ou plusieurs nœuds secondaires, pour la redondance ou la répartition de charge.",
      },
      {
        icon: Repeat,
        title: 'Tâche de synchronisation',
        description:
"Une copie rsync planifiée entre deux chemins, avec son historique d'exécutions. Elle peut aussi être déclenchée depuis l'extérieur par un jeton dédié — typiquement le script « on completion » d'un client torrent, qui ne synchronise alors que le sous-dossier concerné.",
      },
      {
        icon: ArrowRightLeft,
        title: 'Migration',
        description:
"Une migration déplace un volume d'un endroit à un autre : entre deux nœuds Tarmac, ou depuis/vers un service externe (seedbox, Hetzner Storage Box). La progression du transfert est visible en direct.",
      },
    ],
  },
  {
    label: 'Réseau',
    concepts: [
      {
        icon: Network,
        title: 'Réseau privé (VLAN)',
        description:
"Les nœuds sont reliés entre eux sur un mesh WireGuard privé, isolé d'Internet, avec une IP dédiée par nœud. Chaque workspace dispose de son propre sous-réseau, ce qui empêche deux flottes de se voir. Tarmac visualise ce réseau sous forme de graphe (positions déplaçables et mémorisées) et permet de tester deux nœuds entre eux, en latence/perte de paquets (ping) ou saut par saut (traceroute).",
      },
      {
        icon: Globe,
        title: 'Carte du monde',
        description:
"Une vue géographique de la flotte, en plus du graphe : chaque nœud est placé sur sa position réelle (ou approximative, déduite du pays via une base GeoIP auto-hébergée, en attendant d'être précisée à la souris) et les liens VLAN s'animent en direct selon leur état — sain, dégradé ou hors ligne.",
      },
      {
        icon: Waypoints,
        title: 'Régions & passerelles',
        description:
"Au-delà de deux continents, relier chaque nœud à tous les autres en direct devient coûteux. Tarmac regroupe automatiquement les membres du VLAN par région géographique (Europe, Amérique du Nord…) : au sein d'une région, le maillage reste complet ; entre deux régions, seuls les nœuds désignés « passerelle » se relient. Sans passerelle désignée, tout reste en maillage direct comme avant.",
      },
    ],
  },
  {
    label: 'DNS',
    concepts: [
      {
        icon: Boxes,
        title: 'Groupe DNS',
        isNew: true,
        href: '/docs/dns',
        description:
"Un groupe désigne, parmi vos nœuds, un serveur DNS primaire et jusqu'à trois secondaires. Tarmac y installe et configure PowerDNS, puis maintient la synchronisation des zones du primaire vers les secondaires par transfert AXFR.",
      },
      {
        icon: Globe,
        title: 'Zone, enregistrements & GeoDNS',
        isNew: true,
        href: '/docs/dns',
        description:
"Une zone est un domaine que vos serveurs font autorité à résoudre, avec ses enregistrements (A, AAAA, CNAME, MX, TXT, NS, CAA, SRV, PTR). Un enregistrement peut viser directement un nœud de la flotte, et être marqué « géo » : le serveur renvoie alors l'adresse du nœud le plus proche de la personne qui interroge.",
      },
      {
        icon: Network,
        title: 'DNS interne (tarmac.local)',
        isNew: true,
        href: '/docs/dns',
        description:
"Indépendamment de vos zones publiques, un nœud du workspace peut être désigné résolveur interne : chaque serveur devient joignable par son nom en <nom>.tarmac.local sur le VLAN, sans avoir à retenir les IP privées. La liste est resynchronisée automatiquement à chaque changement de la flotte.",
      },
    ],
  },
  {
    label: 'Supervision',
    concepts: [
      {
        icon: Bell,
        title: 'Alertes',
        description:
"Une règle de seuil (ex: CPU > 90%) est évaluée automatiquement chaque minute sur les nœuds ciblés. L'alerte créée se résout d'elle-même dès le retour sous le seuil, et peut être notifiée par e-mail, webhook ou Slack.",
      },
      {
        icon: ScrollText,
        title: 'Journal & audit',
        isNew: true,
        description:
"Deux flux dans un même écran : le journal d'actions (qui a créé, modifié ou supprimé quoi, avec le détail de la requête) et les logs remontés par les agents. Les deux arrivent en direct par WebSocket, se filtrent par nœud, niveau, action ou période, et s'exportent en CSV ou JSON.",
      },
    ],
  },
];

export default function ConceptsPage() {
  return (
    <div className="space-y-12">
      <PageHeader
        title="Concepts clés"
        description="Le vocabulaire de Tarmac, expliqué simplement — pas besoin d'être expert réseau pour s'y retrouver."
      />

      {SECTIONS.map((section) => (
        <section key={section.label} className="space-y-4">
          <SectionLabel>{section.label}</SectionLabel>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {section.concepts.map((concept) => {
              const body = (
                <Card className="h-full transition-colors hover:border-border">
                  <CardHeader>
                    <div className="flex items-center gap-2.5">
                      <concept.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <CardTitle className="text-base">{concept.title}</CardTitle>
                      {concept.isNew && (
                        <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-300">
                          Nouveau
                        </span>
                      )}
                    </div>
                    <CardDescription className="pt-1">{concept.description}</CardDescription>
                  </CardHeader>
                </Card>
              );
              return concept.href ? (
                <Link key={concept.title} href={concept.href} className="block">
                  {body}
                </Link>
              ) : (
                <div key={concept.title}>{body}</div>
              );
            })}
          </div>
        </section>
      ))}

      <section className="space-y-4">
        <SectionLabel>Comment ces briques s&apos;articulent</SectionLabel>
        <p className="text-sm text-muted-foreground">
          Sept scénarios types, du partage de fichiers simple à la remédiation automatique d&apos;un disque
          défaillant. Les schémas propres au DNS sont sur la{' '}
          <Link href="/docs/dns" className="underline underline-offset-2">
            page DNS
          </Link>
          .
        </p>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Partage exposé, puis monté</CardTitle>
              <CardDescription>Deux nœuds interconnectés : un partage exposé sur l&apos;un, monté sur l&apos;autre.</CardDescription>
            </CardHeader>
            <CardContent>
              <Diagram
                viewBox="0 0 640 190"
                label="Schéma d'un partage NFS monté entre deux nœuds interconnectés par VLAN"
              >
                <DBox x={20} y={55} w={180} h={80} title="Nœud A" sub="partage NFS /data" tone="accent" glow />
                <DBox x={440} y={55} w={180} h={80} title="Nœud B" sub="montage /mnt/data" />
                <DLink x1={204} y1={95} x2={436} y2={95} label="NFS via VLAN privé" flow />
                <DNote x={320} y={128}>lecture seule, lecture/écriture ou refusé</DNote>
              </Diagram>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pool en réplication miroir</CardTitle>
              <CardDescription>Un nœud primaire réplique en continu vers un ou plusieurs nœuds replica.</CardDescription>
            </CardHeader>
            <CardContent>
              <Diagram
                viewBox="0 0 640 190"
                label="Schéma d'un pool en réplication miroir depuis un nœud primaire vers deux replicas"
              >
                <DBox x={20} y={57} w={175} h={76} title="Nœud primaire" sub="rôle : primary" tone="accent" glow />
                <DBox x={445} y={14} w={175} h={62} title="Replica A" sub="rôle : replica" />
                <DBox x={445} y={114} w={175} h={62} title="Replica B" sub="rôle : replica" />
                <DLink x1={199} y1={86} x2={441} y2={46} flow labelDy={-10} />
                <DLink x1={199} y1={106} x2={441} y2={146} flow />
                <DNote x={320} y={100} tone="accent">réplication miroir</DNote>
              </Diagram>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Migration entre deux endroits</CardTitle>
              <CardDescription>La source peut être un nœud Tarmac, une seedbox ou un Storage Box.</CardDescription>
            </CardHeader>
            <CardContent>
              <Diagram
                viewBox="0 0 640 190"
                label="Schéma d'une migration d'un volume depuis une source vers un nœud cible"
              >
                <DBox x={20} y={55} w={190} h={80} title="Source" sub={['nœud, seedbox', 'ou Storage Box']} />
                <DBox x={430} y={55} w={190} h={80} title="Nœud cible" sub="destination du volume" tone="accent" glow />
                <DLink x1={214} y1={95} x2={426} y2={95} label="transfert" sublabel="progression en direct" flow />
              </Diagram>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Réseau privé (VLAN)</CardTitle>
              <CardDescription>Les nœuds membres se voient entre eux et peuvent être testés deux à deux.</CardDescription>
            </CardHeader>
            <CardContent>
              <Diagram
                viewBox="0 0 640 190"
                label="Schéma d'un maillage de trois nœuds reliés par un VLAN privé, avec un test de latence entre deux d'entre eux"
              >
                <DLink x1={110} y1={78} x2={320} y2={128} tone="default" arrow="none" />
                <DLink x1={530} y1={78} x2={320} y2={128} tone="default" arrow="none" />
                <DLink x1={190} y1={48} x2={450} y2={48} arrow="none" flow />
                <DNote x={320} y={30} tone="accent">test ping : 2 ms, 0 % de perte</DNote>

                <DBox x={30} y={22} w={160} h={56} title="Nœud A" sub="10.10.0.1" tone="accent" />
                <DBox x={450} y={22} w={160} h={56} title="Nœud B" sub="10.10.0.2" tone="accent" />
                <DBox x={240} y={126} w={160} h={56} title="Nœud C" sub="10.10.0.3" />
              </Diagram>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Segmentation régionale via passerelles</CardTitle>
              <CardDescription>Maillage complet au sein de chaque région, un seul lien entre les deux passerelles.</CardDescription>
            </CardHeader>
            <CardContent>
              <Diagram
                viewBox="0 0 640 215"
                label="Schéma de deux régions VLAN, chacune en maillage complet en interne, reliées uniquement par leurs nœuds passerelle respectifs"
              >
                <DFrame x={14} y={14} w={272} h={186} label="Région : Europe" />
                <DFrame x={354} y={14} w={272} h={186} label="Région : Amérique du Nord" />

                <DLink x1={105} y1={116} x2={105} y2={150} tone="default" arrow="none" />
                <DLink x1={443} y1={116} x2={443} y2={150} tone="default" arrow="none" />

                <DBox x={44} y={56} w={122} h={60} title="Nœud A" badge="Passerelle" tone="accent" glow />
                <DBox x={44} y={148} w={122} h={44} title="Nœud B" />
                <DBox x={382} y={56} w={122} h={60} title="Nœud C" badge="Passerelle" tone="accent" glow />
                <DBox x={382} y={148} w={122} h={44} title="Nœud D" />

                <DLink x1={170} y1={86} x2={378} y2={86} arrow="both" flow />
                <DNote x={274} y={68} tone="accent">seul lien inter-régions</DNote>
              </Diagram>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Journal en direct et export</CardTitle>
              <CardDescription>
                Actions d&apos;administration et logs d&apos;agents convergent vers le même écran, poussés en direct.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Diagram
                viewBox="0 0 640 215"
                label="Schéma du journal : les agents et l'API alimentent l'historique, qui est poussé en direct au navigateur et exportable en CSV ou JSON"
              >
                <DBox x={16} y={24} w={150} h={54} title="Agents" sub="logs de service" />
                <DBox x={16} y={110} w={150} h={54} title="API" sub="actions admin" tone="accent" />
                <DBox x={240} y={66} w={150} h={56} title="Historique" sub="par workspace" tone="accent" glow />
                <DBox x={464} y={20} w={160} h={54} title="Navigateur" sub="poussé en direct" />
                <DBox x={464} y={114} w={160} h={54} title="Export" sub="CSV ou JSON" tone="success" />

                <DLink x1={170} y1={51} x2={236} y2={80} />
                <DLink x1={170} y1={137} x2={236} y2={108} />
                <DLink x1={394} y1={84} x2={460} y2={47} label="WebSocket" labelDy={-16} flow />
                <DLink x1={394} y1={104} x2={460} y2={141} tone="success" />
                <DNote x={320} y={166}>filtres : nœud, niveau, action, période</DNote>
              </Diagram>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Alertes : d&apos;une métrique à la remédiation</CardTitle>
            <CardDescription>
              Les règles de seuil sont évaluées chaque minute ; un disque SMART critique peut aussi déclencher une
              migration de sécurisation, toujours en attente de validation manuelle.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Diagram
              viewBox="0 0 700 235"
              label="Schéma du flux d'alerte, de la métrique surveillée à la notification, avec une branche vers une migration de sécurisation suggérée en cas de disque SMART critique"
            >
              <DBox x={10} y={52} w={152} h={72} title="Métrique" sub={['cpu, ram, disque', 'état SMART']} />
              <DBox x={194} y={52} w={152} h={72} title="Évaluateur" sub={['règles de seuil', 'toutes les minutes']} tone="accent" />
              <DBox x={378} y={52} w={152} h={72} title="Alerte" sub={['créée, puis résolue', 'au retour sous seuil']} tone="warning" />
              <DBox x={562} y={52} w={128} h={72} title="Notification" sub={['e-mail, webhook', 'ou Slack']} tone="success" />

              <DLink x1={166} y1={88} x2={190} y2={88} />
              <DLink x1={350} y1={88} x2={374} y2={88} tone="warning" />
              <DLink x1={534} y1={88} x2={558} y2={88} tone="success" />

              <DLink x1={454} y1={128} x2={454} y2={162} tone="danger" />
              <DNote x={520} y={150} tone="danger">si SMART critique</DNote>
              <DBox
                x={378}
                y={164}
                w={152}
                h={58}
                title="Migration suggérée"
                sub="en attente — jamais auto-démarrée"
                tone="danger"
              />
              <DNote x={10} y={214} anchor="start">
                Un nœud en maintenance ne déclenche ni règle ni alerte SMART.
              </DNote>
            </Diagram>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
