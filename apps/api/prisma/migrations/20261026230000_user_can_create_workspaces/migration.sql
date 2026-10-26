-- Mirrors membership of the Authentik access group (AUTHENTIK_ACCESS_GROUP).
ALTER TABLE "User" ADD COLUMN "canCreateWorkspaces" BOOLEAN NOT NULL DEFAULT false;

-- Per-user override of WORKSPACE_CREATION_LIMIT; null follows the default.
ALTER TABLE "User" ADD COLUMN "workspaceLimit" INTEGER;

-- Creator of a workspace, counted against WORKSPACE_CREATION_LIMIT.
ALTER TABLE "Workspace" ADD COLUMN "createdById" TEXT;
CREATE INDEX "Workspace_createdById_idx" ON "Workspace"("createdById");
