'use client';

import { useEffect, useMemo, useState } from 'react';
import { Ban, Check, Globe2, LoaderCircle, Network, Search, ShieldCheck } from 'lucide-react';
import { Callout } from '@/components/Callout';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, FirewallAddressList, FirewallMode, FirewallNode, FirewallProtocol, FirewallRule, FirewallRulePayload, FirewallScope, FirewallSystemFlow } from '@/lib/api';
import { cn } from '@/lib/utils';
import { EXPIRY_CHOICES, expiryToIso, NodeName, presetFor, PROTOCOL_LABEL, ruleSentence, SERVICE_PRESETS } from './fw-ui';

export type RuleDraft = Partial<FirewallRulePayload> & { scope: FirewallScope };

const EMPTY: Omit<FirewallRulePayload, 'scope'> = {
  action: 'allow',
  name: '',
  description: null,
  sourceKind: 'any',
  sourceNodeIds: [],
  sourceLabels: [],
  sourceCidrs: [],
  sourceListIds: [],
  targetKind: 'any',
  targetNodeIds: [],
  targetLabels: [],
  protocol: 'tcp',
  ports: ['22'],
};

function portsOverlap(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) return true;
  const range = (raw: string) => {
    const [low, high] = raw.split('-').map(Number);
    return [low, high ?? low] as const;
  };
  return left.some((a) => right.some((b) => range(a)[0] <= range(b)[1] && range(b)[0] <= range(a)[1]));
}

function protocolsOverlap(left: FirewallProtocol, right: FirewallProtocol) {
  if (left === 'any' || right === 'any') return true;
  if (left === 'icmp' || right === 'icmp') return left === right;
  return left === right || left === 'tcpudp' || right === 'tcpudp';
}

/** Flows Tarmac needs that a mesh block would cut (blocks win over them). */
function cutFlows(rule: FirewallRulePayload, system: FirewallSystemFlow[], nodes: FirewallNode[]) {
  if (rule.scope !== 'mesh' || rule.action !== 'deny') return [];
  const byLabel = (labels: string[]) => nodes.filter((node) => node.labels.some((label) => labels.includes(label))).map((node) => node.id);
  const targets = rule.targetKind === 'any' ? null : rule.targetKind === 'nodes' ? rule.targetNodeIds : byLabel(rule.targetLabels);
  const sources = rule.sourceKind === 'any' ? null : rule.sourceKind === 'nodes' ? rule.sourceNodeIds : byLabel(rule.sourceLabels);
  return system.filter(
    (flow) =>
      flow.scope === 'mesh' &&
      (targets === null || targets.includes(flow.targetNodeId)) &&
      (sources === null || flow.sourceNodeIds === 'all' || flow.sourceNodeIds.some((id) => sources.includes(id))) &&
      protocolsOverlap(rule.protocol, flow.protocol) &&
      (rule.protocol === 'any' || rule.protocol === 'icmp' || flow.protocol === 'any' || portsOverlap(rule.ports, flow.ports)),
  );
}

function Section({ step, title, hint, children }: { step: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 border-t border-border pt-5 sm:grid-cols-[11rem_1fr] sm:gap-6">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{step}</span>
        <div>
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** Address lists to pick from; the addresses themselves are edited in Depuis Internet. */
function ListChecklist({ lists, selected, onChange }: { lists: FirewallAddressList[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  if (lists.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-surface-2 px-3 py-4 text-center text-xs text-muted-foreground">
        Aucune liste pour l’instant. Créez-en une dans Depuis Internet › Listes d’adresses, par exemple « Bureau » avec l’IP de vos locaux.
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <div className="scroll-thin max-h-48 overflow-y-auto rounded-lg border border-border bg-surface-2 p-1">
        {lists.map((list) => (
          <label
            key={list.id}
            className={cn('flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-1.5 transition-colors hover:bg-surface-3', selected.includes(list.id) && 'bg-primary/[0.06]')}
          >
            <Checkbox checked={selected.includes(list.id)} onChange={() => toggle(list.id)} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">{list.name}</span>
              <span className="block truncate font-mono text-2xs text-muted-foreground">
                {list.cidrs.slice(0, 3).join(', ')}
                {list.cidrs.length > 3 ? ` +${list.cidrs.length - 3}` : ''}
              </span>
            </span>
          </label>
        ))}
      </div>
      <p className="text-2xs text-muted-foreground">La règle suit la liste : modifiez ses adresses une fois, toutes les règles qui l’utilisent sont mises à jour.</p>
    </div>
  );
}

function NodeChecklist({
  nodes,
  selected,
  onChange,
  emptyHint,
}: {
  nodes: FirewallNode[];
  selected: string[];
  onChange: (ids: string[]) => void;
  emptyHint: string;
}) {
  const [query, setQuery] = useState('');
  const shown = nodes.filter((node) => !query.trim() || `${node.name} ${node.vlanIp ?? ''} ${node.labels.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-2">
      {nodes.length > 6 && (
        <div className="relative border-b border-border">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher un serveur…"
            className="h-9 w-full bg-transparent pl-8 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      )}
      <div className="scroll-thin max-h-48 overflow-y-auto p-1">
        {shown.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">{nodes.length === 0 ? emptyHint : 'Aucun serveur ne correspond.'}</p>
        ) : (
          shown.map((node) => (
            <label
              key={node.id}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-1.5 transition-colors hover:bg-surface-3',
                selected.includes(node.id) && 'bg-primary/[0.06]',
              )}
            >
              <Checkbox checked={selected.includes(node.id)} onChange={() => toggle(node.id)} />
              <NodeName node={node} showIp className="flex-1" />
              {node.labels.length > 0 && (
                <span className="hidden truncate text-2xs text-muted-foreground sm:block">{node.labels.map((label) => `#${label}`).join(' ')}</span>
              )}
            </label>
          ))
        )}
      </div>
    </div>
  );
}

function LabelPicker({ labels, selected, onChange }: { labels: string[]; selected: string[]; onChange: (labels: string[]) => void }) {
  if (labels.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
        Aucun serveur n’a encore d’étiquette. Ajoutez-en depuis la page Nœuds (par exemple « prod », « base-de-données ») pour cibler des groupes de serveurs.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((label) => {
        const active = selected.includes(label);
        return (
          <button
            key={label}
            type="button"
            onClick={() => onChange(active ? selected.filter((item) => item !== label) : [...selected, label])}
            aria-pressed={active}
            className={cn(
              'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
              active ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border bg-surface-2 text-muted-foreground hover:text-foreground',
            )}
          >
            {active && <Check className="h-3 w-3" />}#{label}
          </button>
        );
      })}
    </div>
  );
}

function KindTabs<T extends string>({ value, onChange, options }: { value: T; onChange: (value: T) => void; options: Array<{ value: T; label: string }> }) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as T)}>
      <TabsList variant="segmented">
        {options.map((option) => (
          <TabsTrigger key={option.value} value={option.value}>
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

export function RuleDialog({
  open,
  onOpenChange,
  rule,
  draft,
  nodes,
  labels,
  lists = [],
  meshMode,
  sshGuard,
  system = [],
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing an existing rule. */
  rule?: FirewallRule | null;
  /** Creating, prefilled (from a matrix cell, an event...). */
  draft?: RuleDraft | null;
  nodes: FirewallNode[];
  labels: string[];
  lists?: FirewallAddressList[];
  meshMode: FirewallMode;
  sshGuard: boolean;
  system?: FirewallSystemFlow[];
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState<FirewallRulePayload>({ ...EMPTY, scope: 'mesh' });
  const [nameTouched, setNameTouched] = useState(false);
  const [custom, setCustom] = useState(false);
  const [portsText, setPortsText] = useState('22');
  const [cidrText, setCidrText] = useState('');
  const [expiry, setExpiry] = useState('never');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const base: FirewallRulePayload = rule
      ? {
          scope: rule.scope,
          action: rule.action,
          name: rule.name,
          description: rule.description,
          sourceKind: rule.sourceKind,
          sourceNodeIds: rule.sourceNodeIds,
          sourceLabels: rule.sourceLabels,
          sourceCidrs: rule.sourceCidrs,
          sourceListIds: rule.sourceListIds,
          targetKind: rule.targetKind,
          targetNodeIds: rule.targetNodeIds,
          targetLabels: rule.targetLabels,
          protocol: rule.protocol,
          ports: rule.ports,
        }
      : { ...EMPTY, ...(draft ?? {}), scope: draft?.scope ?? 'mesh' };
    if (!rule && base.scope === 'public' && base.sourceKind !== 'cidrs' && base.sourceKind !== 'lists') base.sourceKind = 'any';
    setForm(base);
    setNameTouched(Boolean(rule) || Boolean(draft?.name));
    setCustom(!presetFor(base.protocol, base.ports));
    setPortsText(base.ports.join(', '));
    setCidrText(base.sourceCidrs.join('\n'));
    setExpiry(rule?.expiresAt ? 'keep' : 'never');
    setError(null);
  }, [open, rule, draft]);

  const meshNodes = useMemo(() => nodes.filter((node) => node.vlanIp), [nodes]);
  const sourceNodes = form.scope === 'mesh' ? meshNodes : nodes;
  const targetNodes = form.scope === 'mesh' ? meshNodes : nodes;
  const set = (patch: Partial<FirewallRulePayload>) => setForm((current) => ({ ...current, ...patch }));

  const effective: FirewallRulePayload = useMemo(() => {
    const ports = custom
      ? portsText
          .split(/[\s,;]+/)
          .map((part) => part.trim())
          .filter(Boolean)
      : form.ports;
    return {
      ...form,
      ports: form.protocol === 'any' || form.protocol === 'icmp' ? [] : ports,
      sourceCidrs: cidrText
        .split(/[\s,;]+/)
        .map((part) => part.trim())
        .filter(Boolean),
    };
  }, [form, custom, portsText, cidrText]);

  const sentence = ruleSentence(effective, nodes, lists);
  const name = nameTouched ? form.name : sentence.slice(0, 80);

  const problems: string[] = [];
  if (effective.sourceKind === 'nodes' && effective.sourceNodeIds.length === 0) problems.push('Choisissez au moins un serveur d’origine.');
  if (effective.sourceKind === 'labels' && effective.sourceLabels.length === 0) problems.push('Choisissez au moins une étiquette d’origine.');
  if (effective.sourceKind === 'cidrs' && effective.sourceCidrs.length === 0) problems.push('Indiquez au moins une adresse IP.');
  if (effective.sourceKind === 'lists' && effective.sourceListIds.length === 0) problems.push('Choisissez au moins une liste d’adresses.');
  if (effective.targetKind === 'nodes' && effective.targetNodeIds.length === 0) problems.push('Choisissez au moins un serveur protégé.');
  if (effective.targetKind === 'labels' && effective.targetLabels.length === 0) problems.push('Choisissez au moins une étiquette de destination.');
  if ((effective.protocol === 'tcp' || effective.protocol === 'udp' || effective.protocol === 'tcpudp') && custom && effective.ports.some((port) => !/^\d{1,5}(-\d{1,5})?$/.test(port))) {
    problems.push('Les ports s’écrivent 22, 8080 ou 8000-8100.');
  }

  const touchesSsh =
    effective.protocol === 'any' || ((effective.protocol === 'tcp' || effective.protocol === 'tcpudp') && (effective.ports.length === 0 || effective.ports.includes('22')));
  const lockoutRisk = effective.scope === 'public' && effective.action === 'deny' && effective.sourceKind === 'any' && touchesSsh;
  const cuts = cutFlows(effective, system, nodes);
  const inertAllow = effective.scope === 'mesh' && effective.action === 'allow' && meshMode === 'open';

  const save = async () => {
    if (problems.length > 0) {
      setError(problems[0]);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: Partial<FirewallRulePayload> = {
        ...effective,
        name: name.trim() || sentence.slice(0, 80),
        description: effective.description?.trim() || null,
        ...(expiry === 'keep' ? {} : { expiresAt: expiryToIso(expiry) }),
      };
      if (rule) {
        delete payload.scope;
        await api.firewall.updateRule(rule.id, payload);
        onSaved(`Règle « ${payload.name} » mise à jour. Elle est en cours d’application sur les serveurs concernés.`);
      } else {
        await api.firewall.createRule(payload as FirewallRulePayload);
        onSaved(`Règle « ${payload.name} » créée. Elle est en cours d’application sur les serveurs concernés.`);
      }
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'L’enregistrement a échoué.');
    } finally {
      setSaving(false);
    }
  };

  const selectPreset = (id: string) => {
    if (id === 'custom') {
      setCustom(true);
      if (form.protocol === 'any' || form.protocol === 'icmp') set({ protocol: 'tcp' });
      return;
    }
    const preset = SERVICE_PRESETS.find((item) => item.id === id)!;
    setCustom(false);
    set({ protocol: preset.protocol, ports: preset.ports });
    setPortsText(preset.ports.join(', '));
  };
  const activePreset = custom ? 'custom' : (presetFor(form.protocol, form.ports)?.id ?? 'custom');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{rule ? 'Modifier la règle' : 'Nouvelle règle de pare-feu'}</DialogTitle>
          <DialogDescription>
            Décrivez la règle comme une phrase : qui, vers quels serveurs, pour quel service. Elle s’applique en quelques secondes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {!rule && (
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  { value: 'mesh', icon: Network, title: 'Entre vos serveurs', text: 'Trafic du réseau privé Tarmac.' },
                  { value: 'public', icon: Globe2, title: 'Depuis Internet', text: 'Ports publics de vos serveurs.' },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={form.scope === option.value}
                  onClick={() =>
                    set({ scope: option.value, sourceKind: 'any', sourceNodeIds: [], sourceLabels: [], targetKind: form.targetKind })
                  }
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                    form.scope === option.value ? 'border-primary/60 bg-primary/[0.07] ring-1 ring-primary/30' : 'border-border bg-surface-2 hover:border-primary/30',
                  )}
                >
                  <option.icon className={cn('mt-0.5 h-4 w-4 shrink-0', form.scope === option.value ? 'text-primary' : 'text-muted-foreground')} />
                  <span>
                    <span className="block text-sm font-medium text-foreground">{option.title}</span>
                    <span className="block text-xs text-muted-foreground">{option.text}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          <Section step={1} title="Action" hint="Ouvrir ou fermer l’accès">
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { value: 'allow', icon: ShieldCheck, label: 'Autoriser', tone: 'ok' },
                  { value: 'deny', icon: Ban, label: 'Bloquer', tone: 'danger' },
                ] as const
              ).map((option) => {
                const active = form.action === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => set({ action: option.value })}
                    className={cn(
                      'flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                      active
                        ? option.tone === 'ok'
                          ? 'border-[hsl(var(--ok))]/50 bg-[hsl(var(--ok))]/10 text-[hsl(var(--ok))]'
                          : 'border-[hsl(var(--danger))]/50 bg-[hsl(var(--danger))]/10 text-[hsl(var(--danger))]'
                        : 'border-border bg-surface-2 text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <option.icon className="h-4 w-4" />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </Section>

          <Section step={2} title="Depuis" hint={form.scope === 'mesh' ? 'Le serveur qui ouvre la connexion' : 'Qui sur Internet'}>
            <div className="space-y-2.5">
              {form.scope === 'mesh' ? (
                <KindTabs
                  value={form.sourceKind as 'any' | 'nodes' | 'labels'}
                  onChange={(sourceKind) => set({ sourceKind })}
                  options={[
                    { value: 'any', label: 'Tous les serveurs' },
                    { value: 'nodes', label: 'Serveurs choisis' },
                    { value: 'labels', label: 'Étiquettes' },
                  ]}
                />
              ) : (
                <KindTabs
                  value={form.sourceKind as 'any' | 'cidrs' | 'lists'}
                  onChange={(sourceKind) => set({ sourceKind })}
                  options={[
                    { value: 'any', label: 'Tout Internet' },
                    { value: 'cidrs', label: 'Adresses IP précises' },
                    { value: 'lists', label: 'Listes d’adresses' },
                  ]}
                />
              )}
              {form.sourceKind === 'nodes' && (
                <NodeChecklist
                  nodes={sourceNodes}
                  selected={form.sourceNodeIds}
                  onChange={(sourceNodeIds) => set({ sourceNodeIds })}
                  emptyHint="Aucun serveur n’a rejoint le réseau privé."
                />
              )}
              {form.sourceKind === 'labels' && (
                <LabelPicker labels={labels} selected={form.sourceLabels} onChange={(sourceLabels) => set({ sourceLabels })} />
              )}
              {form.sourceKind === 'lists' && (
                <ListChecklist lists={lists} selected={form.sourceListIds} onChange={(sourceListIds) => set({ sourceListIds })} />
              )}
              {form.sourceKind === 'cidrs' && (
                <div className="space-y-1">
                  <textarea
                    value={cidrText}
                    onChange={(event) => setCidrText(event.target.value)}
                    rows={3}
                    placeholder={'203.0.113.24\n198.51.100.0/24\n2001:db8::/32'}
                    className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <p className="text-2xs text-muted-foreground">Une adresse ou une plage par ligne, IPv4 ou IPv6. Par exemple l’IP de votre bureau.</p>
                </div>
              )}
            </div>
          </Section>

          <Section step={3} title="Vers" hint="Les serveurs protégés par la règle">
            <div className="space-y-2.5">
              <KindTabs
                value={form.targetKind}
                onChange={(targetKind) => set({ targetKind })}
                options={[
                  { value: 'any', label: 'Tous les serveurs' },
                  { value: 'nodes', label: 'Serveurs choisis' },
                  { value: 'labels', label: 'Étiquettes' },
                ]}
              />
              {form.targetKind === 'nodes' && (
                <NodeChecklist
                  nodes={targetNodes}
                  selected={form.targetNodeIds}
                  onChange={(targetNodeIds) => set({ targetNodeIds })}
                  emptyHint="Aucun serveur disponible."
                />
              )}
              {form.targetKind === 'labels' && (
                <LabelPicker labels={labels} selected={form.targetLabels} onChange={(targetLabels) => set({ targetLabels })} />
              )}
            </div>
          </Section>

          <Section step={4} title="Service" hint="Le port visé">
            <div className="space-y-2.5">
              <div className="flex flex-wrap gap-1.5">
                {[...SERVICE_PRESETS, { id: 'custom', label: 'Personnalisé…', protocol: 'tcp' as FirewallProtocol, ports: [] }].map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => selectPreset(preset.id)}
                    aria-pressed={activePreset === preset.id}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs transition-colors',
                      activePreset === preset.id
                        ? 'border-primary/50 bg-primary/10 text-primary'
                        : 'border-border bg-surface-2 text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {preset.label}
                    {preset.ports.length > 0 && <span className="ml-1 font-mono text-2xs opacity-70">{preset.ports.join('+')}</span>}
                  </button>
                ))}
              </div>
              {custom && (
                <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
                  <Select value={form.protocol} onValueChange={(protocol) => set({ protocol: protocol as FirewallProtocol })}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['tcp', 'udp', 'tcpudp', 'icmp', 'any'] as FirewallProtocol[]).map((protocol) => (
                        <SelectItem key={protocol} value={protocol}>
                          {PROTOCOL_LABEL[protocol]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {form.protocol !== 'any' && form.protocol !== 'icmp' ? (
                    <Input value={portsText} onChange={(event) => setPortsText(event.target.value)} placeholder="Ports : 8080, 9000-9100 (vide = tous)" className="h-9 font-mono" />
                  ) : (
                    <p className="flex items-center text-xs text-muted-foreground">{form.protocol === 'icmp' ? 'Les requêtes ping.' : 'Tous les protocoles et tous les ports.'}</p>
                  )}
                </div>
              )}
            </div>
          </Section>

          <Section step={5} title="Nom et durée" hint="Facultatif">
            <div className="grid gap-2 sm:grid-cols-[1fr_11rem]">
              <div className="space-y-1">
                <Label htmlFor="fw-rule-name" className="sr-only">
                  Nom
                </Label>
                <Input
                  id="fw-rule-name"
                  value={name}
                  maxLength={80}
                  onChange={(event) => {
                    setNameTouched(true);
                    set({ name: event.target.value });
                  }}
                  placeholder="Nom de la règle"
                  className="h-9"
                />
              </div>
              <Select value={expiry} onValueChange={setExpiry}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {rule?.expiresAt && <SelectItem value="keep">Garder l’échéance actuelle</SelectItem>}
                  {EXPIRY_CHOICES.map((choice) => (
                    <SelectItem key={choice.value} value={choice.value}>
                      {choice.value === 'never' ? choice.label : `Pendant ${choice.label}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input
              value={form.description ?? ''}
              onChange={(event) => set({ description: event.target.value })}
              placeholder="Note (facultatif) : pourquoi cette règle existe"
              maxLength={500}
              className="mt-2 h-9"
            />
          </Section>

          {lockoutRisk && (
            <Callout variant="danger">
              Cette règle bloque SSH pour tout Internet{sshGuard ? ', et les blocages passent avant la protection anti-verrouillage' : ''} :
              vous risquez de perdre l’accès à distance à ces serveurs. Limitez plutôt l’origine à des adresses précises.
            </Callout>
          )}
          {cuts.length > 0 && (
            <Callout variant="warning">
              Cette règle coupera aussi {cuts.length > 1 ? 'des flux dont Tarmac a besoin' : 'un flux dont Tarmac a besoin'} :{' '}
              {cuts
                .slice(0, 3)
                .map((flow) => flow.label)
                .join(', ')}
              {cuts.length > 3 ? ` et ${cuts.length - 3} autre(s)` : ''}. Les blocages passent avant les autorisations automatiques.
            </Callout>
          )}
          {inertAllow && (
            <Callout variant="info">
              Le réseau privé est en mode ouvert : tout passe déjà. Cette autorisation prendra effet quand vous passerez en mode observation ou appliqué.
            </Callout>
          )}
          {error && <Callout variant="danger">{error}</Callout>}
        </div>

        <DialogFooter className="sm:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-2.5 sm:mr-4">
            <span
              className={cn(
                'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                form.action === 'deny' ? 'bg-[hsl(var(--danger))]/15 text-[hsl(var(--danger))]' : 'bg-[hsl(var(--ok))]/15 text-[hsl(var(--ok))]',
              )}
            >
              {form.action === 'deny' ? <Ban className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            </span>
            <p className="min-w-0 text-sm text-foreground">{sentence}.</p>
          </div>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Annuler
          </Button>
          <Button write onClick={() => void save()} disabled={saving} className="gap-1.5">
            {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {rule ? 'Enregistrer' : 'Créer la règle'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
