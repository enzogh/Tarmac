import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AgentsService } from '../agents/agents.service';
import { MountsService } from '../mounts/mounts.service';
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
      const [pendingShares, pendingMounts, pendingPoolMembers] = await Promise.all([
        this.sharesService.findPending(),
        this.mountsService.findPending(),
        this.poolsService.findPendingMembers(),
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