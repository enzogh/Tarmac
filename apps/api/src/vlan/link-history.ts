import { Region, resolveRegion } from './region';

// One point of a link's history. `total`/`healthy` count the raw samples it
// stands for (1/1 or 1/0 for a raw sample, more for a time bucket), so
// uptime stays exact whatever the resolution.
export type LinkHistoryPoint = {
  createdAt: Date;
  status: string;
  latencyMs: number | null;
  packetLoss: number | null;
  bandwidth: number | null;
  total: number;
  healthy: number;
};

export type OverlayNode = {
  id: string;
  name: string;
  locationCountryCode: string | null;
};

const STATUS_SEVERITY: Record<string, number> = { healthy: 0, unknown: 1, degraded: 2, offline: 3 };

export function worseStatus(a: string, b: string): string {
  return (STATUS_SEVERITY[b] ?? 1) > (STATUS_SEVERITY[a] ?? 1) ? b : a;
}

export function uptimePercent(points: LinkHistoryPoint[]): number | null {
  const total = points.reduce((sum, point) => sum + point.total, 0);
  if (total === 0) return null;
  return Math.round((points.reduce((sum, point) => sum + point.healthy, 0) / total) * 100);
}

/**
 * Same segmentation rule as planOverlayPeers: two nodes in different regions
 * that both have an active gateway talk through those gateways instead of a
 * direct tunnel. Returns the gateways crossed, in path order (empty for a
 * direct link).
 */
export function relayGateways(
  nodes: OverlayNode[],
  gatewayByRegion: Map<Region, string>,
  sourceNodeId: string,
  targetNodeId: string,
): OverlayNode[] {
  const source = nodes.find((node) => node.id === sourceNodeId);
  const target = nodes.find((node) => node.id === targetNodeId);
  const sourceRegion = resolveRegion(source?.locationCountryCode);
  const targetRegion = resolveRegion(target?.locationCountryCode);
  if (!sourceRegion || !targetRegion || sourceRegion === targetRegion) return [];
  const sourceGateway = nodes.find((node) => node.id === gatewayByRegion.get(sourceRegion));
  const targetGateway = nodes.find((node) => node.id === gatewayByRegion.get(targetRegion));
  if (!sourceGateway || !targetGateway) return [];
  return [sourceGateway, targetGateway].filter((gateway) => gateway.id !== sourceNodeId && gateway.id !== targetNodeId);
}

// Probes only refresh every few samples, so a hop's last measurement stays
// valid for this many buckets when chaining.
const LATENCY_CARRY_BUCKETS = 5;

/**
 * Lines up the per-hop histories of a relayed path bucket by bucket: the
 * path is only as up as its worst hop, its latency is the sum of the hops'
 * and its loss compounds across them. Buckets missing a hop entirely are
 * skipped rather than guessed.
 */
export function chainSegments(segments: LinkHistoryPoint[][], bucketMs: number): LinkHistoryPoint[] {
  if (segments.length === 0) return [];
  const byBucket = segments.map((points) => {
    const buckets = new Map<number, LinkHistoryPoint>();
    for (const point of points) {
      const bucket = Math.floor(point.createdAt.getTime() / bucketMs);
      const current = buckets.get(bucket);
      // Keep the point carrying a measurement when the bucket has several.
      if (!current || (current.latencyMs == null && point.latencyMs != null)) buckets.set(bucket, point);
    }
    return buckets;
  });
  const bucketKeys = [...new Set(byBucket.flatMap((buckets) => [...buckets.keys()]))].sort((a, b) => a - b);
  const lastMeasured = segments.map(() => ({ bucket: -Infinity, latencyMs: 0 }));
  const chained: LinkHistoryPoint[] = [];
  for (const bucket of bucketKeys) {
    byBucket.forEach((buckets, index) => {
      const latencyMs = buckets.get(bucket)?.latencyMs;
      if (latencyMs != null) lastMeasured[index] = { bucket, latencyMs };
    });
    if (!byBucket.every((buckets) => buckets.has(bucket))) continue;
    const hops = byBucket.map((buckets) => buckets.get(bucket)!);
    const latencies = lastMeasured.map((last) => (bucket - last.bucket <= LATENCY_CARRY_BUCKETS ? last.latencyMs : null));
    const withLoss = hops.filter((hop) => hop.packetLoss != null);
    chained.push({
      createdAt: new Date(bucket * bucketMs),
      status: hops.reduce((worst, hop) => worseStatus(worst, hop.status), 'healthy'),
      latencyMs: latencies.every((latency) => latency != null)
        ? round2(latencies.reduce((sum: number, latency) => sum + (latency as number), 0))
        : null,
      packetLoss:
        withLoss.length > 0
          ? round2((1 - withLoss.reduce((keep, hop) => keep * (1 - (hop.packetLoss as number) / 100), 1)) * 100)
          : null,
      bandwidth: null,
      total: 1,
      // The path is up for the share of time its least available hop is.
      healthy: Math.min(...hops.map((hop) => (hop.total > 0 ? hop.healthy / hop.total : 0))),
    });
  }
  return chained;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
