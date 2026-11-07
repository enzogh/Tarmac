import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Comparator } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { alertKey } from '../alerts/alert-keys';
import { Streak } from '../alerts/node-availability';

const SUPPORTED_METRICS = ['cpu', 'ram', 'disk'] as const;
// Consecutive evaluations (one a minute) a rule has to breach before it
// fires, and to stay clean before its alert closes: a single CPU spike
// during a backup is not an incident, nor is one quiet minute its end.
const BREACHES_TO_FIRE = 2;
const CLEAN_TO_RESOLVE = 2;
// Agents send metrics every few seconds: an older sample belongs to a node
// that stopped reporting, whose outage is its own alert.
const SAMPLE_MAX_AGE_MS = 3 * 60_000;
type SupportedMetric = (typeof SUPPORTED_METRICS)[number];

function isSupportedMetric(metric: string): metric is SupportedMetric {
  return (SUPPORTED_METRICS as readonly string[]).includes(metric);
}

function breaches(value: number, comparator: Comparator, threshold: number): boolean {
  switch (comparator) {
    case 'gt':
      return value > threshold;
    case 'gte':
      return value >= threshold;
    case 'lt':
      return value < threshold;
    case 'lte':
      return value <= threshold;
  }
}

// Evaluates every enabled AlertRule against the latest metric sample per node.
// Alerts are created/resolved based on whether an unresolved Alert already
// exists for that (ruleId, nodeId) pair, once the verdict has held for a few
// evaluations in a row (see BREACHES_TO_FIRE).
@Injectable()
export class AlertRulesEvaluatorService {
  private readonly logger = new Logger(AlertRulesEvaluatorService.name);
  private readonly streak = new Streak();

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async evaluate() {
    try {
      await this.tick();
    } catch (error) {
      this.logger.warn(
        `Alert rule evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async tick() {
    const rules = await this.prisma.alertRule.findMany({ where: { enabled: true } });
    if (rules.length === 0) return;

    const [nodes, latestSamples, openAlerts] = await Promise.all([
      this.prisma.node.findMany({ select: { id: true, workspaceId: true, name: true, mutedUntil: true } }),
      this.prisma.metricSample.findMany({
        where: { createdAt: { gte: new Date(Date.now() - SAMPLE_MAX_AGE_MS) } },
        orderBy: [{ nodeId: 'asc' }, { createdAt: 'desc' }],
        distinct: ['nodeId'],
      }),
      // Taken into account is still unresolved: only looking at "open" ones
      // raised a fresh alert every minute once someone acknowledged it.
      this.prisma.alert.findMany({
        where: { status: { not: 'resolved' }, ruleId: { in: rules.map((rule) => rule.id) } },
      }),
    ]);

    const sampleByNode = new Map(latestSamples.map((sample) => [sample.nodeId, sample]));
    const openAlertByKey = new Map(openAlerts.map((alert) => [`${alert.ruleId}:${alert.nodeId}`, alert]));
    const now = Date.now();

    // Collect breaches/recoveries while scanning, then flush with a single createMany +
    // updateMany — a mass outage or mass-recovery (many nodes crossing a threshold at once)
    // would otherwise mean one sequential DB round trip per (rule, node) pair in this tick.
    const toCreate: {
      workspaceId: string;
      ruleId: string;
      nodeId: string;
      fingerprint: string;
      severity: typeof rules[number]['severity'];
      message: string;
    }[] = [];
    const toResolveIds: string[] = [];
    const observed = new Set<string>();

    for (const rule of rules) {
      if (!isSupportedMetric(rule.metric)) continue;

      // A rule only ever watches its own workspace's nodes - without this a
      // workspace-wide rule fired on every node of the platform.
      const targetNodes = nodes.filter(
        (node) => node.workspaceId === rule.workspaceId && (!rule.nodeId || node.id === rule.nodeId),
      );

      for (const node of targetNodes) {
        if (node.mutedUntil && node.mutedUntil.getTime() > now) continue;

        const sample = sampleByNode.get(node.id);
        const openAlert = openAlertByKey.get(`${rule.id}:${node.id}`);
        if (!sample) continue;

        const value = sample[rule.metric];
        const isBreached = breaches(value, rule.comparator, rule.threshold);
        const key = `${rule.id}:${node.id}`;
        observed.add(key);
        const inARow = this.streak.observe(key, isBreached);

        if (isBreached && !openAlert && inARow >= BREACHES_TO_FIRE) {
          toCreate.push({
            workspaceId: rule.workspaceId,
            ruleId: rule.id,
            nodeId: node.id,
            fingerprint: alertKey.rule(rule.id, node.id),
            severity: rule.severity,
            message: `Règle "${rule.name}" déclenchée sur ${node.name} : ${rule.metric} = ${value.toFixed(1)} (seuil ${rule.comparator} ${rule.threshold})`,
          });
        } else if (!isBreached && openAlert && inARow >= CLEAN_TO_RESOLVE) {
          toResolveIds.push(openAlert.id);
        }
      }
    }
    this.streak.retain(observed);

    await Promise.all([
      toCreate.length > 0
        ? this.prisma.alert.createMany({
            data: toCreate,
          })
        : Promise.resolve(),
      toResolveIds.length > 0
        ? this.prisma.alert.updateMany({
            where: { id: { in: toResolveIds } },
            data: { status: 'resolved', resolvedAt: new Date(), autoResolved: true },
          })
        : Promise.resolve(),
    ]);
  }
}
