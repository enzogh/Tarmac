-- CreateEnum
CREATE TYPE "VpnProfileMode" AS ENUM ('full', 'private');

-- AlterTable
ALTER TABLE "Node" ADD COLUMN     "vpnAppliedRevision" TIMESTAMP(3),
ADD COLUMN     "vpnApplyError" TEXT,
ADD COLUMN     "vpnApplyStatus" TEXT,
ADD COLUMN     "vpnSubnetIndex" INTEGER;

-- CreateTable
CREATE TABLE "VpnProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "mode" "VpnProfileMode" NOT NULL DEFAULT 'full',
    "entryNodeId" TEXT NOT NULL,
    "exitNodeId" TEXT,
    "clientIp" TEXT NOT NULL,
    "clientPublicKey" TEXT NOT NULL,
    "clientPrivateKey" TEXT,
    "presharedKey" TEXT NOT NULL,
    "dns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "configChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitSwitchedAt" TIMESTAMP(3),
    "lastHandshakeAt" TIMESTAMP(3),
    "clientEndpoint" TEXT,
    "rxBytes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "txBytes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdByApiKeyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VpnProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdByUserId" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedIp" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VpnProfile_clientPublicKey_key" ON "VpnProfile"("clientPublicKey");

-- CreateIndex
CREATE INDEX "VpnProfile_workspaceId_idx" ON "VpnProfile"("workspaceId");

-- CreateIndex
CREATE INDEX "VpnProfile_exitNodeId_idx" ON "VpnProfile"("exitNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "VpnProfile_entryNodeId_clientIp_key" ON "VpnProfile"("entryNodeId", "clientIp");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_prefix_key" ON "ApiKey"("prefix");

-- CreateIndex
CREATE INDEX "ApiKey_workspaceId_idx" ON "ApiKey"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Node_workspaceId_vpnSubnetIndex_key" ON "Node"("workspaceId", "vpnSubnetIndex");

-- AddForeignKey
ALTER TABLE "VpnProfile" ADD CONSTRAINT "VpnProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VpnProfile" ADD CONSTRAINT "VpnProfile_entryNodeId_fkey" FOREIGN KEY ("entryNodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VpnProfile" ADD CONSTRAINT "VpnProfile_exitNodeId_fkey" FOREIGN KEY ("exitNodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

