import { destinationLoss, pingLoss, TraceOutcome } from './link-report';

// When a direct link degrades its tests are captured at once, but whether
// it is an incident worth an alert and an email is decided this long
// after: the overlay probe calls a link degraded as soon as 2 of its last
// 20 pings are lost, and such a blip clears within the ~100 s those pings
// take to leave the window. Mailing on each of them sent a score of
// "incidents" a day for a route losing ~1 % of its packets.
export const INCIDENT_OBSERVE_MS = 10 * 60_000;
// Degraded (or down) at least this long over the observation: a blip
// lasts ~2 min, a route that keeps losing packets stays degraded for most
// of it.
export const INCIDENT_MIN_UNHEALTHY_MS = 4 * 60_000;
// At least 3 packets lost by the captured tests: 3 of the 100 pings, or 3
// of the MTR's 30 cycles at the destination. A packet or two is the
// background loss of any internet path.
export const INCIDENT_CONFIRM_PING_LOSS_PCT = 3;
export const INCIDENT_CONFIRM_MTR_LOSS_PCT = 10;

export type LinkStatusSample = { sourceNodeId: string; status: string; at: Date };

/**
 * How long either direction of a link was degraded or down within
 * [from, to). Each sample's status holds until the next sample of the same
 * direction (every status change is recorded); the latest sample before
 * `from` of each direction gives the status the window opens with.
 */
export function unhealthyDurationMs(samples: LinkStatusSample[], from: Date, to: Date): number {
  const start = from.getTime();
  const end = to.getTime();
  if (end <= start) return 0;

  const byDirection = new Map<string, LinkStatusSample[]>();
  for (const sample of samples) {
    const list = byDirection.get(sample.sourceNodeId) ?? [];
    list.push(sample);
    byDirection.set(sample.sourceNodeId, list);
  }

  const intervals: Array<[number, number]> = [];
  for (const list of byDirection.values()) {
    list.sort((x, y) => x.at.getTime() - y.at.getTime());
    list.forEach((sample, index) => {
      if (sample.status !== 'degraded' && sample.status !== 'offline') return;
      const next = list[index + 1];
      const lo = Math.max(sample.at.getTime(), start);
      const hi = Math.min(next ? next.at.getTime() : end, end);
      if (hi > lo) intervals.push([lo, hi]);
    });
  }

  // Both directions degraded at once count once.
  intervals.sort((x, y) => x[0] - y[0]);
  let total = 0;
  let current: [number, number] | null = null;
  for (const interval of intervals) {
    if (current && interval[0] <= current[1]) {
      current[1] = Math.max(current[1], interval[1]);
      continue;
    }
    if (current) total += current[1] - current[0];
    current = [interval[0], interval[1]];
  }
  if (current) total += current[1] - current[0];
  return total;
}

/**
 * What the tests captured from both ends say about the loss:
 *  - confirmed: they lost packets themselves (3 or more);
 *  - clean: they could measure and lost next to nothing;
 *  - unmeasured: nothing to go by (both sides failed to run, or the
 *    workspace firewall drops pings on public addresses).
 */
export type CaptureVerdict = 'confirmed' | 'clean' | 'unmeasured';

export function captureVerdict(outcomes: TraceOutcome[], publicPingFiltered: boolean): CaptureVerdict {
  let measured = false;
  for (const outcome of outcomes) {
    if (!outcome.ok) continue;
    const ping = pingLoss(outcome.trace);
    // Every ping lost to a firewall that drops them says nothing.
    if (ping !== null && !(publicPingFiltered && ping >= 100)) {
      measured = true;
      if (ping >= INCIDENT_CONFIRM_PING_LOSS_PCT) return 'confirmed';
    }
    const mtr = destinationLoss(outcome.trace);
    if (mtr !== null) {
      measured = true;
      if (mtr >= INCIDENT_CONFIRM_MTR_LOSS_PCT) return 'confirmed';
    }
  }
  return measured ? 'clean' : 'unmeasured';
}

/**
 * An incident is a link that stayed degraded through most of the
 * observation and whose captured tests lost packets too. When the tests
 * could not measure anything, how long it stayed degraded decides alone.
 */
export function isLinkIncident(unhealthyMs: number, verdict: CaptureVerdict): boolean {
  return unhealthyMs >= INCIDENT_MIN_UNHEALTHY_MS && verdict !== 'clean';
}

/** The two servers of a link-degraded alert key, if it is one. */
export function linkDegradedNodes(fingerprint: string): [string, string] | null {
  const [kind, , nodeA, nodeB] = fingerprint.split(':');
  return kind === 'link-degraded' && nodeA && nodeB ? [nodeA, nodeB] : null;
}
