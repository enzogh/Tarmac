-- Attempts per source address on internet rows (which add up all addresses).
ALTER TABLE "FirewallEvent" ADD COLUMN "sourceCounts" JSONB;

-- Bans shared by every server of a workspace.
CREATE TABLE "FirewallBan" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "strikes" INTEGER NOT NULL DEFAULT 1,
    "sourceNodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FirewallBan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FirewallBan_workspaceId_kind_address_key" ON "FirewallBan"("workspaceId", "kind", "address");
CREATE INDEX "FirewallBan_workspaceId_until_idx" ON "FirewallBan"("workspaceId", "until");
CREATE INDEX "FirewallBan_until_idx" ON "FirewallBan"("until");
