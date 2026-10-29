import { BadRequestException, ConflictException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FirewallRule, Prisma } from '@prisma/client';
import * as net from 'net';
import { AgentsService } from '../agents/agents.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { WorkspaceScope } from '../auth/workspace.guard';
import { slugify } from '../common/slugify';
import { LiveWsServer } from '../live/live.ws';
import { PrismaService } from '../prisma/prisma.service';
import { VPN_LISTEN_PORT } from '../vpn/vpn-network';
import {
  BulkFirewallNodesDto,
  CreateFirewallRuleDto,
  FirewallAddressListDto,
  TestFirewallDto,
  UpdateFirewallAddressListDto,
  UpdateFirewallRuleDto,
  UpdateFirewallSettingsDto,
} from './dto/firewall.dto';
import {
  buildAgentPayload,
  describeService,
  evaluate,
  FwMode,
  managedBy,
  meshMatrix,
  parsePortRange,
  payloadIsEmpty,
  PolicyContext,
  PolicyNode,
  PolicyRule,
  publicExposure,
  serviceName,
  SystemFlow,
} from './firewall-policy';

const RECONCILE_QUIET_MS = 300;
const RECONCILE_MAX_WAIT_MS = 2_000;
const EVENT_RETENTION_DAYS = 14;
const INTERNAL_DNS_PORT = 5300;
const MESH_INTERFACE = 'tarmacwg0';
// Rule id the agent puts on events and counters of the SSH limiter.
const SSH_LIMIT_ID = 'ssh-limit';
// The dashboard polls every 10 s per open tab and refetches on every live
// event: a short cache spares recomputing the whole policy each time.
const CONTEXT_CACHE_MS = 3_000;

export type FirewallReport = {
  revision?: string;
  uplinks?: string[];
  docker?: boolean;
  logging?: boolean;
  full?: boolean;
  listening?: Array<{ protocol: string; port: number; addresses?: string[]; processes?: string[] }>;
  counters?: Record<string, number>;
  // Optional protections this agent knows how to apply (e.g. "ssh-limit").
  features?: string[];
  events?: Array<{
    verdict: string;
    ruleId?: string;
    source: string;
    destination?: string;
    protocol: string;
    port?: number;
    interface?: string;
    docker?: boolean;
    count: number;
    firstSeen: number;
    lastSeen: number;
  }>;
};

type StoredReport = {
  uplinks: string[];
  docker: boolean;
  logging: boolean;
  features?: string[];
  listening: Array<{ protocol: 'tcp' | 'udp'; port: number; addresses: string[]; processes: string[] }>;
  reportedAt: string;
};

type Actor = { userId?: string; scope: WorkspaceScope };

const MODE_LABEL: Record<FwMode, string> = { open: 'ouvert', observe: 'observation', enforce: 'appliqué' };

function hostOf(source: string): string | null {
  // "10.16.0.5:/data", "host.tarmac.local:/x", "[fd00::1]:/x"
  const trimmed = source.trim();
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    return end > 0 ? trimmed.slice(1, end) : null;
  }
  const colon = trimmed.indexOf(':');
  return colon > 0 ? trimmed.slice(0, colon) : null;
}

function sanitizeReport(report: FirewallReport): StoredReport {
  const listening = (report.listening ?? [])
    .filter((entry) => (entry.protocol === 'tcp' || entry.protocol === 'udp') && Number.isInteger(entry.port) && entry.port > 0 && entry.port < 65536)
    .slice(0, 200)
    .map((entry) => ({
      protocol: entry.protocol as 'tcp' | 'udp',
      port: entry.port,
      addresses: (entry.addresses ?? []).filter((value) => typeof value === 'string').slice(0, 8).map((value) => value.slice(0, 64)),
      processes: (entry.processes ?? []).filter((value) => typeof value === 'string').slice(0, 6).map((value) => value.slice(0, 64)),
    }));
  return {
    uplinks: (report.uplinks ?? []).filter((value) => typeof value === 'string').slice(0, 8),
    docker: Boolean(report.docker),
    logging: Boolean(report.logging),
    features: (report.features ?? []).filter((value) => typeof value === 'string').slice(0, 20).map((value) => value.slice(0, 40)),
    listening,
    reportedAt: new Date().toISOString(),
  };
}

function normalizeList(values: string[] | undefined, max: number): string[] {
  const seen = new Map<string, string>();
  for (const raw of values ?? []) {
    const value = raw.trim().replace(/\s+/g, ' ');
    if (value && !seen.has(value.toLowerCase())) seen.set(value.toLowerCase(), value);
  }
  return [...seen.values()].slice(0, max);
}

function normalizeCidr(raw: string): string | null {
  const value = raw.trim();
  const [address, length] = value.split('/');
  const family = net.isIP(address);
  if (!family) return null;
  if (length === undefined) return family === 4 ? `${address}/32` : `${address.toLowerCase()}/128`;
  const bits = Number(length);
  if (!/^\d{1,3}$/.test(length) || bits > (family === 4 ? 32 : 128)) return null;
  if (family === 4) {
    // Canonical network address, as iptables would print it.
    const int = address.split('.').reduce((total, octet) => total * 256 + Number(octet), 0);
    const block = 2 ** (32 - bits);
    const base = Math.floor(int / block) * block;
    const octets = [24, 16, 8, 0].map((shift) => Math.floor(base / 2 ** shift) % 256);
    return `${octets.join('.')}/${bits}`;
  }
  return `${address.toLowerCase()}/${bits}`;
}

@Injectable()
export class FirewallService {
  private readonly logger = new Logger(FirewallService.name);
  private readonly pendingReconciles = new Map<
    string,
    { firstAt: number; timer: NodeJS.Timeout; waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> }
  >();
  // Revision last sent per node: the node is "applying" until it acks it.
  private readonly sentRevisions = new Map<string, string>();
  // Last hit counters per node, to turn the agents' cumulative counters
  // (reset on every apply) into deltas.
  private readonly lastCounters = new Map<string, Record<string, number>>();
  private readonly contextCache = new Map<string, { at: number; value: ReturnType<FirewallService['loadContext']> }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly live: LiveWsServer,
    @Inject(forwardRef(() => AgentsService))
    private readonly agentsService: AgentsService,
  ) {}

  // ---------------------------------------------------------------------
  // Context
  // ---------------------------------------------------------------------

  /** loadContext, shared for CONTEXT_CACHE_MS by the read endpoints. */
  private cachedContext(workspaceId: string) {
    const hit = this.contextCache.get(workspaceId);
    if (hit && Date.now() - hit.at < CONTEXT_CACHE_MS) return hit.value;
    const value = this.loadContext(workspaceId);
    this.contextCache.set(workspaceId, { at: Date.now(), value });
    value.catch(() => this.contextCache.delete(workspaceId));
    return value;
  }

  private invalidate(workspaceId: string) {
    this.contextCache.delete(workspaceId);
  }

  private async loadContext(workspaceId: string) {
    const [workspace, nodes, rules, lists] = await Promise.all([
      this.prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: {
          firewallMeshMode: true,
          firewallPublicPing: true,
          firewallSshGuard: true,
          firewallSshLimit: true,
          firewallEventRetentionDays: true,
          internalDnsNodeId: true,
        },
      }),
      this.prisma.node.findMany({
        where: { workspaceId },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          status: true,
          vlanIp: true,
          labels: true,
          dnsHostname: true,
          overlayListenPort: true,
          locationCountryCode: true,
          locationCity: true,
          agentVersion: true,
          firewallPublicMode: true,
          firewallAppliedRevision: true,
          firewallApplyStatus: true,
          firewallApplyError: true,
          firewallReport: true,
        },
      }),
      this.prisma.firewallRule.findMany({ where: { workspaceId }, orderBy: [{ scope: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.firewallAddressList.findMany({ where: { workspaceId }, orderBy: { name: 'asc' } }),
    ]);
    const policyNodes: PolicyNode[] = nodes.map((node) => {
      const report = node.firewallReport as StoredReport | null;
      const sshPorts = [
        ...new Set(
          (report?.listening ?? [])
            .filter((entry) => entry.protocol === 'tcp' && entry.processes.some((process) => process === 'sshd' || process.startsWith('sshd')))
            .map((entry) => entry.port),
        ),
      ];
      return {
        id: node.id,
        name: node.name,
        vlanIp: node.vlanIp,
        labels: node.labels,
        publicMode: (node.firewallPublicMode as FwMode) ?? 'open',
        sshPorts: sshPorts.length > 0 ? sshPorts : [22],
      };
    });
    const system = await this.systemFlows(workspaceId, workspace, nodes, policyNodes);
    const ctx: PolicyContext = {
      meshMode: workspace.firewallMeshMode as FwMode,
      publicPing: workspace.firewallPublicPing,
      sshGuard: workspace.firewallSshGuard,
      sshLimit: workspace.firewallSshLimit,
      nodes: policyNodes,
      rules: rules.map((rule) => this.toPolicyRule(rule)),
      system,
      lists: lists.map((list) => ({ id: list.id, name: list.name, cidrs: list.cidrs })),
    };
    return { workspace, nodes, rules, lists, ctx };
  }

  private toPolicyRule(rule: FirewallRule): PolicyRule {
    return {
      id: rule.id,
      scope: rule.scope as PolicyRule['scope'],
      action: rule.action as PolicyRule['action'],
      name: rule.name,
      enabled: rule.enabled,
      sourceKind: rule.sourceKind as PolicyRule['sourceKind'],
      sourceNodeIds: rule.sourceNodeIds,
      sourceLabels: rule.sourceLabels,
      sourceCidrs: rule.sourceCidrs,
      sourceListIds: rule.sourceListIds,
      targetKind: rule.targetKind as PolicyRule['targetKind'],
      targetNodeIds: rule.targetNodeIds,
      targetLabels: rule.targetLabels,
      protocol: rule.protocol as PolicyRule['protocol'],
      ports: rule.ports,
      expiresAt: rule.expiresAt,
    };
  }

  /**
   * Everything Tarmac itself needs to keep working, derived from what the
   * workspace runs: these flows are always allowed, and listed in the
   * dashboard so nobody wonders why a port is open.
   */
  private async systemFlows(
    workspaceId: string,
    workspace: { internalDnsNodeId: string | null; firewallSshGuard: boolean },
    nodes: Array<{ id: string; name: string; vlanIp: string | null; dnsHostname: string | null; overlayListenPort: number | null }>,
    policyNodes: PolicyNode[],
  ): Promise<SystemFlow[]> {
    const [profiles, dnsMembers, mounts, syncJobs, migrations] = await Promise.all([
      this.prisma.vpnProfile.findMany({
        where: { workspaceId, enabled: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        select: { entryNodeId: true, meshAccess: true, meshNodeIds: true },
      }),
      this.prisma.dnsServerGroupMember.findMany({
        where: { node: { workspaceId } },
        select: { nodeId: true, groupId: true, group: { select: { name: true } } },
      }),
      this.prisma.mount.findMany({
        where: { workspaceId, nodeId: { not: null } },
        select: { id: true, name: true, nodeId: true, fsType: true, sourcePath: true, additionalSources: true, remoteHost: true, remoteSshPort: true },
      }),
      this.prisma.syncJob.findMany({
        where: { workspaceId, nodeId: { not: null }, sourceHost: { not: null } },
        select: { id: true, name: true, nodeId: true, sourceHost: true, sourceSshPort: true },
      }),
      this.prisma.migrationTask.findMany({
        where: { workspaceId, status: { in: ['pending', 'running'] }, sourceNodeId: { not: null }, targetNodeId: { not: null } },
        select: { id: true, name: true, sourceNodeId: true, targetNodeId: true },
      }),
    ]);

    const flows: SystemFlow[] = [];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const byHost = new Map<string, string>();
    for (const node of nodes) {
      if (node.vlanIp) byHost.set(node.vlanIp, node.id);
      byHost.set(`${node.dnsHostname || slugify(node.name)}.tarmac.local`, node.id);
    }
    const resolveHost = (host: string | null | undefined) => (host ? byHost.get(host.trim().toLowerCase()) ?? byHost.get(host.trim()) : undefined);
    const nameOf = (id: string) => byId.get(id)?.name ?? 'serveur supprimé';

    for (const node of nodes) {
      if (node.vlanIp) {
        flows.push({
          id: `wg:${node.id}`,
          scope: 'public',
          kind: 'wireguard',
          label: 'Réseau privé Tarmac',
          detail: 'connexion chiffrée WireGuard entre vos serveurs',
          sourceNodeIds: 'all',
          targetNodeId: node.id,
          protocol: 'udp',
          ports: [String(node.overlayListenPort ?? 51820)],
        });
      }
    }
    if (workspace.firewallSshGuard) {
      for (const node of policyNodes) {
        flows.push({
          id: `sshguard:${node.id}`,
          scope: 'public',
          kind: 'ssh-guard',
          label: 'Protection anti-verrouillage',
          detail: 'l’accès SSH reste ouvert pour ne jamais perdre la main sur le serveur',
          sourceNodeIds: 'all',
          targetNodeId: node.id,
          protocol: 'tcp',
          ports: node.sshPorts.map(String),
        });
      }
    }

    const entries = new Set(profiles.map((profile) => profile.entryNodeId));
    for (const entryId of entries) {
      flows.push({
        id: `vpn:${entryId}`,
        scope: 'public',
        kind: 'vpn',
        label: 'Passerelle VPN',
        detail: 'les appareils VPN se connectent à ce serveur',
        sourceNodeIds: 'all',
        targetNodeId: entryId,
        protocol: 'udp',
        ports: [String(VPN_LISTEN_PORT)],
      });
    }
    // VPN clients reach the fleet NATed behind their entry node: what their
    // profiles allow, the entry node must be allowed to reach.
    const vpnTargets = new Map<string, Set<string>>();
    for (const profile of profiles) {
      const targets =
        profile.meshAccess === 'all' ? nodes.map((node) => node.id) : profile.meshAccess === 'selected' ? profile.meshNodeIds : [];
      for (const targetId of targets) {
        if (targetId === profile.entryNodeId || !byId.has(targetId)) continue;
        if (!vpnTargets.has(targetId)) vpnTargets.set(targetId, new Set());
        vpnTargets.get(targetId)!.add(profile.entryNodeId);
      }
    }
    for (const [targetId, sources] of vpnTargets) {
      for (const entryId of sources) {
        flows.push({
          id: `vpnmesh:${entryId}:${targetId}`,
          scope: 'mesh',
          kind: 'vpn',
          label: `Clients VPN via ${nameOf(entryId)}`,
          detail: 'les appareils VPN autorisés arrivent par leur passerelle d’entrée',
          sourceNodeIds: [entryId],
          targetNodeId: targetId,
          protocol: 'any',
          ports: [],
        });
      }
    }

    const groups = new Map<string, { name: string; nodeIds: string[] }>();
    for (const member of dnsMembers) {
      if (!groups.has(member.groupId)) groups.set(member.groupId, { name: member.group.name, nodeIds: [] });
      groups.get(member.groupId)!.nodeIds.push(member.nodeId);
    }
    for (const [groupId, group] of groups) {
      for (const nodeId of group.nodeIds) {
        flows.push({
          id: `dns:${groupId}:${nodeId}`,
          scope: 'public',
          kind: 'dns',
          label: `Serveur DNS « ${group.name} »`,
          detail: 'répond aux requêtes DNS publiques',
          sourceNodeIds: 'all',
          targetNodeId: nodeId,
          protocol: 'tcpudp',
          ports: ['53'],
        });
        const peers = group.nodeIds.filter((id) => id !== nodeId);
        if (peers.length > 0) {
          flows.push({
            id: `dnsxfr:${groupId}:${nodeId}`,
            scope: 'mesh',
            kind: 'dns',
            label: `Synchronisation DNS « ${group.name} »`,
            detail: 'transferts et notifications de zones entre serveurs du groupe',
            sourceNodeIds: peers,
            targetNodeId: nodeId,
            protocol: 'tcpudp',
            ports: ['53'],
          });
        }
      }
    }
    if (workspace.internalDnsNodeId && byId.has(workspace.internalDnsNodeId)) {
      flows.push({
        id: `idns:${workspace.internalDnsNodeId}`,
        scope: 'mesh',
        kind: 'dns',
        label: 'DNS interne',
        detail: 'résolution des noms *.tarmac.local par tous les serveurs',
        sourceNodeIds: 'all',
        targetNodeId: workspace.internalDnsNodeId,
        protocol: 'tcpudp',
        ports: [String(INTERNAL_DNS_PORT)],
      });
    }

    for (const mount of mounts) {
      if (!mount.nodeId) continue;
      if (mount.fsType.startsWith('nfs')) {
        const servers = new Set(
          [mount.sourcePath, ...mount.additionalSources]
            .map((source) => resolveHost(hostOf(source)))
            .filter((id): id is string => Boolean(id) && id !== mount.nodeId),
        );
        for (const serverId of servers) {
          flows.push({
            id: `nfs:${mount.id}:${serverId}`,
            scope: 'mesh',
            kind: 'nfs',
            label: `Montage « ${mount.name} »`,
            detail: `partage NFS lu par ${nameOf(mount.nodeId)}`,
            sourceNodeIds: [mount.nodeId],
            targetNodeId: serverId,
            protocol: 'tcpudp',
            ports: ['111', '2049'],
          });
        }
      }
      const sftpServer = resolveHost(mount.remoteHost);
      if (sftpServer && sftpServer !== mount.nodeId) {
        flows.push({
          id: `sftp:${mount.id}`,
          scope: 'mesh',
          kind: 'ssh',
          label: `Montage « ${mount.name} »`,
          detail: `accès SFTP depuis ${nameOf(mount.nodeId)}`,
          sourceNodeIds: [mount.nodeId],
          targetNodeId: sftpServer,
          protocol: 'tcp',
          ports: [String(mount.remoteSshPort ?? 22)],
        });
      }
    }
    for (const job of syncJobs) {
      const serverId = resolveHost(job.sourceHost);
      if (!job.nodeId || !serverId || serverId === job.nodeId) continue;
      flows.push({
        id: `sync:${job.id}`,
        scope: 'mesh',
        kind: 'ssh',
        label: `Synchronisation « ${job.name} »`,
        detail: `${nameOf(job.nodeId)} récupère les fichiers par SSH`,
        sourceNodeIds: [job.nodeId],
        targetNodeId: serverId,
        protocol: 'tcp',
        ports: [String(job.sourceSshPort ?? 22)],
      });
    }
    for (const migration of migrations) {
      if (!migration.sourceNodeId || !migration.targetNodeId || migration.sourceNodeId === migration.targetNodeId) continue;
      flows.push({
        id: `mig:${migration.id}`,
        scope: 'mesh',
        kind: 'ssh',
        label: `Migration « ${migration.name} »`,
        detail: `${nameOf(migration.targetNodeId)} copie les données par SSH`,
        sourceNodeIds: [migration.targetNodeId],
        targetNodeId: migration.sourceNodeId,
        protocol: 'tcp',
        ports: ['22'],
      });
    }
    return flows;
  }

  // ---------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------

  async overview(scope: WorkspaceScope) {
    const workspaceId = scope.workspaceId as string;
    const { workspace, nodes, rules, lists, ctx } = await this.cachedContext(workspaceId);
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const eventTotals = await this.prisma.firewallEvent.groupBy({
      by: ['verdict', 'nodeId'],
      where: { workspaceId, lastSeenAt: { gte: since } },
      _sum: { count: true },
    });
    // Flows someone marked as seen no longer count as "to review".
    const dismissals = await this.dismissals(workspaceId);
    const dismissedObserved =
      dismissals.length === 0
        ? 0
        : ((
            await this.prisma.firewallEvent.aggregate({
              where: { workspaceId, verdict: 'observed', lastSeenAt: { gte: since }, OR: dismissals },
              _sum: { count: true },
            })
          )._sum.count ?? 0);
    const blockedByNode = new Map<string, number>();
    let blocked24h = 0;
    let observed24h = -dismissedObserved;
    for (const row of eventTotals) {
      const count = row._sum.count ?? 0;
      if (row.verdict === 'blocked') {
        blocked24h += count;
        blockedByNode.set(row.nodeId, (blockedByNode.get(row.nodeId) ?? 0) + count);
      } else observed24h += count;
    }

    const nodeRows = nodes.map((node) => {
      const report = node.firewallReport as StoredReport | null;
      const payload = buildAgentPayload(ctx, node.id, '');
      const wanted = !payloadIsEmpty(payload);
      const listening = (report?.listening ?? []).map((entry) => ({
        ...entry,
        service: serviceName(entry.port),
        exposure: publicExposure(ctx, node.id, entry),
        exposureIfEnforced: publicExposure(ctx, node.id, entry, 'enforce'),
        managedBy: managedBy(ctx, node.id, entry),
      }));
      return {
        id: node.id,
        name: node.name,
        status: node.status,
        vlanIp: node.vlanIp,
        labels: node.labels,
        locationCountryCode: node.locationCountryCode,
        locationCity: node.locationCity,
        publicMode: node.firewallPublicMode as FwMode,
        apply: this.applyState(node, wanted),
        // "unsupported": the agent's last report doesn't list the limiter.
        sshLimit: !ctx.sshLimit ? 'off' : report?.features?.includes(SSH_LIMIT_ID) ? 'on' : report ? 'unsupported' : 'unknown',
        blocked24h: blockedByNode.get(node.id) ?? 0,
        report: report
          ? { uplinks: report.uplinks, docker: report.docker, logging: report.logging, reportedAt: report.reportedAt, listening }
          : null,
      };
    });

    const nodeNames = new Map(nodes.map((node) => [node.id, node.name]));
    return {
      settings: {
        meshMode: workspace.firewallMeshMode as FwMode,
        publicPing: workspace.firewallPublicPing,
        sshGuard: workspace.firewallSshGuard,
        sshLimit: workspace.firewallSshLimit,
        // Days of Activity kept, chosen in Settings.
        eventRetentionDays: workspace.firewallEventRetentionDays,
      },
      nodes: nodeRows,
      rules: rules.map((rule) => this.serializeRule(rule, nodeNames, ctx)),
      lists: lists.map((list) => ({
        id: list.id,
        name: list.name,
        description: list.description,
        cidrs: list.cidrs,
        usedBy: rules.filter((rule) => rule.sourceKind === 'lists' && rule.sourceListIds.includes(list.id)).map((rule) => rule.id),
        updatedAt: list.updatedAt.toISOString(),
      })),
      system: ctx.system.map((flow) => ({ ...flow, service: describeService(flow) })),
      matrix: meshMatrix(ctx),
      labels: [...new Set(nodes.flatMap((node) => node.labels))].sort((a, b) => a.localeCompare(b)),
      stats: {
        blocked24h,
        observed24h: Math.max(0, observed24h),
        rules: rules.filter((rule) => rule.enabled).length,
        protectedNodes: nodeRows.filter((node) => node.apply.status === 'active').length,
      },
    };
  }

  private applyState(
    node: {
      id: string;
      status: string;
      firewallAppliedRevision: Date | null;
      firewallApplyStatus: string | null;
      firewallApplyError: string | null;
    },
    wanted: boolean,
  ): { status: 'off' | 'pending' | 'active' | 'error' | 'outdated' | 'offline'; message: string | null } {
    if (!wanted && !node.firewallAppliedRevision) return { status: 'off', message: null };
    if (node.firewallApplyStatus === 'outdated') return { status: 'outdated', message: node.firewallApplyError };
    const sent = this.sentRevisions.get(node.id);
    const applied = node.firewallAppliedRevision?.toISOString();
    if (sent && (!applied || applied < sent)) {
      return node.status === 'offline'
        ? { status: 'offline', message: 'Le serveur est hors ligne : les règles seront appliquées dès son retour.' }
        : { status: 'pending', message: 'Application en cours sur le serveur…' };
    }
    if (node.firewallApplyStatus === 'error') return { status: 'error', message: node.firewallApplyError };
    if (!wanted) return { status: 'off', message: null };
    if (!applied) {
      return node.status === 'offline'
        ? { status: 'offline', message: 'Le serveur est hors ligne : les règles seront appliquées dès son retour.' }
        : { status: 'pending', message: 'Application en cours sur le serveur…' };
    }
    return { status: 'active', message: null };
  }

  private serializeRule(rule: FirewallRule, nodeNames: Map<string, string>, ctx: PolicyContext) {
    const now = new Date();
    return {
      id: rule.id,
      scope: rule.scope,
      action: rule.action,
      name: rule.name,
      description: rule.description,
      enabled: rule.enabled,
      expired: Boolean(rule.expiresAt && rule.expiresAt <= now),
      sourceKind: rule.sourceKind,
      sourceNodeIds: rule.sourceNodeIds.filter((id) => nodeNames.has(id)),
      sourceLabels: rule.sourceLabels,
      sourceCidrs: rule.sourceCidrs,
      sourceListIds: rule.sourceListIds.filter((id) => (ctx.lists ?? []).some((list) => list.id === id)),
      targetKind: rule.targetKind,
      targetNodeIds: rule.targetNodeIds.filter((id) => nodeNames.has(id)),
      targetLabels: rule.targetLabels,
      protocol: rule.protocol,
      ports: rule.ports,
      service: describeService({ protocol: rule.protocol as PolicyRule['protocol'], ports: rule.ports }),
      expiresAt: rule.expiresAt?.toISOString() ?? null,
      hitCount: rule.hitCount,
      lastHitAt: rule.lastHitAt?.toISOString() ?? null,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
      // A rule naming only nodes or labels that no longer match anything
      // does nothing: say so instead of looking active.
      inert:
        (rule.sourceKind === 'nodes' && rule.sourceNodeIds.every((id) => !nodeNames.has(id))) ||
        (rule.targetKind === 'nodes' && rule.targetNodeIds.every((id) => !nodeNames.has(id))) ||
        (rule.sourceKind === 'labels' && !ctx.nodes.some((node) => node.labels.some((label) => rule.sourceLabels.includes(label)))) ||
        (rule.targetKind === 'labels' && !ctx.nodes.some((node) => node.labels.some((label) => rule.targetLabels.includes(label)))),
    };
  }

  private async retentionHours(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { firewallEventRetentionDays: true } });
    return (workspace?.firewallEventRetentionDays ?? EVENT_RETENTION_DAYS) * 24;
  }

  async events(scope: WorkspaceScope, query: { hours?: string; scope?: string; verdict?: string; nodeId?: string }) {
    const workspaceId = scope.workspaceId as string;
    const hours = Math.min(Math.max(Number(query.hours) || 24, 1), await this.retentionHours(workspaceId));
    const rows = await this.prisma.firewallEvent.findMany({
      where: {
        workspaceId,
        lastSeenAt: { gte: new Date(Date.now() - hours * 3600 * 1000) },
        ...(query.scope === 'mesh' || query.scope === 'public' ? { scope: query.scope } : {}),
        ...(query.verdict === 'blocked' || query.verdict === 'observed' ? { verdict: query.verdict } : {}),
        ...(query.nodeId ? { nodeId: query.nodeId } : {}),
      },
      orderBy: { lastSeenAt: 'desc' },
      take: 500,
    });
    const dismissed = new Set((await this.dismissals(workspaceId)).map((entry) => `${entry.nodeId}|${entry.key}`));
    // Hourly rows of the same flow are merged into one line.
    const merged = new Map<string, (typeof rows)[number] & { buckets: number }>();
    for (const row of rows) {
      const key = `${row.nodeId}|${row.key}`;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { ...row, buckets: 1 });
        continue;
      }
      existing.count += row.count;
      existing.buckets += 1;
      if (row.firstSeenAt < existing.firstSeenAt) existing.firstSeenAt = row.firstSeenAt;
      existing.sources = [...new Set([...existing.sources, ...row.sources])].slice(0, 8);
    }
    return [...merged.values()].map((row) => ({
      id: row.id,
      nodeId: row.nodeId,
      scope: row.scope,
      verdict: row.verdict,
      sourceIp: row.sourceIp,
      sourceNodeId: row.sourceNodeId,
      sources: row.sources,
      protocol: row.protocol,
      port: row.port || null,
      service: row.port ? serviceName(row.port) : null,
      docker: row.docker,
      ruleId: row.ruleId,
      count: row.count,
      firstSeenAt: row.firstSeenAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      dismissed: dismissed.has(`${row.nodeId}|${row.key}`),
    }));
  }

  /** The Activity as flat rows (names resolved), for a CSV / JSON download. */
  async exportEvents(scope: WorkspaceScope, query: { hours?: string; scope?: string; verdict?: string; nodeId?: string }) {
    const workspaceId = scope.workspaceId as string;
    const [events, { nodes, rules }] = await Promise.all([this.events(scope, query), this.cachedContext(workspaceId)]);
    const nodeName = new Map(nodes.map((node) => [node.id, node.name]));
    const ruleName = new Map(rules.map((rule) => [rule.id, rule.name]));
    return events.map((event) => ({
      lastSeenAt: event.lastSeenAt,
      firstSeenAt: event.firstSeenAt,
      verdict: event.verdict === 'blocked' ? 'bloquée' : 'serait bloquée',
      zone: event.scope === 'mesh' ? 'entre serveurs' : 'internet',
      source: event.sourceNodeId ? (nodeName.get(event.sourceNodeId) ?? event.sourceIp) : event.sourceIp,
      sourceIp: event.sourceIp,
      otherSources: event.sources.filter((ip) => ip !== event.sourceIp).join(' '),
      target: nodeName.get(event.nodeId) ?? '',
      protocol: event.protocol,
      port: event.port ?? '',
      service: event.service ?? '',
      decision:
        event.ruleId === SSH_LIMIT_ID ? 'trop de tentatives SSH' : event.ruleId ? `règle « ${ruleName.get(event.ruleId) ?? event.ruleId} »` : event.verdict === 'blocked' ? 'aucune règle ne l’autorise' : 'mode observation',
      attempts: event.count,
      seen: event.dismissed ? 'oui' : 'non',
    }));
  }

  private dismissals(workspaceId: string) {
    return this.prisma.firewallDismissal.findMany({ where: { workspaceId }, select: { nodeId: true, key: true } });
  }

  /**
   * "Seen, nothing to do": hides this flow (same server, same signature)
   * from the review count and the Activity, for every hour to come.
   */
  async setDismissed(eventId: string, dismissed: boolean, actor: Actor) {
    const workspaceId = actor.scope.workspaceId as string;
    const event = await this.prisma.firewallEvent.findFirst({
      where: { id: eventId, workspaceId },
      select: { nodeId: true, key: true, sourceIp: true, protocol: true, port: true, node: { select: { name: true } } },
    });
    if (!event) throw new NotFoundException('Connexion introuvable');
    if (dismissed) {
      await this.prisma.firewallDismissal.upsert({
        where: { nodeId_key: { nodeId: event.nodeId, key: event.key } },
        create: { workspaceId, nodeId: event.nodeId, key: event.key, createdByUserId: actor.userId ?? null },
        update: {},
      });
    } else {
      await this.prisma.firewallDismissal.deleteMany({ where: { nodeId: event.nodeId, key: event.key } });
    }
    await this.audit(actor, dismissed ? 'firewall_event.dismiss' : 'firewall_event.restore', eventId, {
      nodeId: event.nodeId,
      name: `${event.sourceIp} → ${event.node.name}${event.port ? ` (${event.protocol}/${event.port})` : ''}`,
    });
    this.live.broadcast('firewall.changed', {}, workspaceId);
    return { success: true };
  }

  /** Attempts per hour and verdict, for the Activity chart. */
  async timeline(scope: WorkspaceScope, query: { hours?: string; scope?: string; nodeId?: string }) {
    const hours = Math.min(Math.max(Number(query.hours) || 24, 1), await this.retentionHours(scope.workspaceId as string));
    const rows = await this.prisma.firewallEvent.groupBy({
      by: ['bucketStart', 'verdict'],
      where: {
        workspaceId: scope.workspaceId as string,
        bucketStart: { gte: new Date(Math.floor((Date.now() - hours * 3600 * 1000) / 3_600_000) * 3_600_000) },
        ...(query.scope === 'mesh' || query.scope === 'public' ? { scope: query.scope } : {}),
        ...(query.nodeId ? { nodeId: query.nodeId } : {}),
      },
      _sum: { count: true },
      orderBy: { bucketStart: 'asc' },
    });
    return rows.map((row) => ({ bucketStart: row.bucketStart.toISOString(), verdict: row.verdict, count: row._sum.count ?? 0 }));
  }

  async test(scope: WorkspaceScope, dto: TestFirewallDto) {
    const workspaceId = scope.workspaceId as string;
    const { ctx } = await this.cachedContext(workspaceId);
    if (!ctx.nodes.some((node) => node.id === dto.targetNodeId)) throw new NotFoundException('Serveur introuvable');
    if (dto.scope === 'mesh' && (!dto.sourceNodeId || !ctx.nodes.some((node) => node.id === dto.sourceNodeId))) {
      throw new BadRequestException('Choisissez le serveur d’origine.');
    }
    if (dto.scope === 'public' && dto.sourceIp && !net.isIP(dto.sourceIp)) {
      throw new BadRequestException('Adresse IP d’origine invalide.');
    }
    if (dto.protocol !== 'icmp' && !dto.port) throw new BadRequestException('Indiquez un port.');
    const request = {
      scope: dto.scope,
      targetNodeId: dto.targetNodeId,
      sourceNodeId: dto.sourceNodeId,
      sourceIp: dto.scope === 'public' ? dto.sourceIp || '203.0.113.10' : undefined,
      protocol: dto.protocol,
      port: dto.port ?? null,
    } as const;
    const result = evaluate(ctx, request);
    const mode = dto.scope === 'mesh' ? ctx.meshMode : ctx.nodes.find((node) => node.id === dto.targetNodeId)!.publicMode;
    // "And once I switch to enforce?" - the question asked before doing it.
    const ifEnforced =
      mode === 'enforce'
        ? null
        : evaluate(
            dto.scope === 'mesh'
              ? { ...ctx, meshMode: 'enforce' }
              : { ...ctx, nodes: ctx.nodes.map((node) => (node.id === dto.targetNodeId ? { ...node, publicMode: 'enforce' as FwMode } : node)) },
            request,
          );
    return { ...result, mode, ifEnforced };
  }

  // ---------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------

  async updateSettings(dto: UpdateFirewallSettingsDto, actor: Actor) {
    const workspaceId = actor.scope.workspaceId as string;
    const before = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { firewallMeshMode: true, firewallPublicPing: true, firewallSshGuard: true, firewallSshLimit: true },
    });
    const data: Prisma.WorkspaceUpdateInput = {};
    if (dto.meshMode !== undefined) data.firewallMeshMode = dto.meshMode;
    if (dto.publicPing !== undefined) data.firewallPublicPing = dto.publicPing;
    if (dto.sshGuard !== undefined) data.firewallSshGuard = dto.sshGuard;
    if (dto.sshLimit !== undefined) data.firewallSshLimit = dto.sshLimit;
    await this.prisma.workspace.update({ where: { id: workspaceId }, data });
    await this.audit(actor, 'firewall.settings', workspaceId, {
      ...(dto.meshMode !== undefined && dto.meshMode !== before.firewallMeshMode
        ? { meshMode: { from: MODE_LABEL[before.firewallMeshMode as FwMode], to: MODE_LABEL[dto.meshMode] } }
        : {}),
      ...(dto.publicPing !== undefined ? { publicPing: dto.publicPing } : {}),
      ...(dto.sshGuard !== undefined ? { sshGuard: dto.sshGuard } : {}),
      ...(dto.sshLimit !== undefined ? { sshLimit: dto.sshLimit } : {}),
    });
    await this.changed(workspaceId);
    return this.overview(actor.scope);
  }

  async updateNodesMode(dto: BulkFirewallNodesDto, actor: Actor) {
    const workspaceId = actor.scope.workspaceId as string;
    const nodes = await this.prisma.node.findMany({
      where: { id: { in: dto.nodeIds }, workspaceId },
      select: { id: true, name: true, firewallPublicMode: true },
    });
    if (nodes.length === 0) throw new NotFoundException('Serveur introuvable');
    await this.prisma.node.updateMany({ where: { id: { in: nodes.map((node) => node.id) } }, data: { firewallPublicMode: dto.publicMode } });
    for (const node of nodes) {
      if (node.firewallPublicMode === dto.publicMode) continue;
      await this.audit(actor, 'firewall.node_mode', node.id, {
        node: node.name,
        from: MODE_LABEL[node.firewallPublicMode as FwMode],
        to: MODE_LABEL[dto.publicMode],
      });
    }
    await this.changed(workspaceId);
    return this.overview(actor.scope);
  }

  private async normalizeRule(
    input: CreateFirewallRuleDto | (UpdateFirewallRuleDto & { scope: string }),
    workspaceId: string,
    current?: FirewallRule,
  ) {
    const scope = input.scope as 'mesh' | 'public';
    const merged = {
      action: input.action ?? current?.action ?? 'allow',
      sourceKind: input.sourceKind ?? current?.sourceKind ?? 'any',
      sourceNodeIds: input.sourceNodeIds ?? current?.sourceNodeIds ?? [],
      sourceLabels: normalizeList(input.sourceLabels ?? current?.sourceLabels, 20),
      sourceCidrs: input.sourceCidrs ?? current?.sourceCidrs ?? [],
      sourceListIds: input.sourceListIds ?? current?.sourceListIds ?? [],
      targetKind: input.targetKind ?? current?.targetKind ?? 'any',
      targetNodeIds: input.targetNodeIds ?? current?.targetNodeIds ?? [],
      targetLabels: normalizeList(input.targetLabels ?? current?.targetLabels, 20),
      protocol: input.protocol ?? current?.protocol ?? 'tcp',
      ports: input.ports ?? current?.ports ?? [],
    };

    if (scope === 'mesh' && (merged.sourceKind === 'cidrs' || merged.sourceKind === 'lists')) {
      throw new BadRequestException('Entre serveurs, l’origine est un serveur ou une étiquette, pas une adresse IP.');
    }
    if (scope === 'public' && (merged.sourceKind === 'nodes' || merged.sourceKind === 'labels')) {
      throw new BadRequestException('Depuis Internet, l’origine est « tout Internet » ou une liste d’adresses IP.');
    }
    const ownIds = new Set(
      (
        await this.prisma.node.findMany({
          where: { workspaceId, id: { in: [...merged.sourceNodeIds, ...merged.targetNodeIds] } },
          select: { id: true },
        })
      ).map((node) => node.id),
    );
    merged.sourceNodeIds = [...new Set(merged.sourceNodeIds.filter((id) => ownIds.has(id)))];
    merged.targetNodeIds = [...new Set(merged.targetNodeIds.filter((id) => ownIds.has(id)))];
    if (merged.sourceKind !== 'nodes') merged.sourceNodeIds = [];
    if (merged.sourceKind !== 'labels') merged.sourceLabels = [];
    if (merged.sourceKind !== 'cidrs') merged.sourceCidrs = [];
    if (merged.sourceKind === 'lists') {
      const owned = await this.prisma.firewallAddressList.findMany({ where: { workspaceId, id: { in: merged.sourceListIds } }, select: { id: true } });
      merged.sourceListIds = [...new Set(merged.sourceListIds.filter((id) => owned.some((list) => list.id === id)))];
      if (merged.sourceListIds.length === 0) throw new BadRequestException('Choisissez au moins une liste d’adresses.');
    } else merged.sourceListIds = [];
    if (merged.targetKind !== 'nodes') merged.targetNodeIds = [];
    if (merged.targetKind !== 'labels') merged.targetLabels = [];
    if (merged.sourceKind === 'nodes' && merged.sourceNodeIds.length === 0) throw new BadRequestException('Choisissez au moins un serveur d’origine.');
    if (merged.sourceKind === 'labels' && merged.sourceLabels.length === 0) throw new BadRequestException('Choisissez au moins une étiquette d’origine.');
    if (merged.targetKind === 'nodes' && merged.targetNodeIds.length === 0) throw new BadRequestException('Choisissez au moins un serveur protégé.');
    if (merged.targetKind === 'labels' && merged.targetLabels.length === 0) throw new BadRequestException('Choisissez au moins une étiquette de destination.');
    if (merged.sourceKind === 'cidrs') {
      const cidrs: string[] = [];
      for (const raw of merged.sourceCidrs) {
        const cidr = normalizeCidr(raw);
        if (!cidr) throw new BadRequestException(`« ${raw} » n’est ni une adresse IP ni une plage valide (ex. 203.0.113.0/24).`);
        if (!cidrs.includes(cidr)) cidrs.push(cidr);
      }
      if (cidrs.length === 0) throw new BadRequestException('Indiquez au moins une adresse IP ou une plage.');
      merged.sourceCidrs = cidrs;
    }
    const ports = [...new Set(merged.ports.map((port) => port.trim()).filter(Boolean))];
    for (const port of ports) {
      if (!parsePortRange(port)) throw new BadRequestException(`Port invalide : « ${port} » (1 à 65535, ou une plage comme 8000-8100).`);
    }
    if (ports.length > 0 && !['tcp', 'udp', 'tcpudp'].includes(merged.protocol)) {
      throw new BadRequestException('Des ports ne s’indiquent qu’avec TCP ou UDP.');
    }
    merged.ports = merged.protocol === 'any' || merged.protocol === 'icmp' ? [] : ports;
    return merged;
  }

  async createRule(dto: CreateFirewallRuleDto, actor: Actor) {
    const workspaceId = actor.scope.workspaceId as string;
    const normalized = await this.normalizeRule(dto, workspaceId);
    const rule = await this.prisma.firewallRule.create({
      data: {
        workspaceId,
        scope: dto.scope,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        enabled: dto.enabled ?? true,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        createdByUserId: actor.userId,
        ...normalized,
      },
    });
    await this.audit(actor, 'firewall_rule.create', rule.id, this.auditDetails(rule));
    await this.changed(workspaceId);
    return rule;
  }

  async updateRule(id: string, dto: UpdateFirewallRuleDto, actor: Actor) {
    const workspaceId = actor.scope.workspaceId as string;
    const current = await this.findOwned(id, workspaceId);
    const normalized = await this.normalizeRule({ ...dto, scope: current.scope }, workspaceId, current);
    const rule = await this.prisma.firewallRule.update({
      where: { id },
      data: {
        ...normalized,
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.expiresAt !== undefined ? { expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null } : {}),
      },
    });
    await this.audit(actor, dto.enabled !== undefined && Object.keys(dto).length === 1 ? (dto.enabled ? 'firewall_rule.enable' : 'firewall_rule.disable') : 'firewall_rule.update', id, this.auditDetails(rule));
    await this.changed(workspaceId);
    return rule;
  }

  async removeRule(id: string, actor: Actor) {
    const workspaceId = actor.scope.workspaceId as string;
    const current = await this.findOwned(id, workspaceId);
    await this.prisma.firewallRule.delete({ where: { id } });
    await this.audit(actor, 'firewall_rule.delete', id, this.auditDetails(current));
    await this.changed(workspaceId);
    return { success: true };
  }

  // ---------------------------------------------------------------------
  // Address lists
  // ---------------------------------------------------------------------

  private normalizeCidrs(raw: string[]): string[] {
    const cidrs: string[] = [];
    for (const value of raw.map((entry) => entry.trim()).filter(Boolean)) {
      const cidr = normalizeCidr(value);
      if (!cidr) throw new BadRequestException(`« ${value} » n’est ni une adresse IP ni une plage valide (ex. 203.0.113.0/24).`);
      if (!cidrs.includes(cidr)) cidrs.push(cidr);
    }
    if (cidrs.length === 0) throw new BadRequestException('Indiquez au moins une adresse IP ou une plage.');
    return cidrs;
  }

  private async assertListNameFree(workspaceId: string, name: string, exceptId?: string) {
    const clash = await this.prisma.firewallAddressList.findFirst({
      where: { workspaceId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new ConflictException(`Une liste « ${name} » existe déjà.`);
  }

  async createList(dto: FirewallAddressListDto, actor: Actor) {
    const workspaceId = actor.scope.workspaceId as string;
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Donnez un nom à la liste.');
    await this.assertListNameFree(workspaceId, name);
    const list = await this.prisma.firewallAddressList.create({
      data: { workspaceId, name, description: dto.description?.trim() || null, cidrs: this.normalizeCidrs(dto.cidrs) },
    });
    await this.audit(actor, 'firewall_list.create', list.id, { name: list.name, count: list.cidrs.length });
    await this.changed(workspaceId);
    return list;
  }

  async updateList(id: string, dto: UpdateFirewallAddressListDto, actor: Actor) {
    const workspaceId = actor.scope.workspaceId as string;
    const current = await this.prisma.firewallAddressList.findFirst({ where: { id, workspaceId } });
    if (!current) throw new NotFoundException('Liste introuvable');
    const name = dto.name?.trim();
    if (dto.name !== undefined && !name) throw new BadRequestException('Donnez un nom à la liste.');
    if (name && name !== current.name) await this.assertListNameFree(workspaceId, name, id);
    const list = await this.prisma.firewallAddressList.update({
      where: { id },
      data: {
        ...(name ? { name } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        ...(dto.cidrs !== undefined ? { cidrs: this.normalizeCidrs(dto.cidrs) } : {}),
      },
    });
    await this.audit(actor, 'firewall_list.update', id, { name: list.name, count: list.cidrs.length });
    // Every rule using it is re-applied with the new addresses.
    await this.changed(workspaceId);
    return list;
  }

  async removeList(id: string, actor: Actor) {
    const workspaceId = actor.scope.workspaceId as string;
    const current = await this.prisma.firewallAddressList.findFirst({ where: { id, workspaceId } });
    if (!current) throw new NotFoundException('Liste introuvable');
    const users = await this.prisma.firewallRule.findMany({
      where: { workspaceId, sourceKind: 'lists', sourceListIds: { has: id } },
      select: { name: true },
    });
    if (users.length > 0) {
      const names = users.slice(0, 3).map((rule) => `« ${rule.name} »`).join(', ');
      throw new ConflictException(
        `Cette liste est utilisée par ${users.length === 1 ? 'la règle' : `${users.length} règles :`} ${names}${users.length > 3 ? '…' : ''}. Changez leur origine avant de la supprimer.`,
      );
    }
    await this.prisma.firewallAddressList.delete({ where: { id } });
    await this.audit(actor, 'firewall_list.delete', id, { name: current.name });
    await this.changed(workspaceId);
    return { success: true };
  }

  private auditDetails(rule: FirewallRule) {
    return {
      name: rule.name,
      scope: rule.scope === 'mesh' ? 'entre serveurs' : 'depuis Internet',
      action: rule.action === 'deny' ? 'bloquer' : 'autoriser',
      service: describeService({ protocol: rule.protocol as PolicyRule['protocol'], ports: rule.ports }),
    };
  }

  private async findOwned(id: string, workspaceId: string) {
    const rule = await this.prisma.firewallRule.findFirst({ where: { id, workspaceId } });
    if (!rule) throw new NotFoundException('Règle introuvable');
    return rule;
  }

  private async changed(workspaceId: string) {
    this.invalidate(workspaceId);
    await this.reconcileWorkspace(workspaceId);
    this.live.broadcast('firewall.changed', {}, workspaceId);
  }

  private async audit(actor: Actor, action: string, resourceId: string, details: Record<string, unknown>) {
    await this.auditLogsService.log({
      workspaceId: actor.scope.workspaceId as string,
      actorUserId: actor.userId,
      action,
      resourceType: 'firewall',
      resourceId,
      details: details as Prisma.InputJsonValue,
    });
  }

  // ---------------------------------------------------------------------
  // Apply
  // ---------------------------------------------------------------------

  /** Coalesced like VpnService.reconcileWorkspace: a burst of edits sends one apply. */
  reconcileWorkspace(workspaceId: string, onlyNodeId?: string): Promise<void> {
    if (onlyNodeId) return this.pushWorkspace(workspaceId, onlyNodeId);
    return new Promise<void>((resolve, reject) => {
      const now = Date.now();
      const pending = this.pendingReconciles.get(workspaceId);
      if (pending) clearTimeout(pending.timer);
      const entry = pending ?? { firstAt: now, timer: undefined as unknown as NodeJS.Timeout, waiters: [] };
      entry.waiters.push({ resolve, reject });
      const delay = Math.max(0, Math.min(RECONCILE_QUIET_MS, entry.firstAt + RECONCILE_MAX_WAIT_MS - now));
      entry.timer = setTimeout(() => {
        this.pendingReconciles.delete(workspaceId);
        this.pushWorkspace(workspaceId).then(
          () => entry.waiters.forEach((waiter) => waiter.resolve()),
          (error) => entry.waiters.forEach((waiter) => waiter.reject(error)),
        );
      }, delay);
      this.pendingReconciles.set(workspaceId, entry);
    });
  }

  private async pushWorkspace(workspaceId: string, onlyNodeId?: string) {
    const { nodes, ctx } = await this.loadContext(workspaceId);
    const revision = new Date().toISOString();
    for (const node of nodes) {
      if (onlyNodeId && node.id !== onlyNodeId) continue;
      const payload = buildAgentPayload(ctx, node.id, revision);
      // Nothing to enforce and nothing ever enforced: no command at all, so
      // agents predating the firewall never hear about it.
      if (payloadIsEmpty(payload) && !node.firewallAppliedRevision) {
        this.sentRevisions.delete(node.id);
        continue;
      }
      if (node.firewallApplyStatus === 'outdated' && !onlyNodeId) {
        // Until it is updated (which reconnects it, see onAgentConnected),
        // an old agent would only answer "unknown command" again.
        continue;
      }
      // Offline nodes keep the revision as "to apply": they get it when they
      // reconnect (onAgentConnected), and the dashboard says so meanwhile.
      this.agentsService.sendCommand(node.id, { type: 'command.apply_firewall', payload: payload as unknown as Record<string, unknown> });
      this.sentRevisions.set(node.id, revision);
    }
  }

  async onAgentConnected(nodeId: string) {
    try {
      const node = await this.prisma.node.findUnique({ where: { id: nodeId }, select: { workspaceId: true, firewallApplyStatus: true } });
      if (!node) return;
      if (node.firewallApplyStatus === 'outdated') {
        await this.prisma.node.update({ where: { id: nodeId }, data: { firewallApplyStatus: null, firewallApplyError: null } });
      }
      await this.reconcileWorkspace(node.workspaceId, nodeId);
    } catch (error) {
      this.logger.warn(`Firewall reconcile on connect failed for ${nodeId}: ${error instanceof Error ? error.message : error}`);
    }
  }

  async onApplyResult(
    nodeId: string,
    workspaceId: string,
    result: { revision: string; success: boolean; message?: string; active?: boolean; outdated?: boolean },
  ) {
    const revision = new Date(result.revision);
    if (Number.isNaN(revision.getTime())) return;
    const node = await this.prisma.node.findUnique({ where: { id: nodeId }, select: { workspaceId: true, firewallAppliedRevision: true } });
    if (!node || node.workspaceId !== workspaceId) return;
    if (node.firewallAppliedRevision && node.firewallAppliedRevision > revision) return;
    const cleared = result.success && result.active === false;
    await this.prisma.node.update({
      where: { id: nodeId },
      data: result.outdated
        ? {
            firewallApplyStatus: 'outdated',
            firewallApplyError: "L'agent de ce serveur est trop ancien pour le pare-feu : mettez-le à jour depuis la page Nœuds.",
          }
        : cleared
          ? { firewallAppliedRevision: null, firewallApplyStatus: null, firewallApplyError: null }
          : {
              firewallAppliedRevision: revision,
              firewallApplyStatus: result.success ? 'active' : 'error',
              firewallApplyError: result.success ? null : (result.message ?? 'Erreur inconnue').slice(0, 700),
            },
    });
    if (result.outdated || cleared) this.sentRevisions.delete(nodeId);
    this.invalidate(workspaceId);
    this.live.broadcast('firewall.changed', { nodeId }, workspaceId);
  }

  // ---------------------------------------------------------------------
  // Agent reports
  // ---------------------------------------------------------------------

  async ingestReport(nodeId: string, workspaceId: string, report: FirewallReport) {
    if (report.full) {
      await this.prisma.node.update({ where: { id: nodeId }, data: { firewallReport: sanitizeReport(report) as unknown as Prisma.InputJsonValue } });
      this.invalidate(workspaceId);
      if (report.counters && typeof report.counters === 'object') await this.ingestCounters(nodeId, workspaceId, report.counters);
    }
    if (Array.isArray(report.events) && report.events.length > 0) await this.ingestEvents(nodeId, workspaceId, report.events.slice(0, 400));
  }

  private async ingestCounters(nodeId: string, workspaceId: string, counters: Record<string, number>) {
    const previous = this.lastCounters.get(nodeId) ?? {};
    this.lastCounters.set(nodeId, counters);
    const deltas: Array<[string, number]> = [];
    for (const [id, raw] of Object.entries(counters)) {
      const value = Number(raw);
      if (!Number.isFinite(value) || id === 'default' || id === SSH_LIMIT_ID || id.startsWith('sys:')) continue;
      const before = previous[id];
      // Counters restart from zero on every apply.
      const delta = before === undefined ? 0 : value >= before ? value - before : value;
      if (delta > 0) deltas.push([id, delta]);
    }
    if (deltas.length === 0) return;
    const now = new Date();
    await this.prisma.$transaction(
      deltas.map(([id, delta]) =>
        this.prisma.firewallRule.updateMany({ where: { id, workspaceId }, data: { hitCount: { increment: delta }, lastHitAt: now } }),
      ),
    );
  }

  private async ingestEvents(nodeId: string, workspaceId: string, events: NonNullable<FirewallReport['events']>) {
    const meshNodes = await this.prisma.node.findMany({ where: { workspaceId, vlanIp: { not: null } }, select: { id: true, vlanIp: true } });
    const byIp = new Map(meshNodes.map((node) => [node.vlanIp as string, node.id]));
    const ruleIds = new Set(
      (await this.prisma.firewallRule.findMany({ where: { workspaceId }, select: { id: true } })).map((rule) => rule.id),
    );
    let recorded = 0;
    for (const event of events) {
      if (typeof event.source !== 'string' || !net.isIP(event.source)) continue;
      const verdict = event.verdict === 'observed' ? 'observed' : 'blocked';
      const scope = event.interface === MESH_INTERFACE ? 'mesh' : 'public';
      const protocol = ['tcp', 'udp', 'icmp'].includes(event.protocol) ? event.protocol : 'autre';
      const port = Number.isInteger(event.port) && event.port! > 0 && event.port! < 65536 ? event.port! : 0;
      const count = Math.max(1, Math.min(Number(event.count) || 1, 1_000_000));
      const last = new Date((Number(event.lastSeen) || Date.now() / 1000) * 1000);
      const first = new Date((Number(event.firstSeen) || Number(event.lastSeen) || Date.now() / 1000) * 1000);
      const bucketStart = new Date(Math.floor(last.getTime() / 3_600_000) * 3_600_000);
      const ruleId = event.ruleId && (ruleIds.has(event.ruleId) || event.ruleId === SSH_LIMIT_ID) ? event.ruleId : null;
      // Mesh: one row per source. Internet: one row per port, sources sampled.
      const key = [verdict, scope, protocol, port, event.docker ? 'd' : '', ruleId ?? '', scope === 'mesh' ? event.source : ''].join('|');
      const where = { nodeId_key_bucketStart: { nodeId, key, bucketStart } };
      try {
        const existing = await this.prisma.firewallEvent.findUnique({ where, select: { sources: true } });
        if (existing) {
          await this.prisma.firewallEvent.update({
            where,
            data: {
              count: { increment: count },
              lastSeenAt: last,
              sourceIp: event.source,
              sources: existing.sources.includes(event.source) ? undefined : [...existing.sources, event.source].slice(-8),
            },
          });
        } else {
          await this.prisma.firewallEvent.create({
            data: {
              workspaceId,
              nodeId,
              scope,
              verdict,
              key,
              sourceIp: event.source,
              sourceNodeId: scope === 'mesh' ? (byIp.get(event.source) ?? null) : null,
              sources: [event.source],
              protocol,
              port,
              docker: Boolean(event.docker),
              ruleId,
              count,
              bucketStart,
              firstSeenAt: first,
              lastSeenAt: last,
            },
          });
        }
        recorded++;
      } catch (error) {
        // Two heartbeats racing on a brand new row: the next one merges.
        this.logger.debug(`Firewall event not stored for ${nodeId}: ${error instanceof Error ? error.message : error}`);
      }
    }
    if (recorded > 0) this.live.broadcast('firewall.events', { nodeId, count: recorded }, workspaceId);
  }

  // ---------------------------------------------------------------------
  // Housekeeping
  // ---------------------------------------------------------------------

  @Cron(CronExpression.EVERY_MINUTE)
  async expireRules() {
    const expired = await this.prisma.firewallRule.findMany({
      where: { enabled: true, expiresAt: { lte: new Date() } },
      select: { id: true, workspaceId: true, name: true },
    });
    if (expired.length === 0) return;
    await this.prisma.firewallRule.updateMany({ where: { id: { in: expired.map((rule) => rule.id) } }, data: { enabled: false } });
    for (const rule of expired) {
      await this.auditLogsService.log({
        workspaceId: rule.workspaceId,
        action: 'firewall_rule.expire',
        resourceType: 'firewall',
        resourceId: rule.id,
        details: { name: rule.name },
      });
    }
    for (const workspaceId of new Set(expired.map((rule) => rule.workspaceId))) await this.changed(workspaceId);
  }

  // Safety net on top of event-driven pushes (and what picks up a Docker
  // started after the last apply): re-sends the desired state everywhere.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcileAll() {
    const workspaces = await this.prisma.workspace.findMany({
      where: {
        OR: [
          { firewallMeshMode: { not: 'open' } },
          { firewallRules: { some: {} } },
          { nodes: { some: { OR: [{ firewallPublicMode: { not: 'open' } }, { firewallAppliedRevision: { not: null } }] } } },
        ],
      },
      select: { id: true },
    });
    for (const workspace of workspaces) {
      try {
        await this.reconcileWorkspace(workspace.id);
      } catch (error) {
        this.logger.warn(`Firewall reconcile failed for workspace ${workspace.id}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  // Each workspace keeps its Activity as long as it chose (Settings).
  @Cron(CronExpression.EVERY_HOUR)
  async pruneEvents() {
    const workspaces = await this.prisma.workspace.findMany({ select: { id: true, firewallEventRetentionDays: true } });
    const byDays = new Map<number, string[]>();
    for (const workspace of workspaces) byDays.set(workspace.firewallEventRetentionDays, [...(byDays.get(workspace.firewallEventRetentionDays) ?? []), workspace.id]);
    for (const [days, ids] of byDays) {
      await this.prisma.firewallEvent.deleteMany({ where: { workspaceId: { in: ids }, lastSeenAt: { lt: new Date(Date.now() - days * 86400 * 1000) } } });
    }
  }
}
