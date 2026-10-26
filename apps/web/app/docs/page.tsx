import Link from 'next/link';
import {
  ArrowRight,
  Server,
  Database,
  Network,
  RefreshCw,
  Globe,
  LayoutGrid,
  ScrollText,
  Bell,
  HardDrive,
  ArrowRightLeft,
  BookOpen,
  ShieldCheck,
  KeyRound,
} from 'lucide-react';
import { Callout } from '../../components/Callout';
import { SectionLabel } from '../../components/SectionLabel';
import { AnimatedGradientText } from '../../components/ui/animated-gradient-text';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Diagram, DBox, DFrame, DLink, DNote } from '../../components/docs/Diagram';

const QUICK_START = [
  {
    title: 'Choisissez un workspace',
    text: "Chaque workspace est une flotte isolée : ses propres nœuds, son propre sous-réseau privé, ses propres zones DNS. L'URL du tableau de bord commence par son identifiant.",
    href: '/docs/workspaces',
  },
  {
    title: 'Ajoutez un nœud',
    text: "Infrastructure → Ajouter un nœud : adresse IP et identifiants SSH d'un serveur Ubuntu 22.04. Tarmac installe l'agent, le rattache au VLAN et lui attribue une IP privée.",
    href: '/docs/concepts',
  },
  {
    title: 'Exposez du stockage ou du DNS',
    text: "Partagez un dossier en NFS, montez une source distante, ou désignez des serveurs DNS primaire/secondaire pour héberger vos propres zones.",
    href: '/docs/dns',
  },
  {
    title: 'Supervisez',
    text: "CPU, RAM, réseau, SMART et latence VLAN en direct. Les règles de seuil déclenchent des alertes, et le Journal conserve actions et logs d'agents.",
    href: '/docs/concepts',
  },
];

const MODULES: { group: string; items: { icon: typeof Server; title: string; text: string; href: string; isNew?: boolean }[] }[] = [
  {
    group: 'Infrastructure',
    items: [
      { icon: Server, title: 'Nœuds', text: 'Onboarding SSH, agents, matériel, RAM et swap, disques et santé SMART.', href: '/docs/concepts' },
      { icon: Network, title: 'Réseau', text: 'Mesh WireGuard, graphe, carte du monde, passerelles régionales, ping/traceroute.', href: '/docs/concepts' },
      { icon: Globe, title: 'DNS', text: 'Groupes primaire/secondaire, zones, DNSSEC, délégation vérifiée, GeoDNS.', href: '/docs/dns' },
      {
        icon: ShieldCheck,
        title: 'VPN',
        text: "Profils WireGuard par appareil : entrée et sortie choisies parmi toute la flotte, sortie changée à chaud.",
        href: '/docs/api#vpn',
      },
    ],
  },
  {
    group: 'Stockage',
    items: [
      { icon: Database, title: 'Stockage', text: 'Partages NFS, capacité agrégée et prévision de saturation.', href: '/docs/concepts' },
      { icon: HardDrive, title: 'Montages', text: 'Sources NFS, CIFS ou SFTP montées sur un nœud, avec sources de secours.', href: '/docs/concepts' },
      { icon: RefreshCw, title: 'Réplication', text: 'Pools de nœuds, rôles primary/replica et tâches de synchronisation planifiées.', href: '/docs/concepts' },
      { icon: ArrowRightLeft, title: 'Migrations', text: 'Déplacement de volumes entre nœuds, seedbox ou Storage Box.', href: '/docs/concepts' },
    ],
  },
  {
    group: 'Supervision & organisation',
    items: [
      { icon: Bell, title: 'Alertes', text: 'Règles de seuil évaluées chaque minute, canaux e-mail / webhook / Slack.', href: '/docs/concepts' },
      { icon: ScrollText, title: 'Journal', text: "Actions de l'équipe et logs d'agents en direct, avec tout l'historique, filtrables et exportables.", href: '/docs/concepts' },
      { icon: LayoutGrid, title: 'Workspaces', text: 'Cloisonnement multi-flottes, membres et rôles (lecteur, éditeur, droits par page), connexion SSO.', href: '/docs/workspaces', isNew: true },
      {
        icon: KeyRound,
        title: 'Clés API',
        text: 'Automatisation par API sur tous les modules, avec des permissions lecture/écriture par module.',
        href: '/docs/api-keys',
      },
    ],
  },
];

export default function DocsHomePage() {
  return (
    <div className="space-y-12">
      <header className="relative overflow-hidden rounded-2xl border border-border bg-surface-1 px-6 py-8 sm:px-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-primary/20 blur-[90px]" aria-hidden="true" />
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Documentation</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Bien démarrer avec Tarmac</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Tarmac orchestre une flotte de serveurs interconnectés : réseau privé, DNS faisant autorité, partages NFS, montages, réplication,
          migrations, VPN et supervision — depuis une seule console.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            { href: '/docs/concepts', icon: BookOpen, title: 'Je découvre', text: 'Les concepts en 5 minutes' },
            { href: '/docs/workspaces', icon: LayoutGrid, title: 'J’invite mon équipe', text: 'Membres, rôles et droits' },
            { href: '/docs/api', icon: KeyRound, title: 'J’automatise', text: 'Clés et référence API' },
          ].map((path) => (
            <Link
              key={path.href}
              href={path.href}
              className="group flex items-center gap-3 rounded-xl border border-border bg-surface-2/50 px-4 py-3 transition-colors hover:border-primary/40 hover:bg-surface-2"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <path.icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{path.title}</span>
                <span className="block text-xs text-muted-foreground">{path.text}</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
            </Link>
          ))}
        </div>
      </header>

      <section className="space-y-4">
        <SectionLabel>Architecture</SectionLabel>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Comment les pièces s&apos;assemblent</CardTitle>
            <CardDescription>
              Un control plane central, un agent léger par serveur, et un réseau privé qui relie toute la flotte.
              Les agents ne sont jamais exposés : ils ouvrent eux-mêmes une connexion sortante vers le control plane.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Diagram
              viewBox="0 0 720 300"
              label="Schéma d'architecture : le navigateur parle au control plane, qui pilote un agent sur chaque nœud, les nœuds étant reliés entre eux par un mesh WireGuard privé"
            >
              <DBox x={16} y={110} w={150} h={64} title="Navigateur" sub="tableau de bord" tone="accent" glow />

              <DFrame x={222} y={16} w={264} h={268} label="Control plane" />
              <DBox x={242} y={52} w={224} h={54} title="Web (Next.js)" sub="interface" />
              <DBox x={242} y={120} w={224} h={54} title="API (NestJS)" sub="REST /api/v1 + WebSockets" tone="accent" />
              <DBox x={242} y={210} w={224} h={54} title="PostgreSQL" sub="état de la flotte, historique" />

              <DFrame x={530} y={16} w={174} h={268} label="Flotte" />
              <DBox x={548} y={52} w={138} h={54} title="Nœud A" sub={['agent Go', '10.x.0.1']} tone="accent" />
              <DBox x={548} y={126} w={138} h={54} title="Nœud B" sub={['agent Go', '10.x.0.2']} />
              <DBox x={548} y={200} w={138} h={54} title="Nœud C" sub={['agent Go', '10.x.0.3']} />

              <DLink x1={168} y1={142} x2={238} y2={142} label="HTTPS" sublabel="+ WS live" labelDy={-22} />
              <DLink x1={354} y1={108} x2={354} y2={116} arrow="both" tone="default" />
              <DLink x1={354} y1={176} x2={354} y2={206} tone="default" />

              <DLink x1={470} y1={140} x2={544} y2={82} label="/agents-ws" labelDy={-12} />
              <DLink x1={470} y1={147} x2={544} y2={152} />
              <DLink x1={470} y1={154} x2={544} y2={222} />

              {/* WireGuard mesh between the nodes, drawn to the right of the fleet frame. */}
              <path d="M 690 79 C 716 100 716 130 690 153" fill="none" stroke="rgb(139 92 246 / 0.55)" strokeWidth="2" strokeDasharray="6 6">
                <animate attributeName="stroke-dashoffset" values="24;0" dur="1.6s" repeatCount="indefinite" />
              </path>
              <path d="M 690 153 C 716 174 716 204 690 227" fill="none" stroke="rgb(139 92 246 / 0.55)" strokeWidth="2" strokeDasharray="6 6">
                <animate attributeName="stroke-dashoffset" values="24;0" dur="1.6s" repeatCount="indefinite" />
              </path>
              <DNote x={617} y={278} tone="accent">
                mesh WireGuard privé
              </DNote>
            </Diagram>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionLabel>Démarrage rapide</SectionLabel>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {QUICK_START.map((step, index) => (
            <Link key={step.title} href={step.href} className="group">
              <Card className="h-full transition-colors group-hover:border-border">
                <CardHeader className="flex-col items-start justify-start gap-y-1 border-b-0">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-600/15 text-sm font-semibold text-primary">
                    {index + 1}
                  </div>
                  <CardTitle className="flex items-center gap-2 pt-3 text-base">
                    {step.title}
                    <ArrowRight className="h-3.5 w-3.5 text-zinc-600 transition-transform group-hover:translate-x-0.5" />
                  </CardTitle>
                  <CardDescription>{step.text}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <SectionLabel>Modules du tableau de bord</SectionLabel>
        {MODULES.map((section) => (
          <div key={section.group} className="space-y-3">
            <h3 className="text-sm font-medium text-zinc-300">{section.group}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {section.items.map((item) => (
                <Link key={item.title} href={item.href} className="group panel flex items-start gap-3 p-4">
                  <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {item.title}
                      {item.isNew && (
                        <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-300">
                          Nouveau
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground">{item.text}</p>
                  </div>
                  <ArrowRight className="ml-auto mt-0.5 h-4 w-4 shrink-0 text-zinc-600 transition-transform group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-4">
        <SectionLabel>Installation manuelle de l&apos;agent</SectionLabel>
        <p className="text-sm text-muted-foreground">
          L&apos;onboarding depuis l&apos;interface suffit dans la grande majorité des cas. Pour une installation
          manuelle en service systemd (redémarrage automatique inclus), utilisez le script d&apos;installation sur un
          serveur Ubuntu 22.04 :
        </p>
        <pre className="code-block">
{`curl -fsSL https://raw.githubusercontent.com/enzogh/Tarmac/main/apps/agent/scripts/install-agent-service.sh \\
  | sudo bash -s -- \\
  --node-id "<NODE_ID>" \\
  --control-plane-ws "ws://<API_HOST>:3001/agents-ws" \\
  --agent-token "<AGENT_SHARED_TOKEN>"`}
        </pre>
        <p className="text-sm text-muted-foreground">
          Le script installe les dépendances requises (NFS, CIFS, rsync, WireGuard, traceroute), compile l&apos;agent
          et active le service
          <code className="mx-1 rounded bg-white/[0.06] px-1.5 py-0.5 text-xs">tarmac-agent</code>
          avec redémarrage automatique. Les composants DNS (PowerDNS) ne sont installés qu&apos;au moment où le nœud
          rejoint un groupe DNS.
        </p>
        <Callout variant="warning">
          Une fois l&apos;agent en place, gardez-le à jour depuis Infrastructure → « Mettre à jour tous les agents » :
          la version du control plane et celle des agents sont comparées en permanence, et un écart est signalé
          directement dans l&apos;interface.
        </Callout>
      </section>
    </div>
  );
}
