import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Comparator } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const SUPPORTED_METRICS = ['cpu', 'ram', 'disk'] as const;
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
// Alerts are created/resolved based on whether an open Alert already exists
// for that (ruleId, nodeId) pair, so this is idempotent across ticks without
// needing an in-memory cooldown map.
@Injectable()
export class AlertRulesEvaluatorService {
  private readonly logger = new Logger(AlertRulesEvaluatorService.name);

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
        where: { createdAt: { gte: new Date(Date.now() - 10 * 60_000) } },
        orderBy: [{ nodeId: 'asc' }, { createdAt: 'desc' }],
        distinct: ['nodeId'],
      }),
      this.prisma.alert.findMany({
        where: { status: 'open', ruleId: { in: rules.map((rule) => rule.id) } },
      }),
    ]);

    const sampleByNode = new Map(latestSamples.map((sample) => [sample.nodeId, sample]));
    const openAlertByKey = new Map(openAlerts.map((alert) => [`${alert.ruleId}:${alert.nodeId}`, alert]));
    const now = Date.now();

    // Collect breaches/recoveries while scanning, then flush with a single createMany +
    // updateMany — a mass outage or mass-recovery (many nodes crossing a threshold at once)
    // would otherwise mean one sequential DB round trip per (rule, node) pair in this tick.
    const toCreate: { workspaceId: string; ruleId: string; nodeId: string; severity: typeof rules[number]['severity']; message: string }[] = [];
    const toResolveIds: string[] = [];

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

        if (isBreached && !openAlert) {
          toCreate.push({
            workspaceId: rule.workspaceId,
            ruleId: rule.id,
            nodeId: node.id,
            severity: rule.severity,
            message: `Règle "${rule.name}" déclenchée sur ${node.name} : ${rule.metric} = ${value.toFixed(1)} (seuil ${rule.comparator} ${rule.threshold})`,
          });
        } else if (!isBreached && openAlert) {
          toResolveIds.push(openAlert.id);
        }
      }
    }

    await Promise.all([
      toCreate.length > 0
        ? this.prisma.alert.createMany({
            data: toCreate,
          })
        : Promise.resolve(),
      toResolveIds.length > 0
        ? this.prisma.alert.updateMany({
            where: { id: { in: toResolveIds } },
            data: { status: 'resolved', resolvedAt: new Date() },
          })
        : Promise.resolve(),
    ]);
  }
}
