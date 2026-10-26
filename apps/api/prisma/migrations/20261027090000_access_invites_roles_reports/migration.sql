-- Account disabling and session revocation.
ALTER TABLE "User" ADD COLUMN "disabledAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "sessionsRevokedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "accessCheckedAt" TIMESTAMP(3);

-- Weekly report.
ALTER TABLE "Workspace" ADD COLUMN "weeklyReportEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Workspace" ADD COLUMN "weeklyReportSentAt" TIMESTAMP(3);

-- Agent update progress.
ALTER TABLE "Node" ADD COLUMN "agentUpdateStatus" TEXT;
ALTER TABLE "Node" ADD COLUMN "agentUpdateMessage" TEXT;
ALTER TABLE "Node" ADD COLUMN "agentUpdateFromVersion" TEXT;
ALTER TABLE "Node" ADD COLUMN "agentUpdateToVersion" TEXT;
ALTER TABLE "Node" ADD COLUMN "agentUpdateStartedAt" TIMESTAMP(3);
ALTER TABLE "Node" ADD COLUMN "agentUpdateFinishedAt" TIMESTAMP(3);

-- Custom roles.
CREATE TABLE "WorkspaceCustomRole" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkspaceCustomRole_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkspaceCustomRole_workspaceId_name_key" ON "WorkspaceCustomRole"("workspaceId", "name");
ALTER TABLE "WorkspaceCustomRole" ADD CONSTRAINT "WorkspaceCustomRole_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceMembership" ADD COLUMN "customRoleId" TEXT;
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "WorkspaceCustomRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Pending invitations.
CREATE TABLE "WorkspaceInvitation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customRoleId" TEXT,
    "invitedById" TEXT,
    "lastSentAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkspaceInvitation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkspaceInvitation_workspaceId_email_key" ON "WorkspaceInvitation"("workspaceId", "email");
CREATE INDEX "WorkspaceInvitation_email_idx" ON "WorkspaceInvitation"("email");
ALTER TABLE "WorkspaceInvitation" ADD CONSTRAINT "WorkspaceInvitation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceInvitation" ADD CONSTRAINT "WorkspaceInvitation_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "WorkspaceCustomRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Platform settings.
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- Daily availability and disk usage per node.
CREATE TABLE "NodeDailyStat" (
    "nodeId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "observedMinutes" INTEGER NOT NULL DEFAULT 0,
    "onlineMinutes" INTEGER NOT NULL DEFAULT 0,
    "diskUsedGb" INTEGER,
    "diskCapacityGb" INTEGER,
    CONSTRAINT "NodeDailyStat_pkey" PRIMARY KEY ("nodeId", "day")
);
CREATE INDEX "NodeDailyStat_day_idx" ON "NodeDailyStat"("day");
ALTER TABLE "NodeDailyStat" ADD CONSTRAINT "NodeDailyStat_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
