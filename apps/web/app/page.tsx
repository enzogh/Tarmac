'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  ArrowRightLeft,
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  Code2,
  Crown,
  Database,
  Eye,
  Globe2,
  HardDrive,
  KeyRound,
  Lock,
  Network,
  Pencil,
  Radar,
  RefreshCw,
  ScrollText,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';
import { SiteHeader } from '../components/SiteHeader';
import { BrandMark } from '../components/BrandMark';
import { Button } from '../components/ui/button';
import { Reveal } from '../components/motion/reveal';
import { WorldConnectivityVisual } from '../components/landing/hero-network-visual';
import { API_KEY_RESOURCES, type AccessLevel } from '../lib/api-key-permissions';
import { cn } from '../lib/utils';

// Grouped the way the console's sidebar is, so what's read here is where
// it's found once signed in.
const PILLARS: Array<{ title: string; description: string; icon: LucideIcon; items: Array<{ icon: LucideIcon; title: string; text: string }> }> = [
  {
    title: 'Infrastructure',
    description: 'Vos serveurs, reliés et visibles en un coup d’œil.',
    icon: Server,
    items: [
      { icon: Server, title: 'Nœuds', text: 'Agent installé en une commande. CPU, RAM, swap, disques SMART et matériel remontés en continu.' },
      { icon: Network, title: 'Réseau privé', text: 'Mesh WireGuard chiffré, passerelles régionales, latence de chaque lien, ping et traceroute.' },
      { icon: Globe2, title: 'DNS faisant autorité', text: 'Zones hébergées chez vous : GeoDNS, DNSSEC, délégation vérifiée et DNS interne.' },
    ],
  },
  {
    title: 'Stockage & données',
    description: 'Partager, monter et déplacer sans fichier de config.',
    icon: Database,
    items: [
      { icon: Database, title: 'Partages NFS', text: 'Dossiers exposés en quelques clics, droits par client.' },
      { icon: HardDrive, title: 'Montages', text: 'Plusieurs sources derrière un point de montage, bascule automatique en cas de panne.' },
      { icon: RefreshCw, title: 'Réplication', text: 'Pools de nœuds et synchronisations planifiées pour la redondance.' },
      { icon: ArrowRightLeft, title: 'Migrations', text: 'Déplacement de volumes entre serveurs, suivi en direct.' },
    ],
  },
  {
    title: 'Accès & supervision',
    description: 'Savoir ce qui se passe, et qui peut y toucher.',
    icon: ShieldCheck,
    items: [
      { icon: Waypoints, title: 'VPN multi-sorties', text: 'Un profil par appareil, sortie Internet changée à chaud parmi toute la flotte.' },
      { icon: Bell, title: 'Alertes', text: 'Seuils par métrique, emails regroupés, webhooks et Slack.' },
      { icon: ScrollText, title: 'Journal', text: 'Qui a fait quoi, et les logs des agents en direct, avec tout l’historique.' },
    ],
  },
];

const STEPS = [
  { title: 'Ajoutez un serveur', text: 'Adresse IP et accès SSH : Tarmac installe l’agent, le relie au réseau privé et lui attribue une adresse.' },
  { title: 'Organisez la flotte', text: 'Régions et passerelles, partages, montages, zones DNS : tout se règle depuis la console.' },
  { title: 'Invitez l’équipe', text: 'Chaque membre reçoit un rôle : lecteur, éditeur, ou des droits choisis page par page.' },
  { title: 'Supervisez', text: 'Métriques en direct, alertes avant l’incident, et un journal complet de chaque action.' },
];

const FACTS = [
  { value: '1 commande', label: 'pour installer un agent' },
  { value: '100 %', label: 'auto-hébergé, sans dépendance cloud' },
  { value: 'WireGuard', label: 'pour chaque lien entre vos nœuds' },
  { value: 'API REST', label: 'pour tout ce que fait l’interface' },
];

const FAQ = [
  {
    q: 'Où sont hébergées mes données ?',
    a: 'Chez vous. Tarmac s’installe sur votre propre serveur (Docker) et les agents ouvrent eux-mêmes une connexion sortante vers lui : aucun port à exposer sur les nœuds, aucun service tiers.',
  },
  {
    q: 'Quels serveurs sont compatibles ?',
    a: 'Tout serveur Linux joignable en SSH, physique ou virtuel, chez n’importe quel hébergeur. L’agent est un binaire Go léger, installé comme service systemd.',
  },
  {
    q: 'Puis-je donner un accès en lecture seule à un collègue ou un client ?',
    a: 'Oui. Dans Paramètres → Membres et rôles, choisissez Lecteur, ou réglez l’accès page par page. Les pages sans accès disparaissent de son menu, et l’API applique les mêmes règles.',
  },
  {
    q: 'Plusieurs flottes séparées ?',
    a: 'Chaque workspace a ses propres nœuds, son sous-réseau privé, ses zones DNS et ses membres. Deux workspaces ne se voient pas sur le réseau.',
  },
];

// --- illustrations --------------------------------------------------------

const DEMO_NODES = [
  { name: 'par-storage-01', city: 'Paris', flag: '🇫🇷', status: 'ok', cpu: 23, ram: 61, swap: 4 },
  { name: 'fsn-backup-01', city: 'Falkenstein', flag: '🇩🇪', status: 'ok', cpu: 37, ram: 72, swap: 0 },
  { name: 'gra-compute-02', city: 'Gravelines', flag: '🇫🇷', status: 'warn', cpu: 81, ram: 88, swap: 96 },
  { name: 'bhs-edge-01', city: 'Beauharnois', flag: '🇨🇦', status: 'ok', cpu: 12, ram: 44, swap: 10 },
] as const;

const tone = (value: number) => (value >= 85 ? 'bg-[hsl(var(--danger))]' : value >= 65 ? 'bg-[hsl(var(--warn))]' : 'bg-[hsl(var(--ok))]');

function Meter({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-3">
        <span className={cn('block h-full rounded-full', tone(value))} style={{ width: `${value}%` }} />
      </span>
      <span className={cn('w-7 text-right text-2xs tabular-nums', value >= 85 ? 'text-[hsl(var(--danger))]' : 'text-muted-foreground')}>{value}%</span>
    </span>
  );
}

// A static rendering of the Nodes screen: what people get, rather than an
// abstract illustration of it.
function ConsolePreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-1 shadow-overlay" aria-hidden="true">
      <div className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-4 py-2.5">
        <span className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-surface-3" />
          <span className="h-2.5 w-2.5 rounded-full bg-surface-3" />
          <span className="h-2.5 w-2.5 rounded-full bg-surface-3" />
        </span>
        <span className="ml-2 flex items-center gap-1.5 text-2xs text-muted-foreground">
          <BrandMark size="sm" className="h-4 w-4" /> Tarmac / Nœuds
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 border-b border-border p-3 sm:grid-cols-4">
        {[
          { label: 'En ligne', value: '4 / 4', cls: 'text-[hsl(var(--ok))]' },
          { label: 'CPU moyen', value: '38 %', cls: 'text-foreground' },
          { label: 'RAM moyenne', value: '66 %', cls: 'text-[hsl(var(--warn))]' },
          { label: 'À surveiller', value: '1', cls: 'text-[hsl(var(--warn))]' },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-left">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{stat.label}</p>
            <p className={cn('text-lg font-semibold tabular-nums', stat.cls)}>{stat.value}</p>
          </div>
        ))}
      </div>
      <div className="overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border text-2xs text-muted-foreground">
              <th className="px-4 py-2 font-medium">Nœud</th>
              <th className="hidden px-2 py-2 font-medium sm:table-cell">Localisation</th>
              <th className="hidden px-2 py-2 font-medium min-[420px]:table-cell">CPU</th>
              <th className="px-2 py-2 font-medium">RAM · swap</th>
            </tr>
          </thead>
          <tbody>
            {DEMO_NODES.map((node) => (
              <tr key={node.name} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2">
                    <span className={cn('h-1.5 w-1.5 rounded-full', node.status === 'ok' ? 'bg-[hsl(var(--ok))]' : 'bg-[hsl(var(--warn))]')} />
                    <span className="font-medium text-foreground">{node.name}</span>
                  </span>
                </td>
                <td className="hidden px-2 py-2.5 text-muted-foreground sm:table-cell">
                  {node.flag} {node.city}
                </td>
                <td className="hidden px-2 py-2.5 min-[420px]:table-cell">
                  <Meter value={node.cpu} />
                </td>
                <td className="px-2 py-2.5">
                  <Meter value={node.ram} />
                  <span className={cn('mt-0.5 block text-[10px] tabular-nums', node.swap >= 90 ? 'font-medium text-[hsl(var(--danger))]' : 'text-muted-foreground')}>
                    {node.swap ? `Swap ${node.swap} %` : 'Pas de swap'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ROLE_DEMO: Array<{ icon: LucideIcon; label: string; text: string; active?: boolean }> = [
  { icon: Crown, label: 'Administrateur', text: 'Tout, plus les membres et les clés' },
  { icon: Pencil, label: 'Éditeur', text: 'Consulte et modifie tout' },
  { icon: Eye, label: 'Lecteur', text: 'Consulte sans rien modifier' },
  { icon: SlidersHorizontal, label: 'Personnalisé', text: 'Page par page', active: true },
];
const DEMO_LEVELS: Record<string, AccessLevel> = { nodes: 'read', storage: 'none', network: 'read', dns: 'write', vpn: 'none', alerts: 'write', logs: 'read' };

function AccessPreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-1 shadow-overlay" aria-hidden="true">
      <div className="border-b border-border px-4 py-3">
        <p className="text-sm font-medium text-foreground">Rôle de camille@exemple.fr</p>
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          {ROLE_DEMO.map((role) => (
            <div
              key={role.label}
              className={cn(
                'flex items-start gap-2 rounded-lg border px-2.5 py-2',
                role.active ? 'border-primary/60 bg-primary/[0.07]' : 'border-border bg-surface-2',
              )}
            >
              <role.icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', role.active ? 'text-primary' : 'text-muted-foreground')} />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-foreground">{role.label}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{role.text}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
      <ul className="divide-y divide-border">
        {API_KEY_RESOURCES.map((resource) => {
          const level = DEMO_LEVELS[resource.id] ?? 'none';
          return (
            <li key={resource.id} className="flex items-center justify-between gap-3 px-4 py-2">
              <span className={cn('flex items-center gap-2 text-xs', level === 'none' ? 'text-muted-foreground' : 'text-foreground')}>
                <resource.icon className={cn('h-3.5 w-3.5', level === 'none' ? 'text-muted-foreground/60' : 'text-primary')} />
                {resource.label}
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
                  level === 'write' && 'border-primary/30 bg-primary/10 text-primary',
                  level === 'read' && 'border-[hsl(var(--info))]/25 bg-[hsl(var(--info))]/10 text-[hsl(var(--info))]',
                  level === 'none' && 'border-border text-muted-foreground',
                )}
              >
                {level === 'write' ? <Pencil className="h-2.5 w-2.5" /> : level === 'read' ? <Eye className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
                {level === 'write' ? 'Modification' : level === 'read' ? 'Lecture' : 'Aucun accès'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SectionIntro({ eyebrow, title, text, center }: { eyebrow: string; title: string; text?: string; center?: boolean }) {
  return (
    <div className={cn('max-w-2xl', center && 'mx-auto text-center')}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{title}</h2>
      {text && <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">{text}</p>}
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col overflow-x-clip bg-background">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative isolate overflow-hidden">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[620px] opacity-60 blur-[2px] [mask-image:linear-gradient(to_bottom,black_30%,transparent)]"
            aria-hidden="true"
          >
            <WorldConnectivityVisual className="h-full w-full" />
          </div>
          <div className="pointer-events-none absolute left-1/2 top-24 -z-10 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" aria-hidden="true" />

          <div className="mx-auto max-w-6xl px-4 pb-16 pt-16 text-center sm:px-6 sm:pt-24">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
              <Link
                href="/docs/workspaces"
                className="mx-auto inline-flex items-center gap-2 rounded-full border border-border bg-surface-1/80 py-1 pl-1 pr-3 text-xs text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
              >
                <span className="rounded-full bg-primary/15 px-2 py-0.5 font-medium text-primary">Nouveau</span>
                Rôles et droits par page pour votre équipe
                <ArrowRight className="h-3 w-3" />
              </Link>
              <h1 className="mx-auto mt-6 max-w-3xl text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-6xl">
                Toute votre flotte de serveurs, <span className="text-primary">une seule console.</span>
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
                Tarmac relie vos serveurs sur un réseau privé chiffré et pilote leur stockage, leur DNS et leurs accès VPN depuis un tableau de bord
                auto-hébergé — pensé pour les équipes techniques comme pour le self-hosting.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button size="lg" asChild className="w-full gap-2 sm:w-auto">
                  <Link href="/login">
                    Ouvrir la console
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild className="w-full gap-2 sm:w-auto">
                  <Link href="/docs">
                    <BookOpen className="h-4 w-4" />
                    Lire la documentation
                  </Link>
                </Button>
              </div>
            </motion.div>

            <motion.div
              className="mx-auto mt-14 max-w-4xl text-left"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
            >
              <ConsolePreview />
            </motion.div>
          </div>
        </section>

        {/* Facts */}
        <section className="border-y border-border bg-surface-1/50">
          <dl className="mx-auto grid max-w-6xl grid-cols-2 divide-border px-4 sm:px-6 lg:grid-cols-4 lg:divide-x">
            {FACTS.map((fact) => (
              <div key={fact.label} className="px-2 py-6 text-center lg:px-6">
                <dt className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">{fact.value}</dt>
                <dd className="mt-1 text-xs text-muted-foreground sm:text-sm">{fact.label}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Features */}
        <section id="fonctionnalites" className="scroll-mt-16 py-20 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionIntro
              center
              eyebrow="Fonctionnalités"
              title="Ce dont une flotte a besoin, au même endroit"
              text="Organisé comme la console : vous retrouvez chaque fonction là où vous l’attendez."
            />
            <div className="mt-12 grid gap-4 lg:grid-cols-3">
              {PILLARS.map((pillar, index) => (
                <Reveal key={pillar.title} index={index} className="h-full">
                  <div className="flex h-full flex-col rounded-xl border border-border bg-surface-1 p-5 transition-colors hover:border-primary/30">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <pillar.icon className="h-[18px] w-[18px]" />
                      </span>
                      <div>
                        <h3 className="text-base font-semibold text-foreground">{pillar.title}</h3>
                        <p className="text-xs text-muted-foreground">{pillar.description}</p>
                      </div>
                    </div>
                    <ul className="mt-5 space-y-4 border-t border-border pt-5">
                      {pillar.items.map((item) => (
                        <li key={item.title} className="flex gap-3">
                          <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <span>
                            <span className="block text-sm font-medium text-foreground">{item.title}</span>
                            <span className="block text-sm leading-relaxed text-muted-foreground">{item.text}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="border-t border-border bg-surface-1/40 py-20 sm:py-24">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center">
            <div>
              <SectionIntro eyebrow="Démarrage" title="Opérationnel en quelques minutes" text="Pas de cluster à monter ni d’agent à configurer à la main : la console fait le travail." />
              <ol className="mt-8 space-y-5">
                {STEPS.map((step, index) => (
                  <li key={step.title} className="relative flex gap-4">
                    {index < STEPS.length - 1 && <span className="absolute left-[15px] top-9 h-[calc(100%-12px)] w-px bg-border" aria-hidden="true" />}
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-sm font-semibold text-primary">
                      {index + 1}
                    </span>
                    <span className="pt-1">
                      <span className="block text-sm font-semibold text-foreground">{step.title}</span>
                      <span className="block text-sm leading-relaxed text-muted-foreground">{step.text}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <Reveal>
              <div className="overflow-hidden rounded-xl border border-border bg-surface-1 shadow-overlay">
                <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-2xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Code2 className="h-3.5 w-3.5" />
                    Installation manuelle (facultative)
                  </span>
                  <span>bash</span>
                </div>
                <pre className="overflow-x-auto px-4 py-4 font-mono text-xs leading-relaxed text-foreground/85">
                  <span className="text-muted-foreground"># L’onboarding depuis la console fait la même chose</span>
                  {'\n'}curl -fsSL https://…/install-agent-service.sh \{'\n'}  | sudo bash -s -- \{'\n'}  --node-id <span className="text-primary">&quot;&lt;NODE_ID&gt;&quot;</span> \{'\n'}  --control-plane-ws <span className="text-primary">&quot;wss://tarmac.exemple/agents-ws&quot;</span> \{'\n'}  --agent-token <span className="text-primary">&quot;&lt;TOKEN&gt;&quot;</span>
                </pre>
                <div className="flex items-center gap-2 border-t border-border bg-[hsl(var(--ok))]/[0.06] px-4 py-2.5 text-xs text-[hsl(var(--ok))]">
                  <Check className="h-3.5 w-3.5" />
                  par-storage-01 a rejoint le réseau privé · 10.255.0.12
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* Access */}
        <section id="acces" className="scroll-mt-16 border-t border-border py-20 sm:py-24">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:items-center">
            <Reveal className="order-2 lg:order-1">
              <AccessPreview />
            </Reveal>
            <div className="order-1 lg:order-2">
              <SectionIntro
                eyebrow="Rôles & API"
                title="Chacun accède à ce qu’il lui faut, rien de plus"
                text="Les mêmes droits s’appliquent aux membres de l’équipe et aux clés API : aucun accès, lecture ou modification, page par page."
              />
              <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
                {[
                  'Lecteur, Éditeur, Administrateur ou rôle personnalisé, modifiable à tout moment',
                  'Les pages hors d’accès disparaissent du menu ; la lecture seule est signalée clairement',
                  'L’API applique exactement les mêmes règles que l’interface',
                  'Chaque changement de rôle et chaque action est tracé dans le journal',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-7 flex flex-wrap gap-3">
                <Button variant="outline" asChild className="gap-1.5">
                  <Link href="/docs/workspaces">
                    Rôles et membres
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button variant="ghost" asChild className="gap-1.5">
                  <Link href="/docs/api-keys">
                    <KeyRound className="h-4 w-4" />
                    Clés API
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="border-t border-border bg-surface-1/40 py-20 sm:py-24">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <SectionIntro center eyebrow="Questions fréquentes" title="Avant de vous lancer" />
            <div className="mt-10 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-1">
              {FAQ.map((item) => (
                <details key={item.q} className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-2/50 [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="px-5 pb-4 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-border py-20 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="relative overflow-hidden rounded-2xl border border-border bg-surface-1 px-6 py-12 text-center sm:px-12">
              <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[36rem] -translate-x-1/2 rounded-full bg-primary/25 blur-[100px]" aria-hidden="true" />
              <Radar className="mx-auto h-8 w-8 text-primary" />
              <h2 className="mt-4 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Prêt à reprendre la main sur votre flotte ?</h2>
              <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
                Connectez-vous à la console, ou parcourez le guide de démarrage et la référence API.
              </p>
              <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button size="lg" asChild className="w-full gap-2 sm:w-auto">
                  <Link href="/login">
                    Ouvrir la console
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild className="w-full sm:w-auto">
                  <Link href="/docs/api">Référence API</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-[1.5fr_1fr_1fr] sm:px-6">
          <div>
            <Link href="/" className="flex items-center gap-2.5">
              <BrandMark size="sm" />
              <span className="font-semibold text-foreground">Tarmac</span>
            </Link>
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">Orchestration de flotte auto-hébergée : nœuds, réseau privé, stockage, DNS et VPN.</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Produit</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link href="/#fonctionnalites" className="text-muted-foreground hover:text-foreground">Fonctionnalités</Link></li>
              <li><Link href="/#acces" className="text-muted-foreground hover:text-foreground">Rôles & API</Link></li>
              <li><Link href="/login" className="text-muted-foreground hover:text-foreground">Connexion</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Ressources</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link href="/docs" className="text-muted-foreground hover:text-foreground">Documentation</Link></li>
              <li><Link href="/docs/concepts" className="text-muted-foreground hover:text-foreground">Concepts clés</Link></li>
              <li><Link href="/docs/api" className="text-muted-foreground hover:text-foreground">Référence API</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border py-4 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} Tarmac</div>
      </footer>
    </div>
  );
}
