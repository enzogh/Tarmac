import { AlertSeverity, PrismaClient } from '@prisma/client';
import { nodesCoveredBy } from './alert-keys';
import { isMuted, isNodeFresh, NODE_OFFLINE_ALERT_AFTER_MS } from './node-availability';

type AlertsDb = Pick<PrismaClient, 'alert'>;

export type RaiseAlertInput = {
  workspaceId: string;
  fingerprint: string;
  message: string;
  severity: AlertSeverity;
  nodeId?: string | null;
  ruleId?: string | null;
};

/**
 * Opens an alert for a condition, unless one is already open (or taken
 * into account) for the same key. Returns whether a new alert was created.
 */
export async function raiseAlert(prisma: AlertsDb, input: RaiseAlertInput): Promise<boolean> {
  if (await hasUnresolvedAlert(prisma, input.fingerprint)) return false;
  await prisma.alert.create({
    data: {
      workspaceId: input.workspaceId,
      fingerprint: input.fingerprint,
      message: input.message,
      severity: input.severity,
      nodeId: input.nodeId ?? null,
      ruleId: input.ruleId ?? null,
    },
  });
  return true;
}

export async function hasUnresolvedAlert(prisma: AlertsDb, fingerprint: string): Promise<boolean> {
  const existing = await prisma.alert.findFirst({
    where: { fingerprint, status: { not: 'resolved' } },
    select: { id: true },
  });
  return existing !== null;
}

/** Closes every unresolved alert of these keys: the condition is gone. */
export async function autoResolveAlerts(prisma: AlertsDb, fingerprints: string | string[]): Promise<number> {
  const keys = Array.isArray(fingerprints) ? fingerprints : [fingerprints];
  if (keys.length === 0) return 0;
  const { count } = await prisma.alert.updateMany({
    where: { fingerprint: { in: keys }, status: { not: 'resolved' } },
    data: { status: 'resolved', resolvedAt: new Date(), autoResolved: true },
  });
  return count;
}

/** Node ids whose outage is already reported by an unresolved alert. */
export async function nodesWithOutageAlert(prisma: AlertsDb): Promise<Set<string>> {
  const alerts = await prisma.alert.findMany({
    where: {
      status: { not: 'resolved' },
      OR: [{ fingerprint: { startsWith: 'node-offline:' } }, { fingerprint: { startsWith: 'nodes-offline:' } }],
    },
    select: { fingerprint: true },
  });
  return new Set(alerts.flatMap((alert) => nodesCoveredBy(alert.fingerprint!)));
}

/**
 * True when this node being down is the whole story: its own outage alert
 * says so (or is about to - it went silent only moments ago), or someone
 * muted it. Alerts for things that only failed because of it (a mount left
 * pending, a sync run that could not start) are then left out.
 */
export async function nodeOutageExplains(prisma: AlertsDb & Pick<PrismaClient, 'node'>, nodeId: string | null | undefined) {
  if (!nodeId) return false;
  const node = await prisma.node.findUnique({ where: { id: nodeId }, select: { status: true, lastSeenAt: true, mutedUntil: true } });
  if (!node) return false;
  const now = Date.now();
  if (isNodeFresh(node, now)) return false;
  if (isMuted(node, now)) return true;
  if (node.lastSeenAt && now - node.lastSeenAt.getTime() < NODE_OFFLINE_ALERT_AFTER_MS + 60_000) return true;
  return (await nodesWithOutageAlert(prisma)).has(nodeId);
}
