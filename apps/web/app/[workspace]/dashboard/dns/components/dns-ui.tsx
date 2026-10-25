'use client';

import type { DnsRecordItem, DnsRecordType, DnsZoneItem, NodeItem } from '@/lib/api';
import { parseHostFromEndpoint } from '@/lib/geo';
import type { StatusTone } from '@/components/ui/status';
import { cn } from '@/lib/utils';

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const HOSTNAME = /^(?=.{1,253}\.?$)([a-zA-Z0-9_](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9_](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9])?)*\.?$/;

type RecordTypeMeta = {
  /** CSS colour variable (status/chart tokens) for the type badge. */
  color: string;
  description: string;
  contentLabel: string;
  placeholder: string;
  hint?: string;
  usesPriority?: boolean;
  /** Can be linked to a fleet node (value = its public IP). */
  nodeTarget?: boolean;
  validate?: (value: string) => string | null;
};

// Everything the record editor needs to guide the user per type: what the
// content field means, an example, and a quick sanity check - the API
// itself stays permissive, this is only there so a typo is caught before
// it's pushed to every DNS server.
export const RECORD_TYPES: Record<DnsRecordType, RecordTypeMeta> = {
  A: {
    color: '--chart-1',
    description: 'Fait pointer un nom vers une adresse IPv4',
    contentLabel: 'Adresse IPv4',
    placeholder: '203.0.113.10',
    nodeTarget: true,
    validate: (v) => (IPV4.test(v) ? null : 'Adresse IPv4 invalide'),
  },
  AAAA: {
    color: '--chart-2',
    description: 'Fait pointer un nom vers une adresse IPv6',
    contentLabel: 'Adresse IPv6',
    placeholder: '2001:db8::1',
    nodeTarget: true,
    validate: (v) => (v.includes(':') && /^[0-9a-fA-F:.]+$/.test(v) ? null : 'Adresse IPv6 invalide'),
  },
  CNAME: {
    color: '--chart-3',
    description: 'Alias vers un autre nom de domaine',
    contentLabel: 'Cible',
    placeholder: 'exemple.com',
    hint: 'Un CNAME ne peut pas coexister avec un autre enregistrement du même nom.',
    validate: (v) => (IPV4.test(v) ? 'Un CNAME pointe vers un nom, pas une IP (utilisez un A)' : HOSTNAME.test(v) ? null : 'Nom de domaine invalide'),
  },
  MX: {
    color: '--chart-4',
    description: 'Serveur de messagerie du domaine',
    contentLabel: 'Serveur de messagerie',
    placeholder: 'mx1.exemple.com',
    usesPriority: true,
    hint: 'La priorité la plus basse est essayée en premier.',
    validate: (v) => (HOSTNAME.test(v) ? null : 'Nom de serveur invalide'),
  },
  TXT: {
    color: '--chart-5',
    description: 'Texte libre : SPF, DKIM, vérification de domaine…',
    contentLabel: 'Contenu',
    placeholder: 'v=spf1 include:_spf.exemple.com ~all',
  },
  NS: {
    color: '--chart-6',
    description: 'Délègue un sous-domaine à d’autres serveurs DNS',
    contentLabel: 'Serveur de noms',
    placeholder: 'ns1.exemple.com',
    validate: (v) => (HOSTNAME.test(v) ? null : 'Nom de serveur invalide'),
  },
  CAA: {
    color: '--chart-7',
    description: 'Autorités de certification autorisées',
    contentLabel: 'Valeur',
    placeholder: '0 issue "letsencrypt.org"',
    validate: (v) => (/^\d+\s+(issue|issuewild|iodef)\s+".*"$/.test(v) ? null : 'Format attendu : 0 issue "letsencrypt.org"'),
  },
  SRV: {
    color: '--info',
    description: 'Localise un service (poids, port et cible)',
    contentLabel: 'Poids port cible',
    placeholder: '5 5060 sip.exemple.com',
    usesPriority: true,
    validate: (v) => (/^\d+\s+\d+\s+\S+$/.test(v) ? null : 'Format attendu : poids port cible'),
  },
  PTR: {
    color: '--neutral',
    description: 'Résolution inverse d’une adresse IP',
    contentLabel: 'Nom de domaine',
    placeholder: 'serveur.exemple.com',
    validate: (v) => (HOSTNAME.test(v) ? null : 'Nom de domaine invalide'),
  },
};

export const RECORD_TYPE_ORDER: DnsRecordType[] = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'CAA', 'SRV', 'PTR'];

export function RecordTypeBadge({ type, className }: { type: DnsRecordType; className?: string }) {
  const color = RECORD_TYPES[type]?.color ?? '--neutral';
  return (
    <span
      className={cn(
        'inline-flex min-w-[3.25rem] items-center justify-center rounded-md border px-1.5 py-0.5 font-mono text-2xs font-semibold',
        className,
      )}
      style={{
        color: `hsl(var(${color}))`,
        borderColor: `hsl(var(${color}) / 0.3)`,
        backgroundColor: `hsl(var(${color}) / 0.1)`,
      }}
    >
      {type}
    </span>
  );
}

export const TTL_OPTIONS = [
  { value: 60, label: '1 min' },
  { value: 300, label: '5 min' },
  { value: 1800, label: '30 min' },
  { value: 3600, label: '1 h' },
  { value: 14400, label: '4 h' },
  { value: 43200, label: '12 h' },
  { value: 86400, label: '1 jour' },
];

export function formatTtl(seconds: number): string {
  const preset = TTL_OPTIONS.find((option) => option.value === seconds);
  if (preset) return preset.label;
  if (seconds % 86400 === 0) return `${seconds / 86400} j`;
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

/** "@" -> the zone itself, "www" -> "www.<zone>". */
export function fqdn(name: string, zone: string): string {
  return name === '@' ? zone : `${name}.${zone}`;
}

export function sortRecords(records: DnsRecordItem[]): DnsRecordItem[] {
  const rank = (type: DnsRecordType) => RECORD_TYPE_ORDER.indexOf(type);
  return [...records].sort(
    (left, right) =>
      rank(left.type) - rank(right.type) ||
      (left.name === '@' ? -1 : right.name === '@' ? 1 : left.name.localeCompare(right.name)),
  );
}

export type ZoneHealth = { key: 'error' | 'pending' | 'awaiting-ns' | 'active'; tone: StatusTone; label: string; hint: string };

// One overall state per domain, the way Cloudflare's dashboard shows it:
// broken first, then still deploying, then "set up but not delegated yet",
// and only then fully active.
export function zoneHealth(zone: DnsZoneItem): ZoneHealth {
  if (zone.status === 'error') {
    return { key: 'error', tone: 'danger', label: 'Erreur', hint: "La zone n'a pas pu être appliquée sur les serveurs DNS." };
  }
  if (zone.status === 'pending') {
    return { key: 'pending', tone: 'warn', label: 'Déploiement…', hint: 'Les serveurs DNS appliquent la zone.' };
  }
  if (!zone.delegationVerified) {
    return {
      key: 'awaiting-ns',
      tone: 'warn',
      label: 'Nameservers à configurer',
      hint: "Le domaine n'est pas encore délégué à vos serveurs sur le DNS public.",
    };
  }
  return { key: 'active', tone: 'ok', label: 'Actif', hint: 'Délégation vérifiée, la zone répond sur Internet.' };
}

// The node list doesn't carry externalIp (only the activity endpoint does);
// it's the host part of the WireGuard endpoint either way.
export function nodePublicIp(node: Pick<NodeItem, 'externalIp' | 'overlayEndpoint'>): string | null {
  const host = node.externalIp ?? parseHostFromEndpoint(node.overlayEndpoint);
  return host ? host.replace(/^\[|\]$/g, '') : null;
}
