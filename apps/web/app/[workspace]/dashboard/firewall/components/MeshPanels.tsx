'use client';

import { useMemo, useState } from 'react';
import {
  Ban,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  Copy,
  Eye,
  MoreHorizontal,
  Pencil,
  Plus,
  Radar,
  ShieldCheck,
  Sparkles,
  Timer,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { StatusPill } from '@/components/ui/status';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { FirewallMatrixCell, FirewallMode, FirewallNode, FirewallRule, FirewallScope, FirewallSystemFlow } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { useReadOnly } from '@/lib/read-only';
import { cn } from '@/lib/utils';
import { MODE_INFO, NodeName, serviceLabel, sourceSummary, Switch, targetSummary } from './fw-ui';

// ---------------------------------------------------------------------
// Mode selector
// ---------------------------------------------------------------------

export function ModeSelector({
  value,
  onChange,
  scope,
  busy,
  compact,
}: {
  value: FirewallMode;
  onChange: (mode: FirewallMode) => void;
  scope: FirewallScope;
  busy?: boolean;
  compact?: boolean;
}) {
  const { readOnly } = useReadOnly();
  const modes: FirewallMode[] = ['open', 'observe', 'enforce'];
  return (
    <div className={cn('grid gap-2', compact ? 'grid-cols-3' : 'sm:grid-cols-3')} role="radiogroup" aria-label="Mode du pare-feu">
      {modes.map((mode, index) => {
        const info = MODE_INFO[mode];
        const active = value === mode;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={busy || readOnly}
            onClick={() => !active && onChange(mode)}
            className={cn(
              'group relative flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed',
              active
                ? mode === 'enforce'
                  ? 'border-[hsl(var(--ok))]/50 bg-[hsl(var(--ok))]/[0.07] ring-1 ring-[hsl(var(--ok))]/25'
                  : mode === 'observe'
                    ? 'border-[hsl(var(--info))]/50 bg-[hsl(var(--info))]/[0.07] ring-1 ring-[hsl(var(--info))]/25'
                    : 'border-primary/40 bg-surface-3 ring-1 ring-primary/20'
                : 'border-border bg-surface-2 hover:border-primary/30 disabled:hover:border-border',
              compact && 'items-center justify-center px-1.5 py-1.5',
            )}
          >
            <span className={cn('flex items-center', compact ? 'gap-1.5' : 'gap-2')}>
              <info.icon
                className={cn(
                  'h-4 w-4 shrink-0',
                  active ? (mode === 'enforce' ? 'text-[hsl(var(--ok))]' : mode === 'observe' ? 'text-[hsl(var(--info))]' : 'text-primary') : 'text-muted-foreground',
                )}
              />
              <span className={cn(compact ? 'text-xs' : 'text-sm', 'font-medium', active ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground')}>
                {!compact && <span className="mr-1 text-2xs text-muted-foreground">{index + 1}.</span>}
                {info.title}
              </span>
              {active && !compact && <CircleCheck className="ml-auto h-3.5 w-3.5 text-muted-foreground" />}
            </span>
            {!compact && <span className="text-xs leading-relaxed text-muted-foreground">{scope === 'mesh' ? info.mesh : info.public}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------
// Access matrix
// ---------------------------------------------------------------------

const CELL: Record<FirewallMatrixCell['status'], { className: string; label: string; icon: typeof CircleCheck }> = {
  open: { className: 'bg-[hsl(var(--ok))]/15 text-[hsl(var(--ok))] hover:bg-[hsl(var(--ok))]/25', label: 'Tout passe', icon: CircleCheck },
  partial: { className: 'bg-[hsl(var(--warn))]/15 text-[hsl(var(--warn))] hover:bg-[hsl(var(--warn))]/25', label: 'Certains services', icon: CircleDashed },
  blocked: { className: 'bg-[hsl(var(--danger))]/15 text-[hsl(var(--danger))] hover:bg-[hsl(var(--danger))]/25', label: 'Bloqué', icon: Ban },
  observed: { className: 'bg-[hsl(var(--info))]/15 text-[hsl(var(--info))] hover:bg-[hsl(var(--info))]/25', label: 'Serait bloqué', icon: Eye },
};

export function AccessMatrix({
  nodes,
  cells,
  mode,
  onCreateRule,
  onTest,
}: {
  nodes: FirewallNode[];
  cells: FirewallMatrixCell[];
  mode: FirewallMode;
  onCreateRule: (action: 'allow' | 'deny', sourceNodeId: string, targetNodeId: string) => void;
  onTest: (sourceNodeId: string, targetNodeId: string) => void;
}) {
  const members = nodes.filter((node) => node.vlanIp);
  const [selected, setSelected] = useState<{ source: string; target: string } | null>(null);
  const byPair = useMemo(() => new Map(cells.map((cell) => [`${cell.sourceNodeId}|${cell.targetNodeId}`, cell])), [cells]);
  const current = selected ? byPair.get(`${selected.source}|${selected.target}`) : undefined;
  const name = (id: string) => members.find((node) => node.id === id)?.name ?? '—';

  if (members.length < 2) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          La matrice d’accès apparaît dès que deux serveurs ont rejoint le réseau privé.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">Qui peut joindre qui</h3>
          <p className="text-xs text-muted-foreground">Lignes : serveur d’origine · colonnes : serveur joint. Cliquez sur une case pour le détail.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-2xs text-muted-foreground">
          {(['open', 'partial', mode === 'observe' ? 'observed' : 'blocked'] as const).map((status) => {
            const Icon = CELL[status].icon;
            return (
              <span key={status} className="inline-flex items-center gap-1.5">
                <span className={cn('flex h-4 w-4 items-center justify-center rounded', CELL[status].className)}>
                  <Icon className="h-2.5 w-2.5" />
                </span>
                {CELL[status].label}
              </span>
            );
          })}
        </div>
      </div>
      <div className="scroll-thin overflow-x-auto">
        <table className="border-separate border-spacing-1 p-3 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-surface-1 px-2 text-left align-bottom text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                De ↓ · Vers →
              </th>
              {members.map((target) => (
                <th key={target.id} className="h-28 w-9 align-bottom font-normal">
                  <span className="mx-auto block max-h-28 truncate text-muted-foreground [writing-mode:vertical-rl] rotate-180" title={target.name}>
                    {target.name}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.map((source) => (
              <tr key={source.id}>
                <th className="sticky left-0 z-10 max-w-[12rem] truncate bg-surface-1 px-2 text-left font-normal text-foreground" title={source.name}>
                  {source.name}
                </th>
                {members.map((target) => {
                  if (source.id === target.id) {
                    return (
                      <td key={target.id} className="h-9 w-9 rounded bg-surface-2/40" aria-hidden>
                        <span className="block text-center text-muted-foreground/30">·</span>
                      </td>
                    );
                  }
                  const cell = byPair.get(`${source.id}|${target.id}`);
                  if (!cell) return <td key={target.id} />;
                  const info = CELL[cell.status];
                  const isSelected = selected?.source === source.id && selected?.target === target.id;
                  return (
                    <td key={target.id} className="p-0">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => setSelected(isSelected ? null : { source: source.id, target: target.id })}
                            aria-label={`${source.name} vers ${target.name} : ${info.label}`}
                            className={cn(
                              'flex h-9 w-9 items-center justify-center rounded transition-colors',
                              info.className,
                              isSelected && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
                            )}
                          >
                            <info.icon className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p className="font-medium">
                            {source.name} → {target.name}
                          </p>
                          <p className="text-muted-foreground">{info.label}</p>
                        </TooltipContent>
                      </Tooltip>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {current && selected && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-t border-border bg-surface-2/50 px-4 py-3 animate-fade-in">
          <div className="min-w-0 space-y-1 text-sm">
            <p className="font-medium text-foreground">
              {name(selected.source)} → {name(selected.target)}
              <StatusPill tone={current.status === 'open' ? 'ok' : current.status === 'partial' ? 'warn' : current.status === 'observed' ? 'info' : 'danger'} className="ml-2 align-middle">
                {CELL[current.status].label}
              </StatusPill>
            </p>
            {current.allowed.length > 0 && (
              <p className="text-xs text-muted-foreground">
                <span className="text-[hsl(var(--ok))]">Autorisé :</span> {current.allowed.join(' · ')}
              </p>
            )}
            {current.blocked.length > 0 && (
              <p className="text-xs text-muted-foreground">
                <span className="text-[hsl(var(--danger))]">Bloqué :</span> {current.blocked.join(' · ')}
              </p>
            )}
            {current.status === 'blocked' && current.blocked.length === 0 && (
              <p className="text-xs text-muted-foreground">Aucune règle n’autorise ce trajet : seul le ping de supervision passe.</p>
            )}
            {current.status === 'observed' && (
              <p className="text-xs text-muted-foreground">Aucune règle n’autorise ce trajet : il serait bloqué en mode appliqué.</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => onTest(selected.source, selected.target)}>
              <Radar className="h-3.5 w-3.5" />
              Tester
            </Button>
            <Button write size="sm" variant="secondary" className="gap-1.5" onClick={() => onCreateRule('allow', selected.source, selected.target)}>
              <ShieldCheck className="h-3.5 w-3.5" />
              Autoriser
            </Button>
            <Button write size="sm" variant="secondary" className="gap-1.5 text-[hsl(var(--danger))]" onClick={() => onCreateRule('deny', selected.source, selected.target)}>
              <Ban className="h-3.5 w-3.5" />
              Bloquer
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------

export type RuleAction = 'edit' | 'duplicate' | 'delete' | 'toggle';

export function RulesTable({
  rules,
  nodes,
  scope,
  mode,
  onAction,
  onCreate,
  examples,
}: {
  rules: FirewallRule[];
  nodes: FirewallNode[];
  scope: FirewallScope;
  mode?: FirewallMode;
  onAction: (rule: FirewallRule, action: RuleAction) => void;
  onCreate: () => void;
  examples: Array<{ title: string; text: string; onUse: () => void }>;
}) {
  const { readOnly } = useReadOnly();
  if (rules.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-4 py-8">
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">Aucune règle {scope === 'mesh' ? 'entre serveurs' : 'pour Internet'} pour l’instant</p>
            <p className="mt-1 text-xs text-muted-foreground">Partez d’un exemple ou créez votre propre règle.</p>
          </div>
          <div className="mx-auto grid max-w-3xl gap-2 sm:grid-cols-3">
            {examples.map((example) => (
              <button
                key={example.title}
                type="button"
                onClick={example.onUse}
                className="group rounded-lg border border-border bg-surface-2 p-3 text-left transition-colors hover:border-primary/40"
              >
                <Sparkles className="mb-1.5 h-3.5 w-3.5 text-primary" />
                <p className="text-sm font-medium text-foreground">{example.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{example.text}</p>
              </button>
            ))}
          </div>
          <div className="text-center">
            <Button write size="sm" onClick={onCreate} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Nouvelle règle
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Blocks first: they always win, so that is how they read best.
  const sorted = [...rules].sort((a, b) => (a.action === b.action ? a.name.localeCompare(b.name) : a.action === 'deny' ? -1 : 1));
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-border">
        {sorted.map((rule) => {
          const off = !rule.enabled || rule.expired;
          const waiting = scope === 'mesh' && rule.action === 'allow' && mode === 'open';
          return (
            <li key={rule.id} className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-surface-2/50', off && 'opacity-60')}>
              <span
                className={cn(
                  'inline-flex w-[5.5rem] shrink-0 items-center justify-center gap-1 rounded-md border px-2 py-0.5 text-2xs font-medium',
                  rule.action === 'deny'
                    ? 'border-[hsl(var(--danger))]/30 bg-[hsl(var(--danger))]/10 text-[hsl(var(--danger))]'
                    : 'border-[hsl(var(--ok))]/30 bg-[hsl(var(--ok))]/10 text-[hsl(var(--ok))]',
                )}
              >
                {rule.action === 'deny' ? <Ban className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
                {rule.action === 'deny' ? 'Bloquer' : 'Autoriser'}
              </span>
              <button type="button" onClick={() => onAction(rule, 'edit')} className="min-w-0 flex-1 basis-56 text-left">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-foreground">{rule.name}</span>
                  {rule.expired ? (
                    <StatusPill tone="neutral">Expirée</StatusPill>
                  ) : rule.expiresAt ? (
                    <StatusPill tone="info" dot={false}>
                      <Timer className="h-3 w-3" />
                      jusqu’au {new Date(rule.expiresAt).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </StatusPill>
                  ) : null}
                  {rule.inert && (
                    <StatusPill tone="warn">
                      <TriangleAlert className="h-3 w-3" />
                      Ne cible plus aucun serveur
                    </StatusPill>
                  )}
                  {waiting && !off && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <StatusPill tone="neutral">En attente du mode appliqué</StatusPill>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">En mode ouvert tout passe déjà : cette autorisation comptera en observation et en mode appliqué.</TooltipContent>
                    </Tooltip>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {sourceSummary(rule, nodes)} <span className="text-muted-foreground/60">→</span> {targetSummary(rule, nodes)}
                  <span className="mx-1.5 text-muted-foreground/40">·</span>
                  {serviceLabel(rule)}
                </span>
                {rule.description && <span className="mt-0.5 block truncate text-2xs text-muted-foreground/80">{rule.description}</span>}
              </button>
              <span className="w-32 shrink-0 text-right text-2xs text-muted-foreground">
                {rule.lastHitAt ? (
                  <>
                    Utilisée {formatRelative(rule.lastHitAt)}
                    <span className="block tabular">{Math.round(rule.hitCount).toLocaleString('fr-FR')} connexion(s)</span>
                  </>
                ) : (
                  'Pas encore utilisée'
                )}
              </span>
              <Switch checked={rule.enabled && !rule.expired} onChange={() => onAction(rule, 'toggle')} label={rule.enabled ? 'Désactiver la règle' : 'Activer la règle'} disabled={readOnly} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Actions de la règle">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem write onSelect={() => onAction(rule, 'edit')}>
                    <Pencil />
                    Modifier
                  </DropdownMenuItem>
                  <DropdownMenuItem write onSelect={() => onAction(rule, 'duplicate')}>
                    <Copy />
                    Dupliquer
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem write onSelect={() => onAction(rule, 'delete')} className="text-[hsl(var(--danger))]">
                    <Trash2 />
                    Supprimer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------------
// Flows Tarmac opens by itself
// ---------------------------------------------------------------------

export function SystemFlows({ flows, nodes, scope }: { flows: FirewallSystemFlow[]; nodes: FirewallNode[]; scope: FirewallScope }) {
  const [open, setOpen] = useState(false);
  const shown = flows.filter((flow) => flow.scope === scope);
  const name = (id: string) => nodes.find((node) => node.id === id)?.name ?? 'serveur supprimé';
  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/50" aria-expanded={open}>
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">
            Autorisé automatiquement par Tarmac <span className="ml-1 tabular text-muted-foreground">{shown.length + (scope === 'mesh' ? 1 : 0)}</span>
          </span>
          <span className="block text-xs text-muted-foreground">
            {scope === 'mesh'
              ? 'Ce dont vos synchronisations, montages, DNS et accès VPN ont besoin reste toujours ouvert, sans règle à écrire.'
              : 'Le réseau privé, les passerelles VPN, les serveurs DNS et l’accès SSH restent joignables quoi qu’il arrive.'}
          </span>
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul className="divide-y divide-border border-t border-border text-sm animate-fade-in">
          {scope === 'mesh' && (
            <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
              <span className="min-w-0 flex-1 basis-56">
                <span className="block text-foreground">Supervision des liens</span>
                <span className="block text-xs text-muted-foreground">ping entre serveurs, pour mesurer latence et pertes</span>
              </span>
              <span className="text-xs text-muted-foreground">Tous les serveurs → tous les serveurs · Ping</span>
            </li>
          )}
          {shown.map((flow) => (
            <li key={flow.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
              <span className="min-w-0 flex-1 basis-56">
                <span className="block text-foreground">{flow.label}</span>
                <span className="block text-xs text-muted-foreground">{flow.detail}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {flow.sourceNodeIds === 'all'
                  ? scope === 'mesh'
                    ? 'Tous les serveurs'
                    : 'Tout Internet'
                  : flow.sourceNodeIds.map(name).join(', ')}{' '}
                → {name(flow.targetNodeId)} · {flow.service}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export { NodeName };
