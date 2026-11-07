// When a node counts as down, and how its outage is reported. Pure
// functions so the thresholds can be tested without a database.

/** Agents heartbeat every 5 s: past this, the node has missed several. */
export const NODE_FRESH_MS = 30_000;
/**
 * Silence needed before a node is reported down. Long enough for an agent
 * update or a reboot (a minute or two) to go by without a word, short
 * enough that a real outage is known within minutes.
 */
export const NODE_OFFLINE_ALERT_AFTER_MS = 3 * 60_000;
/**
 * Nodes silent at the same time as one that is due get reported with it,
 * as long as they are past a blip (the server marks a node offline after
 * 60 s without a heartbeat).
 */
export const NODE_GROUP_SILENT_MS = 90_000;
/**
 * A node silent for longer than this is not reported any more: either it
 * was retired without being removed, or its outage was already reported.
 * Also keeps a first deploy from raising alerts for long-dead nodes.
 */
export const NODE_SUPERVISION_WINDOW_MS = 24 * 3600_000;
/** After an API restart every node is offline until its agent reconnects. */
export const STARTUP_GRACE_MS = 3 * 60_000;

export type NodeSignal = {
  id: string;
  name: string;
  workspaceId: string;
  status: string;
  lastSeenAt: Date | null;
  mutedUntil: Date | null;
};

export function isNodeFresh(node: Pick<NodeSignal, 'status' | 'lastSeenAt'>, now: number): boolean {
  return node.status !== 'offline' && !!node.lastSeenAt && now - node.lastSeenAt.getTime() <= NODE_FRESH_MS;
}

export function isMuted(node: Pick<NodeSignal, 'mutedUntil'>, now: number): boolean {
  return !!node.mutedUntil && node.mutedUntil.getTime() > now;
}

export type NodeOutageReport = { workspaceId: string; nodes: NodeSignal[] };

/**
 * The outages to report this tick: one report per workspace, carrying
 * every node of it that went silent together, so a provider outage taking
 * three VPS down (or the Tarmac server losing its network) is one alert,
 * not three. `covered` holds the nodes whose outage is already reported.
 */
export function planNodeOutageReports(nodes: NodeSignal[], covered: Set<string>, now: number): NodeOutageReport[] {
  const silentFor = (node: NodeSignal) => (node.lastSeenAt ? now - node.lastSeenAt.getTime() : Infinity);
  const candidates = nodes.filter(
    (node) =>
      !covered.has(node.id) &&
      !isMuted(node, now) &&
      silentFor(node) >= NODE_GROUP_SILENT_MS &&
      silentFor(node) <= NODE_SUPERVISION_WINDOW_MS,
  );

  const byWorkspace = new Map<string, NodeSignal[]>();
  for (const node of candidates) {
    const list = byWorkspace.get(node.workspaceId) ?? [];
    list.push(node);
    byWorkspace.set(node.workspaceId, list);
  }

  const reports: NodeOutageReport[] = [];
  for (const [workspaceId, silent] of byWorkspace) {
    if (!silent.some((node) => silentFor(node) >= NODE_OFFLINE_ALERT_AFTER_MS)) continue;
    reports.push({ workspaceId, nodes: [...silent].sort((a, b) => a.name.localeCompare(b.name)) });
  }
  return reports;
}

/**
 * Closes an alert only once its condition has stayed clear for `confirmMs`:
 * a link that comes back for ten seconds between two drops is not fixed.
 */
export class RecoveryGate {
  private readonly clearSince = new Map<string, number>();

  /** Feeds one observation; true when the alert can be closed now. */
  observe(key: string, cleared: boolean, confirmMs: number, now: number): boolean {
    if (!cleared) {
      this.clearSince.delete(key);
      return false;
    }
    const since = this.clearSince.get(key) ?? now;
    this.clearSince.set(key, since);
    if (now - since < confirmMs) return false;
    this.clearSince.delete(key);
    return true;
  }

  /** Forgets keys that no longer have an open alert. */
  retain(keys: Set<string>) {
    for (const key of this.clearSince.keys()) if (!keys.has(key)) this.clearSince.delete(key);
  }
}

/**
 * Counts consecutive observations of the same verdict: a threshold rule
 * fires after `needed` breaching samples in a row and clears after as many
 * clean ones, so a single spike neither raises nor closes an alert.
 */
export class Streak {
  private readonly runs = new Map<string, { breached: boolean; count: number }>();

  observe(key: string, breached: boolean): number {
    const run = this.runs.get(key);
    const next = run && run.breached === breached ? { breached, count: run.count + 1 } : { breached, count: 1 };
    this.runs.set(key, next);
    return next.count;
  }

  retain(keys: Set<string>) {
    for (const key of this.runs.keys()) if (!keys.has(key)) this.runs.delete(key);
  }
}
