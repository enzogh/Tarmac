'use client';

import { ChevronRight, Globe2, Lock, LockOpen, ShieldAlert, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { StatusPill } from '@/components/ui/status';
import type { FirewallListen, FirewallMode, FirewallNode } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { useReadOnly } from '@/lib/read-only';
import { cn } from '@/lib/utils';
import type { RuleDraft } from './RuleDialog';
import { APPLY_INFO, NodeName } from './fw-ui';

// Plain-language names for the internet zone: "open" reads as "nothing is
// filtered" here, which is what it means for a server facing the internet.
export const PUBLIC_MODE: Record<FirewallMode, { label: string; text: string; tone: 'neutral' | 'info' | 'ok' }> = {
  open: { label: 'Pas de filtrage', text: 'Tout port en écoute est joignable par tout Internet.', tone: 'neutral' },
  observe: { label: 'Observation', text: 'Rien n’est coupé ; Tarmac note ce qui serait bloqué.', tone: 'info' },
  enforce: { label: 'Filtré', text: 'Seuls les ports autorisés restent joignables.', tone: 'ok' },
};

const SENSITIVE = new Set([2375, 2376, 3306, 5432, 6379, 9200, 11211, 27017]);

function portName(entry: FirewallListen) {
  return entry.service ?? entry.processes[0] ?? `port ${entry.port}`;
}

function exposed(node: FirewallNode) {
  return (node.report?.listening ?? []).filter((entry) => entry.exposure !== 'local');
}

function ModeSelect({ node, onChange, disabled }: { node: FirewallNode; onChange: (mode: FirewallMode) => void; disabled?: boolean }) {
  return (
    <Select value={node.publicMode} onValueChange={(value) => onChange(value as FirewallMode)} disabled={disabled}>
      <SelectTrigger className="h-8 w-[10.5rem] text-xs" onClick={(event) => event.stopPropagation()}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(['open', 'observe', 'enforce'] as FirewallMode[]).map((mode) => (
          <SelectItem key={mode} value={mode}>
            {PUBLIC_MODE[mode].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** One line per server: what it exposes, and how it is filtered. */
export function InternetServerList({
  nodes,
  busy,
  onOpen,
  onChangeMode,
}: {
  nodes: FirewallNode[];
  busy: boolean;
  onOpen: (node: FirewallNode) => void;
  onChangeMode: (node: FirewallNode, mode: FirewallMode) => void;
}) {
  const { readOnly } = useReadOnly();
  return (
    <Card className="overflow-hidden">
      <ul className="stagger-in divide-y divide-border">
        {nodes.map((node) => {
          const ports = exposed(node);
          const open = ports.filter((entry) => entry.exposure === 'public');
          const risky = open.filter((entry) => !entry.managedBy && SENSITIVE.has(entry.port));
          const problem = ['error', 'outdated', 'offline'].includes(node.apply.status);
          return (
            <li
              key={node.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(node)}
              onKeyDown={(event) => event.key === 'Enter' && onOpen(node)}
              className="flex cursor-pointer flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 transition-colors hover:bg-surface-2/50 sm:flex-nowrap"
            >
              <div className="min-w-0 flex-1 basis-56">
                <NodeName node={node} />
                <p className={cn('mt-1 truncate text-xs', risky.length > 0 ? 'text-[hsl(var(--warn))]' : 'text-muted-foreground')}>
                  {!node.report
                    ? node.status === 'offline'
                      ? 'Hors ligne'
                      : 'En attente du rapport de l’agent'
                    : open.length === 0
                      ? 'Aucun port ouvert à tout Internet'
                      : `Ouvert à tous : ${open.map(portName).join(', ')}`}
                </p>
              </div>
              {risky.length > 0 && (
                <StatusPill tone="warn" dot={false} className="shrink-0">
                  <ShieldAlert className="h-3 w-3" />
                  {risky.length === 1 ? `${portName(risky[0])} exposé` : `${risky.length} services exposés`}
                </StatusPill>
              )}
              {problem && <StatusPill tone={APPLY_INFO[node.apply.status].tone}>{APPLY_INFO[node.apply.status].label}</StatusPill>}
              <div className="flex shrink-0 items-center gap-2" onClick={(event) => event.stopPropagation()}>
                <ModeSelect node={node} onChange={(mode) => onChangeMode(node, mode)} disabled={busy || readOnly} />
              </div>
              <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function PortRow({ entry, node, onCreateRule }: { entry: FirewallListen; node: FirewallNode; onCreateRule: (draft: RuleDraft) => void }) {
  const isPublic = entry.exposure === 'public';
  const draft = (action: 'allow' | 'deny', cidrs: boolean): RuleDraft => ({
    scope: 'public',
    action,
    sourceKind: cidrs ? 'cidrs' : 'any',
    targetKind: 'nodes',
    targetNodeIds: [node.id],
    protocol: entry.protocol,
    ports: [String(entry.port)],
    name: `${action === 'deny' ? 'Fermer' : cidrs ? 'Réserver' : 'Ouvrir'} ${portName(entry)} sur ${node.name}`.slice(0, 80),
  });
  const status = entry.managedBy
    ? { icon: Sparkles, text: `Gardé ouvert par Tarmac (${entry.managedBy.toLowerCase()})`, tone: 'text-muted-foreground' }
    : isPublic
      ? { icon: LockOpen, text: 'Joignable par tout Internet', tone: SENSITIVE.has(entry.port) ? 'text-[hsl(var(--warn))]' : 'text-foreground/80' }
      : entry.exposure === 'restricted'
        ? { icon: Lock, text: 'Réservé à certaines adresses', tone: 'text-[hsl(var(--info))]' }
        : entry.exposure === 'observed'
          ? { icon: Lock, text: 'Ouvert, sera fermé une fois filtré', tone: 'text-[hsl(var(--info))]' }
          : { icon: Lock, text: 'Fermé depuis Internet', tone: 'text-[hsl(var(--ok))]' };
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          {portName(entry)} <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">{entry.port}/{entry.protocol}</span>
        </p>
        <p className={cn('mt-0.5 flex items-center gap-1.5 text-xs', status.tone)}>
          <status.icon className="h-3 w-3" />
          {status.text}
        </p>
      </div>
      {isPublic && !entry.managedBy && (
        <div className="flex gap-1.5">
          <Button write size="sm" variant="secondary" onClick={() => onCreateRule(draft('allow', true))}>
            Réserver à des IP
          </Button>
          <Button write size="sm" variant="ghost" className="text-[hsl(var(--danger))]" onClick={() => onCreateRule(draft('deny', false))}>
            Fermer
          </Button>
        </div>
      )}
    </li>
  );
}

export function InternetServerSheet({
  node,
  busy,
  onOpenChange,
  onChangeMode,
  onCreateRule,
}: {
  node: FirewallNode | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onChangeMode: (node: FirewallNode, mode: FirewallMode) => void;
  onCreateRule: (draft: RuleDraft) => void;
}) {
  const { readOnly } = useReadOnly();
  if (!node) return null;
  const ports = exposed(node);
  const restricted = node.publicMode === 'enforce' && ports.some((entry) => entry.exposure === 'public' && !entry.managedBy);
  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-base">
            <Globe2 className="h-4 w-4 text-primary" />
            {node.name}
          </SheetTitle>
          <SheetDescription>Ce que ce serveur expose à Internet, et comment il est filtré.</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-6">
          <section className="space-y-2.5">
            <h3 className="text-sm font-medium text-foreground">Filtrage</h3>
            <div className="grid gap-2">
              {(['open', 'observe', 'enforce'] as FirewallMode[]).map((mode) => {
                const active = node.publicMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    disabled={busy || readOnly || active}
                    onClick={() => onChangeMode(node, mode)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors disabled:cursor-default',
                      active ? 'border-primary/50 bg-primary/[0.07] ring-1 ring-primary/25' : 'border-border bg-surface-2 hover:border-primary/30',
                    )}
                  >
                    <span className={cn('h-4 w-4 shrink-0 rounded-full border-2', active ? 'border-primary bg-primary shadow-[inset_0_0_0_3px_hsl(var(--popover))]' : 'border-border')} />
                    <span>
                      <span className="block text-sm font-medium text-foreground">{PUBLIC_MODE[mode].label}</span>
                      <span className="block text-xs text-muted-foreground">{PUBLIC_MODE[mode].text}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {node.apply.message && node.apply.status !== 'pending' && <p className="text-xs text-[hsl(var(--warn))]">{node.apply.message}</p>}
          </section>

          <section className="space-y-1">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-medium text-foreground">Ports en écoute</h3>
              {node.report && <span className="text-2xs text-muted-foreground">mis à jour {formatRelative(node.report.reportedAt)}</span>}
            </div>
            {!node.report ? (
              <p className="py-2 text-sm text-muted-foreground">
                {node.status === 'offline' ? 'Le serveur est hors ligne.' : 'L’agent n’a pas encore envoyé ses ports. S’il ne le fait pas, mettez-le à jour depuis la page Nœuds.'}
              </p>
            ) : ports.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">Aucun port n’écoute sur une adresse publique.</p>
            ) : (
              <ul className="divide-y divide-border">
                {ports.map((entry) => (
                  <PortRow key={`${entry.protocol}-${entry.port}`} entry={entry} node={node} onCreateRule={onCreateRule} />
                ))}
              </ul>
            )}
            {restricted && <p className="pt-2 text-xs text-muted-foreground">Les ports encore ouverts à tous le sont par une de vos règles « Autoriser ».</p>}
          </section>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
