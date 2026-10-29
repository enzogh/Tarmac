'use client';

import Link from 'next/link';
import { ArrowRight, BookOpen, FolderSync, Network, Server } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { NodeOnboardingModal } from './NodeOnboardingModal';
import { Card } from './ui/card';

function Step({
  index,
  icon: Icon,
  title,
  children,
  action,
}: {
  index: number;
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  action: ReactNode;
}) {
  return (
    <li className="relative flex flex-col rounded-xl border border-white/[0.07] bg-white/[0.02] p-5 transition-colors hover:border-white/[0.12]">
      <div className="mb-4 flex items-center justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <span className="tabular text-xs font-medium text-muted-foreground/70">Étape {index}</span>
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">{children}</p>
      <div className="mt-5">{action}</div>
    </li>
  );
}

const linkClass =
  'inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:text-primary/80';

/**
 * The first thing a new workspace shows instead of a page of zeros: what to
 * do, in order, with the button for the first step right there.
 */
export function GettingStarted({ base, workspaceName, onCreated }: { base: string; workspaceName?: string; onCreated?: () => void }) {
  return (
    <Card className="overflow-hidden">
      <div className="relative border-b border-white/[0.06] px-6 py-7 sm:px-8">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_120%_at_0%_0%,hsl(var(--primary)/0.18),transparent_60%)]"
          aria-hidden
        />
        <p className="relative text-xs font-medium uppercase tracking-wider text-primary">Bien démarrer</p>
        <h2 className="relative mt-2 text-xl font-semibold tracking-tight text-foreground">
          Bienvenue{workspaceName ? ` dans ${workspaceName}` : ''}
        </h2>
        <p className="relative mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Trois étapes pour mettre votre flotte en route. Tout se fait d’ici, sans ligne de commande : Tarmac s’occupe
          de l’installation et de la configuration de vos serveurs.
        </p>
      </div>
      <ol className="grid gap-4 p-6 sm:px-8 md:grid-cols-3">
        <Step index={1} icon={Server} title="Ajoutez votre premier serveur" action={<NodeOnboardingModal onCreated={onCreated} />}>
          Donnez son adresse et un accès SSH. Tarmac y installe son agent, puis le surveille en continu.
        </Step>
        <Step
          index={2}
          icon={Network}
          title="Vos serveurs se relient tout seuls"
          action={
            <Link href={`${base}/network`} className={linkClass}>
              Voir le réseau privé
              <ArrowRight className="h-4 w-4" />
            </Link>
          }
        >
          Dès le deuxième serveur, un réseau privé chiffré les connecte entre eux, sans rien configurer.
        </Step>
        <Step
          index={3}
          icon={FolderSync}
          title="Partagez, protégez, surveillez"
          action={
            <Link href={`${base}/mounts`} className={linkClass}>
              Créer un partage
              <ArrowRight className="h-4 w-4" />
            </Link>
          }
        >
          Partagez des dossiers entre serveurs, filtrez les accès avec le pare-feu et recevez une alerte au moindre
          souci.
        </Step>
      </ol>
      <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-6 py-3.5 text-sm text-muted-foreground sm:px-8">
        <BookOpen className="h-4 w-4" aria-hidden />
        Une question ?
        <Link href="/docs" className="font-medium text-foreground underline-offset-4 hover:underline">
          Consultez le guide d’utilisation
        </Link>
      </div>
    </Card>
  );
}
