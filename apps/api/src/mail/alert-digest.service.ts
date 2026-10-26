import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { alertEmailAddress, parseChannelTargets } from './alert-recipients';
import { MailService } from './mail.service';
import { renderAlertDigest } from './templates/alert-digest';

// Alerts are created from a dozen places (agents, reconciliation, the rule
// evaluator, VLAN probes...), often several in the same second when a node
// drops. Rather than hook each of those, this sweeps for alerts that haven't
// been mailed yet and sends one email per workspace and recipient once the
// burst has settled:
//  - nothing new for QUIET seconds -> the burst is over, send it;
//  - or the oldest pending alert has waited MAX_WAIT seconds -> send anyway,
//    so a node flapping non-stop can't hold every email back forever.
@Injectable()
export class AlertDigestService {
  private readonly logger = new Logger(AlertDigestService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  private get quietMs() {
    return Number(this.configService.get<string>('ALERT_EMAIL_QUIET_SECONDS', '45')) * 1000;
  }

  private get maxWaitMs() {
    return Number(this.configService.get<string>('ALERT_EMAIL_MAX_WAIT_SECONDS', '300')) * 1000;
  }

  // An alert that couldn't be mailed for this long (relay down for hours)
  // is history by the time it would arrive - drop it rather than flood.
  private readonly staleMs = 6 * 60 * 60 * 1000;

  @Cron(CronExpression.EVERY_10_SECONDS)
  async sweep() {
    if (this.running) return;
    this.running = true;
    try {
      await this.dispatchPending();
    } catch (error) {
      this.logger.error(`Alert digest sweep failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.running = false;
    }
  }

  private async dispatchPending() {
    const now = Date.now();

    if (!this.mailService.isConfigured) {
      // Without a relay nothing can be sent; marking the alerts keeps the
      // first digest after SMTP gets configured from replaying the backlog.
      await this.prisma.alert.updateMany({ where: { emailNotifiedAt: null }, data: { emailNotifiedAt: new Date() } });
      return;
    }

    await this.prisma.alert.updateMany({
      where: { emailNotifiedAt: null, createdAt: { lt: new Date(now - this.staleMs) } },
      data: { emailNotifiedAt: new Date() },
    });

    const pending = await this.prisma.alert.findMany({
      where: { emailNotifiedAt: null },
      orderBy: { createdAt: 'asc' },
      include: { node: { select: { name: true } } },
    });
    if (pending.length === 0) return;

    const byWorkspace = new Map<string, typeof pending>();
    for (const alert of pending) {
      const list = byWorkspace.get(alert.workspaceId) ?? [];
      list.push(alert);
      byWorkspace.set(alert.workspaceId, list);
    }

    for (const [workspaceId, alerts] of byWorkspace) {
      const oldest = alerts[0].createdAt.getTime();
      const newest = alerts[alerts.length - 1].createdAt.getTime();
      if (now - newest < this.quietMs && now - oldest < this.maxWaitMs) continue;
      await this.dispatchWorkspace(workspaceId, alerts);
    }
  }

  private async dispatchWorkspace(
    workspaceId: string,
    alerts: Prisma.AlertGetPayload<{ include: { node: { select: { name: true } } } }>[],
  ) {
    const ids = alerts.map((alert) => alert.id);
    // Something that already resolved itself while the burst settled isn't
    // worth an email, and neither is a repeat of a problem already mailed
    // and still unresolved: a persistent condition re-raises its alert on
    // every check (the Alertes page groups those occurrences), which used to
    // send the same alert over and over.
    const alreadyMailed = await this.prisma.alert.findMany({
      where: {
        workspaceId,
        id: { notIn: ids },
        status: { not: 'resolved' },
        emailNotifiedAt: { not: null },
        message: { in: [...new Set(alerts.map((alert) => alert.message))] },
      },
      select: { nodeId: true, message: true },
    });
    const ongoing = new Set(alreadyMailed.map((alert) => `${alert.nodeId ?? ''}\u0000${alert.message}`));
    const toSend = alerts.filter(
      (alert) => alert.status !== 'resolved' && !ongoing.has(`${alert.nodeId ?? ''}\u0000${alert.message}`),
    );

    const recipients = toSend.length > 0 ? await this.recipientsFor(workspaceId) : [];
    if (toSend.length === 0 || recipients.length === 0) {
      await this.markNotified(ids);
      return;
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true, slug: true },
    });
    if (!workspace) {
      await this.markNotified(ids);
      return;
    }

    let delivered = 0;
    for (const recipient of recipients) {
      const mail = renderAlertDigest({
        workspaceName: workspace.name,
        workspaceSlug: workspace.slug,
        recipient,
        frontendUrl: this.mailService.frontendUrl,
        alerts: toSend.map((alert) => ({
          message: alert.message,
          severity: alert.severity,
          triggeredAt: alert.triggeredAt,
          nodeName: alert.node?.name ?? null,
        })),
      });
      try {
        await this.mailService.send(recipient, mail);
        delivered += 1;
      } catch (error) {
        this.logger.warn(`Alert email to ${recipient} failed: ${error instanceof Error ? error.message : error}`);
      }
    }

    // Retry on the next sweep only when the relay refused every message -
    // a single bad address must not make everyone else get the mail twice.
    if (delivered > 0) {
      await this.markNotified(ids);
      this.logger.log(`Sent ${toSend.length} alert(s) for workspace ${workspace.slug} to ${delivered} recipient(s)`);
    }
  }

  private markNotified(ids: string[]) {
    return this.prisma.alert.updateMany({ where: { id: { in: ids } }, data: { emailNotifiedAt: new Date() } });
  }

  private async recipientsFor(workspaceId: string): Promise<string[]> {
    const [memberships, channels] = await Promise.all([
      this.prisma.workspaceMembership.findMany({
        // Members whose role hides the Alertes page don't get its emails either.
        where: {
          workspaceId,
          user: { alertEmailsEnabled: true },
          OR: [{ role: 'owner' }, { permissions: { hasSome: ['alerts:read', 'alerts:write'] } }],
        },
        select: { user: { select: { email: true, internalEmail: true } } },
      }),
      this.prisma.notificationChannel.findMany({
        where: { workspaceId, type: 'email', enabled: true },
        select: { target: true },
      }),
    ]);

    const addresses = new Set<string>();
    for (const { user } of memberships) {
      const address = alertEmailAddress(user);
      if (address) addresses.add(address);
    }
    for (const channel of channels) {
      for (const address of parseChannelTargets(channel.target)) addresses.add(address);
    }
    return [...addresses];
  }
}
