-- CreateTable
CREATE TABLE "FirewallDismissal" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FirewallDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FirewallDismissal_nodeId_key_key" ON "FirewallDismissal"("nodeId", "key");

-- CreateIndex
CREATE INDEX "FirewallDismissal_workspaceId_idx" ON "FirewallDismissal"("workspaceId");

-- AddForeignKey
ALTER TABLE "FirewallDismissal" ADD CONSTRAINT "FirewallDismissal_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
