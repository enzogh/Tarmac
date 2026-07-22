import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AgentsModule } from './agents/agents.module';
import { AlertRulesModule } from './alert-rules/alert-rules.module';
import { AlertsModule } from './alerts/alerts.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { AuthModule } from './auth/auth.module';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
    }),
    PrismaModule,
    AuthModule,
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
    ReconciliationModule,
    VlanModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
