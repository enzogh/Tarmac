'use client';

import { Eye, ShieldCheck, ShieldOff, type LucideIcon } from 'lucide-react';
import type { StatusTone } from '@/components/ui/status';
import { StatusDot } from '@/components/ui/status';
import type {
  FirewallApplyStatus,
  FirewallExposure,
  FirewallMode,
  FirewallNode,
  FirewallProtocol,
  FirewallRule,
  FirewallRulePayload,
} from '@/lib/api';
import { flagFromCountryCode } from '@/lib/geo';
import { cn } from '@/lib/utils';

export const MODE_INFO: Record<
  FirewallMode,
  { title: string; short: string; tone: StatusTone; icon: LucideIcon; mesh: string; public: string }
> = {
  open: {
    title: 'Ouvert',
    short: 'Ouvert',
    tone: 'neutral',
    icon: ShieldOff,
    mesh: 'Vos serveurs se joignent librement. Seules vos règles de blocage s’appliquent.',
    public: 'Le serveur reste joignable comme aujourd’hui. Seules vos règles de blocage s’appliquent.',
  },
  observe: {
    title: 'Observation',
    short: 'Observation',
    tone: 'info',
    icon: Eye,
    mesh: 'Rien n’est coupé, mais chaque connexion qui serait bloquée est journalisée. Idéal pour préparer le passage en mode appliqué.',
    public: 'Rien n’est coupé, mais chaque connexion qui serait bloquée est journalisée.',
  },
  enforce: {
    title: 'Appliqué',
    short: 'Appliqué',
    tone: 'ok',
    icon: ShieldCheck,
    mesh: 'Seules les connexions autorisées (par vos règles ou par Tarmac) passent. Tout le reste est bloqué.',
    public: 'Seuls les ports autorisés restent joignables depuis Internet. Tout le reste est fermé.',
  },
};

export const APPLY_INFO: Record<FirewallApplyStatus, { tone: StatusTone; label: string; pulse?: boolean }> = {
  off: { tone: 'neutral', label: 'Non filtré' },
  pending: { tone: 'info', label: 'Application…', pulse: true },
  active: { tone: 'ok', label: 'Protégé' },
  error: { tone: 'danger', label: 'Erreur' },
  outdated: { tone: 'warn', label: 'Agent à mettre à jour' },
  offline: { tone: 'warn', label: 'En attente du serveur' },
};

export const EXPOSURE_INFO: Record<FirewallExposure, { tone: StatusTone; label: string; hint: string }> = {
  public: { tone: 'warn', label: 'Ouvert à tous', hint: 'N’importe qui sur Internet peut s’y connecter.' },
  restricted: { tone: 'info', label: 'Restreint', hint: 'Seules certaines adresses peuvent s’y connecter.' },
  closed: { tone: 'ok', label: 'Fermé', hint: 'Personne ne peut s’y connecter depuis Internet.' },
  observed: { tone: 'info', label: 'Serait fermé', hint: 'Encore ouvert : il sera fermé en mode appliqué.' },
  local: { tone: 'neutral', label: 'Réseau local', hint: 'Écoute seulement sur une adresse privée, hors d’Internet.' },
};

export type ServicePreset = { id: string; label: string; protocol: FirewallProtocol; ports: string[]; hint?: string };

export const SERVICE_PRESETS: ServicePreset[] = [
  { id: 'ssh', label: 'SSH', protocol: 'tcp', ports: ['22'], hint: 'Administration à distance' },
  { id: 'web', label: 'Web', protocol: 'tcp', ports: ['80', '443'], hint: 'HTTP + HTTPS' },
  { id: 'https', label: 'HTTPS', protocol: 'tcp', ports: ['443'] },
  { id: 'postgres', label: 'PostgreSQL', protocol: 'tcp', ports: ['5432'] },
  { id: 'mysql', label: 'MySQL', protocol: 'tcp', ports: ['3306'] },
  { id: 'redis', label: 'Redis', protocol: 'tcp', ports: ['6379'] },
  { id: 'mongo', label: 'MongoDB', protocol: 'tcp', ports: ['27017'] },
  { id: 'dns', label: 'DNS', protocol: 'tcpudp', ports: ['53'] },
  { id: 'ping', label: 'Ping', protocol: 'icmp', ports: [] },
  { id: 'all', label: 'Tout le trafic', protocol: 'any', ports: [] },
];

export const PROTOCOL_LABEL: Record<FirewallProtocol, string> = {
  any: 'Tous',
  tcp: 'TCP',
  udp: 'UDP',
  tcpudp: 'TCP + UDP',
  icmp: 'Ping (ICMP)',
};

export function presetFor(protocol: FirewallProtocol, ports: string[]): ServicePreset | null {
  const key = [...ports].sort().join(',');
  return SERVICE_PRESETS.find((preset) => preset.protocol === protocol && [...preset.ports].sort().join(',') === key) ?? null;
}

export function serviceLabel(rule: Pick<FirewallRule, 'protocol' | 'ports'> & { service?: string }): string {
  const preset = presetFor(rule.protocol, rule.ports);
  if (preset) return preset.id === 'all' || preset.id === 'ping' ? preset.label : `${preset.label} (${preset.ports.join(', ')})`;
  return rule.service ?? `${PROTOCOL_LABEL[rule.protocol]} ${rule.ports.join(', ')}`;
}

type Named = { id: string; name: string };

function list(names: string[], max = 2): string {
  if (names.length === 0) return '(à choisir)';
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} +${names.length - max}`;
}

export function sourceSummary(
  rule: Pick<FirewallRulePayload, 'scope' | 'sourceKind' | 'sourceNodeIds' | 'sourceLabels' | 'sourceCidrs'>,
  nodes: Named[],
  max = 2,
): string {
  if (rule.sourceKind === 'any') return rule.scope === 'mesh' ? 'Tous les serveurs' : 'Tout Internet';
  if (rule.sourceKind === 'nodes') {
    return list(rule.sourceNodeIds.map((id) => nodes.find((node) => node.id === id)?.name ?? 'serveur supprimé'), max);
  }
  if (rule.sourceKind === 'labels') return list(rule.sourceLabels.map((label) => `#${label}`), max);
  return list(rule.sourceCidrs, max);
}

export function targetSummary(
  rule: Pick<FirewallRulePayload, 'targetKind' | 'targetNodeIds' | 'targetLabels'>,
  nodes: Named[],
  max = 2,
): string {
  if (rule.targetKind === 'any') return 'Tous les serveurs';
  if (rule.targetKind === 'nodes') {
    return list(rule.targetNodeIds.map((id) => nodes.find((node) => node.id === id)?.name ?? 'serveur supprimé'), max);
  }
  return list(rule.targetLabels.map((label) => `#${label}`), max);
}

/** "Bloquer SSH (22) de d2-2 vers dev-server" - the sentence a rule reads as. */
export function ruleSentence(rule: FirewallRulePayload, nodes: Named[]): string {
  const verb = rule.action === 'deny' ? 'Bloquer' : 'Autoriser';
  const service = serviceLabel(rule);
  const from = sourceSummary(rule, nodes, 3);
  const to = targetSummary(rule, nodes, 3);
  const fromWord = rule.sourceKind === 'any' ? (rule.scope === 'mesh' ? 'depuis tous les serveurs' : 'depuis tout Internet') : `depuis ${from}`;
  const toWord = rule.targetKind === 'any' ? 'vers tous les serveurs' : `vers ${to}`;
  return `${verb} ${service === 'Tout le trafic' ? 'tout le trafic' : service} ${fromWord} ${toWord}`;
}

/** Accessible on/off switch, same look as the Settings page's. */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-primary bg-primary' : 'border-border bg-surface-3',
      )}
    >
      <span className={cn('inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  );
}

const NODE_TONE: Record<FirewallNode['status'], StatusTone> = { online: 'ok', degraded: 'warn', offline: 'danger' };

export function NodeName({ node, className, showIp }: { node: FirewallNode; className?: string; showIp?: boolean }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <span className="text-base leading-none" aria-hidden>
        {flagFromCountryCode(node.locationCountryCode)}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium text-foreground">{node.name}</span>
          <StatusDot tone={NODE_TONE[node.status]} />
        </span>
        {showIp && <span className="block truncate font-mono text-2xs text-muted-foreground">{node.vlanIp ?? 'hors réseau privé'}</span>}
      </span>
    </span>
  );
}

export const EXPIRY_CHOICES = [
  { value: 'never', label: 'Permanente' },
  { value: '1h', label: '1 heure' },
  { value: '4h', label: '4 heures' },
  { value: '24h', label: '24 heures' },
  { value: '7d', label: '7 jours' },
  { value: '30d', label: '30 jours' },
];

export function expiryToIso(value: string): string | null {
  const match = /^(\d+)([hd])$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]) * (match[2] === 'd' ? 24 : 1);
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}
