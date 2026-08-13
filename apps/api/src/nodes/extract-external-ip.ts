// Shared by NodesService (surfaced as NodeItem.externalIp) and the DNS
// services (default target for new DNS records / NS glue) - a node's public IP isn't
// stored directly, only derived from its WireGuard overlay endpoint.
export function extractExternalIp(endpoint: string | null | undefined): string | null {
  if (!endpoint) return null;
  const raw = endpoint.trim();
  if (!raw) return null;

  try {
    const withScheme = raw.includes('://') ? raw : `udp://${raw}`;
    return new URL(withScheme).hostname || null;
  } catch {
    if (raw.startsWith('[')) {
      const closeBracket = raw.indexOf(']');
      if (closeBracket > 1) {
        return raw.slice(1, closeBracket);
      }
    }
    const slashIndex = raw.indexOf('/');
    const hostPort = slashIndex >= 0 ? raw.slice(0, slashIndex) : raw;
    const parts = hostPort.split(':');
    if (parts.length === 2 && /^\d+$/.test(parts[1])) {
      return parts[0] || null;
    }
    return hostPort || null;
  }
}
