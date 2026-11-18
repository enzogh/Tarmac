import { Controller, Get, Post, Param, Body, Query, UseGuards, HttpException, HttpStatus, Logger, Inject, forwardRef, ForbiddenException } from '@nestjs/common';
import { VlanService } from './vlan.service';
import { AgentsService } from '../agents/agents.service';
import { CurrentWorkspace, WorkspaceGuard, WorkspaceScope } from '../auth/workspace.guard';
import { ApiKeyOrJwtGuard, ApiKeyResource } from '../auth/api-key.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildLinkReport,
  LinkReportLang,
  outcomeLoss,
  pickCaptures,
  ReportCapture,
  StoredTraceOutcome,
  storedToOutcome,
} from './link-report';
import { LinkCaptureService, reportNodeFrom } from './link-capture.service';

const REPORT_RANGES: Record<string, number> = { '6h': 6, '24h': 24, '48h': 48 };

@ApiKeyResource('network')
@Controller('vlan')
@UseGuards(ApiKeyOrJwtGuard, WorkspaceGuard)
export class VlanController {
  private readonly logger = new Logger(VlanController.name);

  constructor(
    private vlanService: VlanService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AgentsService)) private agentsService: AgentsService,
    private readonly linkCaptures: LinkCaptureService,
  ) {}

  private async assertVlanInScope(vlanId: string, scope: WorkspaceScope) {
    const vlan = await this.prisma.vlan.findFirst({
      where: { OR: [{ id: vlanId }, { name: vlanId }], workspaceId: scope.workspaceId },
      select: { id: true },
    });
    if (!vlan) {
      throw new ForbiddenException('This VLAN is not part of your workspace');
    }
  }

  @Get()
  async getAllVlans(@CurrentWorkspace() scope: WorkspaceScope) {
    try {
      // Get or create this workspace's own VLAN (one per workspace).
      const vlan = await this.vlanService.getOrCreateVlan(scope.workspaceId as string);
      this.logger.log('✅ VLAN created/retrieved via API');
      return {
        vlans: [vlan],
      };
    } catch (error) {
      this.logger.warn('⚠️  Database unavailable - VLAN will be created when first agent connects');
      // Return empty array if DB is not connected - frontend will show "Deploy agents" state
      return {
        vlans: [],
      };
    }
  }

  @Post('join')
  async joinVlan(@Body() body: { nodeId: string }, @CurrentWorkspace() scope: WorkspaceScope) {
    const node = await this.prisma.node.findFirst({
      where: { id: body.nodeId, workspaceId: scope.workspaceId },
      select: { id: true },
    });
    if (!node) {
      throw new HttpException('Node not found', HttpStatus.NOT_FOUND);
    }
    try {
      const membership = await this.vlanService.joinVlan(body.nodeId, scope.workspaceId);
      return {
        success: true,
        membership,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }

  @Get(':vlanId/members')
  async getMembers(@Param('vlanId') vlanId: string, @CurrentWorkspace() scope: WorkspaceScope) {
    await this.assertVlanInScope(vlanId, scope);
    try {
      const members = await this.vlanService.getVlanMembers(vlanId);
      return { members };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new HttpException(message, HttpStatus.NOT_FOUND);
    }
  }

  @Get(':vlanId/connections')
  async getConnections(@Param('vlanId') vlanId: string, @CurrentWorkspace() scope: WorkspaceScope) {
    await this.assertVlanInScope(vlanId, scope);
    try {
      const connections = await this.vlanService.getVlanConnections(vlanId);
      return { connections };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new HttpException(message, HttpStatus.NOT_FOUND);
    }
  }

  @Get(':vlanId/status')
  async getStatus(@Param('vlanId') vlanId: string, @CurrentWorkspace() scope: WorkspaceScope) {
    await this.assertVlanInScope(vlanId, scope);
    try {
      const status = await this.vlanService.getVlanStatus(vlanId);
      return status;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new HttpException(message, HttpStatus.NOT_FOUND);
    }
  }

  @Get(':vlanId/history')
  async getConnectionHistory(
    @Param('vlanId') vlanId: string,
    @Query('source') source: string,
    @Query('target') target: string,
    @Query('range') range: string | undefined,
    @CurrentWorkspace() scope: WorkspaceScope,
  ) {
    await this.assertVlanInScope(vlanId, scope);
    try {
      if (!source || !target) {
        throw new HttpException('Les paramètres source et target sont requis', HttpStatus.BAD_REQUEST);
      }
      return await this.vlanService.getConnectionHistory(vlanId, source, target, range);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new HttpException(message, HttpStatus.NOT_FOUND);
    }
  }

  // Diagnostics are run on demand and shown to whoever ran them; they are
  // not stored (the link probes already keep the history). Kept so older
  // dashboards polling this endpoint get an empty list instead of a 404.
  @Get(':vlanId/tests')
  async getConnectionTests(@Param('vlanId') vlanId: string, @CurrentWorkspace() scope: WorkspaceScope) {
    await this.assertVlanInScope(vlanId, scope);
    return { tests: [] };
  }

  @Post(':vlanId/test')
  async runConnectionTest(
    @Param('vlanId') vlanId: string,
    @Body()
    body: {
      initiatorNodeId: string;
      targetNodeId: string;
      testType: 'ping' | 'traceroute';
    },
    @CurrentWorkspace() scope: WorkspaceScope,
  ) {
    await this.assertVlanInScope(vlanId, scope);
    const members = await this.vlanService.getVlanMembers(vlanId);
    const initiator = members.find((member: any) => member.nodeId === body.initiatorNodeId);
    const target = members.find((member: any) => member.nodeId === body.targetNodeId);
    if (!initiator || !target) {
      throw new HttpException('Les nœuds sélectionnés ne font pas partie de ce VLAN', HttpStatus.BAD_REQUEST);
    }
    if (body.initiatorNodeId === body.targetNodeId) {
      throw new HttpException('Le nœud source et le nœud cible doivent être différents', HttpStatus.BAD_REQUEST);
    }
    if (!initiator.vlanIp || !target.vlanIp) {
      throw new HttpException('IPs VLAN introuvables pour le test', HttpStatus.BAD_REQUEST);
    }
    if (!this.isPrivateIp(initiator.vlanIp) || !this.isPrivateIp(target.vlanIp)) {
      throw new HttpException('Le test doit passer par des IPs VLAN privées', HttpStatus.BAD_REQUEST);
    }

    const startedAt = new Date();
    const base = {
      id: `${startedAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      vlanId,
      initiatorNodeId: body.initiatorNodeId,
      targetNodeId: body.targetNodeId,
      testType: body.testType === 'traceroute' ? ('traceroute' as const) : ('ping' as const),
      startedAt: startedAt.toISOString(),
      initiatorNode: { id: initiator.nodeId, name: initiator.node?.name ?? initiator.nodeId, vlanIp: initiator.vlanIp },
      targetNode: { id: target.nodeId, name: target.node?.name ?? target.nodeId, vlanIp: target.vlanIp },
    };
    const done = () => ({ completedAt: new Date().toISOString(), durationMs: Date.now() - startedAt.getTime() });

    if (base.testType === 'traceroute') {
      try {
        const trace = await this.agentsService.requestTraceroute(body.initiatorNodeId, target.vlanIp);
        const lastHop = trace.hops[trace.hops.length - 1];
        const reached = lastHop?.ip === target.vlanIp;
        return {
          success: true,
          test: {
            ...base,
            ...done(),
            status: reached ? 'success' : 'failed',
            resultMessage: reached
              ? `${trace.hops.length} saut${trace.hops.length > 1 ? 's' : ''} jusqu'à ${target.vlanIp}`
              : `La cible ${target.vlanIp} n'a pas répondu au dernier saut`,
            latencyMs: typeof lastHop?.latencyMs === 'number' ? lastHop.latencyMs : null,
            hops: trace.hops,
          },
        };
      } catch (error) {
        return { success: true, test: { ...base, ...done(), status: 'failed', resultMessage: this.testError(error), hops: [] } };
      }
    }

    try {
      const ping = await this.agentsService.requestPing(body.initiatorNodeId, target.vlanIp);
      const reachable = ping.packetLoss < 100;
      return {
        success: true,
        test: {
          ...base,
          ...done(),
          status: reachable ? 'success' : 'failed',
          resultMessage: reachable
            ? `${ping.sent} paquets envoyés, ${Math.round(ping.packetLoss)} % perdus`
            : `${target.vlanIp} ne répond pas (${ping.sent} paquets perdus)`,
          latencyMs: ping.avgMs,
          minMs: ping.minMs,
          maxMs: ping.maxMs,
          packetLoss: ping.packetLoss,
        },
      };
    } catch (error) {
      return { success: true, test: { ...base, ...done(), status: 'failed', resultMessage: this.testError(error) } };
    }
  }

  // A report about one link, ready to send to a hosting provider: public
  // IPs, measured loss and latency over the window, comparison with both
  // servers' other links, and the tests support asks for before escalating
  // (load as top shows it, ping, traceroute, MTR), run now from each end
  // towards the other's public address, both at once (~32 s).
  @Post(':vlanId/report')
  async linkReport(
    @Param('vlanId') vlanId: string,
    @Body() body: { source?: string; target?: string; range?: string; lang?: string },
    @CurrentWorkspace() scope: WorkspaceScope,
  ) {
    await this.assertVlanInScope(vlanId, scope);
    const lang: LinkReportLang = body.lang === 'en' ? 'en' : 'fr';
    const hours = REPORT_RANGES[body.range ?? '24h'];
    if (!hours) throw new HttpException('Période invalide (6h, 24h ou 48h).', HttpStatus.BAD_REQUEST);
    if (!body.source || !body.target || body.source === body.target) {
      throw new HttpException('Choisissez deux nœuds différents.', HttpStatus.BAD_REQUEST);
    }
    const vlan = await this.prisma.vlan.findFirst({
      where: { OR: [{ id: vlanId }, { name: vlanId }], workspaceId: scope.workspaceId },
      select: { id: true },
    });
    const members = await this.vlanService.getVlanMembers(vlan!.id);
    if (!members.some((m: any) => m.nodeId === body.source) || !members.some((m: any) => m.nodeId === body.target)) {
      throw new HttpException('Les nœuds sélectionnés ne font pas partie de ce réseau.', HttpStatus.BAD_REQUEST);
    }

    const generatedAt = new Date();
    const since = new Date(generatedAt.getTime() - hours * 3_600_000);
    const data = await this.vlanService.linkReportData(vlan!.id, body.source, body.target, since);
    if (!data.a || !data.b) throw new HttpException('Nœud introuvable.', HttpStatus.NOT_FOUND);
    if (data.aToB.length === 0 && data.bToA.length === 0) {
      throw new HttpException(
        "Aucune mesure directe entre ces deux nœuds sur la période : ils ne sont pas reliés directement (le trafic passe par une passerelle). Faites le rapport sur chaque tronçon.",
        HttpStatus.BAD_REQUEST,
      );
    }

    const a = reportNodeFrom(data.a);
    const b = reportNodeFrom(data.b);
    const [now, workspace, stored] = await Promise.all([
      this.linkCaptures.runDiagnostics({ id: body.source, publicIp: a.publicIp }, { id: body.target, publicIp: b.publicIp }),
      this.prisma.workspace.findUnique({ where: { id: scope.workspaceId as string }, select: { firewallPublicPing: true } }),
      this.linkCaptures.listCaptures(vlan!.id, body.source, body.target, since),
    ]);
    const traceAToB = storedToOutcome(now.aToB, lang);
    const traceBToA = storedToOutcome(now.bToA, lang);
    const captures = stored.map((row) => this.orientCapture(row, body.source!, lang));

    const report = buildLinkReport({
      lang,
      generatedAt,
      since,
      a,
      b,
      aToB: data.aToB,
      bToA: data.bToA,
      aOthers: data.aOthers,
      bOthers: data.bOthers,
      traceAToB,
      traceBToA,
      captures,
      publicPingFiltered: workspace?.firewallPublicPing === false,
    });
    return {
      ...report,
      generatedAt: generatedAt.toISOString(),
      captures: { available: captures.length, included: pickCaptures(captures).length },
    };
  }

  // Tests captured automatically while a link was degraded (see
  // LinkCaptureService), newest first, for the report dialog.
  @Get(':vlanId/captures')
  async listLinkCaptures(
    @Param('vlanId') vlanId: string,
    @Query('source') source: string,
    @Query('target') target: string,
    @Query('range') range: string,
    @CurrentWorkspace() scope: WorkspaceScope,
  ) {
    await this.assertVlanInScope(vlanId, scope);
    const hours = REPORT_RANGES[range ?? '24h'];
    if (!hours) throw new HttpException('Période invalide (6h, 24h ou 48h).', HttpStatus.BAD_REQUEST);
    if (!source || !target || source === target) throw new HttpException('Choisissez deux nœuds différents.', HttpStatus.BAD_REQUEST);
    const vlan = await this.prisma.vlan.findFirst({
      where: { OR: [{ id: vlanId }, { name: vlanId }], workspaceId: scope.workspaceId },
      select: { id: true },
    });
    const since = new Date(Date.now() - hours * 3_600_000);
    const rows = await this.linkCaptures.listCaptures(vlan!.id, source, target, since);
    const captures = rows.map((row) => this.orientCapture(row, source, 'fr'));
    const included = new Set(pickCaptures(captures).map((capture) => capture.at.getTime()));
    return captures
      .map((capture) => ({
        at: capture.at.toISOString(),
        direction: capture.trigger.direction,
        status: capture.trigger.status,
        triggerLoss: capture.trigger.loss,
        measuredLoss: outcomeLoss(capture.aToB, capture.bToA),
        complete: capture.aToB.ok && capture.bToA.ok,
        included: included.has(capture.at.getTime()),
      }))
      .reverse();
  }

  /** A stored capture seen from the report's A (= `sourceId`). */
  private orientCapture(
    row: { createdAt: Date; nodeAId: string; triggerSourceId: string; triggerStatus: string; triggerLoss: number | null; triggerLatency: number | null; aToB: unknown; bToA: unknown },
    sourceId: string,
    lang: LinkReportLang,
  ): ReportCapture {
    const flipped = row.nodeAId !== sourceId;
    const forward = storedToOutcome(row.aToB as StoredTraceOutcome, lang);
    const backward = storedToOutcome(row.bToA as StoredTraceOutcome, lang);
    return {
      at: row.createdAt,
      trigger: {
        direction: row.triggerSourceId === sourceId ? 'AB' : 'BA',
        status: row.triggerStatus,
        loss: row.triggerLoss,
        latencyMs: row.triggerLatency,
      },
      aToB: flipped ? backward : forward,
      bToA: flipped ? forward : backward,
    };
  }

  private testError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (/is offline|disconnected/.test(message)) return "Le nœud source est hors ligne : son agent ne peut pas lancer le test.";
    if (/timeout|à temps/.test(message)) return "L'agent du nœud source n'a pas répondu à temps.";
    // Agents from before the built-in traceroute relied on system tools.
    if (/traceroute\/tracepath not found/.test(message)) {
      return "L'agent du nœud source n'a ni traceroute ni tracepath : mettez-le à jour depuis la page Nœuds, il trace désormais sans outil externe.";
    }
    if (/^no route found to/.test(message)) return message.replace(/^no route found to/, 'Aucune route vers');
    return message;
  }

  @Post(':vlanId/members/:nodeId/gateway')
  async setGateway(
    @Param('vlanId') vlanId: string,
    @Param('nodeId') nodeId: string,
    @Body() body: { role?: 'primary' | 'backup' | null; enabled?: boolean },
    @CurrentWorkspace() scope: WorkspaceScope,
  ) {
    await this.assertVlanInScope(vlanId, scope);
    try {
      // `enabled` is the original primary-only form of this endpoint.
      const role = body.role === 'primary' || body.role === 'backup' ? body.role : body.enabled ? 'primary' : null;
      const result = await this.vlanService.setGateway(vlanId, nodeId, role);
      await this.agentsService.reconcileOverlayForVlan(vlanId);
      return { success: true, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }

  private isPrivateIp(ip: string) {
    if (ip.startsWith('10.')) return true;
    if (ip.startsWith('192.168.')) return true;
    if (!ip.startsWith('172.')) return false;
    const second = Number(ip.split('.')[1]);
    return Number.isFinite(second) && second >= 16 && second <= 31;
  }

  @Post('heartbeat')
  async heartbeat(@Body() body: { nodeId: string; vlanId?: string }, @CurrentWorkspace() scope: WorkspaceScope) {
    const node = await this.prisma.node.findFirst({
      where: { id: body.nodeId, workspaceId: scope.workspaceId },
      select: { id: true },
    });
    if (!node) {
      throw new HttpException('Node not found', HttpStatus.NOT_FOUND);
    }
    try {
      const result = await this.vlanService.heartbeat(body.nodeId, body.vlanId);
      return {
        success: result !== null,
        membership: result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
