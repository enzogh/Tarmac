export type LinkStatus = 'healthy' | 'degraded' | 'offline';

export type LinkTelemetry = {
  rxMbps?: number;
  handshakeAgeSec?: number;
  latencyMs?: number;
  packetLoss?: number;
};

export const LINK_OFFLINE_HANDSHAKE_SEC = 600;
export const LINK_DEGRADED_HANDSHAKE_SEC = 240;
// A link between two nodes in the same region is expected to stay well under
// this; a link crossing regions (e.g. an intercontinental gateway backbone)
// has a much higher physical floor (~80-120ms for a transatlantic hop) that
// isn't itself a sign of trouble, so it gets a separate, higher bar.
export const LINK_DEGRADED_LATENCY_MS = 180;
export const LINK_DEGRADED_LATENCY_CROSS_REGION_MS = 300;

/**
 * Status of one overlay link from the WireGuard telemetry its source node
 * reported. Only what comes back from the peer proves the link: tx rises on
 * a dead tunnel too (the agent's own probes and pokes keep sending), so it
 * plays no part here.
 */
export function classifyLink(
  metric: LinkTelemetry,
  context: {
    peerOnline: boolean;
    crossRegion: boolean;
    // The peer's own pings back over this link are answered: the tunnel
    // demonstrably carries traffic both ways.
    reversePathProven?: boolean;
  },
): LinkStatus {
  const hasTraffic = (metric.rxMbps ?? 0) > 0;
  const probeAnswered =
    (metric.latencyMs !== undefined && metric.latencyMs > 0) ||
    (metric.packetLoss !== undefined && metric.packetLoss < 100);
  const probeDead = metric.packetLoss !== undefined && metric.packetLoss >= 100 && !probeAnswered;
  const handshakeAgeSec = metric.handshakeAgeSec;
  const handshakeUnknown = handshakeAgeSec === undefined || handshakeAgeSec < 0;
  const handshakeOffline = handshakeAgeSec !== undefined && handshakeAgeSec >= LINK_OFFLINE_HANDSHAKE_SEC;
  const handshakeDegraded =
    handshakeAgeSec !== undefined &&
    handshakeAgeSec >= LINK_DEGRADED_HANDSHAKE_SEC &&
    handshakeAgeSec < LINK_OFFLINE_HANDSHAKE_SEC;
  const latencyDegradedThresholdMs = context.crossRegion ? LINK_DEGRADED_LATENCY_CROSS_REGION_MS : LINK_DEGRADED_LATENCY_MS;

  // Our pings all lost over a fresh tunnel while the peer's pings to us get
  // answered: the peer (or something on the way) filters ICMP echo
  // requests. The link itself is up - counting it as degraded made a
  // perfectly working link read 50 % available.
  if (
    probeDead &&
    context.reversePathProven &&
    context.peerOnline &&
    handshakeAgeSec !== undefined &&
    handshakeAgeSec >= 0 &&
    handshakeAgeSec < LINK_DEGRADED_HANDSHAKE_SEC
  ) {
    return 'healthy';
  }

  // Offline only from hard link telemetry: the node status can be stale
  // while the tunnel itself is fine.
  if (handshakeOffline && !hasTraffic && !probeAnswered) return 'offline';
  // Every ping lost, nothing received and no recent handshake: down. A fresh
  // handshake with lost pings is more likely ICMP being filtered: degraded.
  if (probeDead && !hasTraffic && !(handshakeAgeSec !== undefined && handshakeAgeSec >= 0 && handshakeAgeSec < LINK_DEGRADED_HANDSHAKE_SEC)) {
    return 'offline';
  }
  if (
    !context.peerOnline ||
    probeDead ||
    (handshakeUnknown && !hasTraffic && !probeAnswered) ||
    (handshakeDegraded && !hasTraffic && !probeAnswered) ||
    (metric.packetLoss ?? 0) >= 8 ||
    (metric.latencyMs ?? 0) >= latencyDegradedThresholdMs
  ) {
    return 'degraded';
  }
  return 'healthy';
}
