-- Pool names were unique across the whole platform: one client could take a
-- name for everyone else. They are now unique per workspace.
DROP INDEX "Pool_name_key";
CREATE UNIQUE INDEX "Pool_workspaceId_name_key" ON "Pool"("workspaceId", "name");
