import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { AgentsService } from '../agents/agents.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { WorkspaceScope } from '../auth/workspace.guard';
import { slugify } from '../common/slugify';
import { PrismaService } from '../prisma/prisma.service';

const SYNC_INTERVAL_MS = 30_000;
const INTERNAL_DNS_PORT = 5300;
const INTERNAL_DNS_API_PORT = 8090;

type InternalDnsRecord = { name: string; content: string };

// Manages the single, optional, dedicated internal PowerDNS instance that
// serves *.tarmac.local for a workspace's own fleet - a distinct concept
// from DnsGroupsService/DnsZonesService (which manage the user's own
// public-facing zones on their own PowerDNS installs): this one is
// automatic, at most one node per workspace, on a non-standard port so it
// never interacts with the port-53 conflict/mask logic those use.
@Injectable()
export class InternalDnsService implements OnModuleInit {
  private readonly logger = new Logger(InternalDnsService.name);
  // workspaceId -> last-pushed record signature, purely in-memory so the
  // periodic tick only sends a command when the desired state actually
  // changed (new/removed node, edited hostname, changed VLAN IP) instead of
  // re-pushing an identical snapshot every cycle.
  private readonly lastPushedSignature = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentsService: AgentsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  onModuleInit() {
    setTimeout(() => {
      void this.tick();
      setInterval(() => {
        void this.tick();
      }, SYNC_INTERVAL_MS);
    }, 10_000);
  }

  async setInternalDnsNode(nodeId: string, scope: WorkspaceScope, actorUserId?: string) {
    const node = await this.prisma.node.findFirst({ where: { id: nodeId, workspaceId: scope.workspaceId } });
    if (!node) throw new NotFoundException('node not found');

    await this.prisma.workspace.update({
      where: { id: scope.workspaceId as string },
      data: { internalDnsNodeId: nodeId },
    });
    this.lastPushedSignature.delete(scope.workspaceId as string);
    const cleanupSent = await this.pushToNode(nodeId, scope.workspaceId as string);
    if (node.vlanIp) {
      await this.pushRouteToFleet(scope.workspaceId as string, node.vlanIp);
    }

    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'dns.internal.designate',
      resourceType: 'node',
      resourceId: nodeId,
    });
    return { nodeId, applySent: cleanupSent };
  }

  async clearInternalDnsNode(scope: WorkspaceScope, actorUserId?: string) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: scope.workspaceId as string } });
    const previousNodeId = workspace?.internalDnsNodeId ?? null;

    const cleanupSent = previousNodeId
      ? this.agentsService.sendCommand(previousNodeId, { type: 'command.remove_internal_dns', payload: {} })
      : false;

    await this.prisma.workspace.update({
      where: { id: scope.workspaceId as string },
      data: { internalDnsNodeId: null },
    });
    this.lastPushedSignature.delete(scope.workspaceId as string);
    await this.pushRouteToFleet(scope.workspaceId as string, null);

    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'dns.internal.clear',
      resourceType: 'node',
      resourceId: previousNodeId ?? undefined,
    });
    return { cleanupSent };
  }

  async getStatus(scope: WorkspaceScope) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: scope.workspaceId as string } });
    const records = await this.desiredRecords(scope.workspaceId as string);
    return { internalDnsNodeId: workspace?.internalDnsNodeId ?? null, records };
  }

  // Re-broadcast on every tick, not just when the designation changes - this
  // is what makes an already-deployed fleet self-heal automatically once
  // its agents update: a node that reconnects (e.g. right after picking up
  // a new agent version) has no route configured yet, and picks one up on
  // the very next cycle without needing any user action.
  private async tick() {
    const workspaces = await this.prisma.workspace.findMany({
      where: { internalDnsNodeId: { not: null } },
      select: { id: true, internalDnsNodeId: true },
    });
    for (const workspace of workspaces) {
      if (!workspace.internalDnsNodeId) continue;
      try {
        await this.pushToNode(workspace.internalDnsNodeId, workspace.id);
        const node = await this.prisma.node.findUnique({
          where: { id: workspace.internalDnsNodeId },
          select: { vlanIp: true },
        });
        if (node?.vlanIp) {
          await this.pushRouteToFleet(workspace.id, node.vlanIp);
        }
      } catch (error) {
        this.logger.warn(
          `Internal DNS sync failed for workspace ${workspace.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  // Tells every node in the workspace (not just the one running PowerDNS)
  // to route *.tarmac.local queries at `ip` - or to clear that route if
  // `ip` is null (internal DNS turned off). Fire-and-forget per node, same
  // as everywhere else in this file: an offline node just picks it up next
  // time it reconnects and this runs again.
  private async pushRouteToFleet(workspaceId: string, ip: string | null) {
    const nodes = await this.prisma.node.findMany({ where: { workspaceId }, select: { id: true } });
    for (const node of nodes) {
      this.agentsService.sendCommand(node.id, {
        type: 'command.ensure_internal_dns_route',
        payload: { ip, port: INTERNAL_DNS_PORT },
      });
    }
  }

  private async desiredRecords(workspaceId: string): Promise<InternalDnsRecord[]> {
    const nodes = await this.prisma.node.findMany({
      where: { workspaceId, vlanIp: { not: null } },
      select: { name: true, dnsHostname: true, vlanIp: true },
    });
    return nodes
      .map((node) => ({ name: node.dnsHostname || slugify(node.name), content: node.vlanIp as string }))
      .filter((record) => record.name.length > 0);
  }

  // Fire-and-forget by design, same as the DNS server group cleanup
  // commands - returns whether the command was sent, not whether the agent
  // finished applying it. Skips entirely (no-op, not an error) if nothing
  // changed since the last successful push for this workspace.
  private async pushToNode(nodeId: string, workspaceId: string): Promise<boolean> {
    const records = await this.desiredRecords(workspaceId);
    const signature = JSON.stringify(records);
    if (this.lastPushedSignature.get(workspaceId) === signature) {
      return true;
    }

    const sent = this.agentsService.sendCommand(nodeId, {
      type: 'command.setup_internal_dns',
      payload: { port: INTERNAL_DNS_PORT, apiPort: INTERNAL_DNS_API_PORT, records },
    });
    if (sent) {
      this.lastPushedSignature.set(workspaceId, signature);
    }
    return sent;
  }
}
