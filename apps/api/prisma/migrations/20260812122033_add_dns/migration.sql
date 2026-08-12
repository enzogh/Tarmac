-- CreateEnum
CREATE TYPE "DnsServerGroupStatus" AS ENUM ('pending', 'active', 'error');

-- CreateEnum
CREATE TYPE "DnsServerGroupMemberStatus" AS ENUM ('pending', 'active', 'error');

-- CreateEnum
CREATE TYPE "DnsServerGroupMemberRole" AS ENUM ('primary', 'secondary');

-- CreateEnum
CREATE TYPE "DnsZoneStatus" AS ENUM ('pending', 'active', 'error');

-- CreateEnum
CREATE TYPE "DnsRecordStatus" AS ENUM ('pending', 'active', 'error');

-- CreateEnum
CREATE TYPE "DnsRecordType" AS ENUM ('A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'CAA', 'SRV', 'PTR');

-- CreateTable
CREATE TABLE "DnsServerGroup" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "DnsServerGroupStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DnsServerGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DnsServerGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "role" "DnsServerGroupMemberRole" NOT NULL DEFAULT 'secondary',
    "status" "DnsServerGroupMemberStatus" NOT NULL DEFAULT 'pending',
    "conflictDetail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DnsServerGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DnsZone" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dnssecEnabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "DnsZoneStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DnsZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DnsRecord" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DnsRecordType" NOT NULL,
    "ttl" INTEGER NOT NULL DEFAULT 3600,
    "isGeo" BOOLEAN NOT NULL DEFAULT false,
    "status" "DnsRecordStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DnsRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DnsRecordValue" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "nodeId" TEXT,
    "priority" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DnsRecordValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DnsServerGroup_workspaceId_idx" ON "DnsServerGroup"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "DnsServerGroup_workspaceId_name_key" ON "DnsServerGroup"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "DnsServerGroupMember_nodeId_idx" ON "DnsServerGroupMember"("nodeId");

-- CreateIndex
CREATE INDEX "DnsServerGroupMember_status_idx" ON "DnsServerGroupMember"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DnsServerGroupMember_groupId_nodeId_key" ON "DnsServerGroupMember"("groupId", "nodeId");

-- CreateIndex
CREATE INDEX "DnsZone_workspaceId_idx" ON "DnsZone"("workspaceId");

-- CreateIndex
CREATE INDEX "DnsZone_groupId_idx" ON "DnsZone"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "DnsZone_workspaceId_name_key" ON "DnsZone"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "DnsRecord_zoneId_idx" ON "DnsRecord"("zoneId");

-- CreateIndex
CREATE INDEX "DnsRecord_status_idx" ON "DnsRecord"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DnsRecord_zoneId_name_type_key" ON "DnsRecord"("zoneId", "name", "type");

-- CreateIndex
CREATE INDEX "DnsRecordValue_recordId_idx" ON "DnsRecordValue"("recordId");

-- CreateIndex
CREATE INDEX "DnsRecordValue_nodeId_idx" ON "DnsRecordValue"("nodeId");

-- AddForeignKey
ALTER TABLE "DnsServerGroup" ADD CONSTRAINT "DnsServerGroup_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DnsServerGroupMember" ADD CONSTRAINT "DnsServerGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "DnsServerGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DnsServerGroupMember" ADD CONSTRAINT "DnsServerGroupMember_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DnsZone" ADD CONSTRAINT "DnsZone_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DnsZone" ADD CONSTRAINT "DnsZone_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "DnsServerGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DnsRecord" ADD CONSTRAINT "DnsRecord_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "DnsZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DnsRecordValue" ADD CONSTRAINT "DnsRecordValue_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "DnsRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DnsRecordValue" ADD CONSTRAINT "DnsRecordValue_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;
