import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AlertSeverity } from '@prisma/client';
import { alertEmailAddress } from '../mail/alert-recipients';
import { MailService } from '../mail/mail.service';
import { renderWeeklyReport, WeeklyReportInput } from '../mail/templates/weekly-report';
import { PrismaService } from '../prisma/prisma.service';
import { REPORT_TIME_ZONE } from './node-daily-stats.service';

const DAY_MS = 86_400_000;
const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// Every Monday at 8:00 (Paris), each workspace that has nodes and hasn't
// opted out gets a summary of the past seven days, sent to its owner only
// (Workspace.createdById; administrators for workspaces that predate it).
@Injectable()
export class WeeklyReportService {
  private readonly logger = new Logger(WeeklyReportService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  @Cron('0 8 * * 1', { timeZone: REPORT_TIME_ZONE })
  async sendAll() {
    if (this.running || !this.mailService.isConfigured) return;
    this.running = true;
    try {
      const workspaces = await this.prisma.workspace.findMany({
        where: {
          weeklyReportEnabled: true,
          nodes: { some: {} },
          // A restart around 8:00 must not send the same report twice.
          OR: [{ weeklyReportSentAt: null }, { weeklyReportSentAt: { lt: new Date(Date.now() - 6 * DAY_MS) } }],
        },
        select: { id: true, slug: true },
      });
      for (const workspace of workspaces) {
        try {
          const sent = await this.sendForWorkspace(workspace.id);
          if (sent > 0) {
            await this.prisma.workspace.update({ where: { id: workspace.id }, data: { weeklyReportSentAt: new Date() } });
            this.logger.log(`Weekly report for ${workspace.slug} sent to ${sent} recipient(s)`);
          }
        } catch (error) {
          this.logger.warn(`Weekly report for ${workspace.slug} failed: ${error instanceof Error ? error.message : error}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  // "Recevoir un aperçu" from the workspace settings: this week's report,
  // now, to whoever asked.
  async sendPreview(workspaceId: string, userId?: string) {
    if (!this.mailService.isConfigured) {
      throw new ServiceUnavailableException("L'envoi d'emails n'est pas configuré sur ce serveur.");
    }
    const user = userId ? await this.prisma.user.findUnique({ where: { id: userId } }) : null;
    const recipient = user ? alertEmailAddress(user) : null;
    if (!user || !recipient) throw new BadRequestException("Aucune adresse email valide n'est associée à votre compte.");
    const input = await this.buildInput(workspaceId, recipient, user.name);
    await this.mailService.send(recipient, renderWeeklyReport(input));
    return { sentTo: recipient };
  }

  private async sendForWorkspace(workspaceId: string): Promise<number> {
    const recipients = await this.recipients(workspaceId);
    let sent = 0;
    for (const recipient of recipients) {
      const input = await this.buildInput(workspaceId, recipient.address, recipient.name);
      try {
        await this.mailService.send(recipient.address, renderWeeklyReport(input));
        sent += 1;
      } catch (error) {
        this.logger.warn(`Weekly report to ${recipient.address} failed: ${error instanceof Error ? error.message : error}`);
      }
    }
    return sent;
  }

  private async recipients(workspaceId: string): Promise<{ address: string; name: string | null }[]> {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { createdById: true } });
    const owner = workspace?.createdById
      ? await this.prisma.user.findFirst({ where: { id: workspace.createdById, disabledAt: null } })
      : null;
    const users = owner
      ? [owner]
      : (
          await this.prisma.workspaceMembership.findMany({
            where: { workspaceId, role: 'owner', user: { disabledAt: null } },
            include: { user: true },
          })
        ).map((membership) => membership.user);
    return users
      .map((user) => ({ address: alertEmailAddress(user), name: user.name }))
      .filter((entry): entry is { address: string; name: string | null } => !!entry.address);
  }

  async buildInput(workspaceId: string, recipient: string, recipientName: string | null): Promise<WeeklyReportInput> {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true, slug: true } });
    if (!workspace) throw new NotFoundException('Workspace introuvable');

    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - 7 * DAY_MS);
    // The seven full Paris days before today.
    const today = parisDay(periodEnd);
    const firstDay = new Date(today.getTime() - 7 * DAY_MS);

    const [nodes, stats, alerts, openAlerts, jobs] = await Promise.all([
      this.prisma.node.findMany({
        where: { workspaceId },
        select: { id: true, name: true, status: true, disks: { select: { usedGb: true, capacityGb: true } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.nodeDailyStat.findMany({
        where: { node: { workspaceId }, day: { gte: firstDay, lt: today } },
        orderBy: { day: 'asc' },
      }),
      this.prisma.alert.findMany({
        where: { workspaceId, triggeredAt: { gte: periodStart } },
        select: { message: true, severity: true, node: { select: { name: true } } },
      }),
      this.prisma.alert.count({ where: { workspaceId, status: { not: 'resolved' } } }),
      this.prisma.syncJob.findMany({
        where: { workspaceId },
        select: { name: true, runs: { where: { startedAt: { gte: periodStart } }, select: { status: true, startedAt: true }, orderBy: { startedAt: 'desc' } } },
        orderBy: { name: 'asc' },
      }),
    ]);

    const statsByNode = new Map<string, typeof stats>();
    for (const stat of stats) statsByNode.set(stat.nodeId, [...(statsByNode.get(stat.nodeId) ?? []), stat]);
    const earliest = stats[0]?.day ?? null;

    const bySeverity: Record<AlertSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    const grouped = new Map<string, { message: string; nodeName: string | null; severity: AlertSeverity; count: number }>();
    for (const alert of alerts) {
      bySeverity[alert.severity] += 1;
      const key = `${alert.severity}\u0000${alert.node?.name ?? ''}\u0000${alert.message}`;
      const row = grouped.get(key);
      if (row) row.count += 1;
      else grouped.set(key, { message: alert.message, nodeName: alert.node?.name ?? null, severity: alert.severity, count: 1 });
    }

    return {
      recipient,
      recipientName,
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      frontendUrl: this.mailService.frontendUrl,
      periodStart: firstDay,
      periodEnd: new Date(today.getTime() - DAY_MS),
      coverageSince: earliest && earliest.getTime() > firstDay.getTime() ? earliest : null,
      nodes: nodes.map((node) => {
        const rows = statsByNode.get(node.id) ?? [];
        const observed = rows.reduce((sum, row) => sum + row.observedMinutes, 0);
        const online = rows.reduce((sum, row) => sum + row.onlineMinutes, 0);
        return { name: node.name, availability: observed > 0 ? online / observed : null, online: node.status === 'online' };
      }),
      alerts: {
        total: alerts.length,
        bySeverity,
        open: openAlerts,
        top: [...grouped.values()].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count).slice(0, 4),
      },
      storage: nodes
        .filter((node) => node.disks.length > 0)
        .map((node) => {
          const usedGb = node.disks.reduce((sum, disk) => sum + disk.usedGb, 0);
          const capacityGb = node.disks.reduce((sum, disk) => sum + disk.capacityGb, 0);
          const rows = (statsByNode.get(node.id) ?? []).filter((row) => row.diskUsedGb !== null);
          const first = rows[0];
          const spanDays = first ? Math.max(1, (today.getTime() - first.day.getTime()) / DAY_MS) : 0;
          const growthGb = first && rows.length >= 2 ? usedGb - (first.diskUsedGb as number) : null;
          const daysToFull = growthGb !== null && growthGb > 0 ? (capacityGb - usedGb) / (growthGb / spanDays) : null;
          return { nodeName: node.name, usedGb, capacityGb, growthGb, daysToFull };
        }),
      backups: jobs.map((job) => ({
        jobName: job.name,
        succeeded: job.runs.filter((run) => run.status === 'success').length,
        failed: job.runs.filter((run) => run.status === 'failed').length,
        lastStatus: job.runs.find((run) => run.status === 'success' || run.status === 'failed')?.status as 'success' | 'failed' | undefined ?? null,
      })),
    };
  }
}

// Midnight (UTC timestamp of the Paris calendar date) of `date`, matching
// how NodeDailyStat.day is stored.
function parisDay(date: Date): Date {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date)
    .split('-')
    .map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}
