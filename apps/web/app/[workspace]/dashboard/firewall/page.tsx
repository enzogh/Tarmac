'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowRight,
  BrickWallFire,
  CircleCheck,
  Eye,
  Globe2,
  Network,
  Plus,
  Radar,
  ShieldAlert,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusPill } from '@/components/ui/status';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { EventRow, useFirewallEvents } from './components/ActivityPanel';
import { useFirewall } from './components/FirewallContext';
import { FwSection, MODE_INFO } from './components/fw-ui';

const SENSITIVE = new Set([2375, 2376, 3306, 5432, 6379, 9200, 11211, 27017]);

type Todo = { id: string; tone: 'warn' | 'danger' | 'info'; icon: LucideIcon; title: string; text: string; action?: { label: string; href?: string; onClick?: () => void } };

function ZoneCard({
  icon: Icon,
  title,
  status,
  tone,
  text,
  facts,
  href,
}: {
  icon: LucideIcon;
  title: string;
  status: string;
  tone: 'ok' | 'info' | 'neutral' | 'warn';
  text: string;
  facts: Array<{ value: number; label: string; warn?: boolean }>;
  href: string;
}) {
  return (
    <Card className="group relative flex flex-col overflow-hidden p-6 transition-colors hover:border-primary/30">
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-primary/10 blur-3xl" aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </span>
        <StatusPill tone={tone}>{status}</StatusPill>
      </div>
      <h2 className="mt-4 text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-1 flex-1 text-sm leading-relaxed text-muted-foreground">{text}</p>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-border pt-4">
        <div className="flex gap-6">
          {facts.map((fact) => (
            <div key={fact.label}>
              <p className={cn('tabular text-2xl font-semibold leading-none', fact.warn && fact.value > 0 ? 'text-[hsl(var(--warn))]' : 'text-foreground')}>
                {fact.value}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{fact.label}</p>
            </div>
          ))}
        </div>
        <Button variant="secondary" size="sm" asChild>
          <Link href={href} className="gap-1.5">
            Configurer
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </Button>
      </div>
    </Card>
  );
}

export default function FirewallOverviewPage() {
  const { workspace } = useParams<{ workspace: string }>();
  const base = `/${workspace}/dashboard/firewall`;
  const { data, openRule, openTest, replace, notify, fail } = useFirewall();
  const [busy, setBusy] = useState(false);
  const { data: events } = useFirewallEvents({ hours: 24 });
  const nodeById = useMemo(() => new Map(data.nodes.map((node) => [node.id, node])), [data.nodes]);
  const ruleById = useMemo(() => new Map(data.rules.map((rule) => [rule.id, rule])), [data.rules]);

  const meshMode = data.settings.meshMode;
  const meshNodes = data.nodes.filter((node) => node.vlanIp);
  const meshRules = data.rules.filter((rule) => rule.scope === 'mesh' && rule.enabled && !rule.expired);
  const publicRules = data.rules.filter((rule) => rule.scope === 'public' && rule.enabled && !rule.expired);
  const filtered = data.nodes.filter((node) => node.publicMode !== 'open');
  const exposed = data.nodes.flatMap((node) =>
    (node.report?.listening ?? []).filter((entry) => entry.exposure === 'public' && !entry.managedBy).map((entry) => ({ node, entry })),
  );

  const observe = async () => {
    setBusy(true);
    try {
      replace(await api.firewall.updateSettings({ meshMode: 'observe' }));
      notify({ tone: 'success', message: 'Mode observation activé : les connexions qui seraient bloquées apparaissent dans Activité.' });
    } catch (caught) {
      fail(caught, 'Le changement de mode a échoué.');
    } finally {
      setBusy(false);
    }
  };

  const todos: Todo[] = [];
  for (const node of data.nodes.filter((item) => item.apply.status === 'error' || item.apply.status === 'outdated')) {
    todos.push({
      id: `apply-${node.id}`,
      tone: node.apply.status === 'error' ? 'danger' : 'warn',
      icon: TriangleAlert,
      title: `${node.name} : ${node.apply.status === 'error' ? 'règles non appliquées' : 'agent à mettre à jour'}`,
      text: node.apply.message ?? 'Le pare-feu n’a pas pu être appliqué sur ce serveur.',
      action: { label: 'Voir les nœuds', href: `/${workspace}/dashboard/infrastructure` },
    });
  }
  if (meshMode === 'open' && meshNodes.length > 1) {
    todos.push({
      id: 'mesh-open',
      tone: 'warn',
      icon: ShieldAlert,
      title: 'Vos serveurs se joignent sans aucune restriction',
      text: `Chacun des ${meshNodes.length} serveurs peut ouvrir n’importe quelle connexion vers les autres, SSH compris. Le mode observation montre qui parle à qui, sans rien couper.`,
      action: { label: 'Passer en observation', onClick: () => void observe() },
    });
  }
  if (meshMode === 'observe' && data.stats.observed24h > 0) {
    todos.push({
      id: 'review',
      tone: 'info',
      icon: Eye,
      title: `${data.stats.observed24h.toLocaleString('fr-FR')} connexion(s) à passer en revue`,
      text: 'Elles seraient bloquées en mode appliqué. Autorisez celles qui sont légitimes avant d’appliquer.',
      action: { label: 'Ouvrir l’activité', href: `${base}/activity` },
    });
  }
  const risky = exposed.filter(({ entry }) => SENSITIVE.has(entry.port));
  if (risky.length > 0) {
    todos.push({
      id: 'risky',
      tone: 'danger',
      icon: Globe2,
      title: `${risky.length} service(s) sensible(s) ouvert(s) à tout Internet`,
      text: risky
        .slice(0, 3)
        .map(({ node, entry }) => `${entry.service ?? entry.port} sur ${node.name}`)
        .join(', ') + (risky.length > 3 ? '…' : '') + '. Une base de données ne devrait être joignable que depuis des adresses précises.',
      action: { label: 'Voir l’exposition', href: `${base}/internet` },
    });
  }

  const TODO_TONE = {
    warn: 'bg-[hsl(var(--warn))]/10 text-[hsl(var(--warn))]',
    danger: 'bg-[hsl(var(--danger))]/10 text-[hsl(var(--danger))]',
    info: 'bg-[hsl(var(--info))]/10 text-[hsl(var(--info))]',
  };

  return (
    <>
      <PageHeader
        title="Pare-feu"
        description="Choisissez qui peut joindre vos serveurs, entre eux et depuis Internet. Chaque serveur applique lui-même ses règles."
        actionsReadOnlySafe
        actions={
          <>
            <Button variant="secondary" className="gap-1.5" onClick={() => openTest({ scope: 'mesh' })} disabled={data.nodes.length === 0}>
              <Radar className="h-4 w-4" />
              Tester une connexion
            </Button>
            <Button write className="gap-1.5" onClick={() => openRule({ draft: { scope: 'mesh' } })} disabled={data.nodes.length === 0}>
              <Plus className="h-4 w-4" />
              Nouvelle règle
            </Button>
          </>
        }
      />

      {data.nodes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <BrickWallFire className="h-6 w-6 text-primary" />
            </span>
            <h2 className="text-base font-semibold text-foreground">Aucun serveur à protéger pour l’instant</h2>
            <p className="max-w-md text-sm text-muted-foreground">Ajoutez un premier nœud depuis la page Nœuds : son pare-feu se pilotera ensuite d’ici.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="stagger-in grid gap-4 lg:grid-cols-2">
            <ZoneCard
              icon={Network}
              title="Entre vos serveurs"
              status={MODE_INFO[meshMode].title}
              tone={MODE_INFO[meshMode].tone === 'ok' ? 'ok' : meshMode === 'observe' ? 'info' : 'warn'}
              text={MODE_INFO[meshMode].mesh}
              facts={[
                { value: meshNodes.length, label: 'serveurs reliés' },
                { value: meshRules.length, label: 'règles actives' },
              ]}
              href={`${base}/servers`}
            />
            <ZoneCard
              icon={Globe2}
              title="Depuis Internet"
              status={filtered.length === 0 ? 'Non filtré' : `${filtered.length} / ${data.nodes.length} filtré(s)`}
              tone={filtered.length === 0 ? 'warn' : filtered.length === data.nodes.length ? 'ok' : 'info'}
              text={
                filtered.length === 0
                  ? 'Aucun serveur ne filtre encore Internet : tout port en écoute est joignable par n’importe qui.'
                  : 'Les serveurs filtrés n’exposent que les ports autorisés. SSH et les services Tarmac restent toujours joignables.'
              }
              facts={[
                { value: exposed.length, label: 'ports ouverts à tous', warn: true },
                { value: publicRules.length, label: 'règles actives' },
              ]}
              href={`${base}/internet`}
            />
          </div>

          <FwSection title="À faire" description="Ce que Tarmac vous recommande, du plus important au moins urgent.">
            {todos.length === 0 ? (
              <Card className="flex items-center gap-3 p-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[hsl(var(--ok))]/10">
                  <CircleCheck className="h-4 w-4 text-[hsl(var(--ok))]" />
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">Rien à signaler</p>
                  <p className="text-xs text-muted-foreground">Votre pare-feu est en place et aucun point ne demande votre attention.</p>
                </div>
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <ul className="divide-y divide-border">
                  {todos.map((todo) => (
                    <li key={todo.id} className="flex flex-wrap items-center gap-4 px-4 py-4 sm:flex-nowrap">
                      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', TODO_TONE[todo.tone])}>
                        <todo.icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{todo.title}</p>
                        <p className="mt-0.5 text-sm text-muted-foreground">{todo.text}</p>
                      </div>
                      {todo.action &&
                        (todo.action.href ? (
                          <Button variant="secondary" size="sm" asChild className="shrink-0">
                            <Link href={todo.action.href}>{todo.action.label}</Link>
                          </Button>
                        ) : (
                          <Button write size="sm" className="shrink-0" onClick={todo.action.onClick} disabled={busy}>
                            {todo.action.label}
                          </Button>
                        ))}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </FwSection>

          <FwSection
            title="Activité récente"
            description="Les dernières connexions refusées, ou qui le seraient en mode appliqué."
            actions={
              <Button variant="ghost" size="sm" asChild>
                <Link href={`${base}/activity`} className="gap-1.5">
                  Tout voir
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            }
          >
            <Card className="overflow-hidden">
              {!events || events.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">Aucune connexion bloquée ces dernières 24 heures.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {events.slice(0, 5).map((event) => (
                    <EventRow key={event.id} event={event} nodes={nodeById} rules={ruleById} onCreateRule={(draft) => openRule({ draft })} compact />
                  ))}
                </ul>
              )}
            </Card>
          </FwSection>
        </>
      )}
    </>
  );
}
