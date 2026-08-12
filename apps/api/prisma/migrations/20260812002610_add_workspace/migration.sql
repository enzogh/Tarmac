-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ssoGroupClaim" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "subnetIndex" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMembership" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");
CREATE UNIQUE INDEX "Workspace_ssoGroupClaim_key" ON "Workspace"("ssoGroupClaim");
CREATE UNIQUE INDEX "Workspace_subnetIndex_key" ON "Workspace"("subnetIndex");
CREATE INDEX "WorkspaceMembership_userId_idx" ON "WorkspaceMembership"("userId");
CREATE UNIQUE INDEX "WorkspaceMembership_workspaceId_userId_key" ON "WorkspaceMembership"("workspaceId", "userId");

-- AlterTable: add workspaceId as NULLABLE first on every table that gets a
-- direct column - it is backfilled below, then tightened to NOT NULL
-- (except AuditLog, which stays nullable for pre-workspace/system rows).
ALTER TABLE "Node" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Share" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Mount" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Pool" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "NotificationChannel" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "AlertRule" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Alert" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "SyncJob" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "MigrationTask" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Vlan" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "workspaceId" TEXT;

-- Data backfill: create the Default workspace and move every pre-existing
-- row into it, so the already-deployed fleet sees zero behavior change.
-- Fixed id so this INSERT is idempotent if this migration is ever replayed
-- against a DB that already has it (ON CONFLICT DO NOTHING).
INSERT INTO "Workspace" (id, name, slug, "ssoGroupClaim", "isDefault", "subnetIndex", "createdAt", "updatedAt")
VALUES ('default-workspace', 'Default', 'default', NULL, true, NULL, now(), now())
ON CONFLICT (id) DO NOTHING;

UPDATE "Node" SET "workspaceId" = 'default-workspace' WHERE "workspaceId" IS NULL;
UPDATE "Share" SET "workspaceId" = 'default-workspace' WHERE "workspaceId" IS NULL;
UPDATE "Mount" SET "workspaceId" = 'default-workspace' WHERE "workspaceId" IS NULL;
UPDATE "Pool" SET "workspaceId" = 'default-workspace' WHERE "workspaceId" IS NULL;
UPDATE "NotificationChannel" SET "workspaceId" = 'default-workspace' WHERE "workspaceId" IS NULL;
UPDATE "AlertRule" SET "workspaceId" = 'default-workspace' WHERE "workspaceId" IS NULL;
UPDATE "Alert" SET "workspaceId" = 'default-workspace' WHERE "workspaceId" IS NULL;
UPDATE "SyncJob" SET "workspaceId" = 'default-workspace' WHERE "workspaceId" IS NULL;
UPDATE "MigrationTask" SET "workspaceId" = 'default-workspace' WHERE "workspaceId" IS NULL;
UPDATE "Vlan" SET "workspaceId" = 'default-workspace' WHERE "workspaceId" IS NULL;
UPDATE "AuditLog" SET "workspaceId" = 'default-workspace' WHERE "workspaceId" IS NULL;

INSERT INTO "WorkspaceMembership" (id, "workspaceId", "userId", role, source, "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'default-workspace', "id", 'member', 'manual', now(), now()
FROM "User"
ON CONFLICT DO NOTHING;

-- Now that every row is backfilled, tighten the columns to NOT NULL
-- (AuditLog intentionally excluded - stays nullable).
ALTER TABLE "Node" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "Share" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "Mount" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "Pool" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "NotificationChannel" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "AlertRule" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "Alert" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "SyncJob" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "MigrationTask" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "Vlan" ALTER COLUMN "workspaceId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Node_workspaceId_idx" ON "Node"("workspaceId");
CREATE INDEX "Share_workspaceId_idx" ON "Share"("workspaceId");
CREATE INDEX "Mount_workspaceId_idx" ON "Mount"("workspaceId");
CREATE INDEX "Pool_workspaceId_idx" ON "Pool"("workspaceId");
CREATE INDEX "NotificationChannel_workspaceId_idx" ON "NotificationChannel"("workspaceId");
CREATE INDEX "AlertRule_workspaceId_idx" ON "AlertRule"("workspaceId");
CREATE INDEX "Alert_workspaceId_idx" ON "Alert"("workspaceId");
CREATE INDEX "SyncJob_workspaceId_idx" ON "SyncJob"("workspaceId");
CREATE INDEX "MigrationTask_workspaceId_idx" ON "MigrationTask"("workspaceId");
CREATE INDEX "AuditLog_workspaceId_idx" ON "AuditLog"("workspaceId");
CREATE INDEX "Vlan_workspaceId_idx" ON "Vlan"("workspaceId");

-- AddForeignKey
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Node" ADD CONSTRAINT "Node_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Share" ADD CONSTRAINT "Share_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Mount" ADD CONSTRAINT "Mount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Pool" ADD CONSTRAINT "Pool_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MigrationTask" ADD CONSTRAINT "MigrationTask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Vlan" ADD CONSTRAINT "Vlan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
