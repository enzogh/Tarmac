import Link from 'next/link';
import {
  ArrowRight,
  Server,
  Database,
  HardDrive,
  Network,
  RefreshCw,
  ArrowRightLeft,
  Bell,
  ShieldCheck,
  Terminal,
  Radar,
} from 'lucide-react';
import { SiteHeader } from '../components/SiteHeader';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';

const FEATURES = [
  {
    icon: Server,
    title: 'Nœuds interconnectés',
    description:
      "Enregistrez vos serveurs en quelques minutes : un agent léger s'installe via SSH et remonte l'état matériel en continu.",
  },
  {
    icon: Database,
    title: 'Partages NFS',
    description: 'Créez des partages réseau et gérez les droits d\'accès par client, sans toucher à un fichier de config.',
  },
  {
    icon: HardDrive,
    title: 'Montages multi-sources',
    description: 'Montez plusieurs sources NFS derrière un point d\'accès unique, avec bascule automatique en cas de panne.',
  },
  {
    icon: RefreshCw,
    title: 'Réplication',
    description: 'Dupliquez vos volumes entre nœuds pour la redondance et la répartition de charge.',
  },
  {
    icon: ArrowRightLeft,
    title: 'Migrations',
    description: 'Déplacez des volumes entre serveurs, seedbox ou Storage Box, avec suivi de progression en direct.',
  },
  {
    icon: Network,
    title: 'Réseau privé (VLAN)',
    description: 'Interconnectez vos nœuds sur un réseau privé et testez la latence et la connectivité entre eux.',
  },
  {
    icon: Bell,
    title: 'Alertes',
    description: 'Définissez des seuils (CPU, RAM, espace disque…) et soyez notifié avant que ça ne devienne un problème.',
  },
  {
    icon: Radar,
    title: 'Supervision en direct',
    description: 'Tableaux de bord temps réel : CPU, RAM, débit réseau et capacité de stockage de toute la flotte.',
  },
];

const STEPS = [
  {
    title: 'Déclarez un nœud',
    description: 'Ajoutez un serveur existant et laissez Tarmac y installer son agent de supervision.',
  },
  {
    title: 'Créez vos partages et montages',
    description: 'Exposez des dossiers en NFS et montez-les sur d\'autres nœuds, avec bascule automatique.',
  },
  {
    title: 'Interconnectez la flotte',
    description: 'Regroupez vos nœuds en pools de réplication et reliez-les sur un réseau privé.',
  },
  {
    title: 'Supervisez',
    description: 'Suivez l\'activité en direct et réagissez aux alertes avant qu\'elles n\'impactent vos données.',
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-6 pb-20 pt-20 text-center sm:pt-28">
          <div className="mx-auto mb-6 flex w-fit items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-1.5 text-xs font-medium text-zinc-400">
            <ShieldCheck className="h-3.5 w-3.5 text-violet-400" />
            Orchestration de stockage auto-hébergé
          </div>
          <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Pilotez vos nœuds de stockage, tous interconnectés.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">
            Tarmac réunit vos serveurs de stockage en une seule flotte : partages NFS, montages, réplication et
            migrations pilotés depuis un tableau de bord unique — pensé pour les passionnés de self-hosting comme
            pour les équipes techniques.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" asChild>
              <Link href="/login">
                Se connecter
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/docs">Découvrir la documentation</Link>
            </Button>
          </div>
        </section>

        {/* How it works */}
        <section className="border-t border-white/[0.06] bg-white/[0.015] py-20">
          <div className="mx-auto max-w-6xl px-6">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-400">Comment ça marche</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                Une flotte de stockage opérationnelle en quatre étapes
              </h2>
            </div>
            <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, index) => (
                <div key={step.title} className="panel p-5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600/15 text-sm font-semibold text-violet-300">
                    {index + 1}
                  </div>
                  <h3 className="mt-4 text-sm font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="py-20">
          <div className="mx-auto max-w-6xl px-6">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-400">Fonctionnalités</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                Tout ce qu'il faut pour gérer une flotte de stockage
              </h2>
            </div>
            <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((feature) => (
                <Card key={feature.title}>
                  <CardHeader>
                    <feature.icon className="h-5 w-5 text-violet-400" />
                    <CardTitle className="pt-3 text-base">{feature.title}</CardTitle>
                    <CardDescription>{feature.description}</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-white/[0.06] py-20">
          <div className="mx-auto max-w-4xl px-6">
            <Card className="bg-panel-glow">
              <CardContent className="flex flex-col items-center gap-5 p-10 text-center">
                <Terminal className="h-8 w-8 text-violet-400" />
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-foreground">
                    Prêt à interconnecter votre stockage ?
                  </h2>
                  <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                    Consultez le guide de démarrage rapide et la référence API dans la documentation, ou connectez-vous
                    directement au tableau de bord.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <Button asChild>
                    <Link href="/login">Accéder au tableau de bord</Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link href="/docs/api">Référence API</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/[0.06] py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-sm text-muted-foreground sm:flex-row">
          <p>© {new Date().getFullYear()} Tarmac</p>
          <div className="flex items-center gap-5">
            <Link href="/docs" className="hover:text-foreground">Documentation</Link>
            <Link href="/docs/api" className="hover:text-foreground">API</Link>
            <Link href="/login" className="hover:text-foreground">Connexion</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
