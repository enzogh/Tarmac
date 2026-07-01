import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AgentsService } from '../agents/agents.service';
import { MountsService } from '../mounts/mounts.service';
import { PoolsService } from '../pools/pools.service';
import { SharesService } from '../shares/shares.service';

@Injectable()
export class ReconciliationService implements OnModuleInit {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly sharesService: SharesService,
    private readonly mountsService: MountsService,
    private readonly poolsService: PoolsService,
    private readonly agentsService: AgentsService,
  ) {}

  onModuleInit() {
    setInterval(() => {
      void this.tick();
    }, 15000);
  }

  private async tick() {
    const [pendingShares, pendingMounts, pendingPoolMembers] = await Promise.all([
      this.sharesService.findPending(),
      this.mountsService.findPending(),
      this.poolsService.findPendingMembers(),
    ]);

    for (const share of pendingShares) {
      if (!this.agentsService.isConnected(share.nodeId)) continue;
      this.agentsService.sendCommand(share.nodeId!, {
        type: 'command.apply_export',
        payload: {
          shareId: share.id,
          name: share.name,
          path: share.path,
        },
      });
      this.logger.debug(`Sent export command for share ${share.id}`);
    }

    for (const mount of pendingMounts) {
      if (!this.agentsService.isConnected(mount.nodeId)) continue;
      this.agentsService.sendCommand(mount.nodeId!, {
        type: 'command.apply_mount',
        payload: {
          mountId: mount.id,
          sourcePath: mount.sourcePath,
          targetPath: mount.targetPath,
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
  }
}
