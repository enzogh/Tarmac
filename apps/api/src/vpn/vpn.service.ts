import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Node, Prisma, VpnProfile } from '@prisma/client';
import { AgentsService } from '../agents/agents.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { WorkspaceScope } from '../auth/workspace.guard';
import { LiveWsServer } from '../live/live.ws';
import { extractExternalIp } from '../nodes/extract-external-ip';
import { PrismaService } from '../prisma/prisma.service';
import { VlanService } from '../vlan/vlan.service';
import { CreateVpnProfileDto } from './dto/create-vpn-profile.dto';
import { RotateVpnKeysDto } from './dto/rotate-keys.dto';
import { UpdateVpnProfileDto } from './dto/update-vpn-profile.dto';
import { configFilename, renderClientConfig } from './vpn-config';
import { generateWireguardKeyPair, generateWireguardPresharedKey } from './vpn-keys';
import {
  assignRoutingTables,
  clientSubnet,
  entryGatewayCidr,
  MAX_ENTRY_SUBNETS,
  pickFreeClientIp,
  tunnelName,
  VPN_DEFAULT_DNS,
  VPN_INTERFACE,
  VPN_LISTEN_PORT,
} from './vpn-network';

// WireGuard re-handshakes every 2 minutes while traffic flows, so a peer
// whose last handshake is older than this has gone quiet.
const SESSION_ACTIVE_WINDOW_MS = 3 * 60 * 1000;
// Byte counters change on every heartbeat (5s) while a client is connected;
// the live socket carries them in real time, the database only needs a
// recent copy.
const SESSION_STATS_WRITE_INTERVAL_MS = 30_000;
const UNIQUE_RETRIES = 5;

const NODE_REF_SELECT = {
  id: true,
  name: true,
  status: true,
  vlanIp: true,
  overlayEndpoint: true,
  overlayPublicKey: true,
  locationCity: true,
  locationCountry: true,
  locationCountryCode: true,
  vpnSubnetIndex: true,
  vpnAppliedRevision: true,
  vpnApplyStatus: true,
  vpnApplyError: true,
} satisfies Prisma.NodeSelect;

type NodeRefRow = Prisma.NodeGetPayload<{ select: typeof NODE_REF_SELECT }>;
type ProfileWithNodes = VpnProfile & { entryNode: NodeRefRow; exitNode: NodeRefRow | null };

export type VpnPeerStat = {
  publicKey: string;
  endpoint?: string;
  latestHandshake?: number;
  rxBytes?: number;
  txBytes?: number;
};

type ApplyTunnel = { name: string; localIp: string; remoteIp: string; table: number; returnSubnets: string[] };
type ApplyPayload = {
  revision: string;
  meshInterface: string;
  meshCidr: string;
  entry: {
    interfaceName: string;
    listenPort: number;
    addressCidr: string;
    clientSubnet: string;
    clients: Array<{ publicKey: string; presharedKey: string; ip: string; table: number }>;
  } | null;
  tunnels: ApplyTunnel[];
  natSubnets: string[];
};

type Actor = { userId?: string; scope: WorkspaceScope };

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class VpnService {
  private readonly logger = new Logger(VpnService.name);
  private readonly statsWrittenAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly vlanService: VlanService,
    private readonly auditLogsService: AuditLogsService,
    private readonly live: LiveWsServer,
    @Inject(forwardRef(() => AgentsService))
    private readonly agentsService: AgentsService,
  ) {}

  // ---------------------------------------------------------------------
  // Profiles
  // ---------------------------------------------------------------------

  async list(scope: WorkspaceScope) {
    const profiles = await this.prisma.vpnProfile.findMany({
      where: { workspaceId: scope.workspaceId },
      include: { entryNode: { select: NODE_REF_SELECT }, exitNode: { select: NODE_REF_SELECT } },
      orderBy: { createdAt: 'desc' },
    });
    return profiles.map((profile) => this.serialize(profile));
  }

  async get(id: string, scope: WorkspaceScope) {
    return this.serialize(await this.findOwned(id, scope));
  }

  async create(dto: CreateVpnProfileDto, actor: Actor) {
    const workspaceId = actor.scope.workspaceId as string;
    const mode = dto.mode ?? 'full';
    const entryNode = await this.assertEntryNode(dto.entryNodeId, workspaceId);
    const exitNodeId = await this.normalizeExit(dto.exitNodeId, entryNode.id, workspaceId);
    const expiresAt = this.parseFutureDate(dto.expiresAt);
    const keys = dto.publicKey ? { publicKey: dto.publicKey, privateKey: null } : generateWireguardKeyPair();
    await this.assertPublicKeyFree(keys.publicKey);

    const meshCidr = await this.vlanService.getVlanSubnet(workspaceId);
    const subnetIndex = await this.ensureEntrySubnet(entryNode.id, workspaceId);

    let created: VpnProfile | null = null;
    for (let attempt = 0; attempt < UNIQUE_RETRIES && !created; attempt++) {
      const clientIp = await this.allocateClientIp(entryNode.id, meshCidr, subnetIndex);
      try {
        created = await this.prisma.vpnProfile.create({
          data: {
            workspaceId,
            name: dto.name.trim(),
            description: dto.description?.trim() || null,
            mode,
            entryNodeId: entryNode.id,
            exitNodeId,
            clientIp,
            clientPublicKey: keys.publicKey,
            clientPrivateKey: keys.privateKey,
            presharedKey: generateWireguardPresharedKey(),
            dns: dto.dns ?? (mode === 'full' ? VPN_DEFAULT_DNS : []),
            expiresAt,
            createdByUserId: actor.userId ?? null,
            createdByApiKeyId: actor.scope.apiKey?.id ?? null,
          },
        });
      } catch (error) {
        // Two profiles racing for the same free address on this entry node.
        if (!isUniqueConstraintError(error)) throw error;
      }
    }
    if (!created) throw new ConflictException("Impossible d'attribuer une adresse au client, réessayez.");

    await this.audit(actor, 'vpn_profile.create', created.id, {
      name: created.name,
      mode,
      entryNodeId: entryNode.id,
      exitNodeId,
      clientIp: created.clientIp,
    });
    await this.reconcileWorkspace(workspaceId);
    this.broadcastChanged(workspaceId, created.id);

    const profile = await this.findOwned(created.id, actor.scope);
    return { ...this.serialize(profile), config: await this.buildConfig(profile) };
  }

  async update(id: string, dto: UpdateVpnProfileDto, actor: Actor) {
    const existing = await this.findOwned(id, actor.scope);
    const workspaceId = existing.workspaceId;
    const data: Prisma.VpnProfileUncheckedUpdateInput = {};
    let routingChanged = false;

    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (dto.dns !== undefined) data.dns = dto.dns;
    if (dto.expiresAt !== undefined) {
      data.expiresAt = dto.expiresAt === null ? null : this.parseFutureDate(dto.expiresAt);
      routingChanged = true;
    }
    if (dto.mode !== undefined && dto.mode !== existing.mode) {
      data.mode = dto.mode;
      routingChanged = true;
    }
    if (dto.enabled !== undefined && dto.enabled !== existing.enabled) {
      data.enabled = dto.enabled;
      routingChanged = true;
    }

    let entryNodeId = existing.entryNodeId;
    if (dto.entryNodeId !== undefined && dto.entryNodeId !== existing.entryNodeId) {
      const entryNode = await this.assertEntryNode(dto.entryNodeId, workspaceId);
      const meshCidr = await this.vlanService.getVlanSubnet(workspaceId);
      const subnetIndex = await this.ensureEntrySubnet(entryNode.id, workspaceId);
      entryNodeId = entryNode.id;
      data.entryNodeId = entryNode.id;
      data.clientIp = await this.allocateClientIp(entryNode.id, meshCidr, subnetIndex);
      data.lastHandshakeAt = null;
      data.clientEndpoint = null;
      data.rxBytes = 0;
      data.txBytes = 0;
      routingChanged = true;
    }

    if (dto.exitNodeId !== undefined || data.entryNodeId !== undefined) {
      const requestedExit = dto.exitNodeId !== undefined ? dto.exitNodeId : existing.exitNodeId;
      const exitNodeId = await this.normalizeExit(requestedExit, entryNodeId, workspaceId);
      if (exitNodeId !== existing.exitNodeId) {
        data.exitNodeId = exitNodeId;
        data.exitSwitchedAt = new Date();
        routingChanged = true;
      }
    }

    if (routingChanged) data.configChangedAt = new Date();
    if (Object.keys(data).length === 0) return this.serialize(existing);

    try {
      await this.prisma.vpnProfile.update({ where: { id }, data });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictException('Adresse client déjà prise, réessayez.');
      throw error;
    }

    await this.audit(actor, 'vpn_profile.update', id, { changes: Object.keys(data) });
    if (routingChanged) await this.reconcileWorkspace(workspaceId);
    this.broadcastChanged(workspaceId, id);
    return this.serialize(await this.findOwned(id, actor.scope));
  }

  // The one-click exit switch. Only routing on the nodes changes: the
  // client's tunnel stays up and its next packets leave through the new
  // exit (already-open connections are reset, their old NAT state being
  // tied to the previous public IP).
  async switchExit(id: string, exitNodeId: string | null | undefined, actor: Actor) {
    const existing = await this.findOwned(id, actor.scope);
    if (existing.mode !== 'full') {
      throw new BadRequestException(
        "Ce profil n'achemine que le réseau privé : il n'a pas de nœud de sortie Internet à changer.",
      );
    }
    const normalized = await this.normalizeExit(exitNodeId ?? null, existing.entryNodeId, existing.workspaceId);
    if (normalized === existing.exitNodeId) return this.serialize(existing);

    const now = new Date();
    await this.prisma.vpnProfile.update({
      where: { id },
      data: { exitNodeId: normalized, exitSwitchedAt: now, configChangedAt: now },
    });
    await this.audit(actor, 'vpn_profile.switch_exit', id, {
      from: existing.exitNodeId ?? existing.entryNodeId,
      to: normalized ?? existing.entryNodeId,
    });
    await this.reconcileWorkspace(existing.workspaceId);
    this.broadcastChanged(existing.workspaceId, id);
    return this.serialize(await this.findOwned(id, actor.scope));
  }

  // Invalidates the current config (lost device, leaked file): new key pair
  // and preshared key, same address and routing.
  async rotateKeys(id: string, dto: RotateVpnKeysDto, actor: Actor) {
    const existing = await this.findOwned(id, actor.scope);
    const keys = dto.publicKey ? { publicKey: dto.publicKey, privateKey: null } : generateWireguardKeyPair();
    await this.assertPublicKeyFree(keys.publicKey, id);
    await this.prisma.vpnProfile.update({
      where: { id },
      data: {
        clientPublicKey: keys.publicKey,
        clientPrivateKey: keys.privateKey,
        presharedKey: generateWireguardPresharedKey(),
        configChangedAt: new Date(),
        lastHandshakeAt: null,
        clientEndpoint: null,
        rxBytes: 0,
        txBytes: 0,
      },
    });
    await this.audit(actor, 'vpn_profile.rotate_keys', id, { name: existing.name });
    await this.reconcileWorkspace(existing.workspaceId);
    this.broadcastChanged(existing.workspaceId, id);
    const profile = await this.findOwned(id, actor.scope);
    return { ...this.serialize(profile), config: await this.buildConfig(profile) };
  }

  async remove(id: string, actor: Actor) {
    const existing = await this.findOwned(id, actor.scope);
    await this.prisma.vpnProfile.delete({ where: { id } });
    await this.audit(actor, 'vpn_profile.delete', id, { name: existing.name, clientIp: existing.clientIp });
    await this.reconcileWorkspace(existing.workspaceId);
    this.broadcastChanged(existing.workspaceId, id);
    return { success: true };
  }

  async getConfig(id: string, scope: WorkspaceScope) {
    const profile = await this.findOwned(id, scope);
    return {
      filename: configFilename(profile.name),
      config: await this.buildConfig(profile),
      complete: profile.clientPrivateKey !== null,
    };
  }

  // ---------------------------------------------------------------------
  // Gateways (which nodes can serve as entry / exit, and what they carry)
  // ---------------------------------------------------------------------

  async listGateways(scope: WorkspaceScope) {
    const workspaceId = scope.workspaceId as string;
    const [nodes, profiles, meshCidr] = await Promise.all([
      this.prisma.node.findMany({ where: { workspaceId }, select: NODE_REF_SELECT, orderBy: { name: 'asc' } }),
      this.prisma.vpnProfile.findMany({
        where: { workspaceId },
        select: { entryNodeId: true, exitNodeId: true, mode: true, enabled: true, expiresAt: true, lastHandshakeAt: true },
      }),
      this.vlanService.getVlanSubnet(workspaceId),
    ]);
    const now = Date.now();
    return nodes.map((node) => {
      const asEntry = profiles.filter((p) => p.entryNodeId === node.id);
      const asExit = profiles.filter(
        (p) => p.mode === 'full' && (p.exitNodeId ?? p.entryNodeId) === node.id && this.isLive(p, now),
      );
      return {
        ...this.nodeRef(node),
        vlanIp: node.vlanIp,
        entryEligibility: this.entryIneligibility(node),
        exitEligibility: this.exitIneligibility(node),
        clientSubnet: node.vpnSubnetIndex != null ? clientSubnet(meshCidr, node.vpnSubnetIndex) : null,
        listenPort: VPN_LISTEN_PORT,
        entryProfiles: asEntry.length,
        exitProfiles: asExit.length,
        connectedClients: asEntry.filter(
          (p) => p.lastHandshakeAt && now - p.lastHandshakeAt.getTime() < SESSION_ACTIVE_WINDOW_MS,
        ).length,
        apply: {
          status: node.vpnApplyStatus,
          error: node.vpnApplyError,
          revision: node.vpnAppliedRevision,
        },
      };
    });
  }

  // ---------------------------------------------------------------------
  // Agent side: desired state push, apply results, live session stats
  // ---------------------------------------------------------------------

  /**
   * Computes every node's full VPN state for a workspace and pushes it.
   * Each node always receives its complete desired state (never a delta),
   * so the agent can converge idempotently: adding, switching or removing a
   * profile, or recovering from a reboot, is the same operation.
   *
   * Per entry node: a `tarmacvpn0` WireGuard interface holding its clients.
   * Per (entry, remote exit) pair: an IPIP tunnel over the mesh between the
   * two nodes' private IPs - WireGuard's cryptokey routing only accepts
   * mesh destinations on tarmacwg0, so internet-bound packets are wrapped
   * in IPIP addressed to the exit's mesh IP to cross it. On the entry, a
   * per-client `ip rule` picks the exit's routing table; the exit routes the
   * entry's client subnet back through the same tunnel and NATs it out.
   */
  async reconcileWorkspace(workspaceId: string, onlyNodeId?: string): Promise<void> {
    const [nodes, profiles, meshCidr] = await Promise.all([
      this.prisma.node.findMany({
        where: { workspaceId },
        select: { id: true, vlanIp: true, overlayPublicKey: true, vpnSubnetIndex: true, vpnAppliedRevision: true },
      }),
      this.prisma.vpnProfile.findMany({ where: { workspaceId, enabled: true } }),
      this.vlanService.getVlanSubnet(workspaceId),
    ]);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const now = Date.now();

    type NodeState = {
      entry: ApplyPayload['entry'];
      clientExit: Map<string, string>; // client public key -> exit node id
      tunnels: Map<string, { table: boolean; returnSubnets: Set<string> }>;
      natSubnets: Set<string>;
    };
    const states = new Map<string, NodeState>();
    const stateFor = (nodeId: string) => {
      let state = states.get(nodeId);
      if (!state) {
        state = { entry: null, clientExit: new Map(), tunnels: new Map(), natSubnets: new Set() };
        states.set(nodeId, state);
      }
      return state;
    };
    const tunnelFor = (state: NodeState, peerId: string) => {
      let tunnel = state.tunnels.get(peerId);
      if (!tunnel) {
        tunnel = { table: false, returnSubnets: new Set() };
        state.tunnels.set(peerId, tunnel);
      }
      return tunnel;
    };

    for (const profile of profiles) {
      if (!this.isLive(profile, now)) continue;
      const entry = nodeById.get(profile.entryNodeId);
      if (!entry?.vlanIp || entry.vpnSubnetIndex == null || !entry.overlayPublicKey) continue;

      const subnet = clientSubnet(meshCidr, entry.vpnSubnetIndex);
      const entryState = stateFor(entry.id);
      entryState.entry ??= {
        interfaceName: VPN_INTERFACE,
        listenPort: VPN_LISTEN_PORT,
        addressCidr: entryGatewayCidr(meshCidr, entry.vpnSubnetIndex),
        clientSubnet: subnet,
        clients: [],
      };
      entryState.natSubnets.add(subnet);
      entryState.entry.clients.push({
        publicKey: profile.clientPublicKey,
        presharedKey: profile.presharedKey,
        ip: profile.clientIp,
        table: 0,
      });

      const exit = profile.mode === 'full' && profile.exitNodeId ? nodeById.get(profile.exitNodeId) : undefined;
      if (!exit?.vlanIp || !exit.overlayPublicKey || exit.id === entry.id) continue;
      entryState.clientExit.set(profile.clientPublicKey, exit.id);
      tunnelFor(entryState, exit.id).table = true;
      const exitState = stateFor(exit.id);
      tunnelFor(exitState, entry.id).returnSubnets.add(subnet);
      exitState.natSubnets.add(subnet);
    }

    const revision = new Date().toISOString();
    // Nodes that used to carry VPN state but no longer do still get an
    // (empty) apply, which tears their interface, tunnels and rules down.
    const targets = nodes.filter((node) => states.has(node.id) || node.vpnAppliedRevision !== null);
    for (const node of targets) {
      if (onlyNodeId && node.id !== onlyNodeId) continue;
      const state = states.get(node.id);
      const tables = assignRoutingTables(
        [...(state?.tunnels.entries() ?? [])].filter(([, tunnel]) => tunnel.table).map(([peerId]) => peerId),
      );
      if (state?.entry) {
        for (const client of state.entry.clients) {
          const exitId = state.clientExit.get(client.publicKey);
          client.table = exitId ? (tables.get(exitId) ?? 0) : 0;
        }
      }
      const tunnels: ApplyTunnel[] = [];
      for (const [peerId, tunnel] of state?.tunnels ?? []) {
        const peer = nodeById.get(peerId);
        if (!node.vlanIp || !peer?.vlanIp) continue;
        tunnels.push({
          name: tunnelName(peerId),
          localIp: node.vlanIp,
          remoteIp: peer.vlanIp,
          table: tables.get(peerId) ?? 0,
          returnSubnets: [...tunnel.returnSubnets].sort(),
        });
      }

      const payload: ApplyPayload = {
        revision,
        meshInterface: 'tarmacwg0',
        meshCidr,
        entry: state?.entry ?? null,
        tunnels,
        natSubnets: [...(state?.natSubnets ?? [])].sort(),
      };
      this.agentsService.sendCommand(node.id, { type: 'command.apply_vpn', payload });
    }
  }

  async reconcileForNode(nodeId: string) {
    const node = await this.prisma.node.findUnique({ where: { id: nodeId }, select: { workspaceId: true } });
    if (!node) return;
    await this.reconcileWorkspace(node.workspaceId, nodeId);
  }

  // A freshly (re)connected agent may have rebooted and lost every
  // non-persistent piece of its VPN state (interfaces, rules, routes).
  async onAgentConnected(nodeId: string) {
    try {
      await this.reconcileForNode(nodeId);
    } catch (error) {
      this.logger.warn(`VPN reconcile on connect failed for ${nodeId}: ${error instanceof Error ? error.message : error}`);
    }
  }

  async onApplyResult(
    nodeId: string,
    workspaceId: string,
    result: { revision: string; success: boolean; message?: string; active?: boolean },
  ) {
    const revision = new Date(result.revision);
    if (Number.isNaN(revision.getTime())) return;
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      select: { workspaceId: true, vpnAppliedRevision: true },
    });
    if (!node || node.workspaceId !== workspaceId) return;
    // Applies can complete out of order; only the newest one is the truth.
    if (node.vpnAppliedRevision && node.vpnAppliedRevision > revision) return;

    const cleared = result.success && result.active === false;
    await this.prisma.node.update({
      where: { id: nodeId },
      data: cleared
        ? { vpnAppliedRevision: null, vpnApplyStatus: null, vpnApplyError: null }
        : {
            vpnAppliedRevision: revision,
            vpnApplyStatus: result.success ? 'active' : 'error',
            vpnApplyError: result.success ? null : (result.message ?? 'Erreur inconnue').slice(0, 700),
          },
    });
    this.live.broadcast('vpn.changed', { nodeId }, workspaceId);
  }

  async ingestPeerStats(nodeId: string, workspaceId: string, peers: VpnPeerStat[]) {
    if (peers.length === 0) return;
    const profiles = await this.prisma.vpnProfile.findMany({
      where: { entryNodeId: nodeId, clientPublicKey: { in: peers.map((peer) => peer.publicKey) } },
      select: { id: true, clientPublicKey: true, lastHandshakeAt: true, clientEndpoint: true },
    });
    const byKey = new Map(profiles.map((profile) => [profile.clientPublicKey, profile]));
    const now = Date.now();
    const live: Array<{
      profileId: string;
      lastHandshakeAt: string | null;
      endpoint: string | null;
      rxBytes: number;
      txBytes: number;
    }> = [];

    for (const peer of peers) {
      const profile = byKey.get(peer.publicKey);
      if (!profile) continue;
      const handshake = peer.latestHandshake ? new Date(peer.latestHandshake * 1000) : null;
      const endpoint = peer.endpoint && peer.endpoint !== '(none)' ? peer.endpoint : null;
      const rxBytes = peer.rxBytes ?? 0;
      const txBytes = peer.txBytes ?? 0;
      live.push({
        profileId: profile.id,
        lastHandshakeAt: handshake?.toISOString() ?? null,
        endpoint,
        rxBytes,
        txBytes,
      });

      const handshakeChanged = (handshake?.getTime() ?? 0) !== (profile.lastHandshakeAt?.getTime() ?? 0);
      const endpointChanged = endpoint !== profile.clientEndpoint;
      const lastWrite = this.statsWrittenAt.get(profile.id) ?? 0;
      if (!handshakeChanged && !endpointChanged && now - lastWrite < SESSION_STATS_WRITE_INTERVAL_MS) continue;
      this.statsWrittenAt.set(profile.id, now);
      await this.prisma.vpnProfile.update({
        where: { id: profile.id },
        data: { lastHandshakeAt: handshake, clientEndpoint: endpoint, rxBytes, txBytes },
      });
    }

    if (live.length > 0) this.live.broadcast('vpn.stats', { nodeId, peers: live }, workspaceId);
  }

  // Safety net on top of the event-driven pushes: re-sends the full desired
  // state everywhere (a no-op on nodes already in sync) and retires expired
  // profiles.
  @Cron(CronExpression.EVERY_MINUTE)
  async expireProfiles() {
    const expired = await this.prisma.vpnProfile.findMany({
      where: { enabled: true, expiresAt: { lte: new Date() } },
      select: { id: true, workspaceId: true, name: true },
    });
    if (expired.length === 0) return;
    await this.prisma.vpnProfile.updateMany({
      where: { id: { in: expired.map((profile) => profile.id) } },
      data: { enabled: false, configChangedAt: new Date() },
    });
    for (const profile of expired) {
      await this.auditLogsService.log({
        workspaceId: profile.workspaceId,
        action: 'vpn_profile.expire',
        resourceType: 'vpn_profile',
        resourceId: profile.id,
        details: { name: profile.name },
      });
    }
    for (const workspaceId of new Set(expired.map((profile) => profile.workspaceId))) {
      await this.reconcileWorkspace(workspaceId);
      this.live.broadcast('vpn.changed', {}, workspaceId);
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcileAll() {
    const workspaces = await this.prisma.workspace.findMany({
      where: {
        OR: [{ vpnProfiles: { some: {} } }, { nodes: { some: { vpnAppliedRevision: { not: null } } } }],
      },
      select: { id: true },
    });
    for (const workspace of workspaces) {
      try {
        await this.reconcileWorkspace(workspace.id);
      } catch (error) {
        this.logger.warn(`VPN reconcile failed for workspace ${workspace.id}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  private isLive(profile: { enabled: boolean; expiresAt: Date | null }, now: number) {
    return profile.enabled && (!profile.expiresAt || profile.expiresAt.getTime() > now);
  }

  private entryIneligibility(node: Pick<Node, 'vlanIp' | 'overlayPublicKey' | 'overlayEndpoint'>): string | null {
    if (!node.vlanIp) return "Ce nœud n'a pas encore rejoint le réseau privé.";
    if (!node.overlayPublicKey) return "L'agent de ce nœud n'a pas encore publié sa clé WireGuard.";
    if (!extractExternalIp(node.overlayEndpoint)) return "L'adresse publique de ce nœud est inconnue.";
    return null;
  }

  // An exit is reached over the mesh, so it needs to actually be on it: a
  // private IP alone isn't enough until its WireGuard key is published.
  private exitIneligibility(node: Pick<Node, 'vlanIp' | 'overlayPublicKey'>): string | null {
    if (!node.vlanIp) return "Ce nœud n'a pas encore rejoint le réseau privé.";
    if (!node.overlayPublicKey) return "L'agent de ce nœud n'a pas encore publié sa clé WireGuard.";
    return null;
  }

  private async assertEntryNode(nodeId: string, workspaceId: string) {
    const node = await this.prisma.node.findFirst({ where: { id: nodeId, workspaceId } });
    if (!node) throw new NotFoundException("Nœud d'entrée introuvable dans ce workspace.");
    const reason = this.entryIneligibility(node);
    if (reason) throw new BadRequestException(`${node.name} ne peut pas servir de point d'entrée : ${reason}`);
    return node;
  }

  // Exit == entry is stored as null ("leave directly through the entry").
  private async normalizeExit(exitNodeId: string | null | undefined, entryNodeId: string, workspaceId: string) {
    if (!exitNodeId || exitNodeId === entryNodeId) return null;
    const node = await this.prisma.node.findFirst({ where: { id: exitNodeId, workspaceId } });
    if (!node) throw new NotFoundException('Nœud de sortie introuvable dans ce workspace.');
    const reason = this.exitIneligibility(node);
    if (reason) throw new BadRequestException(`${node.name} ne peut pas servir de sortie : ${reason}`);
    return node.id;
  }

  private parseFutureDate(value?: string): Date | null {
    if (!value) return null;
    const date = new Date(value);
    if (date.getTime() <= Date.now()) throw new BadRequestException("La date d'expiration doit être dans le futur.");
    return date;
  }

  private async assertPublicKeyFree(publicKey: string, exceptProfileId?: string) {
    const clash = await this.prisma.vpnProfile.findUnique({ where: { clientPublicKey: publicKey }, select: { id: true } });
    if (clash && clash.id !== exceptProfileId) {
      throw new ConflictException('Cette clé publique est déjà utilisée par un autre profil.');
    }
  }

  private async ensureEntrySubnet(nodeId: string, workspaceId: string): Promise<number> {
    for (let attempt = 0; attempt < UNIQUE_RETRIES; attempt++) {
      const node = await this.prisma.node.findUnique({ where: { id: nodeId }, select: { vpnSubnetIndex: true } });
      if (node?.vpnSubnetIndex != null) return node.vpnSubnetIndex;
      const taken = await this.prisma.node.findMany({
        where: { workspaceId, vpnSubnetIndex: { not: null } },
        select: { vpnSubnetIndex: true },
      });
      const used = new Set(taken.map((row) => row.vpnSubnetIndex));
      let index = 1;
      while (used.has(index)) index++;
      if (index > MAX_ENTRY_SUBNETS) {
        throw new ConflictException(`Ce workspace a atteint la limite de ${MAX_ENTRY_SUBNETS} points d'entrée VPN.`);
      }
      try {
        await this.prisma.node.update({ where: { id: nodeId }, data: { vpnSubnetIndex: index } });
        return index;
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
      }
    }
    throw new ConflictException("Impossible d'attribuer un sous-réseau client à ce nœud, réessayez.");
  }

  private async allocateClientIp(entryNodeId: string, meshCidr: string, subnetIndex: number) {
    const used = await this.prisma.vpnProfile.findMany({ where: { entryNodeId }, select: { clientIp: true } });
    const ip = pickFreeClientIp(meshCidr, subnetIndex, used.map((row) => row.clientIp));
    if (!ip) throw new ConflictException("Ce point d'entrée n'a plus d'adresse client disponible (253 maximum).");
    return ip;
  }

  private async findOwned(id: string, scope: WorkspaceScope): Promise<ProfileWithNodes> {
    const profile = await this.prisma.vpnProfile.findFirst({
      where: { id, workspaceId: scope.workspaceId },
      include: { entryNode: { select: NODE_REF_SELECT }, exitNode: { select: NODE_REF_SELECT } },
    });
    if (!profile) throw new NotFoundException('Profil VPN introuvable');
    return profile;
  }

  private async buildConfig(profile: ProfileWithNodes) {
    const [workspace, meshCidr] = await Promise.all([
      this.prisma.workspace.findUnique({ where: { id: profile.workspaceId }, select: { name: true } }),
      this.vlanService.getVlanSubnet(profile.workspaceId),
    ]);
    const host = extractExternalIp(profile.entryNode.overlayEndpoint);
    if (!host || !profile.entryNode.overlayPublicKey) {
      throw new BadRequestException("Le point d'entrée de ce profil n'a pas encore d'adresse publique ou de clé.");
    }
    return renderClientConfig({
      profileName: profile.name,
      workspaceName: workspace?.name ?? '',
      entryNodeName: profile.entryNode.name,
      mode: profile.mode,
      clientIp: profile.clientIp,
      clientPrivateKey: profile.clientPrivateKey,
      presharedKey: profile.presharedKey,
      dns: profile.dns,
      serverPublicKey: profile.entryNode.overlayPublicKey,
      endpoint: `${host.includes(':') ? `[${host}]` : host}:${VPN_LISTEN_PORT}`,
      meshCidr,
    });
  }

  private nodeRef(node: NodeRefRow) {
    return {
      id: node.id,
      name: node.name,
      status: node.status,
      publicIp: extractExternalIp(node.overlayEndpoint),
      locationCity: node.locationCity,
      locationCountry: node.locationCountry,
      locationCountryCode: node.locationCountryCode,
    };
  }

  // Never exposes the private or preshared key - those only leave through
  // the config endpoints.
  private serialize(profile: ProfileWithNodes) {
    const now = Date.now();
    const effectiveExit = profile.mode === 'full' ? (profile.exitNode ?? profile.entryNode) : null;
    const connected = Boolean(
      profile.lastHandshakeAt && now - profile.lastHandshakeAt.getTime() < SESSION_ACTIVE_WINDOW_MS,
    );
    return {
      id: profile.id,
      name: profile.name,
      description: profile.description,
      mode: profile.mode,
      enabled: profile.enabled,
      expiresAt: profile.expiresAt,
      dns: profile.dns,
      clientIp: profile.clientIp,
      clientPublicKey: profile.clientPublicKey,
      hasPrivateKey: profile.clientPrivateKey !== null,
      entryNode: this.nodeRef(profile.entryNode),
      exitNodeId: profile.exitNodeId,
      exitNode: effectiveExit ? this.nodeRef(effectiveExit) : null,
      deployment: this.deploymentStatus(profile, effectiveExit, now),
      session: {
        connected,
        lastHandshakeAt: profile.lastHandshakeAt,
        endpoint: profile.clientEndpoint,
        rxBytes: profile.rxBytes,
        txBytes: profile.txBytes,
      },
      exitSwitchedAt: profile.exitSwitchedAt,
      configChangedAt: profile.configChangedAt,
      createdByUserId: profile.createdByUserId,
      createdByApiKeyId: profile.createdByApiKeyId,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  private deploymentStatus(
    profile: ProfileWithNodes,
    effectiveExit: NodeRefRow | null,
    now: number,
  ): { status: 'active' | 'pending' | 'error' | 'disabled' | 'expired'; message: string | null } {
    if (profile.expiresAt && profile.expiresAt.getTime() <= now) return { status: 'expired', message: null };
    if (!profile.enabled) return { status: 'disabled', message: null };

    const involved = [profile.entryNode];
    if (effectiveExit && effectiveExit.id !== profile.entryNode.id) involved.push(effectiveExit);
    for (const node of involved) {
      const applied = node.vpnAppliedRevision && node.vpnAppliedRevision >= profile.configChangedAt;
      if (applied && node.vpnApplyStatus === 'error') {
        return { status: 'error', message: `${node.name} : ${node.vpnApplyError ?? 'échec de configuration'}` };
      }
    }
    for (const node of involved) {
      const applied = node.vpnAppliedRevision && node.vpnAppliedRevision >= profile.configChangedAt;
      if (!applied) {
        return {
          status: 'pending',
          message:
            node.status === 'online'
              ? `Configuration en cours sur ${node.name}…`
              : `${node.name} est hors ligne : la configuration sera appliquée à son retour.`,
        };
      }
    }
    return { status: 'active', message: null };
  }

  private async audit(actor: Actor, action: string, resourceId: string, details: Record<string, unknown>) {
    await this.auditLogsService.log({
      workspaceId: actor.scope.workspaceId as string,
      actorUserId: actor.userId,
      action,
      resourceType: 'vpn_profile',
      resourceId,
      details: (actor.scope.apiKey
        ? { ...details, apiKey: { id: actor.scope.apiKey.id, name: actor.scope.apiKey.name } }
        : details) as Prisma.InputJsonValue,
    });
  }

  private broadcastChanged(workspaceId: string, profileId: string) {
    this.live.broadcast('vpn.changed', { profileId }, workspaceId);
  }
}
