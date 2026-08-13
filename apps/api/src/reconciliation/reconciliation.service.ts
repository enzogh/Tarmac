import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AgentsService } from '../agents/agents.service';
import { DnsGroupsService } from '../dns/dns-groups.service';
import { DnsZonesService } from '../dns/dns-zones.service';
import { MountsService } from '../mounts/mounts.service';
import { extractExternalIp } from '../nodes/extract-external-ip';
import { PoolsService } from '../pools/pools.service';
import { PrismaService } from '../prisma/prisma.service';
import { SharesService } from '../shares/shares.service';
import { VlanService } from '../vlan/vlan.service';
import { DEFAULT_WORKSPACE_ID } from '../workspaces/default-workspace';

const STUCK_MOUNT_ALERT_COOLDOWN_MS = 5 * 60 * 1000;

@Injectable()
export class ReconciliationService implements OnModuleInit {
  private readonly logger = new Logger(ReconciliationService.name);
  private readonly stuckMountAlertAt = new Map<string, number>();

  constructor(
    private readonly sharesService: SharesService,
    private readonly mountsService: MountsService,
    private readonly poolsService: PoolsService,
    private readonly dnsGroupsService: DnsGroupsService,
    private readonly dnsZonesService: DnsZonesService,
    private readonly agentsService: AgentsService,
    private readonly prisma: PrismaService,
    private readonly vlanService: VlanService,
  ) {}

  onModuleInit() {
    // Delay first tick to let DB connection settle
    setTimeout(() => {
      void this.tick();
      setInterval(() => {
        void this.tick();
      }, 15000);
    }, 5000);
  }

  private async tick() {
    try {
      const [pendingShares, pendingMounts, pendingPoolMembers, pendingDnsGroupMembers, pendingDnsZones] =
        await Promise.all([
          this.sharesService.findPending(),
          this.mountsService.findPending(),
          this.poolsService.findPendingMembers(),
          this.dnsGroupsService.findPendingGroupMembers(),
          this.dnsZonesService.findPendingZones(),
        ]);

    for (const share of pendingShares) {
      if (!this.agentsService.isConnected(share.nodeId)) continue;
      const allowedCidr = await this.vlanService.getVlanSubnet(share.node?.workspaceId ?? share.workspaceId);
      this.agentsService.sendCommand(share.nodeId!, {
        type: 'command.apply_export',
        payload: {
          shareId: share.id,
          name: share.name,
          path: share.path,
          allowedCidr,
        },
      });
      this.logger.debug(`Sent export command for share ${share.id}`);
    }

    for (const mount of pendingMounts) {
      if (!mount.nodeId || !this.agentsService.isConnected(mount.nodeId)) {
        await this.reportStuckMount(mount.id, mount.name, mount.nodeId);
        continue;
      }
      this.stuckMountAlertAt.delete(mount.id);
      this.agentsService.sendCommand(mount.nodeId, {
        type: 'command.apply_mount',
        payload: {
          mountId: mount.id,
          sourcePath: mount.sourcePath,
          additionalSources: mount.additionalSources,
          targetPath: mount.targetPath,
          fsType: mount.fsType,
          mountOptions: mount.mountOptions,
          ...(mount.remoteHost
            ? {
                remoteHost: mount.remoteHost,
                ...(mount.remoteUser ? { remoteUser: mount.remoteUser } : {}),
                ...(mount.remoteSshPort ? { remoteSshPort: mount.remoteSshPort } : {}),
              }
            : {}),
        },
      });
      this.logger.debug(`Sent mount command for mount ${mount.id}`);
    }

    for (const member of pendingPoolMembers) {
      if (!this.agentsService.isConnected(member.nodeId)) continue;
      this.agentsService.sendCommand(member.nodeId, {
        type: 'command.apply_pool',
        payload: {
          poolId: member.poolId,
          nodeId: member.nodeId,
          role: member.role,
          strategy: member.pool.strategy,
        },
      });
      this.logger.debug(`Sent pool command for pool ${member.poolId} member ${member.nodeId}`);
    }

    for (const member of pendingDnsGroupMembers) {
      if (!this.agentsService.isConnected(member.nodeId)) continue;

      // A secondary can't configure AXFR/IXFR without the primary's TSIG
      // key - if the primary hasn't reported it back yet (e.g. both members
      // went pending in the same tick), skip and retry next tick rather
      // than applying a half-configured secondary.
      if (member.role === 'secondary' && !member.group.tsigKeySecret) {
        this.logger.debug(
          `Deferring DNS server group command for group ${member.groupId} member ${member.nodeId}: waiting on primary's TSIG key`,
        );
        continue;
      }

      const siblings = member.group.members.filter((sibling) => sibling.nodeId !== member.nodeId);
      const primaryMember = member.group.members.find((sibling) => sibling.role === 'primary');
      this.agentsService.sendCommand(member.nodeId, {
        type: 'command.apply_dns_server_group',
        payload: {
          groupId: member.groupId,
          nodeId: member.nodeId,
          role: member.role,
          groupMemberVlanIps: siblings.map((sibling) => sibling.node.vlanIp).filter(Boolean),
          ...(member.role === 'secondary'
            ? { primaryVlanIp: primaryMember?.node.vlanIp ?? null, tsigKeySecret: member.group.tsigKeySecret }
            : {}),
          ...(process.env.MAXMIND_LICENSE_KEY ? { maxmindLicenseKey: process.env.MAXMIND_LICENSE_KEY } : {}),
        },
      });
      this.logger.debug(`Sent DNS server group command for group ${member.groupId} member ${member.nodeId}`);
    }

    for (const zone of pendingDnsZones) {
      const primary = zone.group.members.find((member) => member.role === 'primary');
      if (!primary || !this.agentsService.isConnected(primary.nodeId)) continue;
      // Vanity nameserver hostnames the agent writes as the zone's own NS
      // records - one per group member, same ns1./ns2./... ordering
      // (primary first) already shown in the delegation panel.
      const nameservers = zone.group.members.map((_, index) => `ns${index + 1}.${zone.name}`);
      // In-bailiwick nameservers (ns1.<zone> etc. living inside the zone
      // they serve) need an A record for themselves inside the zone, not
      // just glue at the registrar - otherwise a resolver that reaches the
      // zone's own authoritative server has no way to answer "what's the
      // address of ns1.<zone>?" (confirmed in production: PowerDNS replied
      // NXDOMAIN for that exact query even though delegation itself worked).
      const nsGlue = zone.group.members
        .map((member, index) => ({ host: nameservers[index], ip: extractExternalIp(member.node.overlayEndpoint) }))
        .filter((entry): entry is { host: string; ip: string } => Boolean(entry.ip));
      this.agentsService.sendCommand(primary.nodeId, {
        type: 'command.apply_dns_zone',
        payload: {
          zoneId: zone.id,
          zoneName: zone.name,
          dnssecEnabled: zone.dnssecEnabled,
          nameservers,
          nsGlue,
          records: zone.records.map((record) => ({
            name: record.name,
            type: record.type,
            ttl: record.ttl,
            isGeo: record.isGeo,
            values: record.values.map((value) => ({ content: value.content, priority: value.priority })),
          })),
        },
      });
      this.logger.debug(`Sent DNS zone command for zone ${zone.id}`);

      // Zone transfer between primary/secondary is native DNS (AXFR), not
      // something Tarmac pushes - but each secondary still needs to be
      // explicitly told the zone exists and who its master is, or its
      // PowerDNS has nothing to transfer at all and answers REFUSED for a
      // zone it's never heard of (confirmed in production: supermaster
      // auto-provisioning silently never worked - see applyDnsServerGroup).
      if (!primary.node.vlanIp) {
        // Silent before this log existed - a zone would apply fine on the
        // primary while every secondary got nothing at all, no error
        // anywhere, because this guard skipped the whole loop below
        // (confirmed in production: took reading pdns/agent logs on two
        // separate boxes to find, since neither side ever saw the command).
        this.logger.warn(
          `Skipping DNS zone slave dispatch for zone ${zone.id}: primary node ${primary.nodeId} has no vlanIp`,
        );
        continue;
      }
      for (const secondary of zone.group.members) {
        if (secondary.role === 'primary') continue;
        if (!this.agentsService.isConnected(secondary.nodeId)) {
          this.logger.warn(
            `Skipping DNS zone slave dispatch for zone ${zone.id}: secondary node ${secondary.nodeId} is not connected`,
          );
          continue;
        }
        this.agentsService.sendCommand(secondary.nodeId, {
          type: 'command.apply_dns_zone_slave',
          payload: { zoneId: zone.id, zoneName: zone.name, primaryVlanIp: primary.node.vlanIp, groupId: zone.groupId },
        });
        this.logger.debug(`Sent DNS zone slave command for zone ${zone.id} to secondary ${secondary.nodeId}`);
      }
    }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Reconciliation tick skipped: ${message}`);
      await this.prisma.alert.create({
        data: {
          workspaceId: DEFAULT_WORKSPACE_ID,
          severity: 'medium',
          message: `Reconciliation tick skipped: ${message}`,
        },
      });
    }
  }

  private async reportStuckMount(mountId: string, mountName: string, nodeId: string | null) {
    const lastAlertAt = this.stuckMountAlertAt.get(mountId) ?? 0;
    if (Date.now() - lastAlertAt < STUCK_MOUNT_ALERT_COOLDOWN_MS) return;
    this.stuckMountAlertAt.set(mountId, Date.now());

    const reason = nodeId
      ? `l'agent du nœud ${nodeId} n'est pas connecté`
      : 'aucun nœud n\'est associé à ce montage';
    const message = `Montage "${mountName}" bloqué en attente : ${reason}.`;
    this.logger.warn(message);
    await this.prisma.alert.create({
      data: {
        workspaceId: DEFAULT_WORKSPACE_ID,
        nodeId: nodeId ?? null,
        severity: 'medium',
        message,
      },
    });
  }
}