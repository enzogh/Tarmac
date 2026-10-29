'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, CircleCheck, CircleX, Eye, LoaderCircle, Plus, Radar } from 'lucide-react';
import { Callout } from '@/components/Callout';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, FirewallEvaluation, FirewallNode, FirewallScope, FirewallTestResult } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { RuleDraft } from './RuleDialog';
import { MODE_INFO } from './fw-ui';

const QUICK = [
  { label: 'SSH', protocol: 'tcp', port: '22' },
  { label: 'HTTPS', protocol: 'tcp', port: '443' },
  { label: 'PostgreSQL', protocol: 'tcp', port: '5432' },
  { label: 'Redis', protocol: 'tcp', port: '6379' },
  { label: 'DNS', protocol: 'udp', port: '53' },
  { label: 'Ping', protocol: 'icmp', port: '' },
] as const;

const VERDICT = {
  allowed: { icon: CircleCheck, title: 'La connexion passe', className: 'border-[hsl(var(--ok))]/30 bg-[hsl(var(--ok))]/[0.07] text-[hsl(var(--ok))]' },
  blocked: { icon: CircleX, title: 'La connexion est bloquée', className: 'border-[hsl(var(--danger))]/30 bg-[hsl(var(--danger))]/[0.07] text-[hsl(var(--danger))]' },
  observed: { icon: Eye, title: 'Elle passe, mais serait bloquée', className: 'border-[hsl(var(--info))]/30 bg-[hsl(var(--info))]/[0.07] text-[hsl(var(--info))]' },
} as const;

function Verdict({ evaluation, small }: { evaluation: FirewallEvaluation; small?: boolean }) {
  const info = VERDICT[evaluation.verdict];
  return (
    <div className={cn('flex items-start gap-3 rounded-lg border', small ? 'p-3' : 'p-4', info.className)}>
      <info.icon className={cn('shrink-0', small ? 'mt-0.5 h-4 w-4' : 'h-5 w-5')} />
      <div className="min-w-0">
        <p className={cn('font-medium', small ? 'text-sm' : 'text-base')}>{info.title}</p>
        <p className="mt-0.5 text-sm text-foreground/80">{evaluation.reason}</p>
      </div>
    </div>
  );
}

export type TestPreset = { scope: FirewallScope; sourceNodeId?: string; targetNodeId?: string; port?: string };

export function TestDialog({
  open,
  onOpenChange,
  nodes,
  preset,
  onCreateRule,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodes: FirewallNode[];
  preset?: TestPreset | null;
  onCreateRule: (draft: RuleDraft) => void;
}) {
  const meshNodes = nodes.filter((node) => node.vlanIp);
  const [scope, setScope] = useState<FirewallScope>('mesh');
  const [source, setSource] = useState('');
  const [sourceIp, setSourceIp] = useState('');
  const [target, setTarget] = useState('');
  const [protocol, setProtocol] = useState<'tcp' | 'udp' | 'icmp'>('tcp');
  const [port, setPort] = useState('22');
  const [result, setResult] = useState<FirewallTestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setScope(preset?.scope ?? 'mesh');
    setSource(preset?.sourceNodeId ?? meshNodes[0]?.id ?? '');
    setTarget(preset?.targetNodeId ?? meshNodes[1]?.id ?? meshNodes[0]?.id ?? nodes[0]?.id ?? '');
    setPort(preset?.port ?? '22');
    setProtocol('tcp');
    setSourceIp('');
    setResult(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preset]);

  useEffect(() => setResult(null), [scope, source, sourceIp, target, protocol, port]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api.firewall.test({
          scope,
          targetNodeId: target,
          sourceNodeId: scope === 'mesh' ? source : undefined,
          sourceIp: scope === 'public' && sourceIp.trim() ? sourceIp.trim() : undefined,
          protocol,
          port: protocol === 'icmp' ? undefined : Number(port),
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Le test a échoué.');
    } finally {
      setBusy(false);
    }
  };

  const targets = scope === 'mesh' ? meshNodes : nodes;
  const ready = Boolean(target) && (scope === 'public' || (source && source !== target)) && (protocol === 'icmp' || /^\d{1,5}$/.test(port));
  const ruleDraft = (action: 'allow' | 'deny'): RuleDraft => ({
    scope,
    action,
    sourceKind: scope === 'mesh' ? 'nodes' : sourceIp.trim() ? 'cidrs' : 'any',
    sourceNodeIds: scope === 'mesh' ? [source] : [],
    sourceCidrs: scope === 'public' && sourceIp.trim() ? [sourceIp.trim()] : [],
    targetKind: 'nodes',
    targetNodeIds: [target],
    protocol,
    ports: protocol === 'icmp' ? [] : [port],
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radar className="h-4 w-4 text-primary" />
            Tester une connexion
          </DialogTitle>
          <DialogDescription>
            Vérifiez à l’avance si une connexion passerait, et quelle règle en décide. Rien n’est envoyé aux serveurs.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Tabs value={scope} onValueChange={(value) => setScope(value as FirewallScope)}>
            <TabsList variant="segmented">
              <TabsTrigger value="mesh">Entre serveurs</TabsTrigger>
              <TabsTrigger value="public">Depuis Internet</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="grid items-end gap-2 sm:grid-cols-[1fr_auto_1fr]">
            <div className="space-y-1.5">
              <Label>Depuis</Label>
              {scope === 'mesh' ? (
                <Select value={source} onValueChange={setSource}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Serveur d’origine" />
                  </SelectTrigger>
                  <SelectContent>
                    {meshNodes.map((node) => (
                      <SelectItem key={node.id} value={node.id}>
                        {node.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={sourceIp} onChange={(event) => setSourceIp(event.target.value)} placeholder="N’importe qui (ou une IP)" className="h-9 font-mono" />
              )}
            </div>
            <ArrowRight className="mx-auto mb-2.5 hidden h-4 w-4 text-muted-foreground sm:block" />
            <div className="space-y-1.5">
              <Label>Vers</Label>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Serveur de destination" />
                </SelectTrigger>
                <SelectContent>
                  {targets.map((node) => (
                    <SelectItem key={node.id} value={node.id}>
                      {node.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Service</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {QUICK.map((quick) => {
                const active = protocol === quick.protocol && (quick.protocol === 'icmp' || port === quick.port);
                return (
                  <button
                    key={quick.label}
                    type="button"
                    onClick={() => {
                      setProtocol(quick.protocol);
                      if (quick.port) setPort(quick.port);
                    }}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs transition-colors',
                      active ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border bg-surface-2 text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {quick.label}
                  </button>
                );
              })}
              <span className="mx-1 h-5 w-px bg-border" />
              <Select value={protocol} onValueChange={(value) => setProtocol(value as typeof protocol)}>
                <SelectTrigger className="h-8 w-[5.5rem] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tcp">TCP</SelectItem>
                  <SelectItem value="udp">UDP</SelectItem>
                  <SelectItem value="icmp">Ping</SelectItem>
                </SelectContent>
              </Select>
              {protocol !== 'icmp' && (
                <Input value={port} onChange={(event) => setPort(event.target.value.replace(/\D/g, '').slice(0, 5))} className="h-8 w-20 font-mono text-xs" aria-label="Port" />
              )}
            </div>
          </div>

          {scope === 'mesh' && source && source === target && (
            <p className="text-xs text-muted-foreground">Choisissez deux serveurs différents : un serveur se joint toujours lui-même.</p>
          )}
          {error && <Callout variant="danger">{error}</Callout>}

          {result && (
            <div className="space-y-2 animate-fade-in">
              <Verdict evaluation={result} />
              {result.ifEnforced && result.ifEnforced.verdict !== result.verdict && (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">
                    Et en mode <span className="font-medium text-foreground">{MODE_INFO.enforce.title.toLowerCase()}</span> (actuellement{' '}
                    {MODE_INFO[result.mode].title.toLowerCase()}) :
                  </p>
                  <Verdict evaluation={result.ifEnforced} small />
                </div>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                {result.verdict !== 'allowed' || result.ifEnforced?.verdict === 'blocked' ? (
                  <Button write size="sm" variant="secondary" className="gap-1.5" onClick={() => onCreateRule(ruleDraft('allow'))}>
                    <Plus className="h-3.5 w-3.5" />
                    Autoriser cette connexion
                  </Button>
                ) : null}
                {result.verdict !== 'blocked' && (
                  <Button write size="sm" variant="secondary" className="gap-1.5" onClick={() => onCreateRule(ruleDraft('deny'))}>
                    <Plus className="h-3.5 w-3.5" />
                    La bloquer
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
          <Button onClick={() => void run()} disabled={!ready || busy} className="gap-1.5">
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
            Tester
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
