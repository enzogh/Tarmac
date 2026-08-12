-- CreateEnum
CREATE TYPE "NodeStatus" AS ENUM ('offline', 'online', 'degraded');

-- CreateEnum
CREATE TYPE "ShareStatus" AS ENUM ('pending', 'active', 'error');

-- CreateEnum
CREATE TYPE "MountStatus" AS ENUM ('pending', 'active', 'error');

-- CreateEnum
CREATE TYPE "ShareClientAccess" AS ENUM ('ro', 'rw', 'deny');

-- CreateEnum
CREATE TYPE "DiskHealth" AS ENUM ('healthy', 'warning', 'critical', 'unknown');

-- CreateEnum
CREATE TYPE "DiskType" AS ENUM ('hdd', 'ssd', 'nvme');

-- CreateEnum
CREATE TYPE "PoolStatus" AS ENUM ('pending', 'active', 'error');

-- CreateEnum
CREATE TYPE "PoolMemberStatus" AS ENUM ('pending', 'active', 'error');

-- CreateEnum
CREATE TYPE "PoolMemberRole" AS ENUM ('primary', 'replica');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('open', 'acknowledged', 'resolved');

-- CreateEnum
CREATE TYPE "Comparator" AS ENUM ('gt', 'gte', 'lt', 'lte');

-- CreateEnum
CREATE TYPE "NotificationChannelType" AS ENUM ('email', 'webhook', 'slack');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('pending', 'running', 'success', 'failed');

-- CreateEnum
CREATE TYPE "VlanConnectionStatus" AS ENUM ('healthy', 'degraded', 'offline', 'unknown');

-- CreateEnum
CREATE TYPE "VlanTestType" AS ENUM ('ping', 'traceroute');

-- CreateEnum
CREATE TYPE "MigrationStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT,
    "avatarUrl" TEXT,
    "isSuperuser" BOOLEAN NOT NULL DEFAULT false,
    "ssoSubject" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Node" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" "NodeStatus" NOT NULL DEFAULT 'offline',
    "locationCity" TEXT,
    "locationCountry" TEXT,
    "locationCountryCode" TEXT,
    "locationLat" DOUBLE PRECISION,
    "locationLng" DOUBLE PRECISION,
    "graphX" DOUBLE PRECISION,
    "graphY" DOUBLE PRECISION,
    "lastSeenAt" TIMESTAMP(3),
    "vlanIp" TEXT,
    "vlanMac" TEXT,
    "overlayPublicKey" TEXT,
    "overlayEndpoint" TEXT,
    "overlayListenPort" INTEGER,
    "overlaySshPublicKey" TEXT,
    "overlaySshUser" TEXT,
    "overlayIsGateway" BOOLEAN NOT NULL DEFAULT false,
    "agentVersion" TEXT,
    "agentVersionAt" TIMESTAMP(3),
    "agentTokenHash" TEXT,
    "agentTokenPreviousHash" TEXT,
    "agentTokenGraceUntil" TIMESTAMP(3),
    "agentTokenRotatedAt" TIMESTAMP(3),
    "mutedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Share" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" "ShareStatus" NOT NULL DEFAULT 'pending',
    "nodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Share_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareClient" (
    "id" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "access" "ShareClientAccess" NOT NULL DEFAULT 'ro',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShareClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "additionalSources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "targetPath" TEXT NOT NULL,
    "fsType" TEXT NOT NULL DEFAULT 'nfs',
    "mountOptions" TEXT,
    "remoteHost" TEXT,
    "remoteUser" TEXT,
    "remoteSshPort" INTEGER DEFAULT 22,
    "status" "MountStatus" NOT NULL DEFAULT 'pending',
    "lastError" TEXT,
    "nodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricSample" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "cpu" DOUBLE PRECISION NOT NULL,
    "ram" DOUBLE PRECISION NOT NULL,
    "disk" DOUBLE PRECISION NOT NULL,
    "networkRx" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "networkTx" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ioRead" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ioWrite" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Disk" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mountPath" TEXT NOT NULL,
    "type" "DiskType" NOT NULL DEFAULT 'hdd',
    "health" "DiskHealth" NOT NULL DEFAULT 'unknown',
    "capacityGb" INTEGER NOT NULL,
    "usedGb" INTEGER NOT NULL,
    "physicalDisks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Disk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmartReport" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "diskName" TEXT NOT NULL,
    "temperatureC" INTEGER NOT NULL,
    "reallocatedSectors" INTEGER NOT NULL,
    "pendingSectors" INTEGER NOT NULL,
    "powerOnHours" INTEGER NOT NULL,
    "overall" "DiskHealth" NOT NULL DEFAULT 'unknown',
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmartReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pool" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "status" "PoolStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolMember" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "role" "PoolMemberRole" NOT NULL DEFAULT 'replica',
    "status" "PoolMemberStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoolMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "NotificationChannelType" NOT NULL,
    "target" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "comparator" "Comparator" NOT NULL DEFAULT 'gte',
    "threshold" DOUBLE PRECISION NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'medium',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nodeId" TEXT,
    "notificationChannelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT,
    "nodeId" TEXT,
    "message" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'medium',
    "status" "AlertStatus" NOT NULL DEFAULT 'open',
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "targetPath" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'pending',
    "nodeId" TEXT,
    "sourceHost" TEXT,
    "sourceUser" TEXT,
    "sourceSshPort" INTEGER DEFAULT 22,
    "triggerTokenHash" TEXT,
    "triggerTokenRotatedAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJobRun" (
    "id" TEXT NOT NULL,
    "syncJobId" TEXT NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'running',
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "bytesTransferred" INTEGER NOT NULL DEFAULT 0,
    "log" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationTask" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shareId" TEXT,
    "sourceNodeId" TEXT,
    "targetNodeId" TEXT,
    "status" "MigrationStatus" NOT NULL DEFAULT 'pending',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigrationTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentLog" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subnetCidr" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VlanMember" (
    "id" TEXT NOT NULL,
    "vlanId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "vlanIp" TEXT NOT NULL,
    "vlanMac" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VlanMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VlanConnection" (
    "id" TEXT NOT NULL,
    "vlanId" TEXT NOT NULL,
    "sourceNodeId" TEXT NOT NULL,
    "targetNodeId" TEXT NOT NULL,
    "status" "VlanConnectionStatus" NOT NULL DEFAULT 'unknown',
    "latencyMs" DOUBLE PRECISION,
    "packetLoss" DOUBLE PRECISION,
    "bandwidth" DOUBLE PRECISION,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VlanConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VlanConnectionTest" (
    "id" TEXT NOT NULL,
    "vlanId" TEXT NOT NULL,
    "initiatorNodeId" TEXT NOT NULL,
    "targetNodeId" TEXT NOT NULL,
    "testType" "VlanTestType" NOT NULL DEFAULT 'ping',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resultCode" INTEGER,
    "resultMessage" TEXT,
    "latencyMs" DOUBLE PRECISION,
    "packetLoss" DOUBLE PRECISION,
    "hops" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VlanConnectionTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VlanConnectionSample" (
    "id" TEXT NOT NULL,
    "vlanId" TEXT NOT NULL,
    "sourceNodeId" TEXT NOT NULL,
    "targetNodeId" TEXT NOT NULL,
    "status" "VlanConnectionStatus" NOT NULL,
    "latencyMs" DOUBLE PRECISION,
    "packetLoss" DOUBLE PRECISION,
    "bandwidth" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VlanConnectionSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_ssoSubject_key" ON "User"("ssoSubject");

-- CreateIndex
CREATE UNIQUE INDEX "Node_vlanIp_key" ON "Node"("vlanIp");

-- CreateIndex
CREATE UNIQUE INDEX "Node_vlanMac_key" ON "Node"("vlanMac");

-- CreateIndex
CREATE INDEX "Share_status_idx" ON "Share"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ShareClient_shareId_clientId_key" ON "ShareClient"("shareId", "clientId");

-- CreateIndex
CREATE INDEX "Mount_status_idx" ON "Mount"("status");

-- CreateIndex
CREATE INDEX "MetricSample_nodeId_createdAt_idx" ON "MetricSample"("nodeId", "createdAt");

-- CreateIndex
CREATE INDEX "Disk_nodeId_idx" ON "Disk"("nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Disk_nodeId_name_key" ON "Disk"("nodeId", "name");

-- CreateIndex
CREATE INDEX "SmartReport_nodeId_collectedAt_idx" ON "SmartReport"("nodeId", "collectedAt");

-- CreateIndex
CREATE INDEX "SmartReport_nodeId_diskName_collectedAt_idx" ON "SmartReport"("nodeId", "diskName", "collectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Pool_name_key" ON "Pool"("name");

-- CreateIndex
CREATE INDEX "PoolMember_nodeId_idx" ON "PoolMember"("nodeId");

-- CreateIndex
CREATE INDEX "PoolMember_status_idx" ON "PoolMember"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PoolMember_poolId_nodeId_key" ON "PoolMember"("poolId", "nodeId");

-- CreateIndex
CREATE INDEX "AlertRule_enabled_idx" ON "AlertRule"("enabled");

-- CreateIndex
CREATE INDEX "Alert_triggeredAt_idx" ON "Alert"("triggeredAt");

-- CreateIndex
CREATE INDEX "Alert_status_idx" ON "Alert"("status");

-- CreateIndex
CREATE INDEX "Alert_nodeId_idx" ON "Alert"("nodeId");

-- CreateIndex
CREATE INDEX "SyncJobRun_syncJobId_startedAt_idx" ON "SyncJobRun"("syncJobId", "startedAt");

-- CreateIndex
CREATE INDEX "MigrationTask_sourceNodeId_status_idx" ON "MigrationTask"("sourceNodeId", "status");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_resourceType_idx" ON "AuditLog"("resourceType");

-- CreateIndex
CREATE INDEX "AgentLog_nodeId_createdAt_idx" ON "AgentLog"("nodeId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentLog_createdAt_idx" ON "AgentLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Vlan_name_key" ON "Vlan"("name");

-- CreateIndex
CREATE INDEX "VlanMember_vlanId_idx" ON "VlanMember"("vlanId");

-- CreateIndex
CREATE INDEX "VlanMember_nodeId_idx" ON "VlanMember"("nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "VlanMember_vlanId_nodeId_key" ON "VlanMember"("vlanId", "nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "VlanMember_vlanId_vlanIp_key" ON "VlanMember"("vlanId", "vlanIp");

-- CreateIndex
CREATE UNIQUE INDEX "VlanMember_vlanId_vlanMac_key" ON "VlanMember"("vlanId", "vlanMac");

-- CreateIndex
CREATE INDEX "VlanConnection_vlanId_idx" ON "VlanConnection"("vlanId");

-- CreateIndex
CREATE INDEX "VlanConnection_sourceNodeId_idx" ON "VlanConnection"("sourceNodeId");

-- CreateIndex
CREATE INDEX "VlanConnection_targetNodeId_idx" ON "VlanConnection"("targetNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "VlanConnection_vlanId_sourceNodeId_targetNodeId_key" ON "VlanConnection"("vlanId", "sourceNodeId", "targetNodeId");

-- CreateIndex
CREATE INDEX "VlanConnectionTest_vlanId_idx" ON "VlanConnectionTest"("vlanId");

-- CreateIndex
CREATE INDEX "VlanConnectionTest_initiatorNodeId_idx" ON "VlanConnectionTest"("initiatorNodeId");

-- CreateIndex
CREATE INDEX "VlanConnectionTest_startedAt_idx" ON "VlanConnectionTest"("startedAt");

-- CreateIndex
CREATE INDEX "VlanConnectionSample_vlanId_sourceNodeId_targetNodeId_creat_idx" ON "VlanConnectionSample"("vlanId", "sourceNodeId", "targetNodeId", "createdAt");

-- CreateIndex
CREATE INDEX "VlanConnectionSample_createdAt_idx" ON "VlanConnectionSample"("createdAt");

-- AddForeignKey
ALTER TABLE "Share" ADD CONSTRAINT "Share_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareClient" ADD CONSTRAINT "ShareClient_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "Share"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mount" ADD CONSTRAINT "Mount_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSample" ADD CONSTRAINT "MetricSample_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Disk" ADD CONSTRAINT "Disk_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmartReport" ADD CONSTRAINT "SmartReport_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolMember" ADD CONSTRAINT "PoolMember_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolMember" ADD CONSTRAINT "PoolMember_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_notificationChannelId_fkey" FOREIGN KEY ("notificationChannelId") REFERENCES "NotificationChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AlertRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJobRun" ADD CONSTRAINT "SyncJobRun_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "SyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigrationTask" ADD CONSTRAINT "MigrationTask_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigrationTask" ADD CONSTRAINT "MigrationTask_targetNodeId_fkey" FOREIGN KEY ("targetNodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VlanMember" ADD CONSTRAINT "VlanMember_vlanId_fkey" FOREIGN KEY ("vlanId") REFERENCES "Vlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VlanMember" ADD CONSTRAINT "VlanMember_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VlanConnection" ADD CONSTRAINT "VlanConnection_vlanId_fkey" FOREIGN KEY ("vlanId") REFERENCES "Vlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VlanConnection" ADD CONSTRAINT "VlanConnection_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VlanConnection" ADD CONSTRAINT "VlanConnection_targetNodeId_fkey" FOREIGN KEY ("targetNodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VlanConnectionTest" ADD CONSTRAINT "VlanConnectionTest_vlanId_fkey" FOREIGN KEY ("vlanId") REFERENCES "Vlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VlanConnectionTest" ADD CONSTRAINT "VlanConnectionTest_initiatorNodeId_fkey" FOREIGN KEY ("initiatorNodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VlanConnectionSample" ADD CONSTRAINT "VlanConnectionSample_vlanId_fkey" FOREIGN KEY ("vlanId") REFERENCES "Vlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

