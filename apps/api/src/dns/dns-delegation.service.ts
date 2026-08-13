import { forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AgentsService } from '../agents/agents.service';
import { WorkspaceScope } from '../auth/workspace.guard';
import { extractExternalIp } from '../nodes/extract-external-ip';
import { PrismaService } from '../prisma/prisma.service';
import { DnsGroupsService } from './dns-groups.service';
import { DnsZonesService } from './dns-zones.service';

// Read-only helpers that talk to the agent over WebSocket rather than
// owning any DB write path of their own.
@Injectable()
export class DnsDelegationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AgentsService))
    private readonly agentsService: AgentsService,
    private readonly dnsZonesService: DnsZonesService,
    private readonly dnsGroupsService: DnsGroupsService,
  ) {}

  // Vanity in-zone nameservers (ns1.<zone>, ns2.<zone>, ...) pointing at each
  // group member's public IP. Most registrars additionally require "glue
  // records" to be registered separately for in-domain nameservers - that
  // step is registrar-specific and stays manual, the UI just explains it.
  async getDelegation(id: string, scope: WorkspaceScope) {
    const zone = await this.dnsZonesService.assertZoneOwned(id, scope);
    const members = await this.prisma.dnsServerGroupMember.findMany({
      where: { groupId: zone.groupId },
      include: { node: true },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });

    const glue = members
      .map((member, index) => ({ host: `ns${index + 1}.${zone.name}`, ip: extractExternalIp(member.node.overlayEndpoint) }))
      .filter((entry): entry is { host: string; ip: string } => Boolean(entry.ip));

    return {
      nsHostnames: glue.map((entry) => entry.host),
      glue,
      // Real-world verification state (see DnsDelegationCheckService) -
      // merged in here so the frontend doesn't need a second fetch.
      verified: zone.delegationVerified,
      checkedAt: zone.delegationCheckedAt,
      detail: zone.delegationDetail,
    };
  }

  // DS/DNSKEY are never persisted (see plan) - always fetched live from the
  // primary's PowerDNS instance over the same request/response WS channel
  // used for requestTraceroute.
  async getDnssecKeys(id: string, scope: WorkspaceScope) {
    const zone = await this.dnsZonesService.assertZoneOwned(id, scope);
    if (!zone.dnssecEnabled) {
      return { dsRecords: [], dnskeyRecords: [] };
    }
    const primary = await this.dnsGroupsService.getPrimaryMember(zone.groupId);
    if (!primary) throw new NotFoundException("this zone's group has no primary server yet");
    return this.agentsService.requestDnsZoneKeys(primary.nodeId, zone.name);
  }
}
