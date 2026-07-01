import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MountsService } from '../mounts/mounts.service';
import { PoolsService } from '../pools/pools.service';
import { SharesService } from '../shares/shares.service';
import { CommandPayload, CommandResultPayload, HeartbeatPayload, StateReportPayload } from './agents.types';

type SendFn = (event: string, payload: unknown) => void;

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);
  private readonly senders = new Map<string, SendFn>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sharesService: SharesService,
    private readonly mountsService: MountsService,
    private readonly poolsService: PoolsService,
  ) {}

  register(nodeId: string, send: SendFn) {
    this.senders.set(nodeId, send);
  }

  unregister(nodeId: string) {
    this.senders.delete(nodeId);
  }

  isConnected(nodeId?: string | null) {
    if (!nodeId) return false;
    return this.senders.has(nodeId);
  }

  async onHeartbeat(payload: HeartbeatPayload) {
    const { nodeId, metrics } = payload;

    await this.prisma.node
      .update({
        where: { id: nodeId },
        data: { status: 'online', lastSeenAt: new Date() },
      })
      .catch(async () => {
        await this.prisma.node.create({
          data: {
            id: nodeId,
            name: `node-${nodeId.slice(0, 6)}`,
            role: 'worker',
            status: 'online',
            lastSeenAt: new Date(),
          },
        });
      });

    await this.prisma.metricSample.create({
      data: {
        nodeId,
        cpu: metrics.cpu,
        ram: metrics.ram,
        disk: metrics.disk,
        networkRx: metrics.networkRx ?? 0,
        networkTx: metrics.networkTx ?? 0,
        ioRead: metrics.ioRead ?? 0,
        ioWrite: metrics.ioWrite ?? 0,
      },
    });
  }

  async onStateReport(payload: StateReportPayload) {
    for (const disk of payload.disks) {
      await this.prisma.disk.upsert({
        where: { nodeId_name: { nodeId: payload.nodeId, name: disk.name } },
        update: {
          mountPath: disk.mountPath,
          type: disk.type,
          health: disk.health,
          capacityGb: disk.capacityGb,
          usedGb: disk.usedGb,
        },
        create: {
          nodeId: payload.nodeId,
          name: disk.name,
          mountPath: disk.mountPath,
          type: disk.type,
          health: disk.health,
          capacityGb: disk.capacityGb,
          usedGb: disk.usedGb,
        },
      });
    }

    if (payload.smartReports.length > 0) {
      await this.prisma.smartReport.createMany({
        data: payload.smartReports.map((report) => ({
          nodeId: payload.nodeId,
          diskName: report.diskName,
          temperatureC: report.temperatureC,
          reallocatedSectors: report.reallocatedSectors,
          pendingSectors: report.pendingSectors,
          powerOnHours: report.powerOnHours,
          overall: report.overall,
        })),
      });
    }
  }

  async onCommandResult(result: CommandResultPayload) {
    this.logger.log(`Command result ${result.command} ${result.resourceId}: ${result.success}`);
    const status = result.success ? 'active' : 'error';

    if (result.resourceType === 'share') {
      await this.sharesService.setStatus(result.resourceId, status);
      return;
    }

    if (result.resourceType === 'mount') {
      await this.mountsService.setStatus(result.resourceId, status);
      return;
    }

    if (result.resourceType === 'pool_member') {
      const [poolId, nodeId] = result.resourceId.split(':');
      if (poolId && nodeId) {
        await this.poolsService.setMemberStatus(poolId, nodeId, result.success ? 'active' : 'error');
      }
      return;
    }

    if (result.resourceType === 'sync_job_run') {
      await this.prisma.syncJobRun
        .update({
          where: { id: result.resourceId },
          data: {
            status: result.success ? 'success' : 'failed',
            finishedAt: new Date(),
            bytesTransferred: result.success ? 500000000 : 0,
            log: result.message,
          },
        })
        .then(async (run) => {
          await this.prisma.syncJob.update({
            where: { id: run.syncJobId },
            data: { status: result.success ? 'success' : 'failed', lastRunAt: new Date() },
          });
        });
    }
  }

  sendCommand(nodeId: string, command: CommandPayload) {
    const sender = this.senders.get(nodeId);
    if (!sender) return false;

    sender('command', command);
    return true;
  }
}
