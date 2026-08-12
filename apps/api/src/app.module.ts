import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AgentLogsModule } from './agent-logs/agent-logs.module';
import { AgentsModule } from './agents/agents.module';
import { AlertRulesModule } from './alert-rules/alert-rules.module';
import { AlertsModule } from './alerts/alerts.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { AuthModule } from './auth/auth.module';
import { LiveModule } from './live/live.module';
import { MigrationsModule } from './migrations/migrations.module';
import { MountsModule } from './mounts/mounts.module';
import { NodesModule } from './nodes/nodes.module';
import { NotificationChannelsModule } from './notification-channels/notification-channels.module';
import { PoolsModule } from './pools/pools.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { SharesModule } from './shares/shares.module';
import { StorageModule } from './storage/storage.module';
import { SyncJobsModule } from './sync-jobs/sync-jobs.module';
import { TopologyModule } from './topology/topology.module';
import { VlanModule } from './vlan/vlan.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      // 100 req/min was tuned for a single caller. In practice this API is polled every 5s
      // by up to ~20 dashboard widgets per open tab, and every visitor behind the same NAT/IP
      // shares this bucket — a couple of tabs alone can exceed the old budget without any
      // abuse, and bulk actions (e.g. deleting many alerts) made it worse. Auth still has its
      // own tight per-route throttle (see AuthController @Throttle on /login).
      throttlers: [{ ttl: 60_000, limit: 1200 }],
    }),
    PrismaModule,
    AuthModule,
    LiveModule,
    NodesModule,
    SharesModule,
    MountsModule,
    PoolsModule,
    AlertRulesModule,
    AlertsModule,
    NotificationChannelsModule,
    MigrationsModule,
    SyncJobsModule,
    AuditLogsModule,
    TopologyModule,
    StorageModule,
    AgentsModule,
    AgentLogsModule,
    ReconciliationModule,
    VlanModule,
    WorkspacesModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
