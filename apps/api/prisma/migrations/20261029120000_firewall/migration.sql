-- AlterTable
ALTER TABLE "Node" ADD COLUMN     "firewallAppliedRevision" TIMESTAMP(3),
ADD COLUMN     "firewallApplyError" TEXT,
ADD COLUMN     "firewallApplyStatus" TEXT,
ADD COLUMN     "firewallPublicMode" TEXT NOT NULL DEFAULT 'open',
ADD COLUMN     "firewallReport" JSONB;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "firewallMeshMode" TEXT NOT NULL DEFAULT 'open',
ADD COLUMN     "firewallPublicPing" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "firewallSshGuard" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "FirewallRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'allow',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sourceKind" TEXT NOT NULL DEFAULT 'any',
    "sourceNodeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceLabels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceCidrs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "targetKind" TEXT NOT NULL DEFAULT 'any',
    "targetNodeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "targetLabels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "protocol" TEXT NOT NULL DEFAULT 'tcp',
    "ports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "hitCount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastHitAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FirewallRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FirewallEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sourceIp" TEXT NOT NULL,
    "sourceNodeId" TEXT,
    "sources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "protocol" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 0,
    "docker" BOOLEAN NOT NULL DEFAULT false,
    "ruleId" TEXT,
    "count" INTEGER NOT NULL DEFAULT 0,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FirewallEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FirewallRule_workspaceId_idx" ON "FirewallRule"("workspaceId");

-- CreateIndex
CREATE INDEX "FirewallEvent_workspaceId_lastSeenAt_idx" ON "FirewallEvent"("workspaceId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "FirewallEvent_lastSeenAt_idx" ON "FirewallEvent"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "FirewallEvent_nodeId_key_bucketStart_key" ON "FirewallEvent"("nodeId", "key", "bucketStart");

-- AddForeignKey
ALTER TABLE "FirewallRule" ADD CONSTRAINT "FirewallRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FirewallEvent" ADD CONSTRAINT "FirewallEvent_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
