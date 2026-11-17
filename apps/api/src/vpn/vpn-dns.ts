// Internal names of VPN clients: <hostname>.<zone>, answered by the resolver
// every entry node runs on its client gateway (see vpn_dns.go in the agent).

export const DEFAULT_VPN_DNS_ZONE = 'intranet.internal';
// Short on purpose: a renamed profile resolves under its new name within
// seconds, cached answers included.
export const VPN_DNS_TTL = 10;

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const VPN_HOSTNAME_PATTERN = LABEL;
const MAX_ZONE_LENGTH = 190;
// Used when a name has nothing usable once reduced to [a-z0-9-].
const FALLBACK_HOSTNAME = 'appareil';

/** "Équipe Paris — PC n°2" -> "equipe-paris-pc-n-2" (a valid DNS label). */
export function hostnameFromName(name: string): string {
  const label = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '');
  return label || FALLBACK_HOSTNAME;
}

/** base, base-2, base-3... each still a valid label (63 chars max). */
export function hostnameCandidate(base: string, attempt: number): string {
  if (attempt <= 1) return base;
  const suffix = `-${attempt}`;
  return `${base.slice(0, 63 - suffix.length).replace(/-+$/, '')}${suffix}`;
}

export function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/, '');
}

export function isValidHostname(value: string): boolean {
  return LABEL.test(value);
}

export function normalizeZone(value: string): string {
  return value.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
}

/** Why a zone can't be used, or null. */
export function zoneProblem(zone: string): string | null {
  if (!zone) return 'Indiquez un domaine, par exemple intranet.internal.';
  if (zone.length > MAX_ZONE_LENGTH) return `Le domaine ne doit pas dépasser ${MAX_ZONE_LENGTH} caractères.`;
  if (!zone.split('.').every((label) => LABEL.test(label))) {
    return 'Domaine invalide : uniquement des lettres minuscules, chiffres et tirets, séparés par des points (ex. intranet.internal).';
  }
  if (zone === 'arpa' || zone.endsWith('.arpa')) return 'Les domaines en .arpa sont réservés aux recherches inverses.';
  return null;
}

/**
 * `.local` belongs to multicast DNS (RFC 6762): macOS, iOS and most Linux
 * desktops send those names to mDNS on the local network and never ask
 * the VPN's resolver.
 */
export function zoneWarning(zone: string): string | null {
  if (zone === 'local' || zone.endsWith('.local')) {
    return 'Les noms en .local sont réservés au DNS multicast : macOS, iOS et la plupart des Linux ne les demandent pas au résolveur du VPN, ils risquent de ne fonctionner que sous Windows. Préférez .internal, réservé à cet usage.';
  }
  return null;
}

export function fqdn(hostname: string, zone: string): string {
  return `${hostname}.${zone}`;
}
