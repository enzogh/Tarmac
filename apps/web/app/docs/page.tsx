import Link from 'next/link';
import { ArrowRight, Server, Database, Network, RefreshCw } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Callout } from '../../components/Callout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';

export default function DocsHomePage() {
  return (
    <div className="space-y-10">
      <PageHeader
        title="Documentation Tarmac"
        description="Tarmac orchestre une flotte de serveurs de stockage interconnectés : partages NFS, montages, réplication, migrations et supervision réseau, le tout depuis un seul tableau de bord."
      />

      <Callout>
        Nouveau sur Tarmac ? Commencez par le concept de <strong className="text-violet-100">nœud</strong> ci-dessous,
        puis consultez la <Link href="/docs/concepts" className="underline underline-offset-2">page Concepts clés</Link>
        {' '}pour comprendre comment les partages, montages et pools s'articulent entre eux.
      </Callout>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Démarrage rapide</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-600/15 text-sm font-semibold text-violet-300">1</div>
              <CardTitle className="pt-3 text-base">Ajoutez un nœud</CardTitle>
              <CardDescription>
                Depuis Infrastructure → Ajouter un nœud, renseignez l'adresse IP et les identifiants SSH d'un serveur
                Ubuntu 22.04. Tarmac installe l'agent automatiquement.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-600/15 text-sm font-semibold text-violet-300">2</div>
              <CardTitle className="pt-3 text-base">Créez un partage ou un montage</CardTitle>
              <CardDescription>
                Une fois le nœud en ligne, exposez un dossier en NFS (Stockage) ou montez une source existante sur ce
                nœud (Montages).
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-600/15 text-sm font-semibold text-violet-300">3</div>
              <CardTitle className="pt-3 text-base">Supervisez</CardTitle>
              <CardDescription>
                Le tableau de bord remonte CPU, RAM, réseau et stockage en direct, et déclenche des alertes selon les
                seuils que vous définissez.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Installation manuelle de l'agent (avancé)</h2>
        <p className="text-sm text-muted-foreground">
          L'onboarding depuis l'interface suffit dans la grande majorité des cas. Pour une installation manuelle en
          service systemd (redémarrage automatique inclus), utilisez le script d'installation sur un serveur Ubuntu
          22.04 :
        </p>
        <pre className="code-block">
{`curl -fsSL https://raw.githubusercontent.com/enzogh/Tarmac/main/apps/agent/scripts/install-agent-service.sh \\
  | sudo bash -s -- \\
  --node-id "<NODE_ID>" \\
  --control-plane-ws "ws://<API_HOST>:3001/agents-ws" \\
  --agent-token "<AGENT_SHARED_TOKEN>"`}
        </pre>
        <p className="text-sm text-muted-foreground">
          Le script installe les dépendances requises (NFS, CIFS, WireGuard), compile l'agent et active le service
          <code className="mx-1 rounded bg-white/[0.06] px-1.5 py-0.5 text-xs">tarmac-agent</code>
          avec redémarrage automatique.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Modules du tableau de bord</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            { icon: Server, title: 'Infrastructure', href: '/docs/concepts', text: 'Nœuds, agents et pools de stockage.' },
            { icon: Database, title: 'Stockage & montages', href: '/docs/concepts', text: 'Partages NFS et montages multi-sources.' },
            { icon: RefreshCw, title: 'Réplication & migrations', href: '/docs/concepts', text: 'Duplication et déplacement de volumes.' },
            { icon: Network, title: 'Réseau', href: '/docs/concepts', text: 'VLAN privé, carte du monde, passerelles régionales et tests ping/traceroute.' },
          ].map((item) => (
            <Link key={item.title} href={item.href} className="group panel flex items-start gap-3 p-4">
              <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
              <div>
                <p className="text-sm font-medium text-foreground">{item.title}</p>
                <p className="text-sm text-muted-foreground">{item.text}</p>
              </div>
              <ArrowRight className="ml-auto mt-0.5 h-4 w-4 shrink-0 text-zinc-600 transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
